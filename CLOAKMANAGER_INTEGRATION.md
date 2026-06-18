# Oserus Management + CloakManager Integration Guide

## Executive Summary

**Oserus Management** is a team Reddit/RedGifs account management desktop application that currently uses Electron webviews with identical browser fingerprints. By integrating **CloakManager's compiled backend binary**, Oserus can provide unique browser fingerprints per account while maintaining the exact same embedded user interface through CDP (Chrome DevTools Protocol) embedding.

**Key Decision:** **Option B (CDP Embedding)** is the recommended approach - preserves the exact current user experience while adding enterprise-grade fingerprinting capabilities.

**Architecture:** The applications remain completely separate. Oserus Management only makes HTTP API calls to CloakManager's backend binary - no source code sharing or exposure.

---

## Current Architecture: Oserus Management

### Technology Stack
- **Electron 32** + **React 18** (renderer via Vite) + **SQLite** (better-sqlite3)
- **IPC:** Node-style `ipcMain.handle` / `ipcRenderer.invoke` with token-based auth
- **Database:** SQLite with 15+ tables (users, profiles, accounts, proxies, posts, votes, scheduled posts, activity log)
- **Encryption:** Electron `safeStorage` for all secrets at rest (OS keychain-backed)
- **Auto-update:** electron-updater via GitHub Releases

### Current Browser Implementation

Oserus Management uses **Electron's built-in webview functionality** with session partitions:

```javascript
// Current Implementation: Electron webview with session partition
<webview
  src={url}
  partition={`persist:${active.partition_key}`}  // Session isolation only
  style={{ width: '100%', height: '100%' }}
/>
```

**Current User Interface:**
```
┌─────────────────────────────────────────────────────────────────────┐
│  Oserus Management Window                                            │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │ Top Bar: [🔴 Reddit] [Account: LunaMain ▼]                     │ │
│  ├──────────────────────────────────────────────────────────────────┤ │
│  │ Tab Bar: [Reddit] [+]                                          │ │
│  ├──────────────────────────────────────────────────────────────────┤ │
│  │ Controls: [←] [→] [↻] [https://www.reddit.com/] [🔑]          │ │
│  ├──────────────────────────────────────────────────────────────────┤ │
│  │ ┌──────────────────────────────────────────────────────────────┐│ │
│  │ │  EMBEDDED WEBVIEW BROWSER                                   ││ │
│  │ │  ┌─────────────────────────────────────────────────────────┐││ │
│  │ │  │ Reddit.com homepage inside the Oserus window          │││ │
│  │ │  │                                                         │││ │
│  │ │  │ [Post 1] [Post 2] [Post 3]                            │││ │
│  │ │  └─────────────────────────────────────────────────────────┘││ │
│  │ └──────────────────────────────────────────────────────────────┘│ │
│  └──────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

**Session Preparation Flow:**
```javascript
// src/main/index.js - prepareSessionForAccount()
async function prepareSessionForAccount(accountId) {
  const account = db.prepare(/* SQL query */).get(accountId);
  
  // Create Electron session partition
  const partition = `persist:${account.partition_key}`;
  const sess = session.fromPartition(partition);
  
  // Set SAME user agent for ALL accounts
  sess.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36'
  );
  
  // Apply proxy if configured
  if (account.proxy_host && account.proxy_port) {
    await sess.setProxy({ proxyRules: `${scheme}://${host}:${port}` });
  }
  
  return { ok: true, partition, partitionKey: account.partition_key };
}
```

### Current Limitations

**All Reddit accounts share identical browser fingerprints:**
```
Account 1 (LunaMain):    UA: Chrome/127.0.0.0, Canvas: abc123, WebGL: gpu1
Account 2 (MiaBackup):   UA: Chrome/127.0.0.0, Canvas: abc123, WebGL: gpu1  
Account 3 (LunaAlt):     UA: Chrome/127.0.0.0, Canvas: abc123, WebGL: gpu1
... (all identical)
```

**What Reddit currently sees:**
- Same user agent across all accounts
- Same canvas fingerprint
- Same WebGL renderer
- Same audio context fingerprint
- Same screen resolution
- Same timezone/language
- No platform spoofing
- WebRTC leaks real IP (when proxy fails)

---

## CloakManager Backend Capabilities

### Technology Stack
- **Backend:** FastAPI 11.0 with SQLite (WAL mode + FTS5)
- **Binary:** Compiled Python via Nuitka (~77MB standalone binary)
- **Engine:** CloakBrowser (~697MB Chromium with anti-detection modifications)
- **API:** 65+ REST endpoints + WebSocket support
- **Browser Management:** Direct CloakBrowser API integration (not subprocess-based)

### Current CloakManager Architecture

**CloakBrowser Context Management:**
```python
# core/context_manager.py - Current implementation
class BrowserContextManager:
    def __init__(self):
        self.contexts: Dict[str, Any] = {}  # BrowserContext objects
        self.contexts_lock = asyncio.Lock()
        self.monitoring_tasks: Dict[str, asyncio.Task] = {}

    async def launch_context(
        self, name: str, profile_path: Path, config: dict, 
        proxy_config: Optional[dict] = None, session_mode: str = "persistent"
    ) -> tuple[Any, int, dict]:
        """Launch CloakBrowser context using direct API"""
        from utils.launcher import launch_browser_context
        
        # Returns: (BrowserContext object, pseudo_pid, detected_values)
        return await launch_browser_context(profile_path, config, proxy_config)
```

**CDP Monitoring System:**
```python
# core/cdp_monitor.py - Current CDP implementation
class CDPMonitor:
    """Monitor Chrome DevTools Protocol events for window close detection"""
    
    async def start_monitoring(self, profile_name: str, ws_port: int = 9222):
        """Start monitoring CDP events via WebSocket connection"""
        uri = f"ws://127.0.0.1:{ws_port}"
        async with websockets.connect(uri) as websocket:
            # Listen for Target.targetDestroyed, Page.windowClosed, etc.
