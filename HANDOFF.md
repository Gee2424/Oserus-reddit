# Oserus Management — handoff to Claude Code

You're picking up an in-progress Electron desktop app built collaboratively with a previous Claude Code session over many turns. This document gets you up to speed.

Current version: **0.85.5**. See [`UPDATES_v0.85.md`](UPDATES_v0.85.md) for the user-facing recap of what's landed since v0.8.

---

## What this app is

A multi-platform account management tool for an OnlyFans agency. Supported platforms: Reddit, RedGifs, X (Twitter), Instagram, TikTok. The owner runs several models; each model has multiple platform accounts (some warming up, some "ready" for NSFW promo). Team members (operators, managers) log in and operate the accounts assigned to them.

The product name is **Oserus Management**. The logo lives at `src/renderer/assets/logo.png`. Theme is green / black / gold (palette in `src/renderer/styles/global.css` `:root` and mirrored in `src/renderer/browser/BrowserShell.jsx` `BRAND` constant).

---

## Architecture

**Stack:** Electron 32 + React 18 (renderer via Vite) + SQLite (better-sqlite3) + Supabase (`@supabase/supabase-js` + `ws`).

**Why Electron, specifically:** the core value of the app is per-account browser session isolation. Each linked platform account has its own Electron session partition (`persist:<partition_key>`) with its own cookies, optional proxy, antidetect preload, and spoofed UA. This lets one VA run 10 different Reddit / X / IG accounts simultaneously without cross-contamination. No web app can replicate this.

**Layout:**
```
src/
├── main/                        Electron main process
│   ├── index.js                 entry, window creation, app.commandLine switches
│   ├── browser.js               Oserus Browser host (one frameless BrowserWindow per account,
│   │                            WebContentsView per tab — NOT <webview> tags, so session
│   │                            partition / proxy / preload actually apply)
│   ├── antidetectPreload.js     per-account preload generator; written to userData/antidetect
│   ├── fingerprint.js           per-PROFILE fingerprint generator + applyGeoOverlay
│   ├── db.js                    SQLite init, schema, migrations, encryption helpers
│   ├── tray.js                  system tray icon
│   ├── updater.js               electron-updater wiring (GitHub releases provider)
│   ├── platforms/               adapter contract — reddit / x / instagram / tiktok
│   ├── services/
│   │   ├── coordinator.js       background job loop (autopilot, scheduler, engagement,
│   │   │                        karma, boosts, proxy-test, topic)
│   │   ├── sessionPrep.js       per-account session bind: proxy + UA + accept-language +
│   │   │                        antidetect preload + live geo probe through proxy
│   │   ├── ipv4Bridge.js        universal local proxy that handles HTTP/HTTPS/SOCKS4/4a/5/5h
│   │   ├── engagement.js        hidden-browser scroll / like / follow / comment loop
│   │   ├── platformGen.js       AI content generation (Claude / OpenAI / Grok with cascade)
│   │   ├── postgen.js           Reddit-specific post generator
│   │   ├── autopilotProtocol.js per-(profile, platform) protocol CRUD
│   │   ├── protocols.js         eligibility checks (quiet hours, daily caps, hours-between)
│   │   ├── redditAutoComment.js Reddit API-based commenting after engagement
│   │   ├── coordination.js      pluggable coordination backend (local SQLite or Supabase)
│   │   ├── discover.js          browser-based scraper for X / IG / TikTok
│   │   ├── contentSources.js    warm-up / promo content lists
│   │   ├── topicDiscovery.js    Reddit topic candidate cache
│   │   ├── deviceBridge.js      Android / iOS device emulation params
│   │   └── settings.js          KV settings table
│   ├── sync/
│   │   ├── defaultBackend.js    baked Supabase URL + publishable key
│   │   ├── supabase.js          start / stop / push / pull / realtime / autoBootstrap /
│   │   │                        per-table diagnostic / probe
│   │   ├── syncSchema.js        TEAM_SHARED table list + ensureUpdatedAtColumns migration
│   │   └── supabase-schema.sql  remote schema; operator runs it once in Supabase SQL Editor
│   └── ipc/                     ~30 IPC handler modules (one per feature surface)
├── preload/
│   ├── index.js                 main app contextBridge (every IPC channel surfaced)
│   ├── browser.js               Oserus Browser contextBridge
│   └── engagement.js            engagement-loop helpers
├── renderer/
│   ├── App.jsx                  top-level route switcher; installs cloud reload bridge
│   ├── components/              Shell, AccountSelector, PlatformExplainer, ProxiesPanel,
│   │                            HomepageTilesPanel, ExtensionsPanel, AutopilotAIPanel,
│   │                            ErrorBoundary, PopOutButton, ui.jsx (shared primitives)
│   ├── lib/                     auth context, activeAccount context, permissions hook,
│   │                            cloudReload bridge, inboxLive provider, platforms enum
│   ├── pages/                   Dashboard, Profiles, ModelDetail, AddAccounts, Autopilot,
│   │                            Automation, SchedulerPro, Intelligence, Inbox, Analytics,
│   │                            Settings, Users, Roles, Docs, RedGifsDashboard, RedditApi,
│   │                            Login
│   ├── browser/BrowserShell.jsx Oserus Browser chrome UI (frameless tabstrip + bookmarks bar
│   │                            + omnibox + content sidebar + proxy pill)
│   ├── browser-main.jsx         browser window React entry
│   ├── browser.html             browser window HTML host
│   └── styles/global.css        theme tokens
└── shared/
    └── permissions.js           PERMISSION_KEYS (28) + BUILTIN_ROLES (admin + operator)
```

