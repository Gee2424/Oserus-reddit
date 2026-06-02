// IPC for the human-like engagement protocols (IG / TikTok / X / Reddit /
// RedGIFs). The renderer reads + writes per-account knobs here and can kick
// a session manually for testing.
const { userFromToken } = require('./auth');
const { getDb } = require('../db');
const { runSession } = require('../services/engagement');

const DEFAULTS = {
  enabled: 0,
  sessions_per_day: 3,
  session_minutes_min: 6,
  session_minutes_max: 14,
  like_rate_pct: 18,
  follow_rate_pct: 4,
  watch_full_rate_pct: 25,
  hashtags_json: '[]',
  follow_list_json: '[]',
};

function get(accountId) {
  const row = getDb().prepare('SELECT * FROM engagement_protocols WHERE account_id = ?').get(accountId);
  return row || { account_id: accountId, ...DEFAULTS, last_run_at: null };
}

function register(ipcMain) {
  ipcMain.handle('engagement:get', (_e, { token, accountId }) => {
    try {
      if (!userFromToken(token)) throw new Error('Not authenticated');
      return { ok: true, protocol: get(accountId) };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('engagement:set', (_e, { token, accountId, patch }) => {
    try {
      if (!userFromToken(token)) throw new Error('Not authenticated');
      const cur = get(accountId);
      const next = { ...cur, ...patch };
      // Coerce list inputs to JSON strings.
      const norm = (k) => {
        if (Array.isArray(next[k])) next[k + '_json'] = JSON.stringify(next[k]);
      };
      norm('hashtags'); norm('follow_list');
      getDb().prepare(
        `INSERT INTO engagement_protocols
           (account_id, enabled, sessions_per_day, session_minutes_min, session_minutes_max,
            like_rate_pct, follow_rate_pct, watch_full_rate_pct, hashtags_json, follow_list_json)
         VALUES (@account_id, @enabled, @sessions_per_day, @session_minutes_min, @session_minutes_max,
                 @like_rate_pct, @follow_rate_pct, @watch_full_rate_pct, @hashtags_json, @follow_list_json)
         ON CONFLICT(account_id) DO UPDATE SET
           enabled=excluded.enabled,
           sessions_per_day=excluded.sessions_per_day,
           session_minutes_min=excluded.session_minutes_min,
           session_minutes_max=excluded.session_minutes_max,
           like_rate_pct=excluded.like_rate_pct,
           follow_rate_pct=excluded.follow_rate_pct,
           watch_full_rate_pct=excluded.watch_full_rate_pct,
           hashtags_json=excluded.hashtags_json,
           follow_list_json=excluded.follow_list_json`
      ).run({
        account_id: accountId,
        enabled: next.enabled ? 1 : 0,
        sessions_per_day: Number(next.sessions_per_day) || 3,
        session_minutes_min: Number(next.session_minutes_min) || 6,
        session_minutes_max: Number(next.session_minutes_max) || 14,
        like_rate_pct: Number(next.like_rate_pct) || 18,
        follow_rate_pct: Number(next.follow_rate_pct) || 4,
        watch_full_rate_pct: Number(next.watch_full_rate_pct) || 25,
        hashtags_json: next.hashtags_json || '[]',
        follow_list_json: next.follow_list_json || '[]',
      });
      return { ok: true, protocol: get(accountId) };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('engagement:runNow', async (_e, { token, accountId, dryRun }) => {
    try {
      if (!userFromToken(token)) throw new Error('Not authenticated');
      const res = await runSession(accountId, { dryRun: !!dryRun });
      return res;
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('engagement:sessions', (_e, { token, accountId, limit }) => {
    try {
      if (!userFromToken(token)) throw new Error('Not authenticated');
      const rows = getDb().prepare(
        `SELECT id, platform, started_at, ended_at, seconds, posts_seen, likes, follows, error
           FROM engagement_sessions
          WHERE account_id = ?
          ORDER BY id DESC
          LIMIT ?`
      ).all(accountId, Math.max(1, Math.min(200, Number(limit) || 20)));
      return { ok: true, sessions: rows };
    } catch (err) { return { ok: false, error: err.message }; }
  });
}

module.exports = register;
