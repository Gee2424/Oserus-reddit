const { net, session } = require('electron');
const proxyChain = require('proxy-chain');
const ipv4Bridge = require('../services/ipv4Bridge');
const { getDb, encryptSecret, decryptSecret } = require('../db');
const { userFromToken } = require('./auth');
const { requirePermission } = require('../permissions');

function ensureProxyMigrations() {
  const db = getDb();
  const cols = db.prepare('PRAGMA table_info(proxies)').all();
  const have = (n) => cols.some((c) => c.name === n);
  if (!have('last_test_ok'))      db.exec('ALTER TABLE proxies ADD COLUMN last_test_ok INTEGER');
  if (!have('last_test_at'))      db.exec('ALTER TABLE proxies ADD COLUMN last_test_at TEXT');
  if (!have('last_test_error'))   db.exec('ALTER TABLE proxies ADD COLUMN last_test_error TEXT');
  // Rotating residential support. rotation_minutes = 0 means "sticky
  // forever" — the upstream username is used verbatim. > 0 generates a
  // synthetic per-account session id that flips every N minutes, appended
  // to the username so providers like BrightData / IPRoyal / SOAX
  // rotate the exit IP on the next request after the TTL.
  // session_user_template lets the operator pick the join format, e.g.
  //   "{user}-session-{sid}"  (default, IPRoyal/SOAX)
  //   "{user}-sessid-{sid}"   (BrightData)
  //   "user-{sid}-{user}"     (Webshare)
  if (!have('rotation_minutes'))      db.exec('ALTER TABLE proxies ADD COLUMN rotation_minutes INTEGER NOT NULL DEFAULT 0');
  if (!have('session_user_template')) db.exec('ALTER TABLE proxies ADD COLUMN session_user_template TEXT');
  // Provider's "rotate exit IP now" endpoint — fxdx / IPRoyal / SOAX
  // / Webshare all expose a token URL the operator can GET to flip
  // the IP without changing the proxy host or creds. Optional.
  if (!have('rotation_url'))          db.exec('ALTER TABLE proxies ADD COLUMN rotation_url TEXT');
}

// Reach the public IP via the proxy. Resolves true if the request comes
// back with 200; otherwise records the error. 8s timeout.
//
// For SOCKS5 (and authenticated HTTP/HTTPS) we route through a local
// proxy-chain bridge — Chromium can't do SOCKS5 auth at all, and its
// HTTP login handler is fragile under cold-CONNECT. Bridge handles
// upstream auth and presents a plain-HTTP local endpoint Chromium
// trusts. Same approach sessionPrep uses for browser windows.
async function pingProxy(proxy) {
  const partition = `proxy-test-${proxy.id}-${Date.now()}`;
  const sess = session.fromPartition(partition);
  const scheme = ['http','https','socks4','socks4a','socks5','socks5h'].includes(proxy.kind) ? proxy.kind : 'http';
  const pw = proxy.username ? (decryptSecret(proxy.password_encrypted) || '') : null;

  let proxyRules;
  if (proxy.username) {
    try {
      // Universal bridge — works for any upstream scheme. Test result
      // reflects what real traffic sees: same IPv4 exit, no AAAA path.
      const bridge = await ipv4Bridge.getOrCreateBridge({
        scheme,
        host: proxy.host, port: Number(proxy.port),
        username: proxy.username, password: pw,
      });
      proxyRules = bridge.url;
    } catch (e) {
      return { ok: false, error: `Bridge spin-up failed: ${e.message}` };
    }
  } else {
    proxyRules = `${scheme}://${proxy.host}:${proxy.port}`;
  }

  await sess.setProxy({ proxyRules, proxyBypassRules: 'localhost,127.0.0.1' });
  // Defensive login handler — bridge already handles auth, but a few
  // providers issue a mid-stream auth challenge.
  if (proxy.username) {
    sess.removeAllListeners('login');
    sess.on('login', (_e, _details, _info, cb) => cb(proxy.username, pw));
  }
  return new Promise((resolve) => {
    const cleanup = async () => {
      // Universal bridge stays cached across tests; closed on app quit.
    };
    const t = setTimeout(() => {
      try { req.abort(); } catch { /* noop */ }
      cleanup().finally(() => resolve({ ok: false, error: 'Timed out after 8s' }));
    }, 8000);
    const req = net.request({ method: 'GET', url: 'https://api.ipify.org?format=json', session: sess });
    req.setHeader('User-Agent', 'Oserus/proxy-test');
    let body = '';
    req.on('response', (res) => {
      res.on('data', (c) => { body += c.toString(); });
      res.on('end', () => {
        clearTimeout(t);
        if (res.statusCode >= 200 && res.statusCode < 300) {
          let ip = null; try { ip = JSON.parse(body).ip; } catch { /* noop */ }
          cleanup().finally(() => resolve({ ok: true, ip }));
        } else {
          cleanup().finally(() => resolve({ ok: false, error: `HTTP ${res.statusCode}` }));
        }
      });
    });
    req.on('error', (e) => {
      clearTimeout(t);
      cleanup().finally(() => resolve({ ok: false, error: e.message }));
    });
    req.end();
  });
}

