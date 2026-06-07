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

// Anthropic Claude — supports prompt caching for the big static system prompt
// (example posts + comments + persona + CTAs) which gets reused 10-50x/day
// per account. Cache hits cost ~10% of the first hit so autopilot scales.
async function callClaude(apiKey, system, userMessage, options = {}) {
  const model = options.model || getSetting('anthropic_model') || 'claude-haiku-4-5';
  // Mark the system prompt as cacheable so subsequent calls hit the cache.
  const body = {
    model,
    max_tokens: options.maxTokens || 1500,
    system: [
      { type: 'text', text: system, cache_control: { type: 'ephemeral' } },
    ],
    messages: [{ role: 'user', content: userMessage }],
  };
  // Sonnet 4.6 / Opus 4.6+ accept an extended-thinking effort hint. Haiku
  // doesn't — only attach when caller asks AND model isn't haiku.
  if (options.effort && !/haiku/i.test(model)) {
    body.output_config = { effort: options.effort };
  }
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `Anthropic API error: ${res.status}`);
  // Content is an array of blocks; concat the text ones.
  return (data.content || []).map((c) => c.type === 'text' ? c.text : '').join('') || '';
}

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

// Provider-aware dispatcher. Reads `ai_provider` setting + falls back through
// configured keys: if the chosen provider has no key but the other does, use
// the other. Defaults to Anthropic when both keys exist.
async function callAI(system, userMessage, options = {}) {
  const wanted = (options.provider || getSetting('ai_provider') || 'anthropic').toLowerCase();
  const anthropicKey = getSetting('anthropic_api_key');
  const grokKey = getSetting('grok_api_key');
  const tryAnthropic = !!anthropicKey;
  const tryGrok = !!grokKey;
  if (wanted === 'anthropic' && tryAnthropic) {
    return callClaude(decryptSecret(anthropicKey), system, userMessage, options);
  }
  if (wanted === 'grok' && tryGrok) {
    return callGrok(decryptSecret(grokKey), system, userMessage, options);
  }
  // Fallback to whichever key exists.
  if (tryAnthropic) return callClaude(decryptSecret(anthropicKey), system, userMessage, options);
  if (tryGrok) return callGrok(decryptSecret(grokKey), system, userMessage, options);
  throw new Error('No AI API key configured — set Anthropic or Grok in Configuration.');
}

// OpenAI chat-completions (used when autopilot protocol picks openai).
async function callOpenAI(apiKey, system, userMessage, options = {}) {
  const body = {
    model: options.model || getSetting('openai_model') || 'gpt-4o-mini',
    max_tokens: options.maxTokens || 1500,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: userMessage },
    ],
  };
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `OpenAI API error: ${res.status}`);
  return data.choices?.[0]?.message?.content || '';
}

// Autopilot AI dispatcher. Provider preference order:
//   1. options.provider (the autopilot_protocols row's ai_provider)
//   2. autopilot_ai_provider app_kv setting
//   3. 'claude'
// Each provider has its own key in app_kv. If the chosen provider's
// key is missing but the dedicated autopilot Anthropic key is set, we
// fall back to it so the loop keeps moving instead of failing closed.
async function callAutopilotAI(system, userMessage, options = {}) {
  const { decryptSecret } = require('../db');
  const wanted = String(options.provider || getSetting('autopilot_ai_provider') || 'claude').toLowerCase();

  const claudeEnc = getSetting('autopilot_anthropic_api_key') || getSetting('anthropic_api_key');
  const openaiEnc = getSetting('autopilot_openai_api_key')    || getSetting('openai_api_key');
  const grokEnc   = getSetting('autopilot_grok_api_key')      || getSetting('grok_api_key');

  if (wanted === 'openai' && openaiEnc) {
    const model = options.model || getSetting('autopilot_openai_model') || 'gpt-4o-mini';
    return callOpenAI(decryptSecret(openaiEnc), system, userMessage, { ...options, model });
  }
  if (wanted === 'grok' && grokEnc) {
    const model = options.model || getSetting('autopilot_grok_model') || 'grok-2-latest';
    return callGrok(decryptSecret(grokEnc), system, userMessage, { ...options, model });
  }
  if (wanted === 'claude' && claudeEnc) {
    const model = options.model || getSetting('autopilot_anthropic_model') || 'claude-haiku-4-5';
    return callClaude(decryptSecret(claudeEnc), system, userMessage, { ...options, model });
  }

  // Fallbacks: any configured key, Claude preferred.
  if (claudeEnc) {
    const model = options.model || getSetting('autopilot_anthropic_model') || 'claude-haiku-4-5';
    return callClaude(decryptSecret(claudeEnc), system, userMessage, { ...options, model });
  }
  if (openaiEnc) return callOpenAI(decryptSecret(openaiEnc), system, userMessage, options);
  if (grokEnc)   return callGrok(decryptSecret(grokEnc),   system, userMessage, options);
  throw new Error(`Autopilot AI key not configured for provider "${wanted}". Add one in Settings → AI.`);
}

