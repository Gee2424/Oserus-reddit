// Multi-platform posting coordinator.
//
// One tick walks every eligible account on every platform whose adapter
// is configured. Accounts are partitioned by platform (different
// platforms run in parallel — they don't share rate limits or auth) and
// within a platform by proxy (same-proxy accounts run serially so we
// don't burn a residential IP with two simultaneous submits). The
// adapter contract (src/main/platforms/index.js) handles the
// platform-specific bits — this file is the loop.
//
// "Offline" coordination across VAs requires a shared DB; today the
// lock + events live in local SQLite, so dedup is per-machine. The
// code is written so pointing protocols.js at a shared backend later
// turns this into true cross-VA coordination with no changes here.
//
// Everything is OFF until an admin enables a protocol AND turns the
// coordinator on (autopilot_enabled setting). Safe by default.

const os = require('os');
const elog = require('electron-log');
const { getDb, getKv, setKv } = require('../db');
const protocols = require('./protocols');
const { getAdapter, postablePlatforms } = require('../platforms');
const { getSetting } = require('./settings');

const HOLDER = `${os.hostname()}-${process.pid}`;
let timer = null;
let running = false;
let lastRun = null;
let lastSummary = null;

function isEnabled() { return getSetting('autopilot_enabled') === '1'; }

// Remote machine gate from Supabase. When a team manager sets
// machine_sessions.autopilot_enabled = false for this machine, the
// coordinator stops running. Fail-open — if Supabase is unreachable,
// the local setting alone controls the gate.
let remoteAutopilotDisabled = false;

async function checkRemoteAutopilot() {
  try {
    const { getAnonClient } = require('../supabaseClient');
    const client = getAnonClient();
    if (!client) return;
    const { data, error } = await client
      .from('machine_sessions')
      .select('autopilot_enabled')
      .eq('machine_id', HOLDER)
      .maybeSingle();
    if (error) { elog.warn('[autopilot] Remote autopilot check failed:', error.message); return; }
    if (data && data.autopilot_enabled === false) {
      if (!remoteAutopilotDisabled) {
        remoteAutopilotDisabled = true;
        elog.warn('[autopilot] Remote autopilot DISABLED by team manager');
      }
    } else {
      if (remoteAutopilotDisabled) {
        remoteAutopilotDisabled = false;
        elog.info('[autopilot] Remote autopilot RE-ENABLED');
      }
    }
  } catch (e) { /* fail-open */ }
}

function isEnabledAll() {
  return isEnabled() && !remoteAutopilotDisabled;
}

// --------------------------------------------------------------- candidates
// One query per tick returns every postable account on every configured
// platform, plus the columns the adapter contract needs (status, niche,
// brand voice, proxy_id) so we don't re-query per-account.
function candidateAccounts() {
  const platforms = postablePlatforms();
  if (!platforms.length) return [];
  const placeholders = platforms.map(() => '?').join(',');
  const teamId = getSetting('active_team_id');
  const params = [...platforms];
  let teamClause = '';
  if (teamId) { teamClause = ' AND a.team_id = ?'; params.push(teamId); }

  const cmEnabled = getSetting('autopilot_cm_enabled') !== '0';
  const cmExcludeClause = cmEnabled ? '' : "AND (bs.browser_mode IS NULL OR bs.browser_mode != 'cloakmanager')";

  return getDb().prepare(
    `SELECT a.id, a.username, a.status, a.platform, a.profile_id,
            a.proxy_id, a.partition_key,
            p.name AS profile_name, p.niche, p.brand_voice
       FROM reddit_accounts a
       JOIN model_profiles p ON p.id = a.profile_id
       LEFT JOIN account_browser_settings bs ON bs.account_id = a.id
      WHERE a.platform IN (${placeholders})
        AND a.status IN ('warming','ready')${teamClause}
        ${cmExcludeClause}
        AND (bs.autopilot_skip IS NULL OR bs.autopilot_skip = 0)
      ORDER BY a.platform, a.proxy_id, a.id`
  ).all(...params);
}

// Group accounts by (platform, proxy_id) so the executor can run
// distinct proxy groups in parallel but serialize accounts that share
// a proxy. Accounts with no proxy get bucketed under 'noproxy'.
function bucketByPlatformAndProxy(accounts) {
  const byPlatform = new Map();
  for (const a of accounts) {
    if (!byPlatform.has(a.platform)) byPlatform.set(a.platform, new Map());
    const byProxy = byPlatform.get(a.platform);
    const key = a.proxy_id ?? 'noproxy';
    if (!byProxy.has(key)) byProxy.set(key, []);
    byProxy.get(key).push(a);
  }
  return byPlatform;
}

