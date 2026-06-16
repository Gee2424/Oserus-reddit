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
const { getDb, decryptSecret } = require('../db');

/**
 * Register all CloakManager IPC handlers
 * @param {Object} ipcMain - Electron ipcMain instance
 * @param {Object} mainWindow - Electron mainWindow instance (for event broadcasting)
 */
function registerCloakmanagerHandlers(ipcMain, mainWindow) {
  const client = getCloakManagerClient();

  // Set up WebSocket event forwarding to renderer
  client.on('profile_launched', (data) => {
    console.log('[IPC] Broadcasting profile_launched:', data.profile);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('cloakmanager:profile_launched', data);
    }
  });

  client.on('profile_stopped', (data) => {
    console.log('[IPC] Broadcasting profile_stopped:', data.profile);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('cloakmanager:profile_stopped', data);
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
  ipcMain.handle('cloakmanager:checkAvailable', async (event) => {
    try {
      console.log('[IPC] CloakManager availability check requested');
      const client = getCloakManagerClient();
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

      if (account.platform !== 'reddit') {
        console.error('[IPC] Invalid platform for CloakManager:', account.platform);
        return { ok: false, error: 'CloakManager profiles only supported for Reddit accounts' };
      }

      console.log('[IPC] Creating CloakManager profile for account:', account.username);

      // Get proxy configuration if available (match actual schema)
      const proxy = getDb().prepare(`
        SELECT host, port, kind as protocol, username, password_encrypted as password
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
          password: proxy.password ? decryptSecret(proxy.password) : '',
          country: 'US' // Default country (not stored in proxy schema)
        };
        console.log('[IPC] Using proxy:', proxyConfig.host, proxyConfig.port);
      } else {
        console.log('[IPC] No proxy configured for account');
      }

      const result = await client.createProfile(account.username, accountConfig, proxyConfig);

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

        // CRITICAL FIX: Update account_browser_settings with the profile name
        // This ensures getAccountMode returns the profile name so we don't try to create duplicates
        getDb().prepare(`
          UPDATE account_browser_settings
          SET cloak_profile_name = ?
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
          SET cdp_port = ?, cdp_url = ?, fp_seed = ?, status = 'running'
          WHERE profile_name = ?
        `).run(result.cdpPort, result.cdpUrl, result.fpSeed, profileName);

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
}

module.exports = registerCloakmanagerHandlers;