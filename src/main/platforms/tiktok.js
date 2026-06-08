// TikTok autopilot adapter.
//
// TikTok feed-posting requires video upload (and TikTok's web composer
// is one of the harder DOM targets in the industry). Realistic autopilot
// action: an engagement session — scroll For You, like, follow, drop AI
// comments. Engagement runner already covers all of that with TikTok's
// data-e2e selectors.

const { generateText } = require('../services/platformGen');

async function generateContent({ account, target }) {
  const r = await generateText({
    accountId: account.id,
    platform: 'tiktok',
    kind: 'post',
    targetName: target?.name || null,
  });
  if (!r.ok) return { ok: false, error: r.error };
  return {
    ok: true,
    target: target?.name || null,
    title: r.text,
    body: '',
    kind: 'self',
    url: null,
  };
}

async function submitPost({ accountId, title }) {
  try {
    const { runSession } = require('../services/engagement');
    const out = await runSession(accountId, { dryRun: false, hint: title });
    if (out?.ok === false) return { ok: false, error: out.error || 'Engagement run failed' };
    return { ok: true, id: null, url: null };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = {
  id: 'tiktok',
  configured: true,
  capabilities: { post: true, comment: true, engagement: true, dm: false },
  submitPost,
  generateContent,
};
