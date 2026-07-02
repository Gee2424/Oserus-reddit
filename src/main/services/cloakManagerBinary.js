/**
 * CloakManager Binary Management Service
 *
 * Handles automatic download, storage, and spawning of the Cloak Manager backend
 * in production builds (app.isPackaged). In development, it allows manual configuration.
 */

const { spawn } = require('child_process');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const net = require('net');

class CloakManagerBinary {
  constructor(options = {}) {
    this.app = options.app;
    this.process = null;
    this.currentPort = null;
    this.version = null;

    // GitHub configuration
    this.githubConfig = {
      owner: 'arkdemiatop',
      repo: 'ctrldlogin',
      assetName: 'backend-x86_64-pc-windows-msvc.exe',
      // Only re-check GitHub this often (ms)
      checkIntervalMs: 6 * 60 * 60 * 1000, // 6 hours
    };

    // Health check configuration
    this.healthConfig = {
      timeout: 30000, // How long to wait for backend to report healthy
      retryInterval: 500, // Check every 500ms
      requestTimeout: 2000, // Timeout per health check request
    };
  }

  /**
   * Get the storage directory for Cloak Manager binary and data
   * @returns {string} Path to storage directory
   */
  getStorageDir() {
    if (!this.app) {
      throw new Error('Electron app instance not provided');
    }
    return path.join(this.app.getPath('userData'), 'cloak-manager');
  }

  /**
   * Get the path to the stored binary
   * @returns {string} Path to backend.exe
   */
  getBinaryPath() {
    return path.join(this.getStorageDir(), 'backend.exe');
  }

  /**
   * Get the path to version information file
   * @returns {string} Path to version.json
   */
  getVersionPath() {
    return path.join(this.getStorageDir(), 'version.json');
  }

  /**
   * Get the data directory for backend runtime data
   * @returns {string} Path to backend-data directory
   */
  getDataDir() {
    return path.join(this.getStorageDir(), 'backend-data');
  }

  /**
   * Get the current stored version information
   * @returns {object|null} Version info or null if not available
   */
  getCurrentVersion() {
    try {
      const versionPath = this.getVersionPath();
      if (!fs.existsSync(versionPath)) {
        return null;
      }
      const content = fs.readFileSync(versionPath, 'utf8');
      return JSON.parse(content);
    } catch (e) {
      return null;
    }
  }

  /**
   * Check if we should check for updates (respecting interval)
   * @returns {boolean} True if update check is needed
   */
  shouldCheckForUpdates() {
    const current = this.getCurrentVersion();
    if (!current) {
      return true; // No version info, need to check
    }

    if (!current.lastCheck) {
      return true; // Never checked
    }

    const now = Date.now();
    const elapsed = now - current.lastCheck;
    return elapsed >= this.githubConfig.checkIntervalMs;
  }

