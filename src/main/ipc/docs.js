const { getDb } = require('../db');
const { userFromToken } = require('./auth');

function ensureTable() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS docs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      profile_id INTEGER,
      author_user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(profile_id) REFERENCES model_profiles(id) ON DELETE SET NULL,
      FOREIGN KEY(author_user_id) REFERENCES users(id) ON DELETE SET NULL
    );
  `);
}

function register(ipcMain) {
  ipcMain.handle('docs:list', (_e, { token, profileId }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      ensureTable();
      const rows = profileId
        ? getDb().prepare(
            `SELECT d.*, u.display_name AS author_name
             FROM docs d LEFT JOIN users u ON u.id = d.author_user_id
             WHERE d.profile_id = ? ORDER BY d.updated_at DESC`
          ).all(profileId)
        : getDb().prepare(
            `SELECT d.*, u.display_name AS author_name, p.name AS profile_name
             FROM docs d
             LEFT JOIN users u ON u.id = d.author_user_id
             LEFT JOIN model_profiles p ON p.id = d.profile_id
             ORDER BY d.updated_at DESC`
          ).all();
      return { ok: true, docs: rows };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('docs:get', (_e, { token, id }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      ensureTable();
      const row = getDb().prepare(
        `SELECT d.*, u.display_name AS author_name
         FROM docs d LEFT JOIN users u ON u.id = d.author_user_id
         WHERE d.id = ?`
      ).get(id);
      return row ? { ok: true, doc: row } : { ok: false, error: 'Not found' };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('docs:create', (_e, { token, title, body, profileId }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      ensureTable();
      const info = getDb().prepare(
        'INSERT INTO docs (title, body, profile_id, author_user_id) VALUES (?, ?, ?, ?)'
      ).run(title || 'Untitled', body || '', profileId || null, user.id);
      return { ok: true, id: info.lastInsertRowid };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('docs:update', (_e, { token, id, title, body }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      ensureTable();
      const sets = [];
      const params = [];
      if (title !== undefined) { sets.push('title = ?'); params.push(title); }
      if (body !== undefined) { sets.push('body = ?'); params.push(body); }
      if (!sets.length) return { ok: true };
      sets.push("updated_at = datetime('now')");
      params.push(id);
      getDb().prepare(`UPDATE docs SET ${sets.join(', ')} WHERE id = ?`).run(...params);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('docs:delete', (_e, { token, id }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      if (user.role !== 'admin' && user.role !== 'manager') throw new Error('Manager or admin only');
      ensureTable();
      getDb().prepare('DELETE FROM docs WHERE id = ?').run(id);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
}

module.exports = register;
