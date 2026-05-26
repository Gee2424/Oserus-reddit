# Oserus Management — handoff to Claude Code

You're picking up an in-progress Electron desktop app built collaboratively with another Claude instance over many sessions. This document gets you up to speed.

---

## What this app is

A team Reddit + RedGifs account management tool for an OnlyFans agency. The owner runs several models; each model has multiple Reddit accounts (some warming up to build karma, some "ready" for NSFW promo) and RedGifs accounts. Team members (Reddit VAs, chatters, managers) log in and operate the accounts assigned to them.

The product name is **Oserus Management**. The logo lives at `src/renderer/assets/logo.png`. Theme is green/black/gold.

---

## Architecture

**Stack:** Electron 32 + React 18 (renderer via Vite) + SQLite (better-sqlite3) + Node.js IPC.

**Why Electron, specifically:** the core value of the app is per-account browser session isolation. Each linked Reddit/RedGifs account has its own `persist:reddit-...` Electron session partition with its own cookies, its own optional proxy, and its own user agent. This lets a VA log into 10 different Reddit accounts simultaneously without cross-contamination. No web app can replicate this; it's the reason this is a desktop app.

**Layout:**
```
src/
├── main/
│   ├── index.js              Electron entry, window creation, session prep, proxy setup
│   ├── db.js                 SQLite init, schema, migrations, encryption helpers (safeStorage)
│   └── ipc/
│       ├── auth.js           Login, users, roles, password mgmt
│       ├── profiles.js       Model profiles CRUD
│       ├── accounts.js       Reddit + RedGifs accounts CRUD (one table, platform column)
│       ├── proxies.js        Proxy CRUD; HTTP/HTTPS/SOCKS5
│       ├── subs.js           Warm-up subreddits (global) + promo subreddits (per-model)
│       ├── ai.js             Anthropic API calls for post suggestions (SFW/NSFW modes)
│       ├── webviews.js       Custom Web Pages + locked shared tabs + per-tab credentials
│       ├── posts.js          Post drafts CRUD
│       └── bundle.js         Model profile export/import as .zip
├── preload/index.js          contextBridge surface for the renderer
└── renderer/                 React UI (Vite)
    ├── App.jsx               Top-level route switcher
    ├── components/           Shell, AccountSwitcher, ComposerPanel, IdeasPanel, RedGifsPanel
    ├── lib/                  auth context, activeAccount context (Reddit + RedGifs tracked separately)
    ├── pages/                Dashboard, Login, Profiles, ModelDetail, Accounts, RedditBrowser,
    │                         RedGifsBrowser, Webviews, Proxies, Subreddits, Users, Settings
    ├── styles/global.css     Theme tokens (green/black/gold) + selector-card pattern
    └── assets/logo.png
```

**Roles:** admin, manager, reddit_va, chatter. Permissions enforced both in the renderer (sidebar filters, page guards) AND in every IPC handler in the main process. The renderer can't bypass.

**Encryption:** all sensitive secrets (account passwords, proxy passwords, locked tab credentials, Anthropic API key) are encrypted at rest via Electron's `safeStorage` (OS keychain on Mac/Win/Linux). Migrations handled gracefully on launch.

---

## Notable features that already work

