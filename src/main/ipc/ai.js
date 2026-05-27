const { getDb, encryptSecret, decryptSecret } = require('../db');
const { userFromToken } = require('./auth');
const { requirePermission } = require('../permissions');

function ensureSettingsTable() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

function setSetting(key, value) {
  ensureSettingsTable();
  getDb().prepare(
    'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime(\'now\')) ' +
    'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime(\'now\')'
  ).run(key, value);
}

function getSetting(key) {
  ensureSettingsTable();
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

async function callAnthropic(apiKey, system, userMessage, options = {}) {
  const body = {
    model: options.model || 'claude-sonnet-4-5',
    max_tokens: options.maxTokens || 1500,
    system,
    messages: [{ role: 'user', content: userMessage }],
  };
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
  if (!res.ok) {
    throw new Error(data?.error?.message || `Anthropic API error: ${res.status}`);
  }
  const text = data.content?.filter(c => c.type === 'text').map(c => c.text).join('\n') || '';
  return text;
}

function tryParseJson(text) {
  const cleaned = text.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/\s*```\s*$/, '').trim();
  return JSON.parse(cleaned);
}

function register(ipcMain) {
  ipcMain.handle('ai:setApiKey', (_e, { token, apiKey }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      requirePermission(user, 'ai.admin');
      setSetting('anthropic_api_key', apiKey ? encryptSecret(apiKey) : null);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('ai:hasApiKey', (_e, { token }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      const v = getSetting('anthropic_api_key');
      return { ok: true, hasKey: !!v };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // --- SUGGEST POST ---
  // mode: 'sfw' uses the global warmup subreddits list (engagement posts).
  // mode: 'nsfw' uses the model's promo subreddits list.
  ipcMain.handle('ai:suggestPost', async (_e, { token, accountId, mode, hint, targetSubreddit }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');

      const encKey = getSetting('anthropic_api_key');
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

      const isSfw = mode === 'sfw' || (mode !== 'nsfw' && account.status === 'warming');

      // Build the candidate-subreddits context the AI should pick from
      let candidates;
      if (isSfw) {
        candidates = getDb().prepare('SELECT name, vibe, description FROM warmup_subreddits ORDER BY name').all();
      } else {
        candidates = getDb().prepare('SELECT name, description FROM promo_subreddits WHERE profile_id = ? ORDER BY name').all(account.profile_id);
      }

      let system, userMsg;
      if (isSfw) {
        system = `You generate Reddit post ideas for a brand-new account that is warming up by posting in mainstream, non-promotional subreddits. The account is run by a person (not a marketer) who wants to engage genuinely with these communities, build comment karma, and look like a normal Redditor.

Output STRICTLY valid JSON with no markdown, no preamble, no code fences:
{
  "suggestions": [
    {
      "subreddit": "exact_name_from_the_provided_list",
      "title": "the post title (under 300 chars)",
      "body": "post body if it's a text post (can be empty string for link/image posts)",
      "kind": "self" | "link" | "image",
      "rationale": "one sentence on why this fits the sub"
    }
  ]
}

Rules:
- Pick the subreddit ONLY from the list provided. Use the exact name.
- Titles must sound like a real person wrote them: lowercase okay, typos rarely okay, casual phrasing. Avoid corporate or AI-flavored phrases.
- ABSOLUTELY NO mention of OnlyFans, the model's brand, "DM me", links to external sites, or anything promotional. This is pure community engagement.
- No sexual content. No flirting. This is the warm-up phase.
- Vary the post types: a question, a story/observation, a confession, etc.
- Match the vibe of the chosen subreddit. AskReddit gets open-ended questions; Showerthoughts gets clever one-liners; CasualConversation gets light personal observations.

Give 3 suggestions, each targeting a DIFFERENT subreddit when possible.`;

        userMsg = `Reddit username: u/${account.username}
Account status: ${account.status} (warming up — building karma in mainstream subs)
${candidates.length === 0 ? 'NOTE: No warm-up subreddits configured yet. Skip this turn and tell the user to add some in Subreddits → Warm-up.' : `Available subreddits to pick from:\n${candidates.map(c => `- r/${c.name}${c.vibe ? ` (${c.vibe})` : ''}${c.description ? `: ${c.description}` : ''}`).join('\n')}`}
${hint ? `\nVibe / theme hint from the user: ${hint}` : ''}
${targetSubreddit ? `\nFocus on r/${targetSubreddit} if it's appropriate.` : ''}

Generate 3 post ideas.`;
      } else {
        // NSFW promo mode
        system = `You generate Reddit post ideas for an OnlyFans model's established promotional account.

Output STRICTLY valid JSON with no markdown, no preamble, no code fences:
{
  "suggestions": [
    {
      "subreddit": "exact_name_from_the_provided_list",
      "title": "the post title (under 300 chars)",
      "image_direction": "what the image should show (1-2 sentences, no nudity descriptions — just composition, mood, lighting)",
      "rationale": "one sentence on why this combo works"
    }
  ]
}

Rules:
- Pick the subreddit ONLY from the list provided.
- Titles should feel like a real human wrote them: casual, sometimes a question, sometimes a teasing statement. Avoid AI-flavored phrasing.
- Image direction describes composition and mood only — what the model is wearing/doing/where she's looking. Do NOT describe nudity or sexual acts; the user (the VA) will produce the actual content.
- Vary angle across the 3 suggestions: one playful, one direct, one teasing/curious.

Give 3 suggestions, each targeting a DIFFERENT subreddit when possible.`;

        userMsg = `Model: ${account.profile_name}
Niche: ${account.niche || 'not specified'}
Brand voice: ${account.brand_voice || 'not specified'}
Reddit username: u/${account.username}
${candidates.length === 0 ? 'NOTE: No promo subreddits configured for this model. Tell the user to add some on the model detail page.' : `Promo subreddits for this model:\n${candidates.map(c => `- r/${c.name}${c.description ? `: ${c.description}` : ''}`).join('\n')}`}
${hint ? `\nVibe / theme hint: ${hint}` : ''}
${targetSubreddit ? `\nFocus on r/${targetSubreddit}.` : ''}

Generate 3 post ideas.`;
      }

      const text = await callAnthropic(apiKey, system, userMsg);
      try {
        const parsed = tryParseJson(text);
        return { ok: true, mode: isSfw ? 'sfw' : 'nsfw', suggestions: parsed.suggestions || [] };
      } catch (e) {
        return { ok: false, error: 'AI returned malformed JSON. Try again.', raw: text };
      }
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // --- IMPROVE TITLE ---
  ipcMain.handle('ai:improveTitle', async (_e, { token, accountId, currentTitle, subreddit, mode }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      const encKey = getSetting('anthropic_api_key');
      if (!encKey) throw new Error('No API key set');
      const apiKey = decryptSecret(encKey);

      const account = getDb()
        .prepare(
          `SELECT a.*, p.name AS profile_name, p.niche, p.brand_voice
           FROM reddit_accounts a JOIN model_profiles p ON p.id = a.profile_id
           WHERE a.id = ?`
        )
        .get(accountId);
      if (!account) throw new Error('Account not found');

      const isSfw = mode === 'sfw' || (mode !== 'nsfw' && account.status === 'warming');

      const system = `You rewrite Reddit post titles. Output STRICTLY valid JSON: { "variants": ["title 1", "title 2", "title 3"] }
${isSfw
  ? 'These are SFW engagement posts. Sound like a real person. No promo, no model name, no OF references.'
  : 'These are NSFW promo titles. Casual, human, varied tone across the 3 variants. No AI-flavored phrasing.'}
Each variant under 300 chars.`;

      const userMsg = `${isSfw ? '' : `Model: ${account.profile_name}\nNiche: ${account.niche || 'unspecified'}\n`}Target subreddit: r/${subreddit || 'unknown'}
Current title: "${currentTitle}"
Give 3 rewrites with varied angles.`;

      const text = await callAnthropic(apiKey, system, userMsg, { maxTokens: 600 });
      try {
        const parsed = tryParseJson(text);
        return { ok: true, variants: parsed.variants || [] };
      } catch (e) {
        return { ok: false, error: 'AI returned malformed JSON. Try again.', raw: text };
      }
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
}

module.exports = register;
