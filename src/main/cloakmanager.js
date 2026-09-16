/**
 * CloakManager API Client Wrapper
 *
 * Provides a clean interface for interacting with the CloakManager backend API,
 * with built-in error handling, health checks, and connection management.
 *
 * CloakManager Backend API: http://127.0.0.1:7331
 */

const axios = require('axios');
const WebSocket = require('ws');

// CloakManager API configuration
const CLOAKMANAGER_API = process.env.CLOAKMANAGER_URL || 'http://127.0.0.1:7331';
const API_TIMEOUT = 5000; // 5 second timeout for API calls

class CloakManagerClient {
  constructor() {
    this.baseUrl = CLOAKMANAGER_API;
    this.available = null; // Cache availability status

    // WebSocket setup. `_wsState` is the single source of truth for the
    // connection ('idle' | 'connecting' | 'connected'); every path that wants
    // the socket up calls `connectWebSocket()`, which is a no-op unless idle.
    // `_wantConnected` gates the auto-reconnect so a deliberate
    // disconnectWebSocket() doesn't immediately reconnect itself.
    this.ws = null;
    this.wsConnected = false;
    this._wsState = 'idle';
    this._wantConnected = false;
    this._reconnectTimer = null;
    this.reconnectAttempts = 0;
    this.eventHandlers = new Map(); // event listeners
    this.clientId = 'osertus_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  /**
   * Update the CloakManager API base URL
   * Called when user settings are updated
   * @param {string} newUrl - New CloakManager URL
   */
  updateBaseUrl(newUrl) {
    console.log('[CloakManager] Updating base URL from', this.baseUrl, 'to', newUrl);
    this.baseUrl = newUrl;
    this.available = null; // Reset availability cache

    // Point the socket at the new URL. One teardown + one reconnect.
    if (this._wsState !== 'idle' || this._wantConnected) {
      console.log('[CloakManager] Rebinding WebSocket to new URL…');
      this.disconnectWebSocket();
      setTimeout(() => this.connectWebSocket(), 500);
    }
  }

  /**
   * Check if CloakManager backend is available
   * @returns {Promise<boolean>} true if CloakManager is responding
   */
  async isAvailable() {
    // If we have a recent cached result, use it
    if (this.available !== null && Date.now() - this._lastCheck < 30000) {
      return this.available;
    }

    try {
      console.log('[CloakManager] Checking availability at:', this.baseUrl);
      const response = await axios.get(`${this.baseUrl}/api/running`, {
        timeout: 2000 // 2 second timeout
      });

      const wasUnavailable = !this.available;
      this.available = response.status === 200;
      this._lastCheck = Date.now();
      console.log('[CloakManager] ✅ Available:', this.available);

      // Backend just came online — reconnect WebSocket if disconnected
      if (this.available && wasUnavailable && !this.wsConnected) {
        console.log('[CloakManager] Backend became available, reconnecting WebSocket...');
        this.reconnectAttempts = 0;
        this.connectWebSocket();
      }

      return this.available;
    } catch (error) {
      console.log('[CloakManager] ❌ Unavailable:', error.message);
      this.available = false;
      this._lastCheck = Date.now();
      return false;
    }
  }

  /**
   * Create a CloakManager profile
   * @param {string} profileName - Profile name (model-level: model-{id}-{name})
   * @param {Object} accountConfig - Optional config
   * @param {Object} proxyConfig - Optional proxy configuration
   * @returns {Promise<Object>} Profile creation result
   */
  async createProfile(profileName, accountConfig = {}, proxyConfig = null) {
    console.log('[CloakManager] createProfile called with:', profileName, accountConfig, proxyConfig);

    if (!await this.isAvailable()) {
      console.error('[CloakManager] Not available');
      throw new Error('CloakManager is not available');
    }

    try {
      const payload = {
        name: profileName,
        headless: false,
        browser_brand: "Chrome",
        warmup_enabled: true,
        warmup_sites: [
          "https://www.google.com",
          "https://www.wikipedia.org",
          "https://www.youtube.com",
          "https://www.reddit.com"
        ],
        seed_name: `${accountConfig.os || 'windows'}-chrome-us`,
        os: accountConfig.os || 'windows',
        browser_theme: "light"
      };

      // Add proxy if provided (with auto_geoip for timezone/locale detection)
      if (proxyConfig) {
        const proxy = await this._getOrCreateProxy(proxyConfig);
        if (proxy) {
          payload.proxy_id = proxy.id;
          payload.auto_geoip = true;
        }
      }

      console.log('[CloakManager] Creating profile with minimal payload:', payload);
      console.log('[CloakManager] POST URL:', `${this.baseUrl}/api/profiles`);
      const response = await axios.post(`${this.baseUrl}/api/profiles`, payload);
      console.log('[CloakManager] POST response:', response.status, response.data);

      if (response.data && response.data.ok) {
        console.log('[CloakManager] ✅ Profile created successfully:', {
          name: response.data.name,
          fingerprint_seed: response.data.fingerprint_seed
        });
        return {
          ok: true,
          profileName: response.data.name,
          fingerprintSeed: response.data.fingerprint_seed,
          seedName: response.data.seed_name,
          message: `Profile ${profileName} created successfully`
        };
      } else {
        throw new Error(response.data?.error || 'Profile creation failed');
      }
    } catch (error) {
      // A 409 means CloakManager already has a profile with this name — from
      // an earlier attempt whose response never reached us (e.g. the caller
      // crashed/retried before our DB write landed). ensureModelCmProfile /
      // the account-override path both call createProfile as "create if
      // missing"; treating 409 as a hard failure means the local
      // cloakmanager_profiles row never gets written, so every future launch
      // fails its ownership check forever even though the profile is real
      // and usable. Confirm it actually exists, then succeed idempotently.
      if (error.response?.status === 409) {
        console.warn('[CloakManager] createProfile got 409 — profile already exists remotely, confirming and treating as success:', profileName);
        try {
          const info = await this.getProfileInfo(profileName);
          return {
            ok: true,
            profileName: info?.name || profileName,
            fingerprintSeed: info?.fingerprint_seed,
            seedName: info?.seed_name,
            message: `Profile ${profileName} already existed`,
          };
        } catch (infoErr) {
          throw new Error(`Profile "${profileName}" already exists on CloakManager but couldn't be confirmed: ${infoErr.message}`);
        }
      }
      if (error.response) {
        throw new Error(error.response.data?.detail || error.response.data?.error || error.message);
      }
      throw new Error(`Failed to create profile: ${error.message}`);
    }
  }

  /**
   * Launch a CloakManager profile and get CDP connection info
   * @param {string} profileName - Profile name to launch
   * @returns {Promise<Object>} Launch result with CDP endpoint information
   */
  async launchProfile(profileName) {
    console.log('[CloakManager] launchProfile called with:', profileName);

    if (!await this.isAvailable()) {
      console.error('[CloakManager] ❌ Not available');
      throw new Error('CloakManager is not available');
    }

    try {
      console.log('[CloakManager] 🚀 Launching profile:', profileName);
      console.log('[CloakManager] POST URL:', `${this.baseUrl}/api/profiles/${profileName}/launch`);

      // CRITICAL: Profile launch can take 90+ seconds due to Google navigation timeout
      // Use extended timeout for launch operations
      const response = await axios.post(
        `${this.baseUrl}/api/profiles/${profileName}/launch`,
        {},  // Empty body - launch doesn't need parameters
        { timeout: 120000 }  // 2 minute timeout for launch (can take 90+ seconds)
      );
      console.log('[CloakManager] POST response:', response.status, response.data);

      if (response.data && response.data.ok) {
        console.log('[CloakManager] ✅ Profile launched:', {
          pid: response.data.pid,
          cdp_port: response.data.cdp_port,
          cdp_url: response.data.cdp_url,
          fp_seed: response.data.fp_seed
        });

        // Get full profile details to get cdp_ws_url
        const profileDetails = await this.getProfileInfo(profileName);

        // Phase 0.1: CDP URL verification
        console.log('[CloakManager] 🔍 CDP URL verification:', {
          has_cdp_port: !!response.data.cdp_port,
          has_cdp_url: !!response.data.cdp_url,
          has_cdp_ws_url: !!profileDetails.cdp_ws_url,
          cdp_ws_url: profileDetails.cdp_ws_url || 'MISSING - CDP WILL FAIL',
          profile_status: profileDetails.status
        });

        if (!profileDetails.cdp_ws_url) {
          console.error('[CloakManager] ❌ CDP WebSocket URL missing - cannot establish CDP connection');
          throw new Error('CDP WebSocket URL not available from CloakManager API');
        }

        console.log('[CloakManager] ✅ CDP WebSocket URL verified:', profileDetails.cdp_ws_url);

        // Phase 0.3: Test CDP connection before proceeding
        const connectionManager = require('./cdp/connection-manager');
        const connectionTest = await connectionManager.testCDPConnection(profileDetails.cdp_ws_url);

        if (!connectionTest.success) {
          console.error('[CloakManager] ❌ CDP connection test failed - aborting launch scripts');
          return {
            ok: true,  // Profile launched, but CDP not ready
            profileName: profileName,
            pid: response.data.pid,
            proxyVerified: response.data.proxy_verified,
            proxyIp: response.data.proxy_ip,
            fpSeed: response.data.fp_seed,
            cdpPort: response.data.cdp_port,
            cdpUrl: response.data.cdp_url,
            cdpWsUrl: profileDetails.cdp_ws_url,
            cdpReady: false,  // Flag indicating CDP not actually ready
            connectionError: connectionTest.error
          };
        }

        console.log('[CloakManager] ✅ CDP connection verified and working');

        return {
          ok: true,
          profileName: profileName,
          pid: response.data.pid,
          proxyVerified: response.data.proxy_verified,
          proxyIp: response.data.proxy_ip,
          fpSeed: response.data.fp_seed,
          cdpPort: response.data.cdp_port,
          cdpUrl: response.data.cdp_url,
          cdpWsUrl: profileDetails.cdp_ws_url, // Get from profile details
          fingerprintSeed: profileDetails.fingerprint_seed
        };
      } else {
        throw new Error(response.data?.error || 'Profile launch failed');
      }
    } catch (error) {
      console.error('[CloakManager] ❌ Launch failed:', error.message);

      // Handle 409 Conflict - profile already running (this is OK!)
      if (error.response?.status === 409) {
        console.log('[CloakManager] ℹ️ Profile already running, getting current info...');
        try {
          const profileInfo = await this.getProfileInfo(profileName);
          console.log('[CloakManager] ✅ Using existing profile:', profileInfo);

          return {
            ok: true,
            alreadyRunning: true,  // Flag indicating profile was already running
            profileName: profileName,
            pid: profileInfo.pid,
            proxyVerified: false,
            proxyIp: null,
            fpSeed: profileInfo.fingerprint_seed,
            cdpPort: profileInfo.cdp_port,
            cdpUrl: profileInfo.cdp_url,
            cdpWsUrl: profileInfo.cdp_ws_url,
            fingerprintSeed: profileInfo.fingerprint_seed
          };
        } catch (infoError) {
          console.error('[CloakManager] ❌ Failed to get profile info after 409:', infoError.message);
          throw new Error(`Profile already running but couldn't get info: ${infoError.message}`);
        }
      }

      // Handle other errors
      if (error.response) {
        console.error('[CloakManager] ❌ Response data:', error.response.data);
        throw new Error(error.response.data?.detail || error.response.data?.error || error.message);
      }
      throw new Error(`Failed to launch profile: ${error.message}`);
    }
  }

  /**
   * Stop a running CloakManager profile
   * @param {string} profileName - Profile name to stop
   * @returns {Promise<Object>} Stop result
   */
  async stopProfile(profileName) {
    if (!await this.isAvailable()) {
      console.log(`Cannot stop ${profileName}: CloakManager unavailable`);
      return { ok: false, message: 'CloakManager unavailable' };
    }

    try {
      const response = await axios.post(
        `${this.baseUrl}/api/profiles/${profileName}/stop`
      );

      return {
        ok: response.status === 200,
        message: response.data?.message || 'Profile stopped'
      };
    } catch (error) {
      console.error(`Failed to stop profile ${profileName}:`, error.message);
      return { ok: false, error: error.message };
    }
  }

  /**
   * Get profile information including CDP connection details
   * @param {string} profileName - Profile name
   * @returns {Promise<Object>} Profile information
   */
  async getProfileInfo(profileName) {
    if (!await this.isAvailable()) {
      throw new Error('CloakManager is not available');
    }

    try {
      const response = await axios.get(
        `${this.baseUrl}/api/profiles/${profileName}`
      );

      return response.data;
    } catch (error) {
      if (error.response) {
        throw new Error(error.response.data?.error || error.message);
      }
      throw new Error(`Failed to get profile info: ${error.message}`);
    }
  }

  /**
   * Get list of currently running profiles
   * @returns {Promise<Object>} List of running profiles with CDP info
   */
  async getRunningProfiles() {
    if (!await this.isAvailable()) {
      return { running: {}, available: false };
    }

    try {
      const response = await axios.get(`${this.baseUrl}/api/running`);
      return response.data;
    } catch (error) {
      console.error('Failed to get running profiles:', error.message);
      return { running: {}, available: false, error: error.message };
    }
  }

  /**
   * Get CDP connection information for a profile
   * @param {string} profileName - Profile name
   * @returns {Promise<Object>} CDP connection details
   */
  async getCDPInfo(profileName) {
    if (!await this.isAvailable()) {
      throw new Error('CloakManager is not available');
    }

    try {
      const response = await axios.get(
        `${this.baseUrl}/api/profiles/${profileName}/cdp`
      );

      return response.data;
    } catch (error) {
      if (error.response) {
        throw new Error(error.response.data?.error || error.message);
      }
      throw new Error(`Failed to get CDP info: ${error.message}`);
    }
  }

  /**
   * Check if a profile exists
   * @param {string} profileName - Profile name to check
   * @returns {Promise<boolean>} true if profile exists
   */
  async profileExists(profileName) {
    if (!await this.isAvailable()) {
      return false;
    }

    try {
      const response = await axios.get(
        `${this.baseUrl}/api/profiles/${profileName}`
      );
      return response.status === 200;
    } catch (error) {
      return false;
    }
  }

  /**
   * Delete a CloakManager profile
   * @param {string} profileName - Profile name to delete
   * @returns {Promise<Object>} Deletion result
   */
  async deleteProfile(profileName) {
    if (!await this.isAvailable()) {
      throw new Error('CloakManager is not available');
    }

    try {
      const response = await axios.delete(
        `${this.baseUrl}/api/profiles/${profileName}`
      );

      return {
        ok: response.status === 200,
        message: response.data?.message || 'Profile deleted'
      };
    } catch (error) {
      if (error.response) {
        throw new Error(error.response.data?.error || error.message);
      }
      throw new Error(`Failed to delete profile: ${error.message}`);
    }
  }

  /**
   * Get or create a proxy configuration
   * @param {Object} proxyConfig - Proxy configuration
   * @returns {Promise<Object>} Proxy object with ID
   */
  async _getOrCreateProxy(proxyConfig) {
    // First try to find existing proxy by host:port
    try {
      const listResponse = await axios.get(`${this.baseUrl}/api/proxies`);
      const existingProxy = listResponse.data.find(
        p => p.host === proxyConfig.host && p.port === proxyConfig.port
      );

      if (existingProxy) {
        return existingProxy;
      }
    } catch (error) {
      console.error('Failed to list proxies:', error.message);
    }

    // Create new proxy
    try {
      const payload = {
        label: `${proxyConfig.host}:${proxyConfig.port}`,
        protocol: proxyConfig.protocol || 'socks5',
        host: proxyConfig.host,
        port: proxyConfig.port,
        username: proxyConfig.username || '',
        password: proxyConfig.password || '',
        country: proxyConfig.country || 'US',
        bypass: 'localhost,127.0.0.1'
      };

      const response = await axios.post(`${this.baseUrl}/api/proxies`, payload);

      return response.data;
    } catch (error) {
      console.error('Failed to create proxy:', error.message);
      return null;
    }
  }

  /**
   * Connect to CloakManager WebSocket for real-time events.
   * The single entry point — safe to call from anywhere, any number of times.
   * A no-op unless the socket is idle.
   */
  connectWebSocket() {
    this._wantConnected = true;
    if (this._wsState !== 'idle') return; // already connecting or connected
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }

    const wsUrl = this.baseUrl.replace('http://', 'ws://').replace('https://', 'wss://') + `/ws/${this.clientId}`;
    console.log('[CloakManager WS] Connecting to:', wsUrl);
    this._wsState = 'connecting';

    let ws;
    try {
      ws = new WebSocket(wsUrl);
    } catch (error) {
      console.error('[CloakManager WS] Failed to create WebSocket:', error);
      this._wsState = 'idle';
      this._emit('fallback_to_polling');
      this._scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.on('open', () => {
      if (this.ws !== ws) { try { ws.close(); } catch {} return; } // superseded
      console.log('[CloakManager WS] ✅ Connected');
      this._wsState = 'connected';
      this.wsConnected = true;
      this.reconnectAttempts = 0;
      this._emit('connected');
    });

    ws.on('message', (data) => {
      if (this.ws !== ws) return;
      try {
        const event = JSON.parse(data);
        console.log('[CloakManager WS] Event:', event.type, event.profile || event.extension);
        this._handleWebSocketEvent(event);
      } catch (error) {
        console.error('[CloakManager WS] Failed to parse message:', error);
      }
    });

    ws.on('close', () => {
      if (this.ws !== ws) return; // an old socket we already replaced
      this.ws = null;
      this.wsConnected = false;
      this._wsState = 'idle';
      this._emit('disconnected');
      if (this._wantConnected) {
        console.log('[CloakManager WS] Disconnected — will reconnect');
        this._scheduleReconnect();
      } else {
        console.log('[CloakManager WS] Disconnected (intentional)');
      }
    });

    ws.on('error', (error) => {
      if (this.ws === ws) console.error('[CloakManager WS] Error:', error.message || error);
    });
  }

  /**
   * Register event listener for WebSocket events
   * @param {string} event - Event name
   * @param {Function} callback - Event handler callback
   */
  on(event, callback) {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event).push(callback);
  }

