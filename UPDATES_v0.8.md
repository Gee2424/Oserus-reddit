# v0.8 — Oserus Management rebrand

**Renamed to Oserus Management.** New logo in the sidebar top-left and on the login screen.

**Green / black / gold theme** throughout. The old terracotta accents are replaced with:
- Deep forest green (`#3d6b4f`) — primary actions, active nav, accents
- Gold (`#d4a64a`) — highlights, status pills, gradients
- Near-black background with subtle green gradient ambient glow

**New Dashboard landing page.** When you sign in, you now land on a Dashboard with:
- Personalized greeting (Good morning/afternoon/evening + your name in green-to-gold gradient)
- Stat tiles: Models, Accounts, Ready / Warming / Paused counts, Proxies
- 4 large "Quick Action" selector cards that jump to Reddit, RedGifs, Models, or All Accounts

**Selector card pattern.** Big clickable tiles with icon + title + description + hover glow, inspired by the example you shared. Used on the dashboard and will be the basis for cleaning up other pages too.

**Refined sidebar.** Logo block at the top-left, grouped nav items (Overview, Manage, Operate, Configure), with active-state showing green-soft background + gold left accent bar + gold icon.

**Login screen redesigned.** Logo above the form, gradient "Welcome back" title in green-to-gold, ambient gradient glow in the background, OSERUS · MANAGEMENT footer tag.

**Everything else still works.** Reddit floating buttons, side panels (Compose / Ideas / RedGifs), per-account proxies, locked shared tabs with pre-logins, AI composer — all intact. Just the visual layer changed.

## Install
Drop new files into existing project folder, keep your `%APPDATA%\reddit-manager\` data directory, run `npm run dev`. No DB changes this round — purely UI.

Note: the data folder name is still `reddit-manager` (so you don't lose existing data). If you want to migrate it to `oserus-management` later, we can do that as a one-time copy.
