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
const cdpOrchestrator = require('../cdp/orchestrator');

// Phase 2: Configurable CDP launch delay for development
const CDP_LAUNCH_DELAY = process.env.CDP_LAUNCH_DELAY || 95000; // Default 95s, configurable via env

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

  // Set up WebSocket event forwarding to renderer
  client.on('profile_launched', async (data) => {
    console.log('[IPC] Broadcasting profile_launched:', data.profile);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('cloakmanager:profile_launched', data);
    }

    // Trigger CDP launch script sequence with delay for browser startup
    try {
      console.log('[IPC] Scheduling CDP launch scripts for profile:', data.profile, `(with ${CDP_LAUNCH_DELAY/1000}s delay for browser startup)`);
      console.log('[IPC] Current time:', new Date().toISOString(), 'Expected execution:', new Date(Date.now() + CDP_LAUNCH_DELAY).toISOString());

      // CRITICAL: CloakManager launch takes 90+ seconds due to Google navigation timeout
      // Delay CDP script execution to allow browser to fully launch and CDP to be ready
      setTimeout(async () => {
        console.log('[IPC] 🔔 setTimeout callback FIRED for profile:', data.profile);
        console.log('[IPC] 🔔 Timestamp:', new Date().toISOString());
        console.log('[IPC] 🔔 cdpOrchestrator type:', typeof cdpOrchestrator);
        console.log('[IPC] 🔔 cdpOrchestrator methods:', Object.keys(cdpOrchestrator));

        try {
          console.log('[IPC] 🔔 Calling cdpOrchestrator.handleProfileLaunched');
          await cdpOrchestrator.handleProfileLaunched(data);
          console.log('[IPC] 🔔 cdpOrchestrator.handleProfileLaunched COMPLETED');
        } catch (error) {
          console.error('[IPC] ❌ Failed to trigger CDP launch scripts:', error);
          console.error('[IPC] ❌ Error stack:', error.stack);
        }
      }, CDP_LAUNCH_DELAY); // Configurable delay for browser to fully launch and CDP to be ready
    } catch (error) {
      console.error('[IPC] Failed to schedule CDP launch scripts:', error);
    }
  });

  client.on('profile_stopped', (data) => {
    console.log('[IPC] Broadcasting profile_stopped:', data.profile);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('cloakmanager:profile_stopped', data);
    }

    // Cleanup CDP connections for stopped profile
    try {
      console.log('[IPC] Cleaning up CDP connections for profile:', data.profile);
      cdpOrchestrator.handleProfileStopped(data);
    } catch (error) {
      console.error('[IPC] Failed to cleanup CDP connections:', error);
    }
  });

  client.on('window_closed', (data) => {
    console.log('[IPC] Broadcasting window_closed:', data.profile);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('cloakmanager:window_closed', data);
    }
  });

  client.on('browser_crashed', (data) => {
    console.log('[IPC] Broadcasting browser_crashed:', data.profile);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('cloakmanager:browser_crashed', data);
    }
  });

  client.on('launch_progress', (data) => {
    console.log('[IPC] Broadcasting launch_progress:', data.profile, data.stage);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('cloakmanager:launch_progress', data);
    }
  });

  client.on('cdp_ready', (data) => {
    console.log('[IPC] Broadcasting cdp_ready:', data.profile);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('cloakmanager:cdp_ready', data);
    }

    // Mark profile as ready for CDP task scripts
    try {
      console.log('[IPC] Marking profile as CDP ready:', data.profile);
      cdpOrchestrator.handleCDPReady(data);
    } catch (error) {
      console.error('[IPC] Failed to mark profile as CDP ready:', error);
    }

    // Phase 3: Use cdp_ready event as immediate trigger for launch scripts
    // This bypasses the 95-second delay and triggers scripts as soon as CDP is ready
    try {
      console.log('[IPC] 🚀 cdp_ready event received, launching scripts immediately');
      console.log('[IPC] 🚀 Calling cdpOrchestrator.handleProfileLaunched from cdp_ready');
      cdpOrchestrator.handleProfileLaunched(data);
      console.log('[IPC] 🚀 CDP launch scripts completed from cdp_ready trigger');
    } catch (error) {
      console.error('[IPC] Failed to trigger CDP launch scripts from cdp_ready:', error);
    }
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

  client.on('fallback_to_polling', () => {
    console.log('[IPC] CloakManager falling back to HTTP polling');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('cloakmanager:ws_fallback');
    }
  });

  /**
   * Check if CloakManager backend is available
   */
  ipcMain.handle('cloakmanager:checkAvailable', async (event, { token }) => {
    try {
      console.log('[IPC] CloakManager availability check requested');

      // Get user from token
      const user = userFromToken(token);
      if (!user) {
        return { ok: false, available: false, error: 'Invalid token' };
      }

      // Load user's CloakManager URL setting and update client
      const settings = getDb().prepare(`
        SELECT cloakmanager_url
        FROM user_browser_settings
        WHERE user_id = ?
      `).get(user.id);

      const client = getCloakManagerClient();

      // Update client URL if user has custom setting
      if (settings && settings.cloakmanager_url) {
        client.updateBaseUrl(settings.cloakmanager_url);
        console.log('[IPC] Loaded user CloakManager URL:', settings.cloakmanager_url);
      }

      const available = await client.isAvailable();
      console.log('[IPC] CloakManager availability result:', available);
      return { ok: true, available };
    } catch (error) {
      console.error('[IPC] CloakManager availability check failed:', error);
      return { ok: false, available: false, error: error.message };
    }
  });

  /**
   * Get user browser mode settings
   */
  ipcMain.handle('cloakmanager:getSettings', async (event, { token, userId }) => {
    try {
      // userFromToken is imported at top of file
      const user = userFromToken(token);

      if (!user) {
        return { ok: false, error: 'Invalid token' };
      }

      // getDb() is imported at top of file
      const settings = getDb().prepare(`
        SELECT default_browser_mode, cloakmanager_url
        FROM user_browser_settings
        WHERE user_id = ?
      `).get(userId || user.id);

      return {
        ok: true,
        settings: {
          defaultMode: settings?.default_browser_mode || 'electron',
          cloakmanagerUrl: settings?.cloakmanager_url || 'http://127.0.0.1:7331'
        }
      };
    } catch (error) {
      console.error('Failed to get CloakManager settings:', error);
      return { ok: false, error: error.message };
    }
  });

  /**
   * Update user browser mode settings
   */
  ipcMain.handle('cloakmanager:updateSettings', async (event, { token, settings }) => {
    try {
      // userFromToken is imported at top of file
      const user = userFromToken(token);

      if (!user) {
        return { ok: false, error: 'Invalid token' };
      }

      if (user.role !== 'admin') {
        return { ok: false, error: 'Only admins can change browser settings' };
      }

      // getDb() is imported at top of file
      const { defaultMode, cloakmanagerUrl } = settings;

      // Check if settings already exist (no id column - user_id is the primary key)
      const existing = getDb().prepare(`
        SELECT user_id FROM user_browser_settings WHERE user_id = ?
      `).get(user.id);

      if (existing) {
        // Update existing settings
        getDb().prepare(`
          UPDATE user_browser_settings
          SET default_browser_mode = ?, cloakmanager_url = ?
          WHERE user_id = ?
        `).run(defaultMode, cloakmanagerUrl || 'http://127.0.0.1:7331', user.id);
      } else {
        // Create new settings
        getDb().prepare(`
          INSERT INTO user_browser_settings (user_id, default_browser_mode, cloakmanager_url)
          VALUES (?, ?, ?)
        `).run(user.id, defaultMode, cloakmanagerUrl || 'http://127.0.0.1:7331');
      }

      // CRITICAL: Update the CloakManager client's base URL
      if (cloakmanagerUrl) {
        const client = getCloakManagerClient();
        client.updateBaseUrl(cloakmanagerUrl);
        console.log('[IPC] Updated CloakManager client URL to:', cloakmanagerUrl);
      }

      return { ok: true, message: 'Settings updated successfully' };
    } catch (error) {
      console.error('Failed to update CloakManager settings:', error);
      return { ok: false, error: error.message };
    }
  });

  /**
   * Get browser mode for a specific account
   */
  ipcMain.handle('cloakmanager:getAccountMode', async (event, { token, accountId }) => {
    try {
      console.log('[IPC] cloakmanager:getAccountMode called with:', { accountId });

      // userFromToken is imported at top of file
      const user = userFromToken(token);
      console.log('[IPC] User from token:', user?.username, user?.role);

      if (!user) {
        console.error('[IPC] Invalid token');
        return { ok: false, error: 'Invalid token' };
      }

      // getDb() is imported at top of file

      // Get account settings
      console.log('[IPC] Querying account_browser_settings for accountId:', accountId);
      const accountSettings = getDb().prepare(`
        SELECT browser_mode, cloak_profile_name
        FROM account_browser_settings
        WHERE account_id = ?
      `).get(accountId);
      console.log('[IPC] Account settings:', accountSettings);

      let mode = 'electron';
      let profileName = accountSettings?.cloak_profile_name || null;

      if (accountSettings) {
        if (accountSettings.browser_mode === 'inherit') {
          // Get user default
          const userSettings = getDb().prepare(`
            SELECT default_browser_mode FROM user_browser_settings WHERE user_id = ?
          `).get(user.id);
          mode = userSettings?.default_browser_mode || 'electron';
        } else {
          mode = accountSettings.browser_mode;
          profileName = accountSettings.cloak_profile_name; // ← Added this line!
        }
      } else {
        // No account settings, check user default
        const userSettings = getDb().prepare(`
          SELECT default_browser_mode FROM user_browser_settings WHERE user_id = ?
        `).get(user.id);
        mode = userSettings?.default_browser_mode || 'electron';
      }

      return {
        ok: true,
        mode,
        profileName
      };
    } catch (error) {
      console.error('Failed to get account browser mode:', error);
      return { ok: false, error: error.message };
    }
  });

  /**
   * Set browser mode for a specific account
   */
  ipcMain.handle('cloakmanager:setAccountMode', async (event, { token, accountId, mode, profileName }) => {
    try {
      // userFromToken is imported at top of file
      const user = userFromToken(token);

      if (!user) {
        return { ok: false, error: 'Invalid token' };
      }

      if (user.role === 'chatter') {
        return { ok: false, error: 'Chatters cannot change account settings' };
      }

      // getDb() is imported at top of file

      // Validate mode
      if (!['electron', 'cloakmanager', 'inherit'].includes(mode)) {
        return { ok: false, error: 'Invalid browser mode' };
      }

      // Compute default profile name if not provided
      if (!profileName) {
        const { getProfileName } = require('../lib/profileName');
        const account = getDb().prepare('SELECT username, platform FROM reddit_accounts WHERE id = ?').get(accountId);
        if (account) {
          profileName = getProfileName(account);
          console.log('[IPC] Computed default profile name:', profileName);
        }
      }

      // Check if settings already exist (no id column - account_id is the primary key)
      const existing = getDb().prepare(`
        SELECT account_id, browser_mode, cloak_profile_name FROM account_browser_settings WHERE account_id = ?
      `).get(accountId);

      if (existing) {
        // Update existing settings
        getDb().prepare(`
          UPDATE account_browser_settings
          SET browser_mode = ?, cloak_profile_name = ?
          WHERE account_id = ?
        `).run(mode, profileName || null, accountId);
      } else {
        // Create new settings
        getDb().prepare(`
          INSERT INTO account_browser_settings (account_id, browser_mode, cloak_profile_name)
          VALUES (?, ?, ?)
        `).run(accountId, mode, profileName || null);
      }

      return { ok: true, message: 'Account mode updated successfully' };
    } catch (error) {
      console.error('Failed to set account browser mode:', error);
      return { ok: false, error: error.message };
    }
  });

  /**
   * Create CloakManager profile for an account
   */
  ipcMain.handle('cloakmanager:createProfile', async (event, { token, accountId, accountConfig }) => {
    try {
      console.log('[IPC] CloakManager profile creation requested for account:', accountId);

      // userFromToken is imported at top of file
      const user = userFromToken(token);

      if (!user) {
        return { ok: false, error: 'Invalid token' };
      }

      if (user.role === 'chatter') {
        return { ok: false, error: 'Chatters cannot create profiles' };
      }

      // getDb() is imported at top of file

      // Get account details
      const account = getDb().prepare(`
        SELECT username, platform FROM reddit_accounts WHERE id = ?
      `).get(accountId);

      if (!account) {
        console.error('[IPC] Account not found:', accountId);
        return { ok: false, error: 'Account not found' };
      }

      console.log('[IPC] Creating CloakManager profile for account:', account.username, 'platform:', account.platform);

      // Get proxy configuration if available (match actual schema)
      const proxy = getDb().prepare(`
        SELECT id, host, port, kind as protocol, username, password_encrypted as password
        FROM proxies
        WHERE id = (SELECT proxy_id FROM reddit_accounts WHERE id = ?)
      `).get(accountId);

      const client = getCloakManagerClient();

      // Decrypt proxy password if present
      let proxyConfig = null;
      if (proxy) {
        proxyConfig = {
          host: proxy.host,
          port: proxy.port,
          protocol: proxy.protocol || 'socks5',
          username: proxy.username || '',
          password: proxy.password ? (credentialVaultGet('proxy_password', proxy.id) || decryptSecret(proxy.password) || '') : '',
          country: 'US' // Default country (not stored in proxy schema)
        };
        console.log('[IPC] Using proxy:', proxyConfig.host, proxyConfig.port);
      } else {
        console.log('[IPC] No proxy configured for account');
      }

      const result = await client.createProfile(account.username, { ...accountConfig, platform: account.platform }, proxyConfig);

      if (result.ok) {
        console.log('[IPC] ✅ Profile created successfully:', result);

        // Store profile reference in database (no id column - profile_name is unique)
        const existing = getDb().prepare(`
          SELECT profile_name FROM cloakmanager_profiles WHERE account_id = ?
        `).get(accountId);

        if (existing) {
          getDb().prepare(`
            UPDATE cloakmanager_profiles
            SET profile_name = ?, status = 'created'
            WHERE account_id = ?
          `).run(result.profileName, accountId);
        } else {
          getDb().prepare(`
            INSERT INTO cloakmanager_profiles (account_id, profile_name, status)
            VALUES (?, ?, 'created')
          `).run(accountId, result.profileName);
        }

        // CRITICAL FIX: Update account_browser_settings with the profile name AND browser mode
        // This ensures getAccountMode returns the profile name and CDP orchestrator can find the account
        getDb().prepare(`
          UPDATE account_browser_settings
          SET cloak_profile_name = ?, browser_mode = 'cloakmanager'
          WHERE account_id = ?
        `).run(result.profileName, accountId);

        console.log('[IPC] ✅ Profile name stored in account_browser_settings:', result.profileName);

        return { ok: true, profileName: result.profileName, message: result.message };
      }

      console.error('[IPC] ❌ Profile creation failed:', result);
      return result;
    } catch (error) {
      console.error('[IPC] ❌ Failed to create CloakManager profile:', error);
      return { ok: false, error: error.message };
    }
  });

  /**
   * Launch CloakManager profile and get CDP connection info
   */
  ipcMain.handle('cloakmanager:launchProfile', async (event, { token, accountId, profileName }) => {
    try {
      console.log('[IPC] cloakmanager:launchProfile called with:', { accountId, profileName });

      // userFromToken is imported at top of file
      const user = userFromToken(token);

      if (!user) {
        console.error('[IPC] Invalid token');
        return { ok: false, error: 'Invalid token' };
      }

      console.log('[IPC] Calling client.launchProfile with:', profileName);
      const client = getCloakManagerClient();
      const result = await client.launchProfile(profileName);
      console.log('[IPC] client.launchProfile result:', result);

      if (result.ok) {
        // Update profile status in database
        // getDb() is imported at top of file
        getDb().prepare(`
          UPDATE cloakmanager_profiles
          SET cdp_port = ?, cdp_url = ?, cdp_ws_url = ?, fp_seed = ?, status = 'running'
          WHERE profile_name = ?
        `).run(result.cdpPort, result.cdpUrl, result.cdpWsUrl, result.fpSeed, profileName);

        return {
          ok: true,
          profileName: result.profileName,
          cdpPort: result.cdpPort,
          cdpUrl: result.cdpUrl,
          cdpWsUrl: result.cdpWsUrl,
          proxyVerified: result.proxyVerified,
          proxyIp: result.proxyIp,
          fpSeed: result.fpSeed
        };
      }

      return result;
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

      if (user.role !== 'admin') {
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
      if (!user || user.role !== 'admin') {
        return { ok: false, error: 'Unauthorized - admin only' };
      }

      console.log('[IPC] ✅ Manual trigger approved for admin:', user.username);
      await cdpOrchestrator.handleProfileLaunched({ profile: profileName });

      return {
        ok: true,
        message: 'Launch scripts triggered successfully',
        profile: profileName
      };
    } catch (error) {
      console.error('[IPC] Manual trigger failed:', error);
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
      const health = await getCloakManagerClient().isAvailable();

      return {
        ok: true,
        status: {
          ...status,
          backendAvailable: health,
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
      if (!user || user.role !== 'admin') {
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

        // Step 1: Ensure binary exists
        const binaryPath = cmBinary.getBinaryPath();
        const fs = require('fs');
        if (!fs.existsSync(binaryPath)) {
          emitProgress('downloading', 'Downloading CloakManager binary...', 0);

          const latest = await cmBinary.fetchLatestRelease();
          emitProgress('downloading', `Downloading version ${latest.version}...`, 10);

          // Download with progress tracking
          await cmBinary.downloadBinary(latest.downloadUrl, latest.version);
          emitProgress('downloading', 'Download complete', 100);
        }

        // Step 2: Check for updates
        emitProgress('updating', 'Checking for updates...');
        await cmBinary.checkForUpdates();

        // Step 3: Spawn the binary
        emitProgress('spawning', 'Starting CloakManager service...');
        const port = await cmBinary.spawn();

        // Step 4: Update CloakManager client
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

        // Provide actionable error messages
        let actionableError = spawnError.message;
        if (spawnError.message.includes('rate limit')) {
          actionableError = 'GitHub rate limit exceeded. Please wait a few minutes and try again.';
        } else if (spawnError.message.includes('network')) {
          actionableError = 'Network error. Check your internet connection.';
        } else if (spawnError.message.includes('health check')) {
          actionableError = 'Service started but failed health check. Try again in 30 seconds.';
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
      if (!user || user.role !== 'admin') {
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
}

// Export CDP availability checker for use in coordinator and other services
module.exports = registerCloakmanagerHandlers;
module.exports.hasCDPAvailable = cdpOrchestrator.hasCDPAvailable;