  /**
   * Fetch the latest release information from GitHub
   * @returns {object} Release information with asset download URL
   */
  async fetchLatestRelease() {
    try {
      const url = `https://api.github.com/repos/${this.githubConfig.owner}/${this.githubConfig.repo}/releases/latest`;
      const response = await axios.get(url, {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
        },
        timeout: 10000,
      });

      const release = response.data;

      // Find the appropriate asset
      const asset = release.assets.find(
        a => a.name === this.githubConfig.assetName
      );

      if (!asset) {
        throw new Error(`Compatible binary not found in release ${release.tag_name}. ` +
          `Looking for: ${this.githubConfig.assetName}`);
      }

      return {
        version: release.tag_name,
        downloadUrl: asset.browser_download_url,
        size: asset.size,
        publishedAt: release.published_at,
      };
    } catch (e) {
      if (e.response?.status === 404) {
        throw new Error('GitHub repository or releases not found');
      } else if (e.response?.status === 403) {
        throw new Error('GitHub API rate limit exceeded. Please try again later.');
      }
      throw new Error(`Failed to fetch release info: ${e.message}`);
    }
  }

  /**
   * Download the binary from GitHub
   * @param {string} downloadUrl - URL to download from
   * @param {string} version - Version being downloaded
   * @returns {Promise<void>}
   */
  async downloadBinary(downloadUrl, version) {
    const storageDir = this.getStorageDir();
    const binaryPath = this.getBinaryPath();

    // Ensure storage directory exists
    fs.mkdirSync(storageDir, { recursive: true });

    console.log(`[CloakManager] Downloading binary from GitHub (version ${version})...`);

    // Download with streaming
    const response = await axios({
      url: downloadUrl,
      method: 'GET',
      responseType: 'stream',
      timeout: 300000, // 5 minute timeout
    });

    const totalSize = parseInt(response.headers['content-length'], 10);
    let downloadedSize = 0;

    const writer = fs.createWriteStream(binaryPath + '.tmp');

    response.data.on('data', (chunk) => {
      downloadedSize += chunk.length;
      if (totalSize) {
        const percent = ((downloadedSize / totalSize) * 100).toFixed(1);
        console.log(`[CloakManager] Download progress: ${percent}%`);
      }
    });

    // Pipe the download to file
    response.data.pipe(writer);

    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
      response.data.on('error', reject);
    });

    // Rename temp file to final
    fs.renameSync(binaryPath + '.tmp', binaryPath);

    // Save version information
    const versionInfo = {
      version,
      lastCheck: Date.now(),
      downloadedAt: Date.now(),
    };
    fs.writeFileSync(this.getVersionPath(), JSON.stringify(versionInfo, null, 2));

    console.log(`[CloakManager] Binary downloaded successfully (${(downloadedSize / 1024 / 1024).toFixed(2)} MB)`);
  }

  /**
   * Check if an update is available and download if needed
   * @returns {Promise<boolean>} True if update was downloaded
   */
  async checkForUpdates() {
    if (!this.shouldCheckForUpdates()) {
      return false;
    }

    console.log('[CloakManager] Checking for updates...');

    try {
      const latest = await this.fetchLatestRelease();
      const current = this.getCurrentVersion();

      // Check if we need to update
      if (current && current.version === latest.version) {
        console.log('[CloakManager] Already up to date', current.version);
        // Update last check time
        current.lastCheck = Date.now();
        fs.writeFileSync(this.getVersionPath(), JSON.stringify(current, null, 2));
        return false;
      }

      console.log(`[CloakManager] Update available: ${current?.version || 'none'} → ${latest.version}`);
      await this.downloadBinary(latest.downloadUrl, latest.version);
      return true;
    } catch (e) {
      console.error('[CloakManager] Update check failed:', e.message);
      // Don't throw - allow app to continue with existing binary
      return false;
    }
  }

  /**
   * Find an available port on localhost
   * @returns {Promise<number>} Available port number
   */
  async findAvailablePort() {
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        server.close(() => resolve(port));
      });
      server.on('error', reject);
    });
  }

  /**
   * Check if Cloak Manager is already running on a specific port
   * @param {number} port - Port to check
   * @returns {Promise<boolean>} True if Cloak Manager is running on that port
   */
  async checkPort(port) {
    try {
      const response = await axios.get(`http://127.0.0.1:${port}/health`, {
        timeout: this.healthConfig.requestTimeout,
      });
      return response.data?.status === 'healthy';
    } catch (e) {
      return false;
    }
  }

  /**
   * Check if Cloak Manager is already running locally
   * Scans common ports or uses configured port
   * @returns {Promise<number|null>} Port if running, null otherwise
   */
  async checkAlreadyRunning() {
    // Check default port first
    const defaultPorts = [7331, 8765];

    for (const port of defaultPorts) {
      if (await this.checkPort(port)) {
        console.log(`[CloakManager] Found existing instance on port ${port}`);
        return port;
      }
    }

    return null;
  }

  /**
   * Wait for the health endpoint to respond
   * @param {number} port - Port to check
   * @param {number} timeout - Maximum time to wait (ms)
   * @returns {Promise<number>} The port that became healthy
   */
  async waitForHealth(port, timeout = null) {
    const healthTimeout = timeout || this.healthConfig.timeout;
    const startTime = Date.now();
    let lastError = null;

    console.log(`[CloakManager] Waiting for health endpoint on port ${port}...`);

    while (Date.now() - startTime < healthTimeout) {
      try {
        const response = await axios.get(`http://127.0.0.1:${port}/health`, {
          timeout: this.healthConfig.requestTimeout,
        });

        if (response.data?.status === 'healthy') {
          this.version = response.data.version;
          console.log(`[CloakManager] ✓ Health check passed (v${this.version})`);
          return port;
        }
      } catch (err) {
        lastError = err;
        // Backend not ready yet, wait and retry
        await new Promise(resolve => setTimeout(resolve, this.healthConfig.retryInterval));
      }
    }

    throw new Error(`Cloak Manager backend failed health check on port ${port}: ${lastError?.message || 'unknown error'}`);
  }

  /**
   * Spawn the Cloak Manager binary
   * @returns {Promise<number>} The port the binary is running on
   */
  async spawn() {
    const binaryPath = this.getBinaryPath();

    // Verify binary exists
    if (!fs.existsSync(binaryPath)) {
      throw new Error('Cloak Manager binary not found. Run downloadBinary() first.');
    }

    // Find available port
    const port = await this.findAvailablePort();
    const dataDir = this.getDataDir();

    // Ensure data directory exists
    fs.mkdirSync(dataDir, { recursive: true });

    console.log(`[CloakManager] Spawning backend on port ${port}...`);

    // Prepare environment variables
    const env = {
      ...process.env,
      CLOAKMANAGER_PORT: port.toString(),
      CLOAKMANAGER_HOST: '127.0.0.1',
      CLOAKMANAGER_DATA_DIR: dataDir,
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1',
    };

    // Spawn the process
    this.process = spawn(binaryPath, [], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
      windowsHide: true,
    });

    // Log output for debugging
    this.process.stdout.on('data', (data) => {
      console.log(`[CloakManager Backend] ${data.toString().trim()}`);
    });

    this.process.stderr.on('data', (data) => {
      console.error(`[CloakManager Backend Error] ${data.toString().trim()}`);
    });

    // Handle process events
    this.process.on('error', (err) => {
      console.error('[CloakManager] Failed to start backend:', err);
      this.process = null;
    });

    this.process.on('exit', (code) => {
      console.log(`[CloakManager] Backend exited with code ${code}`);
      this.process = null;
    });

    // Wait for backend to be healthy
    await this.waitForHealth(port);

    this.currentPort = port;
    return port;
  }

  /**
   * Stop the spawned Cloak Manager process
   * @returns {Promise<void>}
   */
  async stop() {
    if (this.process) {
      console.log('[CloakManager] Stopping spawned backend...');

      // Try graceful shutdown first
      this.process.kill('SIGTERM');

      // Wait for process to exit
      await new Promise((resolve) => {
        const timeout = setTimeout(() => {
          // Force kill if doesn't exit gracefully
          if (this.process) {
            this.process.kill('SIGKILL');
          }
          resolve();
        }, 5000);

        this.process.once('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
      });

      this.process = null;
      this.currentPort = null;
      console.log('[CloakManager] Backend stopped');
    }
  }

  /**
   * Main entry point: Ensure Cloak Manager is running
   * - Checks if already running
   * - Downloads if needed
   * - Spawns if not running
   * @returns {Promise<number>} The port Cloak Manager is running on
   */
  async ensureRunning() {
    // First, check if Cloak Manager is already running
    const existingPort = await this.checkAlreadyRunning();
    if (existingPort) {
      console.log(`[CloakManager] Using existing instance on port ${existingPort}`);
      this.currentPort = existingPort;
      return existingPort;
    }

    // Check if binary exists, download if needed
    const binaryPath = this.getBinaryPath();
    if (!fs.existsSync(binaryPath)) {
      console.log('[CloakManager] Binary not found, downloading...');
      const latest = await this.fetchLatestRelease();
      await this.downloadBinary(latest.downloadUrl, latest.version);
    } else {
      // Check for updates (respects check interval)
      await this.checkForUpdates();
    }

    // Spawn the binary
    const port = await this.spawn();
    console.log(`[CloakManager] Backend ready on port ${port}`);
    return port;
  }

  /**
   * Get the current status of the Cloak Manager binary
   * @returns {object} Status information
   */
  getStatus() {
    return {
      isRunning: this.process !== null,
      port: this.currentPort,
      version: this.version,
      binaryExists: fs.existsSync(this.getBinaryPath()),
      currentVersion: this.getCurrentVersion(),
    };
  }
}

module.exports = CloakManagerBinary;