// Default system-prompt templates for each autopilot job. These get used when
// no row exists in `autopilot_prompts` for the (job, profile_id) pair. The
// editor in Settings → Autopilot AI lets admins copy these into editable
// overrides — global or per-model.
const DEFAULT_AUTOPILOT_PROMPTS = {
  post_sfw: `You generate Reddit post ideas for a brand-new account that is warming up by posting in mainstream, non-promotional subreddits. The account is run by a person (not a marketer) who wants to engage genuinely with these communities, build comment karma, and look like a normal Redditor.

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
- {{subreddit_rule}}
- Titles must sound like a real person wrote them: lowercase okay, typos rarely okay, casual phrasing. Avoid corporate or AI-flavored phrases.
- ABSOLUTELY NO mention of OnlyFans, the model's brand, "DM me", links to external sites, or anything promotional. This is pure community engagement.
- No sexual content. No flirting. This is the warm-up phase.
- Vary the post types: a question, a story/observation, a confession, etc.
- Match the vibe of the chosen subreddit.

Give 3 suggestions{{target_clause}}.`,

  post_nsfw: `You generate Reddit post ideas for an OnlyFans model's established promotional account.

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
- {{subreddit_rule}}
- Titles should feel like a real human wrote them: casual, sometimes a question, sometimes a teasing statement. Avoid AI-flavored phrasing.
- Image direction describes composition and mood only — what the model is wearing/doing/where she's looking. Do NOT describe nudity or sexual acts; the user (the VA) will produce the actual content.
- Vary angle across the 3 suggestions: one playful, one direct, one teasing/curious.

Give 3 suggestions{{target_clause}}.`,

  comment: `You are this Reddit user: u/{{username}}.
{{brand_voice_line}}
Write ONE comment reply for the post below. Match the tone and angle of the example replies — concise, casual, real-person. No marketing, no promo, no AI tells. 1-4 sentences.

Output ONLY the comment text. No quotes, no preface, no signature.`,
};

function interpolatePrompt(template, vars) {
  return String(template || '').replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] != null ? String(vars[k]) : ''));
}

// Resolve the active prompt for a job: per-model override > global override >
// hardcoded default. Returns the raw template string (with {{vars}}).
function resolveAutopilotPrompt(job, profileId) {
  try {
    const db = getDb();
    if (profileId) {
      const row = db.prepare('SELECT prompt FROM autopilot_prompts WHERE job = ? AND profile_id = ?').get(job, profileId);
      if (row && row.prompt) return row.prompt;
    }
    const global = db.prepare('SELECT prompt FROM autopilot_prompts WHERE job = ? AND profile_id IS NULL').get(job);
    if (global && global.prompt) return global.prompt;
  } catch {}
  return DEFAULT_AUTOPILOT_PROMPTS[job] || '';
}

