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
      const adapter = getAdapter(platform);
      if (!adapter || !adapter.configured) {
        db.prepare("UPDATE scheduled_posts SET status='failed', error=? WHERE id=?")
          .run(`No adapter for ${platform}`, post.id);
        continue;
      }
      const result = await adapter.submitPost({
        accountId: post.account_id, subreddit: post.subreddit,
        title: post.title, body: post.body, kind: post.kind, url: post.url,
      });
      if (result.ok) {
        db.prepare("UPDATE scheduled_posts SET status='posted', posted_at=datetime('now') WHERE id=?").run(post.id);
        await protocols.recordEvent({
          platform, account_id: post.account_id, profile_id: post.profile_id,
          subreddit: post.subreddit, title: post.title, remote_id: result.id,
          status: 'posted', source: 'scheduled',
        });
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

function tick() {
  if (!isEnabled()) return;
  runOnce().catch(() => {});           // autonomous autopilot only when enabled
}

function start() {
  if (timer) return;
  const mins = Number(getSetting('autopilot_interval_min') || 30);
  timer = setInterval(tick, Math.max(5, mins) * 60 * 1000);
  // Scheduled posts fire on their own ~1-min cadence regardless of autopilot.
  schedTimer = setInterval(() => runDueScheduled().catch(() => {}), 60 * 1000);
  setTimeout(() => runDueScheduled().catch(() => {}), 15 * 1000);
  setTimeout(tick, 60 * 1000);
}

function stop() {
  if (timer) { clearInterval(timer); timer = null; }
  if (schedTimer) { clearInterval(schedTimer); schedTimer = null; }
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
