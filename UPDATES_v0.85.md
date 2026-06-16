# v0.85 — Everything since the v0.8 rebrand

This is the consolidated update log for **v0.8 → v0.85.5**. Most operators
don't need the per-patch history; this is the "what changed in your app
since you last opened it" overview.

If the app you're running shows a version above 0.8 in the bottom-left of
the sidebar, this list covers what you got.

---

## 🌐 Oserus Browser (the big one)

A custom Chromium chrome that replaces the old "embedded webview" approach.
Looks like AdsPower / Opera GX, runs real Chromium underneath.

- **Frameless window, custom tab strip, bookmarks bar, find-in-page** —
  every account opens in its own browser window.
- **Each window is fully isolated** — separate cookies, separate
  localStorage, separate session partition. No cross-contamination
  between accounts on the same model or between models.
- **Antidetect fingerprint per model**:
  - Spoofed User-Agent + Sec-CH-UA brands that match the underlying
    Chromium version (no more "Chrome 131 banner on a Chrome 128 engine"
    mismatch flags).
  - Canvas + audio noise that's deterministic (passes the
    "read-twice-and-diff" tampering check).
  - WebGL UNMASKED_VENDOR / RENDERER spoofed to match the spoofed device.
  - Realistic plugin list (5 PDF viewer entries — empty plugin list is
    a strong bot tell on Chromium).
  - `navigator.webdriver = false`, Selenium / Puppeteer / Playwright
    leftover globals (`cdc_*`, `__webdriver_*`, etc.) stripped.
  - `RTCPeerConnection` patched to drop private ICE candidates, so
    WebRTC never leaks your local 192.168.x address.
- **Device profile picker** per model: Windows desktop, Android (Pixel 8 /
  Galaxy S24 / OnePlus 12 / Pixel 7a), or iPhone. One fingerprint per
  model — every platform account on the same model shares one identity,
  because a real person uses one device.
- **Live geo overlay**: every session prep probes the real proxy IP and
  overlays the matching timezone + language onto the fingerprint, so
  `Intl.DateTimeFormat` always agrees with what BrowserScan sees.
- **Proxy bridge** (`ipv4Bridge.js`): a universal local proxy that handles
  HTTP / HTTPS / SOCKS4 / SOCKS4a / SOCKS5 / SOCKS5h upstreams, with auth,
  with rotation URLs. Paste any format your residential provider gives
  you and it works.
- **DNS + WebRTC leak fix**: hostnames pass through to the upstream proxy
  unresolved (no system DNS lookup), and `disable_non_proxied_udp` blocks
  WebRTC from going around the proxy.
- **Bookmarks bar** with Reddit / X / IG / TikTok / Facebook / YouTube /
  Discord / Amazon / PayPal / LinkedIn / OnlyFans.
- **Inbox tab auto-opens** on launch — you see DMs immediately.
- **Content sidebar** — per-model curated media library, role-gated add.
- **Built-in BrowserScan check** to verify proxy + fingerprint authenticity
  before you start posting.
- **"Open all accounts" button** on a model launches every linked account
  in parallel windows.

## 🤖 Autopilot

Per-(model, platform) protocol that drives engagement + posting.

- **Pacing**: sessions/day, session min/max minutes, hours-between min/max,
  daily caps for posts and comments, quiet hours.
- **Engagement rates**: like %, follow %, watch-fully %, comment %.
- **Targeting**: min/max followers, verified-only, exclude-keyword list.
  Reddit-only: min upvote ratio, min post score, NSFW-only.
- **AI persona for comments**: Curious / Playful / Flirty / Dry / Custom.
- **AI provider picker**: Claude / OpenAI / Grok.
- **Engagement loop**: opens a hidden Chromium window as the account,
  scrolls real feeds, clicks like/follow, types AI comments at human
  cadence.
- **Posting loop**: AI generates content, submits via API (Reddit) or
  hidden browser (X / IG / TikTok).
- **Three manual buttons**: **Dry run** (preview without clicking),
  **Run engagement now**, **Post one now**.
- **Live next-tick countdowns** in the master banner.
- **Saving with the per-scope switch ON auto-starts the master loop** —
  no separate two-switch foot-gun.

⚠️ **Status**: the UI is in place and saves correctly. The end-to-end loop
is not yet reliable on every install. Treat it as a preview.

## 📅 Scheduler

- **Per-account post queue** as a kanban: Scheduled / Completed / Failed /
  Paused.
- **Composer** for title, body, link/image, when, kind.
- **Schedule to all preferred** for batch Reddit posting.
- **AI generation settings** (collapsed at the bottom of the page) tune
  persona, gender, age, length, custom prompt, CTA data.
- **Coordinator tick** every 60s fires due posts via the real platform
  API or browser.
- **Post lock** prevents two machines firing the same scheduled post.

⚠️ **Status**: the queue + composer work, but fire-on-time isn't yet
reliable. Watch posts when they're scheduled — don't trust unattended.

## 🔍 Intelligence (research)

