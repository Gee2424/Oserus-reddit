const { net } = require('electron');
const { userFromToken } = require('./auth');

const UA = 'OserusManagement/0.1 (rule-precheck)';

function get(url) {
  return new Promise((resolve, reject) => {
    const req = net.request({ method: 'GET', url, redirect: 'follow' });
    req.setHeader('User-Agent', UA);
    req.setHeader('Accept', 'application/json');
    let body = '';
    req.on('response', (res) => {
      res.on('data', (chunk) => { body += chunk.toString(); });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, json: JSON.parse(body) }); }
        catch { resolve({ status: res.statusCode, json: null, raw: body }); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function register(ipcMain) {
  // Subreddit pre-check: fetch /r/X/about.json + about/rules.json (both public) so
  // a VA can see flair requirements, NSFW flag, account-age/karma gates BEFORE
  // they post. No auth required — these are public endpoints.
  ipcMain.handle('reddit:precheckSubreddit', async (_e, { token, subreddit }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      const sub = String(subreddit || '').trim().replace(/^r\//i, '');
      if (!sub) throw new Error('Subreddit required');

      const [aboutRes, rulesRes] = await Promise.all([
        get(`https://www.reddit.com/r/${encodeURIComponent(sub)}/about.json`),
        get(`https://www.reddit.com/r/${encodeURIComponent(sub)}/about/rules.json`),
      ]);

      if (aboutRes.status === 404 || (aboutRes.json?.error === 404)) {
        return { ok: false, error: `r/${sub} not found` };
      }
      if (aboutRes.status === 403 || aboutRes.json?.reason === 'private') {
        return { ok: false, error: `r/${sub} is private` };
      }
      if (aboutRes.json?.reason === 'banned') {
        return { ok: false, error: `r/${sub} is banned` };
      }

      const data = aboutRes.json?.data || {};
      const rules = (rulesRes.json?.rules || []).map(r => ({
        priority: r.priority,
        short_name: r.short_name,
        description: r.description,
        kind: r.kind,
        violation_reason: r.violation_reason,
      }));

      return {
        ok: true,
        info: {
          subreddit: sub,
          subscribers: data.subscribers,
          active_user_count: data.active_user_count,
          over18: !!data.over18,
          public_description: data.public_description,
          submission_type: data.submission_type, // any/link/self
          allow_images: data.allow_images,
          allow_videos: data.allow_videos,
          allow_galleries: data.allow_galleries,
          submit_text: data.submit_text || '',
          link_flair_enabled: !!data.link_flair_enabled,
          link_flair_position: data.link_flair_position,
        },
        rules,
        warnings: buildWarnings(data, rules),
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
}

function buildWarnings(data, rules) {
  const warnings = [];
  if (data.over18) warnings.push({ level: 'info', text: 'NSFW subreddit — posts must be marked NSFW.' });
  if (data.submission_type === 'link') warnings.push({ level: 'warn', text: 'Subreddit only accepts link posts (no text).' });
  if (data.submission_type === 'self') warnings.push({ level: 'warn', text: 'Subreddit only accepts text posts (no link/image).' });
  if (data.link_flair_enabled) warnings.push({ level: 'warn', text: 'Link flair is enabled — required by some subreddits before submission.' });
  if (data.allow_images === false) warnings.push({ level: 'warn', text: 'Image posts are disabled.' });
  if (data.allow_videos === false) warnings.push({ level: 'info', text: 'Video posts are disabled.' });

  const ruleText = rules.map(r => `${r.short_name || ''} ${r.description || ''} ${r.violation_reason || ''}`).join(' ').toLowerCase();
  if (/min(imum)? (post |comment )?karma|karma requirement/.test(ruleText)) {
    warnings.push({ level: 'warn', text: 'Subreddit rules mention a karma requirement — check before submitting.' });
  }
  if (/account age|days old|account.*\bold\b/.test(ruleText)) {
    warnings.push({ level: 'warn', text: 'Subreddit rules mention an account-age requirement.' });
  }
  if (/verif/.test(ruleText)) {
    warnings.push({ level: 'warn', text: 'Subreddit rules mention verification — likely needs photo verification before promo content.' });
  }
  return warnings;
}

module.exports = register;
