const { app, BrowserWindow, ipcMain, session, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const elog = require('electron-log');
const { initDatabase, getDb, decryptSecret } = require('./db');
const { initAutoUpdater, quitAndInstall, stopAutoUpdater, checkNow } = require('./updater');
const { createTray, destroyTray, markQuitting, isAppQuitting, setUpdateReady } = require('./tray');

// Network-layer errors (ERR_TUNNEL_CONNECTION_FAILED from dead proxies, the
// updater hitting an unreachable host, etc.) bubble up as uncaught exceptions
// in the main process when nothing awaits them. Without this they pop a
// modal "A JavaScript error occurred in the main process" dialog. Swallow
// known-transient network errors, log everything, and only re-show the
// dialog for real programming errors.
const BENIGN_NET_PATTERNS = [
  /ERR_TUNNEL_CONNECTION_FAILED/,
  /ERR_PROXY_CONNECTION_FAILED/,
  /ERR_CONNECTION_REFUSED/,
  /ERR_CONNECTION_RESET/,
  /ERR_CONNECTION_TIMED_OUT/,
  /ERR_NETWORK_CHANGED/,
  /ERR_INTERNET_DISCONNECTED/,
  /ERR_NAME_NOT_RESOLVED/,
  /ERR_CERT_/,
  /ERR_ABORTED/,
];
function isBenignNet(err) {
  const msg = (err && (err.message || String(err))) || '';
  return BENIGN_NET_PATTERNS.some((re) => re.test(msg));
}
process.on('unhandledRejection', (reason) => {
  if (isBenignNet(reason)) { elog.warn('[net] unhandled rejection:', reason && reason.message); return; }
  elog.error('[main] unhandled rejection:', reason);
});
process.on('uncaughtException', (err) => {
  if (isBenignNet(err)) { elog.warn('[net] uncaught:', err && err.message); return; }
  elog.error('[main] uncaught exception:', err);
});

const registerAuthHandlers = require('./ipc/auth');
const registerProfileHandlers = require('./ipc/profiles');
const registerAccountHandlers = require('./ipc/accounts');
const registerWebviewHandlers = require('./ipc/webviews');
const registerPostHandlers = require('./ipc/posts');
const registerProxyHandlers = require('./ipc/proxies');
const registerExtensionHandlers = require('./ipc/extensions');
const registerHomepageHandlers = require('./ipc/homepage');
const registerBundleHandlers = require('./ipc/bundle');
const registerAiHandlers = require('./ipc/ai');
const registerSubsHandlers = require('./ipc/subs');
const registerVotesHandlers = require('./ipc/votes');
const registerDocsHandlers = require('./ipc/docs');
const registerScheduledHandlers = require('./ipc/scheduled');
const registerAnalyticsHandlers = require('./ipc/analytics');
const registerActivityHandlers = require('./ipc/activity');
const registerTeamHandlers = require('./ipc/team');
const registerRedditHandlers = require('./ipc/reddit');
const registerRolesHandlers = require('./ipc/roles');
const registerInboxHandlers = require('./ipc/inbox');
const registerProtocolHandlers = require('./ipc/protocols');
const registerIntelHandlers = require('./ipc/intelligence');
const registerTemplateHandlers = require('./ipc/templates');
const registerRedgifsHandlers = require('./ipc/redgifs');
const registerMessagingHandlers = require('./ipc/messaging');
const registerExamplesHandlers = require('./ipc/examples');
const registerEngagementHandlers = require('./ipc/engagement');
const registerAutoCommentHandlers = require('./ipc/autoComment');
const registerAutopilotProtocolHandlers = require('./ipc/autopilotProtocol');
const registerCloudHandlers = require('./ipc/cloud');
const registerDeviceHandlers = require('./ipc/devices');
const coordinator = require('./services/coordinator');
const oserusBrowser = require('./browser');
const { buildAutofillScript } = require('./autofill');
const fingerprintMod = require('./fingerprint');

// WebRTC IP-leak guard. The strictest policy: disable any UDP that
// can't go through the proxy. Combined with our preload's
// RTCPeerConnection patch (which strips host/srflx candidates revealing
// the local network), this makes "Proxy: Yes" disappear from
// BrowserScan because there's no observable mismatch between the public
// IP and what WebRTC reports — they both come from the proxy or
// nothing. Must be applied before app.whenReady().
app.commandLine.appendSwitch('webrtc-ip-handling-policy', 'disable_non_proxied_udp');
app.commandLine.appendSwitch('force-webrtc-ip-handling-policy', 'disable_non_proxied_udp');

// Anti-fingerprint / leak hardening.
//   - Disable QUIC. QUIC uses UDP and can bypass HTTP/SOCKS proxies that
//     only handle TCP — net result is leaks to Google et al. over UDP/443
//     while everything else routes via proxy. The IPv6 leak in Google's
//     captcha screen was likely this path.
//   - Disable async DNS / DoH so the OS resolver (which the proxy can
//     control) handles lookups instead of Chromium issuing its own.
//   - WebRtcHideLocalIpsWithMdns sometimes leaks the mDNS-obfuscated
//     name; turning the feature off forces public-only candidates.
//   - Prefetching of any kind bypasses proxy enforcement for the early
//     speculative connections.
app.commandLine.appendSwitch('disable-quic');
app.commandLine.appendSwitch('disable-features', [
  'AsyncDns',
  'DnsHttpsSvcb',
  'UseDnsHttpsSvcbAlpn',
  'WebRtcHideLocalIpsWithMdns',
  'NetworkPredictionService',
  'PrefetchPrivacyChanges',
].join(','));
app.commandLine.appendSwitch('no-pings');
app.commandLine.appendSwitch('dns-prefetch-disable');

// Node-level DNS preference: any net.request / fetch the main process
// makes outside Chromium prefers IPv4 records. Belt for the IPv4 bridge
// — when fxdx / IPRoyal / etc. give us a hostname with both A and AAAA
// records, we resolve to A.
try { require('dns').setDefaultResultOrder('ipv4first'); } catch {}

const isDev = !app.isPackaged;
let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#0d0c0a',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
  }

  // Throttle any <webview> attached to the management window — a few
  // legacy renderer components still use them. Oserus Browser tabs do
  // NOT mount webviews; they use native WebContentsView children.
  mainWindow.webContents.on('did-attach-webview', (_e, wc) => {
    try { wc.setBackgroundThrottling(true); } catch {}
    try { wc.setFrameRate?.(30); } catch {}
  });

  // Close button → hide to tray instead of quitting. Quitting goes through the
  // tray menu (which calls markQuitting()) or window-all-closed on mac.
  mainWindow.on('close', (e) => {
    if (!isAppQuitting()) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

// Session-prep logic lives in services/sessionPrep.js so any service can
// prep an account session without reaching back into this bootstrap.
const { prepareSessionForAccount, configuredPartitions } = require('./services/sessionPrep');

ipcMain.handle('session:prepareForAccount', async (_e, { accountId }) => {
  return prepareSessionForAccount(accountId);
});

ipcMain.handle('session:clear', async (_e, partitionKey) => {
  const sess = session.fromPartition(`persist:${partitionKey}`);
  await sess.clearStorageData();
  return { ok: true };
});

// --- Detachable pop-out windows (Infloww-style) ---
// Each pop-out is a BrowserWindow loading the same renderer with a
// #popout=<route> hash. Same process, same origin (localStorage shared) so
// auth + state carry over. One window per route key; re-opening focuses it.
const popoutWindows = new Map();

function openPopout(routeKey, opts = {}) {
  const key = String(routeKey || 'inbox');
  const existing = popoutWindows.get(key);
  if (existing && !existing.isDestroyed()) {
    existing.show();
    existing.focus();
    return { ok: true, focused: true };
  }
  // hiddenInset is mac-only — using it on Windows hides the close button and
  // makes the popout look broken. Default chrome on Win/Linux, hidden on mac.
  const isMac = process.platform === 'darwin';
  const win = new BrowserWindow({
    width: opts.width || 1180,
    height: opts.height || 760,
    minWidth: 600,
    minHeight: 480,
    backgroundColor: '#0d0c0a',
    title: opts.title || 'Oserus',
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  });
  // Build hash with optional extra params so the renderer can pick them up
  // (used by the model-launcher popout to know which model to show).
  const params = opts.params || {};
  const extra = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  const hash = `popout=${encodeURIComponent(key)}${extra ? `&${extra}` : ''}`;
  if (isDev) {
    win.loadURL(`http://localhost:5173/#${hash}`);
  } else {
    win.loadFile(path.join(__dirname, '../../dist/index.html'), { hash });
  }
  win.on('closed', () => popoutWindows.delete(key));
  popoutWindows.set(key, win);
  return { ok: true };
}

ipcMain.handle('window:openPopout', (_e, { route, title, width, height, params }) => {
  return openPopout(route, { title, width, height, params });
});


// Launch every URL in the user's external browser, preferring Opera GX if
// installed (per user request). Falls back to whatever shell.openExternal
// resolves to (the OS default browser).
function findOperaGxPath() {
  const candidates = [];
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA;
    const programs = process.env.PROGRAMFILES;
    const programsX86 = process.env['PROGRAMFILES(X86)'];
    if (local) candidates.push(path.join(local, 'Programs', 'Opera GX', 'opera.exe'));
    if (programs) candidates.push(path.join(programs, 'Opera GX', 'opera.exe'));
    if (programsX86) candidates.push(path.join(programsX86, 'Opera GX', 'opera.exe'));
  } else if (process.platform === 'darwin') {
    candidates.push('/Applications/Opera GX.app/Contents/MacOS/Opera GX');
  }
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch {}
  }
  return null;
}

