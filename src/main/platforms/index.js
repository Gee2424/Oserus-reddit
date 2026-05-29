// Platform adapter registry.
//
// Every platform implements the same interface so the posting engine,
// coordinator, and future UI stay platform-agnostic:
//
//   {
//     id: 'reddit',
//     configured: boolean,                 // is this adapter usable yet?
//     async submitPost({ accountId, subreddit, title, body, kind, url }) -> { ok, id|error }
//     async fetchInbox({ accountId, folder }) -> { ok, messages|error }    (optional)
//     async sendDM({ accountId, to, text }) -> { ok|error }                (optional)
//     async getAnalytics({ accountId }) -> { ok, stats|error }             (optional)
//   }
//
// Adding a platform = add a file here and register it. No core changes.
// X / Instagram / TikTok are stubbed until their transport (browser
// automation vs official API) is wired — they report configured:false so
// the engine skips them cleanly instead of throwing.

const reddit = require('./reddit');

const stub = (id) => ({
  id,
  configured: false,
  async submitPost() { return { ok: false, error: `${id} adapter not configured yet` }; },
});

const ADAPTERS = {
  reddit,
  redgifs: stub('redgifs'),
  x: stub('x'),
  instagram: stub('instagram'),
  tiktok: stub('tiktok'),
};

function getAdapter(platform) {
  return ADAPTERS[platform] || null;
}

module.exports = { getAdapter, ADAPTERS };
