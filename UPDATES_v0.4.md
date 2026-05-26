# v0.4 changes

**RedGifs accounts linked to model profiles.** Each model profile now has two lists: Reddit accounts and RedGifs accounts. Both use the same fields (username, password, status, proxy, etc.) and the same isolated-session pattern, so logins stay separated per account.

**New "Model Detail" page.** Clicking any model card on the Model Profiles page now opens a detail view showing:
- The model's info (niche, brand voice, notes)
- All linked Reddit accounts with quick controls
- All linked RedGifs accounts with quick controls
- "Link Reddit account" and "Link RedGifs account" buttons (admins/managers)

**▶ "Start" buttons on every account.** One click sets that account as active, prepares its session (proxy, cookies), and jumps to the embedded browser pointed at the right platform's home page. Reddit accounts open reddit.com, RedGifs accounts open redgifs.com. They handle login themselves — no auto-fill, no bot-detection risk.

**The embedded browser is now platform-aware.** When you start a RedGifs account, the browser opens redgifs.com. When you switch accounts, the browser refreshes to the right platform's home. The sidebar label changed from "Reddit" to "Browser" since it serves both platforms.

**Account switcher shows platform** with small REDDIT / REDGIFS chips and the right username prefix (u/ vs @).

**Existing accounts auto-migrated.** A migration adds a `platform` column to the accounts table on first launch. All your existing Reddit accounts get `platform = 'reddit'` so nothing breaks.

**Install:** Drop new files over the existing folder, keep your `%APPDATA%\reddit-manager\` directory, run `npm run dev`. Migration runs silently.
