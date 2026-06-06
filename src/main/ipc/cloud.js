module.exports = function registerCloudHandlers(ipcMain) {
  const cloud = require('../sync/supabase');
  ipcMain.handle('cloud:getStatus', () => cloud.getStatus());
  ipcMain.handle('cloud:getConfig', () => cloud.getConfig());
  ipcMain.handle('cloud:setConfig', (_e, cfg) => cloud.setCredentials(cfg));
  ipcMain.handle('cloud:test', (_e, cfg) => cloud.testConnection(cfg));
  ipcMain.handle('cloud:start', () => cloud.start());
  ipcMain.handle('cloud:stop', () => cloud.stop());
  ipcMain.handle('cloud:getSchemaSql', () => {
    const fs = require('fs');
    const path = require('path');
    return fs.readFileSync(path.join(__dirname, '..', 'sync', 'supabase-schema.sql'), 'utf8');
  });
};
