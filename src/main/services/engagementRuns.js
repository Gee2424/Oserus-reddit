// Saved engagement "runs" — named, reusable presets.
//
// A run carries the same tunables as an autopilot_protocols row (minus
// `enabled`), keyed by its own id so a model can keep a library of them.
// engagement.runSession(accountId, { runId }) merges a run's knobs over the
// model's protocol row for one session; engagementRuns:apply writes a run's
// values into the (profile, platform) protocol row so the background loop
// picks them up.

const { getDb } = require('../db');
const { DEFAULTS: AP_DEFAULTS } = require('./autopilotProtocol');

// The tunable columns a run shares with autopilot_protocols. `runSession`
// iterates this to overlay the run onto the protocol row.
const COLS = [
  'sessions_per_day', 'session_minutes_min', 'session_minutes_max',
  'like_rate_pct', 'follow_rate_pct', 'watch_full_rate_pct', 'comment_rate_pct', 'comment_videos_only',
  'hashtags_json', 'follow_list_json', 'target_filter_json', 'target_subs_json',
  'comment_persona', 'comment_prompt',
  'min_upvote_ratio', 'min_post_score', 'nsfw_only',
  'hours_between_min', 'hours_between_max', 'daily_cap_comments', 'daily_cap_posts',
  'quiet_start', 'quiet_end', 'ai_provider',
];

const DEFAULTS = Object.freeze((() => {
  const { enabled, ...rest } = AP_DEFAULTS;
  return { ...rest, name: 'Untitled run', profile_id: null, platform: null };
})());

function get(id) {
  return getDb().prepare('SELECT * FROM engagement_runs WHERE id = ?').get(id) || null;
}

function list({ profileIds = null, teamId = null } = {}) {
  const where = [];
  const params = [];
  if (teamId) { where.push('(team_id = ? OR team_id IS NULL)'); params.push(teamId); }
  if (Array.isArray(profileIds)) {
    if (!profileIds.length) return getDb().prepare('SELECT * FROM engagement_runs WHERE profile_id IS NULL ORDER BY name').all();
    where.push(`(profile_id IS NULL OR profile_id IN (${profileIds.map(() => '?').join(',')}))`);
    params.push(...profileIds);
  }
  const sql = `SELECT * FROM engagement_runs ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY name`;
  return getDb().prepare(sql).all(...params);
}

function num(v, d, hi = 100) {
  const n = Number(v);
  return Math.max(0, Math.min(hi, Number.isFinite(n) ? n : d));
}

function coerce(patch) {
  const cur = { ...DEFAULTS, ...patch };
  const int = (v, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(0, n) : d; };
  return {
    name: String(cur.name || 'Untitled run').slice(0, 80),
    profile_id: cur.profile_id ? Number(cur.profile_id) : null,
    platform: cur.platform ? String(cur.platform).slice(0, 24) : null,
    sessions_per_day:    Math.max(1, int(cur.sessions_per_day, 3)),
    session_minutes_min: Math.max(1, int(cur.session_minutes_min, 6)),
    session_minutes_max: Math.max(1, int(cur.session_minutes_max, 14)),
    like_rate_pct:       num(cur.like_rate_pct, 18),
    follow_rate_pct:     num(cur.follow_rate_pct, 4),
    watch_full_rate_pct: num(cur.watch_full_rate_pct, 25),
    comment_rate_pct:    num(cur.comment_rate_pct, 0),
    comment_videos_only: cur.comment_videos_only ? 1 : 0,
    hashtags_json:      cur.hashtags_json ?? '[]',
    follow_list_json:   cur.follow_list_json ?? '[]',
    target_filter_json: cur.target_filter_json ?? '{}',
    target_subs_json:   cur.target_subs_json ?? '[]',
    comment_persona:    String(cur.comment_persona || 'curious').slice(0, 40),
    comment_prompt:     cur.comment_prompt || null,
    min_upvote_ratio:   num(cur.min_upvote_ratio, 0, 1),
    min_post_score:     int(cur.min_post_score, 0),
    nsfw_only:          cur.nsfw_only ? 1 : 0,
    hours_between_min:  num(cur.hours_between_min, 0, 1e6),
    hours_between_max:  num(cur.hours_between_max, 0, 1e6),
    daily_cap_comments: int(cur.daily_cap_comments, 0),
    daily_cap_posts:    int(cur.daily_cap_posts, 0),
    quiet_start: cur.quiet_start == null || cur.quiet_start === '' ? null : num(cur.quiet_start, 0, 23),
    quiet_end:   cur.quiet_end == null || cur.quiet_end === '' ? null : num(cur.quiet_end, 0, 23),
    ai_provider: String(cur.ai_provider || 'claude').toLowerCase().slice(0, 16),
  };
}

function upsert(id, patch, { teamId = null, userId = null } = {}) {
  const db = getDb();
  const v = coerce(patch);
  const fields = ['name', 'profile_id', 'platform', ...COLS];
  if (id) {
    const set = fields.map((c) => `${c}=@${c}`).join(', ');
    db.prepare(`UPDATE engagement_runs SET ${set}, updated_at=datetime('now') WHERE id=@id`).run({ ...v, id: Number(id) });
    return get(id);
  }
  const cols = ['team_id', 'created_by_user_id', ...fields];
  const info = db.prepare(
    `INSERT INTO engagement_runs (${cols.join(', ')}) VALUES (${cols.map((c) => `@${c}`).join(', ')})`
  ).run({ ...v, team_id: teamId || null, created_by_user_id: userId || null });
  return get(info.lastInsertRowid);
}

function remove(id) {
  getDb().prepare('DELETE FROM engagement_runs WHERE id = ?').run(id);
}

function markRan(id) {
  getDb().prepare(`UPDATE engagement_runs SET last_run_at = datetime('now') WHERE id = ?`).run(id);
}

module.exports = { DEFAULTS, COLS, get, list, upsert, remove, markRan };
