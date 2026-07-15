const { getDb, encryptSecret, decryptSecret, credentialVaultGet, credentialVaultSet, credentialVaultDelete } = require('../db');
const { userFromToken } = require('./auth');
const { log } = require('./activity');
const { hasPermission } = require('../permissions');
const { getSharedCredential, setSharedCredential } = require('../sharedCredentials');


function canAccessProfile(user, profileId) {
  if (hasPermission(user, 'profiles.manage')) return true;
  const row = getDb()
    .prepare('SELECT assigned_user_id FROM model_profiles WHERE id = ?')
    .get(profileId);
  return row && row.assigned_user_id === user.id;
}

function hydrateAccount(a) {
  return {
    ...a,
    has_password: !!(a.password_encrypted || credentialVaultGet('account_password', a.id)),
    has_email_password: !!(a.email_password_encrypted || credentialVaultGet('email_password', a.id)),
    password_encrypted: undefined,
    email_password_encrypted: undefined,
  };
}

function ensureAccountMigrations() {
  const db = getDb();
  const cols = db.prepare('PRAGMA table_info(reddit_accounts)').all();
  const have = (n) => cols.some((c) => c.name === n);
  if (!have('starred'))    db.exec('ALTER TABLE reddit_accounts ADD COLUMN starred INTEGER NOT NULL DEFAULT 0');
  if (!have('user_agent')) db.exec('ALTER TABLE reddit_accounts ADD COLUMN user_agent TEXT');
  // Antidetect fingerprint — JSON blob with platform / UA / screen / WebGL
  // / TZ / language / hardware values. Generated on first session prep and
  // persisted so the same account always presents the same identity.
  if (!have('fingerprint_json')) db.exec('ALTER TABLE reddit_accounts ADD COLUMN fingerprint_json TEXT');
}
// keep old name for back-compat call sites in this file
const ensureStarredColumn = ensureAccountMigrations;

