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
const registerEngagementHandlers = require('./ipc/engagement');
const registerAutoCommentHandlers = require('./ipc/autoComment');
const coordinator = require('./services/coordinator');
const oserusBrowser = require('./browser');

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

  // ModelLauncher mounts many <webview> tabs at once and only one is visible.
  // Without explicit throttling Chromium keeps all of them painting + running
  // their main thread at full speed, which makes the launcher feel sluggish.
  // We enable background throttling + image animation off on every attached
  // webview frame so hidden tabs idle and the visible one gets the CPU.
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

// Prepare a session partition for an account, applying proxy if assigned.
// Called from the renderer whenever the active account changes or a webview mounts.
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
  // Per-account UA when set on the row; falls back to a recent Windows Chrome.
  sess.setUserAgent(
    account.user_agent ||
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36'
  );

  // Apply proxy. Electron's proxy story is finicky — three things matter:
  //   1. Register the 'login' handler BEFORE setProxy so the first 407
  //      Proxy-Auth-Required challenge gets answered. If we register after,
  //      the initial CONNECT can fail with ERR_TUNNEL_CONNECTION_FAILED.
  //   2. proxyBypassRules: '<-loopback>' (Chromium-speak for "DO route
  //      loopback through the proxy") was wrong — it forced local renderer
  //      fetches into the tunnel which on some providers fails the handshake.
  //      Default bypass is fine; localhost stays local, everything else
  //      routes through the proxy.
  //   3. For SOCKS5, Electron does NOT consume creds from the proxy URL —
  //      auth has to come through the login event. Same handler covers
  //      HTTP/HTTPS too, so one path works for every scheme.
  if (account.proxy_host && account.proxy_port) {
    const scheme = account.proxy_kind === 'socks5' ? 'socks5' : (account.proxy_kind === 'https' ? 'https' : 'http');
    const rules = `${scheme}://${account.proxy_host}:${account.proxy_port}`;

    // Wire login handler first (idempotent — replace any prior handler).
    sess.removeAllListeners('login');
    if (account.proxy_username) {
      const password = decryptSecret(account.proxy_pw_enc) || '';
      sess.on('login', (event, _details, authInfo, callback) => {
        // Only answer proxy challenges, not site logins.
        if (authInfo && authInfo.isProxy) {
          event.preventDefault();
          callback(account.proxy_username, password);
        }
      });
    }

    try {
      await sess.setProxy({ proxyRules: rules, proxyBypassRules: 'localhost,127.0.0.1' });
    } catch (e) {
      elog.error('[proxy] setProxy failed', { accountId, host: account.proxy_host, port: account.proxy_port, error: e?.message });
      return { ok: false, error: `Proxy config rejected: ${e?.message || e}` };
    }
  } else {
    // No proxy assigned — clear any prior proxy + login handler on this partition.
    sess.removeAllListeners('login');
    await sess.setProxy({ proxyRules: '' });
  }

  configuredPartitions.add(partition);
  return { ok: true, partition, partitionKey: account.partition_key };
}

ipcMain.handle('session:prepareForAccount', async (_e, { accountId }) => {
  return prepareSessionForAccount(accountId);
});

// Exported so service modules (engagement runner) can prep sessions too.
module.exports.prepareSessionForAccount = prepareSessionForAccount;

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

