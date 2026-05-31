const { autoUpdater } = require('electron-updater');
const log = require('electron-log');
const { app } = require('electron');
const { markQuitting } = require('./tray');

const CHECK_INTERVAL_MS = 3 * 60 * 60 * 1000;

autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = 'info';
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

let mainWindow = null;
let intervalHandle = null;
let pendingUpdate = null; // { version } once update-downloaded fires
let onUpdateReadyCb = null;

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function initAutoUpdater(win, onUpdateReady) {
  mainWindow = win;
  onUpdateReadyCb = onUpdateReady || null;

  if (!app.isPackaged) {
    log.info('[updater] dev mode — skipping update checks');
    return;
  }

  autoUpdater.on('checking-for-update', () => log.info('[updater] checking'));
  autoUpdater.on('update-available', (info) => {
    log.info('[updater] available', info.version);
    send('updater:available', { version: info.version });
  });
  autoUpdater.on('update-not-available', () => log.info('[updater] up to date'));
  autoUpdater.on('error', (err) => log.error('[updater] error', err));
  autoUpdater.on('download-progress', (p) => {
    send('updater:progress', { percent: Math.round(p.percent) });
  });
  autoUpdater.on('update-downloaded', (info) => {
    log.info('[updater] downloaded', info.version);
    pendingUpdate = { version: info.version };
    send('updater:ready', { version: info.version });
    try { onUpdateReadyCb && onUpdateReadyCb(info); } catch (e) { log.error('[updater] ready cb error', e); }
  });

  autoUpdater.checkForUpdates().catch((e) => log.error('[updater] initial check failed', e));

  intervalHandle = setInterval(() => {
    autoUpdater.checkForUpdates().catch((e) => log.error('[updater] periodic check failed', e));
  }, CHECK_INTERVAL_MS);

  // Also check when the window regains focus — catches "user opened the app
  // after it sat in the background for hours"
  if (win && typeof win.on === 'function') {
    win.on('focus', () => {
      autoUpdater.checkForUpdates().catch((e) => log.error('[updater] focus check failed', e));
    });
  }
}

// Force a real quit. The app hides-to-tray on close, so calling
// autoUpdater.quitAndInstall() directly is intercepted by mainWindow's close
// handler. Flip markQuitting() first so the close handler bows out, then ask
// electron-updater to relaunch into the installer.
function quitAndInstall() {
  log.info('[updater] quitAndInstall — flagging real quit + launching installer');
  try { markQuitting(); } catch (e) { log.error('[updater] markQuitting failed', e); }
  // (isSilent=false, isForceRunAfter=true) — show NSIS, then relaunch the app.
  setImmediate(() => {
    try {
      autoUpdater.quitAndInstall(false, true);
    } catch (e) {
      log.error('[updater] quitAndInstall failed', e);
    }
  });
}

function checkNow() {
  return autoUpdater.checkForUpdates().catch((e) => log.error('[updater] manual check failed', e));
}

function getPendingUpdate() {
  return pendingUpdate;
}

function stopAutoUpdater() {
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = null;
}

module.exports = { initAutoUpdater, quitAndInstall, stopAutoUpdater, checkNow, getPendingUpdate };
