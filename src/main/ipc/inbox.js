const { userFromToken } = require('./auth');
const { log } = require('./activity');
const { getDb } = require('../db');
const { partitionFor, request, modhashFor } = require('../services/redditSession');

const FOLDERS = {
  all: 'https://www.reddit.com/message/inbox.json?raw_json=1&limit=100',
  unread: 'https://www.reddit.com/message/unread.json?raw_json=1&limit=100',
  messages: 'https://www.reddit.com/message/messages.json?raw_json=1&limit=100',
  mentions: 'https://www.reddit.com/message/mentions.json?raw_json=1&limit=100',
  sent: 'https://www.reddit.com/message/sent.json?raw_json=1&limit=100',
};

// Flatten a Reddit message + its replies tree into a flat array. Reddit nests
// follow-ups under `data.replies` as another Listing; the inbox UI groups by
// `firstMessageName` so the full back-and-forth shows in one thread.
function flattenMessage(c, rootName) {
  const out = [];
  const d = c.data || {};
  const myName = d.name;
  const fm = d.first_message_name || rootName || myName;
  out.push({
    id: d.id,
    name: d.name,
    firstMessageName: fm,
    kind: c.kind,
    author: d.author,
    dest: d.dest,
    subject: d.subject || (d.was_comment ? d.link_title : ''),
    body: d.body || '',
    created: d.created_utc,
    isNew: !!d.new,
    wasComment: !!d.was_comment,
    subreddit: d.subreddit || null,
    linkTitle: d.link_title || null,
    permalink: d.context ? `https://www.reddit.com${d.context}` : null,
  });
  const replyChildren = d.replies?.data?.children || [];
  for (const r of replyChildren) out.push(...flattenMessage(r, fm));
  return out;
}

function normalize(listing) {
  const kids = listing?.data?.children || [];
  const out = [];
  for (const c of kids) out.push(...flattenMessage(c, null));
  return out;
}

// Cupid AI matcher — given the account's freshly-fetched unread messages,
// run any enabled rules against the (subject + body) of each. For matches,
// fire the linked template via the same /api/comment path and record the
// fire in messaging_rule_fires so daily_limit + dedup work.
async function runAutoReplyRules(accountId, messages, acct) {
  const db = getDb();
  let rules = [];
  try {
    const profileId = db.prepare('SELECT profile_id FROM reddit_accounts WHERE id = ?').get(accountId)?.profile_id;
    rules = db.prepare(
      `SELECT r.*, t.body AS template_body
         FROM messaging_rules r
         LEFT JOIN messaging_templates t ON t.id = r.template_id
        WHERE r.enabled = 1
          AND (r.account_id IS NULL OR r.account_id = ?)
          AND (r.profile_id IS NULL OR r.profile_id = ?)`
    ).all(accountId, profileId || -1);
  } catch { return; }
  if (!rules.length) return;
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const dayStartStr = dayStart.toISOString().slice(0, 19).replace('T', ' ');
  let modhash;
  for (const m of messages) {
    if (!m.isNew) continue;
    if (!m.id || !m.author) continue;
    const hay = `${m.subject || ''}\n${m.body || ''}`;
    for (const rule of rules) {
      let re;
      try { re = new RegExp(rule.match_pattern, 'i'); } catch { continue; }
      if (!re.test(hay)) continue;
      // Daily cap
      const fires = db.prepare(
        "SELECT COUNT(*) AS c FROM messaging_rule_fires WHERE rule_id = ? AND account_id = ? AND fired_at >= ?"
      ).get(rule.id, accountId, dayStartStr)?.c || 0;
      if (fires >= (rule.daily_limit || 50)) continue;
      // Don't double-reply to the same counterparty in the same day for the same rule
      const already = db.prepare(
        "SELECT 1 FROM messaging_rule_fires WHERE rule_id = ? AND account_id = ? AND conversation_with = ? AND fired_at >= ? LIMIT 1"
      ).get(rule.id, accountId, m.author, dayStartStr);
      if (already) continue;
      if (!rule.template_body) continue;
      try {
        if (!modhash) modhash = await modhashFor(acct.partition);
        if (!modhash) break;
        await request(acct.partition, 'https://www.reddit.com/api/comment', {
          method: 'POST', modhash,
          form: new URLSearchParams({
            api_type: 'json', thing_id: m.id, text: rule.template_body, uh: modhash,
          }).toString(),
        });
        db.prepare(
          'INSERT INTO messaging_rule_fires (rule_id, account_id, conversation_with) VALUES (?,?,?)'
        ).run(rule.id, accountId, m.author);
        db.prepare("UPDATE messaging_rules SET last_fired_at = datetime('now') WHERE id = ?").run(rule.id);
      } catch { /* per-message failure, keep going */ }
      break; // one rule per message
    }
  }
}

function register(ipcMain) {
  ipcMain.handle('inbox:fetch', async (_e, { token, accountId, folder = 'all' }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      if (!accountId) throw new Error('No account selected');
      const acct = partitionFor(accountId);
      if (!acct) throw new Error('Account not found');
      const url = FOLDERS[folder] || FOLDERS.all;
      const listing = await request(acct.partition, url);
      const messages = normalize(listing);
      // Fire Cupid AI auto-reply rules against this fresh fetch. Runs in
      // the background — we don't await, so the inbox returns instantly.
      if (folder === 'all' || folder === 'unread') {
        runAutoReplyRules(accountId, messages, acct).catch(() => {});
      }
      return { ok: true, messages, username: acct.username };
    } catch (err) {
      if (err.message === 'NOT_LOGGED_IN') {
        return { ok: false, notLoggedIn: true, error: 'This account is not logged into Reddit yet.' };
      }
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('inbox:markRead', async (_e, { token, accountId, fullname, read = true }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      const acct = partitionFor(accountId);
      if (!acct) throw new Error('Account not found');
      const modhash = await modhashFor(acct.partition);
      const action = read ? 'read_message' : 'unread_message';
      await request(acct.partition, `https://www.reddit.com/api/${action}`, {
        method: 'POST',
        modhash,
        form: new URLSearchParams({ id: fullname, uh: modhash || '' }).toString(),
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('inbox:reply', async (_e, { token, accountId, parentFullname, text }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      if (!parentFullname || !text) throw new Error('Message and reply text are required');
      const acct = partitionFor(accountId);
      if (!acct) throw new Error('Account not found');
      const modhash = await modhashFor(acct.partition);
      if (!modhash) throw new Error('NOT_LOGGED_IN');
      const data = await request(acct.partition, 'https://www.reddit.com/api/comment', {
        method: 'POST',
        modhash,
        form: new URLSearchParams({
          api_type: 'json', thing_id: parentFullname, text, uh: modhash,
        }).toString(),
      });
      const errs = data?.json?.errors || [];
      if (errs.length) throw new Error(errs.map((e) => e[1]).join('; '));
      log(user, 'inbox.reply', 'account', accountId, `to=${parentFullname}`);
      return { ok: true };
    } catch (err) {
      if (err.message === 'NOT_LOGGED_IN') {
        return { ok: false, notLoggedIn: true, error: 'This account is not logged into Reddit yet.' };
      }
      return { ok: false, error: err.message };
    }
  });
}

module.exports = register;