```

### Key Capabilities

**Browser Fingerprinting:**
- Deterministic fingerprint generation (SHA-256 based, 10000-99999 range)
- Platform spoofing (Windows/macOS/Linux with plausible GPU strings)
- Canvas, WebGL, AudioContext randomization per profile
- User agent spoofing with browser brand/version options
- Screen resolution and viewport customization
- Timezone and locale spoofing

**Proxy Management:**
- HTTP/HTTPS/SOCKS5 proxy configuration
- Connectivity testing with latency measurement
- External IP resolution for WebRTC spoofing
- Per-profile proxy assignment with automatic testing

**Profile Management:**
- Full CRUD operations with SQLite persistence
- Profile cloning with new fingerprint seeds
- Cookie import/export as JSON
- Session warmup with pre-visit sites
- Launch history and crash monitoring

### Current API Endpoints

**Profile Operations:**
```python
POST /api/profiles/{name}/launch
  - Launch browser profile with unique fingerprint
  - Current: Returns {ok: bool, pid: int, proxy_verified: bool, proxy_ip: str, fp_seed: int}
  - Needed: Add CDP endpoint information

POST /api/profiles/{name}/stop
  - Stop running profile
  - Returns: {ok: bool}

GET /api/running
  - List currently running profile names
  - Returns: {running: [name1, name2, ...]}
```

---

## Recommended Integration: Option B (CDP Embedding)

### Why Option B is Superior

**User Experience Comparison:**

| **Aspect** | **Current** | **Option A (External)** | **Option B (CDP)** |
|-----------|------------|----------------------|------------------|
| **User Interface** | Embedded in Oserus | Separate windows | Embedded in Oserus |
| **Multi-tab** | ✅ Yes | ❌ No | ✅ Yes |
| **Address bar** | ✅ Yes | ❌ No | ✅ Yes |
| **Side panels** | ✅ Yes | ❌ No | ✅ Yes |
| **Fingerprinting** | ❌ Identical | ✅ Unique | ✅ Unique |
| **User training** | ✅ None needed | ❌ Significant | ✅ None needed |
| **Workflow change** | ✅ None | ❌ Major | ✅ None |

**Option B Provides:**
- ✅ **Zero user disruption** - same interface they know
- ✅ **All features preserved** - tabs, panels, address bar
- ✅ **Unique fingerprints** - CloakBrowser provides different identities
- ✅ **Seamless transition** - users won't notice difference
- ✅ **Better performance** - CloakBrowser optimized for anti-detection

---

## CDP Integration Architecture

### System Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Oserus Management (Electron + React)                                    │
│  ────────────────────────────────────────────────                        │
│  • Team management (users, roles, permissions)                           │
│  • Model profiles (Luna, Mia, etc.)                                      │
│  • Reddit/RedGifs accounts CRUD                                         │
│  • AI composer, scheduler, analytics                                    │
│  • Business logic and UI                                                │
│  • CDP Client Components (NEW)                                         │
└─────────────────────────────────────────────────────────────────────────┘
                    │
                    │ HTTP API calls (localhost:7331)
                    │ + CDP WebSocket connections
                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  CloakManager Backend (Compiled Binary)                                  │
│  ────────────────────────────────────────────                             │
│  • Profile management + fingerprint generation                          │
│  • CloakBrowser HEADLESS context spawning (MODIFIED)                    │
│  • CDP endpoint allocation + management                                │
│  • Proxy management + testing                                           │
│  • WebSocket real-time updates                                          │
└─────────────────────────────────────────────────────────────────────────┘
                    │
                    │ Spawns headless browser contexts + CDP endpoints
                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  CloakBrowser HEADLESS Processes (One per Reddit account)                │
│  ────────────────────────────────────────────                             │
│  • Unique fingerprints per profile                                       │
│  • Platform spoofing (Windows/Mac/Linux)                                 │
│  • Canvas/WebGL/Audio randomization                                      │
│  • CDP server: ws://127.0.0.1:9XXX (per-profile)                        │
│  • No visible windows (headless mode)                                   │
└─────────────────────────────────────────────────────────────────────────┘
                    │
                    │ CDP WebSocket connection
                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Oserus CDP Client (Embedded in React UI)                                │
│  ────────────────────────────────────────────                             │
│  • Connects to CloakBrowser CDP endpoint                               │
│  • Renders browser content in embedded container                       │
│  • Handles user interactions (clicks, navigation)                       │
│  • Manages CDP lifecycle (connect, disconnect, reconnect)              │
└─────────────────────────────────────────────────────────────────────────┘
```

### User Experience with CDP Integration

**What users see (NO CHANGE):**
```
┌─────────────────────────────────────────────────────────────────────┐
│  Oserus Management Window (Exactly the same!)                       │
│  ────────────────────────────────────────────                        │
│  [🔴 Reddit] [Account: LunaMain ▼]                                 │
│  [Tab: Reddit] [+]                                                   │
│  [←] [→] [↻] [https://www.reddit.com/] [🔑]                        │
│  ┌──────────────────────────────────────────────────────────────┐│
│  │ EMBEDDED BROWSER (Powered by CloakBrowser via CDP)            ││
│  │ [Reddit content with unique fingerprint]                     ││
│  │ [All interactions work: clicks, scrolling, forms]            ││
│  └──────────────────────────────────────────────────────────────┘│
│  [Floating buttons: ✍️ Compose 💡 Ideas 🟠 RedGifs]                │
└─────────────────────────────────────────────────────────────────────┘
```

