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
      owner: 'Gee2424',
      repo: 'ctrldlogin',
      assetName: 'ctrldlogin-backend-windows.exe',
      // Only re-check GitHub this often (ms)
      checkIntervalMs: 24 * 60 * 60 * 1000, // 24 hours (daily)
    };

    // Health check configuration. `timeout` is how long we wait for the
    // spawned backend PROCESS itself to report healthy — separate from
    // (and before) any profile launch. The backend is a Nuitka-compiled
    // binary (confirmed via ctrldlogin's own IS_COMPILED check); on a
    // freshly-installed machine, first run may need to self-extract and
    // can also get slowed by antivirus scanning a brand-new unsigned exe.
    // 30s was tuned for an already-warm binary; 60s gives real first-run
    // headroom without meaningfully delaying detection of an actually
    // broken launch.
    this.healthConfig = {
      timeout: 60000,
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
   * Get the path to the bundled binary shipped with the installer
   * Only relevant in production (app.isPackaged)
   * @returns {string|null} Path to bundled binary or null
   */
  getBundledBinaryPath() {
    if (!this.app || !this.app.isPackaged) return null;
    return path.join(process.resourcesPath, 'backend.exe');
  }

  /**
   * Read the bundled version manifest shipped with the installer
   * Returns { backendVersion: "v1.2.3" } or null
   * @returns {object|null} Manifest or null
   */
  getBundledManifest() {
    if (!this.app || !this.app.isPackaged) return null;
    try {
      const manifestPath = path.join(process.resourcesPath, 'bundled-version.json');
      if (fs.existsSync(manifestPath)) {
        return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      }
    } catch (e) {
      console.error('[CloakManager] Failed to read bundled manifest:', e.message);
    }
    return null;
  }

  /**
   * Get the path to version information file
   * @returns {string} Path to version.json
   */
  getVersionPath() {
    return path.join(this.getStorageDir(), 'version.json');
  }

  /**
   * Get the path to the persisted port file
   * @returns {string} Path to port.json
   */
  getPortPath() {
    return path.join(this.getStorageDir(), 'port.json');
  }

  /**
   * Get the saved port from a previous session
   * @returns {number|null} Port number or null if not available
   */
  getSavedPort() {
    try {
      const p = this.getPortPath();
      if (fs.existsSync(p)) {
        const data = JSON.parse(fs.readFileSync(p, 'utf8'));
        return typeof data.port === 'number' ? data.port : null;
      }
    } catch {}
    return null;
  }

  /**
   * Persist the current port to disk for reconnection on next launch
   * @param {number} port - The port to save
   */
  savePort(port) {
    // Atomic write — a torn port.json on a crash means the next launch
    // can't find a still-running backend and spawns a duplicate.
    const target = this.getPortPath();
    const tmp = target + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({
      port,
      pid: this.process?.pid || null,
      savedAt: Date.now(),
    }));
    fs.renameSync(tmp, target);
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

    // Store reference for progress tracking
    this.downloadProgress = { downloaded: 0, total: totalSize };

    const writer = fs.createWriteStream(binaryPath + '.tmp');

    response.data.on('data', (chunk) => {
      downloadedSize += chunk.length;
      this.downloadProgress.downloaded = downloadedSize;

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
      if (response.data?.status !== 'healthy') return false;
      // A process can answer /health while its API router isn't mounted yet —
      // confirm the real API is up before trusting this instance.
      try {
        const api = await axios.get(`http://127.0.0.1:${port}/api/running`, {
          timeout: this.healthConfig.requestTimeout,
        });
        return api.status === 200;
      } catch {
        return false;
      }
    } catch (e) {
      return false;
    }
  }

  /**
   * Check if Cloak Manager is already running locally
   * Checks saved port from previous session first, then scans common ports
   * @returns {Promise<number|null>} Port if running, null otherwise
   */
  async checkAlreadyRunning() {
    // Check saved port from previous session first
    const savedPort = this.getSavedPort();
    if (savedPort) {
      if (await this.checkPort(savedPort)) {
        console.log(`[CloakManager] Reconnected to backend on port ${savedPort}`);
        return savedPort;
      }
      // Stale port file — backend died since last session
      try { fs.unlinkSync(this.getPortPath()); } catch {}
    }

    // Check default ports
    const defaultPorts = [7331, 8765];
    for (const port of defaultPorts) {
      if (await this.checkPort(port)) {
        console.log(`[CloakManager] Found existing instance on port ${port}`);
        this.savePort(port);
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
      throw new Error('Cloak Manager binary not found. Run ensureRunning() first.');
    }

    // Find available port
    const port = await this.findAvailablePort();
    const dataDir = this.getDataDir();

    // Ensure data directory exists
    fs.mkdirSync(dataDir, { recursive: true });

    console.log(`[CloakManager] Spawning backend on port ${port}...`);

    // Prepare environment variables. The backend (ctrldlogin) only reads
    // CTRLDLOGIN_* — it has no idea what CLOAKMANAGER_* means, so those
    // names silently no-op and it falls back to its own defaults (port
    // 7331, OS-default %APPDATA%/~/.local/share data dir). That mismatch
    // meant we were health-checking a port nothing was ever listening on.
    // See core/config.py in the ctrldlogin backend — CTRLDLOGIN_DATA_DIR is
    // explicitly documented there as "set by Tauri sidecar", i.e. this is
    // the actual supported integration contract for a parent app spawning
    // this binary, just under the real project's env var prefix.
    const env = {
      ...process.env,
      CTRLDLOGIN_PORT: port.toString(),
      CTRLDLOGIN_HOST: '127.0.0.1',
      CTRLDLOGIN_DATA_DIR: dataDir,
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

    // Keep the last few KB of stderr so an early crash gives a real reason
    // instead of a bare 30s health-check timeout.
    let stderrTail = '';
    const child = this.process;
    let earlyExit = null;

    child.stdout.on('data', (data) => {
      console.log(`[CloakManager Backend] ${data.toString().trim()}`);
    });
    child.stderr.on('data', (data) => {
      const s = data.toString();
      stderrTail = (stderrTail + s).slice(-4000);
      console.error(`[CloakManager Backend Error] ${s.trim()}`);
    });
    child.on('error', (err) => {
      console.error('[CloakManager] Failed to start backend:', err);
      earlyExit = earlyExit || err.message;
      if (this.process === child) this.process = null;
    });
    child.on('exit', (code) => {
      console.log(`[CloakManager] Backend exited with code ${code}`);
      earlyExit = earlyExit || `exited with code ${code}`;
      if (this.process === child) this.process = null;
    });

    // Race the health check against an early process death.
    try {
      await Promise.race([
        this.waitForHealth(port),
        new Promise((_, reject) => {
          const iv = setInterval(() => {
            if (earlyExit) {
              clearInterval(iv);
              const tail = stderrTail.trim().split('\n').slice(-6).join('\n');
              reject(new Error(
                `CloakManager backend ${earlyExit}${tail ? `\n${tail}` : ''}`
              ));
            }
          }, 200);
          setTimeout(() => clearInterval(iv), this.healthConfig.timeout + 1000);
        }),
      ]);
    } catch (err) {
      try { child.kill('SIGKILL'); } catch {}
      if (this.process === child) this.process = null;
      throw err;
    }

    this.currentPort = port;
    this.savePort(port);
    return port;
  }

  /**
   * Stop the spawned Cloak Manager process (including any child processes)
   * Uses taskkill /T /F on Windows for guaranteed tree-kill
   * @returns {Promise<void>}
   */
  async stop() {
    if (!this.process || !this.process.pid) return;

    const pid = this.process.pid;
    console.log('[CloakManager] Stopping backend (pid ' + pid + ')...');

    if (process.platform === 'win32') {
      await new Promise((resolve) => {
        const { execFile } = require('child_process');
        execFile('taskkill', ['/pid', String(pid), '/t', '/f'],
          { windowsHide: true },
          (err) => {
            if (err) {
              const msg = (err.message || '').toLowerCase();
              if (!msg.includes('not found')) {
                console.warn('[CloakManager] taskkill warning:', err.message);
              }
            }
            resolve();
          });
      });
    } else {
      this.process.kill('SIGKILL');
    }

    this.process = null;
    this.currentPort = null;

    try { fs.unlinkSync(this.getPortPath()); } catch {}

    console.log('[CloakManager] Backend stopped');
  }

  /**
   * Main entry point: Ensure Cloak Manager is running
   * In production: seeds from bundled binary if needed (no GitHub calls)
   * In development: requires developer-provided binary
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

    const binaryPath = this.getBinaryPath();
    const userVersion = this.getCurrentVersion();

    // Production: seed from bundled binary if needed
    if (this.app.isPackaged) {
      const bundledPath = this.getBundledBinaryPath();
      const bundledManifest = this.getBundledManifest();

      const needsSeed =
        !fs.existsSync(binaryPath) ||
        (bundledManifest && (!userVersion || userVersion.backendVersion !== bundledManifest.backendVersion));

      if (needsSeed) {
        if (!bundledPath || !fs.existsSync(bundledPath)) {
          throw new Error(
            'CloakManager binary is missing from the application bundle. ' +
            'Please reinstall Oserus Management.'
          );
        }

        const storageDir = this.getStorageDir();
        fs.mkdirSync(storageDir, { recursive: true });
        fs.copyFileSync(bundledPath, binaryPath);

        const versionInfo = {
          backendVersion: bundledManifest?.backendVersion || 'unknown',
          seededAt: Date.now(),
          lastCheck: Date.now(),
          bundled: true,
        };
        fs.writeFileSync(this.getVersionPath(), JSON.stringify(versionInfo, null, 2));

        console.log(`[CloakManager] Seeded bundled binary (v${versionInfo.backendVersion})`);
      }
    } else {
      // Development mode: binary must be provided by developer
      if (!fs.existsSync(binaryPath)) {
        throw new Error(
          'CloakManager binary not found. ' +
          'In development mode, place backend.exe in the cloak-manager directory or run CloakManager separately.'
        );
      }
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
    const manifest = this.getBundledManifest();
    return {
      isRunning: this.process !== null,
      port: this.currentPort,
      version: this.version,
      binaryExists: fs.existsSync(this.getBinaryPath()),
      currentVersion: this.getCurrentVersion(),
      bundledBackendVersion: manifest?.backendVersion || null,
      isBundled: this.app?.isPackaged || false,
    };
  }

  /**
   * Get current download progress if downloading
   * @returns {object|null} Progress info or null if not downloading
   */
  getDownloadProgress() {
    return this.downloadProgress || null;
  }
}

module.exports = CloakManagerBinary;