  /**
   * Unregister event listener for WebSocket events
   * @param {string} event - Event name
   * @param {Function} callback - Event handler callback to remove
   */
  off(event, callback) {
    if (!this.eventHandlers.has(event)) return;
    const handlers = this.eventHandlers.get(event);
    const index = handlers.indexOf(callback);
    if (index > -1) {
      handlers.splice(index, 1);
    }
  }

  /**
   * Emit event to all registered listeners
   * @param {string} event - Event name
   * @param {Object} data - Event data
   */
  _emit(event, data) {
    if (this.eventHandlers.has(event)) {
      this.eventHandlers.get(event).forEach(callback => callback(data));
    }
  }

  /**
   * Handle incoming WebSocket events
   * @param {Object} data - Parsed WebSocket event data
   */
  _handleWebSocketEvent(data) {
    // Emit to local listeners
    this._emit(data.type, data);
  }

  /**
   * Schedule WebSocket reconnection with exponential backoff.
   * Retries forever — the CM backend may be started later.
   */
  _scheduleReconnect() {
    if (!this._wantConnected || this._reconnectTimer || this._wsState !== 'idle') return;
    const delay = Math.min(1000 * Math.pow(2, Math.min(this.reconnectAttempts, 6)), 30000);
    this.reconnectAttempts++;
    console.log(`[CloakManager WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this.connectWebSocket();
    }, delay);
  }

  /**
   * Disconnect WebSocket and stop auto-reconnect until connectWebSocket() is
   * called again.
   */
  disconnectWebSocket() {
    this._wantConnected = false;
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
    const ws = this.ws;
    this.ws = null;
    this.wsConnected = false;
    this._wsState = 'idle';
    this.reconnectAttempts = 0;
    if (ws) {
      try { ws.removeAllListeners(); } catch {}
      try { ws.close(); } catch {}
    }
  }
}

// Singleton instance
let cloakmanagerInstance = null;

function getCloakManagerClient() {
  if (!cloakmanagerInstance) {
    cloakmanagerInstance = new CloakManagerClient();
  }
  return cloakmanagerInstance;
}

module.exports = { getCloakManagerClient };