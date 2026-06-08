// Platform-aware AI text generation. Single entry point the per-platform
// adapters call to get a piece of content (tweet, IG caption, TikTok
// caption, comment) for an account.
//
// Wraps callAutopilotAI from postgen.js (which already routes to the
// operator's configured Claude / OpenAI / Grok key, with prompt-caching
// for the static system prompt). Loads account context — niche, brand
// voice, persona, example posts — so generations stay in voice.
//
// Returns { ok: true, text, hashtags?, length } or { ok: false, error }.

const { getDb } = require('../db');
const { callAutopilotAI, tryParseJson } = require('./postgen');

// Hard caps per platform so we never blow past the input limit.
const MAX = {
  x:         280,
  instagram: 2200,
  tiktok:    2200,
  reddit:    300,  // title length
};

// Per-platform stylistic guidance. Kept short — the account's brand_voice
// and niche carry the personality, this just shapes the format.
const STYLE = {
  x: 'Write a single tweet. Conversational, punchy, opinion-forward. No hashtag spam — 0 to 2 at most. No corporate copy. Sound like a real person, not a brand. Plain text only, no markdown, no emoji-only lines.',
  instagram: 'Write an Instagram caption. Personal, intimate, slightly aspirational. 1-4 short sentences then a line break, then 5-12 niche-relevant hashtags on the last line. No corporate copy. Hook in the first line.',
  tiktok: 'Write a TikTok caption. Native-feel: short, hooky, present-tense. 1-2 sentences. Add 3-7 hashtags at the end including one trend/algo hashtag (#fyp / #foryou).',
  comment_x: 'Write a single reply that adds something — agreement with a twist, a sharp counter, a one-liner joke, or a story-snippet. Reads like a real person, not a brand. No "Great post!" energy. <200 chars.',
  comment_instagram: 'Write a 1-2 sentence Instagram comment. Specific to the post if context is given. No "love this!" generic. Casual, warm, opinionated.',
  comment_tiktok: 'Write a one-line TikTok comment. Punchy, present-tense, lowercase-friendly. Could be a joke, a hot take, or a relatable confession.',
};

function loadAccountContext(accountId) {
  const db = getDb();
  const acct = db.prepare(`
    SELECT a.id, a.username, a.platform, a.notes,
           mp.id   AS profile_id,
           mp.name AS model_name,
           mp.niche, mp.brand_voice
      FROM reddit_accounts a
      JOIN model_profiles mp ON mp.id = a.profile_id
     WHERE a.id = ?
  `).get(accountId);
  if (!acct) return null;
  // Operator-configured persona / prompt per (profile, platform) from
  // the Autopilot UI. Falls back gracefully if missing.
  let persona = null, customPrompt = null;
  try {
    const proto = db.prepare(
      `SELECT comment_persona, comment_prompt
         FROM autopilot_protocols
        WHERE profile_id = ? AND platform = ?`
    ).get(acct.profile_id, acct.platform);
    if (proto) {
      persona = proto.comment_persona || null;
      customPrompt = proto.comment_prompt || null;
    }
  } catch {}
  return { ...acct, persona, customPrompt };
}

function buildSystem(ctx, platform, kind, targetName) {
  const max = MAX[platform] || 500;
  const style = STYLE[kind === 'comment' ? `comment_${platform}` : platform] || STYLE.x;
  const persona = ctx.persona ? `Persona: ${ctx.persona}.` : '';
  const voice   = ctx.brand_voice ? `Brand voice: "${ctx.brand_voice}".` : '';
  const niche   = ctx.niche ? `Niche: ${ctx.niche}.` : '';
  const target  = targetName ? `Posting in / replying to: ${targetName}.` : '';
  const custom  = ctx.customPrompt ? `Operator instructions: ${ctx.customPrompt}.` : '';
  return [
    `You write on behalf of @${ctx.username} on ${platform}.`,
    niche, voice, persona, target, custom, style,
    `Hard limit: ${max} characters. Return ONLY JSON: {"text": string, "hashtags": [string, ...]}`,
  ].filter(Boolean).join('\n');
}

async function generateText({ accountId, platform, kind = 'post', targetName = null, hint = null }) {
  const ctx = loadAccountContext(accountId);
  if (!ctx) return { ok: false, error: 'Account not found' };

  const system = buildSystem(ctx, platform, kind, targetName);
  const userMessage = hint
    ? `Write a ${kind} now. Theme/hint: ${hint}`
    : `Write a ${kind} now. Anything in voice — no specific theme.`;

  let raw;
  try {
    raw = await callAutopilotAI(system, userMessage, { maxTokens: 600 });
  } catch (e) {
    return { ok: false, error: `AI call failed: ${e.message}` };
  }
  const parsed = tryParseJson(raw);
  if (!parsed || typeof parsed.text !== 'string') {
    return { ok: false, error: 'AI returned non-JSON or missing text field' };
  }
  let text = String(parsed.text).trim();
  const hashtags = Array.isArray(parsed.hashtags) ? parsed.hashtags.map((h) => String(h).trim()).filter(Boolean) : [];

  // Append hashtags onto IG / TikTok captions if they're not already
  // baked into text (the model may inline them).
  if ((platform === 'instagram' || platform === 'tiktok') && hashtags.length && !/#\w+/.test(text)) {
    text += '\n\n' + hashtags.map((h) => h.startsWith('#') ? h : `#${h}`).join(' ');
  }

  // Final length guard.
  const max = MAX[platform] || 500;
  if (text.length > max) text = text.slice(0, max - 1).trimEnd() + '…';

  return { ok: true, text, hashtags, length: text.length };
}

module.exports = { generateText, MAX, STYLE };
