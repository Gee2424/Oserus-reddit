# Oserus — Architecture Audit (v0.85.5)

Honest map of what's actually in the repo, what's reliable, what's
flaky, and what the next debloat pass should cut. Updated as releases
land. Last refreshed at v0.85.5.

---

## Pages (src/renderer/pages/)

| File | Status | Verdict |
|---|---|---|
| Dashboard.jsx | live | keep — command center + Team Live |
| Login.jsx | live | keep |
| Profiles.jsx | live | keep — model list |
| ModelDetail.jsx | live | keep — per-model management (UX cohesion pass landed in 0.83.0) |
| AddAccounts.jsx | live | keep — bulk paste / direct input / in-app login |
| Autopilot.jsx | live ⚠ | end-to-end loop not yet reliable; UI was redesigned in 0.82.0–0.83.0 |
| Automation.jsx | live | thin wrapper — consider folding into Autopilot |
| SchedulerPro.jsx | live ⚠ | composer + kanban work; coordinator tick fires posts but reliability is inconsistent |
| Intelligence.jsx | live | Reddit Discover/Requirements/Compatibility solid; X/IG/TikTok Discover is brittle |
| Inbox.jsx | live ⚠ | polling drops messages, counts go stale — barely reliable |
| Analytics.jsx | live | keep |
| Settings.jsx | live | keep — hosts Cloud Sync diagnostic + AI keys + roles preview |
| Users.jsx | live | keep — Team subtab |
| Roles.jsx | live | keep — Team subtab |
| Docs.jsx | live | keep — per-model notes + AI plan parking |
| RedditApi.jsx | live | keep — Account Manager Pro outer shell |
| RedGifsDashboard.jsx | live | keep — minimal |

The big consolidation moves from the v0.52 audit (drop Accounts.jsx,
Operations.jsx, ModelHub.jsx, Subreddits.jsx, Webviews.jsx) all
shipped. The page list is now clean.

## IPC handlers (~30 modules across src/main/ipc/)

Active, reliable:
- `auth`, `profiles`, `accounts`, `proxies`, `roles`, `team`, `activity`
- `protocols`, `autopilotProtocol`, `autoComment`, `engagement`
- `scheduled`, `posts`, `cloud`, `subs`, `homepage`
- `analytics`, `examples`, `intelligence`, `inbox`
- `ai`, `docs`, `messaging`, `templates`
- `bundle` (export/import), `devices`, `extensions`
- `webviews` (now thin — bookmarks only), `reddit`, `redgifs`
- `votes` (upvote.biz orders)

Debloat candidates (each is small, each is rarely used):
- `votes.js` — paid upvote orders. Niche feature; if your team isn't using upvote.biz, drop it.
- `extensions.js` — browser extension installer for Oserus Browser. Niche.
- `bundle.js` — export profile bundle as .zip. Useful for handoff but not used in normal flow.
- `templates.js` — schedule templates table is in sync but the UI / coordinator wiring is incomplete.
- `messaging.js` — messaging templates + rules; tied to the unreliable Inbox.
- `examples.js` — per-account voice library; large surface, only consumed by the unreliable Autopilot AI persona.

## Tables (SQLite, src/main/db.js + ipc/*)

24 CREATE TABLE statements. Active and used:
- `users`, `roles`, `role_permissions`, `auth_sessions` — auth
- `model_profiles` (now holds the canonical fingerprint + os_profile + geo cache per the 0.84 refactor)
- `reddit_accounts` (still carries duplicate fingerprint_json / os_profile / geo_* columns — candidate to drop after a migration)
- `proxies`
- `autopilot_protocols` (the canonical autopilot config; per profile × platform)
- `scheduled_posts`
- `karma_snapshots`
- `subreddit_intel`
- `content_sources`
- `warmup_subreddits`, `promo_subreddits`
- `homepage_tiles`
- `docs`
- `settings` (kv)
- `activity_log`, `post_events`, `auto_comment_runs`, `engagement_sessions` — event logs

Legacy / superseded but still present (deletion candidates):
- `engagement_protocols`, `auto_comment_protocols` — superseded by `autopilot_protocols`
- `posting_protocols` — superseded by `autopilot_protocols`
- `autopilot_prompts` — composite PK with nullable; can't currently sync
- `post_drafts` — no UI exposes it
- `webview_tabs`, `locked_tab_credentials` — old custom-tabs feature
- `messaging_templates`, `messaging_rules`, `messaging_rule_fires`, `schedule_templates` — wired but tied to unreliable surfaces
- `account_example_posts`, `account_example_images`, `account_example_comments` — voice library (tied to Autopilot)
- `reddit_topic_candidates`, `redgifs_profiles` — caches
- `upvote_orders` — boost log (tied to votes.js)

## Cloud sync surface (src/main/sync/)

- **24 tables in `TEAM_SHARED`** including the 4 event-log tables (`activity_log`, `post_events`, `auto_comment_runs`, `engagement_sessions`). Those four generate hundreds-to-thousands of rows/day and probably shouldn't sync — they're only consumed by the Dashboard activity feed, which can read local.
- **`users` syncs heartbeat data** (`last_seen_at`, `today_seconds`, `today_date`) every 20s per logged-in operator. Probably should split into a non-synced `user_presence` table.
- **`settings` syncs API keys** (Anthropic, OpenAI, Grok). Pulls admin's keys to every operator's machine. Probably should split into `settings.local` and `settings.synced`.
- **`fingerprint_json` is duplicated** on `model_profiles` AND `reddit_accounts` after the 0.84 per-profile refactor. Per-account column is dead but still synced.
- **Push tick is 1.5s** — aggressive for a desktop app; 5s would be more than fast enough.
- **Three heartbeats** (renderer auth 20s, browser process 20s, cloud presence 15s) overlap. Consolidate to one.

The diagnostic + autoBootstrap + per-table push reporting all work
correctly. The pipeline is sound; the table list and tick rates are
what need trimming.

## Phased debloat plan (proposed)

Each phase is one PR-sized commit, verified before the next.

1. **Drop the 4 event-log tables from sync** — cuts an estimated 70% of bandwidth.
2. **Split `users` into `users` + `user_presence`** — stop syncing heartbeat churn.
3. **Drop API keys from synced settings** — security + bandwidth.
4. **Drop the three legacy protocol tables from sync** (`engagement_protocols`, `auto_comment_protocols`, `posting_protocols`).
5. **Drop redundant fingerprint columns from `reddit_accounts`** schema + sync.
6. **Push tick 1.5s → 5s**, consolidate the three heartbeats.
7. **Walk IPC files** — delete `votes.js`, `extensions.js`, `bundle.js` if unused (with the page they back).
8. **Walk SQLite tables** — drop the legacy ones the codebase no longer touches.
9. **Audit the 28 permission keys** — drop ones no IPC actually checks.

See the more user-facing debloat narrative in the post-handoff
discussion in `claude/pensive-bell-VtMGj` history (search for
"debloats").

---

This file is the contract. Anything done that isn't on this list goes
back through "Verify feature exists / reachable / works / not
duplicated" before it's called done.
