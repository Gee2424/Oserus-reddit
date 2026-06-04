// Discover adapter for non-Reddit platforms. Opens a hidden BrowserWindow on
// the chosen scraper account's session and runs a platform-specific scraping
// script. Returns the same { posts: [...] } shape the renderer's Discover
// panel already understands so the rest of the page (analyze + plan) just
// works.
//
// Each platform's selectors are best-effort; X / IG / TikTok churn their DOM
// every few weeks. When a scrape returns empty we surface that to the UI so
// the user knows to update selectors rather than thinking the keyword had no
// matches.

const { BrowserWindow } = require('electron');
const { getDb } = require('../db');

const PLATFORM_URL = {
  x:         (q) => `https://x.com/search?q=${encodeURIComponent(q || '')}&src=typed_query&f=top`,
  twitter:   (q) => `https://x.com/search?q=${encodeURIComponent(q || '')}&src=typed_query&f=top`,
  instagram: (q) => q.startsWith('@')
    ? `https://www.instagram.com/${encodeURIComponent(q.slice(1))}/`
    : `https://www.instagram.com/explore/tags/${encodeURIComponent(q.replace(/^#/, ''))}/`,
  tiktok:    (q) => q.startsWith('@')
    ? `https://www.tiktok.com/@${encodeURIComponent(q.slice(1))}`
    : `https://www.tiktok.com/tag/${encodeURIComponent(q.replace(/^#/, ''))}`,
};

// Per-platform DOM scrape. Each returns a flat array of { id, title, author,
// score, num_comments, url, created } so the rest of the Discover flow
// (analyze + plan) can read them uniformly.
const SCRAPE_SCRIPTS = {
  x: `(() => {
    const posts = [];
    const cards = document.querySelectorAll('article[data-testid="tweet"]');
    cards.forEach((el, i) => {
      const text = el.querySelector('div[data-testid="tweetText"]')?.innerText || '';
      const author = el.querySelector('div[data-testid="User-Name"] a')?.innerText || '';
      const link = el.querySelector('a[href*="/status/"]')?.href || '';
      const id = (link.match(/status\\/(\\d+)/) || [])[1] || ('x-' + i);
      const stats = el.querySelectorAll('div[role="group"] span[data-testid$="-count"]');
      const score = Number((el.querySelector('button[data-testid="like"] span')?.innerText || '0').replace(/[^0-9.]/g, '')) || 0;
      const replies = Number((el.querySelector('button[data-testid="reply"] span')?.innerText || '0').replace(/[^0-9.]/g, '')) || 0;
      if (text) posts.push({ id, title: text.slice(0, 280), author: author.replace(/^@/, ''), score, num_comments: replies, url: link });
    });
    return posts.slice(0, 50);
  })()`,
  instagram: `(() => {
    const posts = [];
    // Hashtag / explore page: post tiles under article.
    const tiles = document.querySelectorAll('article a[role="link"][href*="/p/"], a[role="link"][href*="/reel/"]');
    tiles.forEach((a, i) => {
      const href = a.href || '';
      const id = (href.match(/(?:p|reel)\\/([^/]+)/) || [])[1] || ('ig-' + i);
      const alt = a.querySelector('img')?.alt || '';
      const meta = (a.querySelectorAll('li, span')[0]?.innerText) || '';
      posts.push({ id, title: alt.slice(0, 280), author: '', score: 0, num_comments: 0, url: href });
    });
    return posts.slice(0, 50);
  })()`,
  tiktok: `(() => {
    const posts = [];
    const items = document.querySelectorAll('div[data-e2e="challenge-item"], div[data-e2e="recommend-list-item-container"]');
    items.forEach((el, i) => {
      const title = el.querySelector('div[data-e2e="challenge-item-desc"]')?.innerText
                 || el.querySelector('div[data-e2e="video-desc"]')?.innerText
                 || el.innerText.split('\\n')[0];
      const handle = el.querySelector('a[href^="/@"]')?.getAttribute('href') || '';
      const author = handle.replace(/^\\/@/, '').split(/[/?]/)[0];
      const link = el.querySelector('a[href*="/video/"]')?.href || '';
      const id = (link.match(/video\\/(\\d+)/) || [])[1] || ('tt-' + i);
      const likes = Number((el.querySelector('strong[data-e2e="like-count"], strong[data-e2e="challenge-vvcount"]')?.innerText || '0').replace(/[^0-9.]/g, '')) || 0;
      if (title) posts.push({ id, title: String(title).slice(0, 280), author, score: likes, num_comments: 0, url: link });
    });
    return posts.slice(0, 50);
  })()`,
};

async function scrape({ accountId, platform, keyword, settleMs = 4500 }) {
  const db = getDb();
  const acct = db.prepare(
    `SELECT id, partition_key, platform FROM reddit_accounts WHERE id = ?`
  ).get(accountId);
  if (!acct) return { ok: false, error: 'Account not found' };

  const urlFor = PLATFORM_URL[platform];
  const script = SCRAPE_SCRIPTS[platform];
  if (!urlFor || !script) return { ok: false, error: `Discover adapter for ${platform} not configured` };

  try {
    const { prepareSessionForAccount } = require('./sessionPrep');
    await prepareSessionForAccount(accountId);
  } catch {}

  const partition = `persist:${acct.partition_key}`;
  const url = urlFor(keyword || '');

  const win = new BrowserWindow({
    width: 1180, height: 820,
    show: false,
    webPreferences: {
      partition,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  let posts = [];
  let err = null;
  try {
    await win.loadURL(url);
    // Let the SPA hydrate. X / IG / TikTok are all heavy client-rendered.
    await new Promise((r) => setTimeout(r, settleMs));
    // Scroll a bit to surface more results.
    try {
      await win.webContents.executeJavaScript(`(async () => {
        for (let i = 0; i < 6; i++) { window.scrollBy(0, 900); await new Promise(r => setTimeout(r, 600)); }
      })()`);
    } catch {}
    posts = await win.webContents.executeJavaScript(script);
    if (!Array.isArray(posts)) posts = [];
  } catch (e) {
    err = e.message;
  } finally {
    try { win.destroy(); } catch {}
  }

  if (err) return { ok: false, error: err };
  return { ok: true, posts };
}

module.exports = { scrape };
