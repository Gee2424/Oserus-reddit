// Preload for an Oserus Browser chrome window. Surfaces tab control +
// state listener to the renderer; the renderer never touches webContents
// directly — every operation goes through this bridge so main process
// stays the single owner of WebContentsView lifecycle.

const { contextBridge, ipcRenderer } = require('electron');

const listeners = new Set();
ipcRenderer.on('oserus-browser:state', (_e, state) => {
  for (const fn of listeners) {
    try { fn(state); } catch {}
  }
});

contextBridge.exposeInMainWorld('oserusBrowser', {
  // Lifecycle
  tabsReady: () => ipcRenderer.invoke('oserus-browser:tabsReady'),
  onState:   (fn) => listeners.add(fn),
  offState:  (fn) => listeners.delete(fn),

  // Tab strip
  newTab:    (url)   => ipcRenderer.invoke('oserus-browser:newTab',    { url }),
  closeTab:  (tabId) => ipcRenderer.invoke('oserus-browser:closeTab',  { tabId }),
  switchTab: (tabId) => ipcRenderer.invoke('oserus-browser:switchTab', { tabId }),

  // Omnibox / navigation
  navigate: (url) => ipcRenderer.invoke('oserus-browser:navigate', { url }),
  back:     ()    => ipcRenderer.invoke('oserus-browser:back'),
  forward:  ()    => ipcRenderer.invoke('oserus-browser:forward'),
  reload:   ()    => ipcRenderer.invoke('oserus-browser:reload'),
});
