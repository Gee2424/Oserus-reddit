# Oserus + CloakManager Integration Guide

> **Target Audience:** Oserus Management developers  
> **Purpose:** Complete guide for integrating CloakManager's fingerprinting backend  
> **Scope:** Profile management, CDP integration, extensions, and proxies  
> **Integration Level:** Option B (CDP Embedding) - Zero UI change, maximum security  
> **Prerequisites:** CloakManager v11.0+ running on localhost:7331

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Architecture Overview](#architecture-overview)
3. [API Authentication](#api-authentication)
4. [Profile Management](#profile-management)
5. [CDP Integration](#cdp-integration)
6. [Extension Management](#extension-management)
7. [Proxy Management](#proxy-management)
8. [Error Handling](#error-handling)
9. [Deployment](#deployment)
10. [Testing Guide](#testing-guide)

---

## Quick Start

### What You'll Get

✅ **Unique browser fingerprints per Reddit account**  
✅ **Platform spoofing (Windows/macOS/Linux)**  
✅ **Canvas/WebGL/Audio randomization**  
✅ **WebRTC leak prevention**  
✅ **Professional-grade anti-detection**  
✅ **Zero UI changes** - users see the same interface

### 5-Minute Integration Test

```javascript
// 1. Test CloakManager connectivity
const response = await fetch('http://127.0.0.1:7331/api/running');
console.log('CloakManager available:', response.ok);

// 2. Create a profile for Reddit account
const createResponse = await fetch('http://127.0.0.1:7331/api/profiles', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'reddit-LunaMain',
    os: 'windows',
    timezone: 'America/New_York',
    locale: 'en-US',
    resolution: '1920x1080',
    headless: true
  })
});
console.log('Profile created:', await createResponse.json());

// 3. Launch the profile
const launchResponse = await fetch('http://127.0.0.1:7331/api/profiles/reddit-LunaMain/launch', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ headless: true })
});
const launchData = await launchResponse.json();
console.log('Profile launched:', launchData);

// 4. Get CDP connection info
const cdpResponse = await fetch('http://127.0.0.1:7331/api/profiles/reddit-LunaMain/cdp');
const cdpData = await cdpResponse.json();
console.log('CDP connection info:', cdpData);

// 5. Stop the profile
await fetch('http://127.0.0.1:7331/api/profiles/reddit-LunaMain/stop', {
  method: 'POST'
});
```

**Expected Output:**
```json
{
  "cdp_port": 44861,
  "cdp_http_url": "http://127.0.0.1:44861",
  "cdp_ws_url": "ws://127.0.0.1:44861/devtools/browser/abc123..."
}
```

---

## Architecture Overview

### System Architecture

```
┌─────────────────────────────────────────────────────────┐
│ Oserus Management (Electron + React)                      │
│ • Account management (users, roles, permissions)          │
│ • Reddit/RedGifs accounts CRUD                            │
│ • AI composer, scheduler, analytics                        │
│ • Business logic and UI                                     │
│ • CDP client components (NEW)                             │
└─────────────────────────────────────────────────────────┘
                    │ HTTP API calls (localhost:7331)
                    ▼
┌─────────────────────────────────────────────────────────┐
│ CloakManager Backend (Compiled Binary)                   │
│ • Profile management + fingerprint generation             │
│ • CloakBrowser headless context spawning                  │
│ • CDP endpoint allocation + management                     │
│ • Proxy management + testing                                │
│ • WebSocket real-time updates                               │
└─────────────────────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────┐
│ CloakBrowser HEADLESS (One per Reddit account)           │
│ • Unique fingerprints per profile                           │
│ • Platform spoofing + canvas/WebGL randomization            │
│ • CDP server: ws://127.0.0.1:{port} (per-profile)          │
│ • No visible windows (headless mode)                        │
└─────────────────────────────────────────────────────────┘
```

### Key Benefits

| **Feature** | **Current** | **With CloakManager** |
|------------|-----------|-------------------|
| **Fingerprints** | All identical | Unique per account |
| **Platform** | No spoofing | Windows/macOS/Linux |
| **Canvas/WebGL** | Identical | Randomized per account |
| **WebRTC** | Leaks real IP | Protected via proxy IP |
| **Detection Risk** | HIGH | LOW |
| **UI Changes** | N/A | NONE (CDP embedding) |

---

## API Authentication

### Default Configuration (No Authentication)

**CloakManager ships with authentication OFF by default.**

```javascript
// No authentication required
const CLOAKMANAGER_API = 'http://127.0.0.1:7331';

async function apiCall(endpoint, options = {}) {
  const response = await fetch(`${CLOAKMANAGER_API}/${endpoint}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    },
    ...options
  });
  return response.json();
}
```

### Optional Authentication (If Enabled)

**If CloakManager has authentication enabled:**

```javascript
// Set environment variable or add token to requests
const TOKEN = process.env.CLOAKMANAGER_TOKEN || 'your-token-here';

async function apiCall(endpoint, options = {}) {
  const response = await fetch(`http://127.0.0.1:7331/${endpoint}`, {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${TOKEN}`,
      ...options.headers
    },
    ...options
  });
  return response.json();
}
```

**Note:** Check CloakManager configuration for authentication status.

---

## Profile Management

### Understanding CloakManager Profiles

**CloakManager profiles = Reddit account fingerprints**

Each CloakManager profile represents:
- **Browser fingerprint** (UA, canvas, WebGL, audio, platform)
- **Geolocation** (timezone, locale, coordinates)
- **Proxy configuration** ( SOCKS5/HTTP proxy with WebRTC spoofing)
- **Browser settings** (resolution, language, theme)

**Profile Lifecycle:**
```
CREATE → LAUNCH → RUNNING → STOP → DELETE
```

### Profile Creation

#### Basic Profile Creation

```javascript
// Create profile for Reddit account with Windows fingerprint
async function createProfileForAccount(account) {
  const profileName = `${account.platform}-${account.username}`;
  
  const response = await apiCall('profiles', {
    method: 'POST',
    body: JSON.stringify({
      name: profileName,
      os: 'windows',           // Platform: windows, macos, linux
      timezone: 'America/New_York',
      locale: 'en-US',
      resolution: '1920x1080',
      color_scheme: 'light',   // Browser theme: light, dark, no-preference
      humanize: false,         // Human-like mouse movements
      headless: true,          // HEADLESS MODE REQUIRED FOR CDP
      hardware_concurrency: 8,
      device_memory: 8,
      webrtc_mode: 'proxy_ip', // Use proxy's external IP for WebRTC
      image_threshold_kb: 10,
      warmup_enabled: false,
      warmup_sites: ['https://www.google.com']
    })
  });
  
  return response.ok ? profileName : null;
}
```

#### Profile with Proxy Configuration

```javascript
// Create profile with proxy (recommended for Reddit accounts)
async function createProfileWithProxy(account, proxyConfig) {
  const profileName = `${account.platform}-${account.username}`;
  
  // First create proxy if it doesn't exist
  const proxyResponse = await apiCall('proxies', {
    method: 'POST',
    body: JSON.stringify({
      label: `${account.username} proxy`,
      protocol: proxyConfig.protocol || 'socks5',
      host: proxyConfig.host,
      port: proxyConfig.port,
      username: proxyConfig.username || '',
      password: proxyConfig.password || '',
      country: proxyConfig.country || 'US',
      bypass: 'localhost,127.0.0.1'
    })
  });
  
  const proxyId = (await proxyResponse.json()).id;
  
  // Then create profile with proxy
  const profileResponse = await apiCall('profiles', {
    method: 'POST',
    body: JSON.stringify({
      name: profileName,
      os: 'windows',
      timezone: 'America/New_York',
      proxy_id: proxyId,  // Link proxy to profile
      headless: true,
      auto_geoip: true,     // Auto-match timezone to proxy IP
      webrtc_mode: 'proxy_ip'  // Use proxy IP for WebRTC
    })
  });
  
  return profileResponse.ok;
}
```

### Profile Launch

#### Launch Profile for Account

```javascript
async function launchProfileForAccount(account) {
  const profileName = `${account.platform}-${account.username}`;
  
  const response = await apiCall(`profiles/${profileName}/launch`, {
    method: 'POST',
    body: JSON.stringify({
      headless: true  // REQUIRED for CDP embedding
    })
  });
  
  const data = await response.json();
  
  if (data.ok) {
    console.log(`✅ Profile launched: ${profileName}`);
    console.log(`   PID: ${data.pid}`);
    console.log(`   CDP Port: ${data.cdp_port}`);
    console.log(`   CDP URL: ${data.cdp_url}`);
    console.log(`   Fingerprint Seed: ${data.fp_seed}`);
    
    return {
      profileName,
      pid: data.pid,
      cdpPort: data.cdp_port,
      cdpUrl: data.cdp_url,
      fingerprintSeed: data.fp_seed
    };
  } else {
    throw new Error(data.error || 'Failed to launch profile');
  }
}
```

**Launch Response:**
```json
{
  "ok": true,
  "pid": 10001,
  "proxy_verified": true,
  "proxy_ip": "203.0.113.42",
  "fp_seed": 42817,
  "cdp_port": 44861,
  "cdp_url": "http://127.0.0.1:44861"
}
```

#### Launch with Explicit Proxy

```javascript
// Launch profile and test proxy connectivity first
async function launchWithProxyCheck(account) {
  const profileName = `${account.platform}-${account.username}`;
  
  // Get proxy details
  const proxyData = await getProxyForAccount(account);
  
  // Test proxy before launching
  const testResponse = await apiCall(`proxies/${proxyData.id}/test`, {
    method: 'POST'
  });
  
  const testResult = await testResponse.json();
  
  if (!testResult.ok) {
    throw new Error(`Proxy test failed: ${testResult.error}`);
  }
  
  console.log(`✅ Proxy verified: ${testResult.external_ip} (${testResult.latency_ms}ms)`);
  
  // Launch profile
  return await launchProfileForAccount(account);
}
```

### Profile Status

#### Check Running Status

```javascript
// Get all running profiles
async function getRunningProfiles() {
  const response = await apiCall('running', { method: 'GET' });
  const data = await response.json();
  
  // Returns object with CDP info per profile
  Object.entries(data).forEach(([profileName, info]) => {
    console.log(`${profileName}:`);
    console.log(`  PID: ${info.pid}`);
    console.log(`  CDP Port: ${info.cdp_port}`);
    console.log(`  CDP URL: ${info.cdp_url}`);
    console.log(`  WebSocket: ${info.cdp_ws_url}`);
  });
  
  return data;
}

// Check if specific profile is running
async function isProfileRunning(profileName) {
  const response = await apiCall(`profiles/${profileName}`, {
    method: 'GET'
  });
  const profile = await response.json();
  
  return profile.status === 'running';
}
```

**Running Profiles Response:**
```json
{
  "reddit-LunaMain": {
    "pid": 10001,
    "cdp_port": 44861,
    "cdp_url": "http://127.0.0.1:44861",
    "cdp_ws_url": "ws://127.0.0.1:44861/devtools/browser/abc123...",
    "started_at": "2026-06-14T06:45:48.777770",
    "session_mode": "persistent"
  },
  "reddit-MiaBackup": {
    "pid": 10002,
    "cdp_port": 59223,
    "cdp_url": "http://127.0.0.1:59223",
    "cdp_ws_url": "ws://127.0.0.1:59223/devtools/browser/def456...",
    "started_at": "2026-06-14T06:46:12.123456",
    "session_mode": "persistent"
  }
}
```

#### Stop Profile

```javascript
async function stopProfile(account) {
  const profileName = `${account.platform}-${account.username}`;
  
  const response = await apiCall(`profiles/${profileName}/stop`, {
    method: 'POST'
  });
  
  const data = await response.json();
  
  if (data.ok) {
    console.log(`✅ Profile stopped: ${profileName}`);
  } else {
    throw new Error(data.error || 'Failed to stop profile');
  }
}
```

### Profile Auto-Creation Helper

**Utility function to create profiles on-demand:**

```javascript
// Auto-create profile when account is selected
async function ensureProfileExists(account) {
  const profileName = `${account.platform}-${account.username}`;
  
  // Check if profile exists
  try {
    const response = await apiCall(`profiles/${profileName}`, {
      method: 'GET'
    });
    const profile = await response.json();
    
    // Profile exists, verify it's properly configured
    if (profile.headless !== true) {
      // Update to headless mode
      await updateProfile(profileName, { headless: true });
    }
    return profileName;
  } catch (error) {
    // Profile doesn't exist, create it
    console.log(`Creating new profile for ${profileName}`);
    
    if (account.proxy) {
      return await createProfileWithProxy(account, account.proxy);
    } else {
      return await createProfileForAccount(account);
    }
  }
}

// Update existing profile configuration
async function updateProfile(profileName, updates) {
  const response = await apiCall(`profiles/${profileName}`, {
    method: 'PUT',
    body: JSON.stringify(updates)
  });
  
  return response.ok;
}
```

---

## CDP Integration

### Understanding CDP (Chrome DevTools Protocol)

**CDP allows you to:**
- Connect to running browser remotely
- Control browser (navigate, click, type, scroll)
- Inspect state (DOM, network, console)
- Automate interactions
- **Embed browser content in your UI**

**For Oserus:** CDP enables embedding Reddit content with unique fingerprints while maintaining your exact UI.

### CDP Connection Flow

```
┌─────────────────────┐
│ Oserus Electron UI     │
│ - Reddit browser view  │
│ - Address bar          │
│ - Navigation controls │
└───────────┬───────────┘
            │
            │ CDP WebSocket connection
            ▼
┌─────────────────────┐
│ CloakBrowser         │
│ - Headless browser  │
│ - Unique fingerprint│
│ - Reddit content    │
└─────────────────────┘
```

### Get CDP Connection Info

#### Fetch CDP Endpoint

```javascript
async function getCDPConnectionInfo(account) {
  const profileName = `${account.platform}-${account.username}`;
  
  // Check if profile is running first
  const profileResponse = await apiCall(`profiles/${profileName}`, {
    method: 'GET'
  });
  const profile = await profileResponse.json();
  
  if (profile.status !== 'running') {
    throw new Error('Profile is not running. Launch it first.');
  }
  
  // Get CDP connection details
  const cdpResponse = await apiCall(`profiles/${profileName}/cdp`, {
    method: 'GET'
  });
  
  return await cdpResponse.json();
}
```

**CDP Info Response:**
```json
{
  "profile": "reddit-LunaMain",
  "pid": 10001,
  "cdp_port": 44861,
  "cdp_http_url": "http://127.0.0.1:44861",
  "cdp_ws_url": "ws://127.0.0.1:44861/devtools/browser/abc123-def456-ghi789",
  "connect_over_cdp": "http://127.0.0.1:44861",
  "json_version": "http://127.0.0.1:44861/json/version",
  "json_list": "http://127.0.0.1:44861/json/list"
}
```

#### Fields Explained

| **Field** | **Description** | **Usage Example** |
|---------|---------------|----------------|
| `cdp_port` | CDP port number | Port number for CDP connection |
| `cdp_http_url` | HTTP endpoint | Base URL for CDP HTTP API |
| `cdp_ws_url` | WebSocket URL | Full WebSocket URL for browser connection |
| `connect_over_cdp` | Playwright connect URL | Pass directly to `playwright.chromium.connect_over_cdp()` |
| `json_version` | Browser version endpoint | Get browser info and version |
| `json_list` | Page list endpoint | List all open pages/tabs |

### CDP Client Implementation

#### Option 1: chrome-remote-interface (Recommended)

**Install:**
```bash
npm install chrome-remote-interface
```

**Implementation:**
```javascript
const CDP = require('chrome-remote-interface');

class CloakBrowserCDP {
  constructor(cdpUrl) {
    this.cdpUrl = cdpUrl;
    this.client = null;
    this.target = null;
  }
  
  async connect() {
    try {
      this.client = await CDP({ target: this.cdpUrl });
      this.target = this.client;
      
      // Enable required domains
      const { Page, Runtime, Network, Input } = this.client;
      
      await Page.enable();
      await Runtime.enable();
      await Network.enable();
      
      console.log('✅ CDP Connected');
      return true;
    } catch (error) {
      console.error('❌ CDP Connection failed:', error);
      throw error;
    }
  }
  
  async navigate(url) {
    if (!this.client) await this.connect();
    const { Page } = this.client;
    
    await Page.navigate({ url });
    await Page.loadEventFired();
    
    console.log(`✅ Navigated to: ${url}`);
  }
  
  async click(selector) {
    if (!this.client) await this.connect();
    const { Input } = this.client;
    
    // Click using CDP
    await Input.click({ selector });
  }
  
  async evaluate(script) {
    if (!this.client) await this.connect();
    const { Runtime } = this.client;
    
    const result = await Runtime.evaluate({
      expression: script
    });
    
    return result.result.value;
  }
  
  async getContent() {
    if (!this.client) await this.connect();
    const { Runtime } = this.client;
    
    const result = await Runtime.evaluate({
      expression: 'document.documentElement.outerHTML'
    });
    
    return result.result.value;
  }
  
  async disconnect() {
    if (this.client) {
      await this.client.close();
      this.client = null;
      console.log('✅ CDP Disconnected');
    }
  }
}

// Usage in React component
const cdp = new CloakBrowserCDP(cdpData.cdp_ws_url);

// Connect when component mounts
useEffect(() => {
  cdp.connect().catch(error => {
    console.error('CDP connection failed:', error);
  });
  
  return () => {
    cdp.disconnect();
  };
}, [cdpData.cdp_ws_url]);
```

#### Option 2: Puppeteer-Core

**Install:**
```bash
npm install puppeteer-core
```

**Implementation:**
```javascript
const puppeteer = require('puppeteer-core');

class PuppeteerCDP {
  constructor(cdpUrl) {
    this.cdpUrl = cdpUrl;
    this.browser = null;
    this.page = null;
  }
  
  async connect() {
    this.browser = await puppeteer.connect({
      browserWSEndpoint: this.cdpUrl
    });
    
    // Get the persistent context (should be only one)
    const contexts = this.browser.contexts();
    this.context = contexts[0];
    
    // Get or create a page
    const pages = await this.context.pages();
    if (pages.length > 0) {
      this.page = pages[0];
    } else {
      this.page = await this.context.newPage();
    }
    
    console.log('✅ Puppeteer CDP Connected');
  }
  
  async navigate(url) {
    if (!this.page) await this.connect();
    await this.page.goto(url);
  }
  
  async getContent() {
    if (!this.page) await this.connect();
    return await this.page.content();
  }
  
  async disconnect() {
    if (this.page) {
      await this.page.close();
      this.page = null;
    }
    if (this.browser) {
      await this.browser.disconnect();
      this.browser = null;
    }
    console.log('✅ Puppeteer CDP Disconnected');
  }
}
```

### CDP Embedding in React

#### Basic CDP Browser Component

```javascript
// src/renderer/components/CloakBrowserView.jsx
import React, { useEffect, useRef, useState } from 'react';

export default function CloakBrowserView({ account, onUrlChange }) {
  const cdpRef = useRef(null);
  const [state, setState] = useState({
    loading: true,
    connected: false,
    error: null,
    currentUrl: null
  });

  useEffect(() => {
    let mounted = true;
    let cdpClient = null;

    async function initialize() {
      try {
        setState({ loading: true, error: null });

        // 1. Get account's profile (auto-creates if needed)
        const profileName = await ensureProfileExists(account);
        
        // 2. Launch profile (if not already running)
        const launchResult = await launchProfileForAccount(account);
        
        // 3. Get CDP connection info
        const cdpInfo = await getCDPConnectionInfo(account);
        
        // 4. Connect to CDP
        cdpClient = new CloakBrowserCDP(cdpInfo.cdp_ws_url);
        await cdpClient.connect();
        
        // 5. Navigate to initial URL
        await cdpClient.navigate('https://www.reddit.com');
        
        if (mounted) {
          setState({ 
            loading: false, 
            connected: true, 
            currentUrl: 'https://www.reddit.com' 
          });
          
          // Notify parent of URL change
          if (onUrlChange) {
            onUrlChange('https://www.reddit.com');
          }
        }
        
      } catch (error) {
        if (mounted) {
          setState({ 
            loading: false, 
            connected: false, 
            error: error.message 
          });
        }
      }
    }

    initialize();

    // Cleanup
    return () => {
      mounted = false;
      if (cdpClient) {
        cdpClient.disconnect();
      }
    };
  }, [account]);

  // Loading state
  if (state.loading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        flexDirection: 'column',
        gap: 16
      }}>
        <div className="spinner large" />
        <div>Initializing secure browser for {account?.username}...</div>
        <div className="text-dim">
          Setting up unique fingerprint and connecting via CDP...
        </div>
      </div>
    );
  }

  // Error state
  if (state.error) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        flexDirection: 'column',
        gap: 16
      }}>
        <div style={{ fontSize: 32 }}>⚠️</div>
        <div style={{ fontWeight: 500 }}>Browser Unavailable</div>
        <div className="text-dim">{state.error}</div>
        <button onClick={() => window.location.reload()}>
          Try Again
        </button>
      </div>
    );
  }

  // Connected state (basic - shows HTML content)
  if (state.connected && state.currentUrl) {
    return (
      <div 
        ref={cdpRef}
        style={{
          width: '100%',
          height: '100%',
          background: 'white',
          border: '1px solid #ddd',
          overflow: 'auto'
        }}
      >
        <div style={{
          padding: 16,
          borderBottom: '1px solid #eee',
          background: '#f8f9fa',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <span style={{ fontSize: 12, color: '#666' }}>
            Connected via CloakBrowser CDP
          </span>
          <button onClick={() => cdpClient.navigate('https://www.reddit.com')}>
            🏠 Reddit Home
          </button>
        </div>
        <div 
          dangerouslySetInnerHTML={{ __html: state.currentUrl }}
          style={{ padding: 16 }}
        />
      </div>
    );
  }

  return null;
}
```

#### Advanced CDP Component with Interaction

```javascript
// Enhanced CDP component with user interaction support
export default function InteractiveCloakBrowserView({ account, onUrlChange }) {
  const cdpRef = useRef(null);
  const [state, setState] = useState({
    loading: true,
    connected: false,
    error: null,
    currentUrl: null,
    canGoBack: false,
    canGoForward: false
  });

  useEffect(() => {
    let mounted = true;
    let cdpClient = null;

    async function initialize() {
      try {
        setState({ loading: true, error: null });

        // 1. Get profile and launch
        const profileName = `${account.platform}-${account.username}`;
        await ensureProfileExists(account);
        const launchResult = await launchProfileForAccount(account);
        
        // 2. Get CDP info and connect
        const cdpInfo = await getCDPConnectionInfo(account);
        cdpClient = new CloakBrowserCDP(cdpInfo.cdp_ws_url);
        await cdpClient.connect();
        
        // 3. Navigate to Reddit
        await cdpClient.navigate('https://www.reddit.com');
        
        // 4. Set up event listeners
        cdpClient.client.on('Page.frameNavigated', ({ frame }) => {
          if (mounted) {
            setState({ 
              currentUrl: frame.url,
              canGoBack: frame.canGoBack,
              canGoForward: false
            });
            
            if (onUrlChange) {
              onUrlChange(frame.url);
            }
          }
        });

        if (mounted) {
          setState({ loading: false, connected: true });
        }
        
      } catch (error) {
        if (mounted) {
          setState({ loading: false, connected: false, error: error.message });
        }
      }
    }

    initialize();

    return () => {
      mounted = false;
      if (cdpClient) {
        cdpClient.disconnect();
      }
    };
  }, [account]);

  // Navigation handlers
  const handleNavigate = async (url) => {
    if (!cdpRef.current) return;
    
    try {
      await cdpRef.current.navigate(url);
    } catch (error) {
      console.error('Navigation failed:', error);
    }
  };

  const handleRefresh = () => {
    if (state.currentUrl) {
      handleNavigate(state.currentUrl);
    }
  };

  const handleBack = async () => {
    if (!cdpRef.current) return;
    
    try {
      // CDP doesn't have direct back, so reload current
      await cdpRef.current.navigate(state.currentUrl);
    } catch (error) {
      console.error('Back failed:', error);
    }
  };

  if (state.loading) {
    return <LoadingView message="Launching secure browser..." />;
  }

  if (state.error) {
    return (
      <ErrorView 
        error={state.error}
        onRetry={() => window.location.reload()}
      />
    );
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* CDP Control Bar */}
      <div style={{
        padding: 8,
        borderBottom: '1px solid #ddd',
        background: '#f8f9fa',
        display: 'flex',
        alignItems: 'center',
        gap: 8
      }}>
        <button
          onClick={handleBack}
          disabled={!state.canGoBack}
          style={{ opacity: state.canGoBack ? 1 : 0.5 }}
        >
          ←
        </button>
        
        <input
          type="text"
          value={state.currentUrl || ''}
          onChange={(e) => setState({ currentUrl: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              handleNavigate(state.currentUrl);
            }
          }}
          style={{
            flex: 1,
            padding: '4px 8px',
            fontSize: 12
          }}
        />
        
        <button onClick={handleRefresh}>↻</button>
        
        <button onClick={() => handleNavigate('https://www.reddit.com')}>
          🏠
        </button>
      </div>

      {/* CDP Content Area */}
      <div
        ref={cdpRef}
        style={{
          flex: 1,
          background: 'white',
          overflow: 'auto'
        }}
      />
    </div>
  );
}
```

### CDP Connection Management

#### Connection Pool Manager

```javascript
// Manage multiple CDP connections efficiently
class CDPConnectionPool {
  constructor() {
    this.connections = new Map(); // accountId -> CDP client
    this.maxConnections = 10;
  }

  async acquire(profileName, cdpUrl) {
    // Return existing connection if available
    if (this.connections.has(profileName)) {
      return this.connections.get(profileName);
    }
    
    // Close least recently used if at max capacity
    if (this.connections.size >= this.maxConnections) {
      const [lruProfile] = this.connections.keys().next().value;
      await this.release(lruProfile);
    }
    
    // Create new connection
    const client = new CloakBrowserCDP(cdpUrl);
    await client.connect();
    
    this.connections.set(profileName, client);
    return client;
  }

  async release(profileName) {
    const client = this.connections.get(profileName);
    if (client) {
      await client.disconnect();
      this.connections.delete(profileName);
    }
  }

  async releaseAll() {
    for (const [profileName, client] of this.connections) {
      await client.disconnect();
    }
    this.connections.clear();
  }
}

// Global pool instance
const cdpPool = new CDPConnectionPool();

// Usage in component
useEffect(() => {
  const profileName = `${account.platform}-${account.username}`;
  
  async function initCDP() {
    // Get CDP info
    const cdpInfo = await getCDPConnectionInfo(account);
    
    // Acquire from pool
    const client = await cdpPool.acquire(profileName, cdpInfo.cdp_ws_url);
    
    // Use client for interactions
    await client.navigate('https://www.reddit.com');
    
    return () => {
      // Release back to pool on cleanup
      cdpPool.release(profileName);
    };
  }

  initCDP();

  return () => {
    cdpPool.release(profileName);
  };
}, [account]);
```

#### Connection Error Handling

```javascript
class ResilientCDPClient {
  constructor(cdpUrl, maxRetries = 3) {
    this.cdpUrl = cdpUrl;
    this.maxRetries = maxRetries;
    this.client = null;
    this.reconnectAttempts = 0;
  }

  async connect() {
    while (this.reconnectAttempts < this.maxRetries) {
      try {
        this.client = await CDP({ target: this.cdpUrl });
        this.reconnectAttempts = 0;
        return this.client;
      } catch (error) {
        this.reconnectAttempts++;
        console.log(`Connection attempt ${this.reconnectAttempts} failed, retrying...`);
        await this.delay(1000 * this.reconnectAttempts);
      }
    }
    throw new Error('Failed to connect after maximum retries');
  }

  async execute(command, ...args) {
    if (!this.client) {
      await this.connect();
    }

    try {
      return await this.client.send(command, ...args);
    } catch (error) {
      if (error.message.includes('disconnected')) {
        console.log('Connection lost, reconnecting...');
        await this.connect();
        return await this.client.send(command, ...args);
      }
      throw error;
    }
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

### WebSocket Events Integration

#### CloakManager WebSocket Events

```javascript
// src/main/ipc/cloakmanager-events.js (NEW)
class CloakManagerWebSocket {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.eventHandlers = {};
  }

  connect() {
    this.ws = new WebSocket(this.wsUrl);

    this.ws.onopen = () => {
      console.log('✅ CloakManager WebSocket connected');
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.handleEvent(data);
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    };

    this.ws.onclose = () => {
      console.log('CloakManager WebSocket disconnected, reconnecting...');
      // Auto-reconnect after delay
      setTimeout(() => this.connect(), 3000);
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  }

  on(event, handler) {
    if (!this.eventHandlers[event]) {
      this.eventHandlers[event] = [];
    }
    this.eventHandlers[event].push(handler);
  }

  handleEvent(data) {
    const handlers = this.eventHandlers[data.type] || [];
    
    handlers.forEach(handler => {
      handler(data);
    });
  }
}

// Usage in main process
const cloakWS = new CloakManagerWebSocket('ws://127.0.0.1:7331/ws/osertus-client');

// Handle profile launched event
cloakWS.on('profile_launched', (data) => {
  console.log(`Profile ${data.profile} launched (PID: ${data.data.pid})`);
  
  // Notify renderer
  mainWindow.webContents.send('cloakmanager:profile-launched', data);
});

// Handle profile stopped event
cloakWS.on('profile_stopped', (data) => {
  console.log(`Profile ${data.profile} stopped`);
  
  // Update UI state
  mainWindow.webContents.send('cloakmanager:profile-stopped', data);
});

// Handle CDP ready event
cloakWS.on('cdp_ready', (data) => {
  console.log(`CDP ready for ${data.profile}:`, data.data);
  
  // Update renderer with CDP connection info
  mainWindow.webContents.send('cloakmanager:cdp-ready', data);
});
```

#### Renderer Event Handlers

```javascript
// src/renderer/index.js
import { ipcRenderer } from 'electron';

// Listen for CloakManager events
ipcRenderer.on('cloakmanager:profile-launched', (event, data) => {
  console.log('Profile launched:', data);
  // Update UI state
});

ipcRenderer.on('cloakmanager:profile-stopped', (event, data) => {
  console.log('Profile stopped:', data);
  // Update UI state
  // Clear CDP connections
});

ipcRenderer.on('cloakmanager:cdp-ready', (event, data) => {
  console.log('CDP ready:', data);
  
  // Update CDP connection info in state
  setCdpConnectionInfo(data.profile, data.data);
});
```

---

## Extension Management

### Understanding Extensions

**CloakManager supports Chrome extensions for Reddit automation:**

- **Anti-bot detection evasion** - Custom user scripts
- **Automation helpers** - Form auto-fill, CAPTCHA solving
- **Analytics** - Data collection and reporting
- **Productivity** - Account management tools

### Extension Installation

#### Upload Extension File

```javascript
// Install extension from CRX file
async function installExtension(extensionName, crxFilePath) {
  const formData = new FormData();
  formData.append('file', fs.readFileSync(crxFilePath));
  formData.append('enabled', 'true');

  const response = await apiCall('extensions', {
    method: 'POST',
    body: formData,  // FormData - don't set Content-Type header
    headers: {
      // Don't set Content-Type for FormData
    }
  }, true);  // third param = raw body

  const data = await response.json();
  
  console.log(`✅ Extension installed: ${data.name}`);
  return data.id;
}
```

#### Import from Chrome Web Store

```javascript
// Import extension directly from Chrome Web Store
async function importExtensionFromStore(extensionUrl, profileName) {
  const response = await apiCall('extensions/import-from-store', {
    method: 'POST',
    body: JSON.stringify({
      store_url: extensionUrl
    })
  });
  
  const data = await response.json();
  
  // Assign extension to profile
  await assignExtensionToProfile(data.id, profileName);
  
  return data;
}

async function assignExtensionToProfile(extensionId, profileName) {
  await apiCall(`profiles/${profileName}/extensions/${extensionId}`, {
    method: 'POST'
  });
}
```

#### Get Profile Extensions

```javascript
async function getProfileExtensions(profileName) {
  const response = await apiCall(`profiles/${profileName}/extensions`, {
    method: 'GET'
  });
  
  return response.json();
}
```

### Extension Management for Reddit Accounts

#### Auto-Install Essential Extensions

```javascript
// Extensions that help with Reddit automation
const REDDIT_ESSENTIAL_EXTENSIONS = [
  {
    name: 'Reddit Enhancement Suite',
    id: 'fkkmagjalimmjdnkdnfnemfgabmjfimmfnjd',
    url: 'https://chrome.google.com/webstore/detail/fkkmagjalimmjdnkdnfnemfgabmjfimmfnjd'
  },
  {
    name: 'Tampermonkey',
    id: 'dgmgymkkjoemlnphljpdoienfobklijmmlji',
    url: 'https://chrome.google.com/webstore/detail/dgmjymkkjoemlnphljdoienfobklijmmlji'
  }
];

async function setupRedditExtensions(profileName) {
  for (const ext of REDDIT_ESSENTIAL_EXTENSIONS) {
    try {
      // Import from Chrome Web Store
      const result = await importExtensionFromStore(ext.url, profileName);
      console.log(`✅ Installed ${ext.name}: ${result.id}`);
    } catch (error) {
      console.error(`❌ Failed to install ${ext.name}:`, error);
    }
  }
}
```

### Extension Progress Events

```javascript
// Listen to extension installation progress
ipcRenderer.on('cloakmanager:extension-upload-progress', (event, data) => {
  const { extension_id, data: progressData } = event;
  
  console.log(`Extension ${extension_id} progress: ${progressData.progress}% - ${progressData.message}`);
  
  // Update UI progress bar
  updateExtensionProgress(extension_id, progressData);
});

ipcRenderer.on('cloakmanager:extension-download-progress', (event, data) => {
  const { extension_id, data: progressData } = event;
  
  console.log(`Extension ${extension_id} download: ${progressData.progress}%`);
  
  // Update download progress UI
  updateExtensionDownloadProgress(extension_id, progressData);
});
```

---

## Proxy Management

### Understanding Proxies

**CloakManager proxies provide:**

- **IP anonymity** - Hide real server location
- **WebRTC spoofing** - Replace leaked IP with proxy IP
- **Geolocation matching** - Match timezone/locale to proxy exit IP
- **Load balancing** - Distribute requests across multiple IPs

### Proxy CRUD Operations

#### Create Proxy

```javascript
async function createProxy(proxyConfig) {
  const response = await apiCall('proxies', {
    method: 'POST',
    body: JSON.stringify({
      label: `${proxyConfig.host}:${proxyConfig.port}`,
      protocol: proxyConfig.protocol || 'socks5',
      host: proxyConfig.host,
      port: proxyConfig.port,
      username: proxyConfig.username || '',
      password: proxyConfig.password || '',
      country: proxyConfig.country || '',
      bypass: 'localhost,127.0.0.1'
    })
  });

  return response.json();
}
```

#### Test Proxy Connectivity

```javascript
async function testProxy(proxyId) {
  const response = await apiCall(`proxies/${proxyId}/test`, {
    method: 'POST'
  });

  const result = await response.json();
  
  if (result.ok) {
    console.log(`✅ Proxy verified: ${result.external_ip} (${result.latency_ms}ms)`);
  } else {
    console.log(`❌ Proxy test failed: ${result.error}`);
  }
  
  return result;
}
```

#### Get Proxy for Account

```javascript
async function getProxyForAccount(account) {
  // Get proxy details from Oserus database
  const proxyData = await getAccountProxy(account);
  
  if (!proxyData) {
    return null;
  }
  
  // Check if proxy exists in CloakManager, create if not
  let proxies = await apiCall('proxies', { method: 'GET' });
  proxies = await proxies.json();
  
  const existingProxy = proxies.find(p => 
    p.host === proxyData.host && 
    p.port === parseInt(proxyData.port)
  );
  
  if (existingProxy) {
    return existingProxy;
  }
  
  // Create new proxy
  return await createProxy(proxyData);
}
```

### Proxy Integration with Profiles

#### Assign Proxy to Profile

```javascript
async function assignProxyToProfile(account) {
  const profileName = `${account.platform}-${account.username}`;
  
  // Get or create proxy
  const proxy = await getProxyForAccount(account);
  
  if (!proxy) {
    throw new Error('No proxy configured for account');
  }
  
  // Test proxy before assigning
  const testResult = await testProxy(proxy.id);
  
  if (!testResult.ok) {
    throw new Error(`Proxy verification failed: ${testResult.error}`);
  }
  
  // Update profile with proxy
  const response = await apiCall(`profiles/${profileName}`, {
    method: 'PUT',
    body: JSON.stringify({
      proxy_id: proxy.id
    })
  });
  
  if (response.ok) {
    console.log(`✅ Proxy assigned to ${profileName}: ${proxy.label}`);
  }
  
  return proxy;
}
```

#### Bulk Proxy Import

```javascript
// Import multiple proxies from text file
async function importProxiesFromFile(proxiesText) {
  const lines = proxiesText.split('\n').filter(line => 
    line.trim() && !line.startsWith('#')
  );
  
  for (const line of lines) {
    try {
      // Parse line (format: protocol://host:port:user:pass or host:port)
      const proxy = parseProxyLine(line);
      
      const response = await apiCall('proxies/bulk-import', {
        method: 'POST',
        body: JSON.stringify({
          proxies: lines.join('\n'),
          format: 'auto'
        })
      });
      
      const result = await response.json();
      console.log(`✅ Imported ${result.success_count}/${result.total} proxies`);
      
    } catch (error) {
      console.error(`❌ Failed to import proxy: ${line}`, error);
    }
  }
}

function parseProxyLine(line) {
  // Simple format: host:port or protocol://host:port
  if (line.includes('://')) {
    const [protocol, rest] = line.split('://');
    const [host, port] = rest.split(':');
    const [username, password] = port.split('@');
    return { protocol, host, parseInt(port), username, password };
  } else {
    const [host, port] = line.split(':');
    return { protocol: 'socks5', host, parseInt(port), username: '', password: '' };
  }
}
```

---

## Error Handling

### Common Errors & Solutions

#### Profile Already Running

**Error:**
```json
{
  "error": "Profile reddit-LunaMain is already running"
}
```

**Solution:**
```javascript
// Check if profile is running before launch
async function safeLaunchProfile(account) {
  const profileName = `${account.platform}-${account.username}`;
  
  const running = await apiCall('running', { method: 'GET' });
  
  if (profileName in running) {
    console.log(`✅ Profile ${profileName} already running`);
    return await getCDPConnectionInfo(account);
  }
  
  // Profile not running, proceed with launch
  return await launchProfileForAccount(account);
}
```

#### Proxy Verification Failed

**Error:**
```json
{
  "error": "Launch blocked — proxy verification failed: Connection refused"
}
```

**Solution:**
```javascript
async function handleProxyError(account) {
  // Try launching without proxy (for testing)
  console.warn('Proxy failed, launching without proxy...');
  
  const profileName = `${account.platform}-${account.username}`;
  await apiCall(`profiles/${profileName}`, {
    method: 'POST',
    body: JSON.stringify({
      headless: true,
      proxy_id: null  // Launch without proxy
    })
  });
}
```

#### CDP Connection Failed

**Error:**
```
CDP WebSocket URL fetch failed for Profile reddit-LunaMain: Connection refused
```

**Solution:**
```javascript
// Retry with fallback
async function resilientCDPConnection(account, retries = 3) {
  const profileName = `${account.platform}-${account.username}`;
  
  for (let i = 0; i < retries; i++) {
    try {
      const cdpInfo = await getCDPConnectionInfo(account);
      
      // Attempt connection
      const client = new CloakBrowserCDP(cdpInfo.cdp_ws_url);
      await client.connect();
      
      console.log(`✅ CDP connected on attempt ${i + 1}`);
      return client;
      
    } catch (error) {
      console.log(`Attempt ${i + 1} failed:`, error.message);
      
      // Wait before retry
      if (i < retries - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
      }
    }
  }
  
  throw new Error(`Failed to connect after ${retries} attempts`);
}
```

### Graceful Degradation

#### Fallback to Electron Webview

```javascript
// If CloakManager fails, fall back to Electron webview
async function getBrowserForAccount(account) {
  try {
    // Test CloakManager availability
    const available = await testCloakManager();
    
    if (available) {
      // Use CloakManager
      return { type: 'cloakmanager', ready: true };
    } else {
      // Fall back to Electron
      return { type: 'electron', ready: true };
    }
  } catch (error) {
    console.log('CloakManager unavailable, using Electron:', error.message);
    return { type: 'electron', ready: true };
  }
}

// Component integration
function BrowserView({ account, browserType }) {
  switch (browserType.type) {
    case 'cloakmanager':
      return <CloakBrowserView account={account} />;
    case 'electron':
      return <ElectronWebView account={account} />;
    default:
      return <div>Unsupported browser type</div>;
  }
}
```

---

## Deployment

### Development Setup

#### Terminal 1: CloakManager Backend

```bash
cd /home/gee/Projects/cloakmanager-app/backend
python app.py
# Runs on http://127.0.0.1:7331
```

#### Terminal 2: Oserus Management

```bash
cd /home/gee/Projects/Oserus-reddit
npm run dev
# Electron app starts and connects to CloakManager
```

### Production Build

#### Option 1: Sidecar Process (Recommended)

**Architecture:** Oserus starts CloakManager as separate process

```javascript
// src/main/index.js
const { spawn } = require('child_process');
const path = require('path');

let cloakProcess = null;

function startCloakManager() {
  const isDev = !app.isPackaged;
  
  if (isDev) {
    console.log('Dev mode: Start CloakManager manually');
    return;
  }
  
  // Production: Auto-start CloakManager
  const cloakPath = path.join(
    process.resourcesPath,
    'cloakmanager',
    'backend'
  );
  
  try {
    cloakProcess = spawn(cloakPath, ['--port', '7331'], {
      stdio: 'ignore',
      detached: true
    });
    
    cloakProcess.on('error', (err) => {
      console.log('CloakManager error:', err.message);
    });
    
    console.log('✅ CloakManager started as sidecar');
  } catch (error) {
    console.log('Failed to start CloakManager:', error.message);
  }
}

function stopCloakManager() {
  if (cloakProcess) {
    cloakProcess.kill();
    cloakProcess = null;
    console.log('CloakManager stopped');
  }
}

app.whenReady().then(() => startCloakManager());
app.on('before-quit', () => stopCloakManager());
```

#### Option 2: Bundled Binary

**Architecture:** CloakManager binary bundled with Oserus

```bash
# Build CloakManager backend
cd /home/gee/Projects/cloakmanager-app/backend
python -m nuitka --standalone app.py

# Copy binary to Oserus resources
cp backend/app.bin /home/gee/Projects/Oserus-reddit/build/cloakmanager-backend

# Build Oserus
cd /home/gee/Projects/Oserus-reddit
npm run build

# Package includes CloakManager binary
```

### Environment Variables

```javascript
// CloakManager API location
const CLOAKMANAGER_API = process.env.CLOAKMANAGER_API || 'http://127.0.0.1:7331';

// Authentication token (if enabled)
const CLOAKMANAGER_TOKEN = process.env.CLOAKMANAGER_TOKEN;
```

### Port Configuration

**Default Ports:**
- CloakManager API: `7331` (configurable)
- CDP ports: `9222-9322` (auto-allocated per profile)

**Custom Ports:**
```javascript
const CLOAKMANAGER_API = 'http://127.0.0.1:7331';  // Default
// const CLOAKMANAGER_API = 'http://127.0.0.1:8444';  // Custom
```

---

## Testing Guide

### Integration Testing Checklist

#### Phase 1: Connectivity Tests

- [ ] CloakManager API responds to `GET /api/running`
- [ ] Can create profile via `POST /api/profiles`
- [ ] Can launch profile in headless mode
- [ ] CDP endpoint returns connection info
- [ ] Profile stop works correctly

#### Phase 2: Profile Management Tests

- [ ] Multiple profiles can run simultaneously
- [ ] Each profile has unique fingerprint
- [ ] Proxy assignment works correctly
- [ ] Profile cloning creates new fingerprint
- [ ] Profile deletion cleans up resources

#### Phase 3: CDP Integration Tests

- [ ] Can connect to CDP endpoint
- [ ] Browser content renders correctly
- [ ] User interactions work (clicks, navigation)
- [ ] Multiple accounts can have separate CDP connections
- [ ] CDP reconnection works after disconnect

#### Phase 4: Extension Tests

- [ ] Extensions can be uploaded and installed
- [ ] Extensions work correctly with headless mode
- [ ] Extension progress events fire correctly
- [ ] Multiple extensions can coexist

#### Phase 5: Proxy Tests

- [ ] Proxy creation works
- [ ] Proxy testing returns correct external IP
- [ ] Proxy assignment to profiles works
- [ ] WebRTC spoofing uses proxy IP
- [ ] Proxy failures are handled gracefully

### Test Scripts

#### Basic Connectivity Test

```javascript
// test-cloakmanager-connection.js
async function testCloakManagerConnection() {
  console.log('Testing CloakManager connectivity...');
  
  try {
    const response = await fetch('http://127.0.0.1:7331/api/running', {
      method: 'GET',
      signal: AbortSignal.timeout(5000)  // 5 second timeout
    });
    
    if (response.ok) {
      console.log('✅ CloakManager API is reachable');
      const data = await response.json();
      console.log('Running profiles:', Object.keys(data).length);
      return true;
    } else {
      console.log('❌ CloakManager API returned error:', response.status);
      return false;
    }
    
  } catch (error) {
    console.log('❌ Cannot connect to CloakManager:', error.message);
    return false;
  }
}

// Run test
testCloakManagerConnection();
```

#### Profile Creation Test

```javascript
// test-profile-creation.js
async function testProfileCreation() {
  console.log('Testing profile creation...');
  
  const testProfile = {
    name: 'osertus-test-profile',
    os: 'windows',
    timezone: 'America/New_York',
    locale: 'en-US',
    resolution: '1920x1080',
    headless: true
  };
  
  try {
    // Create profile
    const createResponse = await fetch('http://127.0.0.1:7331/api/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testProfile)
    });
    
    const createResult = await createResponse.json();
    
    if (createResult.ok) {
      console.log('✅ Profile created:', createResult.name);
      
      // Test launch
      const launchResponse = await fetch(`http://127.0.0.1:7331/api/profiles/${testProfile.name}/launch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ headless: true })
      });
      
      const launchResult = await launchResponse.json();
      
      if (launchResult.ok) {
        console.log('✅ Profile launched successfully');
        console.log('   PID:', launchResult.pid);
        console.log('   CDP port:', launchResult.cdp_port);
        
        // Get CDP info
        const cdpResponse = await fetch(`http://127.0.0.1:7331/api/profiles/${testProfile.name}/cdp`);
        const cdpResult = await cdpResponse.json();
        console.log('✅ CDP endpoint available:', cdpResult.cdp_http_url);
        
        // Cleanup
        await fetch(`http://127.0.0.1:7331/api/profiles/${testProfile.name}/stop`, {
          method: 'POST'
        });
        
        console.log('✅ Profile cleanup successful');
        return true;
      } else {
        console.log('❌ Profile launch failed:', launchResult.error);
      }
    } else {
      console.log('❌ Profile creation failed:', createResult.error);
    }
    
  } catch (error) {
    console.log('❌ Test failed:', error.message);
    return false;
  }
}

// Run test
testProfileCreation();
```

#### Fingerprint Uniqueness Test

```javascript
// test-fingerprint-uniqueness.js
async function testFingerprintUniqueness() {
  console.log('Testing fingerprint uniqueness...');
  
  const accounts = ['Account1', 'Account2', 'Account3'];
  const fingerprints = new Set();
  
  for (const account of accounts) {
    const profileName = `reddit-${account}`;
    
    // Create unique profile
    await fetch('http://127.0.0.1:7331/api/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: profileName,
        os: 'windows',
        timezone: 'America/New_York',
        headless: true
      })
    });
    
    // Launch profile
    const launchResponse = await fetch(`http://127.0.0.1:7331/api/profiles/${profileName}/launch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ headless: true })
    });
    
    const launchData = await launchResponse.json();
    const fingerprint = launchData.fp_seed;
    
    console.log(`${account}: fingerprint}`);
    fingerprints.add(fingerprint);
    
    // Stop profile
    await fetch(`http://127.0.0.1:7331/api/profiles/${profileName}/stop`, {
      method:POST'
    });
  }
  
  if (fingerprints.size === accounts.length) {
    console.log('✅ All fingerprints are unique!');
  } else {
    console.log('❌ Duplicate fingerprints detected!');
  }
}

// Run test
testFingerprintUniqueness();
```

### Performance Testing

#### Load Testing

```javascript
// test-concurrent-profiles.js
async function testConcurrentProfiles() {
  console.log('Testing concurrent profile management...');
  
  const profileCount = 10;
  const profiles = [];
  
  // Create profiles
  for (let i = 0; i < profileCount; i++) {
    const profileName = `reddit-loadtest-${i}`;
    
    await fetch('http://127.0.0.1:7331/api/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: profileName,
        os: 'windows',
        headless: true
      })
    });
    
    profiles.push(profileName);
  }
  
  console.log(`Created ${profiles.length} profiles`);
  
  // Launch all profiles concurrently
  const launchPromises = profiles.map(profileName =>
    fetch(`http://127.0.0.1:7331/api/profiles/${profileName}/launch`, {
      method: 'POST',
      headers: { { 'Content-Type': 'application/json' },
      body: JSON.stringify({ headless: true })
    }).then(r => r.json())
  );
  
  const results = await Promise.all(launchPromises);
  
  const successful = results.filter(r => r.ok);
  console.log(`✅ Successfully launched: ${successful.length}/${profileCount}`);
  
  // Verify all are running
  const running = await fetch('http://127.0.0.1:7331/api/running');
  const runningData = await running.json();
  console.log(`✅ Running profiles: ${Object.keys(runningData).length}`);
  
  // Cleanup
  const stopPromises = profiles.map(profileName =>
    fetch(`http://127.0.0.1:7331/api/profiles/${profileName}/stop`, {
      method: 'POST'
    })
  );
  
  await Promise.all(stopPromises);
  console.log('✅ Cleanup complete');
}

