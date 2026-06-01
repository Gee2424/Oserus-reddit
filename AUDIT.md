# Oserus — Architecture Audit (v0.52.0)

Honest map of what's in the repo right now, what's duplicated, what's
abandoned, and what the next rebuild pass should consolidate. Updated as
phases land.

---

## Pages (src/renderer/pages/)

| File | Status | Routes that mount it | Verdict |
|---|---|---|---|
| Dashboard.jsx | live | `dashboard` | keep · command center |
| Profiles.jsx | live | `profiles` | keep · model list |
| ModelDetail.jsx | live | `model` | keep · per-model management |
| ModelHub.jsx | live (legacy) | `model-hub` | **DUPLICATE of ModelDetail** — fold into ModelDetail or drop |
| UnifiedBrowser.jsx | live | `browser`, `reddit`, `redgifs-browse` | keep |
| SchedulerPro.jsx | live | `scheduler-pro`, `scheduler`, `votes`, embedded in RedditApi posting tab | keep · the only scheduler |
| RedditApi.jsx | live (Account Manager Pro) | `inbox`, `reddit-api`, `accounts`, `scheduler` | keep · its Posting tab embeds SchedulerPro (redundant with sidebar Scheduler) |
| Inbox.jsx | live (embedded) | (always via RedditApi) | keep |
| Intelligence.jsx | live | `intel`, `scraper` | keep |
| Analytics.jsx | live | `analytics` | keep |
| Activity.jsx | live | `activity` | keep |
| Autopilot.jsx | live | `autopilot` | keep |
| Settings.jsx | live | `settings` | keep |
| Team.jsx | live | `users` | keep |
| Docs.jsx | live | `docs` | keep |
| AddAccounts.jsx | dead-ish | `add-accounts` only | **REVIEW** — sidebar entry removed, only reachable via deep link |
| Subreddits.jsx | dead-ish | `subreddits` only | **REVIEW** — no sidebar entry, content absorbed into Intelligence |
| Webviews.jsx | dead-ish | `webviews` only | **REVIEW** — no sidebar entry |
| RedGifsDashboard.jsx | live | `redgifs`, `redgifs-dashboard` | **REVIEW** — content reachable via UnifiedBrowser too |
| **Accounts.jsx** | dead | none | **DELETE** — no imports |
| **Operations.jsx** | dead | none | **DELETE** — no imports |
| **Users.jsx** | dead | none | **DELETE** — Team.jsx replaced it |
| **Roles.jsx** | dead | none | **DELETE** — no imports |

## Routes (App.jsx switch)

Live routes that should consolidate:
- `inbox` + `reddit-api` + `accounts` + `scheduler` all render RedditApiPage
  with different initial tabs → keep RedditApi but drop legacy aliases
- `infra` + `proxies` + `votes` all alias to Settings/Scheduler now → drop
  from public surface
- `model` + `model-hub` → pick one

## IPC handlers (127 total across src/main/ipc/)

Duplicate / overlap candidates:
- `votes:*` — upvote.biz handlers; will become `boost:*` when generalized
- `subs:listWarmup`/`subs:listPromo` — warmup_subreddits + promo_subreddits
  tables, only consumed by the orphan Subreddits.jsx page
- `webviews:*` — only consumed by the orphan Webviews.jsx page
- `posts:*` (post_drafts) vs `scheduled:*` (scheduled_posts) — two
  parallel post stores; only `scheduled:*` is reachable today

## Tables (sqlite, src/main/db.js + migrations)

Active:
- `users`, `roles`, `role_permissions`, `auth_sessions` — auth (keep)
- `model_profiles`, `profile_assignments` — models (keep)
- `reddit_accounts` — every-platform accounts (rename later, schema is fine)
- `proxies` — proxy pool (keep)
- `scheduled_posts` — the unified scheduler (keep)
- `post_events`, `post_locks`, `posting_protocols` — coordinator (keep)
- `schedule_templates` — pro schedules (keep)
- `messaging_templates` — canned inbox replies (keep)
- `karma_snapshots` — manual karma history (keep, automate next)
- `redgifs_profiles` — RedGIFs profile cache (keep)
- `subreddit_intel` — Intelligence cache (keep)
- `settings` — kv store (keep)
- `activity_log` — audit (keep)
- `locked_tab_credentials` — old webview tab creds (dead with Webviews.jsx)
- `webview_tabs` — same
- `warmup_subreddits` / `promo_subreddits` — only fed by Subreddits.jsx
- `docs` — Documentation page (keep)
- `post_drafts` (`posts` IPC) — parallel to scheduled_posts, unused
- `upvote_orders` — boost log; barely written, candidate for unification
  into `scheduled_posts.boost_*`

## Phased plan (proposed)

Each phase = one PR-sized commit, fully verified before the next.

1. **Dead code purge** (this commit)
   - Delete Accounts.jsx, Operations.jsx, Users.jsx, Roles.jsx (no imports)
   - Drop the legacy `accounts` and `scheduler` route aliases that point
     at RedditApi — `inbox` already covers it
   - Audit this file (AUDIT.md) committed as the canonical reference

2. **Model consolidation**
   - Merge ModelHub into ModelDetail (single per-model page)
   - Drop `model-hub` route (alias → `model`)
   - Verify every "Open hub"/"Open profile" link points at `model`

3. **Account Manager Pro vs Scheduler de-dup**
   - Decide: sidebar Scheduler OR Account Manager Pro Posting tab — not both
   - Recommendation: keep sidebar Scheduler, drop Posting tab from AMP
     (AMP becomes Inbox-only)

4. **Boost generalization** (`votes` → `boost`)
   - Rename IPC namespace, generalize provider list, drop `upvote_orders`
     table in favor of `scheduled_posts.boost_*` (already there)

5. **Subreddits/Webviews removal**
   - Both pages are orphan. Decision: drop the pages, keep the data
     tables for now (they back Intelligence)

6. **Scheduler eligibility pre-check** (new feature)
   - Hook `subreddit_intel` requirements into `runDueScheduled` so
     under-karma/under-age posts skip with a clear failed reason

7. **Auto karma + Star User scrape** (new feature)
   - One daily request per account → fills `karma_snapshots` + sets
     `starred` automatically. Kills the manual button on Analytics

8. **Cupid AI / messaging automation** (new feature)
   - `messaging_rules` table + matcher inside `inbox:fetch` to auto-reply
     from `messaging_templates`. UI lives inside Inbox

9. **Multi-platform Intelligence**
   - Scraper tab gets TikTok / IG / X panels with their own request
     paths (Reddit ships first, others are scaffolded but disabled
     until adapter lands)

10. **Content Planning workflow**
    - Research → review → select findings → generate plan (Grok). Plan
      saves to `model_docs`. No auto-generation

---

This file is the contract. Anything done that isn't on this list goes back
to "Verify feature exists / reachable / works / not duplicated" before it's
called done.
