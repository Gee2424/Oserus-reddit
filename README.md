# Oserus Management

Multi-platform account management for OnlyFans agencies — Reddit, RedGifs, X, Instagram, TikTok. Electron desktop app with a custom Chromium chrome ("Oserus Browser"), per-account session + proxy isolation, antidetect fingerprinting per model, AI-driven autopilot + scheduling, and team sync via Supabase.

Current version: **0.85.5**. See [`UPDATES_v0.85.md`](UPDATES_v0.85.md) for everything that's landed since the v0.8 rebrand.

---

## Setup (developers)

Requires **Node.js 20+** ([nodejs.org](https://nodejs.org) — LTS).

**Mac / Linux:** `./install.sh`
**Windows:** `install.bat`

The installer rebuilds native modules automatically (`better-sqlite3`).

To launch in dev mode: `npm run dev`

Default login (seeded on first run): `admin / changeme` — change it under Settings → Users on first launch.

## For operators (installer)

The end-user .exe is built by GitHub Actions on demand. See [`PUBLISHING.md`](PUBLISHING.md) for the release flow. The auto-updater checks for new versions every 3 hours and prompts a restart silently.

---

## What's in the box

### Models, accounts, team
- Model profiles with brand voice, niche, notes, assigned operator
- Per-platform accounts linked to a model (Reddit / RedGifs / X / Instagram / TikTok), each with isolated session storage
- Credential vault (passwords + email passwords encrypted via OS keychain)
- Per-model proxy assignment that cascades to every linked account
- Two built-in roles (Admin / Operator) + custom roles with 28 fine-grained permissions

### Oserus Browser
- Frameless Chromium window with custom tab strip + bookmarks bar + find-in-page
- One window per account, fully isolated session partition
- Antidetect fingerprint per model: UA + Sec-CH-UA brands matched to underlying Chromium, deterministic canvas/audio/WebGL noise, realistic plugin list, `webdriver` flag stripped, RTCPeerConnection patched against ICE leaks
- Device profile picker per model: Windows desktop, Android (Pixel 8 / Galaxy S24 / OnePlus 12 / Pixel 7a), iPhone
- Live geo overlay: every session prep probes the real proxy IP and overlays the matching timezone + language onto the fingerprint
- Universal proxy bridge (`src/main/services/ipv4Bridge.js`) — HTTP / HTTPS / SOCKS4 / SOCKS4a / SOCKS5 / SOCKS5h with auth and rotation URLs
- DNS + WebRTC leak fixes
- Built-in BrowserScan check

### Autopilot ⚠ *not yet reliable end-to-end*
- Per-(model, platform) protocol: pacing, engagement rates, targeting, AI persona, lists
- Engagement loop: hidden browser scrolls, likes, follows, types AI comments at human cadence
- Posting loop: AI generates content, submits via API (Reddit) or hidden browser (others)
- Manual buttons: Dry run, Run engagement now, Post one now
- Live next-tick countdowns

### Scheduler ⚠ *not yet reliable end-to-end*
- Per-account post queue as a kanban (Scheduled / Completed / Failed / Paused)
- Coordinator tick every 60s fires due posts via API or browser
- Post lock prevents two machines racing the same post

### Intelligence
- Reddit: Discover / Requirements / Compatibility tabs (this is the stable path)
- X / IG / TikTok: Discover only, via browser scraping — selectors break when platforms change their DOM

### Inbox (Account Manager Pro) ⚠ *barely reliable*
- 60s polling of every Reddit account's inbox
- Messaging templates + rules with pattern-matched auto-replies and daily limits

### Cloud Sync (Supabase) ⚠ *fragile in practice*
- 24 tables sync across machines: users, model_profiles, reddit_accounts, proxies, autopilot configs, scheduled posts, roles, settings, etc.
- Realtime subscribe — peer updates land in ~1-2s
- Auto-bootstrap on first launch (pulls everything) and auto-resync on version bump (re-pushes everything)
- Per-table diagnostic + 🔬 Diagnose button + manual Push now / Pull all / Force re-sync overrides in Settings → Cloud Sync

### Team dashboard
- Team Live table: status, models, accounts, posts/comments today, karma 24h, **time on task**, last action
- Presence (online / idle / offline) driven by a 20s heartbeat
- Time on task is cumulative active seconds today, pauses after 5 min of no input, counts Oserus Browser windows

### Analytics
- Per-account karma snapshots over time
- Cross-platform reach + engagement rollups

---

## Project structure (current)

```
src/
├── main/                        Electron main process
│   ├── index.js                 entry, window creation, session prep
│   ├── browser.js               Oserus Browser host (frameless window + WebContentsView)
│   ├── antidetectPreload.js     generated per-account fingerprint preload
│   ├── fingerprint.js           per-profile fingerprint generator + geo overlay
│   ├── db.js                    SQLite init, schema, migrations
│   ├── tray.js                  system tray icon
│   ├── updater.js               electron-updater wiring
│   ├── platforms/               Reddit / X / IG / TikTok adapters
│   ├── services/
│   │   ├── coordinator.js       background job loop (autopilot, scheduler, engagement, karma)
│   │   ├── sessionPrep.js       per-account session bind + proxy + UA + preload
│   │   ├── ipv4Bridge.js        universal proxy bridge with IPv4-only DNS
│   │   ├── engagement.js        hidden-browser scroll/like/follow/comment loop
│   │   ├── platformGen.js       AI content generation (Claude / OpenAI / Grok)
│   │   ├── postgen.js           Reddit post generator
│   │   └── ... (autopilot, protocols, content sources, etc.)
│   ├── sync/
│   │   ├── defaultBackend.js    baked Supabase URL + publishable key
│   │   ├── supabase.js          push / pull / realtime / autoBootstrap
│   │   ├── syncSchema.js        TEAM_SHARED table list + ensureUpdatedAtColumns migration
│   │   └── supabase-schema.sql  remote schema to run once in Supabase SQL Editor
│   └── ipc/                     ~30 IPC handler modules
├── preload/
│   ├── index.js                 main app contextBridge
│   ├── browser.js               Oserus Browser contextBridge
│   └── engagement.js            engagement-loop helpers
├── renderer/
│   ├── App.jsx                  top-level route switcher + cloud reload bridge
│   ├── components/              Shell, AccountSelector, PlatformExplainer, ProxiesPanel, etc.
│   ├── lib/                     auth / activeAccount / permissions / cloudReload / inboxLive
│   ├── pages/                   Dashboard, Profiles, ModelDetail, AddAccounts, Autopilot,
│   │                            SchedulerPro, Intelligence, Inbox, Analytics, Settings,
│   │                            Users, Roles, Docs, RedGifsDashboard, RedditApi
│   ├── browser/BrowserShell.jsx Oserus Browser chrome UI
│   ├── browser-main.jsx         browser window React entry
│   └── styles/global.css        green/black/gold theme tokens
└── shared/permissions.js        permission keys + built-in role definitions
```

---

## Uninstall

`./uninstall.sh` (Mac/Linux) or `uninstall.bat` (Windows). Lists what'll be deleted, asks confirmation, removes everything.

## Platform conduct

What this app deliberately doesn't do:
- No vote manipulation
- No login-form-typing automation (login is manual via the in-app browser; credentials are copy-paste)
- No image generation (text only — operators provide their own media)

Per-account isolation via Electron session partitions + per-account proxies keeps accounts properly separated.