// Run test
testConcurrentProfiles();
```

---

## Quick Reference

### Essential API Endpoints

| **Endpoint** | **Method** | **Purpose** | **Oserus Usage** |
|-------------|----------|---------|----------------|
| `/api/profiles` | POST | Create profile | Auto-create for accounts |
| `/api/profiles/{name}` | GET | Get profile details | Check configuration |
| `/api/profiles/{name}` | PUT | Update profile | Change settings |
| `/api/profiles/{name}/launch` | POST | Launch profile | Start browser for account |
| `/api/profiles/{name}/stop` | POST | Stop profile | Cleanup when done |
| `/api/profiles/{name}/cdp` | GET | Get CDP info | Connect to browser |
| `/api/running` | GET | List running profiles | Check active sessions |
| `/api/proxies` | GET | List proxies | Get available proxies |
| `/api/proxies` | POST | Create proxy | Add account proxy |
| `/api/proxies/{id}/test` | POST | Test proxy | Verify connectivity |
| `/api/extensions` | GET | List extensions | Get installed extensions |
| `/api/extensions` | POST | Upload extension | Add new extension |

### Common Integration Patterns

#### Account Profile Auto-Creation

```javascript
// Auto-create profile when account is selected
async function getOrCreateProfileForAccount(account) {
  const profileName = `reddit-${account.username}`;
  
  try {
    const response = await fetch(`http://127.0.0.1:7331/api/profiles/${profileName}`, {
      method: 'GET'
    });
    const profile = await response.json();
    
    // Update to headless if needed
    if (!profile.headless) {
      await fetch(`http://127.0.0.1:7331/api/profiles/${profileName}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ headless: true })
      });
    }
    
    return profileName;
    
  } catch (error) {
    // Profile doesn't exist, create it
    return await createProfileForAccount(account);
  }
}
```

#### Safe Profile Launch

```javascript
// Launch with retry logic
async function safeLaunchProfile(account) {
  const profileName = `reddit-${account.username}`;
  
  // Check if already running
  const running = await apiCall('running', { method: 'GET' });
  
  if (profileName in running) {
    console.log(`Profile ${profileName} already running`);
    return await getCDPConnectionInfo(account);
  }
  
  // Launch with error handling
  try {
    const result = await launchProfileForAccount(account);
    return result;
  } catch (error) {
    console.error(`Launch failed for ${account.username}:`, error.message);
    // Return error state for UI to display
    return { error: error.message };
  }
}
```

#### CDP Connection Pattern

```javascript
// Manage CDP lifecycle per account
class AccountCDPManager {
  constructor() {
    this.connections = new Map(); // accountId -> CDP client
  }
  
  async connect(account) {
    const profileName = `reddit-${account.username}`;
    
    // Get CDP info
    const cdpInfo = await getCDPConnectionInfo({ 
      platform: 'reddit', 
      username: account.username 
    });
    
    // Create CDP client
    const client = new CloakBrowserCDP(cdpInfo.cdp_ws_url);
    await client.connect();
    
    this.connections.set(account.username, client);
    return client;
  }
  
  async disconnect(account) {
    const client = this.connections.get(account.username);
    if (client) {
      await client.disconnect();
      this.connections.delete(account.username);
    }
  }
  
  async getConnection(account) {
    if (!this.connections.has(account.username)) {
      await this.connect(account);
    }
    return this.connections.get(account.username);
  }
  
  async disconnectAll() {
    for (const [username, client] of this.connections) {
      await client.disconnect();
    }
    this.connections.clear();
  }
}

// Global instance
const cdpManager = new AccountCDPManager();
```

---

## Summary

### What You Need to Implement

#### Essential (2-3 days):

1. **CloakBrowserView component** - React component for CDP embedding
2. **CDP client integration** - Connect to CloakBrowser via chrome-remote-interface
3. **Profile auto-creation** - Create profiles when accounts are selected
4. **IPC handlers** - CloakManager API calls from Electron main process
5. **Error handling** - Fallback logic and graceful degradation

#### Important (1-2 days):

1. **Extension integration** - Install Reddit automation extensions
2. **Proxy management** - Configure proxies for accounts
3. **Multi-tab support** - Handle multiple tabs per account
4. **Resource cleanup** - Proper shutdown and connection management

#### Optional (Enhancement):

1. **WebSocket events** - Real-time updates for profile state changes
2. **Auto-proxy testing** - Verify proxy before account use
3. **Extension progress UI** - Show installation/download progress
4. **Account profile templates** - Pre-configured profiles for common setups

### Integration Complexity

**Oserus Development:** ~40-50 hours
- CloakBrowserView component (8-12 hours)
- CDP client integration (4-6 hours) 
- IPC handlers (3-4 hours)
- Profile auto-creation (2-3 hours)
- Error handling (2-3 hours)
- Testing (8-12 hours)

**Deployment:** ~4-8 hours
- Auto-start configuration (2-3 hours)
- Build process integration (1-2 hours)
- Packaging and distribution (1-3 hours)

### Result

Professional-grade Reddit account management with unique fingerprints per account, maintaining your exact current UI while gaining enterprise-level anti-detection capabilities.

**Users see zero changes, maximum security improvement.**

---

**Document Version:** 1.0  
**Last Updated:** 2026-06-14  
**CloakManager API Version:** 11.0  
**Integration Level:** Production-Ready  
**Status:** ✅ Ready for Implementation
