// Reddit platform adapter.
//
// Posts and comments through the account's logged-in Electron session
// partition — the same mechanism the Inbox uses (net.request with
// useSessionCookies + the session's modhash). No OAuth, no scraping:
// cookies authenticate us as that account exactly like the browser tab.
//
// Implements the full PlatformAdapter contract: submitPost,
// pickTarget, generateContent, runAutoComment. Other platforms cover
// the same surface in their own files.

const { partitionFor, request, modhashFor } = require('../services/redditSession');
const { getDb } = require('../db');
const contentSources = require('../services/contentSources');

const reddit = {
  id: 'reddit',
  configured: true,
  capabilities: { post: true, comment: true, engagement: true, dm: true },

  // ----------------------------------------------------------- submitPost
  async submitPost({ accountId, subreddit, title, body, kind = 'self', url }) {
    try {
      const acct = partitionFor(accountId);
      if (!acct) return { ok: false, error: 'Reddit account not found' };
      if (!subreddit || !title) return { ok: false, error: 'Subreddit and title are required' };
      const modhash = await modhashFor(acct.partition);
      if (!modhash) return { ok: false, notLoggedIn: true, error: 'Account not logged into Reddit' };

      const sr = String(subreddit).replace(/^\/?r\//i, '').trim();
      const isLink = kind === 'link' || kind === 'image';
      const params = {
        api_type: 'json',
        sr,
        title: String(title).slice(0, 300),
        kind: isLink ? 'link' : 'self',
        uh: modhash,
        resubmit: 'true',
        sendreplies: 'true',
      };
      if (isLink) params.url = url || '';
      else params.text = body || '';

      const data = await request(acct.partition, 'https://www.reddit.com/api/submit', {
        method: 'POST',
        modhash,
        form: new URLSearchParams(params).toString(),
      });
      const errs = data?.json?.errors || [];
      if (errs.length) return { ok: false, error: errs.map((e) => e[1] || e[0]).join('; ') };
      const out = data?.json?.data || {};
      return { ok: true, id: out.id || out.name || null, url: out.url || null };
    } catch (err) {
      if (err.message === 'NOT_LOGGED_IN') return { ok: false, notLoggedIn: true, error: 'Account not logged into Reddit' };
      return { ok: false, error: err.message };
    }
  },

  // ----------------------------------------------------------- pickTarget
  // Returns one content_sources row appropriate for the account's
  // current status. Returns null when no sources are configured —
  // coordinator treats null as "skip this account, log reason".
  async pickTarget(account) {
    const sources = contentSources.listForAccount(account);
    if (!sources.length) return null;
    return sources[Math.floor(Math.random() * sources.length)];
  },

  // ------------------------------------------------------ generateContent
  // Reddit uses the shared postgen pipeline. Returns the first
  // suggestion since the coordinator only posts once per pass per
  // account. `target` may be a content_sources row or null (random).
  async generateContent({ account, target }) {
    const { generatePost } = require('../services/postgen');
    const mode = account.status === 'ready' ? 'nsfw' : 'sfw';
    const res = await generatePost({
      accountId: account.id,
      mode,
      targetSubreddit: target?.name || null,
      autopilot: true,
    });
    if (!res.ok || !res.suggestions?.length) {
      return { ok: false, error: res.error || 'No suggestions generated' };
    }
    const pick = res.suggestions[0];
    return {
      ok: true,
      target: pick.subreddit || target?.name,
      title: pick.title,
      body: pick.body || '',
      kind: pick.kind || 'self',
    };
  },

  // -------------------------------------------------------- runAutoComment
  // Single comment cycle for one account on Reddit. Pulls a candidate
  // post from one of the account's auto_comment_protocols.target_subs,
  // generates a context-aware reply, and submits it. Logs every attempt
  // in auto_comment_runs. Returns { ok, error?, post?, comment? }.
  async runAutoComment(account, { dryRun = false } = {}) {
    const { runOnce } = require('../services/redditAutoComment');
    return runOnce(account.id, { dryRun });
  },
};

module.exports = reddit;
