// Platform adapter registry — multi-platform autopilot contract.
//
// Every adapter implements the same surface so the coordinator never
// branches on `platform === 'reddit'` again. Required methods marked
// with [r]; optional with [o] (caller checks the capability flags).
//
//   id                                   - platform key
//   configured                           - false → engine skips it
//   capabilities                         - { post, comment, engagement, dm }
//
//   [r] async submitPost(args)           - { ok, id?, url?, error? }
//   [o] async pickTarget(account, mode)  - returns one content_source row
//                                          for "where to post". Default
//                                          implementation in helpers.js
//                                          picks one at random.
//   [o] async generateContent(args)      - { title, body, kind, url?, ... }
//                                          shaped for this platform.
//   [o] async runAutoComment(account)    - one comment cycle.
//
// args for submitPost are intentionally a wide union so adapters can
// ignore fields they don't care about. Reddit reads {subreddit, title,
// body, kind, url}; X reads {text}; IG/TT/RG read {caption, mediaPath}.

const reddit = require('./reddit');
const x = require('./x');
const instagram = require('./instagram');
const tiktok = require('./tiktok');

// Stub factory. Every platform we don't have a real adapter for goes
// here; the engine skips them cleanly instead of branching.
function stub(id, msg) {
  return {
    id,
    configured: false,
    capabilities: { post: false, comment: false, engagement: true, dm: false },
    async submitPost() { return { ok: false, error: msg || `${id} adapter not configured yet` }; },
  };
}

const ADAPTERS = {
  reddit,
  redgifs:   stub('redgifs',   'RedGifs autopilot intentionally disabled — operator opt-out.'),
  x,
  instagram,
  tiktok,
};

function getAdapter(platform) { return ADAPTERS[platform] || null; }

// List the platforms whose adapter is actually wired for posting.
// Coordinator uses this so it doesn't waste a tick on stubs.
function postablePlatforms() {
  return Object.values(ADAPTERS)
    .filter((a) => a.configured && (a.capabilities?.post !== false))
    .map((a) => a.id);
}

// List platforms whose adapter advertises comment support.
function commentablePlatforms() {
  return Object.values(ADAPTERS)
    .filter((a) => a.configured && a.capabilities?.comment)
    .map((a) => a.id);
}

module.exports = { getAdapter, ADAPTERS, postablePlatforms, commentablePlatforms };
