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
const x = require('./x');

const stub = (id, msg) => ({
  id,
  configured: false,
  async submitPost() { return { ok: false, error: msg || `${id} adapter not configured yet` }; },
});

const ADAPTERS = {
  reddit,
  redgifs: stub('redgifs'),
  x, // text + image-URL tweets via hidden BrowserWindow on the account's session
  instagram: stub('instagram', 'Instagram posting needs the native media-upload pipeline — currently engagement-only (scroll / like / follow runs today)'),
  tiktok: stub('tiktok', 'TikTok posting needs the native video-upload pipeline — currently engagement-only (scroll / like / follow runs today)'),
};

function getAdapter(platform) {
  return ADAPTERS[platform] || null;
}

module.exports = { getAdapter, ADAPTERS };
