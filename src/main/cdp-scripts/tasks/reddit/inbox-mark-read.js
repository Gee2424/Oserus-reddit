/**
 * Reddit Inbox Mark-Read Script (API from page context)
 *
 * Marks a Reddit message as read/unread via the official API from inside
 * the CM browser's page context using fetch().
 *
 * @category tasks
 * @platform reddit
 * @timeout 30000
 * @requires ['cdpConnection']
 */

const metadata = {
  id: 'tasks/reddit/inbox-mark-read',
  name: 'Reddit Inbox Mark Read',
  platform: 'reddit',
  category: 'tasks',
  timeout: 30000,
  requires: ['cdpConnection'],
  nativeMode: true,
  version: '1.0.0',
  description: 'Mark a Reddit message as read/unread via API from CM browser page context'
};

async function execute(nativeConnection, context) {
  const { page } = nativeConnection;
  const { fullname, read = true, accountId } = context;

  console.log('[Inbox Mark-Read] CM mark-read for account:', accountId, 'read:', read);

  if (!fullname) throw new Error('fullname is required');

  await page.goto('https://www.reddit.com/', {
    waitUntil: 'domcontentloaded',
    timeout: 15000
  });

  const result = await page.evaluate(async ({ fullname, read }) => {
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

      const action = read ? 'read_message' : 'unread_message';
      const params = new URLSearchParams();
      params.append('id', fullname);
      params.append('uh', modhash);

      await fetch('/api/' + action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });

      return { success: true };
    } catch (e) {
      return { error: 'EVALUATE_FAILED', detail: e.message };
    }
  }, { fullname, read });

  if (result.error === 'NOT_LOGGED_IN') {
    throw new Error('NOT_LOGGED_IN');
  }
  if (result.error) {
    throw new Error(result.detail || result.error);
  }

  console.log('[Inbox Mark-Read] Done for account:', accountId);
  return result;
}

module.exports = { metadata, execute };
