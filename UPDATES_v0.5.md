# v0.5 changes

**AI Post Composer.** The composer now has an SFW / NSFW toggle at the top:

- **SFW Warm-up mode** generates engagement posts for mainstream subreddits — questions, observations, casual stories. No promo, no model name, no OF references. For warming accounts to build karma. The AI picks from a global "warm-up subreddits" list that admins maintain.
- **NSFW Promo mode** generates promo post ideas for ready accounts. The AI picks subreddits from a per-model "promo subreddits" list. Each suggestion includes a title and an image direction (the VA still produces the actual content).

The composer auto-defaults to SFW mode when the active account is in `warming` status, and NSFW mode when it's `ready`.

**Two new subreddit list types:**
- **Warm-up subs (global)** — managed at Manage → Warm-up Subs. Seeded with 12 reasonable defaults (CasualConversation, NoStupidQuestions, AskReddit, Showerthoughts, etc.) that admins can add to or remove.
- **Promo subs (per model)** — managed on each Model Profile's detail page, in a new section at the bottom.

**Anthropic API key setup.** Admins paste their key once under Settings → Anthropic API key. Stored encrypted via the OS keychain. Without a key, the AI features are disabled but everything else works.

**"Improve with AI" button** on the title field. Generates 3 alternative phrasings of whatever the VA has typed, matched to the current mode and subreddit. Click an alternative to swap it in.

**Honest reminder shown under suggestions:** "These are starting points — edit before posting to make it sound like you." The AI gets you 80% there; the VA's edit makes it sound human.

**Bug fixes:**
- Composer now works for managers (was admin/assigned-creator only)
- Settings page no longer references a broken import API
- Old `profiles` table reference in posts.js fixed (was a leftover from the rename)

## Setup

1. Drop new files over the existing project folder, keep your `%APPDATA%\reddit-manager\` data folder
2. `npm install` (one new dependency was added at some point — adm-zip for bundles; if you already ran it before, nothing happens)
3. `npm run dev`
4. As admin: Settings → paste your Anthropic API key
5. Manage → Warm-up Subs to review the seeded defaults and add your own
6. Open any model → scroll to "NSFW promo subreddits" to add this model's targets
7. Open the composer with an account selected → click "Get ideas"
