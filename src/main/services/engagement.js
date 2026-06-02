// Engagement runner — drives a hidden BrowserWindow on a per-account session
// and runs platform-specific scroll / like / follow / watch scripts.
//
// The scripts intentionally pace themselves with random delays and skip large
// fractions of posts so the behavior doesn't read as a bot. Selectors are
// best-effort and may need touch-ups as Instagram / TikTok / X change their
// markup; that's normal for any browser-driven automation and we surface
// failures via engagement_sessions.error.
const { BrowserWindow } = require('electron');
const { getDb } = require('../db');

const PLATFORM_URL = {
  instagram: 'https://www.instagram.com/',
  tiktok:    'https://www.tiktok.com/foryou',
  x:         'https://x.com/home',
  reddit:    'https://www.reddit.com/',
  redgifs:   'https://www.redgifs.com/',
};

function pickRandom(min, max) { return min + Math.floor(Math.random() * (max - min + 1)); }

// Build the in-page script. Uses Object literals for the protocol knobs so
// the engagement loop is configured per-call.
function buildScript(platform, opts) {
  const cfg = JSON.stringify(opts);
  // The big body — same harness for every platform, plus platform-specific
  // selectors. Returns { posts_seen, likes, follows } via the resolved value.
  const SELECTORS = {
    instagram: {
      post:   'article',
      like:   'svg[aria-label="Like"]',
      follow: 'button._acan._acap._acas',
    },
    tiktok: {
      post:   'div[data-e2e="recommend-list-item-container"]',
      like:   'span[data-e2e="like-icon"]',
      follow: 'button[data-e2e="follow-button"]',
    },
    x: {
      post:   'article[data-testid="tweet"]',
      like:   'button[data-testid="like"]',
      follow: 'button[data-testid$="-follow"]',
    },
    reddit: {
      post:   'shreddit-post, div[data-testid="post-container"]',
      like:   'button[aria-label="upvote"]',
      follow: 'button[aria-label="Join"]',
    },
    redgifs: {
      post:   'div.PreviewVideo, div.GifPreview',
      like:   'button.btn-like, button[aria-label="like" i]',
      follow: 'button.btn-follow, button[aria-label="follow" i]',
    },
  };
  const sel = SELECTORS[platform] || SELECTORS.instagram;
  const selJSON = JSON.stringify(sel);

  return `(async () => {
    const cfg = ${cfg};
    const sel = ${selJSON};
    const stats = { posts_seen: 0, likes: 0, follows: 0, errors: [] };
    const start = Date.now();
    const endBy = start + cfg.sessionSeconds * 1000;
    const seen = new WeakSet();

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const rnd   = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
    const roll  = (pct) => Math.random() * 100 < pct;

    // Map the follow list to lowercase usernames for cheap matching.
    const followSet = new Set((cfg.followList || []).map((s) => String(s).replace(/^@/, '').toLowerCase()));

    // Scroll the feed a humane amount. Doesn't slam scrollTop in one shot —
    // tiny increments so anti-bot heuristics don't fire.
    async function softScroll(px) {
      const steps = rnd(3, 8);
      const each = Math.floor(px / steps);
      for (let i = 0; i < steps; i++) {
        window.scrollBy({ top: each, left: 0, behavior: 'auto' });
        await sleep(rnd(80, 220));
      }
    }

    try {
      while (Date.now() < endBy) {
        const posts = Array.from(document.querySelectorAll(sel.post));
        for (const p of posts) {
          if (seen.has(p)) continue;
          seen.add(p);
          stats.posts_seen++;

          // Watch random posts longer (simulating reading / watching reels).
          const watchMs = roll(cfg.watchFullRatePct) ? rnd(4500, 11000) : rnd(700, 2200);
          await sleep(watchMs);

          // Like a slice of posts.
          if (roll(cfg.likeRatePct)) {
            const likeBtn = p.querySelector(sel.like);
            if (likeBtn) {
              try {
                (likeBtn.closest('button, [role="button"], a') || likeBtn).click();
                stats.likes++;
                await sleep(rnd(400, 1200));
              } catch (e) { stats.errors.push('like:' + e.message); }
            }
          }

          // Follow a slice of accounts; if a follow list is configured, only
          // follow accounts whose username appears on the list.
          if (roll(cfg.followRatePct)) {
            const followBtn = p.querySelector(sel.follow);
            if (followBtn && !/following/i.test(followBtn.textContent || '')) {
              const handle = (p.querySelector('a[href^="/"]')?.getAttribute('href') || '').replace(/^\\//, '').split('/')[0].toLowerCase();
              const allowed = followSet.size === 0 || followSet.has(handle);
              if (allowed) {
                try {
                  followBtn.click();
                  stats.follows++;
                  await sleep(rnd(800, 1800));
                } catch (e) { stats.errors.push('follow:' + e.message); }
              }
            }
          }

          if (Date.now() >= endBy) break;
        }

        await softScroll(rnd(600, 1400));
        await sleep(rnd(400, 1300));
      }
    } catch (e) {
      stats.errors.push('loop:' + e.message);
    }
    return stats;
  })()`;
}

