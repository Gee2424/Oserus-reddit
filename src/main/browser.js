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

const { BrowserWindow, WebContentsView, Menu, clipboard, ipcMain, shell } = require('electron');
const path = require('path');
const elog = require('electron-log');
const { getDb } = require('./db');

// Right-side content-list pane width when open. The active tab's
// WebContentsView shrinks by this amount so the React sidebar
// (rendered by the chrome window itself) is uncovered on the right.
const SIDEBAR_WIDTH = 340;
const FIND_BAR_HEIGHT = 36;

// CHROME_HEIGHT = CSS pixels of host renderer's chrome stack. Content
// WebContentsViews position with y = CHROME_HEIGHT. Keep in sync with
// constants in src/renderer/browser/BrowserShell.jsx.
//
//   36 tab strip (frameless — IS the title bar, drag region)
// + 40 chrome row (back/forward/reload + omnibox + actions)
// + 32 bookmarks bar (quick-launch site icons)
// = 108
const CHROME_HEIGHT = 108;
const TITLE_BAR_HEIGHT = 36;

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
    `SELECT a.username, a.platform, a.profile_id, p.name AS profile_name
       FROM reddit_accounts a JOIN model_profiles p ON p.id = a.profile_id
      WHERE a.id = ?`
  ).get(accountId);
  if (!acct) return { ok: false, error: 'Account not found' };

  const partition = `persist:${prep.partitionKey}`;
  const title = `${acct.profile_name} · ${acct.platform}/${acct.username}`;

  // Frameless: the tab strip IS the title bar. On Windows, titleBarOverlay
  // paints native min/max/close on top of the tab strip's right edge.
  // On macOS, titleBarStyle:'hidden' exposes the traffic-light buttons.
  // The renderer marks tab-strip background as -webkit-app-region:drag.
  const win = new BrowserWindow({
    width: 1280, height: 860,
    minWidth: 760, minHeight: 520,
    backgroundColor: '#161412',
    title,
    frame: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#161412',
      symbolColor: '#d7dadc',
      height: TITLE_BAR_HEIGHT,
    },
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
    profileId: acct.profile_id || null,
    tabs: [],           // [{ id, view, title, url, favicon, loading, canBack, canForward }]
    activeId: null,
    nextTabId: 1,
    sidebarOpen: false,
    findOpen: false,
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
  const sidebar = st.sidebarOpen ? SIDEBAR_WIDTH : 0;
  const findOffset = st.findOpen ? FIND_BAR_HEIGHT : 0;
  const top = CHROME_HEIGHT + findOffset;
  for (const t of st.tabs) {
    if (t.id === st.activeId) {
      t.view.setBounds({
        x: 0, y: top,
        width: Math.max(0, w - sidebar),
        height: Math.max(0, h - top),
      });
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
    favicon: t.favicon || null,
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
      sidebarOpen: !!st.sidebarOpen,
      findOpen: !!st.findOpen,
      accountId: st.accountId,
      profileId: st.profileId,
      platform: st.platform,
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
  wc.on('page-favicon-updated', (_e, favicons) => {
    tab.favicon = (favicons && favicons[0]) || null;
    pushState(win);
  });

  // Chrome-equivalent keyboard shortcuts. before-input-event fires on every
  // key in the tab's webContents and lets us intercept before the page sees it.
  wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const ctrl = input.control || input.meta;
    const key = (input.key || '').toLowerCase();

    if (key === 'f12' || (ctrl && input.shift && key === 'i')) {
      if (wc.isDevToolsOpened()) wc.closeDevTools(); else wc.openDevTools({ mode: 'detach' });
      event.preventDefault();
    } else if (ctrl && key === 'f') {
      openFind(win);
      event.preventDefault();
    } else if (key === 'escape' && st.findOpen) {
      closeFind(win);
      event.preventDefault();
    } else if (ctrl && (key === '=' || key === '+')) {
      wc.setZoomLevel(Math.min(9, wc.getZoomLevel() + 0.5));
      event.preventDefault();
    } else if (ctrl && key === '-') {
      wc.setZoomLevel(Math.max(-7, wc.getZoomLevel() - 0.5));
      event.preventDefault();
    } else if (ctrl && key === '0') {
      wc.setZoomLevel(0);
      event.preventDefault();
    } else if (ctrl && key === 'r') {
      wc.reload();
      event.preventDefault();
    } else if (ctrl && key === 't') {
      openTab(win, homeFor(st.platform));
      event.preventDefault();
    } else if (ctrl && key === 'w') {
      closeTab(win, tab.id);
      event.preventDefault();
    } else if (ctrl && key === 'l') {
      try { win.webContents.send('oserus-browser:focusOmnibox'); } catch {}
      event.preventDefault();
    }
  });

  // Right-click context menu — Chrome-equivalent items, contextual on what
  // the user clicked. We never spawn a popup window; new-tab requests go
  // through openTab so they inherit the account partition.
  wc.on('context-menu', (_event, params) => {
    const items = [];
    if (params.linkURL) {
      items.push({ label: 'Open Link in New Tab', click: () => openTab(win, params.linkURL) });
      items.push({ label: 'Copy Link Address', click: () => clipboard.writeText(params.linkURL) });
      items.push({ type: 'separator' });
    }
    if (params.srcURL && params.mediaType === 'image') {
      items.push({ label: 'Open Image in New Tab', click: () => openTab(win, params.srcURL) });
      items.push({ label: 'Copy Image Address', click: () => clipboard.writeText(params.srcURL) });
      items.push({ type: 'separator' });
    }
    if (params.selectionText) {
      items.push({ label: 'Copy', role: 'copy' });
      items.push({
        label: `Search Google for "${params.selectionText.slice(0, 40)}"`,
        click: () => openTab(win, `https://www.google.com/search?q=${encodeURIComponent(params.selectionText)}`),
      });
      items.push({ type: 'separator' });
    }
    if (params.isEditable) {
      items.push({ label: 'Cut', role: 'cut' });
      items.push({ label: 'Copy', role: 'copy' });
      items.push({ label: 'Paste', role: 'paste' });
      items.push({ type: 'separator' });
    }
    items.push({ label: 'Back', enabled: wc.navigationHistory?.canGoBack() ?? wc.canGoBack(), click: () => wc.goBack() });
    items.push({ label: 'Forward', enabled: wc.navigationHistory?.canGoForward() ?? wc.canGoForward(), click: () => wc.goForward() });
    items.push({ label: 'Reload', click: () => wc.reload() });
    items.push({ type: 'separator' });
    items.push({ label: 'View Page Source', click: () => openTab(win, 'view-source:' + wc.getURL()) });
    items.push({ label: 'Inspect', click: () => wc.inspectElement(params.x, params.y) });
    Menu.buildFromTemplate(items).popup({ window: win });
  });

  wc.on('found-in-page', (_e, result) => {
    try {
      win.webContents.send('oserus-browser:findResult', {
        active: result.activeMatchOrdinal,
        total: result.matches,
      });
    } catch {}
  });

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

function openFind(win) {
  const st = windowState.get(win);
  if (!st || st.findOpen) { try { win.webContents.send('oserus-browser:focusFind'); } catch {} return; }
  st.findOpen = true;
  layoutActiveTab(win);
  pushState(win);
  setTimeout(() => { try { win.webContents.send('oserus-browser:focusFind'); } catch {} }, 30);
}
function closeFind(win) {
  const st = windowState.get(win);
  if (!st || !st.findOpen) return;
  st.findOpen = false;
  withActiveTab(win, (t) => { try { t.view.webContents.stopFindInPage('clearSelection'); } catch {} });
  layoutActiveTab(win);
  pushState(win);
}
function setSidebar(win, open) {
  const st = windowState.get(win);
  if (!st) return;
  st.sidebarOpen = !!open;
  layoutActiveTab(win);
  pushState(win);
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

  // Sidebar (Content List pane)
  ipcMain.handle('oserus-browser:setSidebar', (e, { open }) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (win) setSidebar(win, open);
    return { ok: true };
  });

  // Find-in-page
  ipcMain.handle('oserus-browser:findOpen', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (win) openFind(win);
    return { ok: true };
  });
  ipcMain.handle('oserus-browser:findClose', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (win) closeFind(win);
    return { ok: true };
  });
  ipcMain.handle('oserus-browser:find', (e, { text, forward = true, next = false }) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return { ok: false };
    withActiveTab(win, (t) => {
      const q = String(text || '');
      if (!q) { try { t.view.webContents.stopFindInPage('clearSelection'); } catch {} return; }
      t.view.webContents.findInPage(q, { forward, findNext: next });
    });
    return { ok: true };
  });

  // Profile picker — list every account under the same model_profile,
  // so the chrome dropdown can render sibling accounts.
  ipcMain.handle('oserus-browser:siblings', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return { ok: false, accounts: [] };
    const st = windowState.get(win);
    if (!st?.profileId) return { ok: true, accounts: [] };
    const rows = getDb().prepare(
      `SELECT id, platform, username, status
         FROM reddit_accounts
        WHERE profile_id = ? AND status != 'banned'
        ORDER BY platform, username`
    ).all(st.profileId);
    return { ok: true, accounts: rows, activeId: st.accountId };
  });

  // Switch the window to a different account on the same profile. We
  // close the current window and open the new one — partitions and
  // proxy/login handlers are bound at WebContentsView creation, so
  // reopening guarantees clean isolation.
  ipcMain.handle('oserus-browser:switchAccount', async (e, { accountId }) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win || !accountId) return { ok: false };
    try { win.close(); } catch {}
    return openForAccount(accountId);
  });

  // Content list for the Content sidebar — scheduled + drafted posts
  // for THIS window's account, grouped by week, platform-aware.
  ipcMain.handle('oserus-browser:contentList', (e, { platform } = {}) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return { ok: false };
    const st = windowState.get(win);
    if (!st?.accountId) return { ok: true, items: [] };
    const db = getDb();
    const items = [];
    try {
      const scheduled = db.prepare(
        `SELECT id, subreddit, title, body, url, kind, scheduled_for, status
           FROM scheduled_posts
          WHERE account_id = ? AND scheduled_for >= datetime('now','-7 days')
          ORDER BY scheduled_for DESC LIMIT 200`
      ).all(st.accountId);
      for (const r of scheduled) items.push({ source: 'scheduled', ...r });
    } catch {}
    try {
      const drafts = db.prepare(
        `SELECT id, subreddit, title, body, link_url AS url, kind, scheduled_for, status, created_at
           FROM post_drafts
          WHERE account_id = ?
          ORDER BY created_at DESC LIMIT 200`
      ).all(st.accountId);
      for (const r of drafts) items.push({ source: 'draft', ...r });
    } catch {}
    return { ok: true, platform: st.platform, items };
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
