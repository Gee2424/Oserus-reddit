// Platform-agnostic auto-comment dispatcher.
//
// Each platform whose adapter advertises `capabilities.comment` gets
// its own `runAutoComment(account)`. This module owns the tick that
// decides which account is due, then delegates to the platform's
// adapter for the actual comment generation + post. Reddit's
// implementation lives in services/redditAutoComment.js behind the
// reddit adapter; X/IG/TT/RG are stubs until their transport is wired.

const { getDb } = require('../db');
const { getAdapter, commentablePlatforms } = require('../platforms');

async function autoCommentTick() {
  const db = getDb();

  let rows;
  try {
    rows = db.prepare(
      `SELECT p.account_id, p.comments_per_day, p.last_run_at,
              a.platform, a.status
         FROM auto_comment_protocols p
         JOIN reddit_accounts a ON a.id = p.account_id
        WHERE p.enabled = 1
          AND a.status IN ('warming','ready')`
    ).all();
  } catch { return; }
  if (!rows.length) return;

  // Skip platforms with no comment-capable adapter — defends against a
  // stale protocol row outliving its adapter.
  const okPlatforms = new Set(commentablePlatforms());
  rows = rows.filter((r) => okPlatforms.has(r.platform));
  if (!rows.length) return;

  const nowMs = Date.now();
  const due = rows.filter((r) => {
    const per = Math.max(1, r.comments_per_day || 5);
    const spacingMs = (24 * 60 * 60 * 1000) / per;
    if (!r.last_run_at) return true;
    const lastMs = new Date(r.last_run_at.replace(' ', 'T') + 'Z').getTime();
    return (nowMs - lastMs) >= spacingMs * (0.85 + Math.random() * 0.3);
  });
  if (!due.length) return;

  const pick = due[Math.floor(Math.random() * due.length)];
  const adapter = getAdapter(pick.platform);
  if (!adapter?.runAutoComment) return;

  try {
    const account = db.prepare(
      `SELECT a.id, a.username, a.partition_key, a.profile_id, a.platform, a.status,
              p.name AS profile_name, p.brand_voice
         FROM reddit_accounts a
         JOIN model_profiles p ON p.id = a.profile_id
        WHERE a.id = ?`
    ).get(pick.account_id);
    if (!account) return;
    await adapter.runAutoComment(account, { dryRun: false });
  } catch {
    // tick failures are non-fatal — next cycle retries
  }
}

module.exports = { autoCommentTick };