// Login-page autofill script. Pierces open shadow roots (Reddit's new login
// renders inside <faceplate-text-input> custom elements), has specific
// selectors for Reddit/X/Instagram/TikTok/RedGIFs, retries on a 250ms tick
// for 10 seconds, watches MutationObserver for the same window, sets values
// via the prototype setter so React/Vue/Lit accept the input event, and
// auto-clicks the platform's Next/Login button once both fields are filled.
function buildAutofillScript(safeUser, safePass) {
  return `
    (() => {
      if (window.__oserusAutofillActive) return;
      window.__oserusAutofillActive = true;
      const u = ${safeUser};
      const p = ${safePass};

      // Recursively walk every shadow root so faceplate / Lit / custom-element
      // inputs are reachable. Returns a flat list of elements matching sel.
      function deepQueryAll(root, sel) {
        const out = [];
        const walk = (node) => {
          if (!node) return;
          if (node.querySelectorAll) {
            try { out.push(...node.querySelectorAll(sel)); } catch {}
          }
          // Open shadow roots
          if (node.shadowRoot) walk(node.shadowRoot);
          // Recurse into descendants to catch nested shadow trees
          const kids = node.children || [];
          for (let i = 0; i < kids.length; i++) walk(kids[i]);
        };
        walk(root);
        return out;
      }
      function deepFind(sel) {
        const all = deepQueryAll(document.documentElement, sel);
        return all.find((el) => el.offsetParent !== null && !el.disabled && !el.readOnly) || null;
      }
      function setVal(el, v) {
        if (!el || el.value === v) return false;
        const proto = Object.getPrototypeOf(el);
        const desc = Object.getOwnPropertyDescriptor(proto, 'value');
        if (desc && desc.set) desc.set.call(el, v); else el.value = v;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        // Some forms (Reddit faceplate) listen for keyup; fire one too.
        el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
        return true;
      }

      const host = location.hostname;
      const isReddit    = /(^|\\.)reddit\\.com$/.test(host);
      const isX         = /(^|\\.)(x|twitter)\\.com$/.test(host);
      const isInstagram = /(^|\\.)instagram\\.com$/.test(host);
      const isTikTok    = /(^|\\.)tiktok\\.com$/.test(host);
      const isRedGifs   = /(^|\\.)redgifs\\.com$/.test(host);

      // Platform-specific selectors first, then generic fallbacks.
      const userSel = [
        // Reddit new login (shadow-DOM input lives inside faceplate-text-input)
        isReddit && 'input#login-username',
        isReddit && 'input[name="username"]',
        // X login flow
        isX && 'input[autocomplete="username"]',
        isX && 'input[name="text"]',
        isX && 'input[data-testid="ocfEnterTextTextInput"]',
        // Instagram
        isInstagram && 'input[name="username"]',
        isInstagram && 'input[aria-label*="username" i]',
        // TikTok (email/username step)
        isTikTok && 'input[name="username"]',
        isTikTok && 'input[type="text"][placeholder*="mail" i]',
        isTikTok && 'input[type="text"][placeholder*="sername" i]',
        // RedGIFs + generic
        isRedGifs && 'input[name="login"]',
        'input[autocomplete="username"]',
        'input[name="username"]',
        'input[name="email"]',
        'input[type="email"]',
        'input[autocomplete="email"]',
        'input[name="loginfmt"]',
        'input[id*="login" i][type="text"]',
        'input[placeholder*="sername" i]',
        'input[placeholder*="mail" i]',
      ].filter(Boolean);

      const passSel = [
        isReddit && 'input#login-password',
        isReddit && 'input[name="password"]',
        isX && 'input[autocomplete="current-password"]',
        isX && 'input[name="password"]',
        isInstagram && 'input[name="password"]',
        isInstagram && 'input[aria-label*="password" i]',
        isTikTok && 'input[type="password"]',
        isRedGifs && 'input[type="password"]',
        'input[autocomplete="current-password"]',
        'input[name="password"]',
        'input[type="password"]',
        'input[placeholder*="assword" i]',
      ].filter(Boolean);

      const submitSel = [
        // Reddit's faceplate button — match the submit role
        isReddit && 'button[type="submit"]',
        // X step button
        isX && 'div[role="button"][data-testid="LoginForm_Login_Button"]',
        isX && 'button[data-testid="LoginForm_Login_Button"]',
        isX && 'div[role="button"][data-testid$="next_button"]',
        // Instagram
        isInstagram && 'button[type="submit"]',
        // TikTok
        isTikTok && 'button[type="submit"]',
        // RedGIFs + generic
        'button[type="submit"]',
        'button[data-testid*="login" i]',
      ].filter(Boolean);

      const filled = { user: false, pass: false, submitted: false };

      function findFirst(list) {
        for (const s of list) { const el = deepFind(s); if (el) return el; }
        return null;
      }

      function tryFill() {
        const uEl = findFirst(userSel);
        const pEl = findFirst(passSel);
        if (uEl && !filled.user) { if (setVal(uEl, u)) filled.user = true; }
        if (pEl && !filled.pass) { if (setVal(pEl, p)) filled.pass = true; }
        return filled.user && filled.pass;
      }

      function trySubmit() {
        if (filled.submitted) return;
        // Only auto-submit once both fields are present and filled.
        if (!filled.user || !filled.pass) return;
        const btn = findFirst(submitSel);
        if (!btn) return;
        try { btn.click(); filled.submitted = true; } catch {}
      }

      if (tryFill()) {
        // X has a two-step flow — username first, click Next, then password
        // shows. Don't auto-submit on the combined Reddit/IG form unless we
        // truly filled both. We rely on the user's existing autofill button.
        return;
      }

      const start = Date.now();
      const t = setInterval(() => {
        const done = tryFill();
        if (done || Date.now() - start > 10000) clearInterval(t);
      }, 250);

      try {
        const mo = new MutationObserver(() => { tryFill(); });
        mo.observe(document.documentElement, { childList: true, subtree: true });
        setTimeout(() => mo.disconnect(), 10000);
      } catch {}
    })();
  `;
}

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
      const js = buildAutofillScript(safeUser, safePass);
      win.webContents.executeJavaScript(js).catch(() => {});
    };
    win.webContents.on('did-finish-load', () => {
      win.webContents.executeJavaScript('window.__oserusAutofillActive = false').catch(() => {});
      inject();
    });
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