function register(ipcMain) {
  ensureStarredColumn();

  ipcMain.handle('accounts:bulkSetStatus', (_e, { token, accountIds, status, teamId }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      if (!['warming', 'ready', 'paused', 'banned'].includes(status)) throw new Error('Invalid status');
      const ids = (Array.isArray(accountIds) ? accountIds : [accountIds]).map(Number).filter(Boolean);
      if (!ids.length) throw new Error('No accounts selected');
      const stmt = getDb().prepare(teamId
        ? 'UPDATE reddit_accounts SET status = ? WHERE id = ? AND team_id = ?'
        : 'UPDATE reddit_accounts SET status = ? WHERE id = ?');
      const tx = getDb().transaction(() => { for (const id of ids) stmt.run(status, id, ...(teamId ? [teamId] : [])); });
      tx();
      log(user, 'account.bulkSetStatus', 'account', null, `n=${ids.length} status=${status}`);
      return { ok: true, updated: ids.length };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('accounts:bulkDelete', (_e, { token, accountIds }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      const ids = (Array.isArray(accountIds) ? accountIds : [accountIds]).map(Number).filter(Boolean);
      if (!ids.length) throw new Error('No accounts selected');
      // Authorise per-account: admins/managers via permission; everyone else
      // only on accounts under their assigned profiles.
      const stmt = getDb().prepare('DELETE FROM reddit_accounts WHERE id = ?');
      const checkProfile = getDb().prepare('SELECT profile_id FROM reddit_accounts WHERE id = ?');
      let deleted = 0;
      const tx = getDb().transaction(() => {
        for (const id of ids) {
          const row = checkProfile.get(id);
          if (!row) continue;
          if (!canAccessProfile(user, row.profile_id)) continue;
          stmt.run(id);
          deleted++;
        }
      });
      tx();
      log(user, 'account.bulkDelete', 'account', null, `n=${deleted}`);
      return { ok: true, deleted };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('accounts:bulkSetProxy', (_e, { token, accountIds, proxyId, teamId }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      const ids = (Array.isArray(accountIds) ? accountIds : [accountIds]).map(Number).filter(Boolean);
      if (!ids.length) throw new Error('No accounts selected');
      const next = proxyId == null || proxyId === '' ? null : Number(proxyId);
      const stmt = getDb().prepare(teamId
        ? 'UPDATE reddit_accounts SET proxy_id = ? WHERE id = ? AND team_id = ?'
        : 'UPDATE reddit_accounts SET proxy_id = ? WHERE id = ?');
      const tx = getDb().transaction(() => { for (const id of ids) stmt.run(next, id, ...(teamId ? [teamId] : [])); });
      tx();
      log(user, 'account.bulkSetProxy', 'account', null, `n=${ids.length} proxy=${next || 'none'}`);
      return { ok: true, updated: ids.length };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('accounts:setStarred', (_e, { token, accountIds, starred, teamId }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      ensureStarredColumn();
      const ids = (Array.isArray(accountIds) ? accountIds : [accountIds]).map(Number).filter(Boolean);
      if (!ids.length) throw new Error('No accounts selected');
      const stmt = getDb().prepare(teamId
        ? 'UPDATE reddit_accounts SET starred = ? WHERE id = ? AND team_id = ?'
        : 'UPDATE reddit_accounts SET starred = ? WHERE id = ?');
      const tx = getDb().transaction(() => { for (const id of ids) stmt.run(starred ? 1 : 0, id, ...(teamId ? [teamId] : [])); });
      tx();
      return { ok: true, updated: ids.length };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('accounts:listForProfile', (_e, { token, profileId, platform, teamId }) => {
    const user = userFromToken(token);
    if (!user) return { ok: false, error: 'Not authenticated' };
    if (!canAccessProfile(user, profileId))
      return { ok: false, error: 'Not authorized for this profile' };

    const params = [profileId];
    let platformClause = '';
    if (platform) { platformClause = 'AND a.platform = ?'; params.push(platform); }
    if (teamId) { platformClause += ' AND a.team_id = ?'; params.push(teamId); }

    const accounts = getDb()
      .prepare(
        `SELECT a.*, p.label AS proxy_label, p.kind AS proxy_kind
         FROM reddit_accounts a
         LEFT JOIN model_profiles mp ON mp.id = a.profile_id
         LEFT JOIN proxies p ON p.id = COALESCE(a.proxy_id, mp.proxy_id)
         WHERE a.profile_id = ? ${platformClause}
         ORDER BY a.platform, a.status, a.username`
      )
      .all(...params);
    return { ok: true, accounts: accounts.map(hydrateAccount) };
  });

  ipcMain.handle('accounts:listForUser', (_e, { token, statusFilter, platform, teamId }) => {
    try {
      const user = userFromToken(token);
      if (!user) return { ok: false, error: 'Not authenticated' };

      const where = [];
      const params = [];
      // Holders of profiles.manage see everything; everyone else only sees
      // accounts on profiles they're assigned to.
      if (!hasPermission(user, 'profiles.manage')) {
        where.push('p.assigned_user_id = ?');
        params.push(user.id);
      }
      if (statusFilter && statusFilter !== 'all') {
        where.push('a.status = ?');
        params.push(statusFilter);
      }
      if (platform) {
        where.push('a.platform = ?');
        params.push(platform);
      }
      if (teamId) {
        where.push('a.team_id = ?');
        params.push(teamId);
      }
      const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';

      // Account-level proxy wins; if unset, fall back to the model's proxy so
      // setting one proxy at the model level lights up every account under it.
      const accounts = getDb()
        .prepare(
          `SELECT a.*, p.name AS profile_name, p.main_email AS profile_main_email,
                  px.label AS proxy_label, px.kind AS proxy_kind,
                  px.last_test_ok AS proxy_test_ok, px.last_test_error AS proxy_test_error,
                  bs.browser_mode, bs.cloak_profile_name,
                  cp.profile_name AS cloak_actual_name, cp.cdp_port, cp.status AS cloak_status
           FROM reddit_accounts a
           JOIN model_profiles p ON p.id = a.profile_id
           LEFT JOIN proxies px ON px.id = COALESCE(a.proxy_id, p.proxy_id)
           LEFT JOIN account_browser_settings bs ON bs.account_id = a.id
           LEFT JOIN cloakmanager_profiles cp ON cp.account_id = a.id
           ${whereClause}
           ORDER BY p.name, a.platform, a.status, a.username`
        )
        .all(...params);
      return { ok: true, accounts: accounts.map(hydrateAccount) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('accounts:create', (_e, args) => {
    try {
      const { token, profileId, platform, username, password, email, emailPassword, status, proxyId, notes, userAgent, osProfile, teamId } = args;
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      if (!canAccessProfile(user, profileId)) throw new Error('Not authorized');
      const plat = platform || 'reddit';
      if (!['reddit', 'redgifs', 'x', 'instagram', 'tiktok'].includes(plat)) throw new Error('Invalid platform');
      const os = ['desktop', 'android', 'ios'].includes(osProfile) ? osProfile : 'desktop';
      ensureAccountMigrations();
      const partitionKey = `${plat}-${profileId}-${username.toLowerCase().replace(/[^a-z0-9_-]/g, '')}-${Date.now()}`;
      const info = getDb()
        .prepare(
          `INSERT INTO reddit_accounts
           (profile_id, platform, username, partition_key, email, status, proxy_id, notes, user_agent, os_profile, team_id)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`
        )
        .run(
          profileId, plat, username, partitionKey,
          email || null, status || 'warming', proxyId || null, notes || null, userAgent || null, os,
          teamId || null,
        );
      if (password) {
        credentialVaultSet('account_password', info.lastInsertRowid, password);
        if (teamId) setSharedCredential(teamId, info.lastInsertRowid, 'account_password', password, user.id).catch(() => {});
      }
      if (emailPassword) {
        credentialVaultSet('email_password', info.lastInsertRowid, emailPassword);
        if (teamId) setSharedCredential(teamId, info.lastInsertRowid, 'email_password', emailPassword, user.id).catch(() => {});
      }
      log(user, 'account.create', 'account', info.lastInsertRowid, `${plat} u/${username}`);

      // Initialize account_browser_settings with default profile name
      const { getProfileName } = require('../lib/profileName');
      const account = { username, platform: plat };
      const defaultProfileName = getProfileName(account);

      getDb().prepare(`
        INSERT INTO account_browser_settings (account_id, browser_mode, cloak_profile_name)
        VALUES (?, 'inherit', ?)
      `).run(info.lastInsertRowid, defaultProfileName);

      console.log('[accounts:create] Initialized browser_settings with profile:', defaultProfileName);

      return { ok: true, id: info.lastInsertRowid, partitionKey };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('accounts:update', (_e, { token, accountId, updates }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      const acct = getDb().prepare('SELECT * FROM reddit_accounts WHERE id = ?').get(accountId);
      if (!acct) throw new Error('Account not found');
      if (!canAccessProfile(user, acct.profile_id)) throw new Error('Not authorized');

      // Flipping os_profile invalidates the persisted fingerprint —
      // loadOrCreate sees the mismatch and regenerates next session prep.
      const allowed = ['status', 'proxy_id', 'notes', 'email', 'os_profile'];
      const sets = [];
      const params = [];
      for (const key of allowed) {
        if (updates[key] !== undefined) {
          sets.push(`${key} = ?`);
          params.push(updates[key]);
        }
      }
      if (updates.password !== undefined) {
        if (updates.password) {
          credentialVaultSet('account_password', accountId, updates.password);
          if (acct.team_id) setSharedCredential(acct.team_id, accountId, 'account_password', updates.password, user.id).catch(() => {});
        } else {
          credentialVaultDelete('account_password', accountId);
          if (acct.team_id) deleteSharedCredential(acct.team_id, accountId, 'account_password').catch(() => {});
        }
      }
      if (updates.emailPassword !== undefined) {
        if (updates.emailPassword) {
          credentialVaultSet('email_password', accountId, updates.emailPassword);
          if (acct.team_id) setSharedCredential(acct.team_id, accountId, 'email_password', updates.emailPassword, user.id).catch(() => {});
        } else {
          credentialVaultDelete('email_password', accountId);
          if (acct.team_id) deleteSharedCredential(acct.team_id, accountId, 'email_password').catch(() => {});
        }
      }
      if (sets.length === 0 && !updates.browserMode && !updates.cloakProfileName) return { ok: true };
      params.push(accountId);

      if (sets.length > 0) {
        if (acct.team_id) {
          params.push(acct.team_id);
          getDb().prepare(`UPDATE reddit_accounts SET ${sets.join(', ')} WHERE id = ? AND team_id = ?`).run(...params);
        } else {
          getDb().prepare(`UPDATE reddit_accounts SET ${sets.join(', ')} WHERE id = ?`).run(...params);
        }
      }

      // Handle browser_mode and cloak_profile_name separately in account_browser_settings table
      const browserSettings = {};
      if (updates.browserMode !== undefined) {
        browserSettings.browser_mode = updates.browserMode;
      }
      if (updates.cloakProfileName !== undefined) {
        browserSettings.cloak_profile_name = updates.cloakProfileName;
      }

      if (Object.keys(browserSettings).length > 0) {
        const existing = getDb().prepare(`
          SELECT account_id FROM account_browser_settings WHERE account_id = ?
        `).get(accountId);

        const setClauses = [];
        const setParams = [];

        if (browserSettings.browser_mode !== undefined) {
          setClauses.push('browser_mode = ?');
          setParams.push(browserSettings.browser_mode);
        }
        if (browserSettings.cloak_profile_name !== undefined) {
          setClauses.push('cloak_profile_name = ?');
          setParams.push(browserSettings.cloak_profile_name);
        }

        setParams.push(accountId);

        if (existing) {
          getDb().prepare(`
            UPDATE account_browser_settings
            SET ${setClauses.join(', ')}
            WHERE account_id = ?
          `).run(...setParams);
        } else {
          getDb().prepare(`
            INSERT INTO account_browser_settings (account_id, browser_mode, cloak_profile_name)
            VALUES (?, ?, ?)
          `).run(accountId, browserSettings.browser_mode || 'inherit', browserSettings.cloak_profile_name || null);
        }
      }

      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('accounts:getCredentials', async (_e, { token, accountId }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      const acct = getDb().prepare('SELECT * FROM reddit_accounts WHERE id = ?').get(accountId);
      if (!acct) throw new Error('Not found');
      if (!canAccessProfile(user, acct.profile_id)) throw new Error('Not authorized');
      let password = credentialVaultGet('account_password', accountId);
      if (!password && acct.team_id) {
        password = await getSharedCredential(acct.team_id, accountId, 'account_password');
      }
      if (!password) password = decryptSecret(acct.password_encrypted);
      let emailPassword = credentialVaultGet('email_password', accountId);
      if (!emailPassword && acct.team_id) {
        emailPassword = await getSharedCredential(acct.team_id, accountId, 'email_password');
      }
      if (!emailPassword) emailPassword = decryptSecret(acct.email_password_encrypted);
      return {
        ok: true,
        username: acct.username,
        password: password || null,
        email: acct.email,
        emailPassword: emailPassword || null,
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('accounts:delete', (_e, { token, accountId, teamId }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      const acct = getDb().prepare('SELECT * FROM reddit_accounts WHERE id = ?').get(accountId);
      if (!acct) throw new Error('Account not found');
      if (!canAccessProfile(user, acct.profile_id)) throw new Error('Not authorized');
      if (teamId && acct.team_id !== teamId) throw new Error('Not authorized');
      getDb().prepare('DELETE FROM reddit_accounts WHERE id = ?').run(accountId);
      log(user, 'account.delete', 'account', accountId, `${acct.platform} u/${acct.username}`);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Bulk import: parses one credential per line. Supported formats:
  //   username:password
  //   username:password:email:emailpassword
  // Blank lines and comments (lines starting with #) are skipped.
  ipcMain.handle('accounts:bulkCreate', (_e, { token, profileId, platform, proxyId, status, lines, userAgent, teamId }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      if (!canAccessProfile(user, profileId)) throw new Error('Not authorized for this profile');
      const plat = platform || 'reddit';
      if (!['reddit', 'redgifs', 'x', 'instagram', 'tiktok'].includes(plat)) throw new Error('Invalid platform');
      ensureAccountMigrations();

      const input = String(lines || '').split(/\r?\n/);
      const created = [];
      const errors = [];

      const insert = getDb().prepare(
        `INSERT INTO reddit_accounts
         (profile_id, platform, username, partition_key, email, status, proxy_id, user_agent, team_id)
         VALUES (?,?,?,?,?,?,?,?,?)`
      );

      const txn = getDb().transaction(() => {
        const { getProfileName } = require('../lib/profileName');
        const insertBrowserSettings = getDb().prepare(`
          INSERT INTO account_browser_settings (account_id, browser_mode, cloak_profile_name)
          VALUES (?, 'inherit', ?)
        `);

        for (let i = 0; i < input.length; i++) {
          const raw = input[i].trim();
          if (!raw || raw.startsWith('#')) continue;
          const parts = raw.split(':');
          const [u, p, e, ep] = parts;
          if (!u || !p) { errors.push({ line: i + 1, error: 'Need username:password' }); continue; }
          const cleanUser = u.trim().replace(/^[u@]\//, '').replace(/^@/, '');
          try {
            const partitionKey = `${plat}-${profileId}-${cleanUser.toLowerCase().replace(/[^a-z0-9_-]/g, '')}-${Date.now()}-${i}`;
            const info = insert.run(
              profileId, plat, cleanUser, partitionKey,
              e || null, status || 'warming', proxyId || null, userAgent || null,
              teamId || null
            );
            if (p) credentialVaultSet('account_password', info.lastInsertRowid, p);
            if (ep) credentialVaultSet('email_password', info.lastInsertRowid, ep);

            // Initialize browser_settings with default profile name
            const defaultProfileName = getProfileName({ username: cleanUser, platform: plat });
            insertBrowserSettings.run(info.lastInsertRowid, defaultProfileName);

            created.push({ id: info.lastInsertRowid, username: cleanUser });
          } catch (err) {
            errors.push({ line: i + 1, username: cleanUser, error: err.message });
          }
        }
      });
      txn();
      log(user, 'account.bulkImport', 'profile', profileId, `imported ${created.length} ${plat} (${errors.length} errors)`);
      return { ok: true, created, errors };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
}

module.exports = register;
