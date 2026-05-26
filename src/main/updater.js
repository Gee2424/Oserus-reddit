const { autoUpdater } = require('electron-updater');
const log = require('electron-log');
const { app } = require('electron');

const CHECK_INTERVAL_MS = 3 * 60 * 60 * 1000;

autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = 'info';
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

let mainWindow = null;
let intervalHandle = null;

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function initAutoUpdater(win) {
  mainWindow = win;

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
    send('updater:ready', { version: info.version });
  });

  autoUpdater.checkForUpdates().catch((e) => log.error('[updater] initial check failed', e));

  intervalHandle = setInterval(() => {
    autoUpdater.checkForUpdates().catch((e) => log.error('[updater] periodic check failed', e));
  }, CHECK_INTERVAL_MS);
}

function quitAndInstall() {
  autoUpdater.quitAndInstall();
}

function stopAutoUpdater() {
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = null;
}

module.exports = { initAutoUpdater, quitAndInstall, stopAutoUpdater };
