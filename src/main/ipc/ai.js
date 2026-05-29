const { getDb, encryptSecret, decryptSecret } = require('../db');
const { userFromToken } = require('./auth');
const { requirePermission } = require('../permissions');
const { generatePost } = require('../services/postgen');
const { getSetting, setSetting } = require('../services/settings');

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
      return await generatePost({ accountId, mode, hint, targetSubreddit });
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
