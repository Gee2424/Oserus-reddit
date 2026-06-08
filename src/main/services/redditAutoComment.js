// Auto-comment loop. Picks one due account, fetches Hot from a random
// configured target sub, picks a post we haven't replied to yet, fetches the
// post body + top comments for context, drafts a reply via the AI provider
// seeded with this account's account_example_comments, and posts via
// /api/comment. Logs every attempt in auto_comment_runs.
const { getDb } = require('../db');
const { request, modhashFor } = require('./redditSession');

async function callAIWrap(system, user, provider) {
  const { callAutopilotAI } = require('./postgen');
  return callAutopilotAI(system, user, { maxTokens: 600, provider });
}

async function pickPostFromSub(partition, sub, { allowNsfw = false } = {}) {
  const url = `https://www.reddit.com/r/${encodeURIComponent(sub)}/hot.json?limit=25&raw_json=1`;
  const data = await request(partition, url);
  const kids = (data?.data?.children || []).map((c) => c.data).filter(Boolean);
  // skip stickies and locked threads. nsfw filter is delegated to the caller
  // so the protocol's nsfw_only flag can require, not just forbid, over_18.
  return kids.filter((p) => !p.stickied && !p.locked && !p.archived && (allowNsfw || !p.over_18));
}

async function fetchPostThread(partition, permalink) {
  const url = `https://www.reddit.com${permalink}.json?raw_json=1&limit=10&sort=top`;
  const arr = await request(partition, url);
  const post = arr?.[0]?.data?.children?.[0]?.data || null;
  const commentsList = arr?.[1]?.data?.children || [];
  const comments = commentsList
    .map((c) => c.data)
    .filter((c) => c && c.body && !c.stickied)
    .slice(0, 5)
    .map((c) => ({ author: c.author, body: c.body, score: c.score }));
  return { post, comments };
}