- **Reddit gets three workspaces** in tabs: Discover / Requirements /
  Compatibility. X / IG / TikTok only have Discover.
- **Discover (Reddit)**: scrape posts → trend analysis → AI content plan.
- **Discover (X / IG / TikTok)**: tries to scrape via a hidden browser.
  Selectors break whenever those platforms change their DOM — expect
  empty results sometimes.
- **Requirements (Reddit only)**: scrape karma / age / rules per
  subreddit, cache for scheduler + autopilot eligibility checks.
- **Compatibility (Reddit only)**: shows which subs an account qualifies
  for, with reasons for the ones it fails.

## ☁️ Cloud Sync (Supabase)

Shared Supabase backend. Goal: every operator's machine sees the same
data in real time.

- **The build ships with the Supabase URL + publishable key baked in** —
  every install auto-connects. No per-machine setup.
- **24 tables sync**: users, model_profiles, reddit_accounts, proxies,
  all autopilot configs, scheduled posts, roles, role_permissions,
  settings, plus the activity / engagement event logs.
- **Realtime subscribe**: peer updates land in ~1–2s.
- **Push tick every 1.5s** + `markDirty()` to prod earlier after writes.
- **Auto-bootstrap on first launch**: pulls everything from Supabase the
  first time the app connects.
- **Auto-resync on version bump**: bumps every row's `updated_at` so a
  new build picks up any data older builds left at stale watermarks.
- **Per-table diagnostic** in Settings → Cloud Sync: green/red status,
  pushed/pulled counters, last error verbatim per table.
- **🔬 Diagnose button** — one-click full self-test, copyable text report.
- **Manual overrides**: Push now, Pull all, Force re-sync everything.

⚠️ **Status**: setup works, the diagnostic works, real-world multi-machine
sync still drops data occasionally. Use the per-table diagnostic to
investigate; the publishable key is baked into the build but the schema
SQL has to be run once on your Supabase project (Settings → Cloud Sync
→ Copy setup SQL → paste in Supabase SQL Editor → Run).

## 👥 Team & presence

- **Team Live table** on the Dashboard — every member with status,
  models, accounts, posts/comments today, karma 24h, **time on task**,
  last action.
- **Presence**: online / idle / offline based on a 20s heartbeat.
- **Time on task**: cumulative active seconds today, pauses after 5 min
  of no input, counts Oserus Browser windows as active.
- **Member drill-down**: click a row to see their assigned models with
  karma totals, their accounts, and their recent activity.

## 🧑‍💼 Roles & users

- **Two built-in roles**: Admin (full access), Operator (day-to-day —
  dashboard, models, autopilot, scheduler, intelligence, posting, no
  user/role/settings admin).
- **Custom roles**: create + edit from the Roles page with 28 fine-grained
  permission keys.
- **Roles list filter**: admin is excluded from the assignable list (you
  don't hand out admin via the role picker). The operator role is the
  default starter every new install ships with.
- **Permission preview**: admins can view the app "as another role" to
  confirm what each role sees.

## 📨 Inbox (Account Manager Pro)

- **Live polling** of every Reddit account's inbox every 60s.
- **Unread counts** in the sidebar per account.
- **Messaging templates + rules**: pattern-matched auto-replies with
  daily limits.
- **Inbox tab opens in the Oserus Browser** on every launch.

⚠️ **Status**: barely reliable. Polling drops messages, counts go stale,
auto-reply rules are inconsistent. Don't leave unattended.

## 📈 Analytics

- **Per-account karma snapshots** over time.
- **Cross-platform reach + engagement** rollups.

## 🛠️ Build / release pipeline

- **GitHub Actions** "Release Windows installer" workflow on
  `workflow_dispatch`. **No tag pushes** — Actions → Run workflow → pick
  the branch.
- **NSIS installer** for Windows x64.
- **electron-builder** packaging with `better-sqlite3` native rebuild.
- **Per-user install dir** (no admin password needed).
- **Auto-updater** checks GitHub releases and prompts to install.

## 🎨 Theme

Green / black / gold. Mirrored exactly between the management app and
the Oserus Browser so they read as one product. Full palette in
`src/renderer/styles/global.css` `:root` and in `BrowserShell.jsx`
`BRAND` constant.

---

## ✅ Recommended after install

1. **Walk every Model Profile** — open every linked account through the
   Oserus Browser, confirm proxy is applied (check BrowserScan), confirm
   fingerprint is clean.
2. **Run the setup SQL** in Supabase if you haven't (Settings → Cloud
   Sync → Copy setup SQL → paste in Supabase SQL Editor → Run).
3. **Open Cloud Sync → 🔬 Diagnose** on both machines. Green pill = sync
   loop running. Any red rows in the per-table view tell you what to fix.
4. **Schedule a test post** for 2 minutes from now and confirm it fires.
5. **Try "Post one now"** from Autopilot and confirm a post actually
   lands on the platform.
6. **Try Discover on X / Instagram / TikTok** — expect breakage. File
   what you see.

Anywhere a check fails, write down the step + the symptom. That's the
punch list for the next release.
