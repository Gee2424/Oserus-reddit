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
const { getDb, decryptSecret } = require('../db');
const fingerprintMod = require('../fingerprint');
const { writePreloadFor } = require('../antidetectPreload');

// Track configured partitions so we can skip redundant work on re-prep.
const configuredPartitions = new Set();

async function prepareSessionForAccount(accountId) {
  if (!accountId) return { ok: false, error: 'No accountId' };
  const db = getDb();
  // Account proxy wins; fall back to the model's proxy so a single
  // proxy set at the model level routes every account under it.
  const account = db.prepare(
    `SELECT a.*,
            px.kind AS proxy_kind, px.host AS proxy_host, px.port AS proxy_port,
            px.username AS proxy_username, px.password_encrypted AS proxy_pw_enc
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
      sess.on('login', (event, _details, authInfo, callback) => {
        if (authInfo && authInfo.isProxy) {
          event.preventDefault();
          callback(account.proxy_username, password);
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

  configuredPartitions.add(partition);
  return { ok: true, partition, partitionKey: account.partition_key };
}

module.exports = { prepareSessionForAccount, configuredPartitions };
