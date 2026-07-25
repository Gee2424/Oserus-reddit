const { ipcMain } = require('electron');
const { getDb } = require('../db');
const { userFromToken } = require('./auth');
const { getSetting } = require('../services/settings');

function register() {
  ipcMain.handle('automation:listRuns', async (_e, { token, accountId, platform, runType, status, limit = 100, offset = 0 }) => {
    const user = userFromToken(token);
    if (!user) throw new Error('Not authenticated');

    const db = getDb();
    const conditions = ['1=1'];
    const params = [];

    if (accountId) { conditions.push('ar.account_id = ?'); params.push(accountId); }
    if (platform) { conditions.push('ar.platform = ?'); params.push(platform); }
    if (runType) { conditions.push('ar.run_type = ?'); params.push(runType); }
    if (status) { conditions.push('ar.status = ?'); params.push(status); }

    const teamId = getSetting('active_team_id');
    if (teamId) {
      conditions.push('ar.account_id IN (SELECT id FROM reddit_accounts WHERE team_id = ?)');
      params.push(teamId);
    }

    params.push(limit, offset);

    const rows = db.prepare(`
      SELECT ar.*, a.username, p.name AS profile_name
      FROM automation_runs ar
      LEFT JOIN reddit_accounts a ON a.id = ar.account_id
      LEFT JOIN model_profiles p ON p.id = a.profile_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY ar.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params);

    const total = db.prepare(`
      SELECT COUNT(*) AS count FROM automation_runs ar
      WHERE ${conditions.join(' AND ')}
    `).pluck().get(...params.slice(0, -2));

    return { ok: true, runs: rows, total };
  });

  ipcMain.handle('automation:runStats', async (_e, { token }) => {
    const user = userFromToken(token);
    if (!user) throw new Error('Not authenticated');

    const db = getDb();
    const today = new Date().toISOString().slice(0, 10);
    const teamId = getSetting('active_team_id');
    const teamSql = teamId
      ? " AND account_id IN (SELECT id FROM reddit_accounts WHERE team_id = ?)"
      : '';
    const teamParams = teamId ? [teamId] : [];

    const stats = {
      todayCompleted: db.prepare(
        "SELECT COUNT(*) FROM automation_runs WHERE status='completed' AND created_at >= ?" + teamSql
      ).pluck().get(today + 'T00:00:00', ...teamParams),
      todayFailed: db.prepare(
        "SELECT COUNT(*) FROM automation_runs WHERE status='failed' AND created_at >= ?" + teamSql
      ).pluck().get(today + 'T00:00:00', ...teamParams),
      totalPending: 0,
      cmRuns: db.prepare(
        "SELECT COUNT(*) FROM automation_runs WHERE browser_mode='cloakmanager' AND created_at >= ?" + teamSql
      ).pluck().get(today + 'T00:00:00', ...teamParams),
    };

    return { ok: true, stats };
  });

  console.log('[ipc] automation handlers registered');
}

/**
 * Write a run record to the automation_runs table.
 * Called from coordinator, engagement, and CDP orchestrator.
 */
function recordRun(db, { accountId, platform, browserMode, runType, status, scriptId, resultJson, error, triggeredBy, schedulePostId, durationMs, startedAt, completedAt }) {
  try {
    return db.prepare(`
      INSERT INTO automation_runs
        (account_id, platform, browser_mode, run_type, status, script_id, result_json, error, triggered_by, schedule_post_id, duration_ms, started_at, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      accountId, platform, browserMode, runType, status,
      scriptId || null,
      resultJson || null,
      error || null,
      triggeredBy || null,
      schedulePostId || null,
      durationMs || null,
      startedAt || null,
      completedAt || null
    );
  } catch (e) {
    console.error('[automation] Failed to record run:', e.message);
    return null;
  }
}

module.exports = { register, recordRun };
