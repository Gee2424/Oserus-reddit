// Team / Management hub backend.
//
// Two handlers:
//
//   team:overview      Aggregates per-user productivity metrics for
//                      the management hub's main table (one row per
//                      teammate). Cheap enough to poll on a 15s
//                      interval — all queries hit indexed columns.
//
//   team:memberDetail  Drill-down for one teammate: assigned models,
//                      assigned accounts with karma + status, the
//                      last N posts / comments / engagement sessions
//                      / generic activity entries they generated.
//
// Permission: gated on `activity.view` (managers and owners). The
// data set is read-only and aggregated, never exposes credentials.

const { getDb } = require('../db');
const { userFromToken } = require('./auth');
const { requirePermission } = require('../permissions');

// Presence is derived from two heartbeat-maintained columns:
//
//   last_seen_at    bumped on every heartbeat (≤20s cadence)
//   last_action_at  bumped only when the user actually interacted
//
// Online = the app is open AND they did something in the last 5 min.
// Idle   = the app is open but no action for 5+ min.
// Offline= no heartbeat received in 2+ min (window closed or computer
//          suspended).
const ONLINE_GAP_MS   = 2  * 60 * 1000;   // window-open threshold
const ACTIVE_GAP_MS   = 5  * 60 * 1000;   // user-active threshold

function parseTs(s) {
  if (!s) return 0;
  // SQLite datetime('now') returns UTC time in format 'YYYY-MM-DD HH:MM:SS'
  // Append 'Z' to parse as UTC
  return new Date(s.replace(' ', 'T') + 'Z').getTime();
}

function tierFor(lastSeenIso, lastActionIso) {
  const seenAge = Date.now() - parseTs(lastSeenIso);
  if (!lastSeenIso || seenAge > ONLINE_GAP_MS) return 'offline';
  const actAge = Date.now() - parseTs(lastActionIso || lastSeenIso);
  if (actAge > ACTIVE_GAP_MS) return 'idle';
  return 'online';
}

