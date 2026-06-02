// Post generation service — single source of truth for turning an account +
// mode into Reddit post suggestions via Grok (x.ai). Used by the
// ai:suggestPost IPC handler (VA clicks "suggest") AND the autopilot
// coordinator. Pure-ish: only touches DB + Grok, no Electron/IPC.
//
// targetSubreddit is free-form: a VA (or the coordinator) can warm up in ANY
// subreddit, not just the saved warm-up list. If the target isn't on the
// list, we still generate for it and tell the model to write for that sub.

const { getDb, decryptSecret } = require('../db');
const { getSetting } = require('./settings');

// Grok uses an OpenAI-compatible chat-completions API.
async function callGrok(apiKey, system, userMessage, options = {}) {
  const body = {
    model: options.model || getSetting('grok_model') || 'grok-2-latest',
    max_tokens: options.maxTokens || 1500,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: userMessage },
    ],
  };
  const res = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || data?.error || `Grok API error: ${res.status}`);
  return data.choices?.[0]?.message?.content || '';
}

function tryParseJson(text) {
  const cleaned = text.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/\s*```\s*$/, '').trim();
  return JSON.parse(cleaned);
}

async function generatePost({ accountId, mode, hint, targetSubreddit }) {
  const encKey = getSetting('grok_api_key');
  if (!encKey) throw new Error('No API key set. Admin needs to add one under Settings.');
  const apiKey = decryptSecret(encKey);
  if (!apiKey) throw new Error('API key could not be decrypted');

  const account = getDb()
    .prepare(
      `SELECT a.*, p.name AS profile_name, p.niche, p.brand_voice, p.id AS profile_id
       FROM reddit_accounts a
       JOIN model_profiles p ON p.id = a.profile_id
       WHERE a.id = ?`
    )
    .get(accountId);
  if (!account) throw new Error('Account not found');

  // Poster persona + title-length + custom prompt from the Scheduler AI panel.
  let poster = {};
  try { poster = JSON.parse(getSetting('ai_poster_config') || '{}'); } catch { poster = {}; }
  const personaLines = [
    poster.gender ? `Poster gender: ${poster.gender}` : null,
    poster.age ? `Poster age: ${poster.age}` : null,
    poster.location ? `Location: ${poster.location}${poster.matchCity ? ' (use this in CTAs when natural)' : ''}` : null,
    (poster.titleMin || poster.titleMax) ? `Title length: ${poster.titleMin || 3}–${poster.titleMax || 12} words` : null,
    poster.nightInfo ? `Scene / mood: ${poster.nightInfo}` : null,
    poster.ctaInfo ? `CTA / offer context: ${poster.ctaInfo}` : null,
    (poster.typoRate && Number(poster.typoRate) > 0)
      ? `Realism: include the occasional natural typo (~${Math.round(Number(poster.typoRate) * 100)}% of posts).`
      : null,
    poster.detectLanguage ? 'Mirror the language of the subreddit description if it isn\'t English.' : null,
  ].filter(Boolean).join('\n');
  const ctaList = Array.isArray(poster.customCtas) ? poster.customCtas.filter((c) => c && c.url) : [];
  const ctaBlock = ctaList.length
    ? `Available CTAs (${poster.randomCta === false ? 'use the first one' : 'pick one at random per post'}):\n${ctaList.map((c) => `- ${c.platform || 'link'}: ${c.url}`).join('\n')}`
    : null;
  const customPrompt = (poster.mode === 'custom' && poster.customPrompt) ? poster.customPrompt.trim() : null;

  const isSfw = mode === 'sfw' || (mode !== 'nsfw' && account.status === 'warming');

  let candidates;
  if (isSfw) {
    candidates = getDb().prepare('SELECT name, vibe, description FROM warmup_subreddits ORDER BY name').all();
  } else {
    candidates = getDb().prepare('SELECT name, description FROM promo_subreddits WHERE profile_id = ? ORDER BY name').all(account.profile_id);
  }

  // Free-form target: allow any subreddit even if not on the saved list.
  const cleanTarget = targetSubreddit ? String(targetSubreddit).replace(/^\/?r\//i, '').trim() : null;
  const targetOnList = cleanTarget && candidates.some((c) => c.name.toLowerCase() === cleanTarget.toLowerCase());

  let system, userMsg;
  if (isSfw) {
    system = `You generate Reddit post ideas for a brand-new account that is warming up by posting in mainstream, non-promotional subreddits. The account is run by a person (not a marketer) who wants to engage genuinely with these communities, build comment karma, and look like a normal Redditor.

Output STRICTLY valid JSON with no markdown, no preamble, no code fences:
{
  "suggestions": [
    {
      "subreddit": "exact_subreddit_name",
      "title": "the post title (under 300 chars)",
      "body": "post body if it's a text post (can be empty string for link/image posts)",
      "kind": "self" | "link" | "image",
      "rationale": "one sentence on why this fits the sub"
    }
  ]
}

Rules:
- ${cleanTarget && !targetOnList
      ? `Write ALL suggestions for r/${cleanTarget} specifically (the user picked this subreddit even though it isn't on the saved list).`
      : 'Pick the subreddit ONLY from the list provided. Use the exact name.'}
- Titles must sound like a real person wrote them: lowercase okay, typos rarely okay, casual phrasing. Avoid corporate or AI-flavored phrases.
- ABSOLUTELY NO mention of OnlyFans, the model's brand, "DM me", links to external sites, or anything promotional. This is pure community engagement.
- No sexual content. No flirting. This is the warm-up phase.
- Vary the post types: a question, a story/observation, a confession, etc.
- Match the vibe of the chosen subreddit.

Give 3 suggestions${cleanTarget && !targetOnList ? ` for r/${cleanTarget}` : ', each targeting a DIFFERENT subreddit when possible'}.`;

    userMsg = `Reddit username: u/${account.username}
Account status: ${account.status} (warming up — building karma in mainstream subs)
${cleanTarget && !targetOnList
      ? `Target subreddit (free-form, not on the saved list): r/${cleanTarget}`
      : candidates.length === 0
        ? 'NOTE: No warm-up subreddits configured yet. Skip this turn and tell the user to add some in Subreddits → Warm-up, or pick a specific subreddit.'
        : `Available subreddits to pick from:\n${candidates.map((c) => `- r/${c.name}${c.vibe ? ` (${c.vibe})` : ''}${c.description ? `: ${c.description}` : ''}`).join('\n')}`}
${hint ? `\nVibe / theme hint from the user: ${hint}` : ''}
${cleanTarget && targetOnList ? `\nFocus on r/${cleanTarget} if it's appropriate.` : ''}

Generate 3 post ideas.`;
  } else {
    system = `You generate Reddit post ideas for an OnlyFans model's established promotional account.

Output STRICTLY valid JSON with no markdown, no preamble, no code fences:
{
  "suggestions": [
    {
      "subreddit": "exact_subreddit_name",
      "title": "the post title (under 300 chars)",
      "image_direction": "what the image should show (1-2 sentences, no nudity descriptions — just composition, mood, lighting)",
      "rationale": "one sentence on why this combo works"
    }
  ]
}

Rules:
- ${cleanTarget && !targetOnList
      ? `Write ALL suggestions for r/${cleanTarget} specifically.`
      : 'Pick the subreddit ONLY from the list provided.'}
- Titles should feel like a real human wrote them: casual, sometimes a question, sometimes a teasing statement. Avoid AI-flavored phrasing.
- Image direction describes composition and mood only — what the model is wearing/doing/where she's looking. Do NOT describe nudity or sexual acts; the user (the VA) will produce the actual content.
- Vary angle across the 3 suggestions: one playful, one direct, one teasing/curious.

Give 3 suggestions${cleanTarget && !targetOnList ? ` for r/${cleanTarget}` : ', each targeting a DIFFERENT subreddit when possible'}.`;

    userMsg = `Model: ${account.profile_name}
Niche: ${account.niche || 'not specified'}
Brand voice: ${account.brand_voice || 'not specified'}
Reddit username: u/${account.username}
${cleanTarget && !targetOnList
      ? `Target subreddit (free-form): r/${cleanTarget}`
      : candidates.length === 0
        ? 'NOTE: No promo subreddits configured for this model. Tell the user to add some on the model detail page.'
        : `Promo subreddits for this model:\n${candidates.map((c) => `- r/${c.name}${c.description ? `: ${c.description}` : ''}`).join('\n')}`}
${hint ? `\nVibe / theme hint: ${hint}` : ''}
${cleanTarget && targetOnList ? `\nFocus on r/${cleanTarget}.` : ''}

Generate 3 post ideas.`;
  }

  // Layer the poster persona, CTA block, and any custom prompt override.
  if (personaLines) system += `\n\nPoster persona:\n${personaLines}`;
  if (ctaBlock) system += `\n\n${ctaBlock}`;
  if (customPrompt) system += `\n\nAdditional instructions:\n${customPrompt}`;

  // Per-account example library: feed in up to 8 of this account's saved
  // example posts so the generator mirrors the established voice + topics.
  try {
    const examples = getDb().prepare(
      'SELECT title, body, subreddit FROM account_example_posts WHERE account_id = ? ORDER BY RANDOM() LIMIT 8'
    ).all(account.id);
    if (examples.length) {
      const block = examples.map((e, i) => {
        const sub = e.subreddit ? `r/${e.subreddit} — ` : '';
        const body = e.body ? `\n  body: ${String(e.body).slice(0, 280)}` : '';
        return `${i + 1}. ${sub}"${e.title}"${body}`;
      }).join('\n');
      system += `\n\nExample posts this account has made (match the tone, vocabulary, sentence length, and topic range — do NOT copy verbatim):\n${block}`;
    }
  } catch {}

  const text = await callGrok(apiKey, system, userMsg);
  try {
    const parsed = tryParseJson(text);
    return { ok: true, mode: isSfw ? 'sfw' : 'nsfw', suggestions: parsed.suggestions || [] };
  } catch (e) {
    return { ok: false, error: 'AI returned malformed JSON. Try again.', raw: text };
  }
}

module.exports = { generatePost, callGrok, tryParseJson, getSetting };
