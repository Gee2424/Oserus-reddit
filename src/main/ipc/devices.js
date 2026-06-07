module.exports = function registerDeviceHandlers(ipcMain) {
  const chrome = require('../services/realChrome');
  const devices = require('../services/deviceBridge');
  ipcMain.handle('chrome:detect', () => ({ path: chrome.getStoredChromePath(), detected: chrome.detectChromePath() }));
  ipcMain.handle('chrome:setPath', (_e, { path }) => { chrome.setChromePath(path); return { ok: true }; });
  ipcMain.handle('chrome:launch', (_e, args) => chrome.launchForAccount(args));
  ipcMain.handle('devices:list', () => devices.listDevices());
  ipcMain.handle('devices:getTools', () => devices.getToolPaths());
  ipcMain.handle('devices:setTools', (_e, args) => { devices.setToolPaths(args); return { ok: true }; });
};
