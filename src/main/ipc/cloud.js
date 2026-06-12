module.exports = function registerCloudHandlers(ipcMain) {
  const cloud = require('../sync/supabase');
  ipcMain.handle('cloud:getStatus', () => cloud.getStatus());
  ipcMain.handle('cloud:getConfig', () => cloud.getConfig());
  ipcMain.handle('cloud:setConfig', (_e, cfg) => cloud.setCredentials(cfg));
  ipcMain.handle('cloud:test', (_e, cfg) => cloud.testConnection(cfg));
  ipcMain.handle('cloud:start', () => cloud.start());
  ipcMain.handle('cloud:stop', () => cloud.stop());
  // Per-table diagnostic. Used by the Settings → Cloud Sync table that
  // lists every synced table with its push/pull counters and the most
  // recent error if any. Lets the operator (and us) see exactly which
  // table is stuck instead of guessing from a single global lastError.
  ipcMain.handle('cloud:tableStatus', () => ({
    ok: true,
    running: cloud.isRunning(),
    tables: cloud.tableDiagnostics(),
  }));
  ipcMain.handle('cloud:forceResync', () => cloud.forceResync());
  // Force a push of every dirty row right now. Returns the per-table
  // result so the renderer can paint immediately rather than waiting
  // for the 1.5s push tick.
  ipcMain.handle('cloud:pushNow', () => cloud.pushNow());
  // Force a pull of every remote row. Used on first install or after
  // re-running setup SQL to bootstrap a machine.
  ipcMain.handle('cloud:pullAll', () => cloud.pullAll());
  ipcMain.handle('cloud:getSchemaSql', () => {
    const fs = require('fs');
    const path = require('path');
    return fs.readFileSync(path.join(__dirname, '..', 'sync', 'supabase-schema.sql'), 'utf8');
  });
};