// -------------------------------------------------------- single-account run
async function runForAccount(account, summary) {
  const adapter = getAdapter(account.platform);
  if (!adapter || !adapter.configured) {
    summary.skipped++;
    summary.reasons.no_adapter = (summary.reasons.no_adapter || 0) + 1;
    return;
  }

  if (isCircuitOpen(account.id)) {
    summary.skipped++;
    summary.reasons.circuit_open = (summary.reasons.circuit_open || 0) + 1;
    return;
  }

  const elig = await protocols.checkEligibilityShared({
    platform: account.platform,
    accountId: account.id,
    profileId: account.profile_id,
  });
  if (!elig.eligible) {
    summary.skipped++;
    summary.reasons[elig.reason] = (summary.reasons[elig.reason] || 0) + 1;
    return;
  }

  const ttl = Number(getSetting('autopilot_lock_ttl') || 300);
  if (!(await protocols.acquireLock(account.platform, account.id, HOLDER, ttl))) {
    summary.skipped++;
    summary.reasons.locked = (summary.reasons.locked || 0) + 1;
    return;
  }

  try {
    const { prepareSessionForAccount } = require('./sessionPrep');
    const sessionPrep = await prepareSessionForAccount(account.id).catch((e) => {
      elog.warn('[autopilot] sessionPrep failed', { account: account.id, err: e?.message });
      return { ok: false, error: e.message };
    });

    if (!sessionPrep.ok) return;

    if (sessionPrep.mode === 'cloakmanager') {
      if (!sessionPrep.profileName) {
        elog.warn('[autopilot] CM account missing profileName', { account: account.id, username: account.username });
        summary.skipped++;
        summary.reasons.cm_no_profile = (summary.reasons.cm_no_profile || 0) + 1;
        return;
      }

      const { recordRun } = require('../ipc/automation');
      const startedAt = new Date().toISOString();

      const { cdpOrchestrator } = await requireCdpOrchestrator();
      const gen = adapter.generateContent
        ? await adapter.generateContent({ account, target: null })
        : { ok: false, error: 'adapter has no generateContent' };
      if (!gen.ok) {
        summary.skipped++;
        summary.reasons[`gen:${gen.error}`.slice(0, 80)] =
          (summary.reasons[`gen:${gen.error}`.slice(0, 80)] || 0) + 1;
        return;
      }

      const scriptId = account.platform === 'reddit' ? 'tasks/reddit/submit' : 'tasks/x/compose';
      const result = await cdpOrchestrator.executeTask(scriptId, {
        accountId: account.id,
        profileName: sessionPrep.profileName,
        platform: account.platform,
        title: gen.title,
        body: gen.body,
        subreddit: gen.target,
        kind: gen.kind,
        url: gen.url,
        text: gen.title,
      });

      const completedAt = new Date().toISOString();
      const durationMs = Date.now() - new Date(startedAt).getTime();
      const status = result.ok ? 'completed' : 'failed';

      recordRun(getDb(), {
        accountId: account.id,
        platform: account.platform,
        browserMode: 'cloakmanager',
        runType: 'autopilot_tick',
        status,
        scriptId,
        resultJson: result.ok ? JSON.stringify(result.result || {}) : null,
        error: result.ok ? null : result.error,
        triggeredBy: 'autopilot',
        durationMs,
        startedAt,
        completedAt,
      });

      await protocols.recordEvent({
        platform: account.platform,
        account_id: account.id,
        profile_id: account.profile_id,
        subreddit: gen.target,
        title: gen.title,
        remote_id: result.ok && result.result ? (result.result.url || result.result.id) : null,
        status: result.ok ? 'posted' : 'failed',
        source: 'auto',
        error: result.ok ? null : result.error,
      });

      if (result.ok) { summary.posted++; resetFailure(account.id); }
      else { summary.failed++; summary.errors.push(`${account.platform}/${account.username}: ${result.error}`.slice(0, 200)); trackFailure(account.id, result.error); }
    } else {
      const target = adapter.pickTarget ? await adapter.pickTarget(account) : null;
      const gen = adapter.generateContent
        ? await adapter.generateContent({ account, target })
        : { ok: false, error: 'adapter has no generateContent' };
      if (!gen.ok) {
        summary.skipped++;
        summary.reasons[`gen:${gen.error}`.slice(0, 80)] =
          (summary.reasons[`gen:${gen.error}`.slice(0, 80)] || 0) + 1;
        return;
      }

      const submitArgs = {
        accountId: account.id,
        subreddit: gen.target,
        title: gen.title,
        body: gen.body,
        kind: gen.kind,
        url: gen.url,
        text: gen.title,
        caption: gen.title,
        mediaUrl: gen.url,
      };
      const result = await adapter.submitPost(submitArgs);

      await protocols.recordEvent({
        platform: account.platform,
        account_id: account.id,
        profile_id: account.profile_id,
        subreddit: gen.target,
        title: gen.title,
        remote_id: result.id || null,
        status: result.ok ? 'posted' : 'failed',
        source: 'auto',
        error: result.ok ? null : result.error,
      });

      if (result.ok) {
        summary.posted++;
        resetFailure(account.id);
      } else {
        summary.failed++;
        summary.errors.push(`${account.platform}/${account.username}: ${result.error}`.slice(0, 200));
        trackFailure(account.id, result.error);
      }
    }
  } catch (err) {
    summary.failed++;
    summary.errors.push(`${account.platform}/${account.username}: ${err.message}`.slice(0, 200));
    trackFailure(account.id, err.message);
  } finally {
    await protocols.releaseLock(account.platform, account.id);
  }
}

