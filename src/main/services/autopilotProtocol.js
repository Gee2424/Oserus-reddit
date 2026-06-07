// Unified autopilot protocol service.
//
// One row per (profile_id, platform) in autopilot_protocols owns:
//   • pacing      (sessions/day, session length)
//   • engagement  (like / follow / watch / comment rates)
//   • targeting   (hashtags, follow-list, target-account filter,
//                  Reddit target_subs)
//   • AI persona  (comment_persona + custom comment_prompt)
//
// Replaces the per-account engagement_protocols + auto_comment_protocols
// pair so the operator picks a model, picks a platform, and edits one
// thing instead of touching N account rows for the same profile.

const { getDb } = require('../db');

const PERSONA_PROMPTS = {
  playful:
    'You react to the video like a real viewer in a playful, lightly teasing way. ' +
    'One short line. No hashtags. Zero or one emoji max. React to a specific detail ' +
    'in the caption — never generic ("love this"). Never promotional, never about ' +
    'another platform.',
  curious:
    'You react to the video like a real viewer who is genuinely curious — ask a ' +
    'single short question or note a specific detail. No hashtags, no emoji spam, ' +
    'no filler. Never promotional, never about another platform.',
  flirty:
    'You react to the video like a real viewer with a light, flirty tone — confident, ' +
    'not crude. One short line. No hashtags. Zero or one emoji max. React to ' +
    'something specific in the caption. Never promotional, never about another platform.',
  dry:
    'You react to the video like a real viewer with a dry, deadpan tone. One short ' +
    'line. No hashtags, no emoji. React to something specific in the caption. ' +
    'Never promotional, never about another platform.',
};

const DEFAULTS = Object.freeze({
  enabled: 0,
  sessions_per_day: 3,
  session_minutes_min: 6,
  session_minutes_max: 14,
  like_rate_pct: 18,
  follow_rate_pct: 4,
  watch_full_rate_pct: 25,
  comment_rate_pct: 0,
  comment_videos_only: 1,
  hashtags_json: '[]',
  follow_list_json: '[]',
  target_filter_json: '{}',
  target_subs_json: '[]',
  comment_persona: 'curious',
  comment_prompt: null,
  min_upvote_ratio: 0,
  min_post_score: 0,
  nsfw_only: 0,
  hours_between_min: 0,
  hours_between_max: 0,
  daily_cap_comments: 0,
  daily_cap_posts: 0,
  quiet_start: null,
  quiet_end: null,
  ai_provider: 'claude',
});

function rowFor(profileId, platform) {
  const row = getDb().prepare(
    `SELECT * FROM autopilot_protocols WHERE profile_id = ? AND platform = ?`
  ).get(profileId, platform);
  return row || { profile_id: profileId, platform, ...DEFAULTS, last_run_at: null };
}

function listForProfile(profileId) {
  return getDb().prepare(
    `SELECT * FROM autopilot_protocols WHERE profile_id = ? ORDER BY platform`
  ).all(profileId);
}