ipcMain.handle('system:openExternalTabs', async (_e, { urls }) => {
  const list = Array.isArray(urls) ? urls.filter(Boolean) : [];
  if (list.length === 0) return { ok: false, error: 'No URLs' };
  const opera = findOperaGxPath();
  if (opera) {
    try {
      // Spawn detached so Opera GX outlives this electron process. Passing
      // all URLs in one invocation makes Opera open them as tabs in the
      // same window.
      spawn(opera, list, { detached: true, stdio: 'ignore' }).unref();
      return { ok: true, browser: 'opera-gx', count: list.length };
    } catch (e) {
      // fall through to default
    }
  }
  // Default browser fallback — opens each URL via the OS handler.
  for (const u of list) {
    try { await shell.openExternal(u); } catch {}
  }
  return { ok: true, browser: 'default', count: list.length };
});

ipcMain.handle('window:setAlwaysOnTop', (e, { value }) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win) win.setAlwaysOnTop(!!value, 'floating');
  return { ok: true, value: !!value };
});

ipcMain.handle('window:close', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win) win.close();
  return { ok: true };
});

// Restart the app (used by updater)
ipcMain.handle('app:restart', () => {
  app.relaunch();
  app.exit(0);
});

ipcMain.handle('app:version', () => ({ version: app.getVersion() }));

