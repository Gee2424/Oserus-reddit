const { getDb, encryptSecret, decryptSecret } = require('../db');
const { userFromToken } = require('./auth');
const { log } = require('./activity');
const { hasPermission } = require('../permissions');

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
    has_password: !!a.password_encrypted,
    has_email_password: !!a.email_password_encrypted,
    password_encrypted: undefined,
    email_password_encrypted: undefined,
  };
}

function register(ipcMain) {
  ipcMain.handle('accounts:listForProfile', (_e, { token, profileId, platform }) => {
    const user = userFromToken(token);
    if (!user) return { ok: false, error: 'Not authenticated' };
    if (!canAccessProfile(user, profileId))
      return { ok: false, error: 'Not authorized for this profile' };

    const params = [profileId];
    let platformClause = '';
    if (platform) { platformClause = 'AND a.platform = ?'; params.push(platform); }

    const accounts = getDb()
      .prepare(
        `SELECT a.*, p.label AS proxy_label, p.kind AS proxy_kind
         FROM reddit_accounts a
         LEFT JOIN proxies p ON p.id = a.proxy_id
         WHERE a.profile_id = ? ${platformClause}
         ORDER BY a.platform, a.status, a.username`
      )
      .all(...params);
    return { ok: true, accounts: accounts.map(hydrateAccount) };
  });

  ipcMain.handle('accounts:listForUser', (_e, { token, statusFilter, platform }) => {
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
    const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const accounts = getDb()
      .prepare(
        `SELECT a.*, p.name AS profile_name, px.label AS proxy_label, px.kind AS proxy_kind
         FROM reddit_accounts a
         JOIN model_profiles p ON p.id = a.profile_id
         LEFT JOIN proxies px ON px.id = a.proxy_id
         ${whereClause}
         ORDER BY p.name, a.platform, a.status, a.username`
      )
      .all(...params);
    return { ok: true, accounts: accounts.map(hydrateAccount) };
  });

  ipcMain.handle('accounts:create', (_e, args) => {
    try {
      const { token, profileId, platform, username, password, email, emailPassword, status, proxyId, notes } = args;
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      if (!canAccessProfile(user, profileId)) throw new Error('Not authorized');
      const plat = platform || 'reddit';
      if (!['reddit', 'redgifs'].includes(plat)) throw new Error('Invalid platform');

      const partitionKey = `${plat}-${profileId}-${username.toLowerCase().replace(/[^a-z0-9_-]/g, '')}-${Date.now()}`;
      const info = getDb()
        .prepare(
          `INSERT INTO reddit_accounts
           (profile_id, platform, username, partition_key, password_encrypted, email, email_password_encrypted, status, proxy_id, notes)
           VALUES (?,?,?,?,?,?,?,?,?,?)`
        )
        .run(
          profileId, plat, username, partitionKey,
          encryptSecret(password), email || null, encryptSecret(emailPassword),
          status || 'warming', proxyId || null, notes || null
        );
      log(user, 'account.create', 'account', info.lastInsertRowid, `${plat} u/${username}`);
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

      const allowed = ['status', 'proxy_id', 'notes', 'email'];
      const sets = [];
      const params = [];
      for (const key of allowed) {
        if (updates[key] !== undefined) {
          sets.push(`${key} = ?`);
          params.push(updates[key]);
        }
      }
      if (updates.password !== undefined) {
        sets.push('password_encrypted = ?');
        params.push(updates.password ? encryptSecret(updates.password) : null);
      }
      if (updates.emailPassword !== undefined) {
        sets.push('email_password_encrypted = ?');
        params.push(updates.emailPassword ? encryptSecret(updates.emailPassword) : null);
      }
      if (sets.length === 0) return { ok: true };
      params.push(accountId);
      getDb().prepare(`UPDATE reddit_accounts SET ${sets.join(', ')} WHERE id = ?`).run(...params);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('accounts:getCredentials', (_e, { token, accountId }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      const acct = getDb().prepare('SELECT * FROM reddit_accounts WHERE id = ?').get(accountId);
      if (!acct) throw new Error('Not found');
      if (!canAccessProfile(user, acct.profile_id)) throw new Error('Not authorized');
      return {
        ok: true,
        username: acct.username,
        password: decryptSecret(acct.password_encrypted),
        email: acct.email,
        emailPassword: decryptSecret(acct.email_password_encrypted),
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('accounts:delete', (_e, { token, accountId }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      const acct = getDb().prepare('SELECT * FROM reddit_accounts WHERE id = ?').get(accountId);
      if (!acct) throw new Error('Account not found');
      if (!canAccessProfile(user, acct.profile_id)) throw new Error('Not authorized');
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
  ipcMain.handle('accounts:bulkCreate', (_e, { token, profileId, platform, proxyId, status, lines }) => {
    try {
      const user = userFromToken(token);
      if (!user) throw new Error('Not authenticated');
      if (!canAccessProfile(user, profileId)) throw new Error('Not authorized for this profile');
      const plat = platform || 'reddit';
      if (!['reddit', 'redgifs'].includes(plat)) throw new Error('Invalid platform');

      const input = String(lines || '').split(/\r?\n/);
      const created = [];
      const errors = [];

      const insert = getDb().prepare(
        `INSERT INTO reddit_accounts
         (profile_id, platform, username, partition_key, password_encrypted, email, email_password_encrypted, status, proxy_id)
         VALUES (?,?,?,?,?,?,?,?,?)`
      );

      const txn = getDb().transaction(() => {
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
              encryptSecret(p), e || null, encryptSecret(ep || null),
              status || 'warming', proxyId || null
            );
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
