# v0.6 changes

**Sidebar reorganized into sections.** Each platform and work area is now distinct:

- **Reddit** — opens a dedicated Reddit page with its own account switcher (only shows Reddit accounts). Inside, three tabs at the top: **Browse**, **Compose**, **Ideas**. Everything Reddit-related lives here.
- **RedGifs** — opens a dedicated RedGifs page with its own account switcher (only RedGifs accounts). Just browsing for now.
- **Work** — Custom Web Pages (formerly "Custom Tabs"). For any URL your VAs need quick access to.
- **Manage** — Model Profiles, All Accounts, Proxies, Warm-up Subs, Team, Settings.

**Independent platform switchers.** Reddit and RedGifs each remember their own active account separately. Switching the active Reddit account doesn't affect what RedGifs is showing, and vice versa.

**Credentials show automatically.** When you switch to an account that has saved credentials, the credential bar with copy buttons appears at the top of the browser. Combined with persistent session cookies, this means: log in once per account, and from then on the session stays logged in. Each subsequent visit you're already logged in. The credentials bar is there as a safety net if you ever need to re-enter them.

**No more global account switcher in the top bar.** Each browser page has its own platform-filtered switcher built right into its header, which is clearer about what you're switching.

## What's gone
- The standalone Composer page and Ideas page no longer exist as separate sidebar items. They're now tabs inside the Reddit page. The functionality is the same — just lives under "Reddit" where it belongs.

## Install
Drop the new files over your existing project folder, keep your `%APPDATA%\reddit-manager\` data directory, run `npm run dev`. No schema changes this round — just code reorganization.
