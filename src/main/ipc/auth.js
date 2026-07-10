const bcrypt = require('bcryptjs');
const { getDb } = require('../db');

// Presence + time-on-task schema. Idempotent: extra columns are
// added once on first heartbeat. Applies to every user automatically
// (any new employee created later inherits them by the same ALTER).
//
//   last_seen_at    Most recent heartbeat from any window owned by
//                   this user (app or Oserus Browser).
//   last_action_at  Most recent moment the user actually interacted
//                   (click / key / scroll / IPC mutation). Used to
//                   decide "active vs idle" — > 5 min idle → paused.
//   today_seconds   Cumulative active seconds since today_date.
//                   Only incremented when the user is active.
//   today_date      YYYY-MM-DD of the day today_seconds represents.
//                   Roll-over zeroes today_seconds.
let presenceMigrated = false;
function ensurePresenceColumns() {
  if (presenceMigrated) return;
  const db = getDb();
  const cols = db.prepare(`PRAGMA table_info(users)`).all().map((c) => c.name);
  const add = (sql) => { try { db.exec(sql); } catch (e) { if (!/duplicate column/i.test(e?.message || '')) throw e; } };
  if (!cols.includes('last_seen_at'))   add(`ALTER TABLE users ADD COLUMN last_seen_at TEXT`);
  if (!cols.includes('last_action_at')) add(`ALTER TABLE users ADD COLUMN last_action_at TEXT`);
  if (!cols.includes('today_seconds'))  add(`ALTER TABLE users ADD COLUMN today_seconds INTEGER NOT NULL DEFAULT 0`);
  if (!cols.includes('today_date'))     add(`ALTER TABLE users ADD COLUMN today_date TEXT`);
  presenceMigrated = true;
}

// 5-minute idle window. Tuned to the user's spec: if no input for 5
// minutes, the timer pauses; it resumes the next time they do anything.
const IDLE_GAP_MS = 5 * 60 * 1000;

// Per-user in-memory accumulator. We compute "seconds to add" as the
// gap between this heartbeat and the previous one, capped at the
// renderer's heartbeat interval, and only counted when active.
const lastBeat = new Map(); // user_id → { t, lastActionAt }

function todayLocal() {
  // YYYY-MM-DD in the operator's local timezone — matches "today's"
  // hours from the user's perspective even across midnight UTC.
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}

// Sessions are mirrored to SQLite so that closing/restarting the app doesn't
// log everyone out. The in-memory Map is a write-through cache.
const sessions = new Map();

function ensureSessionsTable() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS auth_sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

function loadSessionsFromDisk() {
  ensureSessionsTable();
  const rows = getDb().prepare('SELECT token, user_id FROM auth_sessions').all();
  for (const r of rows) sessions.set(r.token, r.user_id);
}

function persistSession(token, userId) {
  ensureSessionsTable();
  getDb().prepare('INSERT OR REPLACE INTO auth_sessions (token, user_id) VALUES (?, ?)').run(token, userId);
}

function deleteSession(token) {
  ensureSessionsTable();
  getDb().prepare('DELETE FROM auth_sessions WHERE token = ?').run(token);
}

function makeToken() {
  return [...Array(48)]
    .map(() => Math.floor(Math.random() * 36).toString(36))
    .join('');
}

function userFromToken(token) {
  if (token) {
    let userId = sessions.get(token);
    if (!userId) {
      ensureSessionsTable();
      const row = getDb().prepare('SELECT user_id FROM auth_sessions WHERE token = ?').get(token);
      if (row) {
        userId = row.user_id;
        sessions.set(token, userId);
        return getDb().prepare('SELECT id, username, role, display_name FROM users WHERE id = ?').get(userId);
      }
    } else {
      return getDb().prepare('SELECT id, username, role, display_name FROM users WHERE id = ?').get(userId);
    }
  }
  // Fall back to Supabase session if no local token found
  try {
    const { getSessionUser } = require('./teamAuth');
    const su = getSessionUser();
    if (su) {
      const db = getDb();
      const localUser = db.prepare('SELECT id FROM users WHERE email = ?').get(su.email);
      return {
        id: su.id,
        localId: localUser?.id || null,
        username: su.email || '',
        role: su.role || 'member',
        display_name: su.display_name || su.email || '',
      };
    }
  } catch {}
  return null;
}

const { hasPermission, requirePermission } = require('../permissions');

function requireAdmin(token) {
  const user = userFromToken(token);
  if (!user) throw new Error('Not authenticated');
  // Legacy helper — kept for callers that gate top-level admin actions. The
  // permission 'users.manage' is the canonical "can manage other users" check.
  requirePermission(user, 'users.manage');
  return user;
}

function requireManagerOrAdmin(token) {
  const user = userFromToken(token);
  if (!user) throw new Error('Not authenticated');
  requirePermission(user, 'users.manage');
  return user;
}