let _cdpOrch = null;
async function requireCdpOrchestrator() {
  if (!_cdpOrch) _cdpOrch = { cdpOrchestrator: require('../cdp/orchestrator') };
  return _cdpOrch;
}

// -------------------------------------------------------------- main pass
async function runOnce({ dryRun = false } = {}) {
  if (running) return lastSummary || { ok: false, error: 'Already running' };
  running = true;
  const startedAt = Date.now();
  const summary = {
    startedAt: new Date(startedAt).toISOString(),
    considered: 0, posted: 0, skipped: 0, failed: 0,
    perPlatform: {},
    reasons: {},
    errors: [],
  };

  try {
    const accounts = candidateAccounts();
    summary.considered = accounts.length;

    if (dryRun) {
      for (const a of accounts) {
        const elig = await protocols.checkEligibilityShared({
          platform: a.platform, accountId: a.id, profileId: a.profile_id,
        });
        if (elig.eligible) summary.posted++; else {
          summary.skipped++;
          summary.reasons[elig.reason] = (summary.reasons[elig.reason] || 0) + 1;
        }
      }
    } else {
      const byPlatform = bucketByPlatformAndProxy(accounts);
      // Parallel across platforms; within a platform parallel across
      // distinct proxies; serial across accounts on the same proxy.
      await Promise.all(Array.from(byPlatform.entries()).map(async ([platform, proxyMap]) => {
        const platSummary = { posted: 0, skipped: 0, failed: 0 };
        await Promise.all(Array.from(proxyMap.values()).map(async (group) => {
          for (const acct of group) {
            const before = { posted: summary.posted, skipped: summary.skipped, failed: summary.failed };
            await runForAccount(acct, summary);
            platSummary.posted  += summary.posted  - before.posted;
            platSummary.skipped += summary.skipped - before.skipped;
            platSummary.failed  += summary.failed  - before.failed;
          }
        }));
        summary.perPlatform[platform] = platSummary;
      }));
    }
  } catch (err) {
    summary.error = err.message;
  } finally {
    running = false;
    lastRun = new Date().toISOString();
    summary.elapsedMs = Date.now() - startedAt;
    lastSummary = summary;
    // Concise per-tick telemetry — visible in electron-log without
    // turning on verbose logging.
    elog.info(
      `[autopilot] considered=${summary.considered} posted=${summary.posted} ` +
      `skipped=${summary.skipped} failed=${summary.failed} ` +
      `elapsed=${summary.elapsedMs}ms platforms=${Object.keys(summary.perPlatform).join(',')}`
    );
  }
  return summary;
}

