// Schema registry for the local SQLite cache.
// In the new architecture, local SQLite is a cache populated from
// JWT-authenticated Supabase queries + realtime. No watermark push/pull.
// This file is kept minimal for the cache refresh logic.

const ALL_TABLES = [
  'teams', 'team_members', 'account_assignments', 'machine_sessions', 'post_locks',
  'activity_log', 'post_events', 'content_sources',
];

module.exports = { ALL_TABLES };