**Behind the scenes (Completely different):**
- CloakBrowser runs headless with unique fingerprint
- CDP connects browser to embedded Oserus container
- User gets unique fingerprint + embedded interface
- Zero workflow change, maximum security improvement

---

## Required CloakManager Backend Modifications

### 1. Headless Mode Support

**Current Launch Endpoint:**
```python
# backend/api/profiles.py - Current launch endpoint
@router.post("/api/profiles/{name}/launch")
async def launch_profile(name: str, session_mode: str = "persistent"):
    # Launches with visible windows (headed mode)
    context, pseudo_pid, detected = await context_mgr.launch_context(
        name=name,
        profile_path=profile_path,
        config=profile,
        proxy_config=proxy_dict,
        session_mode=session_mode
    )
    return {
        "ok": True,
        "pid": pseudo_pid,
        "proxy_verified": proxy_dict is not None,
        "proxy_ip": proxy_dict.get("last_test_ip") if proxy_dict else None,
        "fp_seed": fp_seed_for(name)
    }
```

**Needed Enhancement - Add Headless Parameter:**
```python
# MODIFIED ENDPOINT
@router.post("/api/profiles/{name}/launch")
async def launch_profile(
    name: str, 
    session_mode: str = "persistent",
    headless: bool = False,  # NEW PARAMETER
    cdp_port: Optional[int] = None  # NEW PARAMETER
):
    """Launch profile with optional headless mode and CDP exposure"""
    
    context, pseudo_pid, detected = await context_mgr.launch_context(
        name=name,
        profile_path=profile_path,
        config=profile,
        proxy_config=proxy_dict,
        session_mode=session_mode,
        headless=headless,  # NEW: Pass through to launcher
        cdp_port=cdp_port   # NEW: Specific CDP port allocation
    )
    
    return {
        "ok": True,
        "pid": pseudo_pid,
        "proxy_verified": proxy_dict is not None,
        "proxy_ip": proxy_dict.get("last_test_ip") if proxy_dict else None,
        "fp_seed": fp_seed_for(name),
        "cdp_url": f"ws://127.0.0.1:{detected.get('cdp_port', 9222)}",  # NEW
        "headless": headless  # NEW
    }
```

### 2. CDP Port Allocation System

**New CDP Port Manager:**
```python
# backend/core/cdp_port_manager.py (NEW FILE)
class CDPPortManager:
    """Manage CDP port allocation for headless profiles"""
    
    def __init__(self):
        self.allocated_ports = set()
        self.port_range = (9222, 9322)  # 100 available ports
        self.lock = asyncio.Lock()
    
    async def allocate_port(self, profile_name: str) -> int:
        """Allocate a unique CDP port for a profile"""
        async with self.lock:
            for port in range(self.port_range[0], self.port_range[1]):
                if port not in self.allocated_ports:
                    if await self._test_port_available(port):
                        self.allocated_ports.add(port)
                        return port
            raise Exception("No available CDP ports")
    
    async def release_port(self, port: int):
        """Release a CDP port when profile stops"""
        async with self.lock:
            self.allocated_ports.discard(port)
    
    async def _test_port_available(self, port: int) -> bool:
        """Test if port is available for use"""
        try:
            import socket
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.bind(('127.0.0.1', port))
                return True
        except OSError:
            return False

# Global instance
cdp_port_manager = CDPPortManager()
```

### 3. Headless Launcher Modification

**Modified Launcher Function:**
```python
# backend/utils/launcher.py - MODIFIED
async def launch_browser_context(
    profile_path: Path,
    profile_config: dict,
    proxy_config: Optional[dict] = None,
    headless: bool = False,  # NEW PARAMETER
    cdp_port: Optional[int] = None  # NEW PARAMETER
) -> tuple[Any, dict]:
    """Launch browser context with optional headless mode"""
    
    from cloakbrowser import launch_persistent_context_async
    
    # ... existing configuration code ...
    
    # NEW: CDP port allocation
    if cdp_port is None and headless:
        from core.cdp_port_manager import cdp_port_manager
        cdp_port = await cdp_port_manager.allocate_port(profile_config.get("name"))
    
    # NEW: Launch with headless configuration
    launch_args = {
        "headless": headless,  # Pass headless flag
        "cdp_port": cdp_port,   # Specify CDP port
    }
    
    # Launch CloakBrowser context
    context = await launch_persistent_context_async(
        profile_dir=str(profile_path),
        fingerprint_seed=seed,
        os_name=os_name,
        # ... existing parameters ...
        **launch_args  # NEW: Headless configuration
    )
    
    # Detect CDP endpoint information
    detected_values = {
        "resolution": "1920x1080",  # Get from context
        "gpu_vendor": "nvidia",
        "gpu_renderer": "geforce rtx 3060",
        "cdp_port": cdp_port  # NEW: Return CDP port
    }
    
    return (context, detected_values)
```

### 4. CDP Connection Management

**New CDP Endpoint:**
```python
# backend/api/cdp.py (NEW FILE)
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter()

@router.websocket("/ws/cdp/{profile_name}")
async def cdp_proxy_endpoint(websocket: WebSocket, profile_name: str):
    """Proxy CDP WebSocket connection between Oserus and CloakBrowser"""
    
    await websocket.accept()
    
    try:
        # Get CDP port for profile
        cdp_port = get_cdp_port_for_profile(profile_name)
        
        # Connect to actual CloakBrowser CDP endpoint
        async with websockets.connect(f"ws://127.0.0.1:{cdp_port}") as cloak_cdp:
            # Bidirectional proxying
            async def forward_to_osert():
                async for message in cloak_cdp:
                    await websocket.send_text(message)
            
            async def forward_to_cloak():
                async for message in websocket.iter_text():
                    await cloak_cdp.send(message)
            
            # Run both directions concurrently
            await asyncio.gather(
                forward_to_osert(),
                forward_to_cloak()
            )
            
    except WebSocketDisconnect:
        logger.info(f"CDP client disconnected from {profile_name}")
    except Exception as e:
        logger.error(f"CDP proxy error for {profile_name}: {e}")
```