function register(ipcMain) {
  ensureProxyMigrations();
  ipcMain.handle('proxies:list', (_e, { token }) => {
    const user = userFromToken(token);
    if (!user) return { ok: false, error: 'Not authenticated' };
    ensureProxyMigrations();
    const rows = getDb()
      .prepare(`SELECT id, label, kind, host, port, username, password_encrypted, created_at,
                       last_test_ok, last_test_at, last_test_error,
                       rotation_minutes, session_user_template, rotation_url
                FROM proxies ORDER BY label`)
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

  ipcMain.handle('proxies:test', async (_e, { token, proxyId }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      ensureProxyMigrations();
      const row = getDb().prepare('SELECT * FROM proxies WHERE id = ?').get(proxyId);
      if (!row) throw new Error('Proxy not found');
      const result = await pingProxy(row);
      getDb().prepare(
        "UPDATE proxies SET last_test_ok = ?, last_test_at = datetime('now'), last_test_error = ? WHERE id = ?"
      ).run(result.ok ? 1 : 0, result.ok ? null : (result.error || 'unknown'), proxyId);
      return { ok: true, result };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('proxies:testAll', async (_e, { token }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      ensureProxyMigrations();
      const rows = getDb().prepare('SELECT * FROM proxies').all();
      const stmt = getDb().prepare(
        "UPDATE proxies SET last_test_ok = ?, last_test_at = datetime('now'), last_test_error = ? WHERE id = ?"
      );
      let okN = 0, failN = 0;
      for (const r of rows) {
        const res = await pingProxy(r);
        stmt.run(res.ok ? 1 : 0, res.ok ? null : (res.error || 'unknown'), r.id);
        if (res.ok) okN++; else failN++;
      }
      return { ok: true, tested: rows.length, okN, failN };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('proxies:create', (_e, args) => {
    try {
      const { token, label, kind, host, port, username, password,
              rotation_minutes, session_user_template, rotation_url } = args;
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      requirePermission(user, 'infra.proxies.manage');
      if (!['http', 'https', 'socks5', 'socks4'].includes(kind)) throw new Error('Invalid proxy kind');
      if (!host || !port) throw new Error('Host and port required');
      const info = getDb()
        .prepare(
          `INSERT INTO proxies
             (label, kind, host, port, username, password_encrypted,
              rotation_minutes, session_user_template, rotation_url)
           VALUES (?,?,?,?,?,?,?,?,?)`
        )
        .run(
          label, kind, host, Number(port), username || null, encryptSecret(password),
          Math.max(0, Number(rotation_minutes) || 0),
          session_user_template || null,
          rotation_url || null,
        );
      return { ok: true, id: info.lastInsertRowid };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('proxies:update', (_e, { token, proxyId, updates }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      requirePermission(user, 'infra.proxies.manage');
      const allowed = ['label', 'kind', 'host', 'port', 'username', 'rotation_minutes', 'session_user_template', 'rotation_url'];
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

  // Hit the provider's "rotate exit IP now" endpoint. Uses the default
  // session so the call goes out via the operator's network (the
  // rotation endpoint itself is the provider's control plane, NOT the
  // proxy tunnel). Returns the HTTP status / response body so the
  // operator can see whether the provider accepted the flip.
  ipcMain.handle('proxies:rotate', async (_e, { token, proxyId }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      requirePermission(user, 'infra.proxies.manage');
      const row = getDb().prepare('SELECT rotation_url, label FROM proxies WHERE id = ?').get(proxyId);
      if (!row) throw new Error('Proxy not found');
      if (!row.rotation_url) throw new Error('No rotation URL configured for this proxy');
      const result = await new Promise((resolve) => {
        const t = setTimeout(() => { try { req.abort(); } catch {} resolve({ ok: false, error: 'Timed out' }); }, 10000);
        const req = net.request({ method: 'GET', url: row.rotation_url });
        req.setHeader('User-Agent', 'Oserus/proxy-rotate');
        let body = '';
        req.on('response', (res) => {
          res.on('data', (c) => { body += c.toString(); });
          res.on('end', () => {
            clearTimeout(t);
            resolve({ ok: res.statusCode >= 200 && res.statusCode < 400, status: res.statusCode, body: body.slice(0, 400) });
          });
        });
        req.on('error', (e) => { clearTimeout(t); resolve({ ok: false, error: e.message }); });
        req.end();
      });
      return { ok: true, result };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('proxies:delete', (_e, { token, proxyId }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      requirePermission(user, 'infra.proxies.manage');
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
