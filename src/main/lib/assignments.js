// Per-model access scoping — the single boundary for "assigned models only".
//
// A user with `profiles.manage` sees every model on their team. Everyone else
// (Chatter / VA / custom roles) only sees models they are the legacy primary
// assignee on (`model_profiles.assigned_user_id`) OR a member of via the
// `profile_assignments` table. This mirrors the logic that already lives inline
// in `ipc/accounts.js` (`canAccessProfile`, `accounts:listForUser`) — use these
// helpers instead of re-deriving it.

const { getDb } = require('../db');
const { hasPermission } = require('../permissions');

// A SQL fragment (+ params) that constrains a query joined to `model_profiles`
// (default alias `p`) to the profiles `user` may see. Returns `1=1` for
// managers/admins and `1=0` for an unauthenticated caller.
function profileScopeClause(user, alias = 'p') {
  if (!user) return { sql: '1=0', params: [] };
  if (hasPermission(user, 'profiles.manage')) return { sql: '1=1', params: [] };
  return {
    sql:
      `(${alias}.assigned_user_id = ? OR EXISTS (` +
      `SELECT 1 FROM profile_assignments pa WHERE pa.profile_id = ${alias}.id AND pa.user_id = ?))`,
    params: [user.id, user.id],
  };
}

// The concrete list of profile ids a user may see (optionally within a team).
function assignedProfileIds(user, teamId) {
  if (!user) return [];
  const db = getDb();
  if (hasPermission(user, 'profiles.manage')) {
    const rows = teamId
      ? db.prepare('SELECT id FROM model_profiles WHERE team_id = ?').all(teamId)
      : db.prepare('SELECT id FROM model_profiles').all();
    return rows.map((r) => r.id);
  }
  const rows = db
    .prepare(
      `SELECT id FROM model_profiles p
        WHERE p.assigned_user_id = ?
           OR EXISTS (SELECT 1 FROM profile_assignments pa WHERE pa.profile_id = p.id AND pa.user_id = ?)`
    )
    .all(user.id, user.id);
  return rows.map((r) => r.id);
}

// True if `user` may act on `profileId`.
function canAccessProfile(user, profileId) {
  if (!user) return false;
  if (hasPermission(user, 'profiles.manage')) return true;
  const db = getDb();
  const row = db.prepare('SELECT assigned_user_id FROM model_profiles WHERE id = ?').get(profileId);
  if (row && row.assigned_user_id === user.id) return true;
  const a = db
    .prepare('SELECT 1 FROM profile_assignments WHERE profile_id = ? AND user_id = ? LIMIT 1')
    .get(profileId, user.id);
  return !!a;
}

module.exports = { profileScopeClause, assignedProfileIds, canAccessProfile };