// Oserus Browser handlers. `open` is invoked from Management with the
// operator's token; the browser module caches the token so the picker
// can list profiles without a second sign-in. `listProfiles` and
// `launchAccount` are called from inside the browser window's preload.
function registerOserusBrowserHandlers() {
  const { userFromToken } = require('./ipc/auth');
  const { hasPermission } = require('./permissions');

  ipcMain.handle('oserus-browser:open', async (_e, { token } = {}) => {
    oserusBrowser.setOperatorToken(token || null);
    return oserusBrowser.openPicker();
  });

  ipcMain.handle('oserus-browser:backToPicker', async () => {
    return oserusBrowser.openPicker();
  });

  ipcMain.handle('oserus-browser:close', async () => oserusBrowser.closeBrowser());

  ipcMain.handle('oserus-browser:listProfiles', async () => {
    try {
      const token = oserusBrowser.getOperatorToken();
      const user = userFromToken(token);
      if (!user) return { ok: false, error: 'Not authenticated' };

      const db = getDb();
      const seeAll = hasPermission(user, 'profiles.manage');
      const profiles = seeAll
        ? db.prepare(`SELECT id, name, main_email FROM model_profiles ORDER BY name`).all()
        : db.prepare(
            `SELECT id, name, main_email FROM model_profiles
             WHERE assigned_user_id = ? ORDER BY name`
          ).all(user.id);

      // Account-level proxy wins; model-level fallback so guest profiles
      // bound only at the model still display the right proxy label.
      const acctStmt = db.prepare(
        `SELECT a.id, a.platform, a.username, a.status,
                px.label AS proxy_label
         FROM reddit_accounts a
         LEFT JOIN model_profiles mp ON mp.id = a.profile_id
         LEFT JOIN proxies px ON px.id = COALESCE(a.proxy_id, mp.proxy_id)
         WHERE a.profile_id = ?
         ORDER BY a.platform, a.username`
      );
      for (const p of profiles) {
        p.accounts = acctStmt.all(p.id);
      }
      return { ok: true, profiles };
    } catch (e) {
      return { ok: false, error: e?.message || 'listProfiles failed' };
    }
  });

  ipcMain.handle('oserus-browser:launchAccount', async (_e, { accountId }) => {
    return oserusBrowser.openForAccount(accountId);
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
  registerEngagementHandlers(ipcMain);
  registerAutoCommentHandlers(ipcMain);

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
