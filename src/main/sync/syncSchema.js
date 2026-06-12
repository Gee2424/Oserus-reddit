// Shape of cross-machine sync.
//
// Two kinds of tables get mirrored to Supabase:
//
//   APPEND_ONLY  — never updated in place. Watermark on monotonic `id`.
//                  (activity_log, post_events, auto_comment_runs,
//                  engagement_sessions.)
//
//   TEAM_SHARED  — operators edit them; whoever changes a row should
//                  see the change reflected on every other machine.
//                  Watermark on `updated_at` (epoch millis), maintained
//                  by SQLite triggers that fire on INSERT/UPDATE.
//
// Adding a table to TEAM_SHARED:
//   1) Drop a {table, pk} row in the list below.
//   2) Make sure the matching Supabase table exists with an
//      `updated_at bigint not null default 0` column and is added to
//      the `supabase_realtime` publication. (See supabase-schema.sql.)
//   3) Bump the app version + reinstall — ensureUpdatedAtColumns() runs
//      on next sync start and back-fills the column + triggers.

const APPEND_ONLY = [
  { local: 'activity_log',         remote: 'activity_log',         pk: 'id', watermark: 'id' },
  { local: 'post_events',          remote: 'post_events',          pk: 'id', watermark: 'id' },
  { local: 'auto_comment_runs',    remote: 'auto_comment_runs',    pk: 'id', watermark: 'id' },
  { local: 'engagement_sessions',  remote: 'engagement_sessions',  pk: 'id', watermark: 'id' },
];

const TEAM_SHARED = [
  // The team itself. Without this, creating an employee on machine A
  // never appears on machine B — they show up as "missing user_id" in
  // every other operator's activity feed and can't log in elsewhere.
  // Carries password_hash + last_seen_at + today_seconds so login
  // works AND the presence panel on the dashboard stays accurate
  // across machines.
  { local: 'users',                  remote: 'users',                  pk: 'id',  watermark: 'updated_at' },
  { local: 'model_profiles',         remote: 'model_profiles',         pk: 'id',  watermark: 'updated_at' },
  { local: 'reddit_accounts',        remote: 'reddit_accounts',        pk: 'id',  watermark: 'updated_at' },
  { local: 'proxies',                remote: 'proxies',                pk: 'id',  watermark: 'updated_at' },
  { local: 'posting_protocols',      remote: 'posting_protocols',      pk: 'id',  watermark: 'updated_at' },
  { local: 'autopilot_protocols',    remote: 'autopilot_protocols',    pk: 'id',  watermark: 'updated_at' },
  { local: 'autopilot_prompts',      remote: 'autopilot_prompts',      pk: 'id',  watermark: 'updated_at' },
  { local: 'engagement_protocols',   remote: 'engagement_protocols',   pk: 'id',  watermark: 'updated_at' },
  { local: 'auto_comment_protocols', remote: 'auto_comment_protocols', pk: 'id',  watermark: 'updated_at' },
  { local: 'scheduled_posts',        remote: 'scheduled_posts',        pk: 'id',  watermark: 'updated_at' },
  { local: 'content_sources',        remote: 'content_sources',        pk: 'id',  watermark: 'updated_at' },
  { local: 'warmup_subreddits',      remote: 'warmup_subreddits',      pk: 'id',  watermark: 'updated_at' },
  { local: 'promo_subreddits',       remote: 'promo_subreddits',       pk: 'id',  watermark: 'updated_at' },
  { local: 'messaging_templates',    remote: 'messaging_templates',    pk: 'id',  watermark: 'updated_at' },
  { local: 'messaging_rules',        remote: 'messaging_rules',        pk: 'id',  watermark: 'updated_at' },
  { local: 'homepage_tiles',         remote: 'homepage_tiles',         pk: 'id',  watermark: 'updated_at' },
  { local: 'schedule_templates',     remote: 'schedule_templates',     pk: 'id',  watermark: 'updated_at' },
  { local: 'docs',                   remote: 'docs',                   pk: 'id',  watermark: 'updated_at' },
  { local: 'roles',                  remote: 'roles',                  pk: 'id',  watermark: 'updated_at' },
  { local: 'role_permissions',       remote: 'role_permissions',       pk: 'id',  watermark: 'updated_at' },
  { local: 'settings',               remote: 'settings',               pk: 'key', watermark: 'updated_at' },
];

const ALL_TABLES = [...APPEND_ONLY, ...TEAM_SHARED];

function hasColumn(db, table, column) {
  try {
    return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  } catch {
    return false;
  }
}

function tableExists(db, table) {
  try {
    return !!db.prepare(
      `SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?`
    ).get(table);
  } catch {
    return false;
  }
}

// Adds an `updated_at INTEGER` column (epoch millis) to every
// TEAM_SHARED table that's missing it, plus INSERT/UPDATE triggers that
// auto-bump it on every write. The triggers are guarded with WHEN
// clauses so the inner UPDATE inside the trigger body doesn't recurse.
function ensureUpdatedAtColumns(db) {
  for (const t of TEAM_SHARED) {
    if (!tableExists(db, t.local)) continue;
    if (!hasColumn(db, t.local, 'updated_at')) {
      try {
        db.exec(`ALTER TABLE ${t.local} ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0`);
      } catch (e) {
        // Column may already exist on a partially-migrated db.
        if (!/duplicate column/i.test(e?.message || '')) throw e;
      }
      // Backfill so existing rows are eligible for the next push.
      try {
        db.exec(
          `UPDATE ${t.local} SET updated_at = CAST((julianday('now') - 2440587.5)*86400000 AS INTEGER) WHERE updated_at = 0`
        );
      } catch {}
    }
    try {
      db.exec(`
        CREATE TRIGGER IF NOT EXISTS trg_${t.local}_updated_at_ins
        AFTER INSERT ON ${t.local}
        WHEN NEW.updated_at IS NULL OR NEW.updated_at = 0
        BEGIN
          UPDATE ${t.local}
            SET updated_at = CAST((julianday('now') - 2440587.5)*86400000 AS INTEGER)
            WHERE rowid = NEW.rowid;
        END;

        CREATE TRIGGER IF NOT EXISTS trg_${t.local}_updated_at_upd
        AFTER UPDATE ON ${t.local}
        WHEN NEW.updated_at = OLD.updated_at
        BEGIN
          UPDATE ${t.local}
            SET updated_at = CAST((julianday('now') - 2440587.5)*86400000 AS INTEGER)
            WHERE rowid = NEW.rowid;
        END;
      `);
    } catch {}
  }
}

module.exports = { APPEND_ONLY, TEAM_SHARED, ALL_TABLES, ensureUpdatedAtColumns };