### 5. Profile Status Enhancement

**Enhanced Running Status:**
```python
# backend/api/system.py - MODIFIED
@router.get("/api/running")
async def get_running():
    """Get list of currently running profiles with CDP info"""
    context_mgr = get_context_manager()
    
    profiles = []
    for name in await context_mgr.get_running_profiles():
        profile_info = {
            "name": name,
            "headless": context_mgr.is_headless(name),  # NEW
            "cdp_port": context_mgr.get_cdp_port(name),   # NEW
            "pid": context_mgr.get_pseudo_pid(name)
        }
        profiles.append(profile_info)
    
    return {"running": profiles}
```

---

## Oserus Management CDP Integration

### 1. CDP Client Component

**New React Component:**
```javascript
// src/renderer/components/CloakBrowserView.jsx (NEW FILE)
import React, { useEffect, useRef, useState } from 'react';

export default function CloakBrowserView({ account, onUrlChange, onSubmitPage }) {
  const containerRef = useRef(null);
  const [cdpState, setCdpState] = useState({
    connected: false,
    loading: true,
    error: null
  });
  
  useEffect(() => {
    let mounted = true;
    
    async function launchAndConnect() {
      try {
        setCdpState({ connected: false, loading: true, error: null });
        
        // 1. Launch CloakManager profile via API
        const profileName = `${account.platform}-${account.username}`;
        const launchResponse = await window.api.cloakmanager.launch({
          accountName: profileName,
          proxy: account.proxy,
          headless: true,  // Request headless mode
          cdpPort: null     // Let CloakManager allocate port
        });
        
        if (!launchResponse.ok) {
          throw new Error(launchResponse.error || 'Failed to launch profile');
        }
        
        // 2. Connect via CDP and embed content
        await connectCDPEmbed(launchResponse.cdp_url, containerRef.current);
        
        if (mounted) {
          setCdpState({ connected: true, loading: false, error: null });
        }
        
      } catch (error) {
        if (mounted) {
          setCdpState({ connected: false, loading: false, error: error.message });
        }
      }
    }
    
    launchAndConnect();
    
    // Cleanup on unmount
    return () => {
      mounted = false;
      if (account) {
        window.api.cloakmanager.stop({ accountName: `${account.platform}-${account.username}` });
      }
    };
  }, [account]);
  
  if (cdpState.loading) {
    return (
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        height: '100%',
        flexDirection: 'column',
        gap: 16
      }}>
        <div className="spinner">Launching secure browser...</div>
        <div className="dim" style={{ fontSize: 12 }}>
          Initializing unique fingerprint for {account?.username}
        </div>
      </div>
    );
  }
  
  if (cdpState.error) {
    return (
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        height: '100%',
        flexDirection: 'column',
        gap: 16
      }}>
        <div style={{ color: 'var(--error)' }}>❌ {cdpState.error}</div>
        <button onClick={() => window.location.reload()}>Retry</button>
      </div>
    );
  }
  
  return (
    <div 
      ref={containerRef}
      style={{ 
        width: '100%', 
        height: '100%', 
        background: 'white',
        border: '1px solid #ddd'
      }}
    />
  );
}

// CDP Embedding Implementation
async function connectCDPEmbed(cdpUrl, container) {
  // Use CDP to connect and render browser content
  // This requires a CDP client library or custom implementation
  
  // Option 1: Use chrome-remote-interface library
  const CDP = require('chrome-remote-interface');
  
  try {
    const client = await CDP({ target: cdpUrl });
    const { Page, Runtime, Network } = client;
    
    // Enable required domains
    await Page.enable();
    await Runtime.enable();
    await Network.enable();
    
    // Create embedded viewport
    // This requires additional iframe/webview magic to render CDP content
    
    await client.close();
  } catch (error) {
    console.error('CDP connection failed:', error);
    throw error;
  }
}
```

### 2. IPC Handler Updates

**CloakManager IPC Handler:**
```javascript
// src/main/ipc/cloakmanager.js (MODIFIED)
const CLOAKMANAGER_API = 'http://127.0.0.1:7331';

async function launchProfile(accountName, proxy = null, headless = true, cdpPort = null) {
  const response = await fetch(`${CLOAKMANAGER_API}/api/profiles/launch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: accountName,
      proxy: proxy,
      headless: headless,  // NEW: Request headless mode
      cdp_port: cdpPort    // NEW: Optional specific CDP port
    })
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(error);
  }
  
  return response.json();
}

async function stopProfile(accountName) {
  await fetch(`${CLOAKMANAGER_API}/api/profiles/${accountName}/stop`, {
    method: 'POST'
  });
}

async function getRunningProfiles() {
  const response = await fetch(`${CLOAKMANAGER_API}/api/running`);
  return response.json();
}

