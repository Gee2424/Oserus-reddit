// Preload for an Oserus Browser chrome window. Surfaces tab control +
// state listeners to the renderer; the renderer never touches webContents
// directly — every operation goes through this bridge so main process
// stays the single owner of WebContentsView lifecycle.
//
// Listener registration uses ipcRenderer.on directly per call (rather
// than a Set of proxied callbacks) to avoid Electron 32 context-bridge
// cloning failures observed when a React useEffect re-registers a fresh
// closure on each effect run.

const { contextBridge, ipcRenderer } = require('electron');

function safeOn(channel, cb) {
  if (typeof cb !== 'function') return;
  const handler = (_e, ...args) => { try { cb(...args); } catch (err) { console.error('[oserus-chrome] listener error', channel, err); } };
  ipcRenderer.on(channel, handler);
}
function safeInvoke(channel, payload) {
  try {
    return ipcRenderer.invoke(channel, payload);
  } catch (err) {
    console.error('[oserus-chrome] invoke error', channel, err);
    return Promise.resolve({ ok: false, error: err?.message || String(err) });
  }
}

contextBridge.exposeInMainWorld('oserusBrowser', {
  // Lifecycle
  tabsReady: () => safeInvoke('oserus-browser:tabsReady'),
  onState:   (cb) => safeOn('oserus-browser:state', cb),
  offState:  ()   => ipcRenderer.removeAllListeners('oserus-browser:state'),
  onFindResult:   (cb) => safeOn('oserus-browser:findResult', cb),
  offFindResult:  ()   => ipcRenderer.removeAllListeners('oserus-browser:findResult'),
  onFocusOmnibox: (cb) => safeOn('oserus-browser:focusOmnibox', cb),
  offFocusOmnibox:()   => ipcRenderer.removeAllListeners('oserus-browser:focusOmnibox'),
  onFocusFind:    (cb) => safeOn('oserus-browser:focusFind', cb),
  offFocusFind:   ()   => ipcRenderer.removeAllListeners('oserus-browser:focusFind'),

  // Tab strip
  newTab:    (url)   => safeInvoke('oserus-browser:newTab',    { url: url || null }),
  closeTab:  (tabId) => safeInvoke('oserus-browser:closeTab',  { tabId: Number(tabId) || 0 }),
  switchTab: (tabId) => safeInvoke('oserus-browser:switchTab', { tabId: Number(tabId) || 0 }),

  // Omnibox / navigation
  navigate: (url) => safeInvoke('oserus-browser:navigate', { url: String(url || '') }),
  back:     ()    => safeInvoke('oserus-browser:back'),
  forward:  ()    => safeInvoke('oserus-browser:forward'),
  reload:   ()    => safeInvoke('oserus-browser:reload'),

  // Find-in-page
  findOpen:  ()                          => safeInvoke('oserus-browser:findOpen'),
  findClose: ()                          => safeInvoke('oserus-browser:findClose'),
  find:      (text, opts)                => safeInvoke('oserus-browser:find', {
    text: String(text || ''),
    forward: opts && opts.forward !== false,
    next:    !!(opts && opts.next),
  }),

  // Sidebar / Content list
  setSidebar:  (open)     => safeInvoke('oserus-browser:setSidebar', { open: !!open }),
  contentList: (platform) => safeInvoke('oserus-browser:contentList', { platform: platform ? String(platform) : null }),

  // Profile picker
  siblings:      ()          => safeInvoke('oserus-browser:siblings'),
  switchAccount: (accountId) => safeInvoke('oserus-browser:switchAccount', { accountId: Number(accountId) || 0 }),

  // Window controls (custom — backup if Windows titleBarOverlay misbehaves)
  windowMinimize: () => safeInvoke('oserus-browser:windowMinimize'),
  windowMaximize: () => safeInvoke('oserus-browser:windowMaximize'),
  windowClose:    () => safeInvoke('oserus-browser:windowClose'),

  // Proxy / leak check
  checkProxy:      () => safeInvoke('oserus-browser:checkProxy'),
  openBrowserscan: () => safeInvoke('oserus-browser:openBrowserscan'),

  // Add content (drafts / scheduled) from the sidebar
  addContent:     (payload) => safeInvoke('oserus-browser:addContent', payload),
  canAddContent:  ()        => safeInvoke('oserus-browser:canAddContent'),
});
