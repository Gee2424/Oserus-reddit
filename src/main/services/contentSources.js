// Unified content-source pool. Replaces the per-platform target tables
// (warmup_subreddits, promo_subreddits, ...) with one query the
// coordinator and every platform adapter can use.
//
// kind:
//   'warmup' — used while an account's status is 'warming'. SFW.
//   'promo'  — used once status is 'ready'. May be NSFW.
//
// scope:
//   'global' — house list shared by every account on a platform.
//   'model'  — per-model_profiles row; promo lives here.
//
// Resolution rule: pull `kind` matching `account.status`, scoped to
// platform AND (the account's model OR global). Model rows win where
// both exist for the same platform+name (rare; UNIQUE catches dupes).

const { getDb } = require('../db');

function list({ platform, kind, profileId = null }) {
  const db = getDb();
  return db.prepare(
    `SELECT id, name, description, metadata_json
       FROM content_sources
      WHERE platform = ?
        AND kind = ?
        AND (
          (scope = 'global' AND scope_id IS NULL) OR
          (scope = 'model'  AND scope_id = ?)
        )
      ORDER BY scope = 'model' DESC, name`
  ).all(platform, kind, profileId);
}

// Resolve for an account: pick the kind by status, scope by profile.
function listForAccount(account) {
  const kind = account.status === 'ready' ? 'promo' : 'warmup';
  return list({ platform: account.platform, kind, profileId: account.profile_id });
}

function add({ platform, scope, scopeId, kind, name, description, metadata }) {
  const db = getDb();
  const meta = metadata ? JSON.stringify(metadata) : null;
  return db.prepare(
    `INSERT OR IGNORE INTO content_sources
       (platform, scope, scope_id, kind, name, description, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(platform, scope, scopeId, kind, name, description || null, meta);
}

function remove(id) {
  return getDb().prepare('DELETE FROM content_sources WHERE id = ?').run(id);
}

module.exports = { list, listForAccount, add, remove };
