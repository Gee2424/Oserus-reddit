// Messaging templates + Cupid AI auto-reply rules.
// Templates are saved canned replies; rules match an incoming DM against a
// regex pattern and fire a template back through the inbox:reply path. The
// matcher itself lives in inbox.js (so it can reuse the same Reddit JSON
// fetch) — this file owns the table + CRUD.

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
    CREATE TABLE IF NOT EXISTS messaging_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      profile_id INTEGER REFERENCES model_profiles(id) ON DELETE CASCADE,
      account_id INTEGER REFERENCES reddit_accounts(id) ON DELETE CASCADE,
      match_pattern TEXT NOT NULL,
      template_id INTEGER REFERENCES messaging_templates(id) ON DELETE SET NULL,
      daily_limit INTEGER DEFAULT 50,
      created_by_user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_fired_at TEXT
    );
    CREATE TABLE IF NOT EXISTS messaging_rule_fires (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rule_id INTEGER NOT NULL,
      account_id INTEGER NOT NULL,
      conversation_with TEXT,
      fired_at TEXT NOT NULL DEFAULT (datetime('now'))
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

  // ----- Cupid AI auto-reply rules -----

  ipcMain.handle('messaging:rulesList', (_e, { token, accountId, profileId }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      ensureTable();
      let where = '1=1', params = [];
      if (accountId) { where = 'r.account_id = ? OR r.account_id IS NULL'; params.push(accountId); }
      else if (profileId) { where = 'r.profile_id = ? OR r.profile_id IS NULL'; params.push(profileId); }
      const rows = getDb().prepare(
        `SELECT r.*, t.name AS template_name
           FROM messaging_rules r
           LEFT JOIN messaging_templates t ON t.id = r.template_id
          WHERE ${where}
          ORDER BY r.enabled DESC, r.name COLLATE NOCASE`
      ).all(...params);
      return { ok: true, rules: rows };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('messaging:ruleCreate', (_e, { token, name, pattern, templateId, accountId, profileId, dailyLimit, enabled }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      if (!name || !pattern || !templateId) throw new Error('Name, pattern, and template required');
      ensureTable();
      // Validate the pattern compiles.
      try { new RegExp(pattern, 'i'); } catch (e) { throw new Error('Invalid regex: ' + e.message); }
      const info = getDb().prepare(
        `INSERT INTO messaging_rules
           (name, enabled, profile_id, account_id, match_pattern, template_id, daily_limit, created_by_user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        String(name).trim(),
        enabled === false ? 0 : 1,
        profileId ? Number(profileId) : null,
        accountId ? Number(accountId) : null,
        String(pattern),
        Number(templateId),
        Math.max(1, Number(dailyLimit) || 50),
        user.id,
      );
      log(user, 'messaging.rule.create', 'rule', info.lastInsertRowid, name);
      return { ok: true, id: info.lastInsertRowid };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('messaging:ruleUpdate', (_e, { token, id, updates }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      ensureTable();
      const allowed = ['name', 'enabled', 'match_pattern', 'template_id', 'daily_limit'];
      const sets = [], params = [];
      for (const k of allowed) {
        if (updates[k] !== undefined) {
          if (k === 'enabled') { sets.push('enabled = ?'); params.push(updates[k] ? 1 : 0); }
          else { sets.push(`${k} = ?`); params.push(updates[k]); }
        }
      }
      if (!sets.length) return { ok: true };
      params.push(id);
      getDb().prepare(`UPDATE messaging_rules SET ${sets.join(', ')} WHERE id = ?`).run(...params);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('messaging:ruleDelete', (_e, { token, id }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      ensureTable();
      getDb().prepare('DELETE FROM messaging_rules WHERE id = ?').run(id);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
}

module.exports = register;
