/**
 * CloakManager IPC Handlers
 *
 * IPC handlers for CloakManager integration including:
 * - Health checks and availability
 * - Browser mode settings (user and account level)
 * - Profile creation and lifecycle management
 * - CDP connection handling
 */

const { getCloakManagerClient } = require('../cloakmanager');
const { userFromToken } = require('./auth');
const { getDb, decryptSecret, credentialVaultGet } = require('../db');
const { hasPermission } = require('../permissions');
const cdpOrchestrator = require('../cdp/orchestrator');

function canAccessAccount(user, accountId) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (hasPermission(user, 'profiles.manage')) return true;
  if (!accountId) return false;
  const db = getDb();
  const acct = db.prepare('SELECT profile_id FROM reddit_accounts WHERE id = ?').get(accountId);
  if (!acct) return false;
  const row = db.prepare('SELECT assigned_user_id FROM model_profiles WHERE id = ?').get(acct.profile_id);
  if (row && row.assigned_user_id === user.id) return true;
  const assign = db.prepare('SELECT 1 FROM profile_assignments WHERE profile_id = ? AND user_id = ? LIMIT 1').get(acct.profile_id, user.id);
  return !!assign;
}

function profileIdForProfile(profileName) {
  if (!profileName) return null;
  const row = getDb().prepare('SELECT profile_id FROM cloakmanager_profiles WHERE profile_name = ?').get(profileName);
  return row?.profile_id || null;
}

function canAccessProfileById(user, profileId) {
  if (!user || !profileId) return false;
  if (user.role === 'admin') return true;
  if (hasPermission(user, 'profiles.manage')) return true;
  const db = getDb();
  const row = db.prepare('SELECT assigned_user_id FROM model_profiles WHERE id = ?').get(profileId);
  if (row && row.assigned_user_id === user.id) return true;
  return !!db.prepare('SELECT 1 FROM profile_assignments WHERE profile_id = ? AND user_id = ? LIMIT 1').get(profileId, user.id);
}

/**
 * Create (or re-create) the one shared CloakManager profile for a model,
 * independent of whether that model has any linked accounts yet, and
 * independent of which platform they're on. This is the single fingerprint
 * every one of the model's accounts — Reddit, X, Instagram, TikTok, RedGifs,
 * or any platform added later — launches into once the model is in
 * CloakManager mode.
 *
 * @param {number} profileId - model_profiles.id
 * @param {Object} [opts]
 * @param {string} [opts.os] - 'windows' | 'macos' etc, passed to CloakManager
 * @returns {Promise<{ok: boolean, profileName?: string, message?: string, error?: string}>}
 */
async function ensureModelCmProfile(profileId, opts = {}) {
  const { sanitizeForCmName, getDefaultProfileName, isValidCmName } = require('../lib/profileName');
  const db = getDb();

  const model = db.prepare('SELECT id, name, cloak_profile_name, proxy_id FROM model_profiles WHERE id = ?').get(profileId);
  if (!model) return { ok: false, error: 'Model not found' };

  let cmName = model.cloak_profile_name;
  if (!cmName) {
    cmName = getDefaultProfileName({ id: model.id, name: model.name });
  } else if (!isValidCmName(cmName)) {
    cmName = sanitizeForCmName(cmName);
  }

  const proxy = model.proxy_id
    ? db.prepare('SELECT id, host, port, kind as protocol, username, password_encrypted as password FROM proxies WHERE id = ?').get(model.proxy_id)
    : null;

  let proxyConfig = null;
  if (proxy) {
    proxyConfig = {
      host: proxy.host,
      port: proxy.port,
      protocol: proxy.protocol || 'socks5',
      username: proxy.username || '',
      password: proxy.password ? (credentialVaultGet('proxy_password', proxy.id) || decryptSecret(proxy.password) || '') : '',
      country: 'US',
    };
  }

  const client = getCloakManagerClient();
  const result = await client.createProfile(cmName, { os: opts.os || 'windows' }, proxyConfig).catch((err) => ({ ok: false, error: err.message }));

  if (!result.ok) return result;

  db.prepare('UPDATE model_profiles SET browser_mode = ?, cloak_profile_name = ? WHERE id = ?').run('cloakmanager', cmName, profileId);

  const existing = db.prepare('SELECT 1 FROM cloakmanager_profiles WHERE profile_id = ? AND account_id IS NULL').get(profileId);
  if (existing) {
    db.prepare('UPDATE cloakmanager_profiles SET profile_name = ?, status = ? WHERE profile_id = ? AND account_id IS NULL').run(cmName, 'created', profileId);
  } else {
    db.prepare('INSERT INTO cloakmanager_profiles (profile_id, profile_name, status) VALUES (?, ?, ?)').run(profileId, cmName, 'created');
  }

  return { ok: true, profileName: cmName, message: result.message };
}