function register(ipcMain) {

  // ─────────────────────────────────────────────────── team:overview
  ipcMain.handle('team:overview', (_e, { token }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      requirePermission(user, 'activity.view');
      const db = getDb();

      // Per-user aggregates. One round-trip; all sub-queries hit
      // indexed (account_id / profile_id / user_id) columns, so even
      // on a 1k-account agency this returns in a handful of ms.
      const rows = db.prepare(`
        SELECT
          u.id,
          u.username,
          u.display_name,
          u.role,
          u.avatar_color,
          u.created_at,
          (
            SELECT COUNT(*) FROM model_profiles WHERE assigned_user_id = u.id
          ) AS models_assigned,
          (
            SELECT COUNT(*) FROM reddit_accounts a
            JOIN model_profiles p ON p.id = a.profile_id
            WHERE p.assigned_user_id = u.id AND a.status != 'banned'
          ) AS accounts_active,
          (
            SELECT COUNT(*) FROM reddit_accounts a
            JOIN model_profiles p ON p.id = a.profile_id
            WHERE p.assigned_user_id = u.id AND a.status = 'banned'
          ) AS accounts_banned,
          (
            SELECT COUNT(*) FROM post_events e
            WHERE e.status = 'posted'
              AND e.created_at >= datetime('now', '-1 day')
              AND (
                e.created_by_user_id = u.id
                OR e.account_id IN (
                  SELECT a.id FROM reddit_accounts a
                  JOIN model_profiles p ON p.id = a.profile_id
                  WHERE p.assigned_user_id = u.id
                )
              )
          ) AS posts_today,
          (
            SELECT COUNT(*) FROM post_events e
            WHERE e.status = 'posted'
              AND e.created_at >= datetime('now', '-7 day')
              AND (
                e.created_by_user_id = u.id
                OR e.account_id IN (
                  SELECT a.id FROM reddit_accounts a
                  JOIN model_profiles p ON p.id = a.profile_id
                  WHERE p.assigned_user_id = u.id
                )
              )
          ) AS posts_week,
          (
            SELECT COUNT(*) FROM auto_comment_runs r
            WHERE r.status = 'posted'
              AND r.created_at >= datetime('now', '-1 day')
              AND r.account_id IN (
                SELECT a.id FROM reddit_accounts a
                JOIN model_profiles p ON p.id = a.profile_id
                WHERE p.assigned_user_id = u.id
              )
          ) AS comments_today,
          (
            SELECT COUNT(*) FROM auto_comment_runs r
            WHERE r.status = 'posted'
              AND r.created_at >= datetime('now', '-7 day')
              AND r.account_id IN (
                SELECT a.id FROM reddit_accounts a
                JOIN model_profiles p ON p.id = a.profile_id
                WHERE p.assigned_user_id = u.id
              )
          ) AS comments_week,
          (
            SELECT COALESCE(SUM(s.seconds), 0) FROM engagement_sessions s
            WHERE s.started_at >= datetime('now', '-1 day')
              AND s.account_id IN (
                SELECT a.id FROM reddit_accounts a
                JOIN model_profiles p ON p.id = a.profile_id
                WHERE p.assigned_user_id = u.id
              )
          ) AS engagement_seconds_today,
          u.last_seen_at   AS last_seen,
          u.last_action_at AS last_action,
          u.today_seconds  AS today_seconds_active,
          u.today_date     AS today_date,
          (
            SELECT COUNT(*) FROM activity_log
            WHERE user_id = u.id AND created_at >= datetime('now', '-1 day')
          ) AS actions_today
        FROM users u
        ORDER BY u.role, u.username
      `).all();

      // Karma gained today: per-user roll-up of latest-snapshot minus
      // closest snapshot before -24h, across their assigned accounts.
      // Done in two queries (latest, baseline) and merged in JS; pure-SQL
      // would need correlated MAX(taken_at)≤24h sub-queries per row which
      // are slow on a busy snapshot table.
      const karmaPerUser = {};
      try {
        const latest = db.prepare(`
          SELECT p.assigned_user_id AS uid,
                 COALESCE(SUM(ks.post_karma + ks.comment_karma), 0) AS total
          FROM model_profiles p
          JOIN reddit_accounts a ON a.profile_id = p.id
          JOIN karma_snapshots ks ON ks.id = (
            SELECT id FROM karma_snapshots WHERE account_id = a.id ORDER BY taken_at DESC LIMIT 1
          )
          WHERE p.assigned_user_id IS NOT NULL
          GROUP BY p.assigned_user_id
        `).all();
        const baseline = db.prepare(`
          SELECT p.assigned_user_id AS uid,
                 COALESCE(SUM(ks.post_karma + ks.comment_karma), 0) AS total
          FROM model_profiles p
          JOIN reddit_accounts a ON a.profile_id = p.id
          JOIN karma_snapshots ks ON ks.id = (
            SELECT id FROM karma_snapshots
            WHERE account_id = a.id AND taken_at <= datetime('now', '-1 day')
            ORDER BY taken_at DESC LIMIT 1
          )
          WHERE p.assigned_user_id IS NOT NULL
          GROUP BY p.assigned_user_id
        `).all();
        const bMap = new Map(baseline.map((r) => [r.uid, r.total]));
        for (const r of latest) {
          karmaPerUser[r.uid] = Math.max(0, r.total - (bMap.get(r.uid) || 0));
        }
      } catch {}

      // Roll over today_seconds_active when its stored day no longer
      // matches local "today" — keeps the dashboard from showing a
      // stale number across a midnight boundary before the next beat.
      const today = (() => {
        const d = new Date();
        const tz = d.getTimezoneOffset() * 60000;
        return new Date(d.getTime() - tz).toISOString().slice(0, 10);
      })();
      const members = rows.map((r) => {
        const todaySec = r.today_date === today ? (r.today_seconds_active || 0) : 0;
        return {
          ...r,
          karma_today: karmaPerUser[r.id] || 0,
          engagement_minutes_today: Math.round((r.engagement_seconds_today || 0) / 60),
          // time_on_task = active minutes in the app today (heartbeat-driven)
          time_on_task_minutes: Math.round(todaySec / 60),
          presence: tierFor(r.last_seen, r.last_action),
        };
      });

      // Org-wide totals — what owners see at the top of the hub.
      const totals = {
        active_now:       members.filter((m) => m.presence === 'online').length,
        members_total:    members.length,
        posts_today:      members.reduce((s, m) => s + m.posts_today, 0),
        comments_today:   members.reduce((s, m) => s + m.comments_today, 0),
        karma_today:      members.reduce((s, m) => s + m.karma_today, 0),
        engagement_minutes_today: members.reduce((s, m) => s + m.engagement_minutes_today, 0),
        time_on_task_minutes:     members.reduce((s, m) => s + (m.time_on_task_minutes || 0), 0),
        accounts_active:  db.prepare("SELECT COUNT(*) AS n FROM reddit_accounts WHERE status != 'banned'").get().n,
        accounts_banned:  db.prepare("SELECT COUNT(*) AS n FROM reddit_accounts WHERE status = 'banned'").get().n,
        models_total:     db.prepare("SELECT COUNT(*) AS n FROM model_profiles").get().n,
      };

      return { ok: true, members, totals, generatedAt: new Date().toISOString() };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ────────────────────────────────────────────── team:memberDetail
  ipcMain.handle('team:memberDetail', (_e, { token, userId }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      requirePermission(user, 'activity.view');
      const db = getDb();
      const member = db.prepare(
        'SELECT id, username, display_name, role, avatar_color, created_at FROM users WHERE id = ?'
      ).get(Number(userId));
      if (!member) throw new Error('User not found');

      // Assigned models + per-model account count + per-model karma.
      const models = db.prepare(`
        SELECT p.id, p.name, p.niche,
               (SELECT COUNT(*) FROM reddit_accounts WHERE profile_id = p.id) AS accounts_count,
               (SELECT COUNT(*) FROM reddit_accounts WHERE profile_id = p.id AND status = 'banned') AS accounts_banned,
               COALESCE((
                 SELECT SUM(ks.post_karma + ks.comment_karma)
                 FROM reddit_accounts a
                 JOIN karma_snapshots ks ON ks.id = (
                   SELECT id FROM karma_snapshots WHERE account_id = a.id ORDER BY taken_at DESC LIMIT 1
                 )
                 WHERE a.profile_id = p.id
               ), 0) AS total_karma
        FROM model_profiles p
        WHERE p.assigned_user_id = ?
        ORDER BY p.name
      `).all(member.id);

      // Each assigned account with latest karma + status + last activity.
      const accounts = db.prepare(`
        SELECT a.id, a.username, a.platform, a.status, a.starred,
               p.name AS profile_name,
               (
                 SELECT post_karma + comment_karma FROM karma_snapshots
                 WHERE account_id = a.id ORDER BY taken_at DESC LIMIT 1
               ) AS karma_total,
               (
                 SELECT MAX(created_at) FROM post_events WHERE account_id = a.id
               ) AS last_post_at
        FROM reddit_accounts a
        JOIN model_profiles p ON p.id = a.profile_id
        WHERE p.assigned_user_id = ?
        ORDER BY p.name, a.platform, a.username
      `).all(member.id);

      // Recent items — same 15 across three feeds, merged on the client.
      const recentPosts = db.prepare(`
        SELECT e.id, e.subreddit, e.title, e.status, e.platform, e.source, e.created_at,
               a.username AS account_username
        FROM post_events e
        LEFT JOIN reddit_accounts a ON a.id = e.account_id
        WHERE e.created_by_user_id = ?
           OR e.account_id IN (
             SELECT a2.id FROM reddit_accounts a2
             JOIN model_profiles p ON p.id = a2.profile_id
             WHERE p.assigned_user_id = ?
           )
        ORDER BY e.id DESC LIMIT 15
      `).all(member.id, member.id);

      const recentComments = db.prepare(`
        SELECT r.id, r.subreddit, r.post_title, r.comment_text, r.status, r.created_at,
               a.username AS account_username
        FROM auto_comment_runs r
        LEFT JOIN reddit_accounts a ON a.id = r.account_id
        WHERE r.account_id IN (
          SELECT a2.id FROM reddit_accounts a2
          JOIN model_profiles p ON p.id = a2.profile_id
          WHERE p.assigned_user_id = ?
        )
        ORDER BY r.id DESC LIMIT 15
      `).all(member.id);

      const recentActions = db.prepare(`
        SELECT id, action, entity_type, entity_id, detail, created_at
        FROM activity_log
        WHERE user_id = ?
        ORDER BY id DESC LIMIT 25
      `).all(member.id);

      const recentEngagement = db.prepare(`
        SELECT s.id, s.platform, s.started_at, s.ended_at, s.seconds,
               s.posts_seen, s.likes, s.follows, s.comments, s.error,
               a.username AS account_username
        FROM engagement_sessions s
        LEFT JOIN reddit_accounts a ON a.id = s.account_id
        WHERE s.account_id IN (
          SELECT a2.id FROM reddit_accounts a2
          JOIN model_profiles p ON p.id = a2.profile_id
          WHERE p.assigned_user_id = ?
        )
        ORDER BY s.id DESC LIMIT 15
      `).all(member.id);

      return {
        ok: true,
        member: { ...member, presence: tierFor(
          recentActions[0]?.created_at
        ) },
        models,
        accounts,
        recent: {
          posts: recentPosts,
          comments: recentComments,
          actions: recentActions,
          engagement: recentEngagement,
        },
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
}

module.exports = register;