function register(ipcMain) {
  // Hydrate the in-memory cache from disk so existing logins survive restart
  try { loadSessionsFromDisk(); } catch {}

  ipcMain.handle('auth:login', (_e, { username, password }) => {
    const row = getDb()
      .prepare('SELECT * FROM users WHERE username = ?')
      .get(username);
    if (!row) return { ok: false, error: 'Invalid credentials' };
    if (!bcrypt.compareSync(password, row.password_hash)) {
      return { ok: false, error: 'Invalid credentials' };
    }
    const token = makeToken();
    sessions.set(token, row.id);
    persistSession(token, row.id);
    return {
      ok: true,
      token,
      user: {
        id: row.id,
        username: row.username,
        role: row.role,
        display_name: row.display_name,
      },
    };
  });

  ipcMain.handle('auth:logout', (_e, { token }) => {
    sessions.delete(token);
    deleteSession(token);
    return { ok: true };
  });

  ipcMain.handle('auth:me', (_e, { token }) => {
    const user = userFromToken(token);
    return user ? { ok: true, user } : { ok: false };
  });

  // Heartbeat — renderer (and Oserus Browser windows) ping this every
  // ~20s carrying their own "last user input" timestamp. We add the
  // elapsed gap to today_seconds only if the input was within
  // IDLE_GAP_MS (5 min). Otherwise the timer pauses.
  //
  // Multiple windows for the same user merge naturally: each beat
  // updates last_action_at to the most recent across all sources, and
  // the per-user lastBeat cache makes sure we don't double-count when
  // two windows tick at almost the same time.
  ipcMain.handle('auth:heartbeat', (_e, { token, lastActionAt, source } = {}) => {
    try {
      const user = userFromToken(token);
      if (!user) return { ok: false };
      ensurePresenceColumns();
      const db = getDb();

      const now = Date.now();
      const inputAt = Number(lastActionAt) || now;
      const isActive = (now - inputAt) <= IDLE_GAP_MS;

      // Roll over today_seconds at local midnight.
      const today = todayLocal();
      const row = db.prepare(
        `SELECT today_seconds, today_date, last_action_at FROM users WHERE id = ?`
      ).get(user.id) || {};
      if (row.today_date !== today) {
        db.prepare(`UPDATE users SET today_seconds = 0, today_date = ? WHERE id = ?`).run(today, user.id);
        row.today_seconds = 0;
      }

      // Active-seconds delta: time since last beat, capped at 30s so a
      // closed-laptop gap doesn't credit hours when the app wakes up.
      let add = 0;
      const prev = lastBeat.get(user.id);
      if (isActive && prev) {
        add = Math.min(30, Math.max(0, Math.round((now - prev.t) / 1000)));
      }
      lastBeat.set(user.id, { t: now, lastActionAt: inputAt });

      const newSeconds = (row.today_seconds || 0) + add;
      const newAction = isActive
        ? new Date(inputAt).toISOString().replace('T', ' ').slice(0, 19)
        : row.last_action_at;

      db.prepare(`
        UPDATE users
           SET last_seen_at   = datetime('now'),
               last_action_at = COALESCE(?, last_action_at),
               today_seconds  = ?,
               today_date     = ?
         WHERE id = ?
      `).run(newAction || null, newSeconds, today, user.id);

      return { ok: true, active: isActive, todaySeconds: newSeconds, source: source || 'app' };
    } catch (e) {
      return { ok: false, error: e?.message };
    }
  });

  // ─── Legacy local auth handlers — demoted. Use teamAuth channels instead.
  // These return "not available" to prevent accidental use of the old system.
  ipcMain.handle('auth:createUser', () => ({ ok: false, error: 'Use Team → Add member instead' }));
  ipcMain.handle('auth:deleteUser', () => ({ ok: false, error: 'Use Team → Remove member instead' }));
  ipcMain.handle('auth:resetUserPassword', () => ({ ok: false, error: 'Use teamAuth:changePassword instead' }));
  ipcMain.handle('auth:listUsers', () => ({ ok: false, error: 'Use team:listMembers instead' }));
  ipcMain.handle('auth:updateUser', () => ({ ok: false, error: 'Use team:changeRole instead' }));
  ipcMain.handle('auth:changePassword', () => ({ ok: false, error: 'Use teamAuth:changePassword instead' }));
}

// Browser-side beat — called by main/browser.js for any user with at
// least one open Oserus Browser window. Reuses the active-time
// accumulator so app + browser seconds merge into one today_seconds.
function tickBrowserHeartbeat(userId) {
  if (!userId) return;
  try {
    ensurePresenceColumns();
    const db = getDb();
    const now = Date.now();
    const today = todayLocal();
    const row = db.prepare(`SELECT today_seconds, today_date FROM users WHERE id = ?`).get(userId) || {};
    if (row.today_date !== today) {
      db.prepare(`UPDATE users SET today_seconds = 0, today_date = ? WHERE id = ?`).run(today, userId);
      row.today_seconds = 0;
    }
    const prev = lastBeat.get(userId);
    const add = prev ? Math.min(30, Math.max(0, Math.round((now - prev.t) / 1000))) : 0;
    lastBeat.set(userId, { t: now, lastActionAt: now });
    db.prepare(`
      UPDATE users
         SET last_seen_at   = datetime('now'),
             last_action_at = datetime('now'),
             today_seconds  = ?,
             today_date     = ?
       WHERE id = ?
    `).run((row.today_seconds || 0) + add, today, userId);
  } catch {}
}

module.exports = register;
module.exports.userFromToken = userFromToken;
module.exports.requireAdmin = requireAdmin;
module.exports.requireManagerOrAdmin = requireManagerOrAdmin;
module.exports.tickBrowserHeartbeat = tickBrowserHeartbeat;
