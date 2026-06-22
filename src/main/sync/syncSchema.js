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
  // The team itself.
  { local: 'users',                  remote: 'users',                  pk: 'id',         watermark: 'updated_at' },
  // Model + account + proxy CRUD.
  { local: 'model_profiles',         remote: 'model_profiles',         pk: 'id',         watermark: 'updated_at' },
  { local: 'reddit_accounts',        remote: 'reddit_accounts',        pk: 'id',         watermark: 'updated_at', required: ['profile_id', 'platform', 'username', 'partition_key', 'status'] },
  { local: 'proxies',                remote: 'proxies',                pk: 'id',         watermark: 'updated_at' },
  // Autopilot config per (model, platform).
  { local: 'autopilot_protocols',    remote: 'autopilot_protocols',    pk: 'id',         watermark: 'updated_at' },
  // Engagement / auto-comment protocols are per-account legacy rows
  // with account_id as their primary key (one row per account, no
  // surrogate id). Sync upserts on account_id.
  { local: 'engagement_protocols',   remote: 'engagement_protocols',   pk: 'account_id', watermark: 'updated_at' },
  { local: 'auto_comment_protocols', remote: 'auto_comment_protocols', pk: 'account_id', watermark: 'updated_at' },
  // Posting protocol (older config layer); still consulted in some
  // codepaths.
  { local: 'posting_protocols',      remote: 'posting_protocols',      pk: 'id',         watermark: 'updated_at' },
  // Scheduled posts.
  { local: 'scheduled_posts',        remote: 'scheduled_posts',        pk: 'id',         watermark: 'updated_at' },
  // Shared content lists.
  { local: 'content_sources',        remote: 'content_sources',        pk: 'id',         watermark: 'updated_at' },
  { local: 'warmup_subreddits',      remote: 'warmup_subreddits',      pk: 'id',         watermark: 'updated_at' },
  { local: 'promo_subreddits',       remote: 'promo_subreddits',       pk: 'id',         watermark: 'updated_at' },
  { local: 'homepage_tiles',         remote: 'homepage_tiles',         pk: 'id',         watermark: 'updated_at' },
  // Messaging.
  { local: 'messaging_templates',    remote: 'messaging_templates',    pk: 'id',         watermark: 'updated_at' },
  { local: 'messaging_rules',        remote: 'messaging_rules',        pk: 'id',         watermark: 'updated_at' },
  // Scheduling templates.
  { local: 'schedule_templates',     remote: 'schedule_templates',     pk: 'id',         watermark: 'updated_at' },
  // Docs.
  { local: 'docs',                   remote: 'docs',                   pk: 'id',         watermark: 'updated_at' },
  // Roles & permissions (composite PK on role_permissions).
  { local: 'roles',                  remote: 'roles',                  pk: 'key',                  watermark: 'updated_at' },
  { local: 'role_permissions',       remote: 'role_permissions',       pk: 'role_key,perm_key',    watermark: 'updated_at' },
  // App-wide settings.
  { local: 'settings',               remote: 'settings',               pk: 'key',        watermark: 'updated_at' },
];

// Not synced (yet):
//   autopilot_prompts — uses composite PK (job, profile_id) where
//   profile_id is NULL for global prompts. Postgres composite UNIQUE
//   doesn't treat NULLs as equal so onConflict-by-composite mis-resolves
//   and inserts duplicates instead of upserting. Would need a synthetic
//   id column or a coercion layer to fix; deferred.

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

function columnInfo(db, table, column) {
  try {
    return db.prepare(`PRAGMA table_info(${table})`).all().find((c) => c.name === column) || null;
  } catch { return null; }
}

// Adds an `updated_at INTEGER` column (epoch millis) to every
// TEAM_SHARED table that's missing it, plus INSERT/UPDATE triggers that
// auto-bump it on every write. The triggers are guarded with WHEN
// clauses so the inner UPDATE inside the trigger body doesn't recurse.
//
// Three tables (posting_protocols, docs, autopilot_protocols family)
// already had a TEXT `updated_at` column carrying ISO timestamps from
// older app builds. SQLite stores integers happily in TEXT-typed columns
// but the lexical ORDER BY needed for the watermark query gives the
// wrong answer (e.g. '2' > '11'). Migrate those by renaming the legacy
// column to `updated_at_text` and adding a fresh INTEGER `updated_at`
// alongside, back-filling from the parseable ISO values where possible.
function ensureUpdatedAtColumns(db) {
  for (const t of TEAM_SHARED) {
    if (!tableExists(db, t.local)) continue;
    const existing = columnInfo(db, t.local, 'updated_at');
    const isText = existing && /TEXT|VARCHAR|CHAR|CLOB/i.test(existing.type || '');

    if (existing && isText) {
      // Migrate TEXT → INTEGER once. Idempotent: if updated_at_text
      // already exists from a prior run we skip the rename.
      try {
        if (!hasColumn(db, t.local, 'updated_at_text')) {
          db.exec(`ALTER TABLE ${t.local} RENAME COLUMN updated_at TO updated_at_text`);
          db.exec(`ALTER TABLE ${t.local} ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0`);
          // Best-effort backfill from the ISO timestamp.
          // + rowid so every row gets a unique value even if the source
          // timestamps collide at second-level resolution. See the
          // matching else-branch comment for why this matters.
          db.exec(
            `UPDATE ${t.local}
                SET updated_at = CAST((julianday(updated_at_text) - 2440587.5)*86400000 AS INTEGER) + rowid
              WHERE updated_at_text IS NOT NULL
                AND updated_at_text != ''
                AND julianday(updated_at_text) IS NOT NULL`
          );
        }
      } catch (e) {
        // Migration failures shouldn't take sync down for the rest of
        // the tables — just log and move on.
        if (!/duplicate column/i.test(e?.message || '')) {
          try { require('electron-log').warn(`[sync] migrate updated_at on ${t.local}:`, e?.message); } catch {}
        }
      }
    } else if (!existing) {
      try {
        db.exec(`ALTER TABLE ${t.local} ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0`);
      } catch (e) {
        if (!/duplicate column/i.test(e?.message || '')) throw e;
      }
      // Backfill so existing rows are eligible for the next push.
      // CRITICAL: add rowid so every row gets a UNIQUE updated_at value.
      // Without this, a bulk migration assigns the same wall-clock time
      // to every row in one statement, and the watermark advance logic
      // ("WHERE updated_at > maxWm") leaves rows past the 500-row batch
      // limit permanently stuck because all unsent rows share the same
      // updated_at as the watermark cursor.
      try {
        db.exec(
          `UPDATE ${t.local} SET updated_at = CAST((julianday('now') - 2440587.5)*86400000 AS INTEGER) + rowid WHERE updated_at = 0`
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
