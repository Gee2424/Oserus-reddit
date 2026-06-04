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
const { getDb } = require('../db');
const protocols = require('./protocols');
const { getAdapter, postablePlatforms } = require('../platforms');
const { getSetting } = require('./settings');

const HOLDER = `${os.hostname()}-${process.pid}`;
let timer = null;
let running = false;
let lastRun = null;
let lastSummary = null;
let engagementTimer = null;
let topicTimer = null;
let schedTimer = null;
let proxyTimer = null;
let boostTimer = null;
let karmaTimer = null;

function isEnabled() { return getSetting('autopilot_enabled') === '1'; }

// --------------------------------------------------------------- candidates
// One query per tick returns every postable account on every configured
// platform, plus the columns the adapter contract needs (status, niche,
// brand voice, proxy_id) so we don't re-query per-account.
function candidateAccounts() {
  const platforms = postablePlatforms();
  if (!platforms.length) return [];
  const placeholders = platforms.map(() => '?').join(',');
  return getDb().prepare(
    `SELECT a.id, a.username, a.status, a.platform, a.profile_id,
            a.proxy_id, a.partition_key,
            p.name AS profile_name, p.niche, p.brand_voice
       FROM reddit_accounts a
       JOIN model_profiles p ON p.id = a.profile_id
      WHERE a.platform IN (${placeholders})
        AND a.status IN ('warming','ready')
      ORDER BY a.platform, a.proxy_id, a.id`
  ).all(...platforms);
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
      // Reddit uses `subreddit`; X / IG / TT use `text` or `caption`.
      // Pass both; adapters take what they need.
      subreddit: gen.target,
      title: gen.title,
      body: gen.body,
      kind: gen.kind,
      url: gen.url,
      text: gen.title,        // X tweet body
      caption: gen.title,     // IG/TT caption
      mediaUrl: gen.url,
    };
    const result = await adapter.submitPost(submitArgs);

    await protocols.recordEvent({
      platform: account.platform,
      account_id: account.id,
      profile_id: account.profile_id,
      subreddit: gen.target,   // legacy column; still useful for non-Reddit as 'target'
      title: gen.title,
      remote_id: result.id || null,
      status: result.ok ? 'posted' : 'failed',
      source: 'auto',
      error: result.ok ? null : result.error,
    });

    if (result.ok) {
      summary.posted++;
    } else {
      summary.failed++;
      summary.errors.push(`${account.platform}/${account.username}: ${result.error}`.slice(0, 200));
    }
  } catch (err) {
    summary.failed++;
    summary.errors.push(`${account.platform}/${account.username}: ${err.message}`.slice(0, 200));
  } finally {
    await protocols.releaseLock(account.platform, account.id);
  }
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
    due = db.prepare(
      `SELECT s.*, a.platform AS platform, a.profile_id AS profile_id
         FROM scheduled_posts s
         JOIN reddit_accounts a ON a.id = s.account_id
        WHERE s.status = 'pending'
          AND s.scheduled_for <= datetime('now')
        ORDER BY s.scheduled_for ASC LIMIT 25`
    ).all();
  } catch { return; }

  for (const post of due) {
    const platform = post.platform || 'reddit';
    if (!(await protocols.acquireLock(platform, post.account_id, HOLDER, 300))) continue;
    try {
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
      const adapter = getAdapter(platform);
      if (!adapter || !adapter.configured) {
        db.prepare("UPDATE scheduled_posts SET status='failed', error=? WHERE id=?")
          .run(`No adapter for ${platform}`, post.id);
        continue;
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
      const result = await adapter.submitPost({
        accountId: post.account_id, subreddit: post.subreddit,
        title, body, kind, url: post.url,
        text: title, caption: title, mediaUrl: post.url,
      });
      if (result.ok) {
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
        db.prepare("UPDATE scheduled_posts SET status='failed', error=? WHERE id=?").run(result.error, post.id);
        await protocols.recordEvent({
          platform, account_id: post.account_id, profile_id: post.profile_id,
          subreddit: post.subreddit, title: post.title,
          status: 'failed', source: 'scheduled', error: result.error,
        });
      }
    } catch (err) {
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
  } catch { return null; }
  if (!intel) return null;
  const acct = db.prepare('SELECT created_at FROM reddit_accounts WHERE id = ?').get(post.account_id);
  const karma = (() => {
    try { return db.prepare('SELECT post_karma, comment_karma FROM karma_snapshots WHERE account_id = ? ORDER BY taken_at DESC LIMIT 1').get(post.account_id); }
    catch { return null; }
  })();
  if (intel.min_account_age_days && acct?.created_at) {
    try {
      const ageDays = Math.floor((Date.now() - new Date(acct.created_at.replace(' ', 'T') + 'Z').getTime()) / 86400000);
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
  } catch {
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
    const proxies = db.prepare('SELECT * FROM proxies').all();
    if (!proxies.length) return;
    const { net, session } = require('electron');
    const { decryptSecret } = require('../db');
    for (const p of proxies) {
      const partition = `proxy-auto-${p.id}-${Date.now()}`;
      const sess = session.fromPartition(partition);
      const scheme = p.kind === 'socks5' ? 'socks5' : (p.kind === 'https' ? 'https' : 'http');
      await sess.setProxy({ proxyRules: `${scheme}://${p.host}:${p.port}`, proxyBypassRules: '<-loopback>' });
      if (p.username) {
        const pw = decryptSecret(p.password_encrypted) || '';
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
  } catch { /* never let proxy testing crash the coordinator */ }
}

// ---------------------------------------------- karma + star-user refresh
async function refreshKarmaSnapshots() {
  const db = getDb();
  let accounts;
  try {
    accounts = db.prepare(
      "SELECT id, partition_key FROM reddit_accounts WHERE platform = 'reddit' AND status != 'banned'"
    ).all();
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
  if (!isEnabled()) return;
  runOnce().catch((e) => elog.warn('[autopilot] tick failed:', e?.message));
}

function start() {
  if (timer) return;
  const mins = Number(getSetting('autopilot_interval_min') || 30);
  timer = setInterval(tick, Math.max(5, mins) * 60 * 1000);
  schedTimer = setInterval(() => runDueScheduled().catch(() => {}), 60 * 1000);
  boostTimer = setInterval(() => runDueBoosts().catch(() => {}), 30 * 1000);
  proxyTimer = setInterval(autoTestProxies, 30 * 60 * 1000);
  karmaTimer = setInterval(() => refreshKarmaSnapshots().catch(() => {}), 6 * 60 * 60 * 1000);

  // Engagement tick now owns commenting too — see services/engagement.js
  // and services/autopilotProtocol.js. The legacy per-platform autoComment
  // dispatcher is gone; Reddit's API-comment path is invoked inline from
  // runSession() when the protocol has comment_rate_pct > 0.
  const { engagementTick } = require('./engagement');
  engagementTimer = setInterval(() => engagementTick().catch(() => {}), 4 * 60 * 1000);
  const { topicTick } = require('./topicDiscovery');
  topicTimer = setInterval(() => topicTick().catch(() => {}), 4 * 60 * 60 * 1000);

  // First-run staging: scheduled near-immediately, the rest spread out
  // so we don't slam the network the second the app starts.
  setTimeout(() => runDueScheduled().catch(() => {}), 15 * 1000);
  setTimeout(autoTestProxies, 90 * 1000);
  setTimeout(() => refreshKarmaSnapshots().catch(() => {}), 3 * 60 * 1000);
  setTimeout(tick, 60 * 1000);
  setTimeout(() => engagementTick().catch(() => {}), 2 * 60 * 1000);
  setTimeout(() => topicTick().catch(() => {}), 5 * 60 * 1000);
}

function stop() {
  for (const t of [timer, schedTimer, proxyTimer, boostTimer, karmaTimer, engagementTimer, topicTimer]) {
    if (t) clearInterval(t);
  }
  timer = schedTimer = proxyTimer = boostTimer = karmaTimer = engagementTimer = topicTimer = null;
}

function status() {
  return {
    enabled: isEnabled(),
    running, lastRun, lastSummary,
    intervalMin: Number(getSetting('autopilot_interval_min') || 30),
    holder: HOLDER,
    platforms: postablePlatforms(),
  };
}

module.exports = { start, stop, runOnce, status, HOLDER };
