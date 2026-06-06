// Oserus Browser — AdsPower-style profile browser.
//
// One BrowserWindow per account. The window's renderer hosts the
// chrome UI (tab strip + omnibox + back / forward / reload). Tab
// content is rendered by NATIVE WebContentsView children of that
// window, NOT by <webview> tags — so each tab is a real Chromium
// frame using the account's session partition explicitly. That makes:
//
//   • session.setProxy applied by prepareSessionForAccount actually
//     route the tab. The old <webview> approach used the default
//     partition and silently bypassed the proxy.
//   • The antidetect preload registered via session.setPreloads run
//     in every frame.
//   • Cookies / localStorage stay isolated per account.
//   • Autofill (services/autofill.js) inject on every tab navigation.
//
// No picker. Launching is initiated from Management:
//   • Account "Launch" button → oserus-browser:openAccount.
//   • Model "Open all" button → oserus-browser:openAllForProfile,
//     which spawns one window per account in parallel.

const { BrowserWindow, WebContentsView, ipcMain, shell } = require('electron');
const path = require('path');
const elog = require('electron-log');
const { getDb } = require('./db');

// chromeHeight = CSS pixels of the host renderer's chrome bar
// (tab strip + omnibox). Content WebContentsViews position with y =
// chromeHeight so chrome stays visible above. Keep in sync with the
// CSS in src/renderer/browser/BrowserShell.jsx.
const CHROME_HEIGHT = 78;

const accountWindows = new Map();    // accountId -> BrowserWindow
const windowState = new WeakMap();   // BrowserWindow -> session state

let prepareSessionForAccount = null;
let isDev = false;
// Cached at launch time so per-tab IPC handlers can decrypt the
// account password when generating an autofill script.
let operatorToken = null;

function init({ dev, prepareSession }) {
  isDev = !!dev;
  prepareSessionForAccount = prepareSession;
  registerTabIpc();
}
function setOperatorToken(t) { operatorToken = t || null; }
function getOperatorToken() { return operatorToken; }

// ---------------------------------------------------------------- helpers

function devUrl(query = '') { return `http://localhost:5173/browser.html${query}`; }
function prodFile() { return path.join(__dirname, '../../dist/browser.html'); }

function loadChromeInto(win, query) {
  if (isDev) {
    win.loadURL(devUrl(query)).catch((e) => elog.warn('[browser] loadURL', e?.message));
  } else {
    win.loadFile(prodFile(), query ? { search: query } : {})
      .catch((e) => elog.warn('[browser] loadFile', e?.message));
  }
}

const PLATFORM_HOME = {
  reddit:    'https://www.reddit.com/',
  redgifs:   'https://www.redgifs.com/',
  x:         'https://x.com/home',
  instagram: 'https://www.instagram.com/',
  tiktok:    'https://www.tiktok.com/foryou',
};
function homeFor(platform) { return PLATFORM_HOME[platform] || 'https://www.google.com/'; }

function platformOfAccount(accountId) {
  const row = getDb().prepare('SELECT platform FROM reddit_accounts WHERE id = ?').get(accountId);
  return row?.platform || null;
}

// ---------------------------------------------------- one window per account

