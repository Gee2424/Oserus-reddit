const { Tray, Menu, app, nativeImage } = require('electron');
const path = require('path');
const log = require('electron-log');

let tray = null;
let isQuitting = false;

function markQuitting() {
  isQuitting = true;
}

function isAppQuitting() {
  return isQuitting;
}

function createTray(mainWindow, onCheckForUpdates) {
  if (tray) return tray;

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
  tray.setToolTip('Oserus Management');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open Oserus Management',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Check for updates',
      click: () => {
        try { onCheckForUpdates && onCheckForUpdates(); } catch (e) { log.error('[tray] update check failed', e); }
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

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

module.exports = { createTray, destroyTray, markQuitting, isAppQuitting };