// --------------------------------------------------------- scheduled posts
// Fire any scheduled posts that are due. Runs every tick regardless of
// the autopilot master switch — a scheduled post is an explicit user
// action, not autonomous posting. Honors the post_locks TTL so it
// can't race the autopilot pass for the same account.
async function runDueScheduled() {
  const db = getDb();
  let due;
  try {
    // Prefer the stored platform column when present (set by recent
    // create/bulkCreate). Fall back to the account's platform for rows
    // that pre-date the column migration. COALESCE handles both.
    const teamId = getSetting('active_team_id');
    const teamClause = teamId ? ' AND a.team_id = ?' : '';
    const params = teamId ? [teamId] : [];
    due = db.prepare(
      `SELECT s.*, COALESCE(s.platform, a.platform) AS platform, a.profile_id AS profile_id
         FROM scheduled_posts s
         JOIN reddit_accounts a ON a.id = s.account_id
        WHERE s.status = 'pending'
          AND s.scheduled_for <= datetime('now')${teamClause}
        ORDER BY s.scheduled_for ASC LIMIT 25`
    ).all(...params);
  } catch (e) {
    // Previously this was swallowed silently — operator saw no posts
    // fire with no signal as to why. Surface to the log so we can
    // diagnose corrupted-DB / locked-table situations.
    elog.warn('[scheduler] runDueScheduled query failed', e?.message);
    return;
  }

  for (const post of due) {
    const platform = post.platform || 'reddit';
    if (isCircuitOpen(post.account_id)) continue;
    if (!(await protocols.acquireLock(platform, post.account_id, HOLDER, 300))) continue;
    const schedStartedAt = new Date().toISOString();
    try {
      const { prepareSessionForAccount } = require('./sessionPrep');
      const sessionPrep = await prepareSessionForAccount(post.account_id).catch((e) => {
        elog.warn('[scheduler] sessionPrep failed', { post: post.id, err: e?.message });
        return { ok: false, error: e.message };
      });

      if (!sessionPrep.ok) continue;

      if (platform === 'reddit') {
        const fail = checkEligibility(db, post);
        if (fail) {
          db.prepare("UPDATE scheduled_posts SET status='failed', error=? WHERE id=?").run(fail, post.id);
          await protocols.recordEvent({
            platform, account_id: post.account_id, profile_id: post.profile_id,
            subreddit: post.subreddit, title: post.title,
            status: 'failed', source: 'scheduled', error: fail,
          });
          continue;
        }
      }

      let title = post.title || '';
      let body = post.body || '';
      let kind = post.kind || 'self';
      if (post.auto_generate && !title) {
        try {
          const { generatePost } = require('./postgen');
          const g = await generatePost({
            accountId: post.account_id, mode: 'sfw',
            targetSubreddit: post.subreddit, autopilot: true,
          });
          const pick = (g.suggestions || [])[0];
          if (pick) {
            title = pick.title || '';
            if (pick.body) body = pick.body;
            if (pick.kind) kind = pick.kind;
            db.prepare("UPDATE scheduled_posts SET title=?, body=?, kind=? WHERE id=?")
              .run(title, body, kind, post.id);
          }
        } catch (e) {
          db.prepare("UPDATE scheduled_posts SET status='failed', error=? WHERE id=?")
            .run(`Auto-gen failed: ${e.message}`, post.id);
          continue;
        }
        if (!title) {
          db.prepare("UPDATE scheduled_posts SET status='failed', error=? WHERE id=?")
            .run('Auto-gen returned no title', post.id);
          continue;
        }
      }

      if (sessionPrep.mode === 'cloakmanager') {
        if (!sessionPrep.profileName) {
          elog.warn('[scheduler] CM account missing profileName', { account: post.account_id });
          db.prepare("UPDATE scheduled_posts SET status='failed', error=? WHERE id=?")
            .run('No CloakManager profile configured for this account', post.id);
          continue;
        }

        const { recordRun } = require('../ipc/automation');
        const { cdpOrchestrator } = await requireCdpOrchestrator();

        const scriptId = platform === 'reddit' ? 'tasks/reddit/submit' : 'tasks/x/compose';
        const result = await cdpOrchestrator.executeTask(scriptId, {
          accountId: post.account_id,
          profileName: sessionPrep.profileName,
          platform, title, body,
          subreddit: post.subreddit,
          kind, url: post.url,
          text: title,
        });

        const sduration = Date.now() - new Date(schedStartedAt).getTime();
        if (result.ok) {
          resetFailure(post.account_id);
          db.prepare("UPDATE scheduled_posts SET status='posted', posted_at=datetime('now') WHERE id=?").run(post.id);
          const postedUrl = result.result?.url || null;
          await protocols.recordEvent({
            platform, account_id: post.account_id, profile_id: post.profile_id,
            subreddit: post.subreddit, title: post.title,
            remote_id: postedUrl || result.result?.id,
            status: 'posted', source: 'scheduled',
          });
          if (postedUrl) {
            db.prepare("UPDATE scheduled_posts SET posted_url=? WHERE id=?").run(postedUrl, post.id);
          }
          recordRun(db, {
            accountId: post.account_id, platform,
            browserMode: 'cloakmanager', runType: 'schedule_fire',
            status: 'completed', scriptId,
            resultJson: JSON.stringify(result.result || {}),
            triggeredBy: 'scheduled',
            schedulePostId: post.id, durationMs: sduration,
            startedAt: schedStartedAt, completedAt: new Date().toISOString(),
          });
          if (post.boost_service_id && Number(post.boost_qty) > 0 && postedUrl) {
            const delayMin = Math.max(0, Number(post.boost_delay_minutes) || 0);
            if (delayMin === 0) {
              await fireBoostOrder(post, postedUrl);
            } else {
              const fireAt = new Date(Date.now() + delayMin * 60000)
                .toISOString().replace('T', ' ').slice(0, 19);
              db.prepare("UPDATE scheduled_posts SET boost_status='pending', boost_fire_at=? WHERE id=?")
                .run(fireAt, post.id);
            }
          }
        } else {
          trackFailure(post.account_id, result.error);
          db.prepare("UPDATE scheduled_posts SET status='failed', error=? WHERE id=?").run(result.error, post.id);
          await protocols.recordEvent({
            platform, account_id: post.account_id, profile_id: post.profile_id,
            subreddit: post.subreddit, title: post.title,
            status: 'failed', source: 'scheduled', error: result.error,
          });
          recordRun(db, {
            accountId: post.account_id, platform,
            browserMode: 'cloakmanager', runType: 'schedule_fire',
            status: 'failed', scriptId,
            error: result.error,
            triggeredBy: 'scheduled',
            schedulePostId: post.id, durationMs: sduration,
            startedAt: schedStartedAt, completedAt: new Date().toISOString(),
          });
        }
      } else {
        const adapter = getAdapter(platform);
        if (!adapter || !adapter.configured) {
          db.prepare("UPDATE scheduled_posts SET status='failed', error=? WHERE id=?")
            .run(`No adapter for ${platform}`, post.id);
          continue;
        }
        const result = await adapter.submitPost({
          accountId: post.account_id, subreddit: post.subreddit,
          title, body, kind, url: post.url,
          text: title, caption: title, mediaUrl: post.url,
        });
        if (result.ok) {
          resetFailure(post.account_id);
          db.prepare("UPDATE scheduled_posts SET status='posted', posted_at=datetime('now') WHERE id=?").run(post.id);
          await protocols.recordEvent({
            platform, account_id: post.account_id, profile_id: post.profile_id,
            subreddit: post.subreddit, title: post.title, remote_id: result.id,
            status: 'posted', source: 'scheduled',
          });
          if (result.url) {
            db.prepare("UPDATE scheduled_posts SET posted_url=? WHERE id=?").run(result.url, post.id);
          }
          if (post.boost_service_id && Number(post.boost_qty) > 0 && result.url) {
            const delayMin = Math.max(0, Number(post.boost_delay_minutes) || 0);
            if (delayMin === 0) {
              await fireBoostOrder(post, result.url);
            } else {
              const fireAt = new Date(Date.now() + delayMin * 60000)
                .toISOString().replace('T', ' ').slice(0, 19);
              db.prepare("UPDATE scheduled_posts SET boost_status='pending', boost_fire_at=? WHERE id=?")
                .run(fireAt, post.id);
            }
          }
        } else {
          trackFailure(post.account_id, result.error);
          db.prepare("UPDATE scheduled_posts SET status='failed', error=? WHERE id=?").run(result.error, post.id);
          await protocols.recordEvent({
            platform, account_id: post.account_id, profile_id: post.profile_id,
            subreddit: post.subreddit, title: post.title,
            status: 'failed', source: 'scheduled', error: result.error,
          });
        }
      }
    } catch (err) {
      trackFailure(post.account_id, err.message);
      db.prepare("UPDATE scheduled_posts SET status='failed', error=? WHERE id=?").run(err.message, post.id);
    } finally {
      await protocols.releaseLock(platform, post.account_id);
    }
  }
}

