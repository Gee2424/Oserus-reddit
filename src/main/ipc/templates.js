// Pro Schedule Templates.
//
// A template bundles (accounts × subreddits × cadence × posts-per-account).
// templates:start spreads that bundle across the cadence window as
// scheduled_posts (with template_id + auto_generate=1). The existing
// scheduled-post runner in coordinator.js picks them up like any other due
// post and asks Grok to compose the title at fire-time. templates:stop
// cancels the still-pending rows for that template.
//
// Storage is local SQLite (per-machine). When the coordination layer is
// pointed at Supabase, scheduled_posts already syncs status across machines.

const { getDb } = require('../db');
const { userFromToken } = require('./auth');
const { requirePermission } = require('../permissions');
const { log } = require('./activity');
const scheduled = require('./scheduled');

function ensureTable() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS schedule_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'idle' CHECK(status IN ('idle','running','paused')),
      accounts_json TEXT NOT NULL DEFAULT '[]',
      subreddits_json TEXT NOT NULL DEFAULT '[]',
      cadence_min_h REAL NOT NULL DEFAULT 4,
      cadence_max_h REAL NOT NULL DEFAULT 8,
      posts_per_account INTEGER NOT NULL DEFAULT 3,
      created_by_user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_started_at TEXT
    );
  `);
}
const J = (v) => { try { return JSON.parse(v || '[]'); } catch { return []; } };

function rowToTemplate(r) {
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    status: r.status,
    accountIds: J(r.accounts_json),
    subreddits: J(r.subreddits_json),
    cadenceMinH: r.cadence_min_h,
    cadenceMaxH: r.cadence_max_h,
    postsPerAccount: r.posts_per_account,
    lastStartedAt: r.last_started_at,
    createdAt: r.created_at,
  };
}

function register(ipcMain) {
  ipcMain.handle('templates:list', (_e, { token }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      ensureTable();
      scheduled.ensureTable();
      const rows = getDb().prepare('SELECT * FROM schedule_templates ORDER BY id DESC').all();
      // attach live pending-count per template
      const counts = getDb().prepare(
        "SELECT template_id, COUNT(*) AS n FROM scheduled_posts WHERE template_id IS NOT NULL AND status = 'pending' GROUP BY template_id"
      ).all();
      const cmap = new Map(counts.map((c) => [c.template_id, c.n]));
      return { ok: true, templates: rows.map((r) => ({ ...rowToTemplate(r), pendingPosts: cmap.get(r.id) || 0 })) };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('templates:create', (_e, { token, name, accountIds, subreddits, cadenceMinH, cadenceMaxH, postsPerAccount }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      requirePermission(user, 'protocols.manage');
      if (!name || !String(name).trim()) throw new Error('Template name required');
      ensureTable();
      const info = getDb().prepare(
        `INSERT INTO schedule_templates (name, accounts_json, subreddits_json, cadence_min_h, cadence_max_h, posts_per_account, created_by_user_id)
         VALUES (?,?,?,?,?,?,?)`
      ).run(
        String(name).trim(),
        JSON.stringify(Array.isArray(accountIds) ? accountIds.map(Number) : []),
        JSON.stringify(Array.isArray(subreddits) ? subreddits.map((s) => String(s).replace(/^\/?r\//i, '').trim()).filter(Boolean) : []),
        Number(cadenceMinH) || 4,
        Number(cadenceMaxH) || 8,
        Math.max(1, Number(postsPerAccount) || 3),
        user.id
      );
      log(user, 'template.create', 'template', info.lastInsertRowid, name);
      return { ok: true, id: info.lastInsertRowid };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('templates:update', (_e, { token, id, updates }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      requirePermission(user, 'protocols.manage');
      ensureTable();
      const u = updates || {};
      const sets = []; const params = [];
      const push = (col, val) => { sets.push(`${col} = ?`); params.push(val); };
      if (u.name != null) push('name', String(u.name).trim());
      if (u.accountIds) push('accounts_json', JSON.stringify(u.accountIds.map(Number)));
      if (u.subreddits) push('subreddits_json', JSON.stringify(u.subreddits.map((s) => String(s).replace(/^\/?r\//i, '').trim()).filter(Boolean)));
      if (u.cadenceMinH != null) push('cadence_min_h', Number(u.cadenceMinH));
      if (u.cadenceMaxH != null) push('cadence_max_h', Number(u.cadenceMaxH));
      if (u.postsPerAccount != null) push('posts_per_account', Math.max(1, Number(u.postsPerAccount)));
      if (!sets.length) return { ok: true };
      params.push(id);
      getDb().prepare(`UPDATE schedule_templates SET ${sets.join(', ')} WHERE id = ?`).run(...params);
      return { ok: true };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('templates:delete', (_e, { token, id }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      requirePermission(user, 'protocols.manage');
      // cancel any of its still-pending children, then drop the template.
      getDb().prepare("UPDATE scheduled_posts SET status='cancelled' WHERE template_id = ? AND status = 'pending'").run(id);
      getDb().prepare('DELETE FROM schedule_templates WHERE id = ?').run(id);
      return { ok: true };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('templates:start', (_e, { token, id }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      requirePermission(user, 'protocols.manage');
      ensureTable();
      scheduled.ensureTable();
      const db = getDb();
      const row = db.prepare('SELECT * FROM schedule_templates WHERE id = ?').get(id);
      if (!row) throw new Error('Template not found');
      const t = rowToTemplate(row);
      if (!t.accountIds.length) throw new Error('Template has no accounts.');
      if (!t.subreddits.length) throw new Error('Template has no subreddits.');

      // Spread N posts per account across cadence_min_h .. cadence_max_h.
      const stmt = db.prepare(
        `INSERT INTO scheduled_posts
           (account_id, subreddit, title, scheduled_for, created_by_user_id, template_id, auto_generate)
         VALUES (?,?,?,?,?,?,1)`
      );
      const now = Date.now();
      const span = Math.max(t.cadenceMaxH, t.cadenceMinH + 0.5) * 3600 * 1000;
      const tx = db.transaction(() => {
        for (const accId of t.accountIds) {
          for (let i = 0; i < t.postsPerAccount; i++) {
            const at = now + Math.floor((span / t.postsPerAccount) * i)
              + Math.floor(Math.random() * (span / t.postsPerAccount / 4));
            const iso = new Date(at).toISOString().replace('T', ' ').slice(0, 19);
            const sub = t.subreddits[Math.floor(Math.random() * t.subreddits.length)];
            stmt.run(accId, sub, '', iso, user.id, t.id);
          }
        }
        db.prepare("UPDATE schedule_templates SET status='running', last_started_at=datetime('now') WHERE id=?").run(id);
      });
      tx();
      log(user, 'template.start', 'template', id, t.name);
      return { ok: true, created: t.accountIds.length * t.postsPerAccount };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('templates:stop', (_e, { token, id }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      requirePermission(user, 'protocols.manage');
      const db = getDb();
      const r = db.prepare("UPDATE scheduled_posts SET status='cancelled' WHERE template_id = ? AND status = 'pending'").run(id);
      db.prepare("UPDATE schedule_templates SET status='idle' WHERE id=?").run(id);
      log(user, 'template.stop', 'template', id, `cancelled=${r.changes}`);
      return { ok: true, cancelled: r.changes };
    } catch (err) { return { ok: false, error: err.message }; }
  });
}

module.exports = register;
module.exports.ensureTable = ensureTable;