// Oserus Browser handlers. `open` is invoked from Management with the
// operator's token; the browser module caches the token so the picker
// Two entry points for opening an Oserus Browser:
//   • openAccount({ accountId }) — opens one window bound to that
//     account's persistent session partition (proxy + UA + antidetect
//     applied). Reused by every "Launch" affordance in Management.
//   • openAllForProfile({ profileId }) — loops over the model's
//     accounts and opens one window each. Same code path as openAccount.
//
// Autofill runs inside each tab's WebContentsView via the script that
// services/autofill.js generates — see the autofillScript IPC below.
function registerOserusBrowserHandlers() {
  const { userFromToken } = require('./ipc/auth');

  ipcMain.handle('oserus-browser:openAccount', async (_e, { token, accountId } = {}) => {
    if (!userFromToken(token)) return { ok: false, error: 'Not authenticated' };
    oserusBrowser.setOperatorToken(token);
    return oserusBrowser.openForAccount(accountId);
  });

  ipcMain.handle('oserus-browser:openAllForProfile', async (_e, { token, profileId } = {}) => {
    if (!userFromToken(token)) return { ok: false, error: 'Not authenticated' };
    oserusBrowser.setOperatorToken(token);
    return oserusBrowser.openAllForProfile(profileId);
  });

  ipcMain.handle('oserus-browser:close', async () => oserusBrowser.closeBrowser());

  // Called by browser.js right after each tab finishes loading. Returns
  // a self-contained autofill script (or empty string when no creds are
  // stored). The script self-guards against double-injection via
  // window.__oserusAutofillActive.
  ipcMain.handle('oserus-browser:autofillScript', (_e, { accountId } = {}) => {
    try {
      if (!accountId) return { ok: true, script: '' };
      const acct = getDb().prepare(
        'SELECT username, password_encrypted FROM reddit_accounts WHERE id = ?'
      ).get(accountId);
      if (!acct || !acct.username || !acct.password_encrypted) return { ok: true, script: '' };
      const password = decryptSecret(acct.password_encrypted) || '';
      if (!password) return { ok: true, script: '' };
      const script = buildAutofillScript(JSON.stringify(acct.username), JSON.stringify(password));
      return { ok: true, script };
    } catch (e) {
      return { ok: false, error: e?.message || 'autofillScript failed' };
    }
  });
}

ipcMain.handle('updater:installNow', () => {
  quitAndInstall();
});

