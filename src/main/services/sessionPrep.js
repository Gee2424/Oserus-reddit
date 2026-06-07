// Session preparation for any platform-bound account.
//
// Resolves the account's proxy (account-level, falling back to the
// model's proxy), generates / loads the antidetect fingerprint,
// installs the session preload that spoofs navigator / screen / WebGL
// / Canvas / Audio / timezone in the main world before any page script
// runs, and wires the proxy + login handler in the right order so the
// first 407 Proxy-Auth-Required challenge gets answered.
//
// Lives here rather than main/index.js so engagement, autoComment,
// intelligence scrapes, etc. can prep without back-reaching into the
// bootstrap module.

const { session } = require('electron');
const elog = require('electron-log');
const fs = require('fs');
const { getDb, decryptSecret } = require('../db');
const fingerprintMod = require('../fingerprint');
const { writePreloadFor } = require('../antidetectPreload');

// Per-partition tracking so we only loadExtension once per session. The
// Electron API does not expose listExtensions on a fresh partition, so we
// remember our own loads. WeakRef-equivalent via partition key string.
const loadedExtensionsByPartition = new Map(); // partition -> Set<path>

// Track configured partitions so we can skip redundant work on re-prep.
const configuredPartitions = new Set();

// Build the username sent to the proxy. When rotation_minutes > 0, append
// a synthetic session id that flips every TTL — the upstream provider
// rotates the exit IP on the next request after the join changes. Account
// id is mixed in so different accounts on the same proxy never collide.
function buildRotatingUsername(account) {
  const base = account.proxy_username;
  const mins = Number(account.proxy_rotation_minutes) || 0;
  if (!base || mins <= 0) return base;
  const bucket = Math.floor(Date.now() / (mins * 60 * 1000));
  const sid = `${account.id}${bucket.toString(36)}`;
  const tmpl = account.proxy_session_user_template || '{user}-session-{sid}';
  return tmpl.replace('{user}', base).replace('{sid}', sid);
}

async function prepareSessionForAccount(accountId) {
  if (!accountId) return { ok: false, error: 'No accountId' };
  const db = getDb();
  // Account proxy wins; fall back to the model's proxy so a single
  // proxy set at the model level routes every account under it.
  const account = db.prepare(
    `SELECT a.*,
            px.kind AS proxy_kind, px.host AS proxy_host, px.port AS proxy_port,
            px.username AS proxy_username, px.password_encrypted AS proxy_pw_enc,
            px.rotation_minutes AS proxy_rotation_minutes,
            px.session_user_template AS proxy_session_user_template
     FROM reddit_accounts a
     LEFT JOIN model_profiles mp ON mp.id = a.profile_id
     LEFT JOIN proxies px ON px.id = COALESCE(a.proxy_id, mp.proxy_id)
     WHERE a.id = ?`
  ).get(accountId);
  if (!account) return { ok: false, error: 'Account not found' };

  const partition = `persist:${account.partition_key}`;
  const sess = session.fromPartition(partition);

  // Antidetect fingerprint — load (or generate + persist on first use)
  // and apply at every layer: User-Agent + Accept-Language at the network
  // boundary; navigator / screen / WebGL / Canvas / Audio / timezone via
  // a session-scoped preload that runs before any page script.
  const fp = fingerprintMod.loadOrCreate(db, accountId);
  sess.setUserAgent(account.user_agent || fp.userAgent, fp.acceptLanguage);
  try {
    const preloadPath = writePreloadFor(account.partition_key, fp);
    sess.setPreloads([preloadPath]);
  } catch (e) {
    elog.warn('[antidetect] preload write failed', e?.message);
  }

  // Apply proxy. Electron's proxy story is finicky — three things matter:
  //   1. Register the 'login' handler BEFORE setProxy so the first 407
  //      Proxy-Auth-Required challenge gets answered. If we register
  //      after, the initial CONNECT can fail with
  //      ERR_TUNNEL_CONNECTION_FAILED.
  //   2. proxyBypassRules: '<-loopback>' (Chromium-speak for "DO route
  //      loopback through the proxy") was wrong — it forced local
  //      renderer fetches into the tunnel which on some providers fails
  //      the handshake. Default bypass is fine; localhost stays local,
  //      everything else routes through the proxy.
  //   3. For SOCKS5, Electron does NOT consume creds from the proxy URL
  //      — auth has to come through the login event. Same handler
  //      covers HTTP/HTTPS too, so one path works for every scheme.
  if (account.proxy_host && account.proxy_port) {
    const scheme = account.proxy_kind === 'socks5' ? 'socks5'
      : (account.proxy_kind === 'https' ? 'https' : 'http');
    const rules = `${scheme}://${account.proxy_host}:${account.proxy_port}`;

    sess.removeAllListeners('login');
    if (account.proxy_username) {
      const password = decryptSecret(account.proxy_pw_enc) || '';
      const username = buildRotatingUsername(account);
      sess.on('login', (event, _details, authInfo, callback) => {
        if (authInfo && authInfo.isProxy) {
          event.preventDefault();
          callback(username, password);
        }
      });
    }

    try {
      await sess.setProxy({ proxyRules: rules, proxyBypassRules: 'localhost,127.0.0.1' });
    } catch (e) {
      elog.error('[proxy] setProxy failed', {
        accountId, host: account.proxy_host, port: account.proxy_port, error: e?.message,
      });
      return { ok: false, error: `Proxy config rejected: ${e?.message || e}` };
    }
  } else {
    sess.removeAllListeners('login');
    await sess.setProxy({ proxyRules: '' });
  }

  // Chrome extensions opted in by the operator. Loaded per-partition so
  // each profile gets its own extension state (storage, cookies, badge).
  await loadEnabledExtensions(sess, partition);

  configuredPartitions.add(partition);
  return { ok: true, partition, partitionKey: account.partition_key };
}

async function loadEnabledExtensions(sess, partition) {
  let rows = [];
  try {
    rows = getDb().prepare(
      `SELECT id, path FROM browser_extensions WHERE enabled = 1`
    ).all();
  } catch {
    return; // table may not exist yet (first run before any extension added)
  }
  if (!rows.length) return;
  let loaded = loadedExtensionsByPartition.get(partition);
  if (!loaded) { loaded = new Set(); loadedExtensionsByPartition.set(partition, loaded); }
  for (const r of rows) {
    if (loaded.has(r.path)) continue;
    try {
      if (!fs.existsSync(r.path)) { elog.warn('[ext] path missing', r.path); continue; }
      await sess.loadExtension(r.path, { allowFileAccess: true });
      loaded.add(r.path);
    } catch (e) {
      elog.warn('[ext] loadExtension failed', r.path, e?.message);
    }
  }
}

module.exports = { prepareSessionForAccount, configuredPartitions };
