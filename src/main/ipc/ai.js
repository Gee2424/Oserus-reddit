const { getDb, encryptSecret, decryptSecret } = require('../db');
const { userFromToken } = require('./auth');
const { requirePermission } = require('../permissions');
const { generatePost, callGrok, callAI } = require('../services/postgen');
const { getSetting, setSetting } = require('../services/settings');

function tryParseJson(text) {
  const cleaned = text.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/\s*```\s*$/, '').trim();
  return JSON.parse(cleaned);
}

function register(ipcMain) {
  // Legacy: matches the existing UI that passes one key. Defaults to Grok so
  // older callers still work. New UI uses ai:setProviderKey with a provider.
  ipcMain.handle('ai:setApiKey', (_e, { token, apiKey }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      requirePermission(user, 'ai.admin');
      setSetting('grok_api_key', apiKey ? encryptSecret(apiKey) : null);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('ai:hasApiKey', (_e, { token }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      // True when EITHER provider is configured — Composer / Ideas / Scheduler
      // AI gates read this; Anthropic-only users should pass.
      const v = !!getSetting('grok_api_key') || !!getSetting('anthropic_api_key');
      return { ok: true, hasKey: v };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Multi-provider: provider ∈ {'anthropic','grok','openai'}. apiKey=null clears.
  ipcMain.handle('ai:setProviderKey', (_e, { token, provider, apiKey }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      requirePermission(user, 'ai.admin');
      const map = { anthropic: 'anthropic_api_key', grok: 'grok_api_key', openai: 'openai_api_key' };
      const key = map[provider];
      if (!key) throw new Error('Unknown provider');
      setSetting(key, apiKey ? encryptSecret(apiKey) : null);
      return { ok: true };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('ai:getProviders', (_e, { token }) => {
    try {
      if (!userFromToken(token)) throw new Error('Not authenticated');
      return {
        ok: true,
        provider: getSetting('ai_provider') || 'anthropic',
        anthropic: { hasKey: !!getSetting('anthropic_api_key'), model: getSetting('anthropic_model') || 'claude-haiku-4-5' },
        grok: { hasKey: !!getSetting('grok_api_key'), model: getSetting('grok_model') || 'grok-2-latest' },
        openai: { hasKey: !!getSetting('openai_api_key'), model: getSetting('openai_model') || 'gpt-4o-mini' },
      };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('ai:setProvider', (_e, { token, provider, anthropicModel, grokModel }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      requirePermission(user, 'ai.admin');
      if (provider) setSetting('ai_provider', provider);
      if (anthropicModel) setSetting('anthropic_model', anthropicModel);
      if (grokModel) setSetting('grok_model', grokModel);
      return { ok: true };
    } catch (err) { return { ok: false, error: err.message }; }
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

  // --- AUTOPILOT AI: dedicated Anthropic key + editable per-job prompt library ---
  // The autopilot key is separate from the main Anthropic key so agencies can
  // bill autopilot to its own workspace. Fail-closed: no fallback to the main
  // key if this one isn't set.
  ipcMain.handle('autopilot:getConfig', (_e, { token }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      return {
        ok: true,
        hasKey: !!getSetting('autopilot_anthropic_api_key'),
        model: getSetting('autopilot_anthropic_model') || 'claude-haiku-4-5',
      };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('autopilot:setKey', (_e, { token, apiKey }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      requirePermission(user, 'ai.admin');
      setSetting('autopilot_anthropic_api_key', apiKey ? encryptSecret(apiKey) : null);
      return { ok: true };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('autopilot:setModel', (_e, { token, model }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      requirePermission(user, 'ai.admin');
      setSetting('autopilot_anthropic_model', model || 'claude-haiku-4-5');
      return { ok: true };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  // Returns the editor state: defaults (read-only, for the "Reset" button) and
  // every override row. Renderer groups by job + profile.
  ipcMain.handle('autopilot:getPrompts', (_e, { token }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      const { DEFAULT_AUTOPILOT_PROMPTS } = require('../services/postgen');
      const overrides = getDb().prepare(
        'SELECT job, profile_id, prompt, updated_at FROM autopilot_prompts ORDER BY job, profile_id'
      ).all();
      const profiles = getDb().prepare(
        'SELECT id, name FROM model_profiles ORDER BY name'
      ).all();
      return { ok: true, defaults: DEFAULT_AUTOPILOT_PROMPTS, overrides, profiles };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('autopilot:setPrompt', (_e, { token, job, profileId, prompt }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      requirePermission(user, 'ai.admin');
      const allowed = ['post_sfw', 'post_nsfw', 'comment'];
      if (!allowed.includes(job)) throw new Error('Unknown job');
      const text = String(prompt || '').trim();
      if (!text) throw new Error('Prompt cannot be empty');
      const pid = profileId || null;
      // Composite PRIMARY KEY (job, profile_id) — but SQLite treats NULL in a
      // PK column as distinct, so we DELETE then INSERT to keep upsert semantics
      // for the global-default row.
      const db = getDb();
      if (pid == null) {
        db.prepare('DELETE FROM autopilot_prompts WHERE job = ? AND profile_id IS NULL').run(job);
        db.prepare('INSERT INTO autopilot_prompts (job, profile_id, prompt) VALUES (?, NULL, ?)').run(job, text);
      } else {
        db.prepare(
          `INSERT INTO autopilot_prompts (job, profile_id, prompt) VALUES (?, ?, ?)
           ON CONFLICT(job, profile_id) DO UPDATE SET prompt = excluded.prompt, updated_at = datetime('now')`
        ).run(job, pid, text);
      }
      return { ok: true };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  ipcMain.handle('autopilot:deletePrompt', (_e, { token, job, profileId }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      requirePermission(user, 'ai.admin');
      const db = getDb();
      if (profileId == null) {
        db.prepare('DELETE FROM autopilot_prompts WHERE job = ? AND profile_id IS NULL').run(job);
      } else {
        db.prepare('DELETE FROM autopilot_prompts WHERE job = ? AND profile_id = ?').run(job, profileId);
      }
      return { ok: true };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  // --- IMPROVE TITLE ---
  ipcMain.handle('ai:improveTitle', async (_e, { token, accountId, currentTitle, subreddit, mode }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      if (!getSetting('anthropic_api_key') && !getSetting('grok_api_key')) {
        throw new Error('No AI API key set');
      }

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

      const text = await callAI(system, userMsg, { maxTokens: 600 });
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
