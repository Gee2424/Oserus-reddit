const { getDb } = require('../db');
const { userFromToken } = require('./auth');
const protocols = require('../services/protocols');

function ensureTable() {
  const db = getDb();
  db.exec(`
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
  // Additive: template_id ties a scheduled post to a Pro template,
  // auto_generate flags rows whose title should be filled by Grok at
  // fire-time instead of stored up front.
  const cols = db.prepare('PRAGMA table_info(scheduled_posts)').all();
  const have = (n) => cols.some((c) => c.name === n);
  if (!have('template_id'))   db.exec('ALTER TABLE scheduled_posts ADD COLUMN template_id INTEGER');
  if (!have('auto_generate')) db.exec('ALTER TABLE scheduled_posts ADD COLUMN auto_generate INTEGER DEFAULT 0');
}

// Flag scheduling conflicts for a candidate (account, time) against the
// account's resolved protocol + other pending posts. Returns an array of
// human-readable warnings (empty = clean). Used by the Unified Scheduler.
function conflictsFor({ accountId, profileId, platform = 'reddit', scheduledFor, ignoreId }) {
  const warnings = [];
  let when;
  try { when = new Date(scheduledFor.replace(' ', 'T')); } catch { return warnings; }
  if (isNaN(when.getTime())) return warnings;

  const p = protocols.resolveProtocol({ platform, profileId, accountId });

  // Quiet hours
  const hour = when.getHours();
  const qs = p.quietStart, qe = p.quietEnd;
  if (qs != null && qe != null && qs !== qe) {
    const inQuiet = qs < qe ? (hour >= qs && hour < qe) : (hour >= qs || hour < qe);
    if (inQuiet) warnings.push(`Lands in quiet hours (${qs}:00–${qe}:00)`);
  }

  // Same-day cap + min-gap vs other pending posts on this account
  const others = getDb().prepare(
    `SELECT id, scheduled_for FROM scheduled_posts
     WHERE account_id = ? AND status = 'pending' AND id != ?`
  ).all(accountId, ignoreId || -1);

  const dayKey = (d) => d.toISOString().slice(0, 10);
  const sameDay = others.filter((o) => {
    try { return dayKey(new Date(o.scheduled_for.replace(' ', 'T'))) === dayKey(when); } catch { return false; }
  });
  if (p.dailyCap && sameDay.length + 1 > p.dailyCap) {
    warnings.push(`Exceeds daily cap (${sameDay.length + 1}/${p.dailyCap} that day)`);
  }

  const minGapH = p.hoursBetweenMin || 0;
  if (minGapH > 0) {
    for (const o of others) {
      try {
        const ot = new Date(o.scheduled_for.replace(' ', 'T'));
        const gapH = Math.abs(when.getTime() - ot.getTime()) / 3600000;
        if (gapH < minGapH) { warnings.push(`Within ${minGapH}h of another scheduled post`); break; }
      } catch { /* ignore */ }
    }
  }
  return warnings;
}

function register(ipcMain) {
  // Cross-account list (Unified Scheduler). No filter args = everything.
  ipcMain.handle('scheduled:list', (_e, { token, accountId, profileId, platform, status }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      ensureTable();
      let sql = `
        SELECT s.*, a.username AS account_username, a.platform AS platform,
               a.profile_id AS profile_id, p.name AS profile_name, p.avatar_color AS profile_color
        FROM scheduled_posts s
        LEFT JOIN reddit_accounts a ON a.id = s.account_id
        LEFT JOIN model_profiles p ON p.id = a.profile_id
      `;
      const params = [];
      const wheres = [];
      if (accountId) { wheres.push('s.account_id = ?'); params.push(accountId); }
      if (profileId) { wheres.push('a.profile_id = ?'); params.push(profileId); }
      if (platform) { wheres.push('a.platform = ?'); params.push(platform); }
      if (status) { wheres.push('s.status = ?'); params.push(status); }
      if (wheres.length) sql += ' WHERE ' + wheres.join(' AND ');
      sql += ' ORDER BY s.scheduled_for ASC';
      const rows = getDb().prepare(sql).all(...params);
      // Attach conflict warnings for pending rows.
      for (const r of rows) {
        if (r.status === 'pending') {
          r.conflicts = conflictsFor({
            accountId: r.account_id, profileId: r.profile_id, platform: r.platform || 'reddit',
            scheduledFor: r.scheduled_for, ignoreId: r.id,
          });
        } else r.conflicts = [];
      }
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

  // Bulk create — "send to all" cross-posting and CSV/JSON import.
  // items: [{ accountId, subreddit, title, body, kind, url, scheduledFor }]
  ipcMain.handle('scheduled:bulkCreate', (_e, { token, items }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      ensureTable();
      if (!Array.isArray(items) || !items.length) throw new Error('No items to schedule');
      const stmt = getDb().prepare(
        `INSERT INTO scheduled_posts (account_id, subreddit, title, body, kind, url, scheduled_for, created_by_user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      let created = 0; const errors = [];
      const tx = getDb().transaction((rows) => {
        for (const it of rows) {
          if (!it.accountId || !it.subreddit || !it.title || !it.scheduledFor) {
            errors.push(`Skipped (missing fields): ${it.title || it.subreddit || '?'}`);
            continue;
          }
          stmt.run(
            it.accountId, String(it.subreddit).replace(/^r\//i, '').trim(), it.title,
            it.body || null, it.kind || 'self', it.url || null, it.scheduledFor, user.id
          );
          created++;
        }
      });
      tx(items);
      return { ok: true, created, errors };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Live conflict preview for the composer (before creating).
  ipcMain.handle('scheduled:checkConflicts', (_e, { token, accountId, scheduledFor }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      ensureTable();
      const acct = getDb().prepare('SELECT platform, profile_id FROM reddit_accounts WHERE id = ?').get(accountId);
      const warnings = conflictsFor({
        accountId,
        profileId: acct?.profile_id,
        platform: acct?.platform || 'reddit',
        scheduledFor,
      });
      return { ok: true, conflicts: warnings };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Drag-to-reschedule: change time on a pending post.
  ipcMain.handle('scheduled:reschedule', (_e, { token, id, scheduledFor }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      ensureTable();
      if (!scheduledFor) throw new Error('New time required');
      getDb().prepare(
        "UPDATE scheduled_posts SET scheduled_for = ? WHERE id = ? AND status = 'pending'"
      ).run(scheduledFor, id);
      return { ok: true };
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
module.exports.ensureTable = ensureTable;
module.exports.conflictsFor = conflictsFor;
