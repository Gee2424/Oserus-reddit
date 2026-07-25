/**
 * Reddit Inbox Reply Script (API from page context)
 *
 * Replies to a Reddit message via the official API from inside the CM
 * browser's page context using fetch(). Uses the browser's own cookies.
 *
 * @category tasks
 * @platform reddit
 * @timeout 30000
 * @requires ['cdpConnection']
 */

const metadata = {
  id: 'tasks/reddit/inbox-reply',
  name: 'Reddit Inbox Reply',
  platform: 'reddit',
  category: 'tasks',
  timeout: 30000,
  requires: ['cdpConnection'],
  nativeMode: true,
  version: '1.0.0',
  description: 'Reply to a Reddit message via API from CM browser page context'
};

async function execute(nativeConnection, context) {
  const { page } = nativeConnection;
  const { parentFullname, text, accountId } = context;

  console.log('[Inbox Reply] CM reply for account:', accountId);

  if (!parentFullname || !text) throw new Error('parentFullname and text are required');

  await page.goto('https://www.reddit.com/', {
    waitUntil: 'domcontentloaded',
    timeout: 15000
  });

  const result = await page.evaluate(async ({ parentFullname, text }) => {
    try {
      const meRes = await fetch('/api/me.json?raw_json=1');
      if (meRes.status === 401 || meRes.status === 403) {
        return { error: 'NOT_LOGGED_IN' };
      }
      const meData = await meRes.json();
      const modhash = meData?.data?.modhash;
      if (!modhash) {
        return { error: 'NOT_LOGGED_IN', detail: 'No modhash found in user data' };
      }

      const params = new URLSearchParams();
      params.append('api_type', 'json');
      params.append('thing_id', parentFullname);
      params.append('text', text);
      params.append('uh', modhash);

      const res = await fetch('/api/comment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });

      const data = await res.json();
      const errors = data?.json?.errors || [];
      if (errors.length) {
        const msgs = errors.map(e => e[1] || e[0]).join('; ');
        return { error: 'REPLY_FAILED', detail: msgs };
      }

      return { success: true };
    } catch (e) {
      return { error: 'EVALUATE_FAILED', detail: e.message };
    }
  }, { parentFullname, text });

  if (result.error === 'NOT_LOGGED_IN') {
    throw new Error('NOT_LOGGED_IN');
  }
  if (result.error) {
    throw new Error(result.detail || result.error);
  }

  console.log('[Inbox Reply] Reply sent for account:', accountId);
  return result;
}

module.exports = { metadata, execute };
