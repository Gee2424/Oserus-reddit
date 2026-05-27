const { getDb } = require('../db');
const { userFromToken } = require('./auth');

function ensureTable() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      username TEXT,
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id INTEGER,
      detail TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_log(created_at DESC);
  `);
}

function log(user, action, entityType, entityId, detail) {
  try {
    ensureTable();
    getDb().prepare(
      'INSERT INTO activity_log (user_id, username, action, entity_type, entity_id, detail) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(user?.id || null, user?.username || null, action, entityType || null, entityId || null, detail || null);
  } catch (e) {
    // never let logging fail the underlying action
  }
}

function register(ipcMain) {
  ipcMain.handle('activity:list', (_e, { token, limit, filter }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      if (user.role !== 'admin' && user.role !== 'manager') throw new Error('Manager or admin only');
      ensureTable();
      let sql = 'SELECT * FROM activity_log';
      const params = [];
      const wheres = [];
      if (filter?.action) { wheres.push('action = ?'); params.push(filter.action); }
      if (filter?.username) { wheres.push('username = ?'); params.push(filter.username); }
      if (filter?.entityType) { wheres.push('entity_type = ?'); params.push(filter.entityType); }
      if (wheres.length) sql += ' WHERE ' + wheres.join(' AND ');
      sql += ' ORDER BY id DESC LIMIT ?';
      params.push(Number(limit) || 200);
      const rows = getDb().prepare(sql).all(...params);
      return { ok: true, entries: rows };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
}

module.exports = register;
module.exports.log = log;
