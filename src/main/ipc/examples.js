// Per-account libraries of example posts + example images that the autopilot
// content generator pulls from for style + topic seeding. One row per item;
// scoped strictly to a single account so each persona has its own voice.
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { userFromToken } = require('./auth');
const { getDb } = require('../db');

function imageDir(accountId) {
  const dir = path.join(app.getPath('userData'), 'example_images', String(accountId));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function register(ipcMain) {
  ipcMain.handle('examples:listPosts', (_e, { token, accountId }) => {
    try {
      if (!userFromToken(token)) throw new Error('Not authenticated');
      const rows = getDb().prepare(
        'SELECT id, title, body, subreddit, created_at FROM account_example_posts WHERE account_id = ? ORDER BY created_at DESC'
      ).all(accountId);
      return { ok: true, posts: rows };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('examples:addPost', (_e, { token, accountId, title, body, subreddit }) => {
    try {
      if (!userFromToken(token)) throw new Error('Not authenticated');
      if (!title || !title.trim()) throw new Error('Title required');
      const r = getDb().prepare(
        'INSERT INTO account_example_posts (account_id, title, body, subreddit) VALUES (?,?,?,?)'
      ).run(accountId, title.trim(), body || null, subreddit || null);
      return { ok: true, id: r.lastInsertRowid };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('examples:deletePost', (_e, { token, id }) => {
    try {
      if (!userFromToken(token)) throw new Error('Not authenticated');
      getDb().prepare('DELETE FROM account_example_posts WHERE id = ?').run(id);
      return { ok: true };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('examples:listImages', (_e, { token, accountId }) => {
    try {
      if (!userFromToken(token)) throw new Error('Not authenticated');
      const rows = getDb().prepare(
        'SELECT id, file_path, caption, created_at FROM account_example_images WHERE account_id = ? ORDER BY created_at DESC'
      ).all(accountId);
      return { ok: true, images: rows };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('examples:addImage', (_e, { token, accountId, fileName, dataBase64, caption }) => {
    try {
      if (!userFromToken(token)) throw new Error('Not authenticated');
      if (!dataBase64) throw new Error('File data required');
      const safeName = String(fileName || 'image').replace(/[^a-zA-Z0-9._-]/g, '_');
      const stamp = Date.now();
      const dest = path.join(imageDir(accountId), `${stamp}_${safeName}`);
      fs.writeFileSync(dest, Buffer.from(dataBase64, 'base64'));
      const r = getDb().prepare(
        'INSERT INTO account_example_images (account_id, file_path, caption) VALUES (?,?,?)'
      ).run(accountId, dest, caption || null);
      return { ok: true, id: r.lastInsertRowid, path: dest };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('examples:deleteImage', (_e, { token, id }) => {
    try {
      if (!userFromToken(token)) throw new Error('Not authenticated');
      const row = getDb().prepare('SELECT file_path FROM account_example_images WHERE id = ?').get(id);
      if (row?.file_path) { try { fs.unlinkSync(row.file_path); } catch {} }
      getDb().prepare('DELETE FROM account_example_images WHERE id = ?').run(id);
      return { ok: true };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('examples:readImage', (_e, { token, id }) => {
    try {
      if (!userFromToken(token)) throw new Error('Not authenticated');
      const row = getDb().prepare('SELECT file_path FROM account_example_images WHERE id = ?').get(id);
      if (!row) throw new Error('Not found');
      const data = fs.readFileSync(row.file_path);
      return { ok: true, dataBase64: data.toString('base64') };
    } catch (err) { return { ok: false, error: err.message }; }
  });
}

module.exports = register;
