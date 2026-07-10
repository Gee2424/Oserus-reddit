const { safeStorage } = require('electron');
const elog = require('electron-log');
const { getAnonClient, getAdminClient, getAuthedClient, getAuthClient } = require('../supabaseClient');
const { getKv, setKv } = require('../db');

const SESSION_KEY = 'oserus_session';
const ENC_PREFIX = 'ENC:';

function withTimeout(promise, ms = 10000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

function getSession() {
  try {
    const raw = getKv(SESSION_KEY);
    if (!raw) return null;
    if (raw.startsWith(ENC_PREFIX)) {
      if (safeStorage.isEncryptionAvailable()) {
        const decrypted = safeStorage.decryptString(Buffer.from(raw.slice(ENC_PREFIX.length), 'base64'));
        return JSON.parse(decrypted);
      }
      return null;
    }
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveSession(data) {
  try {
    const json = JSON.stringify(data);
    if (safeStorage.isEncryptionAvailable()) {
      const enc = safeStorage.encryptString(json);
      setKv(SESSION_KEY, ENC_PREFIX + enc.toString('base64'));
    } else {
      setKv(SESSION_KEY, json);
    }
  } catch (e) {
    elog.warn('[teamAuth] saveSession failed:', e.message);
  }
}

function clearSession() {
  try {
    setKv(SESSION_KEY, null);
  } catch {}
}

function updateSessionRole(role) {
  const session = getSession();
  if (session) { session.role = role; saveSession(session); }
}

function getSessionUser() {
  const session = getSession();
  if (!session || !session.user) return null;
  return { ...session.user, role: session.role || 'member' };
}

// Ensure a local users table entry exists for this Supabase user.
function ensureLocalUser(email, displayName) {
  try {
    const db = require('../db').getDb();
    const existing = db.prepare('SELECT id, role FROM users WHERE email = ?').get(email);
    if (existing) return existing.id;
    const info = db.prepare(
      'INSERT INTO users (username, password_hash, role, display_name, email) VALUES (?, ?, ?, ?, ?)'
    ).run(email, '', 'admin', displayName || email, email);
    console.log('[teamAuth] Created local user for', email, 'id:', info.lastInsertRowid);
    return info.lastInsertRowid;
  } catch (e) {
    console.warn('[teamAuth] ensureLocalUser failed:', e.message);
    return null;
  }
}

// Auto-create a default team for this user if they have none.
// Returns the team ID.
async function ensureDefaultTeam(userId, email) {
  try {
    const client = getAuthedClient();
    if (!client) return null;
    // Check if user already has teams via team_members
    const { data: members } = await client.from('team_members')
      .select('team_id').eq('user_id', userId);
    if (members && members.length > 0) return members[0].team_id;
    const teamName = email ? `${email.split('@')[0]}'s Team` : 'My Team';
    const { data: team, error: teamErr } = await client.from('teams').insert({
      name: teamName, owner_user_id: userId,
    }).select().single();
    if (teamErr) { console.warn('[teamAuth] create team failed:', teamErr.message); return null; }
    await client.from('team_members').insert({
      team_id: team.id, user_id: userId, role: 'owner',
    });
    console.log('[teamAuth] Created default team', team.id, 'for', email);
    return team.id;
  } catch (e) {
    console.warn('[teamAuth] ensureDefaultTeam failed:', e.message);
    return null;
  }
}

async function getUserRole(client, userId) {
  try {
    if (!client) return 'member';
    const { data } = await client.from('team_members')
      .select('role').eq('user_id', userId).limit(1);
    return data?.[0]?.role || 'member';
  } catch { return 'member'; }
}

function register(ipcMain) {
  ipcMain.handle('teamAuth:signUp', async (_e, { email, password }) => {
    try {
      const client = getAnonClient();
      if (!client) return { ok: false, error: 'Supabase not configured' };
      const { data, error } = await client.auth.signUp({ email, password });
      if (error) return { ok: false, error: error.message };
      if (!data.session) {
        return { ok: false, error: 'Email confirmation required. Check your inbox.' };
      }
      saveSession({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        user: data.user,
        role: 'owner',
      });
      ensureLocalUser(email, data.user.user_metadata?.display_name);
      const teamId = await ensureDefaultTeam(data.user.id, email);
      return {
        ok: true,
        user: {
          id: data.user.id,
          email: data.user.email,
          display_name: data.user.user_metadata?.display_name || data.user.email || 'User',
          role: 'owner',
        },
        defaultTeamId: teamId,
      };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('teamAuth:signIn', async (_e, { email, password }) => {
    try {
      const client = getAnonClient();
      if (!client) return { ok: false, error: 'Supabase not configured' };
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) return { ok: false, error: error.message };
      ensureLocalUser(email, data.user.user_metadata?.display_name);
      const teamId = await ensureDefaultTeam(data.user.id, email);
      const role = await getUserRole(client, data.user.id);
      saveSession({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        user: data.user,
        role,
      });
      return {
        ok: true,
        user: {
          id: data.user.id,
          email: data.user.email,
          display_name: data.user.user_metadata?.display_name || data.user.email || 'User',
          role,
        },
        defaultTeamId: teamId,
      };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('teamAuth:signOut', async () => {
    try {
      const client = getAnonClient();
      if (client) {
        await client.auth.signOut();
      }
    } catch {}
    clearSession();
    return { ok: true };
  });

  ipcMain.handle('teamAuth:me', async () => {
    try {
      const client = getAnonClient();
      if (!client) return { ok: false };
    const sessionData = getSession();
    if (!sessionData || !sessionData.access_token) return { ok: false };
    const { data, error } = await withTimeout(client.auth.getUser(sessionData.access_token));
    if (error || !data?.user) {
      if (sessionData.refresh_token) {
        const { data: refreshed, error: refreshError } = await withTimeout(client.auth.refreshSession({
          refresh_token: sessionData.refresh_token,
        }));
        if (refreshed?.session) {
          const authedClient = getAuthClient(refreshed.session.access_token);
          const refreshRole = await getUserRole(authedClient, refreshed.user.id);
          saveSession({
            access_token: refreshed.session.access_token,
            refresh_token: refreshed.session.refresh_token,
            user: refreshed.user,
            role: refreshRole,
          });
          return {
            ok: true,
            user: {
              id: refreshed.user.id,
              email: refreshed.user.email,
              display_name: refreshed.user.user_metadata?.display_name || refreshed.user.email || 'User',
              role: refreshRole,
            },
          };
        }
      }
      clearSession();
      return { ok: false };
    }
    const authedClient = getAuthClient(sessionData.access_token);
    const supabaseRole = await getUserRole(authedClient || client, data.user.id);
    const role = supabaseRole || sessionData.role || 'member';
    if (role !== sessionData.role) {
      const session = getSession();
      if (session) { session.role = role; saveSession(session); }
    }
    return {
      ok: true,
      user: {
        id: data.user.id,
        email: data.user.email,
        display_name: data.user.user_metadata?.display_name || data.user.email || 'User',
        role,
      },
    };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('teamAuth:changePassword', async (_e, { newPassword }) => {
    try {
      const client = getAnonClient();
      if (!client) return { ok: false, error: 'Supabase not configured' };
      const sessionData = getSession();
      if (!sessionData?.access_token) return { ok: false, error: 'Not authenticated' };
      client.auth.setSession({ access_token: sessionData.access_token, refresh_token: sessionData.refresh_token || '' });
      const { error } = await client.auth.updateUser({ password: newPassword });
      if (error) return { ok: false, error: error.message };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('teamAuth:createUser', async (_e, { email, password, displayName }) => {
    try {
      const adminClient = getAdminClient();
      if (!adminClient) return { ok: false, error: 'Auth admin API not configured' };
      const { data, error } = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { display_name: displayName || email.split('@')[0] },
      });
      if (error) return { ok: false, error: error.message };
      return { ok: true, user_id: data.user.id };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('teamAuth:searchUser', async (_e, { email }) => {
    try {
      const adminClient = getAdminClient();
      if (!adminClient) return { ok: false, error: 'Auth admin API not configured' };
      const { data, error } = await adminClient.auth.admin.listUsers();
      if (error) return { ok: false, error: error.message };
      const match = data.users.find((u) => u.email && u.email.toLowerCase() === email.toLowerCase());
      if (match) {
        return { ok: true, found: true, user_id: match.id, email: match.email };
      }
      return { ok: true, found: false };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('teamAuth:getSession', async () => {
    const session = getSession();
    if (!session || !session.user) return { ok: false };
    return {
      ok: true,
      session: { access_token: session.access_token },
      user: { id: session.user.id, email: session.user.email, display_name: session.user.email || 'User', role: session.role || 'member' },
    };
  });
}

module.exports = register;
module.exports.getSessionUser = getSessionUser;
module.exports.updateSessionRole = updateSessionRole;
module.exports.createUserViaAdmin = async (email, password, displayName) => {
  const adminClient = getAdminClient();
  if (!adminClient) return { ok: false, error: 'Auth admin API not configured' };
  const { data, error } = await adminClient.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { display_name: displayName || email.split('@')[0] },
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, user_id: data.user.id };
};