// runOnce can be called two ways:
//   - From the engagement loop: `protocol` is passed in (the unified
//     autopilot_protocols row for this Reddit profile). Reuses the
//     protocol's target_subs_json + comment persona.
//   - Standalone (manual "run now" via IPC, dev test): resolves the
//     protocol from the account's profile_id + 'reddit'.
async function runOnce(accountId, { dryRun = false, protocol = null } = {}) {
  const db = getDb();
  const acctMeta = db.prepare('SELECT profile_id FROM reddit_accounts WHERE id = ?').get(accountId);
  if (!acctMeta) return { ok: false, error: 'Account not found' };

  const proto = protocol || db.prepare(
    `SELECT * FROM autopilot_protocols WHERE profile_id = ? AND platform = 'reddit'`
  ).get(acctMeta.profile_id);
  if (!proto || !proto.enabled) return { ok: false, error: 'Protocol disabled' };
  if ((proto.comment_rate_pct ?? 0) <= 0) return { ok: false, error: 'Commenting disabled in protocol' };

  let subs = [];
  try { subs = JSON.parse(proto.target_subs_json || '[]'); } catch {}
  if (!subs.length) return { ok: false, error: 'No target subs configured' };

  const acct = db.prepare(
    `SELECT a.id, a.username, a.partition_key, a.profile_id,
            p.name AS profile_name, p.brand_voice, p.niche
       FROM reddit_accounts a
       JOIN model_profiles p ON p.id = a.profile_id
      WHERE a.id = ?`
  ).get(accountId);
  if (!acct) return { ok: false, error: 'Account not found' };

  // Re-prep partition (proxy + UA + antidetect).
  try {
    const { prepareSessionForAccount } = require('./sessionPrep');
    await prepareSessionForAccount(accountId);
  } catch {}
  const part = `persist:${acct.partition_key}`;

  // Pick a sub at random, fetch candidate posts.
  const sub = subs[Math.floor(Math.random() * subs.length)];
  let posts;
  try { posts = await pickPostFromSub(part, sub, { allowNsfw: !!proto.nsfw_only }); }
  catch (e) {
    db.prepare(`INSERT INTO auto_comment_runs (account_id, subreddit, status, error) VALUES (?,?,?,?)`)
      .run(accountId, sub, 'failed', `fetch hot: ${e.message}`);
    return { ok: false, error: e.message };
  }
  if (!posts.length) return { ok: false, error: 'No candidate posts' };

  // Skip posts we've already replied to from auto_comment_runs.
  const alreadyReplied = new Set(
    db.prepare(`SELECT post_id FROM auto_comment_runs WHERE account_id = ? AND status = 'posted' AND post_id IS NOT NULL`).all(accountId).map((r) => r.post_id)
  );
  const minRatio = Number(proto.min_upvote_ratio) || 0;
  const minScore = Number(proto.min_post_score) || 0;
  const nsfwOnly = !!proto.nsfw_only;
  const candidates = posts.filter((p) => {
    if (alreadyReplied.has(p.id)) return false;
    if (minRatio > 0 && typeof p.upvote_ratio === 'number' && p.upvote_ratio < minRatio) return false;
    if (minScore > 0 && typeof p.score === 'number' && p.score < minScore) return false;
    if (nsfwOnly && !p.over_18) return false;
    return true;
  });
  if (!candidates.length) {
    db.prepare(`INSERT INTO auto_comment_runs (account_id, subreddit, status, error) VALUES (?,?,?,?)`)
      .run(accountId, sub, 'skipped', `no posts passed filters (ratio>=${minRatio}, score>=${minScore}${nsfwOnly ? ', nsfw_only' : ''})`);
    return { ok: false, error: 'No posts passed targeting filters' };
  }

  const post = candidates[Math.floor(Math.random() * Math.min(8, candidates.length))];

  // Fetch the post body + top comments for context.
  let thread = { post: null, comments: [] };
  try { thread = await fetchPostThread(part, post.permalink); } catch {}

  // Build the AI prompt with example_comments as voice seeds.
  let examples = [];
  try {
    examples = db.prepare(
      'SELECT parent_title, parent_body, comment_body FROM account_example_comments WHERE account_id = ? ORDER BY RANDOM() LIMIT 6'
    ).all(accountId);
  } catch {}

  // The persona / custom prompt lives on the unified autopilot_protocols
  // row. We still apply the brand-voice line + username so the comment
  // feels owned by this account.
  const { buildCommentPrompt } = require('./autopilotProtocol');
  // Pass model context (name / niche / brand voice) into the persona
  // prompt builder so the AI reply is shaped by who this model IS, not
  // just the persona archetype.
  const personaPrompt = buildCommentPrompt(proto, {
    name: acct.profile_name, niche: acct.niche, brand_voice: acct.brand_voice,
  });
  const base = [
    `You are this Reddit user: u/${acct.username}.`,
    acct.brand_voice ? `Voice: ${acct.brand_voice}` : null,
    acct.niche ? `Niche / lane: ${acct.niche}. Stay in lane — only comment if you have something on-brand to say.` : null,
    personaPrompt,
    'Write ONE comment reply for the post below. 1–4 sentences. Output ONLY the comment text — no quotes, no preface, no signature.',
  ].filter(Boolean).join('\n');
  const examplesBlock = examples.length
    ? '\n\nHow this account usually replies:\n' + examples.map((e, i) => `${i + 1}. PARENT: "${e.parent_title}"${e.parent_body ? ' / ' + String(e.parent_body).slice(0, 160) : ''}\n   YOUR REPLY: "${String(e.comment_body).slice(0, 300)}"`).join('\n')
    : '';
  const system = base + examplesBlock;

  const top = thread.comments.map((c) => `- u/${c.author} (${c.score}↑): ${String(c.body).slice(0, 220)}`).join('\n');
  const userMsg = `Subreddit: r/${sub}\nPost title: "${post.title}"\n${(thread.post?.selftext || post.selftext) ? `Post body: ${String(thread.post?.selftext || post.selftext).slice(0, 600)}\n` : ''}${top ? `\nExisting top replies:\n${top}\n` : ''}\nWrite your one-comment reply now.`;

  let commentText = '';
  try { commentText = (await callAIWrap(system, userMsg, proto.ai_provider) || '').trim(); }
  catch (e) {
    db.prepare(`INSERT INTO auto_comment_runs (account_id, subreddit, post_id, post_title, status, error) VALUES (?,?,?,?,?,?)`)
      .run(accountId, sub, post.id, post.title, 'failed', `ai: ${e.message}`);
    return { ok: false, error: e.message };
  }
  // strip surrounding quotes if the model added them
  commentText = commentText.replace(/^["'`]\s*|\s*["'`]$/g, '').trim();
  if (commentText.length < 8) {
    db.prepare(`INSERT INTO auto_comment_runs (account_id, subreddit, post_id, post_title, status, error) VALUES (?,?,?,?,?,?)`)
      .run(accountId, sub, post.id, post.title, 'failed', 'reply too short');
    return { ok: false, error: 'AI returned an empty reply' };
  }

  if (dryRun) {
    db.prepare(`INSERT INTO auto_comment_runs (account_id, subreddit, post_id, post_title, comment_text, status) VALUES (?,?,?,?,?,?)`)
      .run(accountId, sub, post.id, post.title, commentText, 'skipped');
    return { ok: true, dryRun: true, post: { id: post.id, title: post.title }, comment: commentText };
  }

  // Submit the comment.
  try {
    const modhash = await modhashFor(part);
    if (!modhash) throw new Error('NOT_LOGGED_IN');
    const data = await request(part, 'https://www.reddit.com/api/comment', {
      method: 'POST',
      modhash,
      form: new URLSearchParams({
        api_type: 'json', thing_id: 't3_' + post.id, text: commentText, uh: modhash,
      }).toString(),
    });
    const errs = data?.json?.errors || [];
    if (errs.length) throw new Error(errs.map((e) => e[1]).join('; '));
    db.prepare(`INSERT INTO auto_comment_runs (account_id, subreddit, post_id, post_title, comment_text, status) VALUES (?,?,?,?,?,?)`)
      .run(accountId, sub, post.id, post.title, commentText, 'posted');
    // last_run_at tracking moved to autopilot_protocols and is stamped by
    // the engagement loop. The legacy auto_comment_protocols row (if any)
    // stays read-only for backward compat.
    return { ok: true, post: { id: post.id, title: post.title }, comment: commentText };
  } catch (e) {
    db.prepare(`INSERT INTO auto_comment_runs (account_id, subreddit, post_id, post_title, comment_text, status, error) VALUES (?,?,?,?,?,?,?)`)
      .run(accountId, sub, post.id, post.title, commentText, 'failed', e.message);
    return { ok: false, error: e.message };
  }
}

// The cross-platform autoCommentTick lives in services/autoComment.js;
// this module is now Reddit-only logic dispatched via the reddit adapter.
module.exports = { runOnce };
