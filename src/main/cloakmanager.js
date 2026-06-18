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

    // WebSocket setup
    this.ws = null;
    this.wsConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
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

    // Reconnect WebSocket with new URL
    if (this.wsConnected) {
      console.log('[CloakManager] Reconnecting WebSocket with new URL...');
      this.disconnectWebSocket();
      setTimeout(() => this.connectWebSocket(), 1000);
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

      this.available = response.status === 200;
      this._lastCheck = Date.now();
      console.log('[CloakManager] ✅ Available:', this.available);
      return this.available;
    } catch (error) {
      console.log('[CloakManager] ❌ Unavailable:', error.message);
      this.available = false;
      this._lastCheck = Date.now();
      return false;
    }
  }

  /**
   * Create a CloakManager profile for a Reddit account (MINIMAL VERSION)
   * Backend auto-generates everything from profile name
   * @param {string} accountUsername - Reddit account username
   * @param {Object} accountConfig - Optional config (mostly ignored, backend auto-generates)
   * @param {Object} proxyConfig - Optional proxy configuration
   * @returns {Promise<Object>} Profile creation result
   */
  async createProfile(accountUsername, accountConfig = {}, proxyConfig = null) {
    console.log('[CloakManager] createProfile called with:', accountUsername, accountConfig, proxyConfig);

    if (!await this.isAvailable()) {
      console.error('[CloakManager] ❌ Not available');
      throw new Error('CloakManager is not available');
    }

    const profileName = `reddit-${accountUsername}`;
    console.log('[CloakManager] Profile name:', profileName);

    try {
      // MINIMAL PROFILE CREATION - backend auto-generates everything
      // IMPORTANT: browser_brand must be "Chrome" (capitalized) - this is REQUIRED
      // NOTE: headless=false so CDP can display the browser window
      const payload = {
        name: profileName,
        headless: false,  // Changed to false - CDP cannot project from headless
        browser_brand: "Chrome"  // REQUIRED, must be capitalized
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
      const response = await axios.post(
        `${this.baseUrl}/api/profiles/${profileName}/launch`,
        {}  // Empty body - launch doesn't need parameters
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
   * Connect to CloakManager WebSocket for real-time events
   */
  connectWebSocket() {
    if (this.wsConnected) return;

    // Extract host and port from baseUrl for WebSocket connection
    // baseUrl is like "http://127.0.0.1:41091" -> wsUrl should be "ws://127.0.0.1:41091/ws/..."
    const wsUrl = this.baseUrl.replace('http://', 'ws://').replace('https://', 'wss://') + `/ws/${this.clientId}`;
    console.log('[CloakManager WS] Connecting to:', wsUrl);

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.on('open', () => {
        console.log('[CloakManager WS] ✅ Connected');
        this.wsConnected = true;
        this.reconnectAttempts = 0;
        this._emit('connected');
      });

      this.ws.on('message', (data) => {
        try {
          const event = JSON.parse(data);
          console.log('[CloakManager WS] Event:', event.type, event.profile || event.extension);
          this._handleWebSocketEvent(event);
        } catch (error) {
          console.error('[CloakManager WS] Failed to parse message:', error);
        }
      });

      this.ws.on('close', () => {
        console.log('[CloakManager WS] Disconnected, reconnecting...');
        this.wsConnected = false;
        this._emit('disconnected');
        this._scheduleReconnect();
      });

      this.ws.on('error', (error) => {
        console.error('[CloakManager WS] Error:', error);
      });
    } catch (error) {
      console.error('[CloakManager WS] Failed to create WebSocket:', error);
      this._emit('fallback_to_polling');
    }
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
   * Schedule WebSocket reconnection with exponential backoff
   */
  _scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('[CloakManager WS] Max reconnect attempts reached, falling back to HTTP polling');
      this._emit('fallback_to_polling');
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 16000);
    this.reconnectAttempts++;

    console.log(`[CloakManager WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    setTimeout(() => {
      this.connectWebSocket();
    }, delay);
  }

  /**
   * Disconnect WebSocket and cleanup
   */
  disconnectWebSocket() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.wsConnected = false;
    }
    this.reconnectAttempts = 0;
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