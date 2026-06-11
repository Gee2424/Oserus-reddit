# Oserus Management

Multi-platform account management for OnlyFans agencies — Reddit, RedGifs, X, Instagram, TikTok. Electron desktop app with browser-like tabs, per-account session + proxy isolation, credential vault, antidetect fingerprinting, and exportable profile bundles for sending to creators.

## Setup

Requires **Node.js 20+** ([nodejs.org](https://nodejs.org) — LTS).

**Mac/Linux:** `./install.sh`
**Windows:** `install.bat`

The installer rebuilds native modules automatically (no more sqlite errors).

To launch: `npm run dev`

Default login: `admin / changeme` — change it immediately under Settings.

## What's new in v0.2

- **Browser-like Reddit view** — multiple tabs, back/forward/refresh, address bar with search
- **Credential vault per Reddit account** — username, password, recovery email, all encrypted at rest using your OS keychain
- **One-click "Autofill" button** on the Reddit page — injects the saved password into Reddit's login form
- **Per-account proxy** — HTTP / HTTPS / SOCKS5, with optional auth. Each Reddit account routes through its own internet path.
- **Account statuses** — warming / ready / paused / banned, with filtering
- **Status indicators** in the account switcher (colored dots) and account list
- **Model Profiles** (the personas: Luna, Mia, etc.) vs **Team Profiles** (your workers) — properly separated
- **Profile export/import** — admin clicks "Export" on a model profile → gets a `.zip` with all credentials, accounts, proxies. Creator clicks "Load profile bundle" under Settings → drops the zip → everything loaded.
- **RedGifs locked tab** — always present in Custom Tabs, can't be removed
- **Team Profile editing** — display name, email, phone, notes, role; admin can reset passwords

## What's stubbed for next time

- Reddit API publishing (composer still saves drafts locally)
- Post Ideas generator
- Subreddit rule pre-check
- Auto-updater (planned next round)

## Project structure

```
src/
├── main/                       Electron main process
│   ├── index.js                window + session+proxy handler
│   ├── db.js                   SQLite + encryption (safeStorage)
│   └── ipc/
│       ├── auth.js             login, team profiles
│       ├── profiles.js         model profiles
│       ├── accounts.js         reddit accounts + credentials + proxy
│       ├── webviews.js         custom tabs (with locked support)
│       ├── posts.js            drafts
│       └── export.js           zip export/import
├── preload/index.js
└── renderer/
    ├── App.jsx
    ├── components/
    │   ├── Shell.jsx
    │   └── AccountSwitcher.jsx
    ├── lib/{auth,activeAccount}.jsx
    ├── pages/
    │   ├── Login.jsx
    │   ├── RedditView.jsx      Browser-like tabs + autofill
    │   ├── Webviews.jsx        Custom + locked tabs
    │   ├── Accounts.jsx        Credentials, status, proxy
    │   ├── Profiles.jsx        Model profiles + export/import
    │   ├── Users.jsx           Team profiles
    │   ├── Composer.jsx
    │   ├── Ideas.jsx
    │   └── Settings.jsx        Password change + import bundle
    └── styles/global.css
```

## Uninstall

`./uninstall.sh` (Mac/Linux) or `uninstall.bat` (Windows). Lists exactly what'll be deleted, asks confirmation, removes everything.

## Reddit ToS notes

What this app deliberately doesn't do:
- No vote manipulation
- No multi-account spray-posting (composer is one account at a time)
- No automated commenting / DMing
- No login form automation that mimics human typing (autofill just fills the saved value)

Each Reddit account uses Electron's isolated session partition + optional proxy, so accounts stay properly separated.
