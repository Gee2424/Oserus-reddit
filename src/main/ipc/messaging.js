// Messaging templates — saved canned replies for the Inbox Manager.
// Per the architecture brief: messaging should grow beyond a raw inbox,
// and these are the "automation features" hook. Templates are scoped
// global (every account) or per-model.

const { getDb } = require('../db');
const { userFromToken } = require('./auth');
const { log } = require('./activity');

function ensureTable() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS messaging_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      body TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'global' CHECK(scope IN ('global', 'model')),
      profile_id INTEGER REFERENCES model_profiles(id) ON DELETE CASCADE,
      created_by_user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

function register(ipcMain) {
  ipcMain.handle('messaging:templatesList', (_e, { token, profileId }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      ensureTable();
      let rows;
      if (profileId) {
        rows = getDb().prepare(
          `SELECT * FROM messaging_templates
           WHERE scope = 'global' OR (scope = 'model' AND profile_id = ?)
           ORDER BY name COLLATE NOCASE`
        ).all(profileId);
      } else {
        rows = getDb().prepare('SELECT * FROM messaging_templates ORDER BY name COLLATE NOCASE').all();
      }
      return { ok: true, templates: rows };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('messaging:templateCreate', (_e, { token, name, body, scope, profileId }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      if (!name || !body) throw new Error('Name and body required');
      const s = scope === 'model' ? 'model' : 'global';
      ensureTable();
      const info = getDb().prepare(
        'INSERT INTO messaging_templates (name, body, scope, profile_id, created_by_user_id) VALUES (?,?,?,?,?)'
      ).run(String(name).trim(), String(body), s, s === 'model' ? Number(profileId) : null, user.id);
      log(user, 'messaging.template.create', 'template', info.lastInsertRowid, name);
      return { ok: true, id: info.lastInsertRowid };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('messaging:templateDelete', (_e, { token, id }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      ensureTable();
      getDb().prepare('DELETE FROM messaging_templates WHERE id = ?').run(id);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
}

module.exports = register;
