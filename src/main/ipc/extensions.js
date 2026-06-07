// Chrome extension registry for the Oserus Browser. Operators add a
// path to an unpacked extension folder (manifest.json at the root);
// sessionPrep.js loads enabled extensions per-partition so each profile
// gets its own extension storage / cookies / badges.

const fs = require('fs');
const path = require('path');
const { getDb } = require('../db');
const { userFromToken } = require('./auth');
const { requirePermission } = require('../permissions');

function ensureMigrations() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS browser_extensions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

function readManifestName(extPath) {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(extPath, 'manifest.json'), 'utf8'));
    return m.name || path.basename(extPath);
  } catch { return null; }
}

function register(ipcMain) {
  ensureMigrations();

  ipcMain.handle('extensions:list', (_e, { token }) => {
    const user = userFromToken(token);
    if (!user) return { ok: false, error: 'Not authenticated' };
    ensureMigrations();
    const rows = getDb().prepare(
      'SELECT id, name, path, enabled, created_at FROM browser_extensions ORDER BY name'
    ).all();
    return { ok: true, extensions: rows };
  });

  ipcMain.handle('extensions:add', (_e, { token, path: extPath }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      requirePermission(user, 'infra.proxies.manage');
      if (!extPath) throw new Error('Path required');
      const abs = path.resolve(extPath);
      if (!fs.existsSync(abs)) throw new Error('Path does not exist');
      const manifest = path.join(abs, 'manifest.json');
      if (!fs.existsSync(manifest)) throw new Error('No manifest.json at that path — point to the unpacked folder');
      const name = readManifestName(abs) || path.basename(abs);
      const info = getDb().prepare(
        'INSERT INTO browser_extensions (name, path) VALUES (?, ?)'
      ).run(name, abs);
      return { ok: true, id: info.lastInsertRowid, name };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('extensions:toggle', (_e, { token, id, enabled }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      requirePermission(user, 'infra.proxies.manage');
      getDb().prepare('UPDATE browser_extensions SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('extensions:remove', (_e, { token, id }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      requirePermission(user, 'infra.proxies.manage');
      getDb().prepare('DELETE FROM browser_extensions WHERE id = ?').run(id);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
}

module.exports = register;
