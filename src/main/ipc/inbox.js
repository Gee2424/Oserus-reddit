const { userFromToken } = require('./auth');
const { log } = require('./activity');
const { partitionFor, request, modhashFor } = require('../services/redditSession');

const FOLDERS = {
  all: 'https://www.reddit.com/message/inbox.json?raw_json=1&limit=100',
  unread: 'https://www.reddit.com/message/unread.json?raw_json=1&limit=100',
  messages: 'https://www.reddit.com/message/messages.json?raw_json=1&limit=100',
  mentions: 'https://www.reddit.com/message/mentions.json?raw_json=1&limit=100',
  sent: 'https://www.reddit.com/message/sent.json?raw_json=1&limit=100',
};

function normalize(listing) {
  const kids = listing?.data?.children || [];
  return kids.map((c) => {
    const d = c.data || {};
    return {
      id: d.id,
      name: d.name, // fullname e.g. t4_xxxx
      kind: c.kind, // t4 = message, t1 = comment reply
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
    };
  });
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
      return { ok: true, messages: normalize(listing), username: acct.username };
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
