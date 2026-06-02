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
const registerBundleHandlers = require('./ipc/bundle');
const registerAiHandlers = require('./ipc/ai');
const registerSubsHandlers = require('./ipc/subs');
const registerVotesHandlers = require('./ipc/votes');
const registerDocsHandlers = require('./ipc/docs');
const registerScheduledHandlers = require('./ipc/scheduled');
const registerAnalyticsHandlers = require('./ipc/analytics');
const registerActivityHandlers = require('./ipc/activity');
const registerRedditHandlers = require('./ipc/reddit');
const registerRolesHandlers = require('./ipc/roles');
const registerInboxHandlers = require('./ipc/inbox');
const registerProtocolHandlers = require('./ipc/protocols');
const registerIntelHandlers = require('./ipc/intelligence');
const registerTemplateHandlers = require('./ipc/templates');
const registerRedgifsHandlers = require('./ipc/redgifs');
const registerMessagingHandlers = require('./ipc/messaging');
const registerExamplesHandlers = require('./ipc/examples');
const coordinator = require('./services/coordinator');

const isDev = !app.isPackaged;
let mainWindow;

// Track which partitions have been configured already, to avoid re-configuring
const configuredPartitions = new Set();

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

  // Close button → hide to tray instead of quitting. Quitting goes through the
  // tray menu (which calls markQuitting()) or window-all-closed on mac.
  mainWindow.on('close', (e) => {
    if (!isAppQuitting()) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

// Prepare a session partition for an account, applying proxy if assigned.
// Called from the renderer whenever the active account changes or a webview mounts.
async function prepareSessionForAccount(accountId) {
  if (!accountId) return { ok: false, error: 'No accountId' };
  const db = getDb();
  // Model-level proxy inheritance: when the account itself has no proxy_id,
  // fall back to the model's proxy_id. Account-level override always wins.
  const account = db.prepare(
    `SELECT a.*,
            COALESCE(a.proxy_id, mp.proxy_id) AS effective_proxy_id,
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
  // Per-account UA when set on the row; falls back to a recent Windows Chrome.
  sess.setUserAgent(
    account.user_agent ||
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36'
  );

  // Apply proxy. Electron uses Chromium-style proxy rules.
  if (account.proxy_host && account.proxy_port) {
    const scheme = account.proxy_kind === 'socks5' ? 'socks5' : (account.proxy_kind === 'https' ? 'https' : 'http');
    const rules = `${scheme}://${account.proxy_host}:${account.proxy_port}`;
    await sess.setProxy({ proxyRules: rules, proxyBypassRules: '<-loopback>' });

    // Auth-via-proxy: capture the 'login' event to pass username/password
    if (account.proxy_username) {
      const password = decryptSecret(account.proxy_pw_enc) || '';
      sess.removeAllListeners('login');
      sess.on('login', (_event, _details, _authInfo, callback) => {
        callback(account.proxy_username, password);
      });
    }
  } else {
    // No proxy assigned — clear any prior proxy on this partition
    await sess.setProxy({ proxyRules: '' });
  }

  configuredPartitions.add(partition);
  return { ok: true, partition, partitionKey: account.partition_key };
}

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

// Per-model launcher — one tabbed window per model. If a launcher for this
// modelId is already open, focus it instead of opening a duplicate. Different
// models open in parallel windows.
ipcMain.handle('window:openModelLauncher', async (_e, { profileId }) => {
  if (!profileId) return { ok: false, error: 'profileId required' };
  const db = getDb();
  let profile;
  try { profile = db.prepare('SELECT id, name FROM model_profiles WHERE id = ?').get(profileId); } catch {}
  if (!profile) return { ok: false, error: 'Model not found' };
  // Pre-warm every linked account's session partition so cookies + UA +
  // proxy are wired before the renderer mounts its <webview> tabs.
  let accounts = [];
  try {
    accounts = db.prepare(
      "SELECT id FROM reddit_accounts WHERE profile_id = ? AND status != 'banned'"
    ).all(profileId);
  } catch {}
  for (const a of accounts) {
    try { await prepareSessionForAccount(a.id); } catch {}
  }
  return openPopout(`model-launcher-${profileId}`, {
    title: `${profile.name} · Launcher`,
    width: 1280, height: 860,
    params: { route: 'model-launcher', modelId: String(profileId) },
  });
});

// Open a real browser window pre-bound to an account's persistent session
// partition. Used by Model Hub to launch every account (Reddit, RedGIFs, X,
// Instagram, TikTok…) in one click — cookies + proxy + UA are already wired by
// prepareSessionForAccount.
const PLATFORM_URLS = {
  reddit:    'https://www.reddit.com/',
  redgifs:   'https://www.redgifs.com/',
  x:         'https://x.com/home',
  instagram: 'https://www.instagram.com/',
  tiktok:    'https://www.tiktok.com/foryou',
};

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

ipcMain.handle('window:openAccountBrowser', async (_e, { accountId, url }) => {
  if (!accountId) return { ok: false, error: 'accountId required' };
  const prep = await prepareSessionForAccount(accountId);
  if (!prep.ok) return prep;
  const db = getDb();
  const acct = db.prepare(
    'SELECT username, platform, password_encrypted FROM reddit_accounts WHERE id = ?'
  ).get(accountId);
  if (!acct) return { ok: false, error: 'Account not found' };
  const target = url || PLATFORM_URLS[acct.platform] || 'about:blank';
  const isMac = process.platform === 'darwin';
  const win = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 600,
    minHeight: 480,
    backgroundColor: '#0d0c0a',
    title: `${acct.platform} · u/${acct.username}`,
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    webPreferences: {
      partition: `persist:${prep.partitionKey}`,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Autofill — populate username + password on every login form we can find.
  // Reddit, X, Instagram, TikTok, RedGIFs all render their fields async (and
  // often inside React-controlled inputs), so we:
  //   1. Try once on did-finish-load
  //   2. Retry on a 250ms interval for 10 seconds
  //   3. MutationObserver for the same 10 seconds in case fields appear later
  // setVal goes through the prototype setter so React/Vue/etc. accept the
  // change event and don't immediately overwrite the value.
  const password = acct.password_encrypted ? decryptSecret(acct.password_encrypted) : '';
  if (acct.username && password) {
    const safeUser = JSON.stringify(acct.username);
    const safePass = JSON.stringify(password);
    const inject = () => {
      const js = `
        (() => {
          if (window.__oserusAutofillActive) return;
          window.__oserusAutofillActive = true;
          const u = ${safeUser};
          const p = ${safePass};
          const setVal = (el, v) => {
            if (!el || el.value === v) return false;
            const proto = Object.getPrototypeOf(el);
            const desc = Object.getOwnPropertyDescriptor(proto, 'value');
            if (desc && desc.set) desc.set.call(el, v); else el.value = v;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          };
          // Broad selector lists — covers Reddit (new + old), X (login + flow
          // text input), Instagram, TikTok, RedGIFs, generic OAuth, Apple ID.
          const userSel = [
            'input[name="username"]', 'input[autocomplete="username"]',
            'input[name="text"]',                        // X
            'input[name="email"]',                       // IG variants, RedGIFs, generic
            'input[type="email"]',
            'input[name="loginfmt"]',                    // Microsoft
            'input[autocomplete="email"]',
            'input[id*="login"][type="text"]',
            'input[placeholder*="sername" i]',
            'input[placeholder*="mail" i]',
            'input[data-testid="ocfEnterTextTextInput"]', // X flow
          ];
          const passSel = [
            'input[name="password"]', 'input[autocomplete="current-password"]',
            'input[type="password"]',
            'input[placeholder*="assword" i]',
          ];
          let filled = { user: false, pass: false };
          const tryFill = () => {
            let uEl = null, pEl = null;
            for (const s of userSel) {
              uEl = Array.from(document.querySelectorAll(s)).find((el) => el.offsetParent !== null && !el.disabled && !el.readOnly);
              if (uEl) break;
            }
            for (const s of passSel) {
              pEl = Array.from(document.querySelectorAll(s)).find((el) => el.offsetParent !== null && !el.disabled && !el.readOnly);
              if (pEl) break;
            }
            if (uEl && !filled.user) { setVal(uEl, u); filled.user = true; }
            if (pEl && !filled.pass) { setVal(pEl, p); filled.pass = true; }
            return filled.user && filled.pass;
          };
          if (tryFill()) return;
          // Retry every 250ms for 10s OR until both fields are filled.
          const start = Date.now();
          const t = setInterval(() => {
            if (tryFill() || Date.now() - start > 10000) clearInterval(t);
          }, 250);
          // Also watch DOM mutations for the same window — async-rendered
          // forms (Reddit modal, IG SPA) commonly miss the interval.
          try {
            const mo = new MutationObserver(() => { tryFill(); });
            mo.observe(document.documentElement, { childList: true, subtree: true });
            setTimeout(() => mo.disconnect(), 10000);
          } catch (e) {}
        })();
      `;
      win.webContents.executeJavaScript(js).catch(() => {});
    };
    win.webContents.on('did-finish-load', () => {
      // Reset the in-page flag so re-injection works after each nav.
      win.webContents.executeJavaScript('window.__oserusAutofillActive = false').catch(() => {});
      inject();
    });
    // Also re-inject on in-page navigations (Reddit modal opens, X step 2).
    win.webContents.on('did-navigate-in-page', () => {
      win.webContents.executeJavaScript('window.__oserusAutofillActive = false').catch(() => {});
      inject();
    });
  }

  // Defensive: surface a friendly in-window page when the proxy or DNS
  // chokes instead of leaving the user with a blank Chromium error.
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    if (code === -3 /* ABORTED, expected on nav cancels */) return;
    elog.warn('[browser] load failed', code, desc, url);
    const safe = String(desc || '').replace(/</g, '&lt;');
    win.webContents.loadURL(
      'data:text/html;charset=utf-8,' + encodeURIComponent(
        `<body style="font-family:sans-serif;background:#0d0c0a;color:#d7dadc;padding:40px;line-height:1.6">
           <h2>Couldn't reach ${url}</h2>
           <p>${safe}</p>
           <p style="opacity:0.7;font-size:13px">Likely the assigned proxy is down or unreachable. Reassign or remove it from this account, or check your network.</p>
         </body>`
      )
    );
  });

  win.loadURL(target).catch((e) => elog.warn('[browser] loadURL rejected', e && e.message));
  return { ok: true };
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

ipcMain.handle('updater:installNow', () => {
  quitAndInstall();
});

app.whenReady().then(() => {
  initDatabase();

  registerAuthHandlers(ipcMain);
  registerProfileHandlers(ipcMain);
  registerAccountHandlers(ipcMain);
  registerWebviewHandlers(ipcMain);
  registerPostHandlers(ipcMain);
  registerProxyHandlers(ipcMain);
  registerBundleHandlers(ipcMain);
  registerAiHandlers(ipcMain);
  registerSubsHandlers(ipcMain);
  registerVotesHandlers(ipcMain);
  registerDocsHandlers(ipcMain);
  registerScheduledHandlers(ipcMain);
  registerAnalyticsHandlers(ipcMain);
  registerActivityHandlers(ipcMain);
  registerRedditHandlers(ipcMain);
  registerRolesHandlers(ipcMain);
  registerInboxHandlers(ipcMain);
  registerProtocolHandlers(ipcMain);
  registerIntelHandlers(ipcMain);
  registerTemplateHandlers(ipcMain);
  registerRedgifsHandlers(ipcMain);
  registerMessagingHandlers(ipcMain);
  registerExamplesHandlers(ipcMain);

  createWindow();

  // Autopilot coordinator — only acts when an admin has enabled it AND a
  // protocol is enabled. Starting the timer here is harmless when disabled.
  coordinator.start();
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
});
