// Local posting coordinator.
//
// Runs inside the main process on a timer while the app is open. On each tick
// it walks every eligible account (system-level, not filtered by who is logged
// in), and for each:
//   1. checks the protocol eligibility (gaps, breaks, caps, quiet hours)
//   2. tries to claim a TTL lock so two passes / machines don't double-post
//   3. generates content with Claude, submits via the platform adapter
//   4. records the event and releases the lock
//
// "Offline" coordination across VAs requires a shared DB; today the lock +
// events live in local SQLite, so dedup is currently per-machine. The code is
// written so pointing protocols.js at a shared backend later turns this into
// true cross-VA coordination with no changes here.
//
// Everything is OFF until an admin enables a protocol AND turns the
// coordinator on (autopilot_enabled setting). Safe by default.

const os = require('os');
const { getDb } = require('../db');
const protocols = require('./protocols');
const { getAdapter } = require('../platforms');
const { generatePost } = require('./postgen');
const { getSetting } = require('./settings');

const HOLDER = `${os.hostname()}-${process.pid}`;
let timer = null;
let running = false;
let lastRun = null;
let lastSummary = null;
let engagementTimer = null;
let topicTimer = null;
let autoCommentTimer = null;

function isEnabled() {
  return getSetting('autopilot_enabled') === '1';
}

// Pull eligible reddit accounts (warming or ready, not banned/paused).
function candidateAccounts() {
  return getDb().prepare(
    `SELECT a.id, a.username, a.status, a.profile_id, p.name AS profile_name, p.niche, p.brand_voice
     FROM reddit_accounts a
     JOIN model_profiles p ON p.id = a.profile_id
     WHERE a.platform = 'reddit' AND a.status IN ('warming','ready')
     ORDER BY a.id`
  ).all();
}

async function generatePostFor(account) {
  // Reuse the AI service's post generator. Warming accounts → SFW warm-up
  // content from the global warm-up subs; ready accounts → promo.
  const mode = account.status === 'ready' ? 'nsfw' : 'sfw';
  const res = await generatePost({ accountId: account.id, mode });
  if (!res.ok || !res.suggestions || !res.suggestions.length) return null;
  const pick = res.suggestions[0];
  return {
    subreddit: pick.subreddit,
    title: pick.title,
    body: pick.body || '',
    kind: pick.kind || 'self',
  };
}

async function runOnce({ dryRun = false } = {}) {
  if (running) return lastSummary || { ok: false, error: 'Already running' };
  running = true;
  const summary = { startedAt: new Date().toISOString(), posted: 0, skipped: 0, failed: 0, details: [] };
  try {
    const accounts = candidateAccounts();
    for (const acct of accounts) {
      // Shared eligibility consults the coordination log (cross-machine when
      // Supabase is active) so we don't repeat what another VA just posted.
      const elig = await protocols.checkEligibilityShared({
        platform: 'reddit', accountId: acct.id, profileId: acct.profile_id,
      });
      if (!elig.eligible) {
        summary.skipped++;
        summary.details.push({ account: acct.username, action: 'skip', reason: elig.reason });
        continue;
      }

      if (dryRun) {
        summary.details.push({ account: acct.username, action: 'would-post', reason: elig.reason });
        continue;
      }

      // Claim lock (TTL) so concurrent passes/machines don't double-post.
      const ttl = Number(getSetting('autopilot_lock_ttl') || 300);
      if (!(await protocols.acquireLock('reddit', acct.id, HOLDER, ttl))) {
        summary.skipped++;
        summary.details.push({ account: acct.username, action: 'skip', reason: 'Locked by another pass/machine' });
        continue;
      }

      try {
        const content = await generatePostFor(acct);
        if (!content || !content.subreddit || !content.title) {
          summary.skipped++;
          summary.details.push({ account: acct.username, action: 'skip', reason: 'No content generated (check warm-up subs / API key)' });
          await protocols.releaseLock('reddit', acct.id);
          continue;
        }

        const adapter = getAdapter('reddit');
        const result = await adapter.submitPost({
          accountId: acct.id,
          subreddit: content.subreddit,
          title: content.title,
          body: content.body,
          kind: content.kind,
        });

        if (result.ok) {
          await protocols.recordEvent({
            platform: 'reddit', account_id: acct.id, profile_id: acct.profile_id,
            subreddit: content.subreddit, title: content.title, remote_id: result.id,
            status: 'posted', source: 'auto',
          });
          summary.posted++;
          summary.details.push({ account: acct.username, action: 'posted', subreddit: content.subreddit, title: content.title });
        } else {
          await protocols.recordEvent({
            platform: 'reddit', account_id: acct.id, profile_id: acct.profile_id,
            subreddit: content.subreddit, title: content.title,
            status: 'failed', source: 'auto', error: result.error,
          });
          summary.failed++;
          summary.details.push({ account: acct.username, action: 'failed', reason: result.error });
        }
      } catch (err) {
        summary.failed++;
        summary.details.push({ account: acct.username, action: 'failed', reason: err.message });
      } finally {
        await protocols.releaseLock('reddit', acct.id);
      }
    }
  } catch (err) {
    summary.error = err.message;
  } finally {
    running = false;
    lastRun = new Date().toISOString();
    lastSummary = summary;
  }
  return summary;
}