// App-level proxy-auth fallback. Some partitions (and webcontents loaded
// before prepareSessionForAccount runs) miss the session-scoped 'login' wire.
// This handler answers any proxy challenge by looking up the partition the
// challenged webContents belongs to and pulling that account's proxy creds
// straight from the DB.
app.on('login', (event, webContents, _details, authInfo, callback) => {
  if (!authInfo || !authInfo.isProxy) return;
  try {
    const wcPartition = webContents?.session?.getStoragePath?.() || '';
    // Identify the account by matching its partition_key in the storage path.
    const db = getDb();
    const acc = db.prepare(
      `SELECT a.proxy_username, px.password_encrypted AS pw_enc
         FROM reddit_accounts a
         LEFT JOIN proxies px ON px.id = a.proxy_id
        WHERE a.proxy_id IS NOT NULL
          AND ? LIKE '%' || a.partition_key || '%'
        LIMIT 1`
    ).get(wcPartition);
    if (acc && acc.proxy_username) {
      event.preventDefault();
      const pw = acc.pw_enc ? decryptSecret(acc.pw_enc) : '';
      callback(acc.proxy_username, pw || '');
      return;
    }
  } catch (e) {
    elog.warn('[proxy] app-level login lookup failed', e?.message);
  }
});

app.whenReady().then(() => {
  initDatabase();

  registerAuthHandlers(ipcMain);
  registerProfileHandlers(ipcMain);
  registerAccountHandlers(ipcMain);
  registerWebviewHandlers(ipcMain);
  registerPostHandlers(ipcMain);
  registerProxyHandlers(ipcMain);
  registerExtensionHandlers(ipcMain);
  registerHomepageHandlers(ipcMain);
  registerBundleHandlers(ipcMain);
  registerAiHandlers(ipcMain);
  registerSubsHandlers(ipcMain);
  registerVotesHandlers(ipcMain);
  registerDocsHandlers(ipcMain);
  registerScheduledHandlers(ipcMain);
  registerAnalyticsHandlers(ipcMain);
  registerActivityHandlers(ipcMain);
  registerTeamHandlers(ipcMain);
  registerRedditHandlers(ipcMain);
  registerRolesHandlers(ipcMain);
  registerInboxHandlers(ipcMain);
  registerProtocolHandlers(ipcMain);
  registerIntelHandlers(ipcMain);
  registerTemplateHandlers(ipcMain);
  registerRedgifsHandlers(ipcMain);
  registerMessagingHandlers(ipcMain);
  registerExamplesHandlers(ipcMain);
  registerEngagementHandlers(ipcMain);
  registerAutoCommentHandlers(ipcMain);
  registerAutopilotProtocolHandlers(ipcMain);
  registerCloudHandlers(ipcMain);
  registerDeviceHandlers(ipcMain);

  // Oserus Browser (v0.62 soft-cut: optional, launched on demand from
  // Management). The module manages a single window — picker or session
  // — and reuses prepareSessionForAccount so model-level proxy + UA
  // carry over to the locked browsing window.
  oserusBrowser.init({ dev: isDev, prepareSession: prepareSessionForAccount });
  registerOserusBrowserHandlers();

  createWindow();

  // Autopilot coordinator — only acts when an admin has enabled it AND a
  // protocol is enabled. Starting the timer here is harmless when disabled.
  coordinator.start();

  // Auto-start cloud sync at boot. Delegates the credentials decision to
  // supabase.start() which now reads override → baked fallback and
  // refuses to spin up if neither is present.
  try {
    const cloud = require('./sync/supabase');
    const cfg = cloud.getConfig();
    if (cfg.enabled && cfg.url && cfg.anonKey) {
      cloud.start().catch((e) => elog.warn('[cloud] auto-start failed:', e?.message));
    }
  } catch (e) {
    elog.warn('[cloud] init skipped:', e?.message);
  }
  // Tray "Install update" item triggers the same quit-and-install path the
  // renderer banner uses. The tray is created first so setUpdateReady is wired
  // by the time the updater fires its first downloaded event.
  createTray(mainWindow, checkNow, quitAndInstall);
  initAutoUpdater(mainWindow, (info) => setUpdateReady(info));

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
  });
});

// Hide-to-tray means windows never all close on their own. Only quit when the
// tray's Quit item explicitly flips the flag.
app.on('window-all-closed', () => {
  if (process.platform === 'darwin') return;
  if (isAppQuitting()) {
    stopAutoUpdater();
    app.quit();
  }
});

app.on('before-quit', () => {
  markQuitting();
  stopAutoUpdater();
  destroyTray();
  // Close local proxy-chain bridges + IPv4 SOCKS5 bridges so we don't
  // leak open ports across an autoupdate restart.
  try {
    const { shutdownProxyBridges } = require('./services/sessionPrep');
    shutdownProxyBridges().catch(() => {});
  } catch {}
  try {
    const { shutdownAll } = require('./services/ipv4Bridge');
    shutdownAll().catch(() => {});
  } catch {}
});
