// Preload for an Oserus Browser chrome window. Surfaces tab control +
// state listener to the renderer; the renderer never touches webContents
// directly — every operation goes through this bridge so main process
// stays the single owner of WebContentsView lifecycle.

const { contextBridge, ipcRenderer } = require('electron');

const stateListeners = new Set();
const findResultListeners = new Set();
const focusOmniListeners = new Set();
const focusFindListeners = new Set();
ipcRenderer.on('oserus-browser:state',       (_e, state) => { for (const fn of stateListeners)       { try { fn(state); } catch {} } });
ipcRenderer.on('oserus-browser:findResult',  (_e, r)     => { for (const fn of findResultListeners)  { try { fn(r); } catch {} } });
ipcRenderer.on('oserus-browser:focusOmnibox',()          => { for (const fn of focusOmniListeners)   { try { fn(); } catch {} } });
ipcRenderer.on('oserus-browser:focusFind',   ()          => { for (const fn of focusFindListeners)   { try { fn(); } catch {} } });

contextBridge.exposeInMainWorld('oserusBrowser', {
  // Lifecycle
  tabsReady: () => ipcRenderer.invoke('oserus-browser:tabsReady'),
  onState:   (fn) => stateListeners.add(fn),
  offState:  (fn) => stateListeners.delete(fn),
  onFindResult:   (fn) => findResultListeners.add(fn),
  offFindResult:  (fn) => findResultListeners.delete(fn),
  onFocusOmnibox: (fn) => focusOmniListeners.add(fn),
  offFocusOmnibox:(fn) => focusOmniListeners.delete(fn),
  onFocusFind:    (fn) => focusFindListeners.add(fn),
  offFocusFind:   (fn) => focusFindListeners.delete(fn),

  // Tab strip
  newTab:    (url)   => ipcRenderer.invoke('oserus-browser:newTab',    { url }),
  closeTab:  (tabId) => ipcRenderer.invoke('oserus-browser:closeTab',  { tabId }),
  switchTab: (tabId) => ipcRenderer.invoke('oserus-browser:switchTab', { tabId }),

  // Omnibox / navigation
  navigate: (url) => ipcRenderer.invoke('oserus-browser:navigate', { url }),
  back:     ()    => ipcRenderer.invoke('oserus-browser:back'),
  forward:  ()    => ipcRenderer.invoke('oserus-browser:forward'),
  reload:   ()    => ipcRenderer.invoke('oserus-browser:reload'),

  // Find-in-page
  findOpen:  ()                          => ipcRenderer.invoke('oserus-browser:findOpen'),
  findClose: ()                          => ipcRenderer.invoke('oserus-browser:findClose'),
  find:      (text, opts = {})           => ipcRenderer.invoke('oserus-browser:find', { text, ...opts }),

  // Sidebar / Content list
  setSidebar:  (open)                    => ipcRenderer.invoke('oserus-browser:setSidebar', { open }),
  contentList: (platform)                => ipcRenderer.invoke('oserus-browser:contentList', { platform }),

  // Profile picker
  siblings:      ()                      => ipcRenderer.invoke('oserus-browser:siblings'),
  switchAccount: (accountId)             => ipcRenderer.invoke('oserus-browser:switchAccount', { accountId }),
});
