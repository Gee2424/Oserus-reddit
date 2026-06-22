const { getDb } = require('../db');
const { userFromToken, requireManagerOrAdmin } = require('./auth');
const { hasPermission } = require('../permissions');
const { markDirty } = require('../sync/supabase');

// Add proxy_id to model_profiles so a single proxy can be inherited by every
// account under a model. Account-level proxy_id still wins when set.
// Also create profile_assignments so multiple team members can be tied to one
// model with distinct roles (manager / chatter / coordinator / marketing).
function ensureProfileMigrations() {
  try {
    const cols = getDb().prepare("PRAGMA table_info(model_profiles)").all();
    if (!cols.some((c) => c.name === 'proxy_id')) {
      getDb().exec('ALTER TABLE model_profiles ADD COLUMN proxy_id INTEGER REFERENCES proxies(id) ON DELETE SET NULL');
    }
    if (!cols.some((c) => c.name === 'main_email')) {
      getDb().exec('ALTER TABLE model_profiles ADD COLUMN main_email TEXT');
    }
  } catch {}
  try {
    getDb().exec(`
      CREATE TABLE IF NOT EXISTS profile_assignments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id INTEGER NOT NULL REFERENCES model_profiles(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role TEXT NOT NULL DEFAULT 'chatter' CHECK(role IN ('manager','chatter','coordinator','marketing')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(profile_id, user_id)
      );
    `);
  } catch {}
}

function listAssignments(profileId) {
  return getDb().prepare(
    `SELECT pa.id, pa.profile_id, pa.user_id, pa.role, pa.created_at,
            u.username, u.display_name
       FROM profile_assignments pa
       JOIN users u ON u.id = pa.user_id
      WHERE pa.profile_id = ?
      ORDER BY CASE pa.role WHEN 'manager' THEN 0 WHEN 'coordinator' THEN 1 WHEN 'chatter' THEN 2 ELSE 3 END,
               u.display_name`
  ).all(profileId);
}

function register(ipcMain) {
  ensureProfileMigrations();
  ipcMain.handle('profiles:list', (_e, { token }) => {
    const user = userFromToken(token);
    if (!user) return { ok: false, error: 'Not authenticated' };

    // Non-managers see profiles they're either the legacy primary assignee on
    // OR a member of via profile_assignments.
    const rows =
      hasPermission(user, 'profiles.manage')
        ? getDb()
            .prepare(
              `SELECT p.*, u.display_name AS assigned_to_name, u.username AS assigned_to_username,
                      (SELECT COUNT(*) FROM reddit_accounts WHERE profile_id = p.id) AS account_count,
                      (SELECT COUNT(*) FROM reddit_accounts WHERE profile_id = p.id AND status = 'ready') AS ready_count
               FROM model_profiles p
               LEFT JOIN users u ON u.id = p.assigned_user_id
               ORDER BY p.created_at DESC`
            )
            .all()
        : getDb()
            .prepare(
              `SELECT p.*, u.display_name AS assigned_to_name, u.username AS assigned_to_username,
                      (SELECT COUNT(*) FROM reddit_accounts WHERE profile_id = p.id) AS account_count,
                      (SELECT COUNT(*) FROM reddit_accounts WHERE profile_id = p.id AND status = 'ready') AS ready_count
               FROM model_profiles p
               LEFT JOIN users u ON u.id = p.assigned_user_id
               WHERE p.assigned_user_id = ?
                  OR EXISTS (SELECT 1 FROM profile_assignments pa WHERE pa.profile_id = p.id AND pa.user_id = ?)
               ORDER BY p.created_at DESC`
            )
            .all(user.id, user.id);
    for (const r of rows) {
      r.members = listAssignments(r.id);
    }
    return { ok: true, profiles: rows };
  });

  ipcMain.handle('profiles:addMember', (_e, { token, profileId, userId, role }) => {
    try {
      requireManagerOrAdmin(token);
      if (!role) throw new Error('Role required');
      const known = getDb().prepare("SELECT 1 FROM roles WHERE key = ? AND key != 'admin'").get(role);
      if (!known) throw new Error('Unknown role — create it in Roles first');
      getDb().prepare(
        `INSERT INTO profile_assignments (profile_id, user_id, role) VALUES (?,?,?)
         ON CONFLICT(profile_id, user_id) DO UPDATE SET role=excluded.role`
      ).run(profileId, userId, role);
      return { ok: true, members: listAssignments(profileId) };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('profiles:removeMember', (_e, { token, profileId, userId }) => {
    try {
      requireManagerOrAdmin(token);
      getDb().prepare('DELETE FROM profile_assignments WHERE profile_id=? AND user_id=?').run(profileId, userId);
      return { ok: true, members: listAssignments(profileId) };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('profiles:setMemberRole', (_e, { token, profileId, userId, role }) => {
    try {
      requireManagerOrAdmin(token);
      if (!role) throw new Error('Role required');
      const known = getDb().prepare("SELECT 1 FROM roles WHERE key = ? AND key != 'admin'").get(role);
      if (!known) throw new Error('Unknown role — create it in Roles first');
      getDb().prepare('UPDATE profile_assignments SET role=? WHERE profile_id=? AND user_id=?').run(role, profileId, userId);
      return { ok: true, members: listAssignments(profileId) };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('profiles:create', (_e, args) => {
    try {
      const { token, name, assignedUserId, niche, brandVoice, notes, avatarColor } = args;
      requireManagerOrAdmin(token);
      const info = getDb()
        .prepare(
          'INSERT INTO model_profiles (name, assigned_user_id, niche, brand_voice, notes, avatar_color) VALUES (?,?,?,?,?,?)'
        )
        .run(name, assignedUserId || null, niche || null, brandVoice || null, notes || null, avatarColor || null);
      markDirty();
      return { ok: true, id: info.lastInsertRowid };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('profiles:update', (_e, { token, profileId, updates }) => {
    try {
      requireManagerOrAdmin(token);
      const allowed = ['name', 'assigned_user_id', 'niche', 'brand_voice', 'notes', 'avatar_color', 'proxy_id', 'main_email'];
      const sets = [], params = [];
      for (const k of allowed) {
        if (updates[k] !== undefined) {
          sets.push(`${k} = ?`);
          params.push(updates[k]);
        }
      }
      if (!sets.length) return { ok: true };
      params.push(profileId);
      getDb().prepare(`UPDATE model_profiles SET ${sets.join(', ')} WHERE id = ?`).run(...params);
      markDirty();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('profiles:assign', (_e, { token, profileId, assignedUserId }) => {
    try {
      requireManagerOrAdmin(token);
      getDb()
        .prepare('UPDATE model_profiles SET assigned_user_id = ? WHERE id = ?')
        .run(assignedUserId || null, profileId);
      markDirty();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('profiles:delete', (_e, { token, profileId }) => {
    try {
      requireManagerOrAdmin(token);
      getDb().prepare('DELETE FROM model_profiles WHERE id = ?').run(profileId);
      markDirty();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
}

module.exports = register;