/**
 * Register all CloakManager IPC handlers
 * @param {Object} ipcMain - Electron ipcMain instance
 * @param {Object} mainWindow - Electron mainWindow instance (for event broadcasting)
 * @param {Object} app - Electron app instance (for checking isPackaged)
 */
function registerCloakmanagerHandlers(ipcMain, mainWindow, app) {
  const client = getCloakManagerClient();

  // Initialize CDP orchestrator with CloakManager client
  cdpOrchestrator.initialize(mainWindow, client);
  console.log('[IPC] CDP orchestrator initialized');

  const relay = (channel, data) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, data);
  };

  // WebSocket events → renderer. The orchestrator owns the launch lifecycle;
  // these handlers only relay to the UI and nudge the orchestrator's state
  // machine. There is no longer a 95s setTimeout or a dual trigger — a launch
  // we started doesn't depend on `cdp_ready` at all (client.launchProfile
  // already blocks until the browser is up and verifies CDP); the event only
  // matters for profiles launched out-of-band from CloakManager's own UI.
  client.on('profile_launched', (data) => {
    console.log('[IPC] profile_launched:', data.profile);
    relay('cloakmanager:profile_launched', data);
  });

  client.on('profile_stopped', (data) => {
    console.log('[IPC] profile_stopped:', data.profile);
    relay('cloakmanager:profile_stopped', data);
    try { cdpOrchestrator.onProfileStopped(data.profile); }
    catch (error) { console.error('[IPC] onProfileStopped failed:', error); }
  });

  client.on('window_closed', (data) => {
    relay('cloakmanager:window_closed', data);
  });

  client.on('browser_crashed', (data) => {
    console.log('[IPC] browser_crashed:', data.profile);
    relay('cloakmanager:browser_crashed', data);
    try { cdpOrchestrator.onBrowserCrashed(data); }
    catch (error) { console.error('[IPC] onBrowserCrashed failed:', error); }
  });

  client.on('launch_progress', (data) => {
    relay('cloakmanager:launch_progress', data);
  });

  client.on('cdp_ready', (data) => {
    console.log('[IPC] cdp_ready:', data.profile);
    relay('cloakmanager:cdp_ready', data);
    try { cdpOrchestrator.onCdpReady(data.profile); }
    catch (error) { console.error('[IPC] onCdpReady failed:', error); }
  });

  // WebSocket connection events
  client.on('connected', () => {
    console.log('[IPC] CloakManager WebSocket connected');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('cloakmanager:ws_connected');
    }
  });

  client.on('disconnected', () => {
    console.log('[IPC] CloakManager WebSocket disconnected');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('cloakmanager:ws_disconnected');
    }
  });

  /**
   * Check if CloakManager backend is available
   */
  ipcMain.handle('cloakmanager:checkAvailable', async (event, { token }) => {
    try {
      console.log('[IPC] CloakManager availability check requested');

      const user = userFromToken(token);
      if (!user) {
        return { ok: false, available: false, error: 'Invalid token' };
      }

      const client = getCloakManagerClient();
      const available = await client.isAvailable();
      console.log('[IPC] CloakManager availability result:', available);
      return { ok: true, available, baseUrl: client.baseUrl };
    } catch (error) {
      console.error('[IPC] CloakManager availability check failed:', error);
      return { ok: false, available: false, error: error.message };
    }
  });

  /**
   * Get browser mode for a specific account (resolves from model_profiles)
   */
  ipcMain.handle('cloakmanager:getAccountMode', async (event, { token, accountId }) => {
    try {
      const user = userFromToken(token);
      if (!user) return { ok: false, error: 'Invalid token' };
      if (!canAccessAccount(user, accountId)) return { ok: false, error: 'Not authorized for this profile' };

      const { resolveBrowserMode } = require('../lib/browserMode');
      const { mode, profileName } = resolveBrowserMode(accountId);

      return { ok: true, mode, profileName };
    } catch (error) {
      console.error('Failed to get account browser mode:', error);
      return { ok: false, error: error.message };
    }
  });

  /**
   * Set browser mode for a model profile
   */
  ipcMain.handle('cloakmanager:setAccountMode', async (event, { token, accountId, mode, profileName }) => {
    try {
      const user = userFromToken(token);
      if (!user) return { ok: false, error: 'Invalid token' };
      if (user.role === 'chatter') return { ok: false, error: 'Chatters cannot change account settings' };

      if (!['electron', 'cloakmanager'].includes(mode)) {
        return { ok: false, error: 'Invalid browser mode' };
      }

      // Get the profile_id for this account
      const acct = getDb().prepare('SELECT profile_id FROM reddit_accounts WHERE id = ?').get(accountId);
      if (!acct) return { ok: false, error: 'Account not found' };

      if (mode === 'cloakmanager' && !profileName) {
        // Actually provisions the model's shared CM profile via the CM API
        // rather than only writing a name to the database.
        const result = await ensureModelCmProfile(acct.profile_id, {});
        return result.ok ? { ok: true, message: result.message } : result;
      }

      getDb().prepare(`
        UPDATE model_profiles SET browser_mode = ?, cloak_profile_name = ? WHERE id = ?
      `).run(mode, mode === 'electron' ? null : profileName, acct.profile_id);

      return { ok: true, message: 'Browser mode updated successfully' };
    } catch (error) {
      console.error('Failed to set account browser mode:', error);
      return { ok: false, error: error.message };
    }
  });

  /**
   * Create CloakManager profile for a model profile
   */
  ipcMain.handle('cloakmanager:createProfile', async (event, { token, accountId, accountConfig }) => {
    try {
      const user = userFromToken(token);
      if (!user) return { ok: false, error: 'Invalid token' };
      if (user.role === 'chatter') return { ok: false, error: 'Chatters cannot create profiles' };
      if (!canAccessAccount(user, accountId)) return { ok: false, error: 'Not authorized for this profile' };

      // Get the model profile for this account, including any per-account override
      const acct = getDb().prepare(`
        SELECT a.profile_id, a.username, a.platform, mp.name AS profile_name,
               mp.cloak_profile_name, mp.browser_mode,
               bs.cloak_profile_override
        FROM reddit_accounts a
        JOIN model_profiles mp ON mp.id = a.profile_id
        LEFT JOIN account_browser_settings bs ON bs.account_id = a.id
        WHERE a.id = ?
      `).get(accountId);

      if (!acct) return { ok: false, error: 'Account not found' };

      // No per-account override configured — this account uses the model's
      // one shared CloakManager profile. Delegate to the same model-level
      // creation path used when a model is switched into CloakManager mode,
      // so there's only one place that resolves the name/proxy and persists
      // the result.
      if (!acct.cloak_profile_override) {
        return ensureModelCmProfile(acct.profile_id, { os: accountConfig?.os });
      }

      const { sanitizeForCmName, isValidCmName } = require('../lib/profileName');

      // This account has its own override — a deliberately separate
      // instance from the model default (e.g. same-platform conflict).
      // Self-heal a name saved before sanitization existed.
      let cmName = acct.cloak_profile_override;
      if (!isValidCmName(cmName)) {
        cmName = sanitizeForCmName(cmName);
        getDb().prepare('UPDATE account_browser_settings SET cloak_profile_override = ? WHERE account_id = ?').run(cmName, accountId);
      }

      // Get proxy configuration — account's own proxy wins, else model's
      const proxy = getDb().prepare(`
        SELECT id, host, port, kind as protocol, username, password_encrypted as password
        FROM proxies
        WHERE id = (SELECT COALESCE(a.proxy_id, mp.proxy_id) FROM reddit_accounts a
                    JOIN model_profiles mp ON mp.id = a.profile_id WHERE a.id = ?)
      `).get(accountId);

      const client = getCloakManagerClient();

      let proxyConfig = null;
      if (proxy) {
        proxyConfig = {
          host: proxy.host,
          port: proxy.port,
          protocol: proxy.protocol || 'socks5',
          username: proxy.username || '',
          password: proxy.password ? (credentialVaultGet('proxy_password', proxy.id) || decryptSecret(proxy.password) || '') : '',
          country: 'US'
        };
      }

      const result = await client.createProfile(cmName, { os: accountConfig?.os || 'windows' }, proxyConfig);

      if (result.ok) {
        // Per-account override: insert its own row, keyed by profile_name.
        // Don't touch the model-level row — this is a deliberately separate
        // instance, not the model's shared profile.
        getDb().prepare(`
          INSERT INTO cloakmanager_profiles (profile_id, account_id, profile_name, status)
          VALUES (?, ?, ?, 'created')
          ON CONFLICT(profile_name) DO UPDATE SET status = 'created', account_id = excluded.account_id
        `).run(acct.profile_id, accountId, cmName);

        return { ok: true, profileName: cmName, message: result.message };
      }

      return result;
    } catch (error) {
      console.error('[IPC] Failed to create CloakManager profile:', error);
      return { ok: false, error: error.message };
    }
  });

  /**
   * Create (or retry) a model's shared CloakManager profile directly, with
   * no accountId required — works for a brand-new model with zero linked
   * accounts on any platform yet.
   */
  ipcMain.handle('cloakmanager:createModelProfile', async (event, { token, profileId, accountConfig }) => {
    try {
      const user = userFromToken(token);
      if (!user) return { ok: false, error: 'Invalid token' };
      if (user.role === 'chatter') return { ok: false, error: 'Chatters cannot create profiles' };
      if (!canAccessProfileById(user, profileId)) return { ok: false, error: 'Not authorized for this profile' };

      return await ensureModelCmProfile(profileId, { os: accountConfig?.os });
    } catch (error) {
      console.error('[IPC] Failed to create model CloakManager profile:', error);
      return { ok: false, error: error.message };
    }
  });

  /**
   * Launch CloakManager profile and get CDP connection info
   */
  ipcMain.handle('cloakmanager:launchProfile', async (event, { token, accountId, profileName }) => {
    try {
      const user = userFromToken(token);
      if (!user) return { ok: false, error: 'Invalid token' };
      if (!canAccessAccount(user, accountId)) return { ok: false, error: 'Not authorized for this profile' };

      // Resolve effective CM profile name from model_profiles
      const { resolveBrowserMode } = require('../lib/browserMode');
      const resolved = resolveBrowserMode(accountId);
      const effectiveName = profileName || resolved.profileName;

      if (!effectiveName) return { ok: false, error: 'No CloakManager profile configured' };

      // Single launch path — the orchestrator owns launch + CDP connect + the
      // model's setup script sequence (including login for the targeted
      // account). Idempotent per profile.
      const acct = accountId
        ? getDb().prepare('SELECT platform FROM reddit_accounts WHERE id = ?').get(accountId)
        : null;
      const result = await cdpOrchestrator.ensureProfileRunning(effectiveName, {
        accountId: accountId || null,
        platform: acct ? acct.platform : null,
        reason: 'manual',
        waitForScripts: false,
      });

      return result.ok
        ? {
            ok: true,
            profileName: effectiveName,
            cdpPort: result.cdpPort,
            cdpUrl: result.cdpUrl,
            cdpWsUrl: result.cdpWsUrl,
          }
        : { ok: false, error: result.error, code: result.code };
    } catch (error) {
      console.error('Failed to launch CloakManager profile:', error);
      return { ok: false, error: error.message };
    }
  });

  /**
   * Stop running CloakManager profile
   */
  ipcMain.handle('cloakmanager:stopProfile', async (event, { token, profileName }) => {
    try {
      // userFromToken is imported at top of file
      const user = userFromToken(token);

      if (!user) {
        return { ok: false, error: 'Invalid token' };
      }

      if (!canAccessProfileById(user, profileIdForProfile(profileName))) {
        return { ok: false, error: 'Not authorized for this profile' };
      }

      const client = getCloakManagerClient();
      const result = await client.stopProfile(profileName);

      if (result.ok) {
        // Update profile status in database
        // getDb() is imported at top of file
        getDb().prepare(`
          UPDATE cloakmanager_profiles
          SET status = 'stopped', cdp_port = NULL, cdp_url = NULL
          WHERE profile_name = ?
        `).run(profileName);
      }

      return result;
    } catch (error) {
      console.error('Failed to stop CloakManager profile:', error);
      return { ok: false, error: error.message };
    }
  });

  /**
   * Get profile information
   */
  ipcMain.handle('cloakmanager:getProfileInfo', async (event, { token, profileName }) => {
    try {
      // userFromToken is imported at top of file
      const user = userFromToken(token);

      if (!user) {
        return { ok: false, error: 'Invalid token' };
      }

      if (!canAccessProfileById(user, profileIdForProfile(profileName))) {
        return { ok: false, error: 'Not authorized for this profile' };
      }

      const client = getCloakManagerClient();
      const info = await client.getProfileInfo(profileName);

      return { ok: true, info };
    } catch (error) {
      console.error('Failed to get CloakManager profile info:', error);
      return { ok: false, error: error.message };
    }
  });

  /**
   * Delete CloakManager profile
   */
  ipcMain.handle('cloakmanager:deleteProfile', async (event, { token, profileName }) => {
    try {
      // userFromToken is imported at top of file
      const user = userFromToken(token);

      if (!user) {
        return { ok: false, error: 'Invalid token' };
      }

      if (user.role !== 'admin' && user.role !== 'owner') {
        return { ok: false, error: 'Only admins can delete profiles' };
      }

      const client = getCloakManagerClient();
      const result = await client.deleteProfile(profileName);

      if (result.ok) {
        // Remove from database
        // getDb() is imported at top of file
        getDb().prepare(`
          DELETE FROM cloakmanager_profiles WHERE profile_name = ?
        `).run(profileName);
      }

      return result;
    } catch (error) {
      console.error('Failed to delete CloakManager profile:', error);
      return { ok: false, error: error.message };
    }
  });

  /**
   * Get list of currently running profiles
   */
  ipcMain.handle('cloakmanager:getRunningProfiles', async (event, { token }) => {
    try {
      // userFromToken is imported at top of file
      const user = userFromToken(token);

      if (!user) {
        return { ok: false, error: 'Invalid token' };
      }

      const client = getCloakManagerClient();
      const running = await client.getRunningProfiles();

      return { ok: true, running };
    } catch (error) {
      console.error('Failed to get running profiles:', error);
      return { ok: false, error: error.message };
    }
  });

  /**
   * Get CDP connection information for a profile
   */
  ipcMain.handle('cloakmanager:getCDPInfo', async (event, { token, profileName }) => {
    try {
      // userFromToken is imported at top of file
      const user = userFromToken(token);

      if (!user) {
        return { ok: false, error: 'Invalid token' };
      }

      if (!canAccessProfileById(user, profileIdForProfile(profileName))) {
        return { ok: false, error: 'Not authorized for this profile' };
      }

      const client = getCloakManagerClient();
      const cdpInfo = await client.getCDPInfo(profileName);

      return { ok: true, cdpInfo };
    } catch (error) {
      console.error('Failed to get CDP info:', error);
      return { ok: false, error: error.message };
    }
  });

  /**
   * Test CDP connection for an account (for debugging)
   */
  ipcMain.handle('cloakmanager:testCDPConnection', async (event, { token, accountId }) => {
    try {
      // userFromToken is imported at top of file
      const user = userFromToken(token);

      if (!user) {
        return { ok: false, error: 'Invalid token' };
      }

      console.log('[IPC] Testing CDP connection for account:', accountId);

      const result = await cdpOrchestrator.testConnection(accountId);

      return {
        ok: result.success,
        result,
        message: result.message
      };
    } catch (error) {
      console.error('Failed to test CDP connection:', error);
      return { ok: false, error: error.message };
    }
  });

  /**
   * Run specific CDP test script (for debugging)
   */
  ipcMain.handle('cloakmanager:runCDPTest', async (event, { token, accountId, testScript }) => {
    try {
      // userFromToken is imported at top of file
      const user = userFromToken(token);

      if (!user) {
        return { ok: false, error: 'Invalid token' };
      }

      console.log('[IPC] Running CDP test script:', testScript, 'for account:', accountId);

      const connectionManager = require('../cdp/connection-manager');
      const connection = await connectionManager.getConnectionForAccount(accountId);

      if (!connection) {
        return { ok: false, error: 'Failed to establish CDP connection' };
      }

      const testModule = require(`../cdp-scripts/test/${testScript}`);
      const profileName = await cdpOrchestrator.getProfileNameForAccount(accountId);

      const result = await testModule.execute(connection, {
        accountId,
        profileName: profileName || 'unknown'
      });

      return {
        ok: result.success,
        result,
        message: result.message
      };
    } catch (error) {
      console.error('Failed to run CDP test:', error);
      return { ok: false, error: error.message };
    }
  });

  /**
   * Manual trigger for CDP launch scripts (for testing/debugging)
   */
  ipcMain.handle('cloakmanager:triggerLaunchScripts', async (event, { token, profileName }) => {
    try {
      console.log('[IPC] Manual trigger requested for profile:', profileName);

      const user = userFromToken(token);
      if (!user || (user.role !== 'admin' && user.role !== 'owner')) {
        return { ok: false, error: 'Unauthorized - admin only' };
      }

      console.log('[IPC] ✅ Manual trigger approved for admin:', user.username);
      const result = await cdpOrchestrator.ensureProfileRunning(profileName, { reason: 'manual-trigger' });

      return result.ok
        ? { ok: true, message: 'Launch scripts triggered successfully', profile: profileName, results: result.results }
        : { ok: false, error: result.error, code: result.code, profile: profileName };
    } catch (error) {
      console.error('[IPC] Manual trigger failed:', error);
      return { ok: false, error: error.message };
    }
  });

  /**
   * Get CDP script execution history
   */
  ipcMain.handle('cloakmanager:getExecutionHistory', async (event, { token, limit = 50 }) => {
    try {
      const user = userFromToken(token);
      if (!user) return { ok: false, error: 'Invalid token' };

      const { getDb } = require('../db');
      const db = getDb();
      const rows = db.prepare(`
        SELECT e.*, mp.name AS profile_name
        FROM cdp_script_executions e
        LEFT JOIN cloakmanager_profiles cp ON cp.profile_name = e.profile_name
        LEFT JOIN model_profiles mp ON mp.id = cp.profile_id
        ORDER BY e.started_at DESC
        LIMIT ?
      `).all(limit);

      return { ok: true, executions: rows || [] };
    } catch (error) {
      console.error('[IPC] Failed to get execution history:', error);
      return { ok: false, error: error.message };
    }
  });

  /**
   * Get CloakManager binary status and health
   * Exposes download, spawn, and connection state to UI
   */
  ipcMain.handle('cloakmanager:getBinaryStatus', async (event, { token }) => {
    try {
      const user = userFromToken(token);
      if (!user) {
        return { ok: false, error: 'Invalid token' };
      }

      // Access the globally-stored binary instance (stored in index.js)
      const cmBinary = global.cloakManagerBinary;

      if (!cmBinary) {
        // In dev mode or before auto-start
        return {
          ok: true,
          status: {
            binaryState: 'not_managed', // dev mode or before initialization
            isRunning: false,
            port: null,
            version: null,
            binaryExists: false,
            currentVersion: null,
            lastUpdateCheck: null,
            autoStartEnabled: app.isPackaged
          }
        };
      }

      const status = cmBinary.getStatus();
      const client = getCloakManagerClient();
      const health = await client.isAvailable();

      return {
        ok: true,
        status: {
          ...status,
          backendAvailable: health,
          baseUrl: client.baseUrl,
          autoStartEnabled: app.isPackaged
        }
      };
    } catch (error) {
      console.error('Failed to get binary status:', error);
      return { ok: false, error: error.message };
    }
  });

  /**
   * Manually trigger CloakManager download and spawn
   * Used by UI to retry failed auto-start or trigger first-time setup
   */
  ipcMain.handle('cloakmanager:startBinary', async (event, { token }) => {
    try {
      const user = userFromToken(token);
      if (!user || (user.role !== 'admin' && user.role !== 'owner')) {
        return { ok: false, error: 'Admin only' };
      }

      // Access or create binary instance
      const CloakManagerBinary = require('../services/cloakManagerBinary');
      let cmBinary = global.cloakManagerBinary;

      if (!cmBinary) {
        cmBinary = new CloakManagerBinary({ app });
        global.cloakManagerBinary = cmBinary;
      }

      // Emit progress events to renderer
      const emitProgress = (stage, message, percent = null) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('cloakmanager:binary_progress', {
            stage,
            message,
            percent
          });
        }
      };

      try {
        emitProgress('starting', 'Initializing CloakManager binary...');

        const fs = require('fs');
        const path = require('path');

        if (cmBinary.app.isPackaged) {
          // Production: seed from bundled binary
          const bundledPath = cmBinary.getBundledBinaryPath();
          const bundledManifest = cmBinary.getBundledManifest();

          if (!bundledPath || !fs.existsSync(bundledPath)) {
            emitProgress('error', 'Binary missing from app bundle — reinstall required');
            return {
              ok: false,
              error: 'CloakManager binary is missing from the application bundle. Please reinstall Oserus Management.'
            };
          }

          const binaryPath = cmBinary.getBinaryPath();
          const userVersion = cmBinary.getCurrentVersion();
          const needsSeed =
            !fs.existsSync(binaryPath) ||
            (bundledManifest && (!userVersion || userVersion.backendVersion !== bundledManifest.backendVersion));

          if (needsSeed) {
            emitProgress('installing', 'Installing CloakManager from bundle...', 50);

            const bundledDir = cmBinary.getBundledDir();
            const storageDir = cmBinary.getStorageDir();
            const runtimeDir = path.dirname(binaryPath);
            fs.mkdirSync(storageDir, { recursive: true });
            // Copy the whole folder (backend.exe + its DLLs) — the exe alone
            // can't load without them. See cloakManagerBinary.js getBinaryPath().
            fs.rmSync(runtimeDir, { recursive: true, force: true });
            fs.cpSync(bundledDir, runtimeDir, { recursive: true });

            const versionInfo = {
              backendVersion: bundledManifest?.backendVersion || 'unknown',
              seededAt: Date.now(),
              lastCheck: Date.now(),
              bundled: true,
            };
            fs.writeFileSync(cmBinary.getVersionPath(), JSON.stringify(versionInfo));

            emitProgress('installing', 'Install complete', 100);
          }
        } else {
          // Dev mode: binary must be provided by developer
          const binaryPath = cmBinary.getBinaryPath();
          if (!fs.existsSync(binaryPath)) {
            emitProgress('error', 'Binary not found — install manually in development mode');
            return {
              ok: false,
              error: `CloakManager binary not found. In development mode, place backend.exe (with its DLLs) in ${path.dirname(binaryPath)} or run CloakManager separately.`
            };
          }
        }

        // Spawn the binary
        emitProgress('spawning', 'Starting CloakManager service...');
        const port = await cmBinary.spawn();

        // Update CloakManager client
        emitProgress('connecting', 'Connecting to CloakManager...');
        const client = getCloakManagerClient();
        client.updateBaseUrl(`http://127.0.0.1:${port}`);
        await client.connectWebSocket();

        emitProgress('ready', 'CloakManager is ready', 100);

        return {
          ok: true,
          port,
          message: 'CloakManager started successfully'
        };
      } catch (spawnError) {
        emitProgress('error', `Failed: ${spawnError.message}`);

        let actionableError = spawnError.message;
        if (spawnError.message.includes('health check')) {
          actionableError = 'Service started but failed health check. Try again in 30 seconds.';
        } else if (spawnError.message.includes('missing from the application bundle') || spawnError.message.includes('reinstall')) {
          actionableError = 'CloakManager binary is missing. Please reinstall Oserus Management.';
        }

        return {
          ok: false,
          error: actionableError,
          technical: spawnError.message
        };
      }
    } catch (error) {
      console.error('Failed to start binary:', error);
      return { ok: false, error: error.message };
    }
  });

  /**
   * Stop the CloakManager binary
   * Used by UI to stop the service manually
   */
  ipcMain.handle('cloakmanager:stopBinary', async (event, { token }) => {
    try {
      const user = userFromToken(token);
      if (!user || (user.role !== 'admin' && user.role !== 'owner')) {
        return { ok: false, error: 'Admin only' };
      }

      const cmBinary = global.cloakManagerBinary;
      if (!cmBinary) {
        return { ok: true, message: 'Binary not running' };
      }

      await cmBinary.stop();

      return { ok: true, message: 'CloakManager stopped successfully' };
    } catch (error) {
      console.error('Failed to stop binary:', error);
      return { ok: false, error: error.message };
    }
  });

  // ----------------------------------------------------------------
  // Per-account launch script configuration
  // ----------------------------------------------------------------

  const scriptDiscovery = require('../cdp/script-discovery');

  ipcMain.handle('cloakmanager:getAvailableLaunchScripts', async (event, { token }) => {
    try {
      const user = userFromToken(token);
      if (!user) return { ok: false, error: 'Invalid token' };
      const scripts = scriptDiscovery.discoverLaunchScripts();
      return { ok: true, scripts };
    } catch (error) {
      console.error('[IPC] getAvailableLaunchScripts failed:', error);
      return { ok: false, error: error.message };
    }
  });

  // Launch-script configuration for a CloakManager profile — one shared
  // browser for the whole model, so this is model-level, not per account.
  ipcMain.handle('cloakmanager:getModelLaunchScripts', async (event, { token, profileId }) => {
    try {
      const user = userFromToken(token);
      if (!user) return { ok: false, error: 'Invalid token' };
      if (!canAccessProfileById(user, profileId)) return { ok: false, error: 'Permission denied' };

      const db = getDb();

      const platforms = db.prepare('SELECT DISTINCT platform FROM reddit_accounts WHERE profile_id = ?')
        .all(profileId).map(r => r.platform);
      scriptDiscovery.seedDefaultsForModel(profileId, platforms);

      const available = scriptDiscovery.discoverLaunchScripts();

      const custom = db.prepare(
        'SELECT * FROM custom_cdp_scripts WHERE account_id IS NULL ORDER BY name ASC'
      ).all();

      const configured = db.prepare(
        'SELECT * FROM model_launch_scripts WHERE profile_id = ? ORDER BY sort_order ASC, id ASC'
      ).all(profileId);

      return { ok: true, available, custom, configured, platforms };
    } catch (error) {
      console.error('[IPC] getModelLaunchScripts failed:', error);
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('cloakmanager:updateModelLaunchScript', async (event, { token, profileId, scriptId, enabled, runMode, sortOrder }) => {
    try {
      const user = userFromToken(token);
      if (!user) return { ok: false, error: 'Invalid token' };
      if (!canAccessProfileById(user, profileId)) return { ok: false, error: 'Permission denied' };

      const db = getDb();

      db.prepare(`
        INSERT INTO model_launch_scripts (profile_id, script_id, enabled, run_mode, sort_order, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(profile_id, script_id) DO UPDATE SET
          enabled = COALESCE(?, enabled),
          run_mode = COALESCE(?, run_mode),
          sort_order = COALESCE(?, sort_order),
          updated_at = datetime('now')
      `).run(
        profileId, scriptId,
        enabled != null ? (enabled ? 1 : 0) : 1,
        runMode || 'always',
        sortOrder != null ? sortOrder : 0,
        enabled != null ? (enabled ? 1 : 0) : null,
        runMode || null,
        sortOrder != null ? sortOrder : null
      );

      const updated = db.prepare(
        'SELECT * FROM model_launch_scripts WHERE profile_id = ? AND script_id = ?'
      ).get(profileId, scriptId);

      return { ok: true, script: updated };
    } catch (error) {
      console.error('[IPC] updateModelLaunchScript failed:', error);
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('cloakmanager:reorderModelLaunchScripts', async (event, { token, profileId, scriptIds }) => {
    try {
      const user = userFromToken(token);
      if (!user) return { ok: false, error: 'Invalid token' };
      if (!canAccessProfileById(user, profileId)) return { ok: false, error: 'Permission denied' };

      const db = getDb();
      const update = db.prepare(
        "UPDATE model_launch_scripts SET sort_order = ?, updated_at = datetime('now') WHERE profile_id = ? AND script_id = ?"
      );

      const txn = db.transaction(() => {
        for (let i = 0; i < scriptIds.length; i++) {
          update.run(i, profileId, scriptIds[i]);
        }
      });
      txn();

      return { ok: true };
    } catch (error) {
      console.error('[IPC] reorderModelLaunchScripts failed:', error);
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('cloakmanager:getCustomScripts', async (event, { token, accountId }) => {
    try {
      const user = userFromToken(token);
      if (!user) return { ok: false, error: 'Invalid token' };

      const db = getDb();
      const scripts = db.prepare(
        'SELECT * FROM custom_cdp_scripts WHERE account_id IS NULL OR account_id = ? ORDER BY name ASC'
      ).all(accountId);

      return { ok: true, scripts };
    } catch (error) {
      console.error('[IPC] getCustomScripts failed:', error);
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('cloakmanager:saveCustomScript', async (event, { token, accountId, id, name, description, platform, code }) => {
    try {
      const user = userFromToken(token);
      if (!user) return { ok: false, error: 'Invalid token' };

      const db = getDb();

      if (id) {
        db.prepare(`
          UPDATE custom_cdp_scripts
          SET name = ?, description = ?, platform = ?, code = ?, updated_at = datetime('now')
          WHERE id = ?
        `).run(name, description, platform, code, id);
      } else {
        const res = db.prepare(`
          INSERT INTO custom_cdp_scripts (account_id, name, description, platform, code)
          VALUES (?, ?, ?, ?, ?)
        `).run(accountId || null, name, description, platform, code);
        id = res.lastInsertRowid;
      }

      const script = db.prepare('SELECT * FROM custom_cdp_scripts WHERE id = ?').get(id);
      return { ok: true, script };
    } catch (error) {
      console.error('[IPC] saveCustomScript failed:', error);
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('cloakmanager:deleteCustomScript', async (event, { token, id }) => {
    try {
      const user = userFromToken(token);
      if (!user) return { ok: false, error: 'Invalid token' };

      const db = getDb();
      const scriptId = `custom:${id}`;

      db.prepare('DELETE FROM account_launch_scripts WHERE script_id = ?').run(scriptId);
      db.prepare('DELETE FROM model_launch_scripts WHERE script_id = ?').run(scriptId);
      db.prepare('DELETE FROM custom_cdp_scripts WHERE id = ?').run(id);

      return { ok: true };
    } catch (error) {
      console.error('[IPC] deleteCustomScript failed:', error);
      return { ok: false, error: error.message };
    }
  });
}

// Export CDP availability checker for use in coordinator and other services
module.exports = registerCloakmanagerHandlers;
module.exports.hasCDPAvailable = cdpOrchestrator.hasCDPAvailable;
// So profiles.js can provision a model's CM profile directly (no IPC
// round-trip) right when a model is created or switched into CM mode.
module.exports.ensureModelCmProfile = ensureModelCmProfile;