async function openForAccount(accountId) {
  if (!accountId) return { ok: false, error: 'accountId required' };
  if (!prepareSessionForAccount) return { ok: false, error: 'browser module not initialized' };

  // Always re-prep — guarantees proxy / antidetect preload / UA are
  // applied to the partition before the first navigation. Without
  // this a stale partition could leak the operator's IP on launch.
  const prep = await prepareSessionForAccount(accountId);
  if (!prep.ok) return prep;

  // AdsPower semantics: one window per profile. Focus the existing
  // window instead of opening a duplicate.
  const existing = accountWindows.get(accountId);
  if (existing && !existing.isDestroyed()) {
    existing.focus();
    return { ok: true, reused: true };
  }

  const acct = getDb().prepare(
    `SELECT a.username, a.platform, p.name AS profile_name
       FROM reddit_accounts a JOIN model_profiles p ON p.id = a.profile_id
      WHERE a.id = ?`
  ).get(accountId);
  if (!acct) return { ok: false, error: 'Account not found' };

  const partition = `persist:${prep.partitionKey}`;
  const title = `${acct.profile_name} · ${acct.platform}/${acct.username}`;

  const win = new BrowserWindow({
    width: 1280, height: 860,
    minWidth: 760, minHeight: 520,
    backgroundColor: '#0d0c0a',
    title,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/browser.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  windowState.set(win, {
    accountId, partition,
    platform: acct.platform,
    tabs: [],           // [{ id, view, title, url, loading, canBack, canForward, navigated }]
    activeId: null,
    nextTabId: 1,
  });
  accountWindows.set(accountId, win);

  win.on('closed', () => {
    const st = windowState.get(win);
    if (st) for (const t of st.tabs) {
      try { t.view.webContents.destroy(); } catch {}
    }
    if (accountWindows.get(accountId) === win) accountWindows.delete(accountId);
  });
  win.on('resize', () => layoutActiveTab(win));

  loadChromeInto(win, `?account=${encodeURIComponent(accountId)}`);

  // Open the first tab once the chrome UI is rendered. did-finish-load
  // is reliable enough — chrome layout is static. Doing this here
  // avoids requiring a round-trip from the renderer.
  win.webContents.once('did-finish-load', () => {
    openTab(win, homeFor(acct.platform));
  });

  return { ok: true, accountId };
}

// Open every account in a profile as its own window. Returns when all
// launches have at least been kicked off. Does not focus any single
// window — the OS surfaces them however it normally would.
async function openAllForProfile(profileId) {
  if (!profileId) return { ok: false, error: 'profileId required' };
  const accts = getDb().prepare(
    `SELECT id FROM reddit_accounts
      WHERE profile_id = ? AND status != 'banned'
      ORDER BY platform, username`
  ).all(profileId);
  if (!accts.length) return { ok: false, error: 'No active accounts on this profile' };

  // Open serially so per-account session prep doesn't race on the same
  // partition table — each prep takes well under a second so this stays
  // snappy even for 10+ accounts.
  let opened = 0;
  for (const a of accts) {
    const r = await openForAccount(a.id);
    if (r.ok) opened++;
  }
  return { ok: true, opened, requested: accts.length };
}

// ---------------------------------------------------------- tab management

function layoutActiveTab(win) {
  const st = windowState.get(win);
  if (!st) return;
  const [w, h] = win.getContentSize();
  for (const t of st.tabs) {
    if (t.id === st.activeId) {
      t.view.setBounds({ x: 0, y: CHROME_HEIGHT, width: w, height: Math.max(0, h - CHROME_HEIGHT) });
      t.view.setVisible(true);
    } else {
      t.view.setVisible(false);
    }
  }
}

function tabSnapshot(t) {
  return {
    id: t.id,
    title: t.title || t.url,
    url: t.url,
    loading: t.loading,
    canBack: t.canBack,
    canForward: t.canForward,
  };
}

function pushState(win) {
  const st = windowState.get(win);
  if (!st || win.isDestroyed()) return;
  try {
    win.webContents.send('oserus-browser:state', {
      tabs: st.tabs.map(tabSnapshot),
      activeId: st.activeId,
    });
  } catch {}
}

function openTab(win, url) {
  const st = windowState.get(win);
  if (!st) return null;

  const view = new WebContentsView({
    webPreferences: {
      partition: st.partition,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.contentView.addChildView(view);

  const id = st.nextTabId++;
  const tab = { id, view, title: url, url, loading: true, canBack: false, canForward: false };
  st.tabs.push(tab);
  st.activeId = id;

  const wc = view.webContents;

  const nav = () => {
    tab.url = wc.getURL();
    tab.title = wc.getTitle() || tab.url;
    const h = wc.navigationHistory;
    tab.canBack    = h ? h.canGoBack()    : wc.canGoBack();
    tab.canForward = h ? h.canGoForward() : wc.canGoForward();
    pushState(win);
  };
  wc.on('did-start-loading', () => { tab.loading = true; pushState(win); });
  wc.on('did-stop-loading',  () => { tab.loading = false; nav(); injectAutofill(st.accountId, wc); });
  wc.on('did-navigate', nav);
  wc.on('did-navigate-in-page', nav);
  wc.on('page-title-updated', (_e, t) => { tab.title = t; pushState(win); });

  // window.open / target=_blank → open as a new tab in the same window
  // instead of letting Chromium spawn a popup.
  wc.setWindowOpenHandler(({ url: u, disposition }) => {
    if (['foreground-tab', 'background-tab', 'new-window', 'default'].includes(disposition)) {
      openTab(win, u);
      return { action: 'deny' };
    }
    shell.openExternal(u).catch(() => {});
    return { action: 'deny' };
  });

  // Friendly proxy / DNS failure page so VAs can see what went wrong
  // instead of a blank Chromium error.
  wc.on('did-fail-load', (_e, code, desc, failedUrl) => {
    if (code === -3 /* ABORTED */) return;
    elog.warn('[browser] load failed', code, desc, failedUrl);
    const safe = String(desc || '').replace(/</g, '&lt;');
    wc.loadURL(
      'data:text/html;charset=utf-8,' + encodeURIComponent(
        `<body style="font-family:sans-serif;background:#0d0c0a;color:#d7dadc;padding:40px;line-height:1.6">
           <h2>Couldn't reach ${failedUrl}</h2>
           <p>${safe}</p>
           <p style="opacity:0.7;font-size:13px">Likely the assigned proxy is down or unreachable. Reassign or remove it from this account, or check your network.</p>
         </body>`
      )
    );
  });

  wc.loadURL(url).catch((e) => elog.warn('[browser] tab loadURL', e?.message));
  layoutActiveTab(win);
  pushState(win);
  return id;
}

// Inject the same login-form autofill script the old single-shot
// account browser used. Runs on every did-stop-loading; the script
// self-guards via window.__oserusAutofillActive so re-injection is
// a cheap no-op.
function injectAutofill(accountId, wc) {
  try {
    const { buildAutofillScript } = require('./autofill');
    const row = getDb().prepare(
      'SELECT username, password_encrypted FROM reddit_accounts WHERE id = ?'
    ).get(accountId);
    if (!row?.username || !row?.password_encrypted) return;
    const { decryptSecret } = require('./db');
    const password = decryptSecret(row.password_encrypted) || '';
    if (!password) return;
    const js = buildAutofillScript(JSON.stringify(row.username), JSON.stringify(password));
    wc.executeJavaScript('window.__oserusAutofillActive = false').catch(() => {});
    wc.executeJavaScript(js).catch(() => {});
  } catch (e) {
    elog.warn('[browser] autofill inject failed', e?.message);
  }
}

function closeTab(win, tabId) {
  const st = windowState.get(win);
  if (!st) return;
  const idx = st.tabs.findIndex((t) => t.id === tabId);
  if (idx === -1) return;
  const [tab] = st.tabs.splice(idx, 1);
  try { win.contentView.removeChildView(tab.view); } catch {}
  try { tab.view.webContents.destroy(); } catch {}
  if (st.activeId === tabId) {
    st.activeId = st.tabs.length ? st.tabs[Math.min(idx, st.tabs.length - 1)].id : null;
  }
  if (!st.tabs.length) { win.close(); return; }
  layoutActiveTab(win);
  pushState(win);
}

function switchTab(win, tabId) {
  const st = windowState.get(win);
  if (!st || !st.tabs.find((t) => t.id === tabId)) return;
  st.activeId = tabId;
  layoutActiveTab(win);
  pushState(win);
}

function withActiveTab(win, fn) {
  const st = windowState.get(win);
  if (!st || !st.activeId) return;
  const t = st.tabs.find((x) => x.id === st.activeId);
  if (t) fn(t);
}

// ---------------------------------------------------------------- tab IPC

let tabIpcRegistered = false;
function registerTabIpc() {
  if (tabIpcRegistered) return;
  tabIpcRegistered = true;

  ipcMain.handle('oserus-browser:tabsReady', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (win) pushState(win);
    return { ok: true };
  });

  ipcMain.handle('oserus-browser:newTab', (e, { url } = {}) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return { ok: false };
    const st = windowState.get(win);
    const fallback = st ? homeFor(st.platform) : 'https://www.google.com/';
    openTab(win, url || fallback);
    return { ok: true };
  });

  ipcMain.handle('oserus-browser:closeTab', (e, { tabId }) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (win) closeTab(win, tabId);
    return { ok: true };
  });

  ipcMain.handle('oserus-browser:switchTab', (e, { tabId }) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (win) switchTab(win, tabId);
    return { ok: true };
  });

  ipcMain.handle('oserus-browser:navigate', (e, { url }) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return { ok: false };
    withActiveTab(win, (t) => { t.view.webContents.loadURL(normalizeUrl(url)); });
    return { ok: true };
  });

  ipcMain.handle('oserus-browser:back', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return { ok: false };
    withActiveTab(win, (t) => {
      const h = t.view.webContents.navigationHistory;
      if (h?.canGoBack()) h.goBack();
      else if (t.view.webContents.canGoBack()) t.view.webContents.goBack();
    });
    return { ok: true };
  });

  ipcMain.handle('oserus-browser:forward', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return { ok: false };
    withActiveTab(win, (t) => {
      const h = t.view.webContents.navigationHistory;
      if (h?.canGoForward()) h.goForward();
      else if (t.view.webContents.canGoForward()) t.view.webContents.goForward();
    });
    return { ok: true };
  });

  ipcMain.handle('oserus-browser:reload', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return { ok: false };
    withActiveTab(win, (t) => { t.view.webContents.reload(); });
    return { ok: true };
  });
}

function normalizeUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return 'about:blank';
  if (/^[a-z]+:\/\//i.test(s)) return s;
  const looksLikeDomain = /^[^\s/]+\.[^\s/]+/.test(s) && !s.includes(' ');
  if (looksLikeDomain) return `https://${s}`;
  return `https://www.google.com/search?q=${encodeURIComponent(s)}`;
}

function closeBrowser() {
  for (const win of accountWindows.values()) {
    try { if (!win.isDestroyed()) win.close(); } catch {}
  }
  accountWindows.clear();
  return { ok: true };
}

module.exports = {
  init,
  openForAccount,
  openAllForProfile,
  closeBrowser,
  setOperatorToken,
  getOperatorToken,
};
