// Autopilot self-topic-discovery — every few hours, walk each model's promo
// subreddits (and the global warm-up list), pull /hot, and store fresh candidate
// titles in reddit_topic_candidates. postgen pulls from this table when it
// generates posts so autopilot can pick its own subjects.
const { getDb } = require('../db');
const { partitionFor, request } = require('./redditSession');

async function fetchHot(partition, sub) {
  const url = `https://www.reddit.com/r/${encodeURIComponent(sub)}/hot.json?limit=25&raw_json=1`;
  const data = await request(partition, url);
  const kids = data?.data?.children || [];
  return kids
    .map((c) => c.data)
    .filter((d) => d && !d.stickied && !d.over_18 ? true : true)
    .map((d) => ({
      title: d.title,
      score: d.score || 0,
      num_comments: d.num_comments || 0,
      url: d.permalink ? `https://www.reddit.com${d.permalink}` : null,
    }));
}

async function discoverForProfile(profileId) {
  const db = getDb();
  // Pick a logged-in scraper account that belongs to this model.
  const acct = db.prepare(
    `SELECT id, partition_key FROM reddit_accounts
       WHERE profile_id = ? AND platform = 'reddit' AND status != 'banned'
       ORDER BY (status = 'ready') DESC
       LIMIT 1`
  ).get(profileId);
  if (!acct) return { ok: false, error: 'No Reddit account for this model' };

  const part = `persist:${acct.partition_key}`;
  // Pull subs from the unified content_sources pool (triggers keep the legacy
  // promo_subreddits table mirrored so the existing Subreddits UI keeps working).
  const contentSources = require('./contentSources');
  const subs = contentSources
    .list({ platform: 'reddit', kind: 'promo', profileId })
    .map((r) => r.name);
  if (!subs.length) return { ok: true, discovered: 0 };

  const insert = db.prepare(
    `INSERT OR IGNORE INTO reddit_topic_candidates
       (profile_id, subreddit, title, score, num_comments, url)
     VALUES (?,?,?,?,?,?)`
  );
  let discovered = 0;
  for (const sub of subs) {
    try {
      const posts = await fetchHot(part, sub);
      for (const p of posts) {
        const r = insert.run(profileId, sub, p.title, p.score, p.num_comments, p.url);
        if (r.changes) discovered++;
      }
    } catch { /* per-sub failure, keep going */ }
  }
  // Prune candidates older than 14 days so the table doesn't grow unbounded.
  db.prepare(`DELETE FROM reddit_topic_candidates WHERE discovered_at < datetime('now', '-14 days')`).run();
  return { ok: true, discovered };
}

async function topicTick() {
  const db = getDb();
  let profiles;
  try {
    profiles = db.prepare(
      `SELECT DISTINCT mp.id
         FROM model_profiles mp
         JOIN promo_subreddits ps ON ps.profile_id = mp.id`
    ).all();
  } catch { return; }
  for (const p of profiles) {
    try { await discoverForProfile(p.id); } catch {}
  }
}

module.exports = { discoverForProfile, topicTick };
