const { getDb, encryptSecret, decryptSecret } = require('../db');
const { userFromToken } = require('./auth');

function register(ipcMain) {
  ipcMain.handle('proxies:list', (_e, { token }) => {
    const user = userFromToken(token);
    if (!user) return { ok: false, error: 'Not authenticated' };
    const rows = getDb()
      .prepare('SELECT id, label, kind, host, port, username, password_encrypted, created_at FROM proxies ORDER BY label')
      .all();
    return {
      ok: true,
      proxies: rows.map(r => ({
        ...r,
        has_password: !!r.password_encrypted,
        password_encrypted: undefined,
      })),
    };
  });

  ipcMain.handle('proxies:create', (_e, args) => {
    try {
      const { token, label, kind, host, port, username, password } = args;
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      if (user.role !== 'admin' && user.role !== 'manager') throw new Error('Manager or admin only');
      if (!['http', 'https', 'socks5'].includes(kind)) throw new Error('Invalid proxy kind');
      if (!host || !port) throw new Error('Host and port required');
      const info = getDb()
        .prepare(
          'INSERT INTO proxies (label, kind, host, port, username, password_encrypted) VALUES (?,?,?,?,?,?)'
        )
        .run(label, kind, host, Number(port), username || null, encryptSecret(password));
      return { ok: true, id: info.lastInsertRowid };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('proxies:update', (_e, { token, proxyId, updates }) => {
    try {
      const user = userFromToken(token);
      if (!user || (user.role !== 'admin' && user.role !== 'manager')) throw new Error('Manager or admin only');
      const allowed = ['label', 'kind', 'host', 'port', 'username'];
      const sets = [], params = [];
      for (const k of allowed) {
        if (updates[k] !== undefined) {
          sets.push(`${k} = ?`);
          params.push(updates[k]);
        }
      }
      if (updates.password !== undefined) {
        sets.push('password_encrypted = ?');
        params.push(updates.password ? encryptSecret(updates.password) : null);
      }
      if (!sets.length) return { ok: true };
      params.push(proxyId);
      getDb().prepare(`UPDATE proxies SET ${sets.join(', ')} WHERE id = ?`).run(...params);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('proxies:delete', (_e, { token, proxyId }) => {
    try {
      const user = userFromToken(token);
      if (!user || (user.role !== 'admin' && user.role !== 'manager')) throw new Error('Manager or admin only');
      getDb().prepare('DELETE FROM proxies WHERE id = ?').run(proxyId);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // For internal use by main process to build a proxy URL for an account
  ipcMain.handle('proxies:getForAccount', (_e, { token, accountId }) => {
    const user = userFromToken(token);
    if (!user) return { ok: false, error: 'Not authenticated' };
    const row = getDb()
      .prepare(
        `SELECT px.*, a.profile_id FROM proxies px
         JOIN reddit_accounts a ON a.proxy_id = px.id
         WHERE a.id = ?`
      )
      .get(accountId);
    if (!row) return { ok: true, proxy: null };
    const password = decryptSecret(row.password_encrypted);
    const auth = row.username ? `${encodeURIComponent(row.username)}:${encodeURIComponent(password || '')}@` : '';
    const scheme = row.kind === 'socks5' ? 'socks5' : (row.kind === 'https' ? 'https' : 'http');
    return {
      ok: true,
      proxy: {
        id: row.id,
        kind: row.kind,
        host: row.host,
        port: row.port,
        url: `${scheme}://${auth}${row.host}:${row.port}`,
        rules: `${scheme}://${row.host}:${row.port}`,
        username: row.username,
        password,
      },
    };
  });
}

module.exports = register;
