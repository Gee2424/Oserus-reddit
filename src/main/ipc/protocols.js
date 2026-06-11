// IPC surface for posting protocols + the autopilot coordinator.
// Renderer never touches the DB directly — everything goes through here.

const { userFromToken } = require('./auth');
const { requirePermission } = require('../permissions');
const { log } = require('./activity');
const protocols = require('../services/protocols');
const coordinator = require('../services/coordinator');
const { getDb } = require('../db');
const { getSetting, setSetting } = require('../services/settings');

function register(ipcMain) {
  // --- Protocol config CRUD (override hierarchy) ---
  ipcMain.handle('protocols:get', (_e, { token, scope, scopeId }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      const raw = protocols.getRawConfig(scope || 'global', scopeId ?? null);
      const effective = protocols.resolveProtocol({
        platform: scope === 'platform' ? scopeId : null,
        profileId: scope === 'model' ? scopeId : null,
        accountId: scope === 'account' ? scopeId : null,
      });
      return { ok: true, raw: raw || {}, effective, defaults: protocols.DEFAULT_PROTOCOL };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('protocols:set', (_e, { token, scope, scopeId, config }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      requirePermission(user, 'protocols.manage');
      protocols.setConfig(scope || 'global', scopeId ?? null, config || {});
      log(user, 'protocols.set', scope || 'global', scopeId ?? null, JSON.stringify(config || {}).slice(0, 200));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Effective protocol + live eligibility for one account (preview in UI).
  ipcMain.handle('protocols:eligibility', (_e, { token, platform, accountId, profileId }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      const result = protocols.checkEligibility({ platform: platform || 'reddit', accountId, profileId });
      const last = protocols.lastPostAt(platform || 'reddit', accountId);
      return { ok: true, ...result, lastPostAt: last };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // --- Autopilot controls ---
  ipcMain.handle('autopilot:status', (_e, { token }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      return { ok: true, ...coordinator.status(), backend: protocols.backendName() };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // --- Cloud coordination (Supabase) config ---
  ipcMain.handle('coordination:get', (_e, { token }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      return {
        ok: true,
        backend: protocols.backendName(),
        url: getSetting('supabase_url') || '',
        hasKey: !!getSetting('supabase_key'),
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('coordination:set', (_e, { token, backend, url, key }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      requirePermission(user, 'protocols.manage');
      if (backend != null) setSetting('coordination_backend', backend === 'supabase' ? 'supabase' : 'local');
      if (url != null) setSetting('supabase_url', url);
      if (key) setSetting('supabase_key', key); // only overwrite when provided
      log(user, 'coordination.set', 'system', null, `backend=${backend}`);
      return { ok: true, backend: protocols.backendName() };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // --- AI / poster settings (Scheduler Pro AI panel) ---
  ipcMain.handle('aiconfig:get', (_e, { token }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      const v = getSetting('ai_poster_config');
      const cfg = v ? JSON.parse(v) : {};
      return { ok: true, config: cfg };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('aiconfig:set', (_e, { token, config }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      requirePermission(user, 'protocols.manage');
      setSetting('ai_poster_config', JSON.stringify(config || {}));
      if (config && config.model) setSetting('grok_model', config.model);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('coordination:test', async (_e, { token }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      const coordination = require('../services/coordination');
      return await coordination.testConnection();
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('autopilot:setEnabled', (_e, { token, enabled }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      requirePermission(user, 'protocols.manage');
      setSetting('autopilot_enabled', enabled ? '1' : '0');
      log(user, 'autopilot.toggle', 'system', null, enabled ? 'enabled' : 'disabled');
      return { ok: true, enabled: !!enabled };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('autopilot:setInterval', (_e, { token, minutes }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      requirePermission(user, 'protocols.manage');
      setSetting('autopilot_interval_min', Math.max(5, Number(minutes) || 30));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Canonical "run now" handler. Two modes:
  //   • Scoped: caller passed { profileId, platform } — run one
  //     engagement session for an account on that scope (or a picked
  //     accountId). This is what the Autopilot page's Run-now button
  //     calls when an account is selected.
  //   • System-wide: caller didn't pass profileId — run a full
  //     coordinator pass over every eligible account.
  ipcMain.handle('autopilot:runNow', async (_e, { token, profileId, platform, accountId, dryRun }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      requirePermission(user, 'protocols.run');

      // Scoped: single engagement session.
      if (profileId && platform) {
        const { getDb } = require('../db');
        const modelName = (getDb().prepare(
          'SELECT name FROM model_profiles WHERE id = ?'
        ).get(profileId) || {}).name || `model ${profileId}`;

        let id = accountId;
        if (!id) {
          const row = getDb().prepare(
            `SELECT id FROM reddit_accounts
              WHERE profile_id = ? AND platform = ? AND status IN ('warming','ready')
              ORDER BY RANDOM() LIMIT 1`
          ).get(profileId, platform);
          if (!row) {
            // Distinguish "no accounts at all" from "all banned/paused".
            const anyOnPlat = getDb().prepare(
              `SELECT COUNT(*) AS n FROM reddit_accounts WHERE profile_id = ? AND platform = ?`
            ).get(profileId, platform);
            if (!anyOnPlat || !anyOnPlat.n) {
              throw new Error(`No ${platform} accounts linked to "${modelName}". Add one on the model profile, then come back.`);
            }
            throw new Error(`All ${platform} accounts on "${modelName}" are paused or banned — set one to 'warming' or 'ready' to run.`);
          }
          id = row.id;
        }
        const { runSession } = require('../services/engagement');
        const res = await runSession(id, { dryRun: !!dryRun });
        // runSession returns { ok, error?, stats, seconds, sessionId }
        // — surface its error verbatim to the UI rather than masking
        // a useful message behind a successful IPC envelope.
        if (!res.ok && res.error) {
          log(user, 'autopilot.runNow', 'engagement', id, `error: ${res.error}`);
          return { ok: false, error: res.error, stats: res.stats, seconds: res.seconds, sessionId: res.sessionId };
        }
        const s = res.stats || {};
        const summary = dryRun
          ? `dry-run · seen=${s.posts_seen || 0} · would_like=${s.would_like || 0} · would_follow=${s.would_follow || 0} · would_comment=${s.would_comment || 0}`
          : `seen=${s.posts_seen || 0} · liked=${s.likes || 0} · followed=${s.follows || 0} · commented=${s.comments || 0}`;
        log(user, 'autopilot.runNow', 'engagement', id, summary);
        return res;
      }

      // System-wide: coordinator pass + a single engagement tick so the
      // unified loop actually moves even when no scope is selected.
      const summary = await coordinator.runOnce({ dryRun: !!dryRun });
      let engagementTicked = false;
      try {
        const { engagementTick } = require('../services/engagement');
        await engagementTick();
        engagementTicked = true;
      } catch (e) {
        // engagement loop is best-effort; coordinator result still useful.
      }
      log(user, 'autopilot.runNow', 'system', null,
        dryRun ? 'dry-run' : `posted=${summary.posted} skipped=${summary.skipped} failed=${summary.failed} engagement=${engagementTicked ? 'yes' : 'no'}`);
      return { ok: true, summary, engagementTicked };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // One-off post. Different from runNow (which is engagement):
  // this calls into the same code path the background autopilot uses
  // to generate AI content + submit it via the platform adapter, but
  // restricted to a single account picked by the operator. Used by the
  // "Post one now" button on the Autopilot page so operators can see
  // the posting loop actually move without waiting 30 min for the
  // background tick.
  ipcMain.handle('autopilot:postNow', async (_e, { token, profileId, platform, accountId }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      requirePermission(user, 'protocols.run');
      if (!profileId || !platform) throw new Error('profileId + platform required');

      const { getDb } = require('../db');
      let id = accountId;
      if (!id) {
        const row = getDb().prepare(
          `SELECT id FROM reddit_accounts
            WHERE profile_id = ? AND platform = ? AND status IN ('warming','ready')
            ORDER BY RANDOM() LIMIT 1`
        ).get(profileId, platform);
        if (!row) throw new Error(`No active ${platform} accounts on this profile.`);
        id = row.id;
      }
      const acct = getDb().prepare(
        `SELECT a.id, a.username, a.status, a.platform, a.profile_id,
                a.proxy_id, a.partition_key,
                p.name AS profile_name, p.niche, p.brand_voice
           FROM reddit_accounts a
           JOIN model_profiles p ON p.id = a.profile_id
          WHERE a.id = ?`
      ).get(id);
      if (!acct) throw new Error('Account not found');

      const summary = { considered: 1, posted: 0, skipped: 0, failed: 0,
                        reasons: {}, errors: [], perPlatform: {} };
      await coordinator.runForAccount(acct, summary);
      log(user, 'autopilot.postNow', 'engagement', id,
        `posted=${summary.posted} failed=${summary.failed} ` +
        `reasons=${Object.keys(summary.reasons).join(',') || '-'}`);
      return { ok: true, summary };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Recent events for the activity feed. Unions post_events (posts,
  // API comments, scheduled fires) with engagement_sessions (DOM
  // scroll-likes-follows-comments) so the operator sees a single
  // chronological feed and can prove autopilot actually ran. Without
  // this, the engagement loop appears silent — its work goes only
  // to engagement_sessions, which the UI never read.
  ipcMain.handle('protocols:events', (_e, { token, limit }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      protocols.ensureTables();
      const cap = Math.min(Number(limit) || 100, 500);
      const posts = getDb().prepare(
        `SELECT e.id, e.platform, e.account_id, e.profile_id, e.subreddit,
                e.title, e.status, e.source, e.error, e.created_at, e.remote_id,
                a.username AS account_username, p.name AS profile_name,
                'post' AS event_kind
         FROM post_events e
         LEFT JOIN reddit_accounts a ON a.id = e.account_id
         LEFT JOIN model_profiles p ON p.id = e.profile_id
         ORDER BY e.id DESC LIMIT ?`
      ).all(cap);
      let sessions = [];
      try {
        sessions = getDb().prepare(
          `SELECT s.id, s.platform, s.account_id,
                  a.profile_id AS profile_id,
                  NULL AS subreddit,
                  NULL AS title,
                  CASE
                    WHEN s.error IS NULL              THEN 'engaged'
                    WHEN s.error LIKE 'dry-run%'      THEN 'dry-run'
                    ELSE 'engaged-err'
                  END AS status,
                  'engagement' AS source,
                  s.error, s.started_at AS created_at, NULL AS remote_id,
                  a.username AS account_username, p.name AS profile_name,
                  'session' AS event_kind,
                  s.posts_seen, s.likes, s.follows, s.comments, s.seconds
           FROM engagement_sessions s
           LEFT JOIN reddit_accounts a ON a.id = s.account_id
           LEFT JOIN model_profiles p ON p.id = a.profile_id
           ORDER BY s.id DESC LIMIT ?`
        ).all(cap);
      } catch {}
      const events = [...posts, ...sessions]
        .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
        .slice(0, cap);
      return { ok: true, events };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
}

module.exports = register;