// Fire any scheduled posts that are due. Runs every tick regardless of the
// autopilot master switch — a scheduled post is an explicit user action, not
// autonomous posting. Honors the post_locks TTL so it can't race the
// autopilot pass for the same account.
async function runDueScheduled() {
  const db = getDb();
  db.exec(`CREATE TABLE IF NOT EXISTS scheduled_posts (id INTEGER PRIMARY KEY AUTOINCREMENT);`);
  let due;
  try {
    due = db.prepare(
      `SELECT s.*, a.platform AS platform, a.profile_id AS profile_id
       FROM scheduled_posts s
       JOIN reddit_accounts a ON a.id = s.account_id
       WHERE s.status = 'pending' AND s.scheduled_for <= datetime('now')
       ORDER BY s.scheduled_for ASC LIMIT 25`
    ).all();
  } catch {
    return; // table shape not ready yet
  }
  for (const post of due) {
    const platform = post.platform || 'reddit';
    if (!(await protocols.acquireLock(platform, post.account_id, HOLDER, 300))) continue;
    try {
      // Eligibility pre-check — if we have cached subreddit_intel for this
      // sub and the account fails its minimum age / karma gates, fail the
      // post early with a clear reason instead of letting Reddit reject it.
      // Only runs for Reddit (other platforms don't have intel rows yet).
      if (platform === 'reddit') {
        const fail = checkEligibility(db, post);
        if (fail) {
          db.prepare("UPDATE scheduled_posts SET status='failed', error=? WHERE id=?").run(fail, post.id);
          await protocols.recordEvent({
            platform, account_id: post.account_id, profile_id: post.profile_id,
            subreddit: post.subreddit, title: post.title,
            status: 'failed', source: 'scheduled', error: fail,
          });
          await protocols.releaseLock(platform, post.account_id);
          continue;
        }
      }
      const adapter = getAdapter(platform);
      if (!adapter || !adapter.configured) {
        db.prepare("UPDATE scheduled_posts SET status='failed', error=? WHERE id=?")
          .run(`No adapter for ${platform}`, post.id);
        continue;
      }
      // Template-generated rows hold an empty title — fill it from Grok
      // just before posting using the account's mode (warming = SFW).
      let title = post.title || '';
      let body = post.body || '';
      let kind = post.kind || 'self';
      if (post.auto_generate && !title) {
        try {
          const g = await generatePost({ accountId: post.account_id, mode: 'sfw', targetSubreddit: post.subreddit });
          const pick = (g.suggestions || [])[0];
          if (pick) {
            title = pick.title || '';
            if (pick.body) body = pick.body;
            if (pick.kind) kind = pick.kind;
            // persist for the events feed / audit
            db.prepare("UPDATE scheduled_posts SET title=?, body=?, kind=? WHERE id=?")
              .run(title, body, kind, post.id);
          }
        } catch (e) {
          db.prepare("UPDATE scheduled_posts SET status='failed', error=? WHERE id=?")
            .run(`Auto-gen failed: ${e.message}`, post.id);
          await protocols.releaseLock(platform, post.account_id);
          continue;
        }
        if (!title) {
          db.prepare("UPDATE scheduled_posts SET status='failed', error=? WHERE id=?")
            .run('Auto-gen returned no title', post.id);
          await protocols.releaseLock(platform, post.account_id);
          continue;
        }
      }
      const result = await adapter.submitPost({
        accountId: post.account_id, subreddit: post.subreddit,
        title, body, kind, url: post.url,
      });
      if (result.ok) {
        db.prepare("UPDATE scheduled_posts SET status='posted', posted_at=datetime('now') WHERE id=?").run(post.id);
        await protocols.recordEvent({
          platform, account_id: post.account_id, profile_id: post.profile_id,
          subreddit: post.subreddit, title: post.title, remote_id: result.id,
          status: 'posted', source: 'scheduled',
        });
        // Persist the post URL so deferred boost orders have it later, and
        // either fire immediately (delay=0) or stage the boost for the
        // runDueBoosts ticker to pick up at boost_fire_at.
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

let schedTimer = null;
let proxyTimer = null;

function tick() {
  if (!isEnabled()) return;
  runOnce().catch(() => {});           // autonomous autopilot only when enabled
}

// Cheap proxy auto-test pass. Walks every proxy, pings it through a
// throwaway session, persists ok/error on the row. Runs every 30 minutes
// while the app is open so the Dashboard's PROXY ISSUE pills stay current
// without a VA having to click "Test Proxies".
async function autoTestProxies() {
  try {
    const proxiesIpc = require('../ipc/proxies');
    const db = getDb();
    const proxies = db.prepare('SELECT * FROM proxies').all();
    if (!proxies.length) return;
    // The real test function is private to the IPC module; we replicate the
    // single-row test via the registered IPC handler-like flow. Keep it
    // simple: trigger via stored prepared SQL after a fetch through Electron
    // net. We re-use the exact code path by lazy-requiring electron here.
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

// Send a single upvote.biz order. Stamps boost_status + boost_order_id on the
// post row regardless of outcome so the UI can display it. Drip rate is sent
// as `runs`/`interval` when the provider exposes those, otherwise it's a
// harmless extra parameter.
// Returns null if the post should fire, otherwise a human-readable reason
// string. Pulls the latest karma snapshot + account row + cached subreddit
// intel and checks min_account_age_days / min_post_karma / min_comment_karma
// gates. Silent when subreddit_intel has no row for this sub.
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
  if (intel.min_account_age_days && acct && acct.created_at) {
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

async function fireBoostOrder(post, url) {
  const db = getDb();
  try {
    const { getSetting } = require('./settings');
    const { decryptSecret } = require('../db');
    const enc = getSetting('upvote_biz_api_key');
    const apiKey = enc ? decryptSecret(enc) : null;
    if (!apiKey) {
      db.prepare("UPDATE scheduled_posts SET boost_status='failed' WHERE id=?").run(post.id);
      return;
    }
    const params = {
      key: apiKey, action: 'add',
      service: String(post.boost_service_id),
      link: url,
      quantity: String(post.boost_qty),
    };
    // Map drip rate to provider drip parameters (runs/interval). Conservative
    // defaults — provider ignores them when unsupported.
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
  for (const post of due) {
    await fireBoostOrder(post, post.posted_url);
  }
}

let boostTimer = null;
let karmaTimer = null;

// Daily-ish karma + star-user refresh. For each Reddit account, pulls
// /api/me.json through its session partition and writes a karma_snapshots
// row plus updates the starred flag based on Reddit's is_employee /
// has_verified_email + a karma threshold. Best-effort; failures per-account
// don't stop the loop.
async function refreshKarmaSnapshots() {
  const db = getDb();
  let accounts;
  try {
    accounts = db.prepare(
      "SELECT id, partition_key FROM reddit_accounts WHERE platform = 'reddit' AND status != 'banned'"
    ).all();
  } catch { return; }
  const { partitionFor, request } = require('./redditSession');
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
      // Star User heuristic — Reddit doesn't expose the flair directly, so
      // we approximate: employee, verified email + 10k combined karma, or
      // very high karma alone gets the star.
      const isStar = !!d.is_employee
        || (d.has_verified_email && (post_karma + comment_karma) >= 10000)
        || (post_karma + comment_karma) >= 50000;
      try { db.prepare('UPDATE reddit_accounts SET starred = ? WHERE id = ?').run(isStar ? 1 : 0, a.id); } catch {}
    } catch {
      // ignore — proxy / rate-limit / not-logged-in; retry next cycle
    }
  }
}

function start() {
  if (timer) return;
  const mins = Number(getSetting('autopilot_interval_min') || 30);
  timer = setInterval(tick, Math.max(5, mins) * 60 * 1000);
  // Scheduled posts fire on their own ~1-min cadence regardless of autopilot.
  schedTimer = setInterval(() => runDueScheduled().catch(() => {}), 60 * 1000);
  // Deferred boost orders — every 30s so a 5-min delay still fires near on-time.
  boostTimer = setInterval(() => runDueBoosts().catch(() => {}), 30 * 1000);
  // Proxy health check every 30 min.
  proxyTimer = setInterval(autoTestProxies, 30 * 60 * 1000);
  // Karma + Star User refresh every 6 hours. First run 3 min after boot.
  karmaTimer = setInterval(() => refreshKarmaSnapshots().catch(() => {}), 6 * 60 * 60 * 1000);
  // Engagement (IG/TikTok/X/Reddit) — checks for due protocols every 4 min.
  // Each enabled protocol gets sessions_per_day runs spaced through the day.
  const { engagementTick } = require('./engagement');
  engagementTimer = setInterval(() => engagementTick().catch(() => {}), 4 * 60 * 1000);
  // Reddit topic discovery — pulls /hot from each model's promo subs every 4h.
  const { topicTick } = require('./topicDiscovery');
  topicTimer = setInterval(() => topicTick().catch(() => {}), 4 * 60 * 60 * 1000);
  // Auto-comment loop: picks one due account every 3 min, reads a sub +
  // post + top comments, drafts a reply via the AI provider seeded with
  // account_example_comments, posts via /api/comment.
  const { autoCommentTick } = require('./autoComment');
  autoCommentTimer = setInterval(() => autoCommentTick().catch(() => {}), 3 * 60 * 1000);
  setTimeout(() => runDueScheduled().catch(() => {}), 15 * 1000);
  setTimeout(autoTestProxies, 90 * 1000); // first run a bit after boot
  setTimeout(() => refreshKarmaSnapshots().catch(() => {}), 3 * 60 * 1000);
  setTimeout(tick, 60 * 1000);
  setTimeout(() => engagementTick().catch(() => {}), 2 * 60 * 1000);
  setTimeout(() => topicTick().catch(() => {}), 5 * 60 * 1000);
  setTimeout(() => autoCommentTick().catch(() => {}), 4 * 60 * 1000);
}

function stop() {
  if (timer) { clearInterval(timer); timer = null; }
  if (schedTimer) { clearInterval(schedTimer); schedTimer = null; }
  if (proxyTimer) { clearInterval(proxyTimer); proxyTimer = null; }
  if (boostTimer) { clearInterval(boostTimer); boostTimer = null; }
  if (karmaTimer) { clearInterval(karmaTimer); karmaTimer = null; }
  if (engagementTimer) { clearInterval(engagementTimer); engagementTimer = null; }
  if (topicTimer) { clearInterval(topicTimer); topicTimer = null; }
  if (autoCommentTimer) { clearInterval(autoCommentTimer); autoCommentTimer = null; }
}

function status() {
  return {
    enabled: isEnabled(),
    running,
    lastRun,
    lastSummary,
    intervalMin: Number(getSetting('autopilot_interval_min') || 30),
    holder: HOLDER,
  };
}

module.exports = { start, stop, runOnce, status, HOLDER };