function upsert(profileId, platform, patch) {
  const cur = rowFor(profileId, platform);
  const next = { ...cur, ...patch };
  const norm = (v, d) => Math.max(0, Math.min(100, Number(v) ?? d));
  const params = {
    profile_id: profileId,
    platform,
    enabled: next.enabled ? 1 : 0,
    sessions_per_day:    Math.max(1, Number(next.sessions_per_day) || 3),
    session_minutes_min: Math.max(1, Number(next.session_minutes_min) || 6),
    session_minutes_max: Math.max(1, Number(next.session_minutes_max) || 14),
    like_rate_pct:        norm(next.like_rate_pct, 18),
    follow_rate_pct:      norm(next.follow_rate_pct, 4),
    watch_full_rate_pct:  norm(next.watch_full_rate_pct, 25),
    comment_rate_pct:     norm(next.comment_rate_pct, 0),
    comment_videos_only:  next.comment_videos_only ? 1 : 0,
    hashtags_json:    next.hashtags_json    ?? '[]',
    follow_list_json: next.follow_list_json ?? '[]',
    target_filter_json: next.target_filter_json ?? '{}',
    target_subs_json:   next.target_subs_json   ?? '[]',
    comment_persona:    String(next.comment_persona || 'curious').slice(0, 40),
    comment_prompt:     next.comment_prompt || null,
    min_upvote_ratio:   Math.max(0, Math.min(1, Number(next.min_upvote_ratio) || 0)),
    min_post_score:     Math.max(0, Number(next.min_post_score) || 0),
    nsfw_only:          next.nsfw_only ? 1 : 0,
    hours_between_min:  Math.max(0, Number(next.hours_between_min) || 0),
    hours_between_max:  Math.max(0, Number(next.hours_between_max) || 0),
    daily_cap_comments: Math.max(0, Number(next.daily_cap_comments) || 0),
    daily_cap_posts:    Math.max(0, Number(next.daily_cap_posts) || 0),
    quiet_start:        next.quiet_start === null || next.quiet_start === '' || next.quiet_start == null ? null : Math.max(0, Math.min(23, Number(next.quiet_start))),
    quiet_end:          next.quiet_end === null || next.quiet_end === '' || next.quiet_end == null ? null : Math.max(0, Math.min(23, Number(next.quiet_end))),
    ai_provider:        String(next.ai_provider || 'claude').toLowerCase().slice(0, 16),
  };
  getDb().prepare(
    `INSERT INTO autopilot_protocols
       (profile_id, platform, enabled,
        sessions_per_day, session_minutes_min, session_minutes_max,
        like_rate_pct, follow_rate_pct, watch_full_rate_pct,
        comment_rate_pct, comment_videos_only,
        hashtags_json, follow_list_json, target_filter_json, target_subs_json,
        comment_persona, comment_prompt,
        min_upvote_ratio, min_post_score, nsfw_only,
        hours_between_min, hours_between_max,
        daily_cap_comments, daily_cap_posts,
        quiet_start, quiet_end, ai_provider,
        updated_at)
     VALUES (@profile_id, @platform, @enabled,
             @sessions_per_day, @session_minutes_min, @session_minutes_max,
             @like_rate_pct, @follow_rate_pct, @watch_full_rate_pct,
             @comment_rate_pct, @comment_videos_only,
             @hashtags_json, @follow_list_json, @target_filter_json, @target_subs_json,
             @comment_persona, @comment_prompt,
             @min_upvote_ratio, @min_post_score, @nsfw_only,
             @hours_between_min, @hours_between_max,
             @daily_cap_comments, @daily_cap_posts,
             @quiet_start, @quiet_end, @ai_provider,
             datetime('now'))
     ON CONFLICT(profile_id, platform) DO UPDATE SET
       enabled=excluded.enabled,
       sessions_per_day=excluded.sessions_per_day,
       session_minutes_min=excluded.session_minutes_min,
       session_minutes_max=excluded.session_minutes_max,
       like_rate_pct=excluded.like_rate_pct,
       follow_rate_pct=excluded.follow_rate_pct,
       watch_full_rate_pct=excluded.watch_full_rate_pct,
       comment_rate_pct=excluded.comment_rate_pct,
       comment_videos_only=excluded.comment_videos_only,
       hashtags_json=excluded.hashtags_json,
       follow_list_json=excluded.follow_list_json,
       target_filter_json=excluded.target_filter_json,
       target_subs_json=excluded.target_subs_json,
       comment_persona=excluded.comment_persona,
       comment_prompt=excluded.comment_prompt,
       min_upvote_ratio=excluded.min_upvote_ratio,
       min_post_score=excluded.min_post_score,
       nsfw_only=excluded.nsfw_only,
       hours_between_min=excluded.hours_between_min,
       hours_between_max=excluded.hours_between_max,
       daily_cap_comments=excluded.daily_cap_comments,
       daily_cap_posts=excluded.daily_cap_posts,
       quiet_start=excluded.quiet_start,
       quiet_end=excluded.quiet_end,
       ai_provider=excluded.ai_provider,
       updated_at=datetime('now')`
  ).run(params);
  return rowFor(profileId, platform);
}

function markRan(profileId, platform) {
  getDb().prepare(
    `UPDATE autopilot_protocols SET last_run_at = datetime('now')
      WHERE profile_id = ? AND platform = ?`
  ).run(profileId, platform);
}

// Resolve the AI system prompt for a comment given the protocol row.
// 'custom' falls back to the default playful tone if the user picked
// custom but left the prompt empty.
function buildCommentPrompt(proto) {
  const persona = (proto.comment_persona || 'curious').toLowerCase();
  if (persona === 'custom' && proto.comment_prompt) return proto.comment_prompt;
  return PERSONA_PROMPTS[persona] || PERSONA_PROMPTS.curious;
}

// Decide whether a target post passes the protocol's target_filter.
// Filter shape: { min_followers, max_followers, verified_only,
//                 exclude_keywords: ['onlyfans','fansly',...] }
// Returns true when no filter is set, when fields are missing (we
// don't know enough to reject), or when the candidate matches.
function passesTargetFilter(proto, candidate) {
  let f = {};
  try { f = JSON.parse(proto.target_filter_json || '{}'); } catch {}
  if (!f || typeof f !== 'object') return true;
  if (f.verified_only && !candidate.verified) return false;
  if (typeof f.min_followers === 'number' &&
      typeof candidate.followers === 'number' &&
      candidate.followers < f.min_followers) return false;
  if (typeof f.max_followers === 'number' &&
      typeof candidate.followers === 'number' &&
      candidate.followers > f.max_followers) return false;
  if (Array.isArray(f.exclude_keywords) && candidate.caption) {
    const c = String(candidate.caption).toLowerCase();
    for (const kw of f.exclude_keywords) {
      if (kw && c.includes(String(kw).toLowerCase())) return false;
    }
  }
  return true;
}

module.exports = {
  DEFAULTS, PERSONA_PROMPTS,
  rowFor, listForProfile, upsert, markRan,
  buildCommentPrompt, passesTargetFilter,
};
