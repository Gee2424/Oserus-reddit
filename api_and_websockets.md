# CloakBrowser Manager - Frontend API Guide

Complete API documentation for frontend developers integrating with CloakBrowser Manager.

**API Version:** 11.0 (FastAPI)
**Backend:** Python FastAPI + SQLite
**Base URL:** `http://127.0.0.1:7331/api` (dev) or dynamic port (production)
**Documentation Status:** Includes all 66 API endpoints + 33 WebSocket events (99 total)

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Authentication](#authentication)
3. [API Configuration](#api-configuration)
4. [Endpoint Testing Status](#endpoint-testing-status)
5. [WebSocket Real-Time Events](#websocket-real-time-events)
6. [System Endpoints](#system-endpoints)
7. [Profile Endpoints](#profile-endpoints)
8. [Proxy Endpoints](#proxy-endpoints)
9. [Folder Endpoints](#folder-endpoints)
10. [Template Endpoints](#template-endpoints)
11. [Extension Endpoints](#extension-endpoints)
12. [Page Visibility Optimization](#page-visibility-optimization)
13. [CORS Considerations](#cors-considerations)
14. [Data Models](#data-models)
15. [Special Behaviors](#special-behaviors)
16. [Error Handling](#error-handling)
17. [Frontend Integration Patterns](#frontend-integration-patterns)
18. [JavaScript Code Examples](#javascript-code-examples)
19. [Reference Tables](#reference-tables)
20. [Testing & Debugging](#testing--debugging)

---

## Quick Start

### Your First API Call

```javascript
// Set up API base URL
const API = 'http://127.0.0.1:7331/api';

// Simple fetch wrapper
async function api(path, options = {}) {
    const o = {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...options?.headers,
        },
    };
    const r = await fetch(`${API}/${path}`, o);
    if (!r.ok) {
        const err = await r.text();
        throw new Error(err || `API error: ${r.status}`);
    }
    return r.json();
}

// Get all profiles
const profiles = await api('profiles');
console.log(profiles);
```

### Architecture Overview

```
┌─────────────────────────────────────────┐
│   Frontend (Vanilla JS/React/etc)      │  ← You are here
└──────────────┬──────────────────────────┘
               │ HTTP/JSON
               ▼
┌─────────────────────────────────────────┐
│   FastAPI Backend (port 7331/dynamic)   │
│   └─ Profiles API (27 endpoints)       │
│   └─ Proxies API (6 endpoints)         │
│   └─ Folders API (5 endpoints)         │
│   └─ Templates API (4 endpoints)       │
│   └─ Extensions API (10 endpoints)     │
│   └─ System API (4 endpoints)          │
│   └─ Worker API (5 endpoints)          │
│   └─ License API (4 endpoints)        │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│   SQLite Database + CloakBrowser        │
└─────────────────────────────────────────┘
```

**Total: 66 API endpoints + 33 WebSocket events (99 total - all documented)**

---

## Authentication

### Optional Bearer Token

Authentication is **optional** and controlled by the `CLOAKMANAGER_API_TOKEN` environment variable.

**When token is set:**
```javascript
const TOKEN = 'your-token-here';

async function api(path, options = {}) {
    const o = {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${TOKEN}`,
            ...options?.headers,
        },
    };
    const r = await fetch(`${API}/${path}`, o);
    if (!r.status === 401) {
        throw new Error('Unauthorized');
    }
    // ... rest of handling
}
```

**When token is NOT set:**
- No `Authorization` header needed
- All endpoints are publicly accessible (localhost only)

---

## API Configuration

### Base URL Detection

```javascript
// Detect port from current URL (for production dynamic ports)
let BACKEND_PORT = 7331;
let API = `http://127.0.0.1:${BACKEND_PORT}/api`;

function detectBackendPort() {
    const currentUrl = new URL(window.location.href);
    if (currentUrl.port && currentUrl.port !== '7331') {
        BACKEND_PORT = currentUrl.port;
        API = `http://127.0.0.1:${BACKEND_PORT}/api`;
    }
}

detectBackendPort();
```

### Environment-Specific Configuration

| Environment | Base URL | Port | Notes |
|------------|----------|------|-------|
| Development | `http://127.0.0.1:7331/api` | Fixed 7331 | Backend runs separately |
| Production | `http://127.0.0.1:{dynamic}/api` | Dynamic | Tauri allocates available port |

---

## Endpoint Testing Status

This documentation includes all endpoints, including those not yet tested in production.

### Status Indicators

| Symbol | Status | Description |
|--------|--------|-------------|
| ✅ | Tested | Endpoint has been tested and verified working |
| ⚠️ | Not Tested | Endpoint exists but has not been tested in production |
| ⭐ | Important | Critical endpoint with special behaviors |

### Untested Endpoints

The following endpoints have not been tested but are expected to work based on code inspection:

**Extensions (5 endpoints):**
- `POST /api/extensions` - Upload extension (CRX file)
- `DELETE /api/extensions/{ext_id}` - Delete extension
- `GET /api/extensions/{ext_id}/icon` - Get extension icon
- `POST /api/extensions/import-from-store` - Import from Chrome Web Store
- `POST /api/profiles/{name}/extensions/{ext_id}` - Add extension to profile
- `DELETE /api/profiles/{name}/extensions/{ext_id}` - Remove extension from profile

**System (2 endpoints):**
- `GET /api/system/check-updates` - Check for CloakBrowser updates
- `POST /api/system/clear-cache` - Clear CloakBrowser cache

**Batch Operations (1 endpoint):**
- `POST /api/profiles/batch/proxy` - Assign proxy to multiple profiles

**Note:** Use these endpoints with caution and test thoroughly before production use.

---

## WebSocket Real-Time Events

### Overview

WebSocket provides real-time updates for profile lifecycle events, eliminating the need for HTTP polling. Use WebSocket to receive instant notifications when profiles are launched, stopped, or crash.

**Benefits:**
- Real-time feedback during profile launch (no 15-second black hole)
- Instant crash detection notifications
- Reduced server load (no constant HTTP polling)
- Progress visibility through launch stages

**WebSocket Endpoint:**
```
ws://127.0.0.1:7331/ws/{client_id}
```

### Connection Management

#### Connect to WebSocket

```javascript
let ws = null;
let wsReconnectInterval = null;
let wsClientId = null;

function connectWebSocket() {
    // Generate unique client ID
    wsClientId = 'client_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    
    // Determine WebSocket protocol
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/${wsClientId}`;
    
    ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
        console.log('[WS] Connected');
        // Clear reconnect interval if exists
        if (wsReconnectInterval) {
            clearInterval(wsReconnectInterval);
            wsReconnectInterval = null;
        }
    };
    
    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleWebSocketEvent(data);
    };
    
    ws.onclose = () => {
        console.log('[WS] Disconnected, reconnecting in 3s...');
        wsReconnectInterval = setInterval(connectWebSocket, 3000);
    };
    
    ws.onerror = (error) => {
        console.error('[WS] Error:', error);
    };
}

// Connect on page load
connectWebSocket();
```

#### Disconnect WebSocket

```javascript
function disconnectWebSocket() {
    if (wsReconnectInterval) {
        clearInterval(wsReconnectInterval);
        wsReconnectInterval = null;
    }
    if (ws) {
        ws.close();
        ws = null;
    }
}

// Disconnect on page unload
window.addEventListener('beforeunload', disconnectWebSocket);
```

### Event Types

#### Connected

Sent when WebSocket connection is established.

```json
{
    "type": "connected",
    "client_id": "client_1715147890123_abc123",
    "timestamp": "2026-05-08T12:34:56.789Z"
}
```

#### Launch Progress

Sent at each stage of profile launch. Stages include:
- `proxy_test` - Testing proxy connectivity (if proxy assigned)
- `proxy_test_complete` - Proxy test finished (includes test results)
- `initializing` - Launch initialization
- `launching_browser` - Browser process starting
- `downloading_browser` - CloakBrowser binary download (if needed, first launch or update)
- `complete` - Launch finished successfully

**Proxy Test Stages (if proxy assigned):**

```json
{
    "type": "launch_progress",
    "profile": "my-profile",
    "stage": "proxy_test",
    "message": "Testing proxy connectivity..."
}
```

```json
{
    "type": "launch_progress",
    "profile": "my-profile",
    "stage": "proxy_test_complete",
    "data": {
        "ok": true,
        "ip": "203.0.113.42",
        "ms": 145
    }
}
```

**Initialization and Browser Launch Stages:**

```json
{
    "type": "launch_progress",
    "profile": "my-profile",
    "stage": "initializing",
    "message": "Initializing browser launch...",
    "data": {}
}
```

**Binary Download Stage (when CloakBrowser needs to be downloaded):**

```json
{
    "type": "launch_progress",
    "profile": "my-profile",
    "stage": "downloading_browser",
    "message": "Downloading CloakBrowser: 45%",
    "data": {
        "percent": 45,
        "current_mb": 95,
        "total_mb": 210
    }
}
```

**Complete Stage:**

```json
{
    "type": "launch_progress",
    "profile": "my-profile",
    "stage": "complete",
    "message": "Browser launched successfully",
    "data": {
        "pid": 12345,
        "timestamp": "2026-06-14T12:34:56.789Z",
        "cdp_port": 44861,
        "cdp_url": "http://127.0.0.1:44861",
        "cdp_ws_url": null
    }
}
```

**CDP Information:** The `complete` stage now includes basic CDP connection information (`cdp_port` and `cdp_url`). The `cdp_ws_url` is sent later via the `cdp_ready` event once the WebSocket URL is discovered.

**Note:** The `downloading_browser` stage is only sent when CloakBrowser binary needs to be downloaded (first launch or when an update is available). The `data` object includes `percent`, `current_mb`, and `total_mb` for download progress tracking.

#### Profile Crashed

Sent when profile crashes during launch or runtime.

```json
{
    "type": "profile_crashed",
    "profile": "my-profile",
    "data": {
        "exit_code": 1,
        "stderr": "error message...",
        "timestamp": "2026-05-08T12:34:56.789Z"
    }
}
```

#### Profile Stopped

Sent when profile stops (either manually or crashed).

```json
{
    "type": "profile_stopped",
    "profile": "my-profile",
    "data": {
        "exit_code": 0,
        "crashed": false,
        "timestamp": "2026-05-08T12:34:56.789Z"
    }
}
```

#### Stop Start

Sent when profile stop is initiated.

```json
{
    "type": "stop_start",
    "profile": "my-profile",
    "timestamp": "2026-05-08T12:34:56.789Z"
}
```

#### Stop Progress 🆕

The `stop_progress` event is sent during the profile stop operation to provide real-time feedback on the termination stages. This event complements the `stop_start` event by providing granular progress updates as the browser process is being terminated.

##### When It's Triggered

This event is sent at each stage of the profile stop process:
1. When the graceful termination (SIGTERM) is initiated
2. When the browser doesn't respond to SIGTERM and force kill (SIGKILL) is required

##### Event Structure

```json
{
    "type": "stop_progress",
    "profile": "my-profile",
    "stage": "terminating",
    "message": "Stopping browser...",
    "data": {
        "pid": 12345
    }
}
```

##### Data Fields

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | Event type identifier (always `"stop_progress"`) |
| `profile` | string | Name of the profile being stopped |
| `stage` | string | Current stage of the stop operation (see stages below) |
| `message` | string | Human-readable progress message |
| `data.pid` | number | Process ID of the browser being terminated |

##### Stop Stages

###### `terminating`
The browser is being gracefully terminated using SIGTERM. The system waits up to 5 seconds for the browser to shut down cleanly.

**Example:**
```json
{
    "type": "stop_progress",
    "profile": "my-profile",
    "stage": "terminating",
    "message": "Stopping browser...",
    "data": {
        "pid": 12345
    }
}
```

###### `killing`
The browser did not respond to graceful termination within 5 seconds, so the system is force-killing it using SIGKILL. This stage only occurs if the browser is unresponsive or hung.

**Example:**
```json
{
    "type": "stop_progress",
    "profile": "my-profile",
    "stage": "killing",
    "message": "Force killing browser...",
    "data": {
        "pid": 12345
    }
}
```

##### How It Differs from stop_start

| Aspect | stop_start | stop_progress |
|--------|-----------|---------------|
| **Purpose** | Signals that stop operation has begun | Provides detailed progress updates during stop |
| **Timing** | Sent once at the beginning | Sent multiple times as stages complete |
| **Data Content** | No process data | Includes PID and stage-specific information |
| **Stage Information** | None | Indicates current termination stage |
| **Message Content** | Generic "stop initiated" | Specific to current stage (terminating/killing) |

##### Typical Event Flow

When stopping a profile, the WebSocket events flow in this order:

1. **stop_start** - Stop operation initiated
   ```json
   {
       "type": "stop_start",
       "profile": "my-profile",
       "timestamp": "2026-05-09T12:34:56.789Z"
   }
   ```

2. **stop_progress** (terminating) - Graceful termination started
   ```json
   {
       "type": "stop_progress",
       "profile": "my-profile",
       "stage": "terminating",
       "message": "Stopping browser...",
       "data": {"pid": 12345}
   }
   ```

3. **stop_progress** (killing) - Only if browser didn't terminate gracefully
   ```json
   {
       "type": "stop_progress",
       "profile": "my-profile",
       "stage": "killing",
       "message": "Force killing browser...",
       "data": {"pid": 12345}
   }
   ```

4. **profile_stopped** - Stop operation completed
   ```json
   {
       "type": "profile_stopped",
       "profile": "my-profile",
       "data": {
           "timestamp": "2026-05-09T12:34:57.789Z",
           "crashed": false
       }
   }
   ```

##### Frontend Integration Example

```javascript
function handleWebSocketEvent(data) {
    switch (data.type) {
        case 'stop_start':
            showStopProgress(data.profile);
            break;

        case 'stop_progress':
            updateStopProgress(data.profile, data.stage, data.message, data.data);
            break;

        case 'profile_stopped':
            hideStopProgress(data.profile);
            showRunningBadge(data.profile, false);
            showToast(`${data.profile} stopped`, 'info');
            break;
    }
}

function showStopProgress(profileName) {
    // Create or show stop progress modal
    const modal = document.getElementById('stop-modal');
    const profileNameEl = document.getElementById('stop-profile-name');
    const progressStages = document.getElementById('stop-stages');
    
    profileNameEl.textContent = profileName;
    progressStages.innerHTML = `
        <div class="stage" data-stage="terminating">Stopping browser...</div>
        <div class="stage" data-stage="killing" style="display:none">Force killing...</div>
    `;
    
    modal.classList.remove('hidden');
}

function updateStopProgress(profileName, stage, message, data) {
    // Update stage indicator
    const stageEl = document.querySelector(`[data-stage="${stage}"]`);
    if (stageEl) {
        stageEl.classList.add('active');
        stageEl.style.display = 'block';
        
        if (data && data.pid) {
            stageEl.innerHTML += ` <span class="pid">(PID: ${data.pid})</span>`;
        }
    }
    
    // Update message
    const messageEl = document.getElementById('stop-message');
    if (messageEl) {
        messageEl.textContent = message;
    }
    
    // Show warning if force killing
    if (stage === 'killing') {
        showToast('Browser unresponsive, force killing...', 'warning');
    }
}

function hideStopProgress(profileName) {
    const modal = document.getElementById('stop-modal');
    modal.classList.add('hidden');
}
```

##### Use Cases

1. **User Feedback**: Show users that their stop request is being processed
2. **Troubleshooting**: Identify if browsers are hanging and require force-kills
3. **Performance Monitoring**: Track how often profiles require force termination
4. **UI State Management**: Update UI elements based on stop progress stages

##### Timeout Behavior

- **Terminating Stage**: 5-second timeout for graceful shutdown
- **Killing Stage**: 5-second timeout for force kill after SIGKILL
- **Total Maximum Stop Time**: 10 seconds before the operation is considered failed

##### Related Events

- **stop_start**: Marks the beginning of stop operation
- **profile_stopped**: Marks the completion of stop operation
- **profile_crashed**: Sent if profile crashes during runtime (different from stop)
- **pause_progress**: Similar progress event for pause operation (includes snapshot stage)

##### Error Handling

The `stop_progress` event itself doesn't indicate errors. Errors during stop operation are reported through:
- **profile_crashed**: If the profile crashes (exit code non-zero)
- **profile_stopped**: With crashed=true if termination detected a crash

##### Notes

- The `killing` stage is optional and only occurs when the browser is unresponsive
- The PID in `data.pid` is the process ID of the browser being terminated
- Progress events are sent for both manual stops and automatic stops (e.g., window close detection)
- The event is sent via WebSocket to all connected clients

#### Profile Created

Sent when a new profile is created.

```json
{
    "type": "profile_created",
    "profile": "my-new-profile",
    "data": {
        "os": "windows",
        "timezone": "America/New_York",
        "resolution": "1920x1080",
        "created_at": "2026-05-08T12:34:56.789Z",
        "fp_seed": 54321
    }
}
```

#### Profile Updated

Sent when profile configuration is updated.

```json
{
    "type": "profile_updated",
    "profile": "my-profile",
    "data": {
        "updated_fields": ["os", "timezone", "resolution"],
        "timestamp": "2026-05-08T12:34:56.789Z"
    }
}
```

#### Profile Deleted

Sent when a profile is permanently deleted.

```json
{
    "type": "profile_deleted",
    "profile": "my-profile",
    "timestamp": "2026-05-08T12:34:56.789Z"
}
```

#### Profile Cloned

Sent when a profile is cloned to a new profile.

```json
{
    "type": "profile_cloned",
    "source_profile": "my-profile",
    "new_profile": "my-profile-copy",
    "data": {
        "fp_seed": 54321,
        "timestamp": "2026-05-08T12:34:56.789Z"
    }
}
```

#### Profile Reset

Sent when profile browser data is wiped.

```json
{
    "type": "profile_reset",
    "profile": "my-profile",
    "timestamp": "2026-05-08T12:34:56.789Z"
}
```

#### Folder Created

Sent when a new folder is created.

```json
{
    "type": "folder_created",
    "folder": "folder_1234567890",
    "data": {
        "name": "My Folder",
        "order_index": 0,
        "timestamp": "2026-05-08T12:34:56.789Z"
    }
}
```

#### Folder Updated

Sent when a folder is renamed or reordered.

```json
{
    "type": "folder_updated",
    "folder": "folder_1234567890",
    "data": {
        "name": "Updated Name",
        "order_index": 1,
        "timestamp": "2026-05-08T12:34:56.789Z"
    }
}
```

#### Folder Deleted

Sent when a folder is deleted.

```json
{
    "type": "folder_deleted",
    "folder": "folder_1234567890",
    "timestamp": "2026-05-08T12:34:56.789Z"
}
```

#### Proxy Created

Sent when a new proxy is added.

```json
{
    "type": "proxy_created",
    "proxy": "proxy_1234567890",
    "data": {
        "label": "My Proxy",
        "protocol": "socks5",
        "host": "192.168.1.1",
        "port": "1080",
        "timestamp": "2026-05-08T12:34:56.789Z"
    }
}
```

#### Proxy Updated

Sent when proxy configuration is changed.

```json
{
    "type": "proxy_updated",
    "proxy": "proxy_1234567890",
    "data": {
        "updated_fields": ["label", "host"],
        "timestamp": "2026-05-08T12:34:56.789Z"
    }
}
```

#### Proxy Deleted

Sent when a proxy is removed.

```json
{
    "type": "proxy_deleted",
    "proxy": "proxy_1234567890",
    "timestamp": "2026-05-08T12:34:56.789Z"
}
```

#### Proxy Tested

Sent when a proxy connectivity test completes.

```json
{
    "type": "proxy_tested",
    "proxy": "proxy_1234567890",
    "data": {
        "ok": true,
        "ms": 245,
        "ip": "185.123.45.67",
        "error": null,
        "timestamp": "2026-05-08T12:34:56.789Z"
    }
}
```

#### Pause Start 🆕

Sent when profile pause is initiated.

```json
{
    "type": "pause_start",
    "profile": "my-profile",
    "timestamp": "2026-05-08T12:34:56.789Z"
}
```

#### Pause Progress 🆕

Sent during pause operation stages. Stages include:
- `terminating` - Gracefully stopping browser
- `killing` - Force killing browser (if SIGTERM timeout)

```json
{
    "type": "pause_progress",
    "profile": "my-profile",
    "stage": "terminating",
    "message": "Stopping browser...",
    "data": {
        "pid": 12345
    }
}
```

#### Profile Paused 🆕

Sent when profile pause completes successfully.

```json
{
    "type": "profile_paused",
    "profile": "my-profile",
    "data": {
        "snapshot": "/path/to/profiles/.snapshots/my-profile/snapshot_20260508_123456",
        "timestamp": "2026-05-08T12:34:56.789Z"
    }
}
```

#### Resume Start 🆕

Sent when profile resume is initiated.

```json
{
    "type": "resume_start",
    "profile": "my-profile",
    "timestamp": "2026-05-08T12:34:56.789Z"
}
```

#### Profile Resumed 🆕

Sent when profile resume completes successfully.

```json
{
    "type": "profile_resumed",
    "profile": "my-profile",
    "data": {
        "pid": 12346,
        "timestamp": "2026-05-08T12:34:56.789Z"
    }
}
```

#### Window Closed 🆕

Sent when user closes the browser window (detected via Chrome DevTools Protocol).

```json
{
    "type": "window_closed",
    "profile": "my-profile",
    "data": {
        "timestamp": "2026-05-08T12:34:56.789Z"
    }
}
```

**Note:** This event is sent when the browser window is closed by the user, not when the profile is stopped via API. Use this to update UI from "Running" to "Stopped" state.

#### Browser Crashed 🆕

Sent when browser crashes (detected via Chrome DevTools Protocol).

```json
{
    "type": "browser_crashed",
    "profile": "my-profile",
    "data": {
        "error": "Crashed",
        "timestamp": "2026-05-08T12:34:56.789Z"
    }
}
```

**Note:** This is an additional crash detection mechanism via CDP, separate from the process-based crash detection during launch and health checks.

#### Extension Added 🆕

Sent when a new extension is successfully uploaded or imported.

```json
{
    "type": "extension_added",
    "extension": "ext_123456",
    "data": {
        "name": "uBlock Origin",
        "version": "1.50.0",
        "source": "upload",
        "timestamp": "2026-05-08T12:34:56.789Z"
    }
}
```

**Source values:**
- `upload` - Extension uploaded as CRX file
- `webstore` - Extension imported from Chrome Web Store

---

#### Extension Deleted 🆕

Sent when an extension is deleted.

```json
{
    "type": "extension_deleted",
    "extension": "ext_123456",
    "data": {
        "timestamp": "2026-05-08T12:34:56.789Z"
    }
}
```

---

#### Extension Upload Progress 🆕

Sent during extension file upload (for CRX uploads). Stages include:
- `reading` - Reading uploaded file (10%)
- `validating` - Validating CRX format (20%)
- `extracting` - Extracting CRX contents (40%)
- `parsing_manifest` - Reading extension manifest (60%)
- `saving` - Saving to database (80%)
- `complete` - Upload finished (100%)
- `error` - Upload failed

```json
{
    "type": "extension_upload_progress",
    "extension_id": "ext_123456",
    "data": {
        "stage": "extracting",
        "progress": 40,
        "message": "Extracting CRX contents...",
        "filename": "ublock.crx",
        "timestamp": "2026-05-08T12:34:56.789Z"
    }
}
```

**Use cases:** Display upload progress bar in UI, show current stage, handle errors

---

#### Extension Download Progress 🆕

Sent during extension download from Chrome Web Store. Stages include:
- `fetching_details` - Fetching extension info (0-10%)
- `downloading` - Downloading CRX file (10-60%)
- `validating` - Validating download (60-80%)
- `extracting` - Extracting contents (80-90%)
- `complete` - Download finished (100%)
- `error` - Download failed

```json
{
    "type": "extension_download_progress",
    "extension_id": "ext_123456",
    "data": {
        "stage": "downloading",
        "progress": 35,
        "message": "Downloading 2.5 MB / 7.2 MB",
        "bytes_received": 2621440,
        "total_bytes": 7560400,
        "timestamp": "2026-05-08T12:34:56.789Z"
    }
}
```

**Use cases:** Display download progress with MB counters, show download speed estimate

---

#### Extension Delete Progress 🆕

Sent during extension deletion. Stages include:
- `checking` - Checking for active profiles (20%)
- `removing` - Removing from profiles (40%)
- `deleting` - Deleting files (60%)
- `complete` - Deletion finished (100%)
- `error` - Deletion failed

```json
{
    "type": "extension_delete_progress",
    "extension_id": "ext_123456",
    "data": {
        "stage": "removing",
        "progress": 40,
        "message": "Removing from profiles...",
        "extension_name": "uBlock Origin",
        "timestamp": "2026-05-08T12:34:56.789Z"
    }
}
```

**Use cases:** Show deletion progress, warn if extension is in use by active profiles

---

#### Profile Extension Added 🆕

Sent when an extension is assigned to a profile.

```json
{
    "type": "profile_extension_added",
    "profile": "my-profile",
    "extension": "ext_123456",
    "data": {
        "name": "uBlock Origin"
    },
    "timestamp": "2026-05-08T12:34:56.789Z"
}
```

**Use cases:** Update profile extension list in UI, show notification

---

#### Profile Extension Removed 🆕

Sent when an extension is removed from a profile.

```json
{
    "type": "profile_extension_removed",
    "profile": "my-profile",
    "extension": "ext_123456",
    "data": {
        "timestamp": "2026-05-08T12:34:56.789Z"
    }
}
```

**Use cases:** Update profile extension list in UI, show notification

---

#### Profile Launched 🆕

Sent when profile launch completes successfully (final confirmation).

```json
{
    "type": "profile_launched",
    "profile": "my-profile",
    "data": {
        "pid": 12345,
        "detected_resolution": "1920x1080",
        "timestamp": "2026-05-08T12:34:56.789Z"
    }
}
```

**Note:** This is the definitive launch confirmation event. Use it to update UI to "Running" state.

---

#### CDP Ready 🆕

Sent when Chrome DevTools Protocol WebSocket URL is discovered (after launch complete).

```json
{
    "type": "cdp_ready",
    "profile": "my-profile",
    "data": {
        "cdp_port": 44861,
        "cdp_url": "http://127.0.0.1:44861",
        "cdp_ws_url": "ws://127.0.0.1:44861/devtools/browser/abc123-def456-ghi789",
        "timestamp": "2026-06-14T12:34:56.789Z"
    }
}
```

**Use cases:**
- Display CDP connection information in UI without additional API calls
- Enable external tool connection buttons immediately
- Update profile detail view with CDP information

**Event flow timing:**
1. `launch_progress` (complete) - basic launch success with PID
2. `profile_launched` - final confirmation
3. `cdp_ready` - CDP WebSocket URL discovered (usually 100-500ms after launch)

**Note:** If CDP discovery fails, this event is not sent. Frontend should fall back to calling `/api/profiles/{name}/cdp` endpoint.

---

#### Stop Complete 🆕

Sent when stop operation completes (before final `profile_stopped` event).

```json
{
    "type": "stop_complete",
    "profile": "my-profile",
    "data": {
        "pid": 12345,
        "timestamp": "2026-05-08T12:34:56.789Z"
    }
}
```

**Event flow:** `stop_start` → `stop_progress` → `stop_complete` → `profile_stopped`

**Use cases:** Intermediate confirmation that stop succeeded, before final cleanup

---

### Event Handler Example

```javascript
function handleWebSocketEvent(data) {
    switch (data.type) {
        case 'connected':
            console.log('[WS] Client ID:', data.client_id);
            break;

        case 'launch_progress':
            // Handle all launch stages (initializing, launching_browser, complete)
            if (data.stage === 'initializing' || data.stage === 'launching_browser') {
                showLaunchProgress(data.profile);
            }
            updateLaunchProgress(
                data.profile,
                data.stage,
                data.message,
                data.data
            );
            break;

        case 'profile_launched':
            hideLaunchProgress(data.profile);
            showRunningBadge(data.profile, true);
            showToast(`${data.profile} launched (PID: ${data.data.pid})`, 'success');
            break;

        case 'profile_crashed':
            hideLaunchProgress(data.profile);
            showCrashDialog(data.profile, data.data);
            showRunningBadge(data.profile, false);
            break;

        case 'profile_stopped':
            showRunningBadge(data.profile, false);
            if (data.data.crashed) {
                showToast(`${data.profile} crashed (exit code: ${data.data.exit_code})`, 'error');
            }
            break;

        case 'stop_start':
            showStopProgress(data.profile);
            break;

        case 'stop_progress':
            updateStopProgress(data.profile, data.stage, data.message);
            break;

        case 'profile_created':
            showToast(`Profile ${data.profile} created`, 'success');
            refreshProfileList();
            break;

        case 'profile_updated':
            showToast(`Profile ${data.profile} updated`, 'info');
            refreshProfileList();
            break;

        case 'profile_deleted':
            showToast(`Profile ${data.profile} deleted`, 'info');
            refreshProfileList();
            break;

        case 'profile_cloned':
            showToast(`Cloned ${data.source_profile} to ${data.new_profile}`, 'success');
            refreshProfileList();
            break;

        case 'profile_reset':
            showToast(`Profile ${data.profile} data wiped`, 'info');
            break;

        case 'folder_created':
        case 'folder_updated':
        case 'folder_deleted':
            refreshFolderList();
            break;

        case 'proxy_created':
        case 'proxy_updated':
        case 'proxy_deleted':
            refreshProxyList();
            break;

        case 'proxy_tested':
            updateProxyTestResult(data.proxy, data.data);
            break;

        case 'pause_start':
            showPauseProgress(data.profile);
            break;

        case 'pause_progress':
            updatePauseProgress(data.profile, data.stage, data.message);
            break;

        case 'profile_paused':
            hidePauseProgress(data.profile);
            showPausedBadge(data.profile, true);
            showToast(`${data.profile} paused`, 'info');
            break;

        case 'resume_start':
            showResumeProgress(data.profile);
            break;

        case 'profile_resumed':
            hideResumeProgress(data.profile);
            showPausedBadge(data.profile, false);
            showRunningBadge(data.profile, true);
            showToast(`${data.profile} resumed (PID: ${data.data.pid})`, 'success');
            break;

        case 'window_closed':
            showRunningBadge(data.profile, false);
            showToast(`${data.profile} window closed`, 'info');
            break;

        case 'browser_crashed':
            showRunningBadge(data.profile, false);
            showCrashDialog(data.profile, data.data);
            break;

        case 'extension_added':
            showToast(`Extension "${data.data.name}" added`, 'success');
            refreshExtensionList();
            break;

        case 'extension_deleted':
            showToast(`Extension deleted`, 'info');
            refreshExtensionList();
            break;

        case 'extension_upload_progress':
            updateExtensionUploadProgress(data.extension_id, data.data);
            break;

        case 'extension_download_progress':
            updateExtensionDownloadProgress(data.extension_id, data.data);
            break;

        case 'extension_delete_progress':
            updateExtensionDeleteProgress(data.extension_id, data.data);
            break;

        case 'profile_extension_added':
            showToast(`"${data.data.name}" added to ${data.profile}`, 'success');
            refreshProfileExtensions(data.profile);
            break;

        case 'profile_extension_removed':
            showToast(`Extension removed from ${data.profile}`, 'info');
            refreshProfileExtensions(data.profile);
            break;

        case 'profile_launched':
            hideLaunchProgress(data.profile);
            showRunningBadge(data.profile, true);
            showToast(`${data.profile} launched (PID: ${data.data.pid})`, 'success');
            break;

        case 'stop_complete':
            // Intermediate confirmation before profile_stopped
            console.log(`[WS] ${data.profile} stop complete`);
            break;

        case 'cdp_ready':
            // CDP WebSocket URL discovered - update UI with connection info
            updateProfileCDPInfo(data.profile, data.data);
            break;
    }
}

function updateProfileCDPInfo(profileName, cdpData) {
    // Update profile detail view with CDP information
    const profileEl = document.querySelector(`[data-profile="${profileName}"]`);
    if (profileEl) {
        const cdpSection = profileEl.querySelector('.cdp-section');
        if (cdpSection) {
            cdpSection.innerHTML = `
                <div class="cdp-info">
                    <label>Port:</label> ${cdpData.cdp_port}
                    <label>HTTP URL:</label>
                    <input readonly value="${cdpData.cdp_url}" />
                    <label>WebSocket URL:</label>
                    <input readonly value="${cdpData.cdp_ws_url}" />
                </div>
                <div class="cdp-actions">
                    <button onclick="copyToClipboard('${cdpData.cdp_url}')">
                        📋 Copy HTTP URL
                    </button>
                    <button onclick="copyToClipboard('${cdpData.cdp_ws_url}')">
                        📋 Copy WebSocket URL
                    </button>
                    <button onclick="connectPlaywright('${cdpData.cdp_url}')">
                        🔗 Connect Playwright
                    </button>
                </div>
            `;
            // Show CDP section if it was hidden
            cdpSection.classList.remove('hidden');
        }
    }

    // Enable external tool connection buttons
    const connectButtons = document.querySelectorAll(`[data-profile="${profileName}"] .connect-tool-btn`);
    connectButtons.forEach(btn => {
        btn.disabled = false;
        btn.dataset.cdpUrl = cdpData.cdp_url;
    });
}
```

### Launch Progress UI Example

```javascript
function showLaunchProgress(profileName) {
    // Create or show progress modal
    const modal = document.getElementById('launch-modal');
    const profileNameEl = document.getElementById('launch-profile-name');
    const progressStages = document.getElementById('launch-stages');
    
    profileNameEl.textContent = profileName;
    progressStages.innerHTML = `
        <div class="stage" data-stage="proxy_test">Testing proxy...</div>
        <div class="stage" data-stage="proxy_test_complete">Proxy verified ✓</div>
        <div class="stage" data-stage="initializing">Initializing...</div>
        <div class="stage" data-stage="launching_browser">Launching browser...</div>
        <div class="stage" data-stage="downloading_browser">Downloading CloakBrowser...</div>
        <div class="stage" data-stage="complete">Launch complete ✓</div>
    `;
    
    modal.classList.remove('hidden');
}

function updateLaunchProgress(profileName, stage, message, data) {
    // Update stage indicator
    const stageEl = document.querySelector(`[data-stage="${stage}"]`);
    if (stageEl) {
        stageEl.classList.add('active');
        
        // Show proxy test results
        if (stage === 'proxy_test_complete' && data) {
            if (data.ok) {
                stageEl.innerHTML += ` <span class="success">✓ ${data.ip} (${data.ms}ms)</span>`;
            } else {
                stageEl.innerHTML += ` <span class="error">✗ Failed</span>`;
            }
        }
        
        // Show download progress
        if (stage === 'downloading_browser' && data) {
            stageEl.innerHTML = `Downloading CloakBrowser... ${data.percent}% (${data.current_mb}/${data.total_mb} MB)`;
        }
    }
    
    // Update message
    const messageEl = document.getElementById('launch-message');
    if (messageEl) {
        messageEl.textContent = message;
    }
}

function hideLaunchProgress(profileName) {
    const modal = document.getElementById('launch-modal');
    modal.classList.add('hidden');
}
```

### Crash Dialog Example

```javascript
function showCrashDialog(profileName, crashData) {
    const dialog = document.getElementById('crash-dialog');
    const exitCodeEl = document.getElementById('crash-exit-code');
    const stderrEl = document.getElementById('crash-stderr');
    
    exitCodeEl.textContent = crashData.exit_code;
    stderrEl.textContent = crashData.stderr;
    
    dialog.classList.remove('hidden');
}

function closeCrashDialog() {
    document.getElementById('crash-dialog').classList.add('hidden');
}
```

### WebSocket vs HTTP Polling

| Feature | WebSocket | HTTP Polling |
|---------|-----------|--------------|
| Latency | Instant (0ms) | Up to 2 seconds |
| Server Load | Low (push-based) | High (constant requests) |
| Launch Feedback | Real-time progress | Black hole during launch |
| Crash Detection | Instant | Next poll (up to 2s delay) |
| Connection | Persistent with auto-reconnect | Stateless |

**Migration from Polling:**

If migrating from HTTP polling:

1. **Remove polling interval:**
   ```javascript
   // OLD
   setInterval(async () => {
       const running = await api('running');
       updateRunningStatus(running);
   }, 2000);

   // NEW - Use WebSocket events instead
   ```

2. **Handle initial state:**
   ```javascript
   // Fetch initial running state on load
   async function init() {
       const running = await api('running');
       running.forEach(name => showRunningBadge(name, true));
       connectWebSocket();
   }
   ```

3. **Handle disconnections gracefully:**
   ```javascript
   ws.onclose = () => {
       // Fall back to polling until reconnected
       if (!pollingInterval) {
           pollingInterval = setInterval(pollRunningStatus, 2000);
       }
       wsReconnectInterval = setInterval(connectWebSocket, 3000);
   };

   ws.onopen = () => {
       // Stop polling when WebSocket reconnects
       if (pollingInterval) {
           clearInterval(pollingInterval);
           pollingInterval = null;
       }
   };
   ```

### WebSocket with Polling Fallback Pattern

**Production-ready pattern** that combines WebSocket for real-time updates with HTTP polling as fallback:

```javascript
let ws = null;
let wsReconnectInterval = null;
let pollingInterval = null;
let useWebSocket = true;

function connectWebSocket() {
    const clientId = 'client_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/${clientId}`;

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        console.log('[WS] Connected');
        useWebSocket = true;

        // Clear reconnect interval
        if (wsReconnectInterval) {
            clearInterval(wsReconnectInterval);
            wsReconnectInterval = null;
        }

        // Stop polling when WebSocket is active
        if (pollingInterval) {
            clearInterval(pollingInterval);
            pollingInterval = null;
        }
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleWebSocketEvent(data);
    };

    ws.onclose = () => {
        console.log('[WS] Disconnected, falling back to polling');
        useWebSocket = false;

        // Start polling as fallback
        if (!pollingInterval) {
            startPolling();
        }

        // Try to reconnect every 3 seconds
        if (!wsReconnectInterval) {
            wsReconnectInterval = setInterval(connectWebSocket, 3000);
        }
    };

    ws.onerror = (error) => {
        console.error('[WS] Error:', error);
    };
}

function startPolling() {
    if (pollingInterval) clearInterval(pollingInterval);

    pollInterval = setInterval(async () => {
        try {
            const running = await api('running');
            updateRunningStatus(running);
        } catch (e) {
            console.error('Polling failed:', e);
        }
    }, 2000);
}

// Initialize
connectWebSocket();
```

**Benefits:**
- Real-time updates when WebSocket is connected
- Automatic fallback to HTTP polling on disconnect
- Auto-reconnection to WebSocket
- No data loss during failover

---

## System Endpoints

### GET /api/system

Get system information and CloakBrowser binary status.

**Response:**
```json
{
    "binary_ok": true,
    "version": "0.3.25",
    "platform": "linux",
    "binary_path": "/home/user/.cloakbrowser/bin/chromium",
    "cache_dir": "/home/user/.cloakbrowser/cache",
    "error": null
}
```

**Use cases:** Health checks, version display, binary status monitoring

---

### GET /api/running

Get detailed info for currently running profiles.

**Response:**
```json
{
    "profile-1": {
        "pid": 10001,
        "cdp_port": 44861,
        "cdp_url": "http://127.0.0.1:44861",
        "cdp_ws_url": "ws://127.0.0.1:44861/devtools/browser/abc123",
        "started_at": "2026-06-14T06:45:48.777770",
        "session_mode": "persistent"
    },
    "profile-2": {
        "pid": 10002,
        "cdp_port": 59223,
        "cdp_url": "http://127.0.0.1:59223",
        "cdp_ws_url": "ws://127.0.0.1:59223/devtools/browser/def456",
        "started_at": "2026-06-14T06:46:12.123456",
        "session_mode": "persistent"
    }
}
```

**Fields:**
- `pid`: Process ID (pseudo-PID for CloakBrowser)
- `cdp_port`: Chrome DevTools Protocol port
- `cdp_url`: HTTP endpoint for CDP connections
- `cdp_ws_url`: WebSocket URL for CDP connections
- `started_at`: Launch timestamp (ISO 8601)
- `session_mode`: "persistent" or "ephemeral"

**Polling recommendation:** Every 2 seconds (see [Polling Pattern](#polling-pattern))

---

### GET /api/profiles/{name}/cdp 🆕

Get Chrome DevTools Protocol connection information for a running profile.

**Response:**
```json
{
    "profile": "my-profile",
    "pid": 10001,
    "cdp_port": 44861,
    "cdp_http_url": "http://127.0.0.1:44861",
    "cdp_ws_url": "ws://127.0.0.1:44861/devtools/browser/abc123-def456-ghi789",
    "connect_over_cdp": "http://127.0.0.1:44861",
    "json_version": "http://127.0.0.1:44861/json/version",
    "json_list": "http://127.0.0.1:44861/json/list"
}
```

**Fields:**
- `profile`: Profile name
- `pid`: Process ID
- `cdp_port`: Chrome DevTools Protocol port
- `cdp_http_url`: HTTP endpoint for CDP
- `cdp_ws_url`: WebSocket URL for CDP connections
- `connect_over_cdp`: Convenience URL for Playwright's `connect_over_cdp()`
- `json_version`: Browser version endpoint
- `json_list`: Page list endpoint

**Error (400):** Profile is not running

**Use cases:**
- Connect Playwright browser instances: `playwright.chromium.connect_over_cdp(cdp_http_url)`
- Connect Selenium: `options.add_argument(f"--remote-debugging-port={cdp_port}")`
- Browser automation tool integration
- Fingerprint testing automation

**Example usage:**
```javascript
// Get CDP info
const cdp = await api(`profiles/my-profile/cdp`);

// Connect with Playwright
const { chromium } = require('playwright');
const browser = await chromium.connect_over_cdp(cdp.cdp_http_url);

// Connect with Selenium
const { Builder } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');
const options = new chrome.Options();
options.add_argument(`--remote-debugging-port=${cdp.cdp_port}`);
const driver = await new Builder()
    .forBrowser('chrome')
    .setChromeOptions(options)
    .build();
```

---

## Page Visibility Optimization

### Stop Polling When Tab Hidden

Use Page Visibility API to stop unnecessary API calls when user switches tabs:

```javascript
let pollInterval = null;

function startPolling() {
    if (pollInterval) clearInterval(pollInterval);

    pollInterval = setInterval(async () => {
        const running = await api('running');
        updateUI(running);
    }, 2000);
}

// Stop polling when page is hidden
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        if (pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
        }
    } else {
        startPolling();
    }
});
```

**Benefits:**
- Reduces server load by 50-90% (users often have multiple tabs)
- Saves battery on mobile devices
- Reduces network traffic

**Browser support:** All modern browsers (IE10+)

---

### GET /api/system/check-updates ⚠️

Check for CloakBrowser binary updates.

**Response:**
```json
{
    "current_version": "0.3.25",
    "latest_version": "0.3.26",
    "update_available": true,
    "download_url": "https://github.com/cloakbrowser/releases/download/v0.3.26/chromium.zip",
    "release_notes": "Bug fixes and performance improvements"
}
```

**Error (500):** Unable to fetch release information

**Note:** This endpoint has not been tested in production

---

### POST /api/system/clear-cache ⚠️

Clear CloakBrowser cache directory.

**Response:**
```json
{
    "ok": true,
    "freed_bytes": 52428800,
    "cache_dir": "/home/user/.cloakbrowser/cache"
}
```

**Behavior:**
- Removes all cached files from CloakBrowser cache directory
- Returns number of bytes freed
- Safe to run while profiles are running

**Note:** This endpoint has not been tested in production

---

## Profile Endpoints

### GET /api/profiles

List all profiles with computed fields.

**Response:**
```json
[
    {
        "name": "my-profile",
        "os": "windows",
        "timezone": "America/New_York",
        "locale": "en-US",
        "resolution": "1920x1080",
        "proxy_id": "proxy_123456",
        "folder_id": "folder_789",
        "start_url": "https://example.com",
        "notes": "My main profile",
        "humanize": true,
        "color_scheme": "light",
        "user_agent": "",
        "auto_geoip": false,
        "proxy_bypass": "",
        "warmup_enabled": true,
        "warmup_sites": ["https://www.google.com", "https://www.wikipedia.com"],
        "launch_count": 42,
        "last_launched": "2026-05-07T10:30:00",
        "status": "idle",
        "created_at": "2026-05-01T12:00:00",
        "tags": ["work", "us-east"],
        "icon": "",
        "hardware_concurrency": 8,
        "device_memory": 8,
        "webrtc_mode": "proxy_ip",
        "image_threshold_kb": 10,
        "deleted": false,
        "deleted_at": null,
        "pause_snapshot": "",
        // Computed fields:
        "proxy_label": "socks5://192.168.1.1:1080",
        "proxy_ok": true,
        "proxy_ip": "203.0.113.42",
        "proxy_ms": 145,
        "size_kb": 245632,
        "running": false,
        "fp_seed": 42817,
        "screen_w": 1920,
        "screen_h": 1080,
        "viewport_w": 1920,
        "viewport_h": 992,
        "dpr": 1.0
    }
]
```

**Computed fields** (added by backend):
- `proxy_label`: Formatted proxy string
- `proxy_ok`: Last test status
- `proxy_ip`: External IP from last test
- `proxy_ms`: Latency from last test
- `size_kb`: Profile directory size
- `running`: Current running status
- `fp_seed`: Fingerprint seed (deterministic from name)
- `screen_w`, `screen_h`: Screen dimensions
- `viewport_w`, `viewport_h`: Browser viewport dimensions
- `dpr`: Device pixel ratio

**Status values:**
- `idle` - Profile is stopped
- `running` - Profile is currently running
- `paused` - Profile is paused (session saved)

**Pause snapshot field:**
- `pause_snapshot`: Path to session snapshot (empty if not paused)

---

### GET /api/profiles/{name} 🆕

Get a single profile by name.

**Response (idle profile):**
```json
{
    "name": "my-profile",
    "os": "windows",
    "timezone": "America/New_York",
    "locale": "en-US",
    "resolution": "1920x1080",
    "proxy_id": "proxy_123456",
    "folder_id": "folder_789",
    "start_url": "https://example.com",
    "notes": "My main profile",
    "humanize": true,
    "color_scheme": "light",
    "user_agent": "",
    "auto_geoip": false,
    "proxy_bypass": "",
    "warmup_enabled": true,
    "warmup_sites": ["https://www.google.com", "https://www.wikipedia.com"],
    "launch_count": 42,
    "last_launched": "2026-05-07T10:30:00",
    "status": "idle",
    "created_at": "2026-05-01T12:00:00",
    "tags": ["work", "us-east"],
    "icon": "",
    "hardware_concurrency": 8,
    "device_memory": 8,
    "webrtc_mode": "proxy_ip",
    "image_threshold_kb": 10,
    "deleted": false,
    "deleted_at": null,
    "pause_snapshot": "",
    "cdp_port": null,
    "cdp_url": null,
    "cdp_ws_url": null,
    "last_cdp_port": 44861
}
```

**Response (running profile with CDP fields):**
```json
{
    "name": "my-profile",
    "status": "running",
    // ... other profile fields ...
    "cdp_port": 44861,
    "cdp_url": "http://127.0.0.1:44861",
    "cdp_ws_url": "ws://127.0.0.1:44861/devtools/browser/abc123",
    "last_cdp_port": 44861
}
```

**CDP fields when running:**
- `cdp_port`: Chrome DevTools Protocol port (only when `status = "running"`)
- `cdp_url`: HTTP endpoint for CDP connections (only when `status = "running"`)
- `cdp_ws_url`: WebSocket URL for CDP connections (only when `status = "running"`)
- `last_cdp_port`: Most recent CDP port allocation (persisted even after stop)

**Error (404):** `"profile not found"`

**Use cases:** Fetch a single profile for editing, display profile details page

**Note:** Returns the same data structure as `GET /api/profiles` but for a single profile.

---

### POST /api/profiles

Create a new profile.

**Request Body:**
```json
{
    "name": "new-profile",
    "os": "windows",
    "timezone": "America/New_York",
    "locale": "en-US",
    "resolution": "1920x1080",
    "proxy_id": null,
    "folder_id": null,
    "start_url": "https://www.google.com",
    "notes": "",
    "humanize": false,
    "color_scheme": "light",
    "user_agent": "",
    "auto_geoip": false,
    "proxy_bypass": "",
    "warmup_enabled": false,
    "warmup_sites": ["https://www.google.com", "https://www.wikipedia.com", "https://news.ycombinator.com"],
    "tags": [],
    "icon": "",
    "hardware_concurrency": 8,
    "device_memory": 8,
    "webrtc_mode": "proxy_ip",
    "image_threshold_kb": 10
}
```

**Response (201 Created):**
```json
{
    "ok": true,
    "name": "new-profile",
    "fp_seed": 42817
}
```

**Validation:**
- `name` must contain only alphanumeric characters, hyphens, and underscores
- Returns `409 Conflict` if profile already exists

---

### PUT /api/profiles/{name}

Update an existing profile (partial update supported).

**Request Body** (all fields optional):
```json
{
    "os": "macos",
    "timezone": "Europe/London",
    "proxy_id": "proxy_123456"
}
```

**Response:**
```json
{
    "ok": true
}
```

---

### DELETE /api/profiles/{name}

Delete a profile permanently.

**Response:**
```json
{
    "ok": true
}
```

**Error (409):** `"Stop the profile first"` - Cannot delete running profile

---

### POST /api/profiles/{name}/clone

Clone a profile with a new fingerprint seed.

**Request Body:**
```json
{
    "name": "my-profile-copy"
}
```

**Response (201 Created):**
```json
{
    "name": "my-profile-copy",
    "profile": { ... }
}
```

**Behavior:**
- Creates new profile with same configuration
- Gets NEW fingerprint seed (different from source)
- Profile data directory is empty (fresh browser profile)

---

### POST /api/profiles/{name}/reset

Wipe all browser data for a profile.

**Response:**
```json
{
    "ok": true
}
```

**Error (409):** Profile must be stopped first

---

### POST /api/profiles/{name}/launch ⭐

Launch a browser profile. **See [Special Behaviors](#launch-crash-window) for crash monitoring.**

**Response:**
```json
{
    "ok": true,
    "pid": 12345,
    "proxy_verified": true,
    "proxy_ip": "203.0.113.42",
    "fp_seed": 42817,
    "cdp_port": 44861,
    "cdp_url": "http://127.0.0.1:44861"
}
```

**CDP Fields:**
- `cdp_port`: Chrome DevTools Protocol port (dynamically allocated)
- `cdp_url`: HTTP endpoint for CDP connections

**Special behaviors:**
1. **Proxy verification:** Tests proxy before launch (10s timeout)
2. **Crash window:** Monitors for 15 seconds, returns detailed error if crashes
3. **WebRTC IP spoofing:** Adds `--fingerprint-webrtc-ip` flag based on proxy's external IP

**Error (409):**
- `"Profile already running"`
- `"Assigned proxy no longer exists"`
- `"Launch blocked — proxy verification failed"` (with reason)

**Error (500):** Profile crashed during launch (includes stderr in error message)

---

### POST /api/profiles/{name}/stop

Stop a running profile.

**Response:**
```json
{
    "ok": true
}
```

**Termination process:**
1. SIGTERM (graceful shutdown)
2. Wait 5 seconds
3. SIGKILL if still running

---

### POST /api/profiles/{name}/pause 🆕

Pause a running profile - save session state and stop browser.

**What "pause" means:**
- Saves ALL session state (open tabs, cookies, localStorage, sessionStorage, form data, scroll positions)
- Stops the browser process to free CPU/memory
- Keeps profile directory intact
- Allows "resume" to restore everything exactly

**Response:**
```json
{
    "ok": true,
    "snapshot": "/path/to/profiles/.snapshots/my-profile/snapshot_20260508_123456"
}
```

**Pause process:**
1. Create session snapshot
2. SIGTERM (graceful shutdown)
3. Wait 10 seconds for clean shutdown
4. SIGKILL if still running
5. Update profile status to "paused"

**Error (404):** `"profile not running"`

---

### POST /api/profiles/{name}/resume 🆕

Resume a paused profile - restore session and launch browser.

**Response:**
```json
{
    "ok": true
}
```

**Resume process:**
1. Restore session snapshot
2. Launch browser with restored session
3. Monitor for 15-second crash window
4. Update profile status to "running"

**Error (400):** `"profile has no pause snapshot"` or `"pause snapshot not found on disk"`

**Error (409):** `"profile is already running"`

---

### POST /api/profiles/{name}/fingerprint-test

Get fingerprint testing URLs for a running profile.

**Response:**
```json
{
    "browserscan": "https://browserscan.net",
    "browserleaks": "https://browserleaks.net",
    "pixelscan": "https://pixelscan.net/fingerprint-check",
    "message": "Open one of these URLs in the running profile window"
}
```

**Error (400):** Profile is not running

---

### GET /api/profiles/{name}/cookies/export

Export cookies from a profile.

**Response:**
```json
{
    "version": 1,
    "format": "json",
    "profile": "my-profile",
    "exported_at": "2026-05-07T10:30:00",
    "cookies": [
        {
            "domain": ".example.com",
            "name": "session_id",
            "value": "abc123",
            "path": "/",
            "expires": 1234567890,
            "secure": true,
            "httpOnly": true,
            "sameSite": 0,
            "sourceScheme": 2,
            "sourcePort": 443
        }
    ],
    "count": 1
}
```

---

### GET /api/profiles/{name}/activity

Get profile activity log - retrieves recent actions and events for a specific profile.

**Query Parameters:**
- `limit` (optional, default: 10): Number of recent entries to return (1-50)

**Response:**
```json
{
    "profile": "my-profile",
    "entries": [
        {
            "action": "launched",
            "timestamp": "2026-05-08T12:34:56.789Z",
            "metadata": {
                "pid": 12345
            }
        },
        {
            "action": "stopped",
            "timestamp": "2026-05-08T11:20:30.456Z",
            "metadata": {}
        },
        {
            "action": "cookies_imported",
            "timestamp": "2026-05-08T10:15:22.123Z",
            "metadata": {
                "count": 42
            }
        },
        {
            "action": "paused",
            "timestamp": "2026-05-08T09:30:15.789Z",
            "metadata": {
                "snapshot": "/path/to/profiles/.snapshots/my-profile/snapshot_20260508_093015"
            }
        },
        {
            "action": "resumed",
            "timestamp": "2026-05-08T08:45:10.234Z",
            "metadata": {
                "pid": 12346
            }
        }
    ]
}
```

**Action Types:**
- `launched` - Profile was launched (metadata includes `pid`)
- `stopped` - Profile was stopped
- `paused` - Profile was paused (metadata includes `snapshot` path)
- `resumed` - Profile was resumed from pause (metadata includes `pid`)
- `cookies_exported` - Cookies were exported (metadata includes `count`)
- `cookies_imported` - Cookies were imported (metadata includes `count`)

**Error (404):** Profile not found

**Notes:**
- Entries are returned in reverse chronological order (newest first)
- Maximum 50 entries stored per profile
- Timestamps are in UTC ISO 8601 format
- Empty log returns `{"profile": "name", "entries": []}`

**Example Usage:**
```javascript
// Get last 10 activity entries (default)
const activity = await api(`profiles/my-profile/activity`);

// Get last 20 activity entries
const activity = await api(`profiles/my-profile/activity?limit=20`);

// Display recent activity
activity.entries.forEach(entry => {
    console.log(`${entry.timestamp}: ${entry.action}`);
    if (entry.metadata.pid) {
        console.log(`  PID: ${entry.metadata.pid}`);
    }
});
```

**Use Cases:**
- Audit trail for profile usage
- Debugging launch/stop issues
- Monitoring user activity patterns
- Tracking cookie import/export history

---

### POST /api/profiles/{name}/cookies/import

Import cookies to a profile.

**Request Body:**
```json
{
    "cookies": [
        {
            "domain": ".example.com",
            "name": "session_id",
            "value": "abc123",
            "path": "/",
            "expires": 0,
            "secure": true,
            "httpOnly": true
        }
    ]
}
```

**Response:**
```json
{
    "profile": "my-profile",
    "imported": 42,
    "skipped": 3,
    "errors": ["cookie_name: invalid domain"]
}
```

---

### GET /api/profiles/search?q={query}

Full-text search across profiles using FTS5.

**Query Parameters:**
- `q` (required): Search query (min 2 characters)
- `limit` (optional, default 50): Maximum results

**Search Syntax:**
- Prefix: `query*` matches "query", "queries", etc.
- Phrase: `"exact phrase"` matches exact sequence
- Boolean: `windows AND proxy` combines terms

**Response:**
```json
{
    "results": [...],
    "query": "work",
    "count": 5
}
```

---

### POST /api/profiles/batch/launch

Launch multiple profiles.

**Request Body:**
```json
{
    "names": ["profile-1", "profile-2", "profile-3"]
}
```

**Response:**
```json
{
    "success": ["profile-1", "profile-2"],
    "failed": [
        {
            "name": "profile-3",
            "error": "Profile already running"
        }
    ]
}
```

---

### POST /api/profiles/batch/stop

Stop multiple profiles.

**Request/Response format:** Same as batch launch

---

### POST /api/profiles/batch/delete

Delete multiple profiles.

**Request/Response format:** Same as batch launch

---

### POST /api/profiles/batch/proxy ⚠️

Assign or remove proxy from multiple profiles.

**Request Body:**
```json
{
    "names": ["profile-1", "profile-2"],
    "proxy_id": "proxy_123456"
}
```

To remove proxy: Set `"proxy_id": null`

**Note:** This endpoint has not been tested in production

---

### POST /api/profiles/batch/tag

Add or remove tags from multiple profiles.

**Request Body:**
```json
{
    "names": ["profile-1", "profile-2"],
    "tags": ["work", "us-east"],
    "action": "add"
}
```

**Actions:** `add` or `remove`

---

### PUT /api/profiles/{name}/trash 🆕

Move profile to trash (soft delete).

**Response:**
```json
{
    "ok": true
}
```

**Error (404):** `"profile not found"` - Profile does not exist
**Error (409):** `"Stop the profile first"` - Cannot trash a running profile

---

### POST /api/profiles/{name}/restore 🆕

Restore profile from trash.

**Response:**
```json
{
    "ok": true
}
```

**Error (404):** `"profile not found"` - Profile does not exist

---

### GET /api/profiles/trash 🆕

List all profiles in trash.

**Response:**
```json
{
    "profiles": [
        {
            "name": "deleted-profile",
            "os": "windows",
            "timezone": "America/New_York",
            "locale": "en-US",
            "resolution": "1920x1080",
            "proxy_id": null,
            "folder_id": null,
            "start_url": "https://example.com",
            "notes": "Deleted profile",
            "humanize": false,
            "color_scheme": "light",
            "user_agent": "",
            "auto_geoip": false,
            "proxy_bypass": "",
            "warmup_enabled": false,
            "warmup_sites": [],
            "launch_count": 5,
            "last_launched": "2026-05-07T10:30:00",
            "status": "idle",
            "created_at": "2026-05-01T12:00:00",
            "deleted_at": "2026-05-08T12:34:56.789Z",
            "tags": [],
            "icon": "",
            "hardware_concurrency": 8,
            "device_memory": 8,
            "webrtc_mode": "proxy_ip",
            "image_threshold_kb": 10,
            "pause_snapshot": ""
        }
    ],
    "count": 1
}
```

---

### DELETE /api/profiles/trash 🆕

Permanently delete all trashed profiles.

**Response:**
```json
{
    "ok": true,
    "deleted": 3
}
```

**Behavior:**
- Permanently removes all profiles from the trash
- Deletes all associated browser data directories
- Returns the count of permanently deleted profiles

---

### GET /api/profiles/consistency ✅

Check for orphaned profile directories and database records.

**Response:**
```json
{
    "orphaned_directories": [
        {
            "name": "ghost-profile",
            "path": "/path/to/profiles/ghost-profile"
        }
    ],
    "orphaned_records": [
        {
            "name": "deleted-profile",
            "deleted_at": "2026-05-08T12:34:56.789Z"
        }
    ],
    "issues_found": 2
}
```

**Issues detected:**
- `orphaned_directories`: Profile directories that exist in filesystem but not in database
- `orphaned_records`: Database records without corresponding directories

**Use cases:**
- Data integrity verification
- Cleanup planning
- Troubleshooting profile list inconsistencies

---

### POST /api/profiles/consistency/cleanup ✅

Clean up orphaned profile data.

**Response:**
```json
{
    "ok": true,
    "removed_directories": 1,
    "removed_records": 1,
    "total_cleaned": 2
}
```

**Behavior:**
- Removes orphaned directories from filesystem
- Removes orphaned records from database
- Safe to run while profiles are active (skips running profiles)

**Use cases:**
- Free disk space from orphaned data
- Fix database inconsistencies
- Maintenance operations

---

## Proxy Endpoints

### GET /api/proxies

List all proxies with test results.

**Response:**
```json
[
    {
        "id": "proxy_123456",
        "label": "US-East Proxy",
        "protocol": "socks5",
        "host": "192.168.1.1",
        "port": "1080",
        "username": "user",
        "password": "pass",
        "country": "US",
        "bypass": "localhost,127.0.0.1",
        "last_test_ok": true,
        "last_test_ms": 145,
        "last_test_ip": "203.0.113.42",
        "last_tested": "2026-05-07T10:30:00",
        "last_error": null
    }
]
```

---

### POST /api/proxies

Create a new proxy.

**Request Body:**
```json
{
    "label": "My Proxy",
    "protocol": "socks5",
    "host": "192.168.1.1",
    "port": "1080",
    "username": "user",
    "password": "pass",
    "country": "US",
    "bypass": "localhost,127.0.0.1"
}
```

**Response (201 Created):**
```json
{
    "ok": true,
    "id": "proxy_123456"
}
```

**Protocols:** `http`, `https`, `socks4`, `socks5`

---

### PUT /api/proxies/{id}

Update a proxy (partial update supported).

**Request Body:** Same as create (all fields optional)

**Response:**
```json
{
    "ok": true
}
```

---

### DELETE /api/proxies/{id}

Delete a proxy.

**Response:**
```json
{
    "ok": true
}
```

**Cascade behavior:** Profiles using this proxy will have `proxy_id` set to `null`

---

### POST /api/proxies/{id}/test ⭐

Test proxy connectivity and resolve external IP.

**Response:**
```json
{
    "ok": true,
    "latency_ms": 145,
    "external_ip": "203.0.113.42",
    "error": null,
    "tested_at": "2026-05-07T10:30:00"
}
```

**Test process:**
1. TCP connect to proxy (10s timeout)
2. HTTP GET through proxy to IP resolver service
3. Measure latency, store external IP
4. Update database with results

**Error response:**
```json
{
    "ok": false,
    "latency_ms": null,
    "external_ip": null,
    "error": "TCP failed: Connection refused"
}
```

---

### POST /api/proxies/bulk-import ⭐

Import multiple proxies from a text string with automatic format detection.

**Request Body:**
```json
{
    "proxies": "192.168.1.1:8080:user:pass\nhttps://proxy2.com:443::\n{\"host\":\"proxy3.com\",\"port\":\"8080\"}",
    "format": "auto",
    "default_protocol": "socks5",
    "default_label_prefix": "Import"
}
```

**Parameters:**
- `proxies` (string, required): Text containing proxy entries, one per line
- `format` (string, optional): Input format detection mode. Default: `"auto"`
- `default_protocol` (string, optional): Protocol for entries without explicit protocol. Default: `"socks5"`
- `default_label_prefix` (string, optional): Prefix for auto-generated labels. Default: `"Import"`

**Supported Formats:**
- **Standard**: `protocol://host:port:username:password`
  ```text
  socks5://192.168.1.1:8080:user:pass
  https://proxy.example.com:443::
  ```
- **Simple**: `host:port` or `host:port:username:password`
  ```text
  192.168.1.1:8080:user:pass
  192.168.1.2:1080
  ```
- **JSON**: JSON object on each line
  ```text
  {"host": "proxy1.com", "port": "8080", "protocol": "http"}
  {"host": "proxy2.com", "port": "443", "username": "user"}
  ```

**Special Lines:**
- Lines starting with `#` are treated as comments and skipped
- Empty lines are ignored

**Response (201 Created):**
```json
{
    "success_count": 2,
    "failed_count": 1,
    "total": 3,
    "succeeded": [
        {
            "id": "proxy_123456",
            "host": "192.168.1.1",
            "port": "8080",
            "label": "Import 1"
        },
        {
            "id": "proxy_123457",
            "host": "proxy2.com",
            "port": "443",
            "label": "Import 2"
        }
    ],
    "failed": [
        {
            "line": 3,
            "raw": "invalid-proxy",
            "error": "Unable to parse proxy line: invalid-proxy"
        }
    ],
    "duration_ms": 45
}
```

**Validation Rules:**
- Host is required
- Port must be numeric and between 1-65535
- Protocol must be one of: `http`, `https`, `socks4`, `socks5`
- Fields with invalid values will cause the entire line to fail

**Error Handling:**
- `400 Bad Request`: Invalid request format or validation errors
- `401 Unauthorized`: When authentication is required but not provided
- `500 Internal Server Error`: Database or parsing errors

**WebSocket Event:**
- Emits `proxy_created` events for each successfully imported proxy
- Includes proxy details and timestamp

---

## Folder Endpoints

### GET /api/folders

List all folders with profile counts.

**Response:**
```json
[
    {
        "id": "folder_123456",
        "name": "Work Profiles",
        "order_index": 0,
        "created_at": "2026-05-01T12:00:00",
        "profile_count": 5
    }
]
```

---

### GET /api/folders/{id}

Get a single folder.

**Response:** Same as list

---

### POST /api/folders

Create a new folder.

**Request Body:**
```json
{
    "name": "Personal Profiles",
    "order_index": 1
}
```

**Response (201 Created):**
```json
{
    "id": "folder_123456",
    "name": "Personal Profiles",
    "order_index": 1
}
```

---

### PUT /api/folders/{id}

Update a folder.

**Request Body:**
```json
{
    "name": "Updated Name",
    "order_index": 2
}
```

**Response:**
```json
{
    "ok": true
}
```

---

### DELETE /api/folders/{id}

Delete a folder.

**Response:**
```json
{
    "ok": true
}
```

**Cascade behavior:** Profiles in folder will have `folder_id` set to `null`

---

## Template Endpoints

### GET /api/templates

List all templates (fingerprint presets).

**Response:**
```json
[
    {
        "id": "tpl_123456",
        "name": "Windows US Profile",
        "os": "windows",
        "timezone": "America/New_York",
        "locale": "en-US",
        "resolution": "1920x1080",
        "humanize": true,
        "color_scheme": "light",
        "user_agent": "",
        "auto_geoip": false,
        "warmup_enabled": false,
        "warmup_sites": [],
        "created_at": "2026-05-01T12:00:00"
    }
]
```

**Note:** Templates only store fingerprint settings, not name/notes/tags.

---

### GET /api/templates/{id}

Get a single template.

**Response:** Same as list

---

### POST /api/templates

Save configuration as a template.

**Request Body:**
```json
{
    "name": "My Preset",
    "os": "macos",
    "timezone": "Europe/London",
    "locale": "en-GB",
    "resolution": "2560x1440",
    "humanize": false,
    "color_scheme": "dark",
    "user_agent": "",
    "auto_geoip": false,
    "warmup_enabled": true,
    "warmup_sites": ["https://www.google.com"]
}
```

**Response (201 Created):**
```json
{
    "id": "tpl_123456",
    "name": "My Preset"
}
```

---

### DELETE /api/templates/{id}

Delete a template.

**Response:**
```json
{
    "ok": true
}
```

---

## Extension Endpoints

### GET /api/extensions ✅

List all installed extensions.

**Response:**
```json
[
    {
        "id": "ext_123456",
        "name": "uBlock Origin",
        "version": "1.50.0",
        "description": "Block ads and trackers",
        "file_path": "/path/to/extensions/ublock.crx",
        "icon": "data:image/png;base64,...",
        "enabled": true,
        "created_at": "2026-05-01T12:00:00",
        "size_kb": 1024,
        "profiles_count": 5
    }
]
```

---

### GET /api/extensions/downloads/active ⚠️

Get list of active extension downloads.

**Response:**
```json
[
    {
        "id": "dl_123456",
        "extension_id": "ext_123456",
        "name": "uBlock Origin",
        "source_url": "https://example.com/ublock.crx",
        "status": "downloading",
        "progress": 45,
        "error": null
    }
]
```

**Status values:**
- `pending` - Download queued
- `downloading` - In progress (0-99%)
- `completed` - Download finished
- `failed` - Download failed with error

**Use cases:** Track extension download progress, show active downloads in UI

**Note:** This endpoint has not been tested in production

---

### POST /api/extensions ⚠️

Upload a new extension (CRX file).

**Request:** `multipart/form-data`
- `file`: CRX file (required)
- `enabled`: Boolean (optional, default: true)

**Response (201 Created):**
```json
{
    "ok": true,
    "id": "ext_123456",
    "name": "uBlock Origin",
    "version": "1.50.0"
}
```

**Error (400):** Invalid file format or corrupted CRX

**Note:** This endpoint has not been tested in production

---

### DELETE /api/extensions/{ext_id} ⚠️

Delete an extension.

**Response:**
```json
{
    "ok": true
}
```

**Cascade behavior:** Extension is removed from all profiles using it

**Error (404):** Extension not found

**Note:** This endpoint has not been tested in production

---

### GET /api/extensions/{ext_id}/icon ⚠️

Get extension icon as image.

**Response:** Raw image data (PNG/JPG)

**Content-Type:** `image/png` or `image/jpeg`

**Use cases:** Display extension icons in UI

**Note:** This endpoint has not been tested in production

---

### POST /api/extensions/import-from-store ⚠️

Import extension directly from Chrome Web Store.

**Request Body:**
```json
{
    "store_url": "https://chrome.google.com/webstore/detail/ublock-origin/cjpalhdlnbpafiamejdnhcphjbkeiagm"
}
```

**Response (201 Created):**
```json
{
    "ok": true,
    "id": "ext_123456",
    "name": "uBlock Origin",
    "version": "1.50.0",
    "downloaded_from": "Chrome Web Store"
}
```

**Error (400):** Invalid store URL or extension not found

**Note:** This endpoint has not been tested in production

---

### GET /api/profiles/{name}/extensions ✅

Get extensions assigned to a specific profile.

**Response:**
```json
[
    {
        "id": "ext_123456",
        "name": "uBlock Origin",
        "version": "1.50.0",
        "enabled": true,
        "assigned_at": "2026-05-01T12:00:00"
    }
]
```

---

### POST /api/profiles/{name}/extensions/{ext_id} ⚠️

Add extension to a profile.

**Response:**
```json
{
    "ok": true,
    "profile": "my-profile",
    "extension": "ext_123456"
}
```

**Error (404):** Profile or extension not found

**Note:** This endpoint has not been tested in production

---

### DELETE /api/profiles/{name}/extensions/{ext_id} ⚠️

Remove extension from a profile.

**Response:**
```json
{
    "ok": true
}
```

**Error (404):** Profile or extension not found, or extension not assigned to profile

**Note:** This endpoint has not been tested in production

---

## License Endpoints ⚠️

License management endpoints for CloakManager Pro/Enterprise features. These endpoints interact with the license validation system and Cloudflare Worker.

### GET /api/license

Get current license information and status.

**Response:**
```json
{
    "active": false,
    "key": null,
    "tier": "free",
    "expires_at": null,
    "instance_id": null,
    "hwid": "abc123...",
    "activated_at": null,
    "last_validated": "2026-06-02T10:30:00Z",
    "features": {
        "max_instances": 5,
        "max_profiles": 999,
        "proxy_marketplace": true,
        "team_collaboration": false
    }
}
```

**Response fields:**
- `active`: License activation status
- `key`: License key (redacted for security)
- `tier`: License tier (free, pro, enterprise)
- `expires_at`: Subscription expiration date (null for free)
- `instance_id`: Current installation ID
- `hwid`: Hardware ID hash
- `activated_at`: When license was activated
- `last_validated`: Last validation check
- `features`: Available features based on tier

---

### POST /api/license/activate

Activate a license key for this installation.

**Request Body:**
```json
{
    "license_key": "LICENSE-KEY-HERE"
}
```

**Response (200 OK):**
```json
{
    "active": true,
    "tier": "pro",
    "expires_at": "2026-12-31T23:59:59Z",
    "instance_id": "inst_abc123",
    "features": {
        "max_instances": 5,
        "max_profiles": 999,
        "proxy_marketplace": true,
        "team_collaboration": false
    }
}
```

**Error responses:**
- `400`: Invalid license key format
- `409`: License already active (use `/api/license/validate` instead)
- `422`: License expired or revoked
- `500`: Failed to connect to license server

---

### POST /api/license/validate

Validate the current license status (check if still active and valid).

**Request Body:**
```json
{
    "license_key": "LICENSE-KEY-HERE"
}
```

**Response (200 OK):**
```json
{
    "valid": true,
    "tier": "pro",
    "expires_at": "2026-12-31T23:59:59Z",
    "hwid": "abc123...",
    "instance_id": "inst_abc123"
}
```

**Error responses:**
- `400`: Invalid license key format
- `404`: License not found
- `410`: License expired
- `422`: License revoked

**Note:** This endpoint checks against the license server to verify current status.

---

### DELETE /api/license

Deactivate the current license and revert to free tier.

**Response:**
```json
{
    "ok": true
}
```

**Behavior:**
- Removes license activation from this installation
- Preserves profile data and settings
- Downgrades to free tier (with limitations)

**Error (404):** No license is currently active

**Note:** This endpoint has not been tested in production

---

## Worker Endpoints ⚠️

Cloudflare Worker integration endpoints for telemetry, license validation, and status checks. These endpoints communicate with the deployed Cloudflare Worker service.

### GET /api/worker/status

Check if the Cloudflare Worker API is available.

**Response:**
```json
{
    "available": true,
    "worker_url": "https://nyathiba-worker.gkm18686.workers.dev",
    "is_dev_mode": false,
    "message": "Worker is available"
}
```

**Use cases:** Health checks, worker availability verification, configuration validation

---

### POST /api/worker/ping

Ping the Cloudflare Worker to test connectivity and send telemetry data.

**Response:**
```json
{
    "success": true,
    "worker_url": "https://nyathiba-worker.gkm18686.workers.dev",
    "response": {
        "pong": true,
        "server_time": "2026-06-02T10:30:00Z",
        "update_available": true,
        "latest_version": "11.0"
    }
}
```

**Error response:**
```json
{
    "success": false,
    "worker_url": "https://nyathiba-worker.gkm18686.workers.dev",
    "error": "HTTP 403: Forbidden"
}
```

**Behavior:**
- Sends hardware ID, version, platform, and tier information
- Worker records installation telemetry
- Returns update availability information
- Used on app launch and periodically (every 4 hours)

**Note:** Requires custom User-Agent header (`CloakManager/0.1.0`) to bypass Cloudflare bot detection. See `backend/core/config.py` for implementation.

---

### POST /api/worker/telemetry

Send telemetry data to the Cloudflare Worker (heartbeat/ping).

**Request Body:**
```json
{
    "force": false
}
```

**Parameters:**
- `force` (boolean, optional): Force ping even if not scheduled. Default: `false`

**Response:**
```json
{
    "success": true,
    "response": {
        "pong": true,
        "server_time": "2026-06-02T10:30:00Z"
    },
    "message": "Telemetry sent successfully"
}
```

**Behavior:**
- Sends current installation information to worker
- Records telemetry event in worker database
- Called automatically on app launch and every 4 hours
- Force flag triggers immediate ping regardless of schedule

**Error (500):** Failed to send telemetry (network error, worker unavailable)

---

### POST /api/worker/license/validate

Validate a license through the Cloudflare Worker (proxy to Lemon Squeezy API).

**Request Body:**
```json
{
    "license_key": "LICENSE-KEY-HERE",
    "instance_id": "inst_abc123",
    "hwid": "abc123..."
}
```

**Response (200 OK):**
```json
{
    "valid": true,
    "tier": "pro",
    "expires_at": "2026-12-31T23:59:59Z",
    "hwid": "abc123...",
    "instance_id": "inst_abc123"
}
```

**Error responses:**
- `400`: Invalid license key format
- `404`: License not found
- `410`: License expired
- `422`: License revoked
- `500`: Failed to connect to license server

**Note:** This endpoint has not been tested in production

---

### GET /api/worker/config

Get worker configuration and settings.

**Response:**
```json
{
    "worker_url": "https://nyathiba-worker.gkm18686.workers.dev",
    "api_version": "1.0",
    "features": {
        "telemetry": true,
        "license_validation": true,
        "proxy_marketplace": true
    }
}
```

**Use cases:** Configuration display, feature availability checks

**Note:** This endpoint has not been tested in production

---

## Data Models

### ProfileCreate

```typescript
interface ProfileCreate {
    name: string;                    // Required, alphanumeric + -_ only
    os: string;                      // Default: "windows"
    timezone: string;                // Default: "Africa/Nairobi"
    locale: string;                  // Default: "en-US"
    resolution: string;              // Default: "1440x900"
    proxy_id?: string | null;        // Optional
    folder_id?: string | null;       // Optional
    start_url: string;               // Default: "https://www.google.com"
    notes: string;                   // Default: ""
    humanize: boolean;               // Default: false
    color_scheme: string;            // Default: "light"
    user_agent: string;              // Default: ""
    auto_geoip: boolean;             // Default: false
    proxy_bypass: string;            // Default: ""
    warmup_enabled: boolean;         // Default: false
    warmup_sites: string[];          // Default: [google, wikipedia, ycombinator]
    tags: string[];                  // Default: []
    icon: string;                    // Default: ""
    hardware_concurrency: number;    // Default: 8
    device_memory: number;           // Default: 8
    webrtc_mode: string;             // Default: "proxy_ip"
    image_threshold_kb: number;      // Default: 10
}
```

### ProxyCreate

```typescript
interface ProxyCreate {
    label?: string | null;           // Default: "host:port"
    protocol: string;                // Default: "socks5"
    host: string;                    // Required
    port: string;                    // Required
    username: string;                // Default: ""
    password: string;                // Default: ""
    country: string;                 // Default: ""
    bypass: string;                  // Default: ""
}
```

### BatchRequest

```typescript
interface BatchRequest {
    names: string[];
}
```

### BatchProxyRequest

```typescript
interface BatchProxyRequest {
    names: string[];
    proxy_id?: string | null;        // null = remove proxy
}
```

### BatchTagRequest

```typescript
interface BatchTagRequest {
    names: string[];
    tags: string[];
    action: 'add' | 'remove';        // Default: "add"
}
```

### ProfileResponse

```typescript
interface ProfileResponse {
    // Core profile fields
    name: string;
    os: string;
    timezone: string;
    locale: string;
    resolution: string;
    proxy_id?: string | null;
    folder_id?: string | null;
    start_url: string;
    notes: string;
    humanize: boolean;
    color_scheme: string;
    user_agent: string;
    auto_geoip: boolean;
    proxy_bypass: string;
    warmup_enabled: boolean;
    warmup_sites: string[];
    launch_count: number;
    last_launched: string;
    status: 'idle' | 'running' | 'paused';
    created_at: string;
    tags: string[];
    icon: string;
    hardware_concurrency: number;
    device_memory: number;
    webrtc_mode: string;
    image_threshold_kb: number;
    deleted: boolean;
    deleted_at: string | null;
    pause_snapshot?: string;  // Path to session snapshot (empty if not paused)

    // Computed fields (added by backend)
    proxy_label: string;
    proxy_ok: boolean;
    proxy_ip?: string;
    proxy_ms?: number;
    size_kb: number;
    running: boolean;
    fp_seed: number;
    screen_w: number;
    screen_h: number;
    viewport_w: number;
    viewport_h: number;
    dpr: number;

    // CDP fields (when running)
    cdp_port?: number | null;        // CDP port (only when running)
    cdp_url?: string | null;         // CDP HTTP URL (only when running)
    cdp_ws_url?: string | null;     // CDP WebSocket URL (only when running)
    last_cdp_port?: number | null;   // Last allocated CDP port (persisted)
}
```

---

## Special Behaviors

### Launch Crash Window ⭐

When launching a profile, the backend monitors the process for **15 seconds**:

```javascript
// Launch flow
const response = await api(`profiles/${name}/launch`);

// If successful:
// { ok: true, pid: 12345, ... }

// If profile crashes within 15 seconds:
// HTTP 500 with error message containing:
// - Exit code
// - stderr (last 1500 characters)
```

**Frontend handling:**
```javascript
try {
    const result = await api(`profiles/${name}/launch`);
    showToast(`Profile launched (PID: ${result.pid})`, 'success');
} catch (e) {
    if (e.message.includes('crashed')) {
        // Display crash details to user
        showToast(`Profile crashed: ${e.message}`, 'error');
    }
}
```

---

### Proxy Testing Flow

Before launching a profile with a proxy:

1. Backend tests proxy connectivity (10s timeout)
2. Resolves external IP
3. Updates database with test results
4. **Blocks launch** if proxy fails
5. Uses external IP for WebRTC spoofing

```javascript
// Launch will fail with 409 if proxy test fails
try {
    await api(`profiles/${name}/launch`);
} catch (e) {
    if (e.message.includes('proxy verification failed')) {
        // User needs to fix proxy or remove it from profile
    }
}
```

---

### Polling Pattern

Poll `/api/running` every 2 seconds to track profile status.

```javascript
let pollInterval = null;

function startPolling() {
    if (pollInterval) clearInterval(pollInterval);
    
    pollInterval = setInterval(async () => {
        const running = await api('running');
        updateUI(running);
    }, 2000);
}

// Stop polling when tab is hidden (resource optimization)
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        if (pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
        }
    } else {
        startPolling();
    }
});

// Cleanup on unmount
window.addEventListener('beforeunload', () => {
    if (pollInterval) clearInterval(pollInterval);
});
```

---

### Search Capabilities

Full-text search using SQLite FTS5 with **BM25 relevance ranking**:

```javascript
// Simple search
const results = await api(`profiles/search?q=work`);

// Prefix search (matches work, worker, working, etc.)
const results = await api(`profiles/search?q=work*`);

// Phrase search
const results = await api(`profiles/search?q="us east"`);

// Boolean search
const results = await api(`profiles/search?q=windows AND proxy`);

// Limit results
const results = await api(`profiles/search?q=work&limit=20`);
```

**Searched fields:** name, notes, tags, proxy_label

### Debouncing Search Input ⚠️

**IMPORTANT:** Search API should be debounced to avoid excessive requests:

```javascript
let searchTimeout = null;

function onSearch(query) {
    // Clear previous timeout
    if (searchTimeout) clearTimeout(searchTimeout);

    // Only search if query is empty or >= 2 characters
    if (!query || query.length < 2) {
        displayProfiles(PROFILES); // Show all
        return;
    }

    // Debounce: wait 300ms after user stops typing
    searchTimeout = setTimeout(async () => {
        try {
            const results = await api(`profiles/search?q=${encodeURIComponent(query)}`);
            displayProfiles(results.results);
        } catch (e) {
            console.error('Search failed:', e);
        }
    }, 300);
}
```

**Note:** The current implementation does NOT debounce search, which can cause API spam. Implement debouncing in production.

---

### Batch Operations Partial Success

Batch operations return per-item success/failure:

```javascript
const result = await api('profiles/batch/launch', {
    method: 'POST',
    body: JSON.stringify({ names: ['p1', 'p2', 'p3'] })
});

// Check for partial failures
if (result.failed.length > 0) {
    showToast(`Launched ${result.success.length}, ${result.failed.length} failed`, 'warning');
    // Display individual errors
    result.failed.forEach(f => {
        console.error(`${f.name}: ${f.error}`);
    });
}
```

---

## Error Handling

### HTTP Status Codes

| Code | Meaning | Common Scenarios |
|------|---------|------------------|
| 200 | OK | Successful GET, PUT, DELETE |
| 201 | Created | Successful POST |
| 400 | Bad Request | Invalid input, no fields to update |
| 401 | Unauthorized | Invalid/missing auth token |
| 404 | Not Found | Profile/proxy/folder/template not found |
| 409 | Conflict | Profile exists, profile running, proxy verification failed |
| 422 | Validation Error | Invalid request body format |
| 500 | Internal Server Error | Profile crashed, server error |

### Error Response Formats

**Standard error:**
```json
{
    "error": "Profile not found"
}
```

**FastAPI validation error:**
```json
{
    "detail": "validation error messages"
}
```

**Batch operation errors:**
```json
{
    "success": ["profile-1"],
    "failed": [
        {
            "name": "profile-2",
            "error": "Profile already running"
        }
    ]
}
```

---

## CORS Considerations

### Development Mode

In development, the frontend and backend run on different ports:
- Frontend: `http://localhost:5173` (Vite dev server) or similar
- Backend: `http://127.0.0.1:7331` (FastAPI)

**FastAPI CORS configuration is required:**

```python
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

### Production Mode

In production, Tauri serves the frontend from the same origin as the backend:
- Both served from: `http://127.0.0.1:{dynamic_port}`
- **No CORS issues** - same origin

### Tauri-Specific Behavior

When building with Tauri:
- WebView loads `http://127.0.0.1:{port}` from the backend
- No cross-origin requests
- Authentication tokens can be stored securely

---

## Frontend Integration Patterns

### Initial Data Loading Sequence

On application initialization, load data in this order:

```javascript
async function init() {
    try {
        // 1. Detect backend port (production)
        await detectBackendPort();

        // 2. Load core data in parallel
        await Promise.all([
            loadProfiles(),
            loadProxies(),
            loadFolders()
        ]);

        // 3. Load running status
        await loadRunning();

        // 4. Connect WebSocket for real-time updates
        connectWebSocket();

        // 5. Start polling for running status (fallback)
        startPolling();

        // 6. Setup visibility optimization
        setupVisibilityHandler();

    } catch (e) {
        console.error('Init failed:', e);
        showToast('Failed to initialize app', 'error');
    }
}
```

### State Management Pattern

Use global arrays for cached data with reload functions:

```javascript
// Global state
let PROFILES = [];
let FOLDERS = [];
let PROXIES = [];

// Load functions
async function loadProfiles() {
    const data = await api('profiles');
    PROFILES = data.map(formatProfile);
}

async function loadProxies() {
    const data = await api('proxies');
    PROXIES = Object.entries(data).map(([id, p]) => ({ id, ...p }));
}

// After mutations, reload affected data
async function launchProfile(name) {
    await api(`profiles/${name}/launch`, { method: 'POST' });
    await loadProfiles();  // Refresh profile data
    await loadRunning();   // Update running status
}
```

### Data Transformation Layer

Transform API responses into UI-friendly format:

```javascript
function formatProfile(apiProfile) {
    return {
        id: apiProfile.name,
        name: apiProfile.name,
        status: apiProfile.running ? 'running' : 'idle',
        os: apiProfile.os,
        proxy: apiProfile.proxy_label ? {
            label: apiProfile.proxy_label,
            status: apiProfile.proxy_ok ? 'ok' : 'fail',
            ping: apiProfile.proxy_ms
        } : null,
        tags: (apiProfile.tags || []).map(t => [t, 'blue']),
        launched: timeAgo(apiProfile.last_launched),
        count: apiProfile.launch_count || 0,
    };
}

function timeAgo(isoString) {
    if (!isoString) return 'Never';
    const now = new Date();
    const then = new Date(isoString);
    const diff = now - then;
    const mins = Math.floor(diff / 60000);
    const hrs = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    if (hrs < 24) return `${hrs} hr${hrs > 1 ? 's' : ''} ago`;
    return `${days} day${days > 1 ? 's' : ''} ago`;
}
```

### File Upload (CRX Extensions)

For multipart/form-data uploads:

```javascript
async function uploadExtension(file) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('enabled', 'true');

    const response = await fetch(`${API}/extensions`, {
        method: 'POST',
        body: formData  // Don't set Content-Type header for FormData
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error(err);
    }

    return response.json();
}
```

**Important:** Do NOT set `Content-Type: application/json` for FormData uploads. The browser sets it automatically with the correct boundary.

### Binary Response Handling (Extension Icons)

For binary responses like images:

```javascript
async function getExtensionIcon(extId) {
    const response = await fetch(`${API}/extensions/${extId}/icon`);

    if (!response.ok) {
        return null; // No icon available
    }

    const blob = await response.blob();
    return URL.createObjectURL(blob); // Creates blob:https://... URL
}

// Usage
const iconUrl = await getExtensionIcon('ext_123456');
document.getElementById('icon').src = iconUrl;

// Cleanup when done
URL.revokeObjectURL(iconUrl);
```

### Toast Notification Pattern

```javascript
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;

    document.getElementById('toast-container').appendChild(toast);

    // Auto-dismiss after 3 seconds
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 200);
    }, 3000);
}

// Toast types: 'info', 'success', 'warning', 'error'
showToast('Profile launched', 'success');
showToast('Failed to connect', 'error');
```

---

### API Wrapper Function

```javascript
let API = 'http://127.0.0.1:7331/api';

async function api(path, options = {}) {
    const o = {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...options?.headers,
        },
    };
    const r = await fetch(`${API}/${path}`, o);
    if (!r.ok) {
        const err = await r.text();
        throw new Error(err || `API error: ${r.status}`);
    }
    return r.json();
}
```

### Toast Notifications

```javascript
function showToast(msg, type = 'info') {
    // Create toast element
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = msg;
    
    // Append to container
    document.getElementById('toast-container').appendChild(toast);
    
    // Auto-dismiss after 3 seconds
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 200);
    }, 3000);
}
```

### Loading States

```javascript
// Disable button during operation
async function launchProfile(name, button) {
    button.disabled = true;
    try {
        await api(`profiles/${name}/launch`, { method: 'POST' });
        showToast(`Launched ${name}`, 'success');
    } catch (e) {
        showToast(e.message, 'error');
    } finally {
        button.disabled = false;
    }
}
```

### Real-time CDP Integration 🆕

Handle CDP information updates via WebSocket events for immediate UI updates without additional API calls.

```javascript
// Track CDP information for running profiles
let profileCDPInfo = {};  // { profileName: { cdp_port, cdp_url, cdp_ws_url } }

function handleWebSocketEvent(data) {
    switch (data.type) {
        case 'launch_progress':
            if (data.stage === 'complete') {
                // Store basic CDP info from launch complete
                const { cdp_port, cdp_url } = data.data;
                if (cdp_port && cdp_url) {
                    profileCDPInfo[data.profile] = {
                        cdp_port,
                        cdp_url,
                        cdp_ws_url: null  // Will be updated by cdp_ready
                    };
                    console.log(`[CDP] Basic info for ${data.profile}: ${cdp_url}`);
                    // Show basic CDP info in UI
                    updateProfileCDPDisplay(data.profile, {
                        cdp_port,
                        cdp_url,
                        ready: false
                    });
                }
            }
            break;

        case 'cdp_ready':
            // Update with complete CDP information including WebSocket URL
            const { cdp_port, cdp_url, cdp_ws_url } = data.data;
            if (profileCDPInfo[data.profile]) {
                profileCDPInfo[data.profile] = {
                    cdp_port,
                    cdp_url,
                    cdp_ws_url
                };
                console.log(`[CDP] Complete info for ${data.profile}: ${cdp_ws_url}`);
                // Update UI with complete CDP info
                updateProfileCDPDisplay(data.profile, {
                    cdp_port,
                    cdp_url,
                    cdp_ws_url,
                    ready: true
                });
            }
            break;

        case 'profile_stopped':
            // Clear CDP info when profile stops
            delete profileCDPInfo[data.profile];
            updateProfileCDPDisplay(data.profile, null);
            break;
    }
}

function updateProfileCDPDisplay(profileName, cdpData) {
    const profileCard = document.querySelector(`[data-profile="${profileName}"]`);
    if (!profileCard) return;

    const cdpSection = profileCard.querySelector('.cdp-section');
    if (!cdpData) {
        // Profile stopped - hide CDP section
        if (cdpSection) cdpSection.classList.add('hidden');
        return;
    }

    // Show CDP information
    cdpSection.classList.remove('hidden');
    const readyStatus = cdpData.ready ?
        '<span class="status-badge success">● Ready</span>' :
        '<span class="status-badge pending">◐ Connecting...</span>';

    cdpSection.innerHTML = `
        <div class="cdp-header">
            <h4>🔗 Chrome DevTools Protocol</h4>
            ${readyStatus}
        </div>
        <div class="cdp-details">
            <div class="cdp-field">
                <label>Port:</label>
                <span>${cdpData.cdp_port}</span>
            </div>
            <div class="cdp-field">
                <label>HTTP URL:</label>
                <code>${cdpData.cdp_url}</code>
                <button onclick="copyToClipboard('${cdpData.cdp_url}')" title="Copy">📋</button>
            </div>
            ${cdpData.cdp_ws_url ? `
            <div class="cdp-field">
                <label>WebSocket URL:</label>
                <code>${cdpData.cdp_ws_url}</code>
                <button onclick="copyToClipboard('${cdpData.cdp_ws_url}')" title="Copy">📋</button>
            </div>
            ` : ''}
        </div>
        <div class="cdp-actions" ${cdpData.ready ? '' : 'disabled'}>
            <button onclick="connectPlaywright('${cdpData.cdp_url}')" ${cdpData.ready ? '' : 'disabled'}>
                🔌 Connect Playwright
            </button>
            <button onclick="connectSelenium('${cdpData.cdp_port}')" ${cdpData.ready ? '' : 'disabled'}>
                🔌 Connect Selenium
            </button>
            <button onclick="openDevTools('${cdpData.cdp_url}')" ${cdpData.ready ? '' : 'disabled'}>
                🔧 Open DevTools
            </button>
        </div>
    `;
}

// External tool connection functions
async function connectPlaywright(cdpUrl) {
    try {
        // Example: Call your backend to establish Playwright connection
        const response = await fetch(`${API}/external/playwright`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cdp_url: cdpUrl })
        });
        const result = await response.json();
        if (result.ok) {
            showToast(`Playwright connected: ${result.browser_id}`, 'success');
        }
    } catch (e) {
        // Or provide direct connection info for user
        copyToClipboard(cdpUrl);
        showToast(`CDP URL copied! Use: chromium.connect_over_cdp("${cdpUrl}")`, 'info');
    }
}

function connectSelenium(cdpPort) {
    const seleniumCode = `from selenium import webdriver
from selenium.webdriver.chrome.options import Options

options = Options()
options.add_experimental_option("debuggerAddress", "localhost:${cdpPort}")
driver = webdriver.Chrome(options=options)`;
    copyToClipboard(seleniumCode);
    showToast(`Selenium code copied! Connect to port ${cdpPort}`, 'info');
}

function openDevTools(cdpUrl) {
    window.open(`${cdpUrl}/devtools/bundled/inspector.html`, '_blank');
}

// Fallback: If cdp_ready event is missed, fetch CDP info manually
async function fetchCDPInfoFallback(profileName) {
    try {
        const cdpData = await api(`profiles/${profileName}/cdp`);
        profileCDPInfo[profileName] = cdpData;
        updateProfileCDPDisplay(profileName, {
            ...cdpData,
            ready: true
        });
    } catch (e) {
        console.error(`Failed to fetch CDP info for ${profileName}:`, e);
    }
}

// Usage in profile launch
async function launchProfile(name) {
    try {
        const result = await api(`profiles/${name}/launch`, { method: 'POST' });
        showToast(`${name} launched (PID: ${result.pid})`, 'success');

        // CDP info will arrive via WebSocket events
        // If no cdp_ready event within 2 seconds, fetch manually
        setTimeout(() => {
            if (!profileCDPInfo[name] || !profileCDPInfo[name].cdp_ws_url) {
                console.warn(`CDP info not received for ${name}, fetching manually`);
                fetchCDPInfoFallback(name);
            }
        }, 2000);

    } catch (e) {
        showToast(`Failed to launch: ${e.message}`, 'error');
    }
}
```

**Benefits of WebSocket-based CDP updates:**
- **Instant UI updates** - No polling delay for CDP information
- **Reduced API calls** - Frontend receives CDP data via push notification
- **Better UX** - Connection buttons enabled immediately when CDP is ready
- **Fallback support** - Manual fetch if WebSocket event is missed

---

## JavaScript Code Examples

### Profile CRUD

```javascript
// Create profile
const newProfile = await api('profiles', {
    method: 'POST',
    body: JSON.stringify({
        name: 'my-profile',
        os: 'windows',
        timezone: 'America/New_York'
    })
});

// Update profile
await api('profiles/my-profile', {
    method: 'PUT',
    body: JSON.stringify({
        notes: 'Updated notes'
    })
});

// Delete profile
await api('profiles/my-profile', { method: 'DELETE' });
```

### Launch with Error Handling

```javascript
async function launchProfile(name) {
    try {
        const result = await api(`profiles/${name}/launch`, {
            method: 'POST'
        });
        
        // Handle crash window (first 15 seconds)
        await new Promise(resolve => setTimeout(resolve, 15000));
        
        // Verify still running
        const running = await api('running');
        if (running.includes(name)) {
            showToast(`${name} launched successfully`, 'success');
        }
    } catch (e) {
        if (e.message.includes('crashed')) {
            showToast(`${name} crashed during launch`, 'error');
        } else if (e.message.includes('proxy verification failed')) {
            showToast(`Proxy failed: ${e.message}`, 'error');
        } else {
            showToast(`Failed to launch: ${e.message}`, 'error');
        }
    }
}
```

### Proxy Testing

```javascript
async function testProxy(id) {
    try {
        const result = await api(`proxies/${id}/test`, {
            method: 'POST'
        });
        
        if (result.ok) {
            showToast(`Proxy OK (${result.latency_ms}ms, IP: ${result.external_ip})`, 'success');
        } else {
            showToast(`Proxy failed: ${result.error}`, 'error');
        }
    } catch (e) {
        showToast(`Test failed: ${e.message}`, 'error');
    }
}
```

### Batch Operations

```javascript
// Batch launch
async function batchLaunch(names) {
    const result = await api('profiles/batch/launch', {
        method: 'POST',
        body: JSON.stringify({ names })
    });
    
    if (result.failed.length === 0) {
        showToast(`Launched ${result.success.length} profiles`, 'success');
    } else {
        showToast(`Launched ${result.success.length}, ${result.failed.length} failed`, 'warning');
    }
}

// Batch tag assignment
await api('profiles/batch/tag', {
    method: 'POST',
    body: JSON.stringify({
        names: ['profile-1', 'profile-2'],
        tags: ['work', 'production'],
        action: 'add'
    })
});
```

---

## Reference Tables

### Database Schema Versions

| Version | Changes |
|---------|---------|
| v13 | Added `last_cdp_port` column to profiles table |
| v12 | Previous version (baseline) |

### CDP Port Allocation

**Per-profile dynamic port allocation:**
- Each running profile gets a unique CDP port
- Ports are allocated from available OS ports
- Port assignment is deterministic per launch (not reused)
- Last allocated port is stored in `last_cdp_port` database field

**Port lifecycle:**
1. **Launch**: Free port allocated using OS socket binding
2. **Runtime**: Port used for CDP connections
3. **Stop**: Port released, `last_cdp_port` retained
4. **Next launch**: New port allocated (different from previous)

### OS Types

| Value | Label |
|-------|-------|
| `windows` | Windows |
| `macos` | macOS |
| `linux` | Linux |

### Color Schemes

| Value | Description |
|-------|-------------|
| `light` | Light mode |
| `dark` | Dark mode |
| `system` | Follow system preference |

### Proxy Protocols

| Value | Description |
|-------|-------------|
| `http` | HTTP proxy |
| `https` | HTTPS proxy |
| `socks4` | SOCKS4 proxy |
| `socks5` | SOCKS5 proxy (default) |

### WebRTC Modes

| Value | Description |
|-------|-------------|
| `proxy_ip` | Use proxy's external IP |
| `disabled` | Disable WebRTC IP spoofing |

### Common Timezones

```
Africa/Nairobi, America/New_York, America/Los_Angeles,
America/Chicago, Europe/London, Europe/Paris,
Asia/Tokyo, Asia/Shanghai, Australia/Sydney
```

---

## Testing & Debugging

### Interactive API Documentation

**Swagger UI:**
```
http://localhost:7331/docs
```

**ReDoc:**
```
http://localhost:7331/redoc
```

### DevTools Integration

```javascript
// Log all API calls
async function api(path, options = {}) {
    console.log(`[API] ${options.method || 'GET'} ${path}`);
    
    const o = {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...options?.headers,
        },
    };
    
    const r = await fetch(`${API}/${path}`, o);
    
    if (!r.ok) {
        console.error(`[API Error] ${r.status}:`, await r.text());
        throw new Error(...);
    }
    
    const data = await r.json();
    console.log(`[API Response]`, data);
    return data;
}
```

---

## Quick Reference

### Common Operations

```javascript
// List profiles
const profiles = await api('profiles');

// List running
const running = await api('running');

// Create profile
await api('profiles', {
    method: 'POST',
    body: JSON.stringify({ name: 'new-profile' })
});

// Launch profile
await api(`profiles/${name}/launch`, { method: 'POST' });

// Stop profile
await api(`profiles/${name}/stop`, { method: 'POST' });

// Get CDP info for external tooling
const cdp = await api(`profiles/${name}/cdp`);
console.log(`CDP: ${cdp.cdp_http_url}`);

// Test proxy
await api(`proxies/${id}/test`, { method: 'POST' });

// Search
const results = await api(`profiles/search?q=work`);
```

---

## WebSocket Events Reference

### All 34 WebSocket Events

| Category | Event | Description |
|----------|-------|-------------|
| **Connection** | `connected` | WebSocket connection established |
| **Launch** | `launch_progress` | Launch stage updates (proxy_test, proxy_test_complete, initializing, launching_browser, downloading_browser, complete) |
| **Launch** | `profile_launched` 🆕 | Profile launch confirmation with PID |
| **CDP** | `cdp_ready` 🆕 | CDP WebSocket URL discovered (includes cdp_port, cdp_url, cdp_ws_url) |
| **Crash** | `profile_crashed` | Profile crashed during launch/runtime |
| **Stop** | `stop_start` | Stop operation initiated |
| **Stop** | `stop_progress` | Stop stage updates (terminating, killing) |
| **Stop** | `stop_complete` 🆕 | Stop operation completed |
| **Stop** | `profile_stopped` | Profile stopped (final confirmation) |
| **Pause** | `pause_start` | Pause operation initiated |
| **Pause** | `pause_progress` | Pause stage updates (terminating, killing, snapshot) |
| **Pause** | `profile_paused` | Profile paused successfully |
| **Resume** | `resume_start` | Resume operation initiated |
| **Resume** | `profile_resumed` | Profile resumed successfully |
| **Profile CRUD** | `profile_created` | New profile created |
| **Profile CRUD** | `profile_updated` | Profile configuration updated |
| **Profile CRUD** | `profile_deleted` | Profile permanently deleted |
| **Profile CRUD** | `profile_cloned` | Profile cloned to new profile |
| **Profile CRUD** | `profile_reset` | Profile browser data wiped |
| **Extension** | `extension_added` 🆕 | Extension uploaded/imported |
| **Extension** | `extension_deleted` 🆕 | Extension deleted |
| **Extension** | `extension_upload_progress` 🆕 | Upload progress (0-100%) |
| **Extension** | `extension_download_progress` 🆕 | Download progress (0-100%) |
| **Extension** | `extension_delete_progress` 🆕 | Deletion progress (0-100%) |
| **Profile Extension** | `profile_extension_added` 🆕 | Extension assigned to profile |
| **Profile Extension** | `profile_extension_removed` 🆕 | Extension removed from profile |
| **Folder** | `folder_created` | New folder created |
| **Folder** | `folder_updated` | Folder renamed/reordered |
| **Folder** | `folder_deleted` | Folder deleted |
| **Proxy** | `proxy_created` | New proxy added |
| **Proxy** | `proxy_updated` | Proxy configuration changed |
| **Proxy** | `proxy_deleted` | Proxy removed |
| **Proxy** | `proxy_tested` | Proxy connectivity test completed |
| **CDP** | `window_closed` | Browser window closed (via CDP) |
| **CDP** | `browser_crashed` | Browser crashed (via CDP) |

### Event Flow Diagrams

**Launch Flow:**
```
launch_progress (proxy_test) → launch_progress (proxy_test_complete) →
launch_progress (initializing) → launch_progress (launching_browser) →
[launch_progress (downloading_browser) if binary needed] → launch_progress (complete) →
profile_launched → cdp_ready (when CDP WebSocket URL discovered)
```

**Note:** `proxy_test` and `proxy_test_complete` stages are only sent if the profile has a proxy assigned. `downloading_browser` stage is only sent when CloakBrowser binary needs to be downloaded (first launch or update available).

**Stop Flow:**
```
stop_start → stop_progress (terminating) → [stop_progress (killing) if needed] → stop_complete → profile_stopped
```

**Pause Flow:**
```
pause_start → pause_progress (terminating) → [pause_progress (killing) if needed] → pause_progress (snapshot) → profile_paused
```

**Resume Flow:**
```
resume_start → profile_resumed
```

**Extension Upload Flow:**
```
extension_upload_progress (reading → validating → extracting → parsing_manifest → saving → complete) → extension_added
```

---

**Document Version:** 1.9
**Last Updated:** 2026-06-14 (Added CDP WebSocket events for real-time CDP updates, updated launch_progress complete stage with CDP fields, added cdp_ready event)
**API Version:** 11.0 (FastAPI)
**Total Endpoints:** 67 API endpoints + 34 WebSocket events (101 total)

## Summary of Coverage

This guide provides complete frontend integration documentation including:

✅ **All 67 API endpoints** (Profiles, Proxies, Folders, Templates, Extensions, System, Worker, License, CDP)
✅ **All 34 WebSocket events** (Profile lifecycle, CRUD, Pause/Resume, Extensions, Folders, Proxies, CDP events)
✅ **Real-time CDP updates** (cdp_ready event, CDP fields in launch_progress complete stage)
✅ **Authentication and security** (token-based auth, CORS)
✅ **Data models and TypeScript interfaces**
✅ **Error handling** (HTTP status codes, error formats)
✅ **Frontend integration patterns** (state management, data loading, file uploads, binary responses)
✅ **Best practices** (debouncing, visibility optimization, polling fallback)
✅ **JavaScript code examples** for all common operations
✅ **Testing and debugging** (Swagger UI, DevTools integration)
✅ **CDP integration** (Chrome DevTools Protocol endpoints, port allocation, external tool connections, WebSocket events)

## Additional Resources

- **Interactive API Documentation:** http://localhost:7331/docs (Swagger UI)
- **Backend API Status:** See API_STATUS.md for testing coverage
- **Project Setup:** See CLAUDE.md for development setup instructions
