// Preload bridge for the Oserus Browser window. Exposes the minimal
// surface the browser renderer needs: list profiles + accounts, launch
// a profile, switch back to the picker, close the window.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('oserusBrowser', {
  picker: {
    listProfiles: (data) => ipcRenderer.invoke('oserus-browser:listProfiles', data),
    launchAccount: (data) => ipcRenderer.invoke('oserus-browser:launchAccount', data),
  },
  session: {
    backToPicker: () => ipcRenderer.invoke('oserus-browser:backToPicker'),
    close: () => ipcRenderer.invoke('oserus-browser:close'),
    autofillScript: (data) => ipcRenderer.invoke('oserus-browser:autofillScript', data),
    currentAccountId: () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const v = params.get('account');
        return v ? Number(v) : null;
      } catch { return null; }
    },
  },
  auth: {
    // Reuse the existing auth IPC so the browser can authenticate as the
    // logged-in operator without a second login flow.
    me: (data) => ipcRenderer.invoke('auth:me', data),
  },
});
