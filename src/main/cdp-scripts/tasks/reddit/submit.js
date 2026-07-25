/**
 * Reddit Post Submit Script (API from page context)
 *
 * Posts to Reddit via the official API from inside the CM browser's page
 * context using fetch(). Uses the browser's own cookies — no modhash
 * extraction from DOM, no form navigation. Same reliability path as the
 * Electron adapter which calls POST /api/submit via net.request.
 *
 * @category tasks
 * @platform reddit
 * @timeout 30000
 * @requires ['cdpConnection']
 */

const metadata = {
  id: 'tasks/reddit/submit',
  name: 'Reddit API Post Submit',
  platform: 'reddit',
  category: 'tasks',
  timeout: 30000,
  requires: ['cdpConnection'],
  nativeMode: true,
  version: '2.0.0',
  description: 'Submits a post to Reddit via the official API from the CM browser page context'
};

async function execute(nativeConnection, context) {
  const { page } = nativeConnection;
  const { title, body, subreddit, kind, url, accountId } = context;

  console.log('[Reddit Submit] API post for account:', accountId, 'target:', subreddit);

  if (!title || !subreddit) throw new Error('Title and subreddit are required');
  if (kind === 'link' && !url) throw new Error('URL is required for link posts');

  // Navigate to a logged-in page to establish the cookie session.
  // Any Reddit page works — we're calling the API from page context,
  // not interacting with DOM.
  await page.goto('https://www.reddit.com/', {
    waitUntil: 'domcontentloaded',
    timeout: 15000
  });

  const sr = String(subreddit).replace(/^\/?r\//i, '').trim();
  const isLink = kind === 'link' || kind === 'image';
  const safeTitle = String(title).slice(0, 300);

  const result = await page.evaluate(async ({ sr, safeTitle, isLink, url, body }) => {
    try {
      // Extract the browser's Reddit modhash
      const meRes = await fetch('/api/me.json?raw_json=1');
      if (meRes.status === 401 || meRes.status === 403) {
        return { error: 'NOT_LOGGED_IN', detail: 'Account is not logged into Reddit' };
      }
      if (!meRes.ok) {
        return { error: 'MODHASH_FAILED', detail: `/api/me.json returned ${meRes.status}` };
      }
      const meData = await meRes.json();
      const modhash = meData?.data?.modhash;
      if (!modhash) {
        return { error: 'NOT_LOGGED_IN', detail: 'No modhash found in user data' };
      }

      // Build form params matching the Reddit API contract
      const params = new URLSearchParams();
      params.append('api_type', 'json');
      params.append('sr', sr);
      params.append('title', safeTitle);
      params.append('kind', isLink ? 'link' : 'self');
      params.append('uh', modhash);
      params.append('resubmit', 'true');
      params.append('sendreplies', 'true');
      if (isLink) {
        params.append('url', url || '');
        params.append('text', '');
      } else {
        params.append('text', body || '');
      }

      const submitRes = await fetch('/api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });

      const data = await submitRes.json();
      const errors = data?.json?.errors || [];
      if (errors.length) {
        const msgs = errors.map(e => e[1] || e[0]).join('; ');
        return { error: 'SUBMIT_FAILED', detail: msgs };
      }

      const out = data?.json?.data || {};
      return {
        success: true,
        url: out.url || null,
        id: out.id || out.name || null,
        name: out.name || null,
        subreddit: sr,
        title: safeTitle,
      };
    } catch (e) {
      return { error: 'EVALUATE_FAILED', detail: e.message };
    }
  }, { sr, safeTitle, isLink, url, body });

  if (result.error === 'NOT_LOGGED_IN') {
    throw new Error('NOT_LOGGED_IN: Account is not logged into Reddit');
  }
  if (result.error === 'MODHASH_FAILED' || result.error === 'EVALUATE_FAILED') {
    throw new Error(result.detail || result.error);
  }
  if (result.error === 'SUBMIT_FAILED') {
    throw new Error(result.detail || 'Reddit API submission failed');
  }

  console.log('[Reddit Submit] Posted:', result.url || result.id);
  return result;
}

module.exports = { metadata, execute };
