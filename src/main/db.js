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
      role TEXT NOT NULL CHECK(role IN ('admin','manager','reddit_va','chatter')),
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
            role TEXT NOT NULL CHECK(role IN ('admin','manager','reddit_va','chatter')),
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
    // Admin is the safety floor — every launch, ensure admin holds every perm
    // key that exists in code. Without this, admin DBs seeded before newer
    // perms were added (page.autopilot, page.scheduler, page.intel, etc.)
    // permanently miss those nav items even after upgrade.
    try {
      const adminPerms = (BUILTIN_ROLES.find((r) => r.key === 'admin') || {}).permissions || [];
      for (const p of adminPerms) insertRolePerm.run('admin', p);
    } catch (e) {
      console.error('[db] Admin top-up failed:', e.message);
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
}

module.exports = { initDatabase, getDb, encryptSecret, decryptSecret };
