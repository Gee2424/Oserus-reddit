// Per-platform DOM selectors for the engagement harness.
//
// Extracted from engagement.js so the in-page script body stays
// generic. Markup changes regularly on these sites — that's the cost
// of DOM-driven automation. When a platform breaks, only this table
// needs updating.
//
// Required fields per platform:
//   post           feed-item container (anything matching becomes a candidate)
//   like           the like button or its icon
//   follow         the follow button on the post (skipped if already-following)
//   caption        the visible caption / title text
//   creator        creator handle anchor (visible username)
//   commentBtn     element that opens the comment surface (null = no commenting)
//   commentInput   textarea or contenteditable that accepts the reply
//   commentSubmit  the "post" button next to the input
//   isVideo        a selector that matches when the post contains video
//
// Setting commentBtn/Input/Submit to null disables commenting on that
// platform — Reddit uses the API path (redditAutoComment) so DOM
// commenting there is intentionally skipped.

const SELECTORS = {
  instagram: {
    post:    'article, div[role="presentation"]',
    like:    'svg[aria-label="Like"]',
    follow:  'button._acan._acap._acas',
    caption: 'h1, span[dir="auto"]',
    creator: 'a[role="link"][tabindex="0"]',
    commentBtn:    'svg[aria-label="Comment"]',
    commentInput:  'textarea[aria-label="Add a comment…"], textarea[aria-label^="Add a comment"]',
    commentSubmit: 'div[role="button"]:not([aria-disabled="true"])',
    isVideo: 'video',
  },
  tiktok: {
    post:    'div[data-e2e="recommend-list-item-container"]',
    like:    'span[data-e2e="like-icon"]',
    follow:  'button[data-e2e="follow-button"]',
    caption: 'div[data-e2e="browse-video-desc"], h1[data-e2e="browse-video-desc"]',
    creator: 'a[data-e2e="browse-username"], h3[data-e2e="browse-username"]',
    commentBtn:    'span[data-e2e="comment-icon"]',
    commentInput:  'div[contenteditable="true"][data-e2e="comment-text"], div[contenteditable="true"]',
    commentSubmit: 'div[data-e2e="comment-post"]',
    isVideo: 'video',
  },
  x: {
    post:    'article[data-testid="tweet"]',
    like:    'button[data-testid="like"]',
    follow:  'button[data-testid$="-follow"]',
    caption: 'div[data-testid="tweetText"]',
    creator: 'div[data-testid="User-Name"] a',
    commentBtn:    'button[data-testid="reply"]',
    commentInput:  'div[data-testid="tweetTextarea_0"]',
    commentSubmit: 'button[data-testid="tweetButton"]',
    isVideo: 'video, div[data-testid="videoComponent"]',
  },
  reddit: {
    post:    'shreddit-post, div[data-testid="post-container"]',
    like:    'button[aria-label="upvote"]',
    follow:  'button[aria-label="Join"]',
    caption: 'h1, h3',
    creator: 'a[href^="/user/"]',
    commentBtn:    null,  // Reddit commenting goes through the API path.
    commentInput:  null,
    commentSubmit: null,
    isVideo: 'video, shreddit-player',
  },
  redgifs: {
    post:    'div.PreviewVideo, div.GifPreview',
    like:    'button.btn-like, button[aria-label="like" i]',
    follow:  'button.btn-follow, button[aria-label="follow" i]',
    caption: '.tags, h1',
    creator: 'a.userName, a[href^="/users/"]',
    commentBtn:    null,
    commentInput:  null,
    commentSubmit: null,
    isVideo: 'video',
  },
};

const PLATFORM_URL = {
  instagram: 'https://www.instagram.com/reels/',
  tiktok:    'https://www.tiktok.com/foryou',
  x:         'https://x.com/home',
  reddit:    'https://www.reddit.com/',
  redgifs:   'https://www.redgifs.com/',
};

function selectorsFor(platform) { return SELECTORS[platform] || SELECTORS.instagram; }
function urlFor(platform)       { return PLATFORM_URL[platform] || PLATFORM_URL.instagram; }

module.exports = { SELECTORS, PLATFORM_URL, selectorsFor, urlFor };
