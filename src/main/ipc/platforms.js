const { getDb } = require('../db');
const { userFromToken } = require('./auth');
const { hasPermission } = require('../permissions');

function register(ipcMain) {
  ipcMain.handle('platforms:list', () => {
    try {
      const rows = getDb().prepare('SELECT * FROM platforms ORDER BY sort_order, id').all();
      return { ok: true, platforms: rows };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('platforms:create', (_e, { token, platform }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      if (!hasPermission(user, 'profiles.manage')) throw new Error('Not authorized');

      const { key, label, short, color, home_url, login_url, username_prefix, icon } = platform || {};
      if (!key || !label) throw new Error('Key and label are required');

      const cleanKey = key.toLowerCase().replace(/[^a-z0-9_-]/g, '');
      if (!cleanKey) throw new Error('Invalid platform key');

      const maxOrder = getDb().prepare('SELECT MAX(sort_order) AS m FROM platforms').get()?.m || 0;

      getDb().prepare(`
        INSERT INTO platforms (key, label, short, color, home_url, login_url, username_prefix, icon, is_builtin, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
      `).run(
        cleanKey,
        label,
        short || cleanKey.charAt(0).toUpperCase(),
        color || '#888888',
        home_url || null,
        login_url || null,
        username_prefix || '@',
        icon || null,
        maxOrder + 1
      );

      return { ok: true, key: cleanKey };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('platforms:update', (_e, { token, platformId, updates }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      if (!hasPermission(user, 'profiles.manage')) throw new Error('Not authorized');

      const existing = getDb().prepare('SELECT * FROM platforms WHERE id = ?').get(platformId);
      if (!existing) throw new Error('Platform not found');

      const allowed = ['label', 'short', 'color', 'home_url', 'login_url', 'username_prefix', 'icon', 'sort_order'];
      const sets = [], params = [];
      for (const k of allowed) {
        if (updates[k] !== undefined) {
          sets.push(`${k} = ?`);
          params.push(updates[k]);
        }
      }
      if (!sets.length) return { ok: true };

      params.push(platformId);
      getDb().prepare(`UPDATE platforms SET ${sets.join(', ')} WHERE id = ?`).run(...params);

      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('platforms:delete', (_e, { token, platformId }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      if (!hasPermission(user, 'profiles.manage')) throw new Error('Not authorized');

      const existing = getDb().prepare('SELECT * FROM platforms WHERE id = ?').get(platformId);
      if (!existing) throw new Error('Platform not found');
      if (existing.is_builtin) throw new Error('Cannot delete a built-in platform');

      // Check if any accounts use this platform
      const acctCount = getDb().prepare(
        'SELECT COUNT(*) AS c FROM reddit_accounts WHERE platform = ?'
      ).get(existing.key);
      if (acctCount.c > 0) {
        throw new Error(`Cannot delete: ${acctCount.c} account(s) still use this platform`);
      }

      getDb().prepare('DELETE FROM platforms WHERE id = ?').run(platformId);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
}

module.exports = register;
