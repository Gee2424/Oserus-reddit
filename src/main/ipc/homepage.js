// Homepage tile registry — operator-configurable list of quick-launch
// tiles that appear on the Oserus Browser new-tab page. Each tile has
// a label, URL, and optional accent color. Tiles are global (shared
// across every account window) for V1 — could be per-profile later.

const { getDb } = require('../db');
const { userFromToken } = require('./auth');
const { requirePermission } = require('../permissions');

const DEFAULTS = [
  { label: 'Reddit',    url: 'https://www.reddit.com',    color: '#ff4500' },
  { label: 'X',         url: 'https://x.com',             color: '#1d9bf0' },
  { label: 'Instagram', url: 'https://www.instagram.com', color: '#e1306c' },
  { label: 'TikTok',    url: 'https://www.tiktok.com',    color: '#69c9d0' },
  { label: 'Facebook',  url: 'https://www.facebook.com',  color: '#1877f2' },
  { label: 'YouTube',   url: 'https://www.youtube.com',   color: '#ff0000' },
  { label: 'Discord',   url: 'https://discord.com',       color: '#5865f2' },
  { label: 'Amazon',    url: 'https://www.amazon.com',    color: '#ff9900' },
  { label: 'PayPal',    url: 'https://www.paypal.com',    color: '#003087' },
  { label: 'LinkedIn',  url: 'https://www.linkedin.com',  color: '#0a66c2' },
  { label: 'OnlyFans',  url: 'https://onlyfans.com',      color: '#00aff0' },
  { label: 'Gmail',     url: 'https://mail.google.com',   color: '#ea4335' },
];

function ensureMigrations() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS homepage_tiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL,
      url TEXT NOT NULL,
      color TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  const count = db.prepare('SELECT COUNT(*) AS n FROM homepage_tiles').get().n;
  if (count === 0) {
    const insert = db.prepare(
      'INSERT INTO homepage_tiles (label, url, color, sort_order) VALUES (?, ?, ?, ?)'
    );
    DEFAULTS.forEach((t, i) => insert.run(t.label, t.url, t.color || null, i));
  }
}

function listTiles() {
  ensureMigrations();
  return getDb().prepare(
    'SELECT id, label, url, color, sort_order FROM homepage_tiles ORDER BY sort_order, id'
  ).all();
}

function register(ipcMain) {
  ensureMigrations();

  ipcMain.handle('homepage:list', (_e, { token }) => {
    const user = userFromToken(token);
    if (!user) return { ok: false, error: 'Not authenticated' };
    return { ok: true, tiles: listTiles() };
  });

  // Replace-all save. Tiles is an array of { label, url, color }; new
  // ids are assigned by the DB and sort_order is set by array index.
  ipcMain.handle('homepage:save', (_e, { token, tiles }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      requirePermission(user, 'infra.proxies.manage');
      if (!Array.isArray(tiles)) throw new Error('tiles must be an array');
      const db = getDb();
      const tx = db.transaction((arr) => {
        db.prepare('DELETE FROM homepage_tiles').run();
        const insert = db.prepare(
          'INSERT INTO homepage_tiles (label, url, color, sort_order) VALUES (?, ?, ?, ?)'
        );
        arr.forEach((t, i) => {
          if (!t || !t.label || !t.url) return;
          insert.run(String(t.label), String(t.url), t.color ? String(t.color) : null, i);
        });
      });
      tx(tiles);
      return { ok: true, tiles: listTiles() };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
}

module.exports = register;
module.exports.listTiles = listTiles;
module.exports.DEFAULTS = DEFAULTS;