- **Per-account session isolation** via Electron session partitions, including proxy routing per account
- **Reddit browser** with multi-tab support, URL bar, credentials helper
- **Floating buttons on Reddit submit pages** (bottom-LEFT corner, away from Reddit's own Post button) — Compose, Ideas, RedGifs — that open side panels sliding in from the right
- **RedGifs browser** — separate page AND accessible from the floating button on Reddit submit
- **AI composer** with SFW (warm-up) and NSFW (promo) modes, pulling from the right subreddit lists; uses Anthropic API; key configured in Settings
- **Model profile detail page** with separate Reddit and RedGifs account sections, "Start" buttons (▶) that set account active + navigate to the browser
- **Profile export/import** as plain-text zip bundles (so admin can hand a profile to a new device)
- **Locked tabs** in Custom Web Pages — admin-shared, with optional pre-login credentials (global or per-model-profile)
- **Status filters** everywhere: warming / ready / paused / banned

## What's stubbed / not yet built

- **Reddit API publishing.** The composer saves drafts and schedule times locally but does NOT push posts to Reddit. Implementation plan: per-account Reddit OAuth (script-type app), in-app scheduler that fires when the app is running.
- **Subreddit rule pre-check.** Should hit `/r/{sub}/about.json` and `about/rules.json` before publishing to flag NSFW-required, flair-required, min-karma, etc.
- **Shadowban detection.**
- **Server sync.** Everything is local SQLite right now. If multi-device sync is needed later, the swap point is `src/main/ipc/*` — replace DB queries with HTTP calls to a backend.
- **Auto-update.** Not yet configured. This is one of the immediate next steps (see below).
- **Windows installer (.exe).** Not yet built. Also a next step.

## Critical product decisions to preserve

1. **NO auto-fill of login forms.** Both Reddit and RedGifs detect form automation and ban accounts. Credentials live in a "copy buttons" bar above the embedded browser — the VA copy-pastes manually. The user explicitly asked for auto-fill at one point; we explained the risk and they agreed to the copy-button approach.
2. **NO posting via browser automation.** Same reason. When Reddit publishing is added, it must use Reddit's official API with proper rate limiting.
3. **No vote manipulation, no spray-to-many-subs tools, no karma farming bots.** Explicit choice. The app is positioned as "helps VAs do their work cleanly," not "automates rule-breaking."
4. **NSFW image generation is off the table.** Image generation APIs (including Anthropic's) refuse it, and the user agreed. AI generates text only; VA provides images themselves.
5. **The user wants this to "feel like a real Redditor's tool"** — natural-sounding post titles, varied phrasing, no AI-flavored copy. Important when prompting Claude in the AI handler.

---

## Immediate next steps the user wants you to do

In this order:

### 1. Set up a private GitHub repo for the project
- Walk the user through making a GitHub account if they don't have one (they said they have one but I'm not 100% sure)
- Create a private repo named `oserus-management`
- They are on Windows. Recommend GitHub Desktop unless they want CLI
- Push the current code

### 2. Write the electron-builder config for a Windows installer
- Update `package.json` `build` config: NSIS installer, Start Menu shortcut, desktop icon, proper app name and icon, uninstaller
- Convert `src/renderer/assets/logo.png` into a Windows `.ico` for the app icon
- Test build with `npm run build` — should produce `Oserus Management Setup.exe` in `dist/`

### 3. Add auto-update via GitHub Releases
- Add `electron-updater` package
- Wire up update checks: on launch + every 3 hours while running
- When update found: download silently, then notify VA with a non-intrusive prompt ("Update ready, restart to apply")
- Apply on next close or on user click
- User specifically said: **check every 3 hours, run in background**

### 4. Publishing workflow
- Document how the user pushes updates: bump version in package.json → commit → push → `npm run publish` → done
- Every VA's installed copy updates within 3 hours

## Things to be careful about

- **The logo file.** `src/renderer/assets/logo.png` is a properly transparent RGBA PNG that I processed from a JPEG the user originally provided. The user's source exports (from whatever design tool they use) come through as JPEGs with a `.png` extension and a baked-in black background — not actual transparent PNGs. If the user sends a "new logo" and it appears boxed in black on the sidebar, run `file path/to/logo.png` to check — if it says "JPEG image data" it needs the background removal treatment. The script I used:
  ```python
  from PIL import Image
  import numpy as np
  im = Image.open('input.png').convert('RGBA')
  arr = np.array(im)
  max_chan = np.maximum(np.maximum(arr[...,0], arr[...,1]), arr[...,2])
  # Soft alpha ramp from 25 to 70 brightness gives clean anti-aliased edges
  alpha = np.clip((max_chan.astype(np.int32) - 25) * (255 // 45), 0, 255).astype(np.uint8)
  arr[..., 3] = alpha
  Image.fromarray(arr, 'RGBA').save('output.png', 'PNG', optimize=True)
  ```
  Then downscale to ~800px wide to keep the bundle small (the source files are typically 6000+ px).
- **Don't break existing data.** Users may have `%APPDATA%\reddit-manager\` (the data folder is still under that name even after the rebrand). Migration logic in `db.js` is non-destructive and idempotent — keep it that way. There's a `users` table `creator` → `reddit_va` migration that already ran on most installs; don't undo it.
- **Don't change product decisions in the "critical" list above without checking with the user first.** Several of those were debated and settled.
- **The user is non-technical.** Walk them through commands. Don't assume they know what `git` or `npm` is. They've been very patient with the workflow so far — keep it patient.
- **They want the .exe to feel like installing Spotify** — no terminal, no `npm` for them, double-click installer, Start Menu shortcut, that's it.

## Things the user has asked for but I deferred or scoped down

- "Mobile app" — explained why it can't work (app store policies for adult content, no embedded webview + session isolation on iOS, etc.). Settled on desktop-only.
- "Auto-login to Reddit/RedGifs with stored password" — explained ban risk, switched to copy-button credential helper. Don't bring back form automation.
- "Make Claude have GitHub access in chat" — clarified this isn't possible in the chat product, which is why they're moving to Claude Code now.

## Versioning so far

- v0.1 → scaffold
- v0.2 → credentials vault, per-account proxies, RedGifs locked tab, account statuses, profile export/import
- v0.3 → 4-role system (admin/manager/reddit_va/chatter), auto-migration from old "creator" role
- v0.4 → RedGifs accounts linked to models, Start buttons, separate Reddit/RedGifs browsers
- v0.5 → AI composer with SFW/NSFW modes, Anthropic API integration, warm-up + promo subreddit lists
- v0.6 → Section restructure (Reddit/RedGifs/Work/Manage), platform-aware switcher
- v0.7 → Floating buttons on Reddit submit pages, side panels, shared locked tabs with pre-login credentials
- v0.8 → **Oserus Management rebrand**, green/black/gold theme, logo integration, dashboard landing page, selector card pattern

Read UPDATES_v0.*.md for fuller per-version notes.

## Default admin login (seeded on first run)

```
username: admin
password: changeme
```

Settings → Change password on first launch.

---

Good luck. The user is friendly and patient but easily gets ahead of themselves wanting to add new features before testing existing ones. If they start asking for big new features, gently nudge them to confirm what's already working first.
