const { getDb } = require('../db');
const { userFromToken, requireManagerOrAdmin } = require('./auth');
const { hasPermission } = require('../permissions');

// Add proxy_id to model_profiles so a single proxy can be inherited by every
// account under a model. Account-level proxy_id still wins when set.
function ensureProfileMigrations() {
  try {
    const cols = getDb().prepare("PRAGMA table_info(model_profiles)").all();
    if (!cols.some((c) => c.name === 'proxy_id')) {
      getDb().exec('ALTER TABLE model_profiles ADD COLUMN proxy_id INTEGER REFERENCES proxies(id) ON DELETE SET NULL');
    }
  } catch {}
}

function register(ipcMain) {
  ensureProfileMigrations();
  ipcMain.handle('profiles:list', (_e, { token }) => {
    const user = userFromToken(token);
    if (!user) return { ok: false, error: 'Not authenticated' };

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
               ORDER BY p.created_at DESC`
            )
            .all(user.id);
    return { ok: true, profiles: rows };
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
      return { ok: true, id: info.lastInsertRowid };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('profiles:update', (_e, { token, profileId, updates }) => {
    try {
      requireManagerOrAdmin(token);
      const allowed = ['name', 'assigned_user_id', 'niche', 'brand_voice', 'notes', 'avatar_color', 'proxy_id'];
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
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('profiles:delete', (_e, { token, profileId }) => {
    try {
      requireManagerOrAdmin(token);
      getDb().prepare('DELETE FROM model_profiles WHERE id = ?').run(profileId);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
}

module.exports = register;