// Returns null if the post should fire, otherwise a human-readable
// reason. Pulls the latest karma snapshot + account row + cached
// subreddit intel and checks min_account_age_days / min_post_karma /
// min_comment_karma gates. Silent when subreddit_intel has no row.
function checkEligibility(db, post) {
  let intel;
  try {
    intel = db.prepare('SELECT * FROM subreddit_intel WHERE name = ? COLLATE NOCASE').get(post.subreddit);
  } catch (e) {
    elog.warn('[coordinator] checkEligibility intel lookup failed', { subreddit: post.subreddit, err: e?.message });
    return null;
  }
  if (!intel) return null;
  const acct = db.prepare('SELECT created_at FROM reddit_accounts WHERE id = ?').get(post.account_id);
  const karma = (() => {
    try { return db.prepare('SELECT post_karma, comment_karma FROM karma_snapshots WHERE account_id = ? ORDER BY taken_at DESC LIMIT 1').get(post.account_id); }
    catch { return null; }
  })();
  if (intel.min_account_age_days && acct?.created_at) {
    try {
      const createdMs = new Date(acct.created_at.replace(' ', 'T') + 'Z').getTime();
      if (isNaN(createdMs)) return null;
      const ageDays = Math.floor((Date.now() - createdMs) / 86400000);
      if (ageDays < intel.min_account_age_days) {
        return `Account too young for r/${post.subreddit} (${ageDays}d < ${intel.min_account_age_days}d required)`;
      }
    } catch {}
  }
  if (karma) {
    if (intel.min_post_karma && (karma.post_karma || 0) < intel.min_post_karma) {
      return `Post karma too low for r/${post.subreddit} (${karma.post_karma || 0} < ${intel.min_post_karma} required)`;
    }
    if (intel.min_comment_karma && (karma.comment_karma || 0) < intel.min_comment_karma) {
      return `Comment karma too low for r/${post.subreddit} (${karma.comment_karma || 0} < ${intel.min_comment_karma} required)`;
    }
  }
  return null;
}

