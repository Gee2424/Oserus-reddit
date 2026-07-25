const { getDb } = require('./db');
const { BUILTIN_ROLES } = require('../shared/permissions');

// Pre-compute built-in role permission sets (static, never changes)
const builtinPerms = {};
for (const r of BUILTIN_ROLES) {
  builtinPerms[r.key] = new Set(r.permissions);
}

let cache = null;
let cacheStamp = 0;
const CACHE_MS = 5000;

function loadAll() {
  const now = Date.now();
  if (cache && now - cacheStamp < CACHE_MS) return cache;
  const db = getDb();
  const rows = db.prepare('SELECT role_key, perm_key FROM role_permissions').all();
  const byRole = {};
  for (const { role_key, perm_key } of rows) {
    (byRole[role_key] = byRole[role_key] || new Set()).add(perm_key);
  }
  cache = byRole;
  cacheStamp = now;
  return byRole;
}

function invalidate() {
  cache = null;
}

function hasPermission(user, key) {
  if (!user || !user.role) return false;
  // Built-in roles always have their configured permissions
  const b = builtinPerms[user.role];
  if (b && b.has(key)) return true;
  // Fall back to database (custom roles)
  const byRole = loadAll();
  const set = byRole[user.role];
  return !!(set && set.has(key));
}

function requirePermission(user, key) {
  if (!hasPermission(user, key)) {
    const err = new Error(`Missing permission: ${key}`);
    err.code = 'EPERM';
    throw err;
  }
}

function permissionsForRole(roleKey) {
  const byRole = loadAll();
  return Array.from(byRole[roleKey] || []);
}

module.exports = { hasPermission, requirePermission, permissionsForRole, invalidate };
