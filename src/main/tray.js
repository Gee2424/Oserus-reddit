const { Tray, Menu, app, nativeImage } = require('electron');
const path = require('path');
const log = require('electron-log');

let tray = null;
let isQuitting = false;
let trayMainWindow = null;
let trayOnCheckForUpdates = null;
let trayOnInstallUpdate = null;
let trayUpdateReady = null; // { version } or null

function markQuitting() {
  isQuitting = true;
}

function isAppQuitting() {
  return isQuitting;
}

function rebuildTrayMenu() {
  if (!tray) return;
  const items = [
    {
      label: 'Open Oserus Management',
      click: () => {
        if (trayMainWindow && !trayMainWindow.isDestroyed()) {
          if (trayMainWindow.isMinimized()) trayMainWindow.restore();
          trayMainWindow.show();
          trayMainWindow.focus();
        }
      },
    },
    { type: 'separator' },
  ];
  if (trayUpdateReady) {
    items.push({
      label: `▲ Install update ${trayUpdateReady.version} & restart`,
      click: () => {
        try { trayOnInstallUpdate && trayOnInstallUpdate(); } catch (e) { log.error('[tray] install update failed', e); }
      },
    });
  }
  items.push({
    label: 'Check for updates',
    click: () => {
      try { trayOnCheckForUpdates && trayOnCheckForUpdates(); } catch (e) { log.error('[tray] update check failed', e); }
    },
  });
  items.push({ type: 'separator' });
  items.push({
    label: 'Quit',
    click: () => {
      isQuitting = true;
      app.quit();
    },
  });
  tray.setContextMenu(Menu.buildFromTemplate(items));
  tray.setToolTip(trayUpdateReady
    ? `Oserus Management — update ${trayUpdateReady.version} ready`
    : 'Oserus Management');
}

function setUpdateReady(info) {
  trayUpdateReady = info ? { version: info.version } : null;
  rebuildTrayMenu();
}

function createTray(mainWindow, onCheckForUpdates, onInstallUpdate) {
  if (tray) return tray;
  trayMainWindow = mainWindow;
  trayOnCheckForUpdates = onCheckForUpdates;
  trayOnInstallUpdate = onInstallUpdate;

  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'build', 'icon.png')
    : path.join(__dirname, '..', '..', 'build', 'icon.png');

  let image = nativeImage.createFromPath(iconPath);
  if (image.isEmpty()) {
    log.warn('[tray] icon not found at', iconPath, '— using empty image');
  } else {
    image = image.resize({ width: 16, height: 16 });
  }

  tray = new Tray(image);
  rebuildTrayMenu();

  tray.on('click', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });

  return tray;
}

function destroyTray() {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}

module.exports = { createTray, destroyTray, markQuitting, isAppQuitting, setUpdateReady };