// ---------------------------------------------------------------- boosts
async function fireBoostOrder(post, url) {
  const db = getDb();
  try {
    const { decryptSecret } = require('../db');
    const enc = getSetting('upvote_api_key');
    const apiKey = enc ? decryptSecret(enc) : null;
    if (!apiKey) {
      db.prepare("UPDATE scheduled_posts SET boost_status='failed' WHERE id=?").run(post.id);
      return;
    }
    const params = {
      key: apiKey, action: 'add',
      service: String(post.boost_service_id),
      link: url, quantity: String(post.boost_qty),
    };
    if (post.boost_drip_rate === 'fast')        { params.runs = '1'; params.interval = '0'; }
    else if (post.boost_drip_rate === 'medium') { params.runs = '4'; params.interval = '15'; }
    else if (post.boost_drip_rate === 'slow')   { params.runs = '8'; params.interval = '60'; }
    const res = await fetch('https://upvote.biz/api/v1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
    });
    const data = await res.json().catch(() => null);
    const orderId = data && (data.order || data.orderid || data.id);
    if (orderId) {
      db.prepare("UPDATE scheduled_posts SET boost_status='ordered', boost_order_id=? WHERE id=?")
        .run(String(orderId), post.id);
    } else {
      db.prepare("UPDATE scheduled_posts SET boost_status='failed' WHERE id=?").run(post.id);
    }
  } catch (err) {
    elog.warn('[coordinator] fireBoostOrder failed', { post: post?.id, err: err?.message });
    db.prepare("UPDATE scheduled_posts SET boost_status='failed' WHERE id=?").run(post.id);
  }
}

async function runDueBoosts() {
  const db = getDb();
  const due = db.prepare(
    `SELECT * FROM scheduled_posts
      WHERE boost_status='pending'
        AND posted_url IS NOT NULL
        AND boost_fire_at IS NOT NULL
        AND datetime(boost_fire_at) <= datetime('now')
      LIMIT 50`
  ).all();
  for (const post of due) await fireBoostOrder(post, post.posted_url);
}

