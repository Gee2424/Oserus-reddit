const { getDb } = require('../db');
const { userFromToken } = require('./auth');

// Account karma snapshots — populated by future Reddit API integration. Until
// then we expose what's already in reddit_accounts (latest known karma stored
// on the account row, if any).
function ensureTable() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS karma_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      post_karma INTEGER NOT NULL DEFAULT 0,
      comment_karma INTEGER NOT NULL DEFAULT 0,
      taken_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(account_id) REFERENCES reddit_accounts(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_karma_snapshots_account_time
      ON karma_snapshots(account_id, taken_at DESC);
  `);
}

function register(ipcMain) {
  ipcMain.handle('analytics:summary', (_e, { token, profileId }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      ensureTable();

      // Per-account roll-up. Most VAs care about: status, total karma if known,
      // number of posts they've drafted/scheduled.
      const accounts = profileId
        ? getDb().prepare(
            `SELECT a.id, a.username, a.platform, a.status, a.profile_id, p.name AS profile_name
             FROM reddit_accounts a LEFT JOIN model_profiles p ON p.id = a.profile_id
             WHERE a.profile_id = ?
             ORDER BY a.username`
          ).all(profileId)
        : getDb().prepare(
            `SELECT a.id, a.username, a.platform, a.status, a.profile_id, p.name AS profile_name
             FROM reddit_accounts a LEFT JOIN model_profiles p ON p.id = a.profile_id
             ORDER BY a.profile_id, a.username`
          ).all();

      const stats = accounts.map(a => {
        const latest = getDb().prepare(
          'SELECT post_karma, comment_karma, taken_at FROM karma_snapshots WHERE account_id = ? ORDER BY taken_at DESC LIMIT 1'
        ).get(a.id);
        const postsDraftCount = getDb().prepare(
          "SELECT COUNT(*) AS c FROM posts WHERE account_id = ?"
        ).get(a.id)?.c || 0;
        let scheduledCount = 0;
        try {
          scheduledCount = getDb().prepare(
            "SELECT COUNT(*) AS c FROM scheduled_posts WHERE account_id = ? AND status = 'pending'"
          ).get(a.id)?.c || 0;
        } catch {}
        return {
          ...a,
          post_karma: latest?.post_karma ?? null,
          comment_karma: latest?.comment_karma ?? null,
          total_karma: latest ? (latest.post_karma + latest.comment_karma) : null,
          karma_taken_at: latest?.taken_at ?? null,
          drafts: postsDraftCount,
          scheduled_pending: scheduledCount,
        };
      });

      // Cross-account roll-ups so the page has something to show even when
      // karma snapshots are sparse. Wrap each query in try/catch so a missing
      // table (fresh install) doesn't blow up the whole summary.
      let scheduledTotal = 0, postedTotal = 0, failedTotal = 0, eventsTotal = 0, boostsOrdered = 0;
      try { scheduledTotal = getDb().prepare("SELECT COUNT(*) c FROM scheduled_posts WHERE status='pending'").get()?.c || 0; } catch {}
      try { postedTotal    = getDb().prepare("SELECT COUNT(*) c FROM scheduled_posts WHERE status='posted'").get()?.c || 0; } catch {}
      try { failedTotal    = getDb().prepare("SELECT COUNT(*) c FROM scheduled_posts WHERE status='failed'").get()?.c || 0; } catch {}
      try { eventsTotal    = getDb().prepare("SELECT COUNT(*) c FROM post_events").get()?.c || 0; } catch {}
      try { boostsOrdered  = getDb().prepare("SELECT COUNT(*) c FROM scheduled_posts WHERE boost_status='ordered'").get()?.c || 0; } catch {}

      const byPlatform = {};
      for (const a of accounts) {
        const p = a.platform || 'reddit';
        byPlatform[p] = (byPlatform[p] || 0) + 1;
      }

      const totals = {
        accounts: accounts.length,
        ready: accounts.filter(a => a.status === 'ready').length,
        warming: accounts.filter(a => a.status === 'warming').length,
        paused: accounts.filter(a => a.status === 'paused').length,
        banned: accounts.filter(a => a.status === 'banned').length,
        total_karma: stats.reduce((s, a) => s + (a.total_karma || 0), 0),
        scheduled: scheduledTotal,
        posted: postedTotal,
        failed: failedTotal,
        events: eventsTotal,
        boosts_ordered: boostsOrdered,
        by_platform: byPlatform,
      };

      return { ok: true, accounts: stats, totals };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('analytics:karmaHistory', (_e, { token, accountId, limit }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      ensureTable();
      const rows = getDb().prepare(
        'SELECT post_karma, comment_karma, taken_at FROM karma_snapshots WHERE account_id = ? ORDER BY taken_at DESC LIMIT ?'
      ).all(accountId, Number(limit) || 60);
      return { ok: true, history: rows.reverse() };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Manual snapshot — VA pastes karma counts from a Reddit profile page until
  // we have OAuth-backed automatic fetching.
  ipcMain.handle('analytics:recordKarma', (_e, { token, accountId, postKarma, commentKarma }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      ensureTable();
      getDb().prepare(
        'INSERT INTO karma_snapshots (account_id, post_karma, comment_karma) VALUES (?, ?, ?)'
      ).run(accountId, Number(postKarma) || 0, Number(commentKarma) || 0);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
}

module.exports = register;
