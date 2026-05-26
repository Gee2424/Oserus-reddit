const { getDb } = require('../db');
const { userFromToken } = require('./auth');

function ensureTable() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS scheduled_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      subreddit TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      kind TEXT NOT NULL CHECK(kind IN ('self','link','image')) DEFAULT 'self',
      url TEXT,
      scheduled_for TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending','posted','failed','cancelled')) DEFAULT 'pending',
      error TEXT,
      created_by_user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      posted_at TEXT,
      FOREIGN KEY(account_id) REFERENCES reddit_accounts(id) ON DELETE CASCADE
    );
  `);
}

function register(ipcMain) {
  ipcMain.handle('scheduled:list', (_e, { token, accountId, profileId }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      ensureTable();
      let sql = `
        SELECT s.*, a.username AS account_username, p.name AS profile_name
        FROM scheduled_posts s
        LEFT JOIN reddit_accounts a ON a.id = s.account_id
        LEFT JOIN model_profiles p ON p.id = a.profile_id
      `;
      const params = [];
      const wheres = [];
      if (accountId) { wheres.push('s.account_id = ?'); params.push(accountId); }
      if (profileId) { wheres.push('a.profile_id = ?'); params.push(profileId); }
      if (wheres.length) sql += ' WHERE ' + wheres.join(' AND ');
      sql += ' ORDER BY s.scheduled_for ASC';
      const rows = getDb().prepare(sql).all(...params);
      return { ok: true, posts: rows };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('scheduled:create', (_e, { token, accountId, subreddit, title, body, kind, url, scheduledFor }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      ensureTable();
      if (!accountId || !subreddit || !title || !scheduledFor) {
        throw new Error('Account, subreddit, title, and time required');
      }
      const info = getDb().prepare(
        `INSERT INTO scheduled_posts (account_id, subreddit, title, body, kind, url, scheduled_for, created_by_user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        accountId,
        subreddit.replace(/^r\//i, '').trim(),
        title,
        body || null,
        kind || 'self',
        url || null,
        scheduledFor,
        user.id
      );
      return { ok: true, id: info.lastInsertRowid };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('scheduled:cancel', (_e, { token, id }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      ensureTable();
      getDb().prepare(
        "UPDATE scheduled_posts SET status = 'cancelled' WHERE id = ? AND status = 'pending'"
      ).run(id);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('scheduled:delete', (_e, { token, id }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      ensureTable();
      getDb().prepare('DELETE FROM scheduled_posts WHERE id = ?').run(id);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
}

module.exports = register;