// ---------------------------------------------------------- proxy auto-test
async function autoTestProxies() {
  try {
    const db = getDb();
    const teamId = getSetting('active_team_id');
    const proxies = teamId
      ? db.prepare('SELECT * FROM proxies WHERE team_id = ?').all(teamId)
      : db.prepare('SELECT * FROM proxies').all();
    if (!proxies.length) return;
    const { net, session } = require('electron');
    const { decryptSecret, credentialVaultGet } = require('../db');
    for (const p of proxies) {
      const partition = `proxy-auto-${p.id}-${Date.now()}`;
      const sess = session.fromPartition(partition);
      const scheme = p.kind === 'socks5' ? 'socks5' : (p.kind === 'https' ? 'https' : 'http');
      await sess.setProxy({ proxyRules: `${scheme}://${p.host}:${p.port}`, proxyBypassRules: '<-loopback>' });
      if (p.username) {
        const pw = credentialVaultGet('proxy_password', p.id) || decryptSecret(p.password_encrypted) || '';
        sess.removeAllListeners('login');
        sess.on('login', (_e, _d, _i, cb) => cb(p.username, pw));
      }
      const result = await new Promise((resolve) => {
        const t = setTimeout(() => { try { req.abort(); } catch {} resolve({ ok: false, error: 'Timed out' }); }, 8000);
        const req = net.request({ method: 'GET', url: 'https://api.ipify.org?format=json', session: sess });
        req.setHeader('User-Agent', 'Oserus/auto-test');
        let body = '';
        req.on('response', (res) => {
          res.on('data', (c) => { body += c.toString(); });
          res.on('end', () => { clearTimeout(t); resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, error: res.statusCode >= 400 ? `HTTP ${res.statusCode}` : null }); });
        });
        req.on('error', (e) => { clearTimeout(t); resolve({ ok: false, error: e.message }); });
        req.end();
      });
      db.prepare(
        "UPDATE proxies SET last_test_ok = ?, last_test_at = datetime('now'), last_test_error = ? WHERE id = ?"
      ).run(result.ok ? 1 : 0, result.ok ? null : (result.error || 'unknown'), p.id);
    }
  } catch (e) {
    elog.warn('[coordinator] autoTestProxies failed', e?.message);
  }
}

// ---------------------------------------------- karma + star-user refresh
async function refreshKarmaSnapshots() {
  const db = getDb();
  let accounts;
  try {
    const teamId = getSetting('active_team_id');
    accounts = db.prepare(
      teamId
        ? "SELECT id, partition_key FROM reddit_accounts WHERE platform = 'reddit' AND status != 'banned' AND team_id = ?"
        : "SELECT id, partition_key FROM reddit_accounts WHERE platform = 'reddit' AND status != 'banned'"
    ).all(...(teamId ? [teamId] : []));
  } catch { return; }
  const { request } = require('./redditSession');
  for (const a of accounts) {
    try {
      const part = `persist:${a.partition_key}`;
      const me = await request(part, 'https://www.reddit.com/api/me.json?raw_json=1');
      const d = me?.data;
      if (!d || !d.name) continue;
      const post_karma = Number(d.link_karma) || 0;
      const comment_karma = Number(d.comment_karma) || 0;
      db.prepare(
        'INSERT INTO karma_snapshots (account_id, post_karma, comment_karma, taken_at) VALUES (?,?,?,datetime(\'now\'))'
      ).run(a.id, post_karma, comment_karma);
      const isStar = !!d.is_employee
        || (d.has_verified_email && (post_karma + comment_karma) >= 10000)
        || (post_karma + comment_karma) >= 50000;
      try { db.prepare('UPDATE reddit_accounts SET starred = ? WHERE id = ?').run(isStar ? 1 : 0, a.id); } catch {}
    } catch {
      // ignore — proxy / rate-limit / not-logged-in; retry next cycle
    }
  }
}

// -------------------------------------------------------------- tick wiring
function tick() {
  if (!isEnabledAll()) return;
  runOnce().catch((e) => elog.warn('[autopilot] tick failed:', e?.message));
}

// Single 10s tick. Each job declares its interval + jitter; we run it
// whenever its next-due time has passed. Consolidates the 7 separate
// setIntervals into one wake-up loop, removes thundering-herd alignment
// at start, and stamps each run with random jitter so traffic doesn't
// pattern on round minute boundaries (a real fingerprint reduction).
const TICK_MS = 10 * 1000;
const jobs = []; // [{ name, intervalMs, jitterMs, nextRun, fn, running }]

function addJob(name, intervalMs, jitterMs, initialDelayMs, fn) {
  jobs.push({
    name,
    intervalMs, jitterMs,
    nextRun: Date.now() + initialDelayMs + Math.floor(Math.random() * jitterMs),
    fn, running: false,
  });
}

async function runJob(job) {
  if (job.running) return;
  job.running = true;
  try { await job.fn(); }
  catch (e) { elog.warn(`[autopilot] job ${job.name} failed:`, e?.message); }
  finally {
    job.running = false;
    job.nextRun = Date.now() + job.intervalMs + Math.floor(Math.random() * job.jitterMs);
  }
}

