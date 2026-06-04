// Engagement-window preload bridge.
//
// The engagement script runs inside the page context via
// webContents.executeJavaScript and can't call AI directly. This
// preload exposes a small async IPC so the page script can request a
// generated comment, wait for it, then type it into the comment input.
//
// Surface:
//   await window.oserus.requestComment({
//     platform: 'tiktok',
//     caption:  '...',          // the video / post caption we're reacting to
//     creator:  'username',     // creator handle if visible
//     topReplies: [...]         // optional list of visible comments for tone-match
//   })  -> string | null
//
// Returns null on any error; the page script falls back to skipping the
// comment in that case. Capped to ~12s server-side so a slow AI call
// doesn't deadlock the engagement session.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('oserus', {
  requestComment: async (payload) => {
    try {
      const res = await ipcRenderer.invoke('engagement:requestComment', payload);
      return res?.ok ? res.comment : null;
    } catch { return null; }
  },
});
