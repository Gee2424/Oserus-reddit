# v0.7 changes

**Floating buttons on Reddit submit pages.** When a VA is on a Reddit post-creation page (URL contains `/submit`), three floating buttons appear in the bottom-LEFT corner of the browser (positioned away from Reddit's own Post button at bottom-right):

- **✍️ Compose** — opens the full AI-assisted composer in a side panel
- **💡 Ideas** — opens the lighter idea generator in a side panel
- **🟠 RedGifs** — opens an embedded RedGifs browser in a side panel (uses the active RedGifs account)

Side panels slide in from the right and overlay the browser — the Reddit page stays visible underneath. Close with × in the panel header.

The buttons ONLY appear on submit pages, so they don't clutter normal browsing.

**Locked tabs are now actually shared across all users.**

In Custom Web Pages, admins/managers can lock any tab with a "Lock & share" button. Locked tabs:
- Appear in every user's Custom Web Pages list, marked with 🔒
- Can only be edited or deleted by admins/managers
- Are visible in the sidebar above personal tabs

**Pre-login credentials for locked tabs.**

Each locked tab can have multiple pre-login credentials. When you click a locked tab in the sidebar, the credential bar appears under the URL bar showing username/password with copy buttons.

Each pre-login can be either:
- **Global** — visible to all users
- **Per model profile** — only visible to users who have an active account from that model profile

This means you can configure (for example) a "Twitter scheduler" locked tab with one set of credentials for Model A and a different set for Model B; each VA only sees the credentials for the model they're assigned to.

**RedGifs removed from Custom Web Pages.** It's now a floating button on the Reddit submit page, plus it's still accessible as its own RedGifs sidebar item. If your DB has an old per-user RedGifs locked tab, the migration deletes it automatically on first launch.

**Composer/Ideas no longer in the sidebar.** They live exclusively as side panels in the Reddit browser now, since that's where you actually use them.

## Install

Drop files into your existing project folder, keep your `%APPDATA%\reddit-manager\` data directory, run `npm run dev`. The DB migration runs silently:
- Adds the `locked_tab_credentials` table
- Removes any old per-user RedGifs locked tabs
