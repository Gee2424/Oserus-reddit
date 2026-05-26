const bcrypt = require('bcryptjs');
const { getDb } = require('../db');

const sessions = new Map();

function makeToken() {
  return [...Array(48)]
    .map(() => Math.floor(Math.random() * 36).toString(36))
    .join('');
}

function userFromToken(token) {
  if (!token) return null;
  const userId = sessions.get(token);
  if (!userId) return null;
  return getDb().prepare('SELECT id, username, role, display_name FROM users WHERE id = ?').get(userId);
}

function requireAdmin(token) {
  const user = userFromToken(token);
  if (!user) throw new Error('Not authenticated');
  if (user.role !== 'admin') throw new Error('Admin only');
  return user;
}

function requireManagerOrAdmin(token) {
  const user = userFromToken(token);
  if (!user) throw new Error('Not authenticated');
  if (user.role !== 'admin' && user.role !== 'manager') throw new Error('Manager or admin only');
  return user;
}

function register(ipcMain) {

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
    return { ok: true };
  });

  ipcMain.handle('auth:me', (_e, { token }) => {
    const user = userFromToken(token);
    return user ? { ok: true, user } : { ok: false };
  });

  ipcMain.handle('auth:createUser', (_e, { token, username, password, role, displayName, email, phone, notes }) => {
    try {
      const me = requireManagerOrAdmin(token);
      // Managers can create non-admin users only
      if (me.role === 'manager' && role === 'admin') {
        throw new Error('Only admins can create other admins');
      }
      if (!['admin', 'manager', 'reddit_va', 'chatter'].includes(role)) {
        throw new Error('Invalid role');
      }
      const hash = bcrypt.hashSync(password, 10);
      const info = getDb()
        .prepare(
          'INSERT INTO users (username, password_hash, role, display_name, email, phone, notes) VALUES (?,?,?,?,?,?,?)'
        )
        .run(username, hash, role, displayName || username, email || null, phone || null, notes || null);
      return { ok: true, id: info.lastInsertRowid };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('auth:deleteUser', (_e, { token, userId }) => {
    try {
      const me = requireAdmin(token);
      if (me.id === userId) throw new Error("You can't delete yourself");
      getDb().prepare('DELETE FROM users WHERE id = ?').run(userId);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('auth:resetUserPassword', (_e, { token, userId, newPassword }) => {
    try {
      const me = requireManagerOrAdmin(token);
      // Managers can't reset admin passwords
      if (me.role === 'manager') {
        const target = getDb().prepare('SELECT role FROM users WHERE id = ?').get(userId);
        if (target && target.role === 'admin') throw new Error("Managers can't change an admin's password");
      }
      if (!newPassword || newPassword.length < 6) throw new Error('Password must be 6+ characters');
      const hash = bcrypt.hashSync(newPassword, 10);
      getDb().prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, userId);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('auth:listUsers', (_e, { token }) => {
    try {
      requireManagerOrAdmin(token);
      const users = getDb()
        .prepare('SELECT id, username, role, display_name, email, phone, notes, created_at FROM users ORDER BY created_at DESC')
        .all();
      return { ok: true, users };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('auth:updateUser', (_e, { token, userId, data }) => {
    try {
      const me = requireManagerOrAdmin(token);
      // Managers can edit non-admins, and can't promote anyone to admin
      const target = getDb().prepare('SELECT role FROM users WHERE id = ?').get(userId);
      if (me.role === 'manager') {
        if (target && target.role === 'admin') throw new Error("Managers can't edit admin accounts");
        if (data.role === 'admin') throw new Error("Managers can't promote anyone to admin");
      }
      const fields = [];
      const values = [];
      for (const key of ['display_name', 'email', 'notes', 'role']) {
        if (data[key] !== undefined) {
          fields.push(`${key} = ?`);
          values.push(data[key] || null);
        }
      }
      if (!fields.length) return { ok: true };
      values.push(userId);
      getDb().prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('auth:changePassword', (_e, { token, currentPassword, newPassword }) => {
    const user = userFromToken(token);
    if (!user) return { ok: false, error: 'Not authenticated' };
    const row = getDb().prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    if (!bcrypt.compareSync(currentPassword, row.password_hash)) {
      return { ok: false, error: 'Current password is wrong' };
    }
    if (!newPassword || newPassword.length < 6) {
      return { ok: false, error: 'New password must be 6+ characters' };
    }
    const hash = bcrypt.hashSync(newPassword, 10);
    getDb().prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);
    return { ok: true };
  });
}

module.exports = register;
module.exports.userFromToken = userFromToken;
module.exports.requireAdmin = requireAdmin;
module.exports.requireManagerOrAdmin = requireManagerOrAdmin;
