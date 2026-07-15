const fs = require('fs');
const path = require('path');
const { dialog } = require('electron');
const AdmZip = require('adm-zip');
const { getDb, encryptSecret, decryptSecret, credentialVaultGet, credentialVaultSet } = require('../db');
const { userFromToken, requireManagerOrAdmin } = require('./auth');

function register(ipcMain) {
  // Export a model profile to a zip file
  ipcMain.handle('bundle:export', async (_e, { token, profileId }) => {
    try {
      requireManagerOrAdmin(token);

      const profile = getDb().prepare('SELECT * FROM model_profiles WHERE id = ?').get(profileId);
      if (!profile) throw new Error('Profile not found');

      const accounts = getDb()
        .prepare('SELECT * FROM reddit_accounts WHERE profile_id = ?')
        .all(profileId);

      // Gather all proxies referenced by the accounts so they're self-contained
      const proxyIds = [...new Set(accounts.map(a => a.proxy_id).filter(Boolean))];
      const proxies = proxyIds.length
        ? getDb().prepare(`SELECT * FROM proxies WHERE id IN (${proxyIds.map(() => '?').join(',')})`).all(...proxyIds)
        : [];

      // Decrypt all secrets — bundle is plain text (per user's spec, transferred via secure channel)
      const bundle = {
        format: 'reddit-manager-profile/1',
        exported_at: new Date().toISOString(),
        profile: {
          name: profile.name,
          niche: profile.niche,
          brand_voice: profile.brand_voice,
          notes: profile.notes,
          avatar_color: profile.avatar_color,
        },
        accounts: accounts.map(a => ({
          platform: a.platform || 'reddit',
          username: a.username,
          password: credentialVaultGet('account_password', a.id) || decryptSecret(a.password_encrypted),
          email: a.email,
          email_password: credentialVaultGet('email_password', a.id) || decryptSecret(a.email_password_encrypted),
          status: a.status,
          notes: a.notes,
          proxy_id: a.proxy_id,
        })),
        proxies: proxies.map(p => ({
          id: p.id,
          label: p.label,
          kind: p.kind,
          host: p.host,
          port: p.port,
          username: p.username,
          password: credentialVaultGet('proxy_password', p.id) || decryptSecret(p.password_encrypted),
        })),
      };

      const result = await dialog.showSaveDialog({
        title: 'Export profile',
        defaultPath: `${profile.name.replace(/[^a-z0-9-]/gi, '_')}-profile.zip`,
        filters: [{ name: 'Profile bundle', extensions: ['zip'] }],
      });
      if (result.canceled || !result.filePath) return { ok: false, error: 'Cancelled' };

      const zip = new AdmZip();
      zip.addFile('profile.json', Buffer.from(JSON.stringify(bundle, null, 2), 'utf8'));
      zip.addFile('README.txt', Buffer.from(
        `Reddit Manager — model profile bundle\n` +
        `Exported: ${bundle.exported_at}\n` +
        `Profile: ${bundle.profile.name}\n` +
        `Accounts: ${bundle.accounts.length}\n` +
        `Proxies: ${bundle.proxies.length}\n\n` +
        `Contents are plain text. Treat this file like a password file.\n` +
        `Import by opening Reddit Manager → Models → Import.\n`,
        'utf8'
      ));
      zip.writeZip(result.filePath);

      return { ok: true, path: result.filePath };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Import a profile bundle - shows a file picker
  ipcMain.handle('bundle:import', async (_e, { token, assignedUserId, teamId }) => {
    try {
      requireManagerOrAdmin(token);

      const result = await dialog.showOpenDialog({
        title: 'Import profile bundle',
        properties: ['openFile'],
        filters: [{ name: 'Profile bundle', extensions: ['zip'] }],
      });
      if (result.canceled || !result.filePaths.length) return { ok: false, error: 'Cancelled' };

      const zip = new AdmZip(result.filePaths[0]);
      const entry = zip.getEntry('profile.json');
      if (!entry) throw new Error('Not a valid profile bundle (no profile.json)');

      const bundle = JSON.parse(entry.getData().toString('utf8'));
      if (!bundle.format || !bundle.format.startsWith('reddit-manager-profile/')) {
        throw new Error('Unknown bundle format');
      }

      const db = getDb();
      const tx = db.transaction(() => {
        // Insert proxies first, build remap of old_id -> new_id
        const proxyRemap = {};
        const proxyInsert = db.prepare(
          'INSERT INTO proxies (label, kind, host, port, username, team_id) VALUES (?,?,?,?,?,?)'
        );
        for (const p of (bundle.proxies || [])) {
          // De-dupe: if an identical proxy already exists, reuse it
          const existing = db.prepare(
            'SELECT id FROM proxies WHERE host = ? AND port = ? AND kind = ?'
          ).get(p.host, p.port, p.kind);
          if (existing) {
            proxyRemap[p.id] = existing.id;
            if (p.password) credentialVaultSet('proxy_password', existing.id, p.password);
          } else {
            const info = proxyInsert.run(
              p.label, p.kind, p.host, p.port, p.username, teamId || null
            );
            proxyRemap[p.id] = info.lastInsertRowid;
            if (p.password) credentialVaultSet('proxy_password', info.lastInsertRowid, p.password);
          }
        }

        // Insert profile
        const profInfo = db.prepare(
          'INSERT INTO model_profiles (name, assigned_user_id, niche, brand_voice, notes, avatar_color, team_id) VALUES (?,?,?,?,?,?,?)'
        ).run(
          bundle.profile.name,
          assignedUserId || null,
          bundle.profile.niche,
          bundle.profile.brand_voice,
          bundle.profile.notes,
          bundle.profile.avatar_color,
          teamId || null,
        );
        const newProfileId = profInfo.lastInsertRowid;

        // Insert accounts
        const acctInsert = db.prepare(
          `INSERT INTO reddit_accounts
           (profile_id, platform, username, partition_key, email, status, proxy_id, notes, team_id)
           VALUES (?,?,?,?,?,?,?,?,?)`
        );
        for (const a of (bundle.accounts || [])) {
          const plat = a.platform || 'reddit';
          const partitionKey = `${plat}-${newProfileId}-${a.username.toLowerCase().replace(/[^a-z0-9_-]/g, '')}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
          const acctInfo = acctInsert.run(
            newProfileId,
            plat,
            a.username,
            partitionKey,
            a.email || null,
            a.status || 'warming',
            proxyRemap[a.proxy_id] || null,
            a.notes || null,
            teamId || null,
          );
          if (a.password) credentialVaultSet('account_password', acctInfo.lastInsertRowid, a.password);
          if (a.email_password) credentialVaultSet('email_password', acctInfo.lastInsertRowid, a.email_password);
        }

        return { newProfileId, accountCount: bundle.accounts.length };
      });

      const out = tx();
      return { ok: true, ...out, profileName: bundle.profile.name };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
}

module.exports = register;
