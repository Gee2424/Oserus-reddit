/**
 * Reddit Inbox Fetch Script (API from page context)
 *
 * Fetches Reddit messages from inside the CM browser's page context
 * using fetch(). Uses the browser's own cookies — no Electron session
 * needed. Mirrors the flattening logic from ipc/inbox.js.
 *
 * @category tasks
 * @platform reddit
 * @timeout 30000
 * @requires ['cdpConnection']
 */

const metadata = {
  id: 'tasks/reddit/inbox-fetch',
  name: 'Reddit Inbox Fetch',
  platform: 'reddit',
  category: 'tasks',
  timeout: 30000,
  requires: ['cdpConnection'],
  nativeMode: true,
  version: '1.0.0',
  description: 'Fetch Reddit inbox messages via API from CM browser page context'
};

const FOLDER_URLS = {
  all: 'https://www.reddit.com/message/inbox.json?raw_json=1&limit=100',
  unread: 'https://www.reddit.com/message/unread.json?raw_json=1&limit=100',
  messages: 'https://www.reddit.com/message/messages.json?raw_json=1&limit=100',
  mentions: 'https://www.reddit.com/message/mentions.json?raw_json=1&limit=100',
  sent: 'https://www.reddit.com/message/sent.json?raw_json=1&limit=100',
};

async function execute(nativeConnection, context) {
  const { page } = nativeConnection;
  const { folder = 'all', rootFullname } = context;

  console.log('[Inbox Fetch] CM inbox for folder:', folder);

  // Navigate to a logged-in page to establish the cookie session
  await page.goto('https://www.reddit.com/', {
    waitUntil: 'domcontentloaded',
    timeout: 15000
  });

  let apiUrl;
  if (folder === 'thread' && rootFullname) {
    const bare = String(rootFullname).replace(/^t\d+_/, '');
    apiUrl = `https://www.reddit.com/message/messages/${encodeURIComponent(bare)}.json?raw_json=1`;
  } else {
    apiUrl = FOLDER_URLS[folder] || FOLDER_URLS.all;
  }

  const result = await page.evaluate(async (apiUrl) => {
    try {
      const res = await fetch(apiUrl);
      if (res.status === 401 || res.status === 403) {
        return { error: 'NOT_LOGGED_IN' };
      }
      if (!res.ok) {
        return { error: 'FETCH_FAILED', detail: `HTTP ${res.status}` };
      }
      const data = await res.json();

      const children = data?.data?.children || [];
      const messages = [];
      function flatten(list) {
        for (const c of list) {
          const d = c.data || {};
          const fm = d.first_message_name || d.name;
          messages.push({
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
            permalink: d.context ? 'https://www.reddit.com' + d.context : null,
          });
          const replies = (d.replies && d.replies.data && d.replies.data.children) || [];
          if (replies.length) flatten(replies);
        }
      }
      flatten(children);
      return { messages };
    } catch (e) {
      return { error: 'EVALUATE_FAILED', detail: e.message };
    }
  }, apiUrl);

  if (result.error === 'NOT_LOGGED_IN') {
    throw new Error('NOT_LOGGED_IN');
  }
  if (result.error) {
    throw new Error(result.detail || result.error);
  }

  console.log('[Inbox Fetch] Retrieved', result.messages.length, 'messages');
  return { success: true, messages: result.messages || [] };
}

module.exports = { metadata, execute };
