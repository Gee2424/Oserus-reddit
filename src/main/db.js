const path = require('path');
const { app, safeStorage } = require('electron');
const Database = require('better-sqlite3');

let db;

function getDb() {
  if (!db) initDatabase();
  return db;
}

// Encrypt sensitive data using Electron's safeStorage (OS keychain-backed)
function encryptSecret(plaintext) {
  if (!plaintext) return null;
  if (!safeStorage.isEncryptionAvailable()) {
    // Fallback for systems without OS keychain (rare on Win/Mac/Linux desktop).
    // Marked with a prefix so we know it's not encrypted.
    return 'PLAIN:' + Buffer.from(plaintext, 'utf8').toString('base64');
  }
  return 'ENC:' + safeStorage.encryptString(plaintext).toString('base64');
}

function decryptSecret(stored) {
  if (!stored) return null;
  if (stored.startsWith('PLAIN:')) {
    return Buffer.from(stored.slice(6), 'base64').toString('utf8');
  }
  if (stored.startsWith('ENC:')) {
    try {
      return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'));
    } catch (e) {
      console.error('Failed to decrypt secret:', e.message);
      return null;
    }
  }
  return stored; // legacy/unencrypted
}

function initDatabase() {
  const dbPath = path.join(app.getPath('userData'), 'reddit-manager.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL,
      display_name TEXT,
      email TEXT,
      phone TEXT,
      notes TEXT,
      avatar_color TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS model_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      assigned_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      niche TEXT,
      brand_voice TEXT,
      notes TEXT,
      avatar_color TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS reddit_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id INTEGER NOT NULL REFERENCES model_profiles(id) ON DELETE CASCADE,
      platform TEXT NOT NULL CHECK(platform IN ('reddit','redgifs')) DEFAULT 'reddit',
      username TEXT NOT NULL,
      partition_key TEXT NOT NULL UNIQUE,
      password_encrypted TEXT,
      email TEXT,
      email_password_encrypted TEXT,
      status TEXT NOT NULL CHECK(status IN ('warming','ready','paused','banned')) DEFAULT 'warming',
      proxy_id INTEGER REFERENCES proxies(id) ON DELETE SET NULL,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS proxies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('http','https','socks5')),
      host TEXT NOT NULL,
      port INTEGER NOT NULL,
      username TEXT,
      password_encrypted TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS webview_tabs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_locked INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Credentials for locked tabs. Two flavors:
    --   profile_id IS NULL  → global credentials (everyone using this tab sees them)
    --   profile_id IS NOT NULL → per-model-profile credentials (only visible when a user has an active account from that profile)
    CREATE TABLE IF NOT EXISTS locked_tab_credentials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tab_id INTEGER NOT NULL REFERENCES webview_tabs(id) ON DELETE CASCADE,
      profile_id INTEGER REFERENCES model_profiles(id) ON DELETE CASCADE,
      label TEXT,
      username TEXT,
      password_encrypted TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS post_drafts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL REFERENCES reddit_accounts(id) ON DELETE CASCADE,
      subreddit TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      link_url TEXT,
      kind TEXT NOT NULL CHECK(kind IN ('self','link','image')),
      flair TEXT,
      nsfw INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL CHECK(status IN ('draft','scheduled','posted','failed')) DEFAULT 'draft',
      scheduled_for TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Shared "house" list of SFW warm-up subreddits used by all accounts
    -- while their status is 'warming'. Admins maintain this list.
    CREATE TABLE IF NOT EXISTS warmup_subreddits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      vibe TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Per-model NSFW promo subreddits. Used once the account status is 'ready'.
    CREATE TABLE IF NOT EXISTS promo_subreddits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id INTEGER NOT NULL REFERENCES model_profiles(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(profile_id, name)
    );

    -- Unified content-source pool used by the multi-platform autopilot.
    -- Generalizes warmup_subreddits + promo_subreddits + per-platform
    -- equivalents (X hashtags, IG/TT tags, RedGifs tags). One table so
    -- the coordinator picks targets the same way for every platform.
    --
    --   platform : reddit | redgifs | x | instagram | tiktok
    --   scope    : 'global' (shared house list) | 'model' (per-model)
    --   scope_id : NULL for global; model_profiles.id for model scope
    --   kind     : 'warmup' (SFW, used while status='warming')
    --            | 'promo'  (used once status='ready')
    --   name     : subreddit name / hashtag / tag — bare, no prefix
    --   metadata : free-form JSON (vibe, karma gates, NSFW flag, etc.)
    CREATE TABLE IF NOT EXISTS content_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform TEXT NOT NULL,
      scope TEXT NOT NULL CHECK(scope IN ('global','model')),
      scope_id INTEGER,
      kind TEXT NOT NULL CHECK(kind IN ('warmup','promo')),
      name TEXT NOT NULL,
      description TEXT,
      metadata_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(platform, scope, scope_id, kind, name)
    );
    CREATE INDEX IF NOT EXISTS idx_content_sources_lookup
      ON content_sources (platform, scope, scope_id, kind);

    -- Role definitions. Builtin rows have is_builtin=1 and cannot be deleted.
    -- The 'key' column matches users.role (existing users keep their key).
    CREATE TABLE IF NOT EXISTS roles (
      key TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      description TEXT,
      is_builtin INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Which permissions each role has. Composite PK; deleting a role cascades.
    CREATE TABLE IF NOT EXISTS role_permissions (
      role_key TEXT NOT NULL REFERENCES roles(key) ON DELETE CASCADE,
      perm_key TEXT NOT NULL,
      PRIMARY KEY (role_key, perm_key)
    );

    -- Per-account library of example posts the autopilot/Grok prompt can draw
    -- from for style + topic seeding. One row per example, no global pool.
    CREATE TABLE IF NOT EXISTS account_example_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL REFERENCES reddit_accounts(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      body TEXT,
      subreddit TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Per-account image pool autopilot can attach when generating image posts.
    -- Stored as filesystem paths under userData/example_images/<account_id>/.
    CREATE TABLE IF NOT EXISTS account_example_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL REFERENCES reddit_accounts(id) ON DELETE CASCADE,
      file_path TEXT NOT NULL,
      caption TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Per-account example comments: pairs (the post the comment was made on)
    -- + (the comment text). Autopilot's reply/comment generator reads BOTH
    -- the parent and the example reply so it learns how this account forms
    -- opinions instead of just copying surface style.
    CREATE TABLE IF NOT EXISTS account_example_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL REFERENCES reddit_accounts(id) ON DELETE CASCADE,
      parent_title TEXT NOT NULL,
      parent_body TEXT,
      parent_url TEXT,
      subreddit TEXT,
      comment_body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Engagement protocol per account — human-like scroll/like/follow runs on
    -- IG / TikTok / X (also available for Reddit). The runner opens a hidden
    -- BrowserWindow on the account's session and executes platform scripts
    -- driven by these knobs. All disabled by default.
    CREATE TABLE IF NOT EXISTS engagement_protocols (
      account_id INTEGER PRIMARY KEY REFERENCES reddit_accounts(id) ON DELETE CASCADE,
      enabled INTEGER NOT NULL DEFAULT 0,
      sessions_per_day INTEGER NOT NULL DEFAULT 3,
      session_minutes_min INTEGER NOT NULL DEFAULT 6,
      session_minutes_max INTEGER NOT NULL DEFAULT 14,
      like_rate_pct INTEGER NOT NULL DEFAULT 18,
      follow_rate_pct INTEGER NOT NULL DEFAULT 4,
      watch_full_rate_pct INTEGER NOT NULL DEFAULT 25,
      -- Probability the session leaves an AI-generated comment on a
      -- given post (capped per session by the natural feed length).
      -- 0 disables commenting; ~5-10% feels human.
      comment_rate_pct INTEGER NOT NULL DEFAULT 0,
      -- When 1, the comment_rate_pct only applies to posts containing a
      -- <video>; text-only posts are skipped. Reduces awkward off-topic
      -- replies on static images.
      comment_videos_only INTEGER NOT NULL DEFAULT 1,
      hashtags_json TEXT,
      follow_list_json TEXT,
      last_run_at TEXT
    );

    -- One row per actually-run engagement session, for visibility + dedup.
    CREATE TABLE IF NOT EXISTS engagement_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL REFERENCES reddit_accounts(id) ON DELETE CASCADE,
      platform TEXT NOT NULL,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      ended_at TEXT,
      seconds INTEGER,
      posts_seen INTEGER NOT NULL DEFAULT 0,
      likes INTEGER NOT NULL DEFAULT 0,
      follows INTEGER NOT NULL DEFAULT 0,
      -- Comments posted (AI-generated, human-typed via preload bridge).
      comments INTEGER NOT NULL DEFAULT 0,
      error TEXT
    );

    -- Reddit topic discovery cache — coordinator pulls Hot/Top from each
    -- model's promo subreddits, dedupes, and stores candidate topics. postgen
    -- reads from here when generating posts so autopilot can find its own
    -- subjects instead of being told what to write.
    CREATE TABLE IF NOT EXISTS reddit_topic_candidates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id INTEGER REFERENCES model_profiles(id) ON DELETE CASCADE,
      subreddit TEXT NOT NULL,
      title TEXT NOT NULL,
      score INTEGER,
      num_comments INTEGER,
      url TEXT,
      discovered_at TEXT NOT NULL DEFAULT (datetime('now')),
      used_at TEXT,
      UNIQUE(profile_id, subreddit, title)
    );

    -- Per-account auto-comment protocol. autopilot picks posts from
    -- target_subs_json, reads the post body + existing top comments,
    -- generates a reply via the AI provider seeded with this account's
    -- account_example_comments, and submits via /api/comment.
    CREATE TABLE IF NOT EXISTS auto_comment_protocols (
      account_id INTEGER PRIMARY KEY REFERENCES reddit_accounts(id) ON DELETE CASCADE,
      enabled INTEGER NOT NULL DEFAULT 0,
      target_subs_json TEXT,            -- ['askreddit','casualconversation',...]
      comments_per_day INTEGER NOT NULL DEFAULT 5,
      session_minutes_min INTEGER NOT NULL DEFAULT 4,
      session_minutes_max INTEGER NOT NULL DEFAULT 10,
      last_run_at TEXT
    );

    -- Unified autopilot protocol — per model profile, per platform.
    --
    -- Replaces the per-account engagement_protocols + auto_comment_protocols
    -- pair. One row owns pacing + engagement rates + commenting + targeting +
    -- AI persona for one (profile, platform). Switching the active model in
    -- the Autopilot UI swaps which row you're editing.
    --
    -- Commenting and "engagement" (scroll/like/follow) are no longer separate
    -- concepts here — one knob (comment_rate_pct) governs whether a session
    -- also leaves AI-generated comments. Reddit-API based commenting is
    -- triggered from this same protocol when platform='reddit'.
    CREATE TABLE IF NOT EXISTS autopilot_protocols (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id INTEGER NOT NULL REFERENCES model_profiles(id) ON DELETE CASCADE,
      platform   TEXT    NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 0,
      -- pacing
      sessions_per_day    INTEGER NOT NULL DEFAULT 3,
      session_minutes_min INTEGER NOT NULL DEFAULT 6,
      session_minutes_max INTEGER NOT NULL DEFAULT 14,
      -- engagement rates (0-100)
      like_rate_pct        INTEGER NOT NULL DEFAULT 18,
      follow_rate_pct      INTEGER NOT NULL DEFAULT 4,
      watch_full_rate_pct  INTEGER NOT NULL DEFAULT 25,
      comment_rate_pct     INTEGER NOT NULL DEFAULT 0,
      comment_videos_only  INTEGER NOT NULL DEFAULT 1,
      -- targeting (all JSON arrays/objects, see services/autopilotProtocol.js)
      hashtags_json       TEXT,  -- which feeds / tags to surf
      follow_list_json    TEXT,  -- if set, only follow these handles
      target_filter_json  TEXT,  -- who to comment on: min/max followers, verified, exclude
      target_subs_json    TEXT,  -- Reddit: subreddits to comment under (API path)
      -- AI persona for comments
      comment_persona     TEXT,  -- 'playful' | 'curious' | 'flirty' | 'dry' | 'custom'
      comment_prompt      TEXT,  -- custom prompt body when persona='custom'
      last_run_at TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(profile_id, platform)
    );
    CREATE INDEX IF NOT EXISTS idx_autopilot_protocols_due
      ON autopilot_protocols (enabled, last_run_at);

    -- Editable per-job system prompts for the autopilot AI. NULL profile_id
    -- is the global default for that job; a row with a profile_id overrides
    -- for that model only. job ∈ ('post_sfw','post_nsfw','comment').
    CREATE TABLE IF NOT EXISTS autopilot_prompts (
      job TEXT NOT NULL,
      profile_id INTEGER REFERENCES model_profiles(id) ON DELETE CASCADE,
      prompt TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (job, profile_id)
    );

    -- One row per auto-comment session for the log.
    CREATE TABLE IF NOT EXISTS auto_comment_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL REFERENCES reddit_accounts(id) ON DELETE CASCADE,
      subreddit TEXT,
      post_id TEXT,
      post_title TEXT,
      comment_text TEXT,
      status TEXT,           -- 'posted' | 'skipped' | 'failed'
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS app_kv (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Migration: if users.role constraint is the old ('admin','creator') one, rebuild the table.
  // We detect this by checking sqlite_master for the constraint definition.
  try {
    const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get();
    if (tableInfo && tableInfo.sql && tableInfo.sql.includes("'creator'") && !tableInfo.sql.includes("'reddit_va'")) {
      console.log('[db] Migrating users table to new role schema...');
      db.exec('BEGIN TRANSACTION;');
      try {
        db.exec(`
          CREATE TABLE users_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL,
            display_name TEXT,
            email TEXT,
            phone TEXT,
            notes TEXT,
            avatar_color TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
          );
          INSERT INTO users_new (id, username, password_hash, role, display_name, email, phone, notes, avatar_color, created_at)
            SELECT id, username, password_hash,
              CASE WHEN role = 'creator' THEN 'reddit_va' ELSE role END,
              display_name, email, phone, notes, avatar_color, created_at
            FROM users;
          DROP TABLE users;
          ALTER TABLE users_new RENAME TO users;
        `);
        db.exec('COMMIT;');
        console.log('[db] Migration complete. "creator" role renamed to "reddit_va".');
      } catch (e) {
        db.exec('ROLLBACK;');
        console.error('[db] Migration failed:', e.message);
      }
    }
  } catch (e) {
    console.error('[db] Migration check failed:', e.message);
  }

  // Migration: drop the CHECK(platform IN ('reddit','redgifs')) constraint on
  // reddit_accounts.platform so new platforms (x, instagram, tiktok) save
  // without "CHECK constraint failed". The earlier dynamic-rebuild version
  // could silently fail on rows with quoted defaults and roll back, leaving
  // the constraint in place — this one writes the target schema literally.
  try {
    const t = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='reddit_accounts'").get();
    if (t && t.sql && t.sql.includes("CHECK(platform IN")) {
      console.log('[db] Removing CHECK constraint on reddit_accounts.platform…');
      const liveCols = db.prepare("PRAGMA table_info(reddit_accounts)").all().map((c) => c.name);
      // Columns we know exist in current code; copy whichever are actually
      // present so the migration works against any historic schema.
      const target = [
        'id', 'profile_id', 'platform', 'username', 'partition_key',
        'password_encrypted', 'email', 'email_password_encrypted',
        'status', 'proxy_id', 'notes', 'created_at',
        'user_agent', 'starred',
      ];
      const carry = target.filter((c) => liveCols.includes(c));
      const colList = carry.join(', ');
      db.exec('BEGIN TRANSACTION;');
      try {
        db.exec(`
          CREATE TABLE reddit_accounts_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            profile_id INTEGER NOT NULL REFERENCES model_profiles(id) ON DELETE CASCADE,
            platform TEXT NOT NULL DEFAULT 'reddit',
            username TEXT NOT NULL,
            partition_key TEXT NOT NULL UNIQUE,
            password_encrypted TEXT,
            email TEXT,
            email_password_encrypted TEXT,
            status TEXT NOT NULL CHECK(status IN ('warming','ready','paused','banned')) DEFAULT 'warming',
            proxy_id INTEGER REFERENCES proxies(id) ON DELETE SET NULL,
            notes TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            user_agent TEXT,
            starred INTEGER DEFAULT 0
          );
          INSERT INTO reddit_accounts_new (${colList}) SELECT ${colList} FROM reddit_accounts;
          DROP TABLE reddit_accounts;
          ALTER TABLE reddit_accounts_new RENAME TO reddit_accounts;
        `);
        db.exec('COMMIT;');
        console.log('[db] reddit_accounts.platform CHECK removed.');
      } catch (e) {
        db.exec('ROLLBACK;');
        console.error('[db] platform CHECK removal failed:', e.message);
      }
    }
  } catch (e) {
    console.error('[db] platform CHECK check failed:', e.message);
  }

  // Migration: drop the CHECK(role IN (...)) constraint on users.role so
  // custom role keys are allowed. Detect by looking for the CHECK clause.
  try {
    const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get();
    if (tableInfo && tableInfo.sql && tableInfo.sql.includes("CHECK(role IN")) {
      console.log('[db] Removing CHECK constraint on users.role to allow custom roles...');
      db.exec('BEGIN TRANSACTION;');
      try {
        db.exec(`
          CREATE TABLE users_new2 (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL,
            display_name TEXT,
            email TEXT,
            phone TEXT,
            notes TEXT,
            avatar_color TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
          );
          INSERT INTO users_new2 SELECT * FROM users;
          DROP TABLE users;
          ALTER TABLE users_new2 RENAME TO users;
        `);
        db.exec('COMMIT;');
        console.log('[db] users.role CHECK constraint removed.');
      } catch (e) {
        db.exec('ROLLBACK;');
        console.error('[db] CHECK removal failed:', e.message);
      }
    }
  } catch (e) {
    console.error('[db] CHECK check failed:', e.message);
  }

  // Seed builtin roles + their default permissions on first run.
  // Re-runs on every launch only re-insert rows that are missing — admin edits
  // to permissions are preserved.
  try {
    const { BUILTIN_ROLES } = require('../shared/permissions');
    const insertRole = db.prepare(
      'INSERT OR IGNORE INTO roles (key, label, description, is_builtin) VALUES (?, ?, ?, 1)'
    );
    const hasRolePerm = db.prepare(
      'SELECT 1 FROM role_permissions WHERE role_key = ? LIMIT 1'
    );
    const insertRolePerm = db.prepare(
      'INSERT OR IGNORE INTO role_permissions (role_key, perm_key) VALUES (?, ?)'
    );
    for (const r of BUILTIN_ROLES) {
      insertRole.run(r.key, r.label, r.description);
      // Only seed permissions if this role has none yet (first-time seed).
      // Don't overwrite admin edits on subsequent launches.
      const seeded = hasRolePerm.get(r.key);
      if (!seeded) {
        for (const p of r.permissions) {
          insertRolePerm.run(r.key, p);
        }
      }
    }
    // admin is the safety floor — top up every perm on every launch.
    try {
      const adminPerms = (BUILTIN_ROLES.find((r) => r.key === 'admin') || {}).permissions || [];
      for (const p of adminPerms) insertRolePerm.run('admin', p);
    } catch (e) {
      console.error('[db] Admin top-up failed:', e.message);
    }

    // Migrate away from the old manager/reddit_va/chatter builtins.
    // Unused → delete. In use → unflag is_builtin so the owner can edit/delete.
    try {
      const legacy = ['manager', 'reddit_va', 'chatter'];
      const usedStmt = db.prepare('SELECT 1 FROM users WHERE role = ? LIMIT 1');
      const dropRole = db.prepare('DELETE FROM roles WHERE key = ? AND is_builtin = 1');
      const dropPerms = db.prepare('DELETE FROM role_permissions WHERE role_key = ?');
      const unflag = db.prepare('UPDATE roles SET is_builtin = 0 WHERE key = ?');
      for (const k of legacy) {
        if (usedStmt.get(k)) unflag.run(k);
        else { dropRole.run(k); dropPerms.run(k); }
      }
    } catch (e) {
      console.error('[db] Legacy role migration failed:', e.message);
    }
  } catch (e) {
    console.error('[db] Roles seed failed:', e.message);
  }

  // Migration: add 'platform' column to reddit_accounts if missing
  try {
    const cols = db.prepare("PRAGMA table_info(reddit_accounts)").all();
    const hasPlatform = cols.some(c => c.name === 'platform');
    if (!hasPlatform) {
      console.log('[db] Adding platform column to reddit_accounts...');
      // CHECK constraints can't be added via ALTER; use a default and trust app-level validation.
      db.exec("ALTER TABLE reddit_accounts ADD COLUMN platform TEXT NOT NULL DEFAULT 'reddit'");
      console.log('[db] Platform column added. Existing accounts default to "reddit".');
    }
    // os_profile picks which device fingerprint family the account
    // presents. 'desktop' = Windows / macOS bias (legacy default).
    // 'android' = phone UA + mobile screen + WebGL + touch points so
    // browserscan and similar bot detectors see a coherent mobile
    // identity end-to-end. Future values: 'ios'.
    const hasOsProfile = cols.some((c) => c.name === 'os_profile');
    if (!hasOsProfile) {
      db.exec("ALTER TABLE reddit_accounts ADD COLUMN os_profile TEXT NOT NULL DEFAULT 'desktop'");
      console.log('[db] os_profile column added. Existing accounts default to "desktop".');
    }
    // Cached proxy geo — populated by the in-browser proxy check. Used
    // by fingerprint.loadOrCreate to overlay timezone + language onto
    // the static fingerprint so they always match the proxy's IP. Stops
    // browserscan / DataDome flagging an en-CA navigator on a US IP, or
    // a Europe/London timezone on an America/New_York exit.
    const hasGeoTz = cols.some((c) => c.name === 'geo_timezone');
    if (!hasGeoTz) {
      db.exec("ALTER TABLE reddit_accounts ADD COLUMN geo_timezone TEXT");
      db.exec("ALTER TABLE reddit_accounts ADD COLUMN geo_country TEXT");
      db.exec("ALTER TABLE reddit_accounts ADD COLUMN geo_checked_at TEXT");
      console.log('[db] geo cache columns added (timezone, country, checked_at).');
    }
  } catch (e) {
    console.error('[db] Platform migration failed:', e.message);
  }

  // Seed admin
  const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (userCount === 0) {
    const bcrypt = require('bcryptjs');
    const hash = bcrypt.hashSync('changeme', 10);
    db.prepare(
      'INSERT INTO users (username, password_hash, role, display_name, avatar_color) VALUES (?,?,?,?,?)'
    ).run('admin', hash, 'admin', 'Administrator', '#c8553d');
    console.log('[db] Seeded default admin user: admin / changeme');
  }

  // Clean up old per-user RedGifs locked tabs from previous versions.
  // RedGifs is now a floating button on the Reddit page, not a Custom Web Pages tab.
  db.prepare("DELETE FROM webview_tabs WHERE is_locked = 1 AND url LIKE '%redgifs%' AND user_id IS NOT NULL").run();

  // Seed default warm-up subreddits if the table is empty.
  // Admins can add/remove from these in the app.
  const warmupCount = db.prepare('SELECT COUNT(*) AS c FROM warmup_subreddits').get().c;
  if (warmupCount === 0) {
    const defaults = [
      { name: 'CasualConversation', vibe: 'friendly chat', description: 'Easy small talk, light personal observations.' },
      { name: 'NoStupidQuestions', vibe: 'curious', description: 'Genuine questions, no judgment.' },
      { name: 'AskReddit', vibe: 'discussion-prompt', description: 'Open-ended questions that invite stories.' },
      { name: 'Showerthoughts', vibe: 'witty observation', description: 'Quirky shower-thought style one-liners.' },
      { name: 'mildlyinteresting', vibe: 'show-and-tell', description: 'Small interesting visuals from daily life.' },
      { name: 'tipofmytongue', vibe: 'helpful', description: 'Asking the hive mind to help remember something.' },
      { name: 'AskWomen', vibe: 'gendered-discussion', description: 'Questions directed at women, conversational.' },
      { name: 'AskMen', vibe: 'gendered-discussion', description: 'Questions directed at men, conversational.' },
      { name: 'dating_advice', vibe: 'personal-advice', description: 'Asking for or offering dating perspective.' },
      { name: 'unpopularopinion', vibe: 'contrarian-take', description: 'Mildly spicy opinions to spark replies.' },
      { name: 'TooAfraidToAsk', vibe: 'curious-shy', description: 'Slightly embarrassing questions, low-stakes.' },
      { name: 'self', vibe: 'personal-story', description: 'Personal reflections and venting.' },
    ];
    const ins = db.prepare('INSERT INTO warmup_subreddits (name, vibe, description) VALUES (?,?,?)');
    for (const d of defaults) ins.run(d.name, d.vibe, d.description);
    console.log(`[db] Seeded ${defaults.length} default warm-up subreddits`);
  }

  // Lightweight schema migrations for tables already in users' DBs.
  // `CREATE TABLE IF NOT EXISTS` does NOT add columns to an existing
  // table — for adds we ALTER conditionally.
  try {
    const have = (table, col) => {
      const rows = db.prepare(`PRAGMA table_info(${table})`).all();
      return rows.some((r) => r.name === col);
    };
    if (!have('engagement_protocols', 'comment_rate_pct')) {
      db.exec('ALTER TABLE engagement_protocols ADD COLUMN comment_rate_pct INTEGER NOT NULL DEFAULT 0');
    }
    if (!have('engagement_protocols', 'comment_videos_only')) {
      db.exec('ALTER TABLE engagement_protocols ADD COLUMN comment_videos_only INTEGER NOT NULL DEFAULT 1');
    }
    if (!have('engagement_sessions', 'comments')) {
      db.exec('ALTER TABLE engagement_sessions ADD COLUMN comments INTEGER NOT NULL DEFAULT 0');
    }
    const apAdds = [
      ['min_upvote_ratio',      'REAL NOT NULL DEFAULT 0'],
      ['min_post_score',        'INTEGER NOT NULL DEFAULT 0'],
      ['nsfw_only',             'INTEGER NOT NULL DEFAULT 0'],
      ['hours_between_min',     'REAL NOT NULL DEFAULT 0'],
      ['hours_between_max',     'REAL NOT NULL DEFAULT 0'],
      ['daily_cap_comments',    'INTEGER NOT NULL DEFAULT 0'],
      ['daily_cap_posts',       'INTEGER NOT NULL DEFAULT 0'],
      ['quiet_start',           'INTEGER'],
      ['quiet_end',             'INTEGER'],
      ['ai_provider',           "TEXT NOT NULL DEFAULT 'claude'"],
    ];
    for (const [col, def] of apAdds) {
      if (!have('autopilot_protocols', col)) {
        try { db.exec(`ALTER TABLE autopilot_protocols ADD COLUMN ${col} ${def}`); } catch {}
      }
    }
  } catch (e) {
    console.warn('[db] engagement migration skipped:', e?.message);
  }

  // One-time backfill: fold per-account engagement_protocols and
  // auto_comment_protocols rows into the unified per-profile autopilot_protocols.
  // Idempotent — UNIQUE(profile_id, platform) skips conflicts, and we only
  // run when autopilot_protocols is still empty.
  try {
    const hasAny = db.prepare('SELECT 1 FROM autopilot_protocols LIMIT 1').get();
    if (!hasAny) {
      // Collapse multiple accounts under the same (profile, platform) by
      // taking the most-recently-touched engagement row as the source of
      // truth — losing the last config across siblings is acceptable on a
      // one-shot migration.
      const eRows = db.prepare(
        `SELECT a.profile_id, a.platform,
                e.enabled, e.sessions_per_day, e.session_minutes_min, e.session_minutes_max,
                e.like_rate_pct, e.follow_rate_pct, e.watch_full_rate_pct,
                e.comment_rate_pct, e.comment_videos_only,
                e.hashtags_json, e.follow_list_json, e.last_run_at
           FROM engagement_protocols e
           JOIN reddit_accounts a ON a.id = e.account_id
          ORDER BY COALESCE(e.last_run_at, '') DESC`
      ).all();
      const ins = db.prepare(
        `INSERT OR IGNORE INTO autopilot_protocols
          (profile_id, platform, enabled,
           sessions_per_day, session_minutes_min, session_minutes_max,
           like_rate_pct, follow_rate_pct, watch_full_rate_pct,
           comment_rate_pct, comment_videos_only,
           hashtags_json, follow_list_json, last_run_at)
         VALUES (@profile_id, @platform, @enabled,
                 @sessions_per_day, @session_minutes_min, @session_minutes_max,
                 @like_rate_pct, @follow_rate_pct, @watch_full_rate_pct,
                 @comment_rate_pct, @comment_videos_only,
                 @hashtags_json, @follow_list_json, @last_run_at)`
      );
      for (const r of eRows) ins.run(r);

      // Reddit auto_comment_protocols → set target_subs_json + bump
      // comment_rate_pct above 0 so commenting is on for that profile.
      const cRows = db.prepare(
        `SELECT a.profile_id, c.target_subs_json, c.enabled, c.comments_per_day
           FROM auto_comment_protocols c
           JOIN reddit_accounts a ON a.id = c.account_id
          WHERE c.enabled = 1
          ORDER BY a.profile_id`
      ).all();
      const upsertRedditComments = db.prepare(
        `INSERT INTO autopilot_protocols
          (profile_id, platform, enabled, target_subs_json, comment_rate_pct)
         VALUES (?, 'reddit', 1, ?, 100)
         ON CONFLICT(profile_id, platform) DO UPDATE SET
           target_subs_json = excluded.target_subs_json,
           comment_rate_pct = CASE
             WHEN autopilot_protocols.comment_rate_pct < 1 THEN 100
             ELSE autopilot_protocols.comment_rate_pct
           END,
           enabled = 1`
      );
      for (const r of cRows) upsertRedditComments.run(r.profile_id, r.target_subs_json);

      if (eRows.length || cRows.length) {
        console.log(
          `[db] Backfilled autopilot_protocols: ${eRows.length} engagement, ${cRows.length} auto-comment`
        );
      }
    }
  } catch (e) {
    console.warn('[db] autopilot_protocols backfill skipped:', e?.message);
  }

  // Keep content_sources in sync with the legacy per-platform target tables
  // forever (until v0.63 drops them). Triggers mean the existing Subreddits
  // UI can keep INSERT/UPDATE/DELETE-ing the old tables without code changes
  // while the autopilot reads exclusively from content_sources. Each trigger
  // is CREATE-IF-NOT-EXISTS so reruns are safe.
  try {
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS warmup_subreddits_to_cs_ins
      AFTER INSERT ON warmup_subreddits BEGIN
        INSERT OR IGNORE INTO content_sources
          (platform, scope, scope_id, kind, name, description, metadata_json)
        VALUES
          ('reddit', 'global', NULL, 'warmup', NEW.name, NEW.description,
           CASE WHEN NEW.vibe IS NULL THEN NULL
                ELSE json_object('vibe', NEW.vibe) END);
      END;

      CREATE TRIGGER IF NOT EXISTS warmup_subreddits_to_cs_upd
      AFTER UPDATE ON warmup_subreddits BEGIN
        UPDATE content_sources
           SET name = NEW.name,
               description = NEW.description,
               metadata_json = CASE WHEN NEW.vibe IS NULL THEN NULL
                                    ELSE json_object('vibe', NEW.vibe) END
         WHERE platform = 'reddit'
           AND scope = 'global'
           AND scope_id IS NULL
           AND kind = 'warmup'
           AND name = OLD.name;
      END;

      CREATE TRIGGER IF NOT EXISTS warmup_subreddits_to_cs_del
      AFTER DELETE ON warmup_subreddits BEGIN
        DELETE FROM content_sources
         WHERE platform = 'reddit'
           AND scope = 'global'
           AND scope_id IS NULL
           AND kind = 'warmup'
           AND name = OLD.name;
      END;

      CREATE TRIGGER IF NOT EXISTS promo_subreddits_to_cs_ins
      AFTER INSERT ON promo_subreddits BEGIN
        INSERT OR IGNORE INTO content_sources
          (platform, scope, scope_id, kind, name, description)
        VALUES
          ('reddit', 'model', NEW.profile_id, 'promo', NEW.name, NEW.description);
      END;

      CREATE TRIGGER IF NOT EXISTS promo_subreddits_to_cs_upd
      AFTER UPDATE ON promo_subreddits BEGIN
        UPDATE content_sources
           SET name = NEW.name,
               description = NEW.description
         WHERE platform = 'reddit'
           AND scope = 'model'
           AND scope_id = NEW.profile_id
           AND kind = 'promo'
           AND name = OLD.name;
      END;

      CREATE TRIGGER IF NOT EXISTS promo_subreddits_to_cs_del
      AFTER DELETE ON promo_subreddits BEGIN
        DELETE FROM content_sources
         WHERE platform = 'reddit'
           AND scope = 'model'
           AND scope_id = OLD.profile_id
           AND kind = 'promo'
           AND name = OLD.name;
      END;
    `);
  } catch (e) {
    console.warn('[db] content_sources mirror triggers skipped:', e?.message);
  }

  // One-time backfill: mirror existing warmup_subreddits + promo_subreddits
  // into content_sources so the multi-platform autopilot can use the same
  // pool. Idempotent — UNIQUE constraint on content_sources skips dupes.
  try {
    const hasContent = db.prepare(
      "SELECT 1 FROM content_sources WHERE platform = 'reddit' LIMIT 1"
    ).get();
    if (!hasContent) {
      const insWarm = db.prepare(
        `INSERT OR IGNORE INTO content_sources
         (platform, scope, scope_id, kind, name, description, metadata_json)
         VALUES ('reddit', 'global', NULL, 'warmup', ?, ?, ?)`
      );
      const wRows = db.prepare('SELECT name, description, vibe FROM warmup_subreddits').all();
      for (const w of wRows) {
        insWarm.run(w.name, w.description || null, w.vibe ? JSON.stringify({ vibe: w.vibe }) : null);
      }
      const insPromo = db.prepare(
        `INSERT OR IGNORE INTO content_sources
         (platform, scope, scope_id, kind, name, description)
         VALUES ('reddit', 'model', ?, 'promo', ?, ?)`
      );
      const pRows = db.prepare('SELECT profile_id, name, description FROM promo_subreddits').all();
      for (const p of pRows) {
        insPromo.run(p.profile_id, p.name, p.description || null);
      }
      if (wRows.length || pRows.length) {
        console.log(`[db] Backfilled content_sources: ${wRows.length} warmup, ${pRows.length} promo`);
      }
    }
  } catch (e) {
    console.warn('[db] content_sources backfill skipped:', e?.message);
  }
}

function getKv(key) {
  try {
    const row = getDb().prepare('SELECT value FROM app_kv WHERE key = ?').get(key);
    return row ? row.value : null;
  } catch {
    return null;
  }
}

function setKv(key, value) {
  getDb().prepare(
    `INSERT INTO app_kv (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  ).run(key, value == null ? null : String(value));
}

module.exports = { initDatabase, getDb, encryptSecret, decryptSecret, getKv, setKv };
