const path = require('path');
const { app, safeStorage } = require('electron');
const Database = require('better-sqlite3');

let db;

function getDb() {
  if (!db) initDatabase();
  return db;
}

// Encrypt sensitive data using Electron's safeStorage (OS keychain-backed)
function credentialVaultGet(refType, refId) {
  try {
    const row = db.prepare(
      'SELECT password_encrypted FROM credential_vault WHERE ref_type = ? AND ref_id = ?'
    ).get(refType, String(refId));
    return row ? decryptSecret(row.password_encrypted) : null;
  } catch { return null; }
}

function credentialVaultSet(refType, refId, plaintext) {
  try {
    const enc = encryptSecret(plaintext);
    db.prepare(
      `INSERT INTO credential_vault (ref_type, ref_id, password_encrypted) VALUES (?, ?, ?)
       ON CONFLICT(ref_type, ref_id) DO UPDATE SET password_encrypted = excluded.password_encrypted`
    ).run(refType, String(refId), enc);
  } catch (e) { console.error('[db] credentialVaultSet failed:', e.message); }
}

function credentialVaultDelete(refType, refId) {
  try {
    db.prepare('DELETE FROM credential_vault WHERE ref_type = ? AND ref_id = ?')
      .run(refType, String(refId));
  } catch {}
}

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

    -- Per-machine credential vault. NEVER synced to Supabase.
    -- Each machine stores account/proxy passwords locally, encrypted
    -- with the machine's OS keychain (safeStorage). ref_type indicates
    -- the kind of credential ('account_password', 'email_password',
    -- 'proxy_password') and ref_id is the Supabase UUID of the
    -- associated record.
    CREATE TABLE IF NOT EXISTS credential_vault (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ref_type TEXT NOT NULL,
      ref_id TEXT NOT NULL,
      password_encrypted TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(ref_type, ref_id)
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

    -- Platform definitions (built-in + admin-configured)
    CREATE TABLE IF NOT EXISTS platforms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      short TEXT,
      color TEXT DEFAULT '#888888',
      home_url TEXT,
      login_url TEXT,
      username_prefix TEXT DEFAULT '@',
      icon TEXT,
      is_builtin INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Per-account settings (autopilot skip, per-account CM profile override)
    CREATE TABLE IF NOT EXISTS account_browser_settings (
      account_id INTEGER NOT NULL REFERENCES reddit_accounts(id) ON DELETE CASCADE,
      cloak_profile_override TEXT,
      autopilot_skip INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- CloakManager profile tracking
    CREATE TABLE IF NOT EXISTS cloakmanager_profiles (
      account_id INTEGER NOT NULL REFERENCES reddit_accounts(id) ON DELETE CASCADE,
      profile_name TEXT NOT NULL UNIQUE,
      cdp_port INTEGER,
      cdp_url TEXT,
      fp_seed TEXT,
      status TEXT NOT NULL CHECK(status IN ('created', 'running', 'stopped', 'error')) DEFAULT 'created',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Posting events log
    CREATE TABLE IF NOT EXISTS post_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform TEXT NOT NULL,
      account_id INTEGER NOT NULL,
      profile_id INTEGER,
      subreddit TEXT,
      title TEXT,
      remote_id TEXT,
      status TEXT NOT NULL DEFAULT 'posted',
      source TEXT NOT NULL DEFAULT 'manual',
      error TEXT,
      created_by_user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Posting protocols (config hierarchy)
    CREATE TABLE IF NOT EXISTS posting_protocols (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope TEXT NOT NULL CHECK(scope IN ('global','platform','model','account')),
      scope_id TEXT,
      config_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(scope, scope_id)
    );

    -- Schedule templates
    CREATE TABLE IF NOT EXISTS schedule_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'idle' CHECK(status IN ('idle','running','paused')),
      accounts_json TEXT NOT NULL DEFAULT '[]',
      subreddits_json TEXT NOT NULL DEFAULT '[]',
      cadence_min_h REAL NOT NULL DEFAULT 4,
      cadence_max_h REAL NOT NULL DEFAULT 8,
      posts_per_account INTEGER NOT NULL DEFAULT 3,
      created_by_user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_started_at TEXT
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
    // admin + owner are the safety floor — top up every code-defined perm on
    // every launch (never delete here, so custom edits to owner survive).
    try {
      for (const key of ['admin', 'owner']) {
        const perms = (BUILTIN_ROLES.find((r) => r.key === key) || {}).permissions || [];
        for (const p of perms) insertRolePerm.run(key, p);
      }
    } catch (e) {
      console.error('[db] admin/owner perm top-up failed:', e.message);
    }

    // Role model v2 (appflow.md): Owner / Admin / Manager / Chatter / VA.
    //  - retire the old 'operator' starter role → remap its users to 'manager'
    //  - drop the dead 'reddit_va' builtin (or unflag if still in use)
    //  - (re)seed manager / chatter / va once so their permission rows match
    //    the code exactly; guarded by an app_kv flag so later admin edits stick.
    try {
      const seeded = db.prepare("SELECT value FROM app_kv WHERE key = 'roles_v2_seeded'").get();
      if (!seeded || seeded.value !== '1') {
        db.prepare("UPDATE users SET role = 'manager' WHERE role = 'operator'").run();
        db.prepare("DELETE FROM roles WHERE key = 'operator'").run();
        db.prepare("DELETE FROM role_permissions WHERE role_key = 'operator'").run();

        const usedStmt = db.prepare('SELECT 1 FROM users WHERE role = ? LIMIT 1');
        if (usedStmt.get('reddit_va')) {
          db.prepare("UPDATE roles SET is_builtin = 0 WHERE key = 'reddit_va'").run();
        } else {
          db.prepare("DELETE FROM roles WHERE key = 'reddit_va'").run();
          db.prepare("DELETE FROM role_permissions WHERE role_key = 'reddit_va'").run();
        }

        for (const key of ['manager', 'chatter', 'va']) {
          const def = BUILTIN_ROLES.find((r) => r.key === key);
          if (!def) continue;
          insertRole.run(key, def.label, def.description);
          db.prepare('UPDATE roles SET is_builtin = 1 WHERE key = ?').run(key);
          db.prepare('DELETE FROM role_permissions WHERE role_key = ?').run(key);
          for (const p of def.permissions) insertRolePerm.run(key, p);
        }
        db.prepare(
          `INSERT INTO app_kv (key, value, updated_at) VALUES ('roles_v2_seeded', '1', datetime('now'))
           ON CONFLICT(key) DO UPDATE SET value = '1', updated_at = datetime('now')`
        ).run();
        console.log('[db] Role model v2 seeded (owner/admin/manager/chatter/va).');
      }
    } catch (e) {
      console.error('[db] Role model v2 migration failed:', e.message);
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

    // team_id — scopes data to a specific team. Added as part of the
    // team architecture migration. Nullable for backward compatibility
    // with existing data until backfill runs.
    const hasAccountTeamId = cols.some((c) => c.name === 'team_id');
    if (!hasAccountTeamId) {
      db.exec("ALTER TABLE reddit_accounts ADD COLUMN team_id TEXT");
      console.log('[db] team_id column added to reddit_accounts.');
    }

    // needs_attention — set by the CDP orchestrator when a CloakManager
    // launch/task hits a hard wall that a human must resolve (wrong
    // password, 2FA prompt, captcha, logged-out). The autopilot and
    // scheduler skip flagged accounts until an operator clears the flag
    // (accounts:clearAttention). Distinct from the timed circuit breaker
    // in services/coordinator.js — this one does not auto-expire.
    // status has a CHECK constraint we can't ALTER, so this is a separate
    // column rather than a new status value.
    if (!cols.some((c) => c.name === 'needs_attention')) {
      db.exec("ALTER TABLE reddit_accounts ADD COLUMN needs_attention INTEGER NOT NULL DEFAULT 0");
      db.exec("ALTER TABLE reddit_accounts ADD COLUMN attention_reason TEXT");
      db.exec("ALTER TABLE reddit_accounts ADD COLUMN attention_at TEXT");
      console.log('[db] needs_attention columns added to reddit_accounts.');
    }

    // Per-profile fingerprint. A real person has ONE device, not a
    // separate one per platform — so the fingerprint, OS profile, and
    // proxy-geo cache live on model_profiles and get reused by every
    // account linked to that profile. The matching columns on
    // reddit_accounts are kept around so a future "override per
    // account" feature has a place to write, and so older builds that
    // still read them don't break on first launch.
    try {
      const pcols = db.prepare('PRAGMA table_info(model_profiles)').all();
      const pHave = (n) => pcols.some((c) => c.name === n);
      if (!pHave('fingerprint_json')) db.exec('ALTER TABLE model_profiles ADD COLUMN fingerprint_json TEXT');
      if (!pHave('os_profile'))       db.exec("ALTER TABLE model_profiles ADD COLUMN os_profile TEXT NOT NULL DEFAULT 'desktop'");
      if (!pHave('geo_timezone'))     db.exec('ALTER TABLE model_profiles ADD COLUMN geo_timezone TEXT');
      if (!pHave('geo_country'))      db.exec('ALTER TABLE model_profiles ADD COLUMN geo_country TEXT');
      if (!pHave('geo_checked_at'))   db.exec('ALTER TABLE model_profiles ADD COLUMN geo_checked_at TEXT');
      if (!pHave('team_id'))          db.exec('ALTER TABLE model_profiles ADD COLUMN team_id TEXT');
    } catch (e) {
      console.error('[db] model_profiles fingerprint migration failed:', e.message);
    }
  } catch (e) {
    console.error('[db] Platform migration failed:', e.message);
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

  // Seed built-in platforms if the table is empty.
  try {
    const platCount = db.prepare('SELECT COUNT(*) AS c FROM platforms').get().c;
    if (platCount === 0) {
      const builtins = [
        { key: 'reddit',    label: 'Reddit',    short: 'R',  color: '#ff4500', home: 'https://www.reddit.com/',           login: 'https://www.reddit.com/login',                    prefix: 'u/',  icon: '🔴', order: 1 },
        { key: 'redgifs',   label: 'RedGIFs',   short: 'G',  color: '#ff2e74', home: 'https://www.redgifs.com/',          login: 'https://www.redgifs.com/signin',                   prefix: '@',   icon: '🟠', order: 2 },
        { key: 'x',         label: 'X',         short: '𝕏', color: '#1d9bf0', home: 'https://x.com/home',                login: 'https://x.com/login',                              prefix: '@',   icon: '🔵', order: 3 },
        { key: 'instagram', label: 'Instagram', short: 'IG', color: '#e1306c', home: 'https://www.instagram.com/',        login: 'https://www.instagram.com/accounts/login/',         prefix: '@',   icon: '🟣', order: 4 },
        { key: 'tiktok',    label: 'TikTok',    short: 'TT', color: '#25f4ee', home: 'https://www.tiktok.com/foryou',     login: 'https://www.tiktok.com/login',                      prefix: '@',   icon: '⚫', order: 5 },
      ];
      const ins = db.prepare(`
        INSERT INTO platforms (key, label, short, color, home_url, login_url, username_prefix, icon, is_builtin, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
      `);
      for (const p of builtins) {
        ins.run(p.key, p.label, p.short, p.color, p.home, p.login, p.prefix, p.icon, p.order);
      }
      console.log(`[db] Seeded ${builtins.length} built-in platforms`);
    }
  } catch (e) {
    console.warn('[db] Platform seeding skipped:', e?.message);
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
      try {
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
      } catch (e) {
        console.warn('[db] content_sources backfill skipped:', e?.message);
      }
    }
  } catch (e) {
    console.warn('[db] content_sources backfill skipped:', e?.message);
  }

  // Migration: add CloakManager integration tables if missing
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    const tableNames = tables.map(t => t.name);

    // Kept for backward compatibility during upgrades only.
    // user_browser_settings is no longer used by active code.
    if (!tableNames.includes('user_browser_settings')) {
      console.log('[db] Creating user_browser_settings table (legacy compat)...');
      db.exec(`
        CREATE TABLE user_browser_settings (
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          default_browser_mode TEXT NOT NULL CHECK(default_browser_mode IN ('electron', 'cloakmanager')) DEFAULT 'electron',
          cloakmanager_url TEXT NOT NULL DEFAULT 'http://127.0.0.1:7331',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
    }

    // Create account_browser_settings if missing (new schema)
    if (!tableNames.includes('account_browser_settings')) {
      console.log('[db] Creating account_browser_settings table...');
      db.exec(`
        CREATE TABLE account_browser_settings (
          account_id INTEGER NOT NULL REFERENCES reddit_accounts(id) ON DELETE CASCADE,
          cloak_profile_override TEXT,
          autopilot_skip INTEGER DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
      console.log('[db] account_browser_settings table created.');
    }

    // Create cloakmanager_profiles if missing
    if (!tableNames.includes('cloakmanager_profiles')) {
      console.log('[db] Creating cloakmanager_profiles table...');
      db.exec(`
        CREATE TABLE cloakmanager_profiles (
          account_id INTEGER NOT NULL REFERENCES reddit_accounts(id) ON DELETE CASCADE,
          profile_name TEXT NOT NULL UNIQUE,
          cdp_port INTEGER,
          cdp_url TEXT,
          cdp_ws_url TEXT,
          fp_seed TEXT,
          status TEXT NOT NULL CHECK(status IN ('created', 'running', 'stopped', 'error')) DEFAULT 'created',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
      console.log('[db] cloakmanager_profiles table created.');
    } else {
      // Add cdp_ws_url column if it doesn't exist (for existing installations)
      try {
        const columnExists = db.prepare(`
          SELECT COUNT(*) as count FROM pragma_table_info('cloakmanager_profiles')
          WHERE name = 'cdp_ws_url'
        `).get();

        if (columnExists.count === 0) {
          console.log('[db] Adding cdp_ws_url column to cloakmanager_profiles...');
          db.exec(`ALTER TABLE cloakmanager_profiles ADD COLUMN cdp_ws_url TEXT`);
          console.log('[db] cdp_ws_url column added successfully.');
        }
      } catch (e) {
        console.warn('[db] Failed to add cdp_ws_url column:', e?.message);
      }
    }

    // Create cdp_script_executions table for tracking CDP script execution
    if (!tableNames.includes('cdp_script_executions')) {
      console.log('[db] Creating cdp_script_executions table...');
      db.exec(`
        CREATE TABLE cdp_script_executions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          profile_name TEXT NOT NULL,
          script_id TEXT NOT NULL,
          category TEXT NOT NULL,
          started_at TEXT NOT NULL,
          completed_at TEXT,
          status TEXT NOT NULL,
          result_json TEXT,
          error TEXT,
          retry_count INTEGER DEFAULT 0
        )
      `);
      console.log('[db] cdp_script_executions table created.');
    }

    // Create automation_runs table for unified automation execution logging
    if (!tableNames.includes('automation_runs')) {
      console.log('[db] Creating automation_runs table...');
      db.exec(`
        CREATE TABLE automation_runs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          account_id INTEGER NOT NULL REFERENCES reddit_accounts(id) ON DELETE CASCADE,
          platform TEXT NOT NULL,
          browser_mode TEXT NOT NULL CHECK(browser_mode IN ('electron','cloakmanager')),
          run_type TEXT NOT NULL CHECK(run_type IN ('post','comment','engagement','inbox','schedule_fire','autopilot_tick')),
          status TEXT NOT NULL CHECK(status IN ('queued','running','completed','failed','skipped')) DEFAULT 'queued',
          script_id TEXT,
          result_json TEXT,
          error TEXT,
          triggered_by TEXT NOT NULL CHECK(triggered_by IN ('autopilot','scheduled','manual','template')),
          schedule_post_id INTEGER REFERENCES scheduled_posts(id) ON DELETE SET NULL,
          duration_ms INTEGER,
          started_at TEXT,
          completed_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
      console.log('[db] automation_runs table created.');
    }

    // Migration: add autopilot_skip column to account_browser_settings
    try {
      const absCols = db.prepare("PRAGMA table_info(account_browser_settings)").all();
      if (!absCols.some(c => c.name === 'autopilot_skip')) {
        db.exec("ALTER TABLE account_browser_settings ADD COLUMN autopilot_skip INTEGER DEFAULT 0");
        console.log('[db] autopilot_skip column added to account_browser_settings');
      }
    } catch (e) { console.warn('[db] autopilot_skip migration failed:', e?.message); }
    // Create indexes for better performance
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_account_browser_settings_account_id ON account_browser_settings(account_id);
      CREATE INDEX IF NOT EXISTS idx_cloakmanager_profiles_profile_name ON cloakmanager_profiles(profile_name);
      CREATE INDEX IF NOT EXISTS idx_automation_runs_account ON automation_runs(account_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_automation_runs_status ON automation_runs(status, created_at);
    `);
    // Ensure account_browser_settings has a UNIQUE constraint on account_id
    // for ON CONFLICT(account_id) upserts in autopilot skip handler.
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_account_browser_settings_account_unique ON account_browser_settings(account_id)`);

    // Create account_launch_scripts if missing — per-account CDP launch script configuration
    if (!tableNames.includes('account_launch_scripts')) {
      console.log('[db] Creating account_launch_scripts table...');
      db.exec(`
        CREATE TABLE account_launch_scripts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          account_id INTEGER NOT NULL REFERENCES reddit_accounts(id) ON DELETE CASCADE,
          script_id TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1,
          run_mode TEXT NOT NULL CHECK(run_mode IN ('always','once')) DEFAULT 'always',
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(account_id, script_id)
        )
      `);
      console.log('[db] account_launch_scripts table created.');
    } else {
      try {
        const cols = db.prepare("PRAGMA table_info(account_launch_scripts)").all();
        if (!cols.some(c => c.name === 'updated_at')) {
          db.exec("ALTER TABLE account_launch_scripts ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'))");
          console.log('[db] updated_at column added to account_launch_scripts');
        }
      } catch (e) { console.warn('[db] account_launch_scripts migration failed:', e?.message); }
    }

    // Create model_launch_scripts if missing — shared CDP launch script
    // configuration for a CloakManager model-level profile (one config for
    // every account sharing that profile, instead of one copy per account).
    if (!tableNames.includes('model_launch_scripts')) {
      console.log('[db] Creating model_launch_scripts table...');
      db.exec(`
        CREATE TABLE model_launch_scripts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          profile_id INTEGER NOT NULL REFERENCES model_profiles(id) ON DELETE CASCADE,
          script_id TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1,
          run_mode TEXT NOT NULL CHECK(run_mode IN ('always','once')) DEFAULT 'always',
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(profile_id, script_id)
        )
      `);
      console.log('[db] model_launch_scripts table created.');
    }

    // Create custom_cdp_scripts if missing — user-authored inline CDP scripts
    if (!tableNames.includes('custom_cdp_scripts')) {
      console.log('[db] Creating custom_cdp_scripts table...');
      db.exec(`
        CREATE TABLE custom_cdp_scripts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          account_id INTEGER,
          name TEXT NOT NULL,
          description TEXT,
          platform TEXT NOT NULL DEFAULT 'all',
          code TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
      console.log('[db] custom_cdp_scripts table created.');
    } else {
      try {
        const cols = db.prepare("PRAGMA table_info(custom_cdp_scripts)").all();
        if (!cols.some(c => c.name === 'updated_at')) {
          db.exec("ALTER TABLE custom_cdp_scripts ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'))");
          console.log('[db] updated_at column added to custom_cdp_scripts');
        }
      } catch (e) { console.warn('[db] custom_cdp_scripts migration failed:', e?.message); }
    }

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_launch_scripts_account ON account_launch_scripts(account_id);
      CREATE INDEX IF NOT EXISTS idx_launch_scripts_profile ON model_launch_scripts(profile_id);
      CREATE INDEX IF NOT EXISTS idx_custom_scripts_account ON custom_cdp_scripts(account_id);
    `);

    console.log('[db] CloakManager integration migration complete.');
  } catch (e) {
    console.error('[db] CloakManager migration failed:', e.message);
  }

  // Migration: move browser_mode from per-account to per-model-profile
  // and add cloak_profile_override for per-account CM instance overrides.
  try {
    const pcols = db.prepare('PRAGMA table_info(model_profiles)').all();
    const pHave = (n) => pcols.some((c) => c.name === n);

    // Add browser_mode + cloak_profile_name to model_profiles
    if (!pHave('browser_mode')) {
      db.exec("ALTER TABLE model_profiles ADD COLUMN browser_mode TEXT NOT NULL DEFAULT 'electron'");
      console.log('[db] browser_mode column added to model_profiles.');
    }
    if (!pHave('cloak_profile_name')) {
      db.exec('ALTER TABLE model_profiles ADD COLUMN cloak_profile_name TEXT');
      console.log('[db] cloak_profile_name column added to model_profiles.');
    }

    // Add cloak_profile_override to account_browser_settings
    try {
      const absCols = db.prepare('PRAGMA table_info(account_browser_settings)').all();
      if (!absCols.some(c => c.name === 'cloak_profile_override')) {
        db.exec('ALTER TABLE account_browser_settings ADD COLUMN cloak_profile_override TEXT');
        console.log('[db] cloak_profile_override column added to account_browser_settings.');
      }
    } catch (e) { console.warn('[db] cloak_profile_override migration skipped:', e?.message); }

    // Migrate existing data: pick the most common browser_mode per profile
    // and set model_profiles accordingly. Also compute model-level CM profile names.
    try {
      const profiles = db.prepare('SELECT id, name, assigned_user_id FROM model_profiles').all();
      const modeCount = db.prepare(`
        SELECT browser_mode, COUNT(*) AS cnt
        FROM account_browser_settings
        WHERE account_id IN (SELECT id FROM reddit_accounts WHERE profile_id = ?)
          AND browser_mode != 'inherit'
        GROUP BY browser_mode
        ORDER BY cnt DESC
      `);
      // Fallback: check the profile owner's user_browser_settings default
      const userDefault = db.prepare(
        'SELECT default_browser_mode FROM user_browser_settings WHERE user_id = ?'
      );
      const setProfile = db.prepare(`
        UPDATE model_profiles SET browser_mode = ?, cloak_profile_name = ? WHERE id = ?
      `);
      for (const p of profiles) {
        const top = modeCount.get(p.id);
        let mode = top?.browser_mode;
        if (!mode) {
          // All accounts were 'inherit' (or had no row) — check user default
          const ud = p.assigned_user_id ? userDefault.get(p.assigned_user_id) : null;
          mode = ud?.default_browser_mode || 'electron';
        }
        const cmName = mode === 'cloakmanager' ? `model-${p.id}-${p.name}` : null;
        setProfile.run(mode, cmName, p.id);
      }
      console.log(`[db] Migrated browser_mode for ${profiles.length} profiles.`);
    } catch (e) { console.warn('[db] Profile browser_mode migration skipped:', e?.message); }

    // Migrate cloakmanager_profiles: add profile_id column, backfill from account_id,
    // then rebuild table to make account_id nullable.
    try {
      const cpCols = db.prepare('PRAGMA table_info(cloakmanager_profiles)').all();
      if (!cpCols.some(c => c.name === 'profile_id')) {
        db.exec('ALTER TABLE cloakmanager_profiles ADD COLUMN profile_id INTEGER REFERENCES model_profiles(id) ON DELETE CASCADE');
        // Backfill: find the profile_id for each cloakmanager_profile via account_id
        db.exec(`
          UPDATE cloakmanager_profiles
          SET profile_id = (
            SELECT ra.profile_id FROM reddit_accounts ra WHERE ra.id = cloakmanager_profiles.account_id
          )
          WHERE profile_id IS NULL
        `);
        console.log('[db] profile_id column added to cloakmanager_profiles and backfilled.');
      }

      // Re-read columns after ALTER TABLE to get the fresh schema
      const updatedCpCols = db.prepare('PRAGMA table_info(cloakmanager_profiles)').all();
      const hasCdpWsUrl = updatedCpCols.some(c => c.name === 'cdp_ws_url');
      const hasProfileId = updatedCpCols.some(c => c.name === 'profile_id');

      // Rebuild cloakmanager_profiles to make account_id nullable
      // (SQLite can't ALTER COLUMN to drop NOT NULL)
      if (hasProfileId) {
        const wsUrlCol = hasCdpWsUrl ? 'cdp_ws_url TEXT,' : '';
        db.exec(`
          CREATE TABLE IF NOT EXISTS cloakmanager_profiles_new (
            profile_id INTEGER NOT NULL REFERENCES model_profiles(id) ON DELETE CASCADE,
            account_id INTEGER REFERENCES reddit_accounts(id) ON DELETE SET NULL,
            profile_name TEXT NOT NULL UNIQUE,
            cdp_port INTEGER,
            cdp_url TEXT,
            ${wsUrlCol}
            fp_seed TEXT,
            status TEXT NOT NULL CHECK(status IN ('created', 'running', 'stopped', 'error')) DEFAULT 'created',
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
          )
        `);
        const wsUrlSelect = hasCdpWsUrl ? 'cdp_ws_url,' : '';
        db.exec(`
          INSERT INTO cloakmanager_profiles_new (profile_id, account_id, profile_name, cdp_port, cdp_url, ${hasCdpWsUrl ? 'cdp_ws_url,' : ''} fp_seed, status, created_at)
          SELECT profile_id, account_id, profile_name, cdp_port, cdp_url, ${wsUrlSelect} fp_seed, status, created_at
          FROM cloakmanager_profiles
        `);
        db.exec('DROP TABLE cloakmanager_profiles');
        db.exec('ALTER TABLE cloakmanager_profiles_new RENAME TO cloakmanager_profiles');
        console.log('[db] Rebuilt cloakmanager_profiles with nullable account_id.');
      }
    } catch (e) { console.warn('[db] cloakmanager_profiles migration skipped:', e?.message); }

    // Rebuild account_browser_settings for existing installs that still have
    // the old schema with browser_mode and cloak_profile_name columns.
    try {
      const absCols = db.prepare('PRAGMA table_info(account_browser_settings)').all();
      if (absCols.some(c => c.name === 'browser_mode')) {
        console.log('[db] Rebuilding account_browser_settings (removing dead columns)...');
        db.exec(`
          CREATE TABLE account_browser_settings_new (
            account_id INTEGER NOT NULL REFERENCES reddit_accounts(id) ON DELETE CASCADE,
            cloak_profile_override TEXT,
            autopilot_skip INTEGER DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
          )
        `);
        // Preserve existing data: copy cloak_profile_override if it exists,
        // otherwise copy cloak_profile_name as the override for accounts
        // that had an explicit (non-auto-filled) value.
        const hasOverride = absCols.some(c => c.name === 'cloak_profile_override');
        const hasSkip = absCols.some(c => c.name === 'autopilot_skip');
        const overrideSelect = hasOverride ? 'cloak_profile_override' : 'NULL';
        const skipSelect = hasSkip ? 'autopilot_skip' : '0';
        db.exec(`
          INSERT INTO account_browser_settings_new (account_id, cloak_profile_override, autopilot_skip, created_at)
          SELECT account_id, ${overrideSelect}, ${skipSelect}, created_at
          FROM account_browser_settings
        `);
        db.exec('DROP TABLE account_browser_settings');
        db.exec('ALTER TABLE account_browser_settings_new RENAME TO account_browser_settings');
        console.log('[db] Rebuilt account_browser_settings.');
      }
    } catch (e) { console.warn('[db] account_browser_settings rebuild skipped:', e?.message); }

    // Update indexes
    try {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_cloakmanager_profiles_profile_id ON cloakmanager_profiles(profile_id);
      `);
    } catch (e) { console.warn('[db] Index update skipped:', e?.message); }

    console.log('[db] Browser mode migration to model_profiles complete.');
  } catch (e) {
    console.error('[db] Browser mode migration failed:', e.message);
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

module.exports = { initDatabase, getDb, encryptSecret, decryptSecret, getKv, setKv, credentialVaultGet, credentialVaultSet, credentialVaultDelete };
