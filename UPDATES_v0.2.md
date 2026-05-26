# v0.2 changes

This is a substantial update on top of v0.1. Things added:

**Automatic rebuild on install** — `npm install` now runs `electron-rebuild` automatically via the `postinstall` hook. The "NODE_MODULE_VERSION mismatch" error you hit before won't happen again. If you already have v0.1 installed, just run `npm install` again with the new package.json.

**RedGifs is locked** — RedGifs is now a permanent tab under Custom Tabs for every user. It can't be removed. New users get it automatically.

**Credentials vault** — Each Reddit account can store its username, password, linked email, and email password. They're encrypted on disk using your OS keychain (Electron's `safeStorage` API — Keychain on Mac, DPAPI on Windows, libsecret on Linux). When browsing as that account, a 🔑 button opens a credential helper that shows username/password with one-click copy buttons.

**Per-account proxies** — Admins manage a list of proxies under the new Proxies page (HTTP, HTTPS, or SOCKS5; authentication supported). Each Reddit account can be assigned one. When the active account changes, Electron reconfigures the session's network proxy automatically. The account switcher shows which proxy each account uses.

**Browser-like tabs inside Reddit** — Multiple tabs within the Reddit view, plus back/forward/reload. All tabs share the active account's session.

**Account statuses** — Every account has a status: `warming`, `ready`, `paused`, or `banned`. Visible as colored dots everywhere accounts appear. Filterable in the account switcher and accounts page. Edit inline with a dropdown.

**Model profiles vs Team profiles** — "Models" are the OF creator personas (with niche, brand voice, color, account counts). "Team" is your workers/admins. Two separate pages.

**Export / Import profile bundles** — On any model profile, admins can click Export and save a `.zip` containing the profile, all its accounts (with credentials), and the proxies they use. Sending that file to another instance and clicking Import recreates everything. The bundle is plain text inside the zip — treat it like a password file.

**Auto-update is NOT in this build** — we agreed to handle that in a follow-up with GitHub setup, once you've tested this version and decided whether to commit to building installers.