async function runSession(accountId, { dryRun = false } = {}) {
  const db = getDb();
  const acct = db.prepare(
    `SELECT id, username, partition_key, platform FROM reddit_accounts WHERE id = ?`
  ).get(accountId);
  if (!acct) return { ok: false, error: 'Account not found' };
  const proto = db.prepare(`SELECT * FROM engagement_protocols WHERE account_id = ?`).get(accountId);
  if (!proto) return { ok: false, error: 'No engagement protocol configured' };

  const url = PLATFORM_URL[acct.platform] || PLATFORM_URL.instagram;
  const minMin = Math.max(1, proto.session_minutes_min || 6);
  const maxMin = Math.max(minMin, proto.session_minutes_max || 14);
  const sessionSeconds = pickRandom(minMin, maxMin) * 60;

  let followList = [];
  let hashtags = [];
  try { followList = JSON.parse(proto.follow_list_json || '[]'); } catch {}
  try { hashtags = JSON.parse(proto.hashtags_json || '[]'); } catch {}

  // Re-prepare the partitioned session (cookies/proxy/UA) so the engagement
  // window lands logged in.
  try {
    const main = require('../index');
    if (main.prepareSessionForAccount) await main.prepareSessionForAccount(accountId);
  } catch {}

  const partition = `persist:${acct.partition_key}`;
  // For hashtag platforms (TikTok / Instagram), pick one to focus on per session.
  let landingUrl = url;
  if (hashtags.length && (acct.platform === 'tiktok' || acct.platform === 'instagram')) {
    const tag = String(hashtags[Math.floor(Math.random() * hashtags.length)]).replace(/^#/, '');
    landingUrl = acct.platform === 'tiktok'
      ? `https://www.tiktok.com/tag/${encodeURIComponent(tag)}`
      : `https://www.instagram.com/explore/tags/${encodeURIComponent(tag)}/`;
  }

  const insert = db.prepare(
    `INSERT INTO engagement_sessions (account_id, platform) VALUES (?, ?)`
  );
  const sessionRow = insert.run(acct.id, acct.platform);
  const sessionId = sessionRow.lastInsertRowid;

  const win = new BrowserWindow({
    width: 1180, height: 820,
    show: false,
    webPreferences: {
      partition,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const startedAt = Date.now();
  let stats = { posts_seen: 0, likes: 0, follows: 0, errors: [] };
  let err = null;
  try {
    await win.loadURL(landingUrl);
    await new Promise((r) => setTimeout(r, 4000)); // settle
    if (dryRun) {
      stats = { posts_seen: 0, likes: 0, follows: 0, errors: ['dry-run, no actions'] };
    } else {
      const script = buildScript(acct.platform, {
        sessionSeconds,
        likeRatePct: Math.max(0, Math.min(100, proto.like_rate_pct ?? 18)),
        followRatePct: Math.max(0, Math.min(100, proto.follow_rate_pct ?? 4)),
        watchFullRatePct: Math.max(0, Math.min(100, proto.watch_full_rate_pct ?? 25)),
        followList,
      });
      stats = await win.webContents.executeJavaScript(script);
    }
  } catch (e) {
    err = e.message;
  } finally {
    try { win.destroy(); } catch {}
  }

  const seconds = Math.round((Date.now() - startedAt) / 1000);
  db.prepare(
    `UPDATE engagement_sessions
        SET ended_at = datetime('now'),
            seconds = ?, posts_seen = ?, likes = ?, follows = ?, error = ?
      WHERE id = ?`
  ).run(seconds, stats.posts_seen, stats.likes, stats.follows, err || (stats.errors && stats.errors.length ? stats.errors.join(' · ') : null), sessionId);
  db.prepare(`UPDATE engagement_protocols SET last_run_at = datetime('now') WHERE account_id = ?`).run(accountId);

  return { ok: !err, error: err, sessionId, stats, seconds };
}

// Coordinator tick — pick at most one enabled protocol whose last_run_at is
// stale enough to be due, and run a session for it. Spreads sessions across
// the day instead of slamming them all at once.
async function engagementTick() {
  const db = getDb();
  let rows;
  try {
    rows = db.prepare(
      `SELECT account_id, sessions_per_day, last_run_at
         FROM engagement_protocols
        WHERE enabled = 1`
    ).all();
  } catch { return; }
  if (!rows.length) return;

  const nowMs = Date.now();
  const dueRows = rows.filter((r) => {
    const perDay = Math.max(1, r.sessions_per_day || 3);
    const spacingMs = (24 * 60 * 60 * 1000) / perDay;
    if (!r.last_run_at) return true;
    const lastMs = new Date(r.last_run_at.replace(' ', 'T') + 'Z').getTime();
    return (nowMs - lastMs) >= spacingMs * (0.85 + Math.random() * 0.3); // ±jitter
  });
  if (!dueRows.length) return;

  // Pick one at random to avoid biasing the same account.
  const pick = dueRows[Math.floor(Math.random() * dueRows.length)];
  try { await runSession(pick.account_id, { dryRun: false }); } catch {}
}

module.exports = { runSession, engagementTick };
