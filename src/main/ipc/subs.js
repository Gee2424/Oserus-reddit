const { getDb } = require('../db');
const { userFromToken } = require('./auth');

function isAdminOrManager(user) {
  return user && (user.role === 'admin' || user.role === 'manager');
}

function register(ipcMain) {
  // --- WARM-UP (GLOBAL) ---
  ipcMain.handle('subs:listWarmup', (_e, { token }) => {
    const user = userFromToken(token);
    if (!user) return { ok: false, error: 'Not authenticated' };
    const rows = getDb().prepare('SELECT * FROM warmup_subreddits ORDER BY name COLLATE NOCASE').all();
    return { ok: true, subs: rows };
  });

  ipcMain.handle('subs:createWarmup', (_e, { token, name, vibe, description }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      if (!isAdminOrManager(user)) throw new Error('Manager or admin only');
      const clean = String(name || '').replace(/^\/?r\//i, '').trim();
      if (!clean) throw new Error('Subreddit name required');
      const info = getDb()
        .prepare('INSERT INTO warmup_subreddits (name, vibe, description) VALUES (?,?,?)')
        .run(clean, vibe || null, description || null);
      return { ok: true, id: info.lastInsertRowid };
    } catch (err) {
      if (String(err.message).includes('UNIQUE')) return { ok: false, error: 'That subreddit is already on the warm-up list.' };
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('subs:updateWarmup', (_e, { token, id, updates }) => {
    try {
      const user = userFromToken(token);
      if (!isAdminOrManager(user)) throw new Error('Manager or admin only');
      const allowed = ['name', 'vibe', 'description'];
      const sets = [], params = [];
      for (const k of allowed) if (updates[k] !== undefined) { sets.push(`${k} = ?`); params.push(updates[k]); }
      if (!sets.length) return { ok: true };
      params.push(id);
      getDb().prepare(`UPDATE warmup_subreddits SET ${sets.join(', ')} WHERE id = ?`).run(...params);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('subs:deleteWarmup', (_e, { token, id }) => {
    try {
      const user = userFromToken(token);
      if (!isAdminOrManager(user)) throw new Error('Manager or admin only');
      getDb().prepare('DELETE FROM warmup_subreddits WHERE id = ?').run(id);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // --- PROMO (PER MODEL) ---
  ipcMain.handle('subs:listPromo', (_e, { token, profileId }) => {
    const user = userFromToken(token);
    if (!user) return { ok: false, error: 'Not authenticated' };
    // Permission: admins/managers see any model's list; others must be assigned to that model
    if (!isAdminOrManager(user)) {
      const row = getDb().prepare('SELECT assigned_user_id FROM model_profiles WHERE id = ?').get(profileId);
      if (!row || row.assigned_user_id !== user.id) return { ok: false, error: 'Not authorized' };
    }
    const rows = getDb()
      .prepare('SELECT * FROM promo_subreddits WHERE profile_id = ? ORDER BY name COLLATE NOCASE')
      .all(profileId);
    return { ok: true, subs: rows };
  });

  ipcMain.handle('subs:createPromo', (_e, { token, profileId, name, description }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      if (!isAdminOrManager(user)) {
        const row = getDb().prepare('SELECT assigned_user_id FROM model_profiles WHERE id = ?').get(profileId);
        if (!row || row.assigned_user_id !== user.id) throw new Error('Not authorized');
      }
      const clean = String(name || '').replace(/^\/?r\//i, '').trim();
      if (!clean) throw new Error('Subreddit name required');
      const info = getDb()
        .prepare('INSERT INTO promo_subreddits (profile_id, name, description) VALUES (?,?,?)')
        .run(profileId, clean, description || null);
      return { ok: true, id: info.lastInsertRowid };
    } catch (err) {
      if (String(err.message).includes('UNIQUE')) return { ok: false, error: 'Already on this model\'s list.' };
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('subs:deletePromo', (_e, { token, id }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      if (!isAdminOrManager(user)) {
        const row = getDb().prepare(
          'SELECT mp.assigned_user_id FROM promo_subreddits ps JOIN model_profiles mp ON mp.id = ps.profile_id WHERE ps.id = ?'
        ).get(id);
        if (!row || row.assigned_user_id !== user.id) throw new Error('Not authorized');
      }
      getDb().prepare('DELETE FROM promo_subreddits WHERE id = ?').run(id);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
}

module.exports = register;