**Roles:** built-in **admin** (every permission) and **operator** (day-to-day surfaces: dashboard, models, autopilot, scheduler, intelligence, posting, accounts CRUD, proxy view, upvote orders — explicitly NOT users/roles/settings/ai.admin). Custom roles created via the Roles page. Permissions enforced both in the renderer (sidebar filters, page guards) AND in every IPC handler. Renderer can't bypass.

**Encryption:** account passwords, proxy passwords, locked tab credentials, and API keys encrypted at rest via Electron's `safeStorage` (OS keychain on Mac/Win/Linux). Migrations are non-destructive and idempotent.

---

## What works and what doesn't

### Working reliably
- Oserus Browser (frameless Chromium chrome, per-account isolation, antidetect, proxy bridge)
- Models / accounts / proxies CRUD with role-gated permissions
- Per-profile fingerprint generation + live geo overlay
- Team dashboard with presence + time-on-task
- Dashboard activity feed
- Login, sessions, role assignment
- Analytics (karma snapshots, per-platform rollups)
- Auto-updater
- Cloud Sync wiring (the sync infrastructure works; see "fragile" below)

### Wired up but not yet reliable
- **Autopilot** — UI saves, dry run reports correctly, but the end-to-end engagement + posting loop is inconsistent across installs.
- **Scheduler** — composer + kanban work; the coordinator tick fires due posts via real adapters BUT in practice posts sometimes sit in the queue past their scheduled time.
- **Inbox (Account Manager Pro)** — polls every 60s, drops messages, unread counts go stale, template auto-replies are inconsistent.
- **Cloud Sync real-world performance** — push / pull / realtime / diagnostic all work, autoBootstrap pulls and force-resyncs as designed, but multi-machine convergence has dropped data in practice. The 🔬 Diagnose button in Settings → Cloud Sync surfaces the exact failing table when this happens.

### Platform-specific
- **Intelligence works on Reddit** (Discover / Requirements / Compatibility tabs). **X / IG / TikTok Discover** is brittle — relies on DOM selectors that break when platforms ship updates.

### Not built
- Image generation (deliberately out of scope; AI is text-only).
- Login-form automation (deliberately not built — too detectable).

---

## Critical product decisions to preserve

1. **No login-form typing automation.** Both Reddit and platform anti-bot systems detect form automation and ban accounts. Operators sign in manually in the Oserus Browser; cookies persist in the per-account session partition.
2. **No automated voting / spray-posting / karma farming bots.** Explicit choice. The app is positioned as "helps the team do their work cleanly," not "automates rule-breaking."
3. **No NSFW image generation.** Text only; operators provide their own media.
4. **Operator-friendly UX over feature density.** The owner is non-technical; their team is even less technical. Big buttons, plain language, no terminal.

---

## Cloud Sync mental model

- One Supabase project. URL + publishable key are baked into `src/main/sync/defaultBackend.js` so every install auto-connects on first launch.
- 24 tables sync (full list in `src/main/sync/syncSchema.js` `TEAM_SHARED`). Each gets an `updated_at INTEGER` epoch-millis watermark column added at runtime via `ensureUpdatedAtColumns()` and maintained by SQLite triggers.
- Push tick every 1.5s + `markDirty()` for early prods after writes.
- Realtime subscribe per table; peer updates land in ~1-2s.
- `autoBootstrap()` runs 1s after `start()` succeeds and does (a) a one-time `pullAll()` for new installs and (b) `forceResync()` when the app version changed since the last successful sync.
- Settings → Cloud Sync has Push now / Pull all / Force re-sync / 🔬 Diagnose buttons as escape hatches.

The setup SQL has to run on the Supabase project once (Settings → Cloud Sync → Copy setup SQL → Supabase SQL Editor → Run). The publishable key cannot run DDL, so this is a one-time human action.

---

## Build & release

GitHub Actions workflow `Release Windows installer` on `workflow_dispatch`. **Do not push git tags** — they're blocked in this environment. See [`PUBLISHING.md`](PUBLISHING.md).

All in-progress work happens on `claude/pensive-bell-VtMGj`. Main is updated by merging that branch (Claude can do this when the user asks).

---

## Default admin login (seeded on first run)

```
username: admin
password: changeme
```

Settings → Users → Change password on first launch.

---

## Tone of the user

The owner is non-technical and gets frustrated when things require manual steps. Two patterns to remember:

- They want things to **just work** after install — buttons in the UI when they're necessary, but the default path should require zero clicks.
- They're often running on a real production agency. When they say "X isn't working" it's a real bug report, not a hypothetical. Triage with the per-table diagnostic, electron-log, and screenshots they send.

When something silent-fails, surface a loud diagnostic, not another silent fallback.