function register(ipcMain) {
  ipcMain.handle('cloakmanager:launch', async (e, { accountName, proxy, headless, cdpPort }) => {
    try {
      return await launchProfile(accountName, proxy, headless, cdpPort);
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
  
  ipcMain.handle('cloakmanager:stop', async (e, { accountName }) => {
    try {
      await stopProfile(accountName);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
  
  ipcMain.handle('cloakmanager:running', async () => {
    try {
      return await getRunningProfiles();
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
}

module.exports = register;
```

### 3. Reddit Browser Component Integration

**Modified Reddit Browser:**
```javascript
// src/renderer/pages/RedditBrowser.jsx - MODIFIED
import CloakBrowserView from '../components/CloakBrowserView';

export default function RedditBrowser() {
  // ... existing state and hooks ...
  
  const [useCloakManager, setUseCloakManager] = useState(false);
  
  // Auto-detect CloakManager availability
  useEffect(() => {
    async function checkCloakManager() {
      try {
        const response = await fetch('http://127.0.0.1:7331/api/running');
        setUseCloakManager(response.ok);
      } catch {
        setUseCloakManager(false);
      }
    }
    checkCloakManager();
  }, []);
  
  // ... existing component logic ...
  
  return (
    <div style={styles.page}>
      {/* ... existing top bars and controls ... */}
      
      {/* NEW: Choose browser implementation based on CloakManager availability */}
      {!active ? (
        <div className="empty-state">
          <h2>No Reddit account selected</h2>
        </div>
      ) : useCloakManager ? (
        <CloakBrowserView 
          account={active}
          onUrlChange={handleUrlChange}
          onSubmitPage={setOnSubmitPage}
        />
      ) : (
        /* FALLBACK: Original Electron webview implementation */
        <div style={styles.viewportContainer}>
          {tabs.map(t => (
            <webview
              key={`${active.partition_key}-${t.id}`}
              ref={el => { if (el) webviewRefs.current[t.id] = el; }}
              src={t.url}
              partition={`persist:${active.partition_key}`}
              style={{ ...styles.webview, display: t.id === activeTabId ? 'flex' : 'none' }}
              allowpopups="true"
            />
          ))}
        </div>
      )}
      
      {/* ... existing floating buttons and side panels ... */}
    </div>
  );
}
```

---

## CDP Implementation Options

### Option 1: Chrome Remote Interface (Recommended)

**Using `chrome-remote-interface` library:**

```javascript
// npm install chrome-remote-interface
const CDP = require('chrome-remote-interface');

async function connectCloakBrowser(cdpUrl) {
  const client = await CDP({ target: cdpUrl });
  const { Page, Runtime, Input, Network } = client;
  
  // Enable domains
  await Page.enable();
  await Runtime.enable();
  await Network.enable();
  
  // Navigate and capture content
  await Page.navigate({ url: 'https://www.reddit.com' });
  await Page.loadEventFired();
  
  // Execute JavaScript to capture rendered HTML
  const result = await Runtime.evaluate({
    expression: 'document.documentElement.outerHTML'
  });
  
  return result.result.value;
}
```

**Pros:**
- ✅ Well-established library
- ✅ Good documentation
- ✅ Handles CDP protocol complexity
- ✅ Node.js compatible

**Cons:**
- ⚠️ Requires rendering strategy for embedded display
- ⚠️ Need to handle bidirectional communication

### Option 2: Puppeteer Core

**Using `puppeteer-core` library:**

```javascript
// npm install puppeteer-core
const puppeteer = require('puppeteer-core');

async function connectCloakBrowser(cdpUrl) {
  const browser = await puppeteer.connect({
    browserWSEndpoint: cdpUrl
  });
  
  const page = await browser.newPage();
  await page.goto('https://www.reddit.com');
  
  // Get page content
  const content = await page.content();
  
  // Interact with page
  await page.click('#selector');
  
  return page;
}
```

**Pros:**
- ✅ High-level API
- ✅ Good documentation
- ✅ Handles complex CDP operations
- ✅ Page management built-in

**Cons:**
- ⚠️ Heavier dependency
- ⚠️ May have headless conflicts with CloakBrowser

### Option 3: WebSocket Proxy (Lightweight)

**Direct WebSocket CDP proxying:**

```javascript
// Use Oserus as CDP proxy - let browser handle rendering
async function proxyCDPConnection(cdpUrl, container) {
  // Create iframe that connects to CloakBrowser via CDP
  // This requires CloakBrowser to expose HTTP endpoint alongside CDP
  
  const iframe = document.createElement('iframe');
  iframe.src = `http://127.0.0.1:${extractPort(cdpUrl)}/`;
  iframe.style.width = '100%';
  iframe.style.height = '100%';
  iframe.style.border = 'none';
  
  container.appendChild(iframe);
}
```

**Pros:**
- ✅ Lightweight - no additional dependencies
- ✅ Native browser rendering
- ✅ Full browser feature support

**Cons:**
- ⚠️ Requires CloakBrowser HTTP endpoint exposure
- ⚠️ Security considerations
- ⚠️ Cross-origin restrictions

---

## Integration Flow & Behavior Analysis

### 1. Account Selection Flow

**User Action:** Select Reddit account in AccountSwitcher

```javascript
// 1. User selects account
setActive(accountId);

// 2. ActiveAccount context triggers
useEffect(() => {
  if (accountId) {
    window.api.session.prepareForAccount({ accountId });
  }
}, [accountId]);

// 3. Main process prepares session (MODIFIED)
async function prepareSessionForAccount(accountId) {
  const account = getAccount(accountId);
  
  // Check CloakManager availability
  const cloakAvailable = await testCloakManagerConnection();
  
  if (cloakAvailable) {
    // Launch CloakManager profile with headless + CDP
    const profileName = `${account.platform}-${account.username}`;
    const response = await fetch(`http://127.0.0.1:7331/api/profiles/launch`, {
      method: 'POST',
      body: JSON.stringify({
        name: profileName,
        proxy: buildProxyConfig(account.proxy),
        headless: true,  // NEW: Headless mode
        cdp_port: null   // NEW: Auto-allocate CDP port
      })
    });
    
    const data = await response.json();
    return {
      ok: true,
      useCloakManager: true,
      cdpUrl: data.cdp_url,
      profileName: profileName,
      fingerprint: data.fp_seed
    };
  } else {
    // Fall back to Electron session
    return prepareElectronSession(account);
  }
}

// 4. Renderer receives session info
const sessionResult = await window.api.session.prepareForAccount({ accountId });

// 5. Render appropriate browser component
{sessionResult.useCloakManager ? (
  <CloakBrowserView cdpUrl={sessionResult.cdpUrl} account={active} />
) : (
  <webview partition={`persist:${sessionResult.partitionKey}`} src={url} />
)}
```

### 2. Browser Launch Sequence

**CloakManager Side (Headless Launch):**

```python
# 1. Receive launch request from Oserus
@router.post("/api/profiles/{name}/launch")
async def launch_profile(name: str, headless: bool = True, cdp_port: Optional[int] = None):
    
    # 2. Allocate CDP port if not specified
    if cdp_port is None and headless:
        cdp_port = await cdp_port_manager.allocate_port(name)
    
    # 3. Launch CloakBrowser in headless mode
    context, pseudo_pid, detected = await launch_browser_context(
        profile_path=profile_path,
        config=profile_config,
        proxy_config=proxy_config,
        headless=True,        # NEW: Headless mode
        cdp_port=cdp_port     # NEW: CDP endpoint
    )
    
    # 4. Start CDP monitoring
    if headless:
        await cdp_monitor.start_monitoring(name, cdp_port)
    
    # 5. Return CDP connection info
    return {
        "ok": True,
        "pid": pseudo_pid,
        "cdp_url": f"ws://127.0.0.1:{cdp_port}",
        "fp_seed": fp_seed_for(name),
        "headless": True
    }
```

**Oserus Side (CDP Connection):**

```javascript
// 6. Receive CDP URL from CloakManager
const { cdpUrl } = launchResponse;

// 7. Connect to CloakBrowser via CDP
const client = await CDP({ target: cdpUrl });
const { Page, Runtime, Input, Network } = client;

// 8. Enable required domains
await Page.enable();
await Runtime.enable();
await Network.enable();

// 9. Navigate to Reddit
await Page.navigate({ url: 'https://www.reddit.com' });
await Page.loadEventFired();

// 10. Embed in Oserus UI
// (Implementation depends on chosen CDP rendering strategy)
```

### 3. User Interaction Flow

**User clicks link in embedded browser:**

```javascript
// 1. User clicks link in CloakBrowser embedded view
// 2. CDP client captures click event
client.on('Page.frameNavigated', ({ frame }) => {
  const url = frame.url;
  
  // 3. Update Oserus UI
  setInputUrl(url);
  setTabs(prev => prev.map(t => 
    t.id === activeTabId ? { ...t, currentUrl: url } : t
  ));
  
  // 4. Check if on submit page
  if (isSubmitPage(url)) {
    setShowFloatingButtons(true);
  }
});

// 5. CDP interactions are bidirectional
await Input.click({ selector: '#link-selector' });
```

### 4. Multi-Tab Management

**User opens new tab:**

```javascript
// 1. User clicks "+" button
function newTab() {
  const newTab = makeTab('https://www.reddit.com/');
  setTabs([...tabs, newTab]);
  setActiveTabId(newTab.id);
}

// 2. Switch to new tab
useEffect(() => {
  if (activeTabId) {
    // 3. For CloakManager: create new CDP page target
    if (useCloakManager) {
      const cdpClient = getCdpClientForTab(activeTabId);
      const { Page } = cdpClient;
      
      // Create new page in same browser context
      const newPage = await cdpClient.createPage();
      await Page.navigate({ url: 'https://www.reddit.com' });
      
      setCdpClientForTab(activeTabId, newPage);
    } else {
      // For Electron: webview handles new tabs automatically
      webviewRefs.current[activeTabId].src = 'https://www.reddit.com/';
    }
  }
}, [activeTabId]);
```

### 5. Account Switching Flow

**User switches to different Reddit account:**

```javascript
// 1. User selects different account in AccountSwitcher
setActive(newAccountId);

// 2. Previous CloakBrowser profile continues running
// (Background - keeps session alive)

// 3. Launch new CloakBrowser profile for new account
const newProfileName = `${newAccount.platform}-${newAccount.username}`;
const response = await window.api.cloakmanager.launch({
  accountName: newProfileName,
  proxy: newAccount.proxy,
  headless: true
});

// 4. Connect to new CDP endpoint
const newCdpClient = await connectCDPEmbed(response.cdp_url, containerRef.current);

// 5. User sees new account with unique fingerprint
// Previous account stays active in background
```

### 6. Cleanup & Shutdown Flow

**User closes Oserus application:**

```javascript
// 1. App quit triggered
app.on('before-quit', async () => {
  // 2. Stop all running CloakManager profiles
  const running = await window.api.cloakmanager.running();
  
  for (const profile of running.running) {
    await window.api.cloakmanager.stop({ accountName: profile.name });
  }
  
  // 3. CloakManager contexts close
  // 4. CDP connections terminate
  // 5. Application exits cleanly
});
```

---

## Error Handling & Fallbacks

### Connection Testing

```javascript
async function testCloakManagerConnection() {
  try {
    const response = await fetch('http://127.0.0.1:7331/api/running', {
      method: 'GET',
      signal: AbortSignal.timeout(2000)  // 2 second timeout
    });
    return response.ok;
  } catch (error) {
    console.log('CloakManager unavailable:', error.message);
    return false;
  }
}
```

### Graceful Degradation

```javascript
async function prepareSessionWithFallback(account) {
  // Try CloakManager first
  const cloakAvailable = await testCloakManagerConnection();
  
  if (cloakAvailable) {
    try {
      const cloakResult = await launchCloakProfile(account);
      if (cloakResult.ok) {
        return {
          ok: true,
          useCloakManager: true,
          cdpUrl: cloakResult.cdp_url,
          fingerprint: cloakResult.fp_seed
        };
      }
    } catch (error) {
      console.log('CloakManager launch failed, falling back:', error.message);
    }
  }
  
  // Fall back to current Electron session approach
  return prepareElectronSession(account);
}
```

### CDP Connection Recovery

```javascript
class CDPCluster {
  constructor(cdpUrl) {
    this.cdpUrl = cdpUrl;
    this.client = null;
    this.reconnectAttempts = 0;
    this.maxReconnects = 3;
  }
  
  async connect() {
    try {
      this.client = await CDP({ target: this.cdpUrl });
      this.reconnectAttempts = 0;
      return this.client;
    } catch (error) {
      if (this.reconnectAttempts < this.maxReconnects) {
        this.reconnectAttempts++;
        await this.delay(1000 * this.reconnectAttempts);
        return this.connect();
      }
      throw new Error(`CDP connection failed after ${this.maxReconnects} attempts`);
    }
  }
  
  async execute(command, params = {}) {
    if (!this.client) {
      await this.connect();
    }
    
    try {
      return await this.client.send(command, params);
    } catch (error) {
      if (error.message.includes('disconnect')) {
        await this.connect();
        return await this.client.send(command, params);
      }
      throw error;
    }
  }
  
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

### User Error Messages

```javascript
if (cdpState.error) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
      <div style={{ textAlign: 'center', gap: 16 }}>
        <div style={{ fontSize: 32 }}>⚠️</div>
        <div style={{ fontWeight: 500 }}>Secure Browser Unavailable</div>
        <div className="dim" style={{ fontSize: 12 }}>
          {cdpState.error}
        </div>
        <button onClick={() => window.location.reload()}>
          Try Again
        </button>
        <button onClick={() => setUseCloakManager(false)} className="ghost">
          Use Standard Browser
        </button>
      </div>
    </div>
  );
}
```

---

## Performance & Resource Management

### CDP Connection Pooling

```javascript
// Manage multiple CDP connections efficiently
class CDPConnectionPool {
  constructor() {
    this.connections = new Map(); // accountId -> CDP client
    this.maxConnections = 10;
  }
  
  async acquire(accountId, cdpUrl) {
    if (this.connections.has(accountId)) {
      return this.connections.get(accountId);
    }
    
    if (this.connections.size >= this.maxConnections) {
      // Close least recently used connection
      const [lruId] = this.connections.keys();
      await this.release(lruId);
    }
    
    const client = await this.createConnection(cdpUrl);
    this.connections.set(accountId, client);
    return client;
  }
  
  async release(accountId) {
    const client = this.connections.get(accountId);
    if (client) {
      await client.close();
      this.connections.delete(accountId);
    }
  }
  
  async createConnection(cdpUrl) {
    const CDP = require('chrome-remote-interface');
    return await CDP({ target: cdpUrl });
  }
}
```

### Memory Management

```javascript
// Cleanup on component unmount
useEffect(() => {
  const cdpClient = useRef(null);
  
  async function initCDP() {
    cdpClient.current = await connectCDP(cdpUrl);
  }
  
  initCDP();
  
  return () => {
    // Cleanup CDP connection on unmount
    if (cdpClient.current) {
      cdpClient.current.close();
    }
  };
}, [cdpUrl]);
```

### Resource Monitoring

```javascript
// Monitor CloakManager resource usage
async function getCloakManagerStatus() {
  try {
    const response = await fetch('http://127.0.0.1:7331/api/system/status');
    const status = await response.json();
    
    return {
      memory: status.memory_mb,
      cpu: status.cpu_percent,
      runningProfiles: status.running_count
    };
  } catch (error) {
    return null;
  }
}

// Display in Oserus UI
setInterval(async () => {
  const status = await getCloakManagerStatus();
  if (status && status.runningProfiles > 20) {
    console.warn('High CloakManager load:', status);
  }
}, 30000); // Check every 30 seconds
```

---

## Deployment & Build Process

### Development Setup

```bash
# Terminal 1: Start CloakManager backend
cd /home/gee/Projects/cloakmanager-app/backend
./backend --port 7331

# Terminal 2: Start Oserus Management  
cd /home/gee/Projects/Oserus-reddit
npm run dev
```

### Production Build

```bash
# 1. Build CloakManager backend with headless support
cd /home/gee/Projects/cloakmanager-app/backend
python -m nuitka --standalone --enable-plugin=puppeteer-app app.py

# 2. Copy binary to Oserus build resources
cp backend/dist/backend.bin /home/gee/Projects/Oserus-reddit/build/cloakmanager-backend

# 3. Build Oserus Management
cd /home/gee/Projects/Oserus-reddit
npm run build

# 4. Electron-builder packages both together
# Output: Oserus-Management-Setup-{version}.exe (~85MB total)
```

### Package.json Scripts

```json
{
  "scripts": {
    "dev": "concurrently \"npm run dev:vite\" \"npm run dev:electron\"",
    "dev:cloakmanager": "cd ../cloakmanager-app/backend && ./backend --port 7331",
    "dev:all": "concurrently \"npm run dev:cloakmanager\" \"npm run dev\"",
    "build": "npm run build:renderer && electron-builder",
    "build:with-cloak": "npm run build:renderer && npm run bundle:cloakmanager && electron-builder",
    "bundle:cloakmanager": "cd ../cloakmanager-app/backend && python build.py && cp dist/backend.bin ../Oserus-reddit/build/"
  }
}
```

### Auto-start Configuration

```javascript
// src/main/index.js - Auto-start CloakManager
const { spawn } = require('child_process');
const path = require('path');

let cloakManagerProcess = null;

function startCloakManager() {
  // Check if running in development or production
  const isDev = !app.isPackaged;
  
  if (isDev) {
    // Development: Assume CloakManager already running
    console.log('Development mode: CloakManager should be started separately');
    return;
  }
  
  // Production: Auto-start CloakManager backend
  const cloakBinaryPath = path.join(
    process.resourcesPath, 
    'cloakmanager', 
    'backend'
  );
  
  try {
    cloakManagerProcess = spawn(cloakBinaryPath, ['--port', '7331'], {
      stdio: 'ignore',
      detached: true
    });
    
    cloakManagerProcess.on('error', (err) => {
      console.log('CloakManager not available:', err.message);
    });
    
    cloakManagerProcess.on('exit', (code) => {
      console.log(`CloakManager exited with code ${code}`);
      // Optionally restart
    });
    
    console.log('CloakManager started successfully');
  } catch (error) {
    console.log('Failed to start CloakManager:', error.message);
  }
}

function stopCloakManager() {
  if (cloakManagerProcess) {
    cloakManagerProcess.kill();
    cloakManagerProcess = null;
  }
}

app.whenReady().then(() => {
  startCloakManager();
  // ... rest of initialization
});

app.on('before-quit', () => {
  stopCloakManager();
});
```

---

## Testing & Validation

### Integration Testing

```javascript
// Test CloakManager connectivity
async function testIntegration() {
  const tests = [];
  
  // Test 1: CloakManager availability
  tests.push({
    name: 'CloakManager API',
    test: async () => {
      const response = await fetch('http://127.0.0.1:7331/api/running');
      return response.ok ? 'PASS' : 'FAIL';
    }
  });
  
  // Test 2: Profile creation
  tests.push({
    name: 'Profile creation',
    test: async () => {
      const response = await fetch('http://127.0.0.1:7331/api/profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'test-integration-profile',
          os: 'windows'
        })
      });
      return response.ok ? 'PASS' : 'FAIL';
    }
  });
  
  // Test 3: Headless launch
  tests.push({
    name: 'Headless launch',
    test: async () => {
      const response = await fetch('http://127.0.0.1:7331/api/profiles/test-integration-profile/launch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          headless: true
        })
      });
      const data = await response.json();
      return data.ok && data.cdp_url ? 'PASS' : 'FAIL';
    }
  });
  
  // Test 4: CDP connection
  tests.push({
    name: 'CDP connection',
    test: async () => {
      const CDP = require('chrome-remote-interface');
      const client = await CDP({ target: 'ws://127.0.0.1:9222' });
      await client.close();
      return 'PASS';
    }
  });
  
  // Run all tests
  for (const test of tests) {
    try {
      const result = await test.test();
      console.log(`${result}: ${test.name}`);
    } catch (error) {
      console.log(`FAIL: ${test.name} - ${error.message}`);
    }
  }
  
  // Cleanup
  await fetch('http://127.0.0.1:7331/api/profiles/test-integration-profile/stop', {
    method: 'POST'
  });
}
```

### Fingerprint Validation

```javascript
// Validate that different accounts have different fingerprints
async function validateFingerprints() {
  const accounts = ['LunaMain', 'MiaBackup', 'LunaAlt'];
  const fingerprints = new Set();
  
  for (const account of accounts) {
    const response = await fetch(`http://127.0.0.1:7331/api/profiles/reddit-${account}/launch`, {
      method: 'POST',
      body: JSON.stringify({ headless: true })
    });
    
    const data = await response.json();
    fingerprints.add(data.fp_seed);
    
    // Stop profile after validation
    await fetch(`http://127.0.0.1:7331/api/profiles/reddit-${account}/stop`, {
      method: 'POST'
    });
  }
  
  // All fingerprints should be unique
  if (fingerprints.size === accounts.length) {
    console.log('✅ All fingerprints are unique');
  } else {
    console.log('❌ Duplicate fingerprints detected!');
  }
}
```

---

## Summary & Benefits

### What Oserus Management Gains

✅ **Unique browser fingerprints per Reddit account**  
✅ **Platform spoofing (Windows/macOS/Linux)**  
✅ **Canvas/WebGL/Audio randomization**  
✅ **WebRTC leak prevention**  
✅ **Professional-grade anti-detection**  
✅ **Maintains all existing business logic**  
✅ **Zero user interface changes**  
✅ **No source code exposure**  
✅ **Independent development cycles**  

### What CloakManager Provides

🔹 **Compiled binary backend** (~77MB)  
🔹 **Headless browser mode** (NEW requirement)  
🔹 **CDP endpoint allocation** (NEW requirement)  
🔹 **REST API interface** (enhanced with headless support)  
🔹 **Deterministic fingerprint generation**  
🔹 **Proxy management + testing**  

### Integration Effort

**CloakManager Backend Modifications:**
- Add `headless` parameter to launch endpoint
- Implement CDP port allocation system
- Modify launcher for headless mode
- Add CDP proxy endpoint (optional)

**Oserus Management Changes:**
- Add CloakBrowserView component
- Implement CDP client connection
- Modify RedditBrowser to use CloakManager when available
- Add fallback to Electron webview

**Code Changes:** ~250 lines across 6 files  
**Development Time:** 2-3 days  
**Testing Time:** 3-4 days  
**Deployment:** Bundle binary or run as sidecar  

### Result

Professional-grade Reddit account management with enterprise-level fingerprinting capabilities while maintaining Oserus Management's exact current user experience, workflow, and feature set. Users see zero changes while gaining maximum operational security.

---

**Next Steps:**
1. Implement CloakManager headless mode support
2. Add CDP port allocation system
3. Create Oserus CloakBrowserView component
4. Implement CDP client connection
5. Test integration with multiple accounts
6. Deploy with bundled binary or sidecar option