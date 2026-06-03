const { userFromToken } = require('./auth');
const { getDb } = require('../db');
const { runOnce } = require('../services/autoComment');

const DEFAULTS = {
  enabled: 0,
  target_subs_json: '[]',
  comments_per_day: 5,
  session_minutes_min: 4,
  session_minutes_max: 10,
};

function get(accountId) {
  const row = getDb().prepare('SELECT * FROM auto_comment_protocols WHERE account_id = ?').get(accountId);
  return row || { account_id: accountId, ...DEFAULTS, last_run_at: null };
}

function register(ipcMain) {
  ipcMain.handle('autoComment:get', (_e, { token, accountId }) => {
    try {
      if (!userFromToken(token)) throw new Error('Not authenticated');
      return { ok: true, protocol: get(accountId) };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('autoComment:set', (_e, { token, accountId, patch }) => {
    try {
      if (!userFromToken(token)) throw new Error('Not authenticated');
      const cur = get(accountId);
      const next = { ...cur, ...patch };
      if (Array.isArray(next.targetSubs)) next.target_subs_json = JSON.stringify(next.targetSubs);
      getDb().prepare(
        `INSERT INTO auto_comment_protocols
           (account_id, enabled, target_subs_json, comments_per_day, session_minutes_min, session_minutes_max)
         VALUES (@account_id, @enabled, @target_subs_json, @comments_per_day, @session_minutes_min, @session_minutes_max)
         ON CONFLICT(account_id) DO UPDATE SET
           enabled=excluded.enabled,
           target_subs_json=excluded.target_subs_json,
           comments_per_day=excluded.comments_per_day,
           session_minutes_min=excluded.session_minutes_min,
           session_minutes_max=excluded.session_minutes_max`
      ).run({
        account_id: accountId,
        enabled: next.enabled ? 1 : 0,
        target_subs_json: next.target_subs_json || '[]',
        comments_per_day: Number(next.comments_per_day) || 5,
        session_minutes_min: Number(next.session_minutes_min) || 4,
        session_minutes_max: Number(next.session_minutes_max) || 10,
      });
      return { ok: true, protocol: get(accountId) };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('autoComment:runNow', async (_e, { token, accountId, dryRun }) => {
    try {
      if (!userFromToken(token)) throw new Error('Not authenticated');
      return await runOnce(accountId, { dryRun: !!dryRun });
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('autoComment:runs', (_e, { token, accountId, limit }) => {
    try {
      if (!userFromToken(token)) throw new Error('Not authenticated');
      const rows = getDb().prepare(
        `SELECT id, subreddit, post_id, post_title, comment_text, status, error, created_at
           FROM auto_comment_runs
          WHERE account_id = ?
          ORDER BY id DESC
          LIMIT ?`
      ).all(accountId, Math.max(1, Math.min(200, Number(limit) || 20)));
      return { ok: true, runs: rows };
    } catch (err) { return { ok: false, error: err.message }; }
  });
}

module.exports = register;
