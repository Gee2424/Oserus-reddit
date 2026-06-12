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

// Tables that actually sync today. Stripped down from the wider
// 20-table list shipped in 0.81.0 because most of those entries had
// silent schema bugs (composite PKs without delete handling, wide
// local rows vs blob remote rows, TEXT updated_at conflicts with
// the INTEGER trigger) and every push for them was being rejected
// by Supabase with "column X does not exist".
//
// The cut: keep team-critical state (people, models, accounts,
// proxies, autopilot config, scheduled posts, shared lists, roles +
// their permissions, settings) and drop the legacy/rarely-used
// rows (engagement_protocols/auto_comment_protocols replaced by
// autopilot_protocols, posting_protocols superseded, autopilot_prompts
// composite+nullable, content_sources / promo_subreddits / messaging_*
// / schedule_templates / docs).
//
// Each kept table is fully declared in supabase-schema.sql with its
// real column list — no more `(id, data)` placeholders.
const TEAM_SHARED = [
  // The team. Without this, an employee added on machine A never
  // appears anywhere else and can't log in elsewhere.
  { local: 'users',                  remote: 'users',                  pk: 'id',  watermark: 'updated_at' },
  // Model + account + proxy CRUD — the core "what does the team
  // operate" set.
  { local: 'model_profiles',         remote: 'model_profiles',         pk: 'id',  watermark: 'updated_at' },
  { local: 'reddit_accounts',        remote: 'reddit_accounts',        pk: 'id',  watermark: 'updated_at' },
  { local: 'proxies',                remote: 'proxies',                pk: 'id',  watermark: 'updated_at' },
  // Autopilot config per (model, platform). Heaviest single sync
  // because every protocol edit must converge across machines fast.
  { local: 'autopilot_protocols',    remote: 'autopilot_protocols',    pk: 'id',  watermark: 'updated_at' },
  // Scheduled posts. Operators schedule from any machine; every
  // machine running the coordinator needs to see the queue.
  { local: 'scheduled_posts',        remote: 'scheduled_posts',        pk: 'id',  watermark: 'updated_at' },
  // Shared content lists — admins curate, every operator reads.
  { local: 'warmup_subreddits',      remote: 'warmup_subreddits',      pk: 'id',  watermark: 'updated_at' },
  { local: 'homepage_tiles',         remote: 'homepage_tiles',         pk: 'id',  watermark: 'updated_at' },
  // Roles use `key` as PK. role_permissions has a composite PK
  // (role_key, perm_key) — supabase-js accepts the comma-separated
  // form, and supabase.js subscribeRealtime now splits composite
  // PKs for DELETE-event WHERE clauses.
  { local: 'roles',                  remote: 'roles',                  pk: 'key',                  watermark: 'updated_at' },
  { local: 'role_permissions',       remote: 'role_permissions',       pk: 'role_key,perm_key',    watermark: 'updated_at' },
  // App-wide settings (AI keys, autopilot interval, cloud config).
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
