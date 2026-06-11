const { ipcMain } = require('electron');
const { getDb } = require('../db');
const { userFromToken } = require('./auth');
const { requirePermission, invalidate } = require('../permissions');
const {
  PERMISSIONS, PERMISSION_KEYS, BUILTIN_ROLE_KEYS,
} = require('../../shared/permissions');

function listRoles() {
  const db = getDb();
  const roles = db.prepare(
    "SELECT key, label, description, is_builtin, created_at FROM roles WHERE key != 'admin' ORDER BY label"
  ).all();
  const perms = db.prepare('SELECT role_key, perm_key FROM role_permissions').all();
  const userCounts = db.prepare(
    'SELECT role AS role_key, COUNT(*) AS c FROM users GROUP BY role'
  ).all();
  const byRole = {};
  for (const { role_key, perm_key } of perms) {
    (byRole[role_key] = byRole[role_key] || []).push(perm_key);
  }
  const countByRole = {};
  for (const { role_key, c } of userCounts) countByRole[role_key] = c;
  return roles.map((r) => ({
    ...r,
    is_builtin: !!r.is_builtin,
    permissions: byRole[r.key] || [],
    user_count: countByRole[r.key] || 0,
  }));
}

function validateKey(key) {
  if (!key || typeof key !== 'string') throw new Error('Role key required');
  if (!/^[a-z][a-z0-9_]{1,31}$/.test(key)) {
    throw new Error('Role key must be lowercase letters/numbers/underscores, starting with a letter (max 32 chars)');
  }
}

function register() {
  ipcMain.handle('roles:list', async (_e, { token }) => {
    try {
      const user = userFromToken(token);
      requirePermission(user, 'roles.manage');
      return { ok: true, roles: listRoles(), permissions: PERMISSIONS };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('roles:create', async (_e, { token, key, label, description, permissions }) => {
    try {
      const user = userFromToken(token);
      requirePermission(user, 'roles.manage');
      validateKey(key);
      if (key === 'admin') throw new Error('Reserved key');
      const db = getDb();
      const exists = db.prepare('SELECT 1 FROM roles WHERE key = ?').get(key);
      if (exists) throw new Error('A role with that key already exists');
      const perms = Array.isArray(permissions) ? permissions.filter((p) => PERMISSION_KEYS.includes(p)) : [];
      const tx = db.transaction(() => {
        db.prepare('INSERT INTO roles (key, label, description, is_builtin) VALUES (?, ?, ?, 0)')
          .run(key, label || key, description || '');
        const ins = db.prepare('INSERT INTO role_permissions (role_key, perm_key) VALUES (?, ?)');
        for (const p of perms) ins.run(key, p);
      });
      tx();
      invalidate();
      return { ok: true, roles: listRoles() };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('roles:update', async (_e, { token, key, label, description, permissions }) => {
    try {
      const user = userFromToken(token);
      requirePermission(user, 'roles.manage');
      if (key === 'admin') throw new Error('Cannot edit the admin bootstrap role');
      const db = getDb();
      const row = db.prepare('SELECT key FROM roles WHERE key = ?').get(key);
      if (!row) throw new Error('Role not found');
      const perms = Array.isArray(permissions) ? permissions.filter((p) => PERMISSION_KEYS.includes(p)) : null;
      const tx = db.transaction(() => {
        if (label !== undefined || description !== undefined) {
          db.prepare('UPDATE roles SET label = COALESCE(?, label), description = COALESCE(?, description) WHERE key = ?')
            .run(label ?? null, description ?? null, key);
        }
        if (perms) {
          db.prepare('DELETE FROM role_permissions WHERE role_key = ?').run(key);
          const ins = db.prepare('INSERT INTO role_permissions (role_key, perm_key) VALUES (?, ?)');
          for (const p of perms) ins.run(key, p);
        }
      });
      tx();
      invalidate();
      return { ok: true, roles: listRoles() };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('roles:delete', async (_e, { token, key }) => {
    try {
      const user = userFromToken(token);
      requirePermission(user, 'roles.manage');
      if (key === 'admin') throw new Error('Cannot delete the admin bootstrap role');
      const db = getDb();
      const inUse = db.prepare('SELECT COUNT(*) AS c FROM users WHERE role = ?').get(key).c;
      if (inUse > 0) throw new Error(`${inUse} user(s) still have this role — reassign them first`);
      db.prepare('DELETE FROM role_permissions WHERE role_key = ?').run(key);
      db.prepare('DELETE FROM roles WHERE key = ?').run(key);
      invalidate();
      return { ok: true, roles: listRoles() };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  // Used by the renderer to know which permissions the CURRENT user has, plus
  // (for admins) to preview as another role.
  ipcMain.handle('roles:myPermissions', async (_e, { token, previewRoleKey }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      const db = getDb();
      let roleKey = user.role;
      let previewing = false;
      if (previewRoleKey && previewRoleKey !== user.role) {
        // Only roles.manage holders can preview as another role.
        const { hasPermission } = require('../permissions');
        if (!hasPermission(user, 'roles.manage')) throw new Error('Preview requires roles.manage');
        const exists = db.prepare('SELECT 1 FROM roles WHERE key = ?').get(previewRoleKey);
        if (exists) {
          roleKey = previewRoleKey;
          previewing = true;
        }
      }
      const perms = db.prepare('SELECT perm_key FROM role_permissions WHERE role_key = ?')
        .all(roleKey).map((r) => r.perm_key);
      return { ok: true, role: roleKey, permissions: perms, previewing };
    } catch (err) { return { ok: false, error: err.message }; }
  });
}

module.exports = register;