function tryParseJson(text) {
  const cleaned = text.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/\s*```\s*$/, '').trim();
  return JSON.parse(cleaned);
}

async function generatePost({ accountId, mode, hint, targetSubreddit, autopilot = false }) {
  // Manual VA flow uses callAI (main Anthropic or Grok key). Autopilot flow
  // uses callAutopilotAI (dedicated autopilot_anthropic_api_key, fail-closed).
  if (autopilot) {
    if (!getSetting('autopilot_anthropic_api_key')) {
      throw new Error('Autopilot AI key not configured. Set it in Settings → Autopilot AI.');
    }
  } else if (!getSetting('anthropic_api_key') && !getSetting('grok_api_key')) {
    throw new Error('No AI API key set. Add Anthropic or Grok in Configuration.');
  }

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

  // Pull subreddit candidates from the unified content_sources pool. Old
  // warmup_subreddits / promo_subreddits tables still exist and are kept in
  // sync via DB triggers (see db.js), so the existing Subreddits UI keeps
  // working; this code path is now Reddit's view of the generic pool.
  const contentSources = require('./contentSources');
  const rawCandidates = contentSources.list({
    platform: 'reddit',
    kind: isSfw ? 'warmup' : 'promo',
    profileId: account.profile_id,
  });
  const candidates = rawCandidates.map((c) => {
    let vibe = null;
    if (c.metadata_json) {
      try { vibe = JSON.parse(c.metadata_json).vibe || null; } catch {}
    }
    return { name: c.name, description: c.description, vibe };
  });

  // Free-form target: allow any subreddit even if not on the saved list.
  const cleanTarget = targetSubreddit ? String(targetSubreddit).replace(/^\/?r\//i, '').trim() : null;
  const targetOnList = cleanTarget && candidates.some((c) => c.name.toLowerCase() === cleanTarget.toLowerCase());

  // {{vars}} for prompt-template interpolation. subreddit_rule + target_clause
  // are derived from cleanTarget/targetOnList so the template can stay generic.
  const subredditRule = cleanTarget && !targetOnList
    ? `Write ALL suggestions for r/${cleanTarget} specifically (the user picked this subreddit even though it isn't on the saved list).`
    : 'Pick the subreddit ONLY from the list provided. Use the exact name.';
  const targetClause = cleanTarget && !targetOnList
    ? ` for r/${cleanTarget}`
    : ', each targeting a DIFFERENT subreddit when possible';
  const promptVars = {
    username: account.username,
    model_name: account.profile_name || '',
    niche: account.niche || '',
    brand_voice: account.brand_voice || '',
    target_subreddit: cleanTarget || '',
    hint: hint || '',
    subreddit_rule: subredditRule,
    target_clause: targetClause,
  };

  let system, userMsg;
  if (isSfw) {
    // Autopilot uses the editable template; manual VA path keeps the hardcoded
    // prompt so behavior stays identical when no override exists.
    system = autopilot
      ? interpolatePrompt(resolveAutopilotPrompt('post_sfw', account.profile_id), promptVars)
      : `You generate Reddit post ideas for a brand-new account that is warming up by posting in mainstream, non-promotional subreddits. The account is run by a person (not a marketer) who wants to engage genuinely with these communities, build comment karma, and look like a normal Redditor.

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
- ${subredditRule}
- Titles must sound like a real person wrote them: lowercase okay, typos rarely okay, casual phrasing. Avoid corporate or AI-flavored phrases.
- ABSOLUTELY NO mention of OnlyFans, the model's brand, "DM me", links to external sites, or anything promotional. This is pure community engagement.
- No sexual content. No flirting. This is the warm-up phase.
- Vary the post types: a question, a story/observation, a confession, etc.
- Match the vibe of the chosen subreddit.

Give 3 suggestions${targetClause}.`;

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
    system = autopilot
      ? interpolatePrompt(resolveAutopilotPrompt('post_nsfw', account.profile_id), promptVars)
      : `You generate Reddit post ideas for an OnlyFans model's established promotional account.

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

  // Example comments: pairs of (parent post) + (this account's reply). Teaches
  // the generator how this account FORMS opinions on something it reads, not
  // just surface style — what it focuses on, how it argues, when it gets
  // playful or blunt.
  try {
    const exComments = getDb().prepare(
      'SELECT parent_title, parent_body, subreddit, comment_body FROM account_example_comments WHERE account_id = ? ORDER BY RANDOM() LIMIT 6'
    ).all(account.id);
    if (exComments.length) {
      const block = exComments.map((e, i) => {
        const sub = e.subreddit ? `r/${e.subreddit} — ` : '';
        const parent = `${sub}post: "${e.parent_title}"${e.parent_body ? '\n     ' + String(e.parent_body).slice(0, 200) : ''}`;
        return `${i + 1}. ${parent}\n     this account replied: "${String(e.comment_body).slice(0, 400)}"`;
      }).join('\n');
      system += `\n\nHow this account forms opinions / replies (study the parent → reply pairs; mirror the angle, focus, and bluntness/playfulness this account uses — never copy the reply verbatim):\n${block}`;
    }
  } catch {}

  // Autopilot self-topic-discovery: pull a handful of trending titles from
  // the model's promo subs so the generator can find its own subjects.
  // postgen marks them used so we don't recycle the same title twice in a row.
  try {
    const trending = getDb().prepare(
      `SELECT id, subreddit, title FROM reddit_topic_candidates
        WHERE profile_id = ? AND used_at IS NULL
        ORDER BY score DESC, discovered_at DESC
        LIMIT 6`
    ).all(account.profile_id);
    if (trending.length) {
      const block = trending.map((t, i) => `${i + 1}. r/${t.subreddit} — "${t.title}"`).join('\n');
      system += `\n\nWhat's trending right now in this model's subs (use as inspiration for ANGLES + topics; never copy a title):\n${block}`;
      const mark = getDb().prepare(`UPDATE reddit_topic_candidates SET used_at = datetime('now') WHERE id = ?`);
      for (const t of trending) { try { mark.run(t.id); } catch {} }
    }
  } catch {}

  const text = autopilot
    ? await callAutopilotAI(system, userMsg)
    : await callAI(system, userMsg);
  try {
    const parsed = tryParseJson(text);
    return { ok: true, mode: isSfw ? 'sfw' : 'nsfw', suggestions: parsed.suggestions || [] };
  } catch (e) {
    return { ok: false, error: 'AI returned malformed JSON. Try again.', raw: text };
  }
}

module.exports = {
  generatePost, callGrok, callClaude, callAI, callAutopilotAI,
  tryParseJson, getSetting,
  resolveAutopilotPrompt, interpolatePrompt, DEFAULT_AUTOPILOT_PROMPTS,
};