function start() {
  if (timer) return;
  const mins = Number(getSetting('autopilot_interval_min') || 30);
  const { engagementTick } = require('./engagement');
  const { topicTick } = require('./topicDiscovery');

  jobs.length = 0;
  // intervalMs, jitterMs, initialDelayMs
  addJob('autopilot',     Math.max(5, mins) * 60_000, 60_000,        60_000, () => tick());
  addJob('scheduled',     60_000,                      5_000,        15_000, () => runDueScheduled());
  addJob('boosts',        30_000,                      3_000,        20_000, () => runDueBoosts());
  addJob('proxy-test',    30 * 60_000,                 90_000,       90_000, () => Promise.resolve(autoTestProxies()));
  addJob('karma',         6 * 60 * 60_000,             5 * 60_000, 3 * 60_000, () => refreshKarmaSnapshots());
  addJob('engagement',    4 * 60_000,                  30_000,    2 * 60_000, () => engagementTick());
  addJob('topic',         4 * 60 * 60_000,             10 * 60_000, 5 * 60_000, () => topicTick());
  addJob('remote-gate',   5 * 60_000,                  30_000,        10_000, () => checkRemoteAutopilot());

  loadCircuitState();

  timer = setInterval(() => {
    if (!isEnabledAll()) return;
    const now = Date.now();
    for (const j of jobs) {
      if (!j.running && now >= j.nextRun) runJob(j);
    }
  }, TICK_MS);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
  jobs.length = 0;
}

function status() {
  // Per-job countdowns so the UI can show "Next post in 14m 32s"
  // instead of a static "every 30 min" hint. Reported in seconds —
  // the renderer formats. Negative values mean the job is overdue
  // (running or queued); the UI shows "now" in that case.
  const now = Date.now();
  const nextBy = {};
  for (const j of jobs) {
    nextBy[j.name] = Math.max(0, Math.round((j.nextRun - now) / 1000));
  }
  return {
    enabled: isEnabled(),
    running, lastRun, lastSummary,
    intervalMin: Number(getSetting('autopilot_interval_min') || 30),
    holder: HOLDER,
    platforms: postablePlatforms(),
    nextRunInSec: nextBy,
  };
}

// -------------------------------------------------------- circuit breaker
const failureCounters = new Map();
const CIRCUIT_BREAK_LIMIT = 5;
const CIRCUIT_COOLDOWN_MS = 30 * 60 * 1000;

function trackFailure(accountId, error) {
  const entry = failureCounters.get(accountId) || { count: 0, firstFailure: Date.now(), paused: false };
  entry.count++;
  entry.lastError = error;
  failureCounters.set(accountId, entry);

  if (entry.count >= CIRCUIT_BREAK_LIMIT && !entry.paused) {
    entry.paused = true;

    entry.pausedUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
    elog.warn('[coordinator] Circuit breaker tripped', { accountId, failures: entry.count, cooldown: CIRCUIT_COOLDOWN_MS });
    try { setKv(`circuit_${accountId}`, JSON.stringify({ pausedUntil: entry.pausedUntil, lastError: entry.lastError, count: entry.count })); } catch {}
  }
}

function resetFailure(accountId) {
  failureCounters.delete(accountId);
  try { setKv(`circuit_${accountId}`, ''); } catch {}
}

function isCircuitOpen(accountId) {
  const entry = failureCounters.get(accountId);
  if (!entry || !entry.paused) return false;
  if (Date.now() >= entry.pausedUntil) {
    entry.count = 0;
    entry.paused = false;
    entry.pausedUntil = null;
    failureCounters.set(accountId, entry);
    return false;
  }
  return true;
}

function loadCircuitState() {
  try {
    const db = getDb();
    const rows = db.prepare(
      "SELECT key, value FROM app_kv WHERE key LIKE 'circuit_%'"
    ).all();
    for (const r of rows) {
      try {
        const accountId = Number(r.key.replace('circuit_', ''));
        if (isNaN(accountId)) continue;
        const data = JSON.parse(r.value);
        if (!data || !data.pausedUntil) continue;
        if (Date.now() >= data.pausedUntil) {
          try { setKv(r.key, ''); } catch {}
          continue;
        }
        failureCounters.set(accountId, {
          count: data.count || CIRCUIT_BREAK_LIMIT,
          paused: true,
          pausedUntil: data.pausedUntil,
          lastError: data.lastError || null,
        });
      } catch {}
    }
  } catch {}
}

function getCircuitStatus() {
  const result = [];
  for (const [id, entry] of failureCounters.entries()) {
    if (entry.paused) result.push({ accountId: id, failures: entry.count, pausedUntil: entry.pausedUntil, lastError: entry.lastError });
  }
  return result;
}

module.exports = { start, stop, runOnce, runForAccount, status, HOLDER, trackFailure, resetFailure, isCircuitOpen, getCircuitStatus };
