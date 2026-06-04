// Auto-comment loop. Picks one due account, fetches Hot from a random
// configured target sub, picks a post we haven't replied to yet, fetches the
// post body + top comments for context, drafts a reply via the AI provider
// seeded with this account's account_example_comments, and posts via
// /api/comment. Logs every attempt in auto_comment_runs.
const { getDb } = require('../db');
const { request, modhashFor } = require('./redditSession');

async function callAIWrap(system, user) {
  const { callAutopilotAI } = require('./postgen');
  return callAutopilotAI(system, user, { maxTokens: 600 });
}

async function pickPostFromSub(partition, sub) {
  const url = `https://www.reddit.com/r/${encodeURIComponent(sub)}/hot.json?limit=25&raw_json=1`;
  const data = await request(partition, url);
  const kids = (data?.data?.children || []).map((c) => c.data).filter(Boolean);
  // skip stickies and locked threads
  return kids.filter((p) => !p.stickied && !p.locked && !p.over_18 && !p.archived);
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

async function runOnce(accountId, { dryRun = false } = {}) {
  const db = getDb();
  const proto = db.prepare('SELECT * FROM auto_comment_protocols WHERE account_id = ?').get(accountId);
  if (!proto || !proto.enabled) return { ok: false, error: 'Protocol disabled' };

  let subs = [];
  try { subs = JSON.parse(proto.target_subs_json || '[]'); } catch {}
  if (!subs.length) return { ok: false, error: 'No target subs configured' };

  const acct = db.prepare(
    `SELECT a.id, a.username, a.partition_key, a.profile_id, p.name AS profile_name, p.brand_voice
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
  try { posts = await pickPostFromSub(part, sub); }
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
  const candidates = posts.filter((p) => !alreadyReplied.has(p.id));
  if (!candidates.length) return { ok: false, error: 'All posts already replied to' };

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

  // Resolve the editable comment-template (per-model override → global → default)
  // and interpolate {{vars}}. Examples are appended after as a static block.
  const { resolveAutopilotPrompt, interpolatePrompt } = require('./postgen');
  const tmpl = resolveAutopilotPrompt('comment', acct.profile_id);
  const base = interpolatePrompt(tmpl, {
    username: acct.username,
    brand_voice: acct.brand_voice || '',
    brand_voice_line: acct.brand_voice ? `Voice: ${acct.brand_voice}` : '',
    model_name: acct.profile_name || '',
  });
  const examplesBlock = examples.length
    ? '\n\nHow this account usually replies:\n' + examples.map((e, i) => `${i + 1}. PARENT: "${e.parent_title}"${e.parent_body ? ' / ' + String(e.parent_body).slice(0, 160) : ''}\n   YOUR REPLY: "${String(e.comment_body).slice(0, 300)}"`).join('\n')
    : '';
  const system = base + examplesBlock;

  const top = thread.comments.map((c) => `- u/${c.author} (${c.score}↑): ${String(c.body).slice(0, 220)}`).join('\n');
  const userMsg = `Subreddit: r/${sub}\nPost title: "${post.title}"\n${(thread.post?.selftext || post.selftext) ? `Post body: ${String(thread.post?.selftext || post.selftext).slice(0, 600)}\n` : ''}${top ? `\nExisting top replies:\n${top}\n` : ''}\nWrite your one-comment reply now.`;

  let commentText = '';
  try { commentText = (await callAIWrap(system, userMsg) || '').trim(); }
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
    db.prepare(`UPDATE auto_comment_protocols SET last_run_at = datetime('now') WHERE account_id = ?`).run(accountId);
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
