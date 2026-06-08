// Instagram autopilot adapter.
//
// IG won't accept a text-only feed post — every post needs media. The
// realistic autopilot action on IG is an engagement session: scroll the
// feed, like posts, follow accounts, drop AI-generated comments via the
// existing engagement runner. That's exactly what the coordinator's
// runForAccount calls submitPost for here.
//
// Feed posting with media is a separate workflow (operator-supplied
// media URL → injected into the composer's file input). When that
// ships, this adapter swaps submitPost over without touching the
// coordinator.

const { generateText } = require('../services/platformGen');

async function generateContent({ account, target }) {
  const r = await generateText({
    accountId: account.id,
    platform: 'instagram',
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

// Coordinator calls this expecting "the post happened". For IG today
// that means running one engagement session: the in-page script likes,
// follows, and drops AI comments scoped by the account's protocol.
async function submitPost({ accountId, title }) {
  try {
    const { runSession } = require('../services/engagement');
    // Pass the caption through as a hint comment seed so the AI inside
    // engagement.requestComment has something themed to play off.
    const out = await runSession(accountId, { dryRun: false, hint: title });
    if (out?.ok === false) return { ok: false, error: out.error || 'Engagement run failed' };
    return { ok: true, id: null, url: null };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = {
  id: 'instagram',
  configured: true,
  capabilities: { post: true, comment: true, engagement: true, dm: false },
  submitPost,
  generateContent,
};
