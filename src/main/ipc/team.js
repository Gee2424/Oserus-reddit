const { getAuthedClient, getAdminClient } = require('../supabaseClient');
const { getSessionUser, createUserViaAdmin, updateSessionRole } = require('./teamAuth');
const { requirePermission, hasPermission } = require('../permissions');
const { getDb } = require('../db');
const { initTeamKey, loadTeamKey, setSharedCredential,
        getSharedCredential, deleteSharedCredential, clearTeamKeyCache } = require('../sharedCredentials');

function withTimeout(promise, ms = 10000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

function register(ipcMain) {
  function auth() {
    const user = getSessionUser();
    if (!user) throw new Error('Not authenticated');
    const db = getDb();
    const localUser = db.prepare('SELECT id FROM users WHERE email = ?').get(user.email);
    return {
      id: user.id,
      localId: localUser?.id || null,
      email: user.email,
      role: user.role || 'member',
      display_name: user.display_name || user.email || 'User',
    };
  }

  // ──────────────────────────────────────────────── backfill team_id
  // Assigns all existing local data (accounts, profiles, proxies)
  // that have no team_id to the given team.
  ipcMain.handle('team:backfillData', async (_e, { teamId }) => {
    try {
      auth();
      const db = getDb();
      const updates = [
        db.prepare("UPDATE reddit_accounts SET team_id = ? WHERE team_id IS NULL").run(teamId),
        db.prepare("UPDATE model_profiles SET team_id = ? WHERE team_id IS NULL").run(teamId),
        db.prepare("UPDATE proxies SET team_id = ? WHERE team_id IS NULL").run(teamId),
      ];
      return { ok: true, updated: updates.reduce((s, r) => s + (r.changes || 0), 0) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // ──────────────────────────────────────────── shared credentials handlers
  ipcMain.handle('team:loadTeamKey', async (_e, { teamId }) => {
    try {
      auth();
      return await loadTeamKey(teamId);
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('team:setSharedCredential', async (_e, { teamId, accountId, credentialType, plaintext }) => {
    try {
      const me = auth();
      return await setSharedCredential(teamId, accountId, credentialType, plaintext, me.id);
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('team:getSharedCredential', async (_e, { teamId, accountId, credentialType }) => {
    try {
      auth();
      const result = await getSharedCredential(teamId, accountId, credentialType);
      return { ok: true, value: result };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('team:deleteSharedCredential', async (_e, { teamId, accountId, credentialType }) => {
    try {
      auth();
      return await deleteSharedCredential(teamId, accountId, credentialType);
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // ──────────────────────────────────────────── invitation handlers

  // Create an invitation (or directly add if user exists)
  ipcMain.handle('team:createInvitation', async (_e, { teamId, email, role }) => {
    try {
      const me = auth();
      const client = getAuthedClient();
      if (!client) return { ok: false, error: 'Supabase not configured' };

      // Search for existing user by email
      let userId = null;
      const { data: users } = await client.from('auth.users').select('id').eq('email', email).maybeSingle();
      if (users) userId = users.id;

      if (userId) {
        // User exists — add directly
        const { error: insertErr } = await client.from('team_members').insert({
          team_id: teamId, user_id: userId, role: role || 'member',
        });
        if (insertErr) return { ok: false, error: insertErr.message };
        return { ok: true, user_id: userId, method: 'direct' };
      }

      // User doesn't exist — create invitation
      const { error: invErr } = await client.from('team_invitations').insert({
        team_id: teamId, email, role: role || 'member', invited_by: me.id, status: 'pending',
      });
      if (invErr) return { ok: false, error: invErr.message };
      return { ok: true, method: 'invitation' };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // List pending invitations for the current user
  ipcMain.handle('team:listMyInvitations', async () => {
    try {
      const me = auth();
      const client = getAuthedClient();
      if (!client) return { ok: false, error: 'Supabase not configured' };
      const { data, error } = await client.from('team_invitations').select('*, teams(name)').eq('email', me.email).eq('status', 'pending');
      if (error) return { ok: false, error: error.message };
      return { ok: true, invitations: data || [] };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // Accept an invitation
  ipcMain.handle('team:acceptInvitation', async (_e, { invitationId }) => {
    try {
      const me = auth();
      const client = getAuthedClient();
      if (!client) return { ok: false, error: 'Supabase not configured' };

      const { data: inv, error: getErr } = await client.from('team_invitations').select('*').eq('id', invitationId).single();
      if (getErr || !inv) return { ok: false, error: 'Invitation not found' };
      if (inv.email !== me.email) return { ok: false, error: 'Not your invitation' };
      if (inv.status !== 'pending') return { ok: false, error: 'Invitation already processed' };
      if (new Date(inv.expires_at) < new Date()) return { ok: false, error: 'Invitation expired' };

      const { error: memberErr } = await client.from('team_members').insert({
        team_id: inv.team_id, user_id: me.id, role: inv.role,
      });
      if (memberErr) return { ok: false, error: memberErr.message };

      await client.from('team_invitations').update({ status: 'accepted' }).eq('id', invitationId);
      return { ok: true, team_id: inv.team_id };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // Decline an invitation
  ipcMain.handle('team:declineInvitation', async (_e, { invitationId }) => {
    try {
      const me = auth();
      const client = getAuthedClient();
      if (!client) return { ok: false, error: 'Supabase not configured' };
      await client.from('team_invitations').update({ status: 'declined' }).eq('id', invitationId);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // List invitations for a team (owner/admin view)
  ipcMain.handle('team:listInvitations', async (_e, { teamId }) => {
    try {
      auth();
      const client = getAuthedClient();
      if (!client) return { ok: false, error: 'Supabase not configured' };
      const { data, error } = await client.from('team_invitations').select('*').eq('team_id', teamId);
      if (error) return { ok: false, error: error.message };
      return { ok: true, invitations: data || [] };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // Check and auto-accept pending invitations for the current user
  ipcMain.handle('team:acceptPendingInvitations', async () => {
    try {
      const me = auth();
      const client = getAuthedClient();
      if (!client) return { ok: false, error: 'Supabase not configured' };
      const { data: pending } = await client.from('team_invitations').select('*').eq('email', me.email).eq('status', 'pending');
      if (!pending || pending.length === 0) return { ok: true, accepted: 0 };
      let accepted = 0;
      for (const inv of pending) {
        if (new Date(inv.expires_at) < new Date()) continue;
        const { error: memberErr } = await client.from('team_members').insert({
          team_id: inv.team_id, user_id: me.id, role: inv.role,
        });
        if (!memberErr) {
          await client.from('team_invitations').update({ status: 'accepted' }).eq('id', inv.id);
          accepted++;
        }
      }
      return { ok: true, accepted };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // ──────────────────────────────────────────── account assignment handlers
  ipcMain.handle('team:assignAccount', async (_e, { accountId, userId, accessLevel }) => {
    try {
      auth();
      const client = getAuthedClient();
      if (!client) return { ok: false, error: 'Supabase not configured' };
      const { error } = await client.from('account_assignments').insert({
        social_account_id: Number(accountId), user_id: userId,
        access_level: accessLevel || 'use',
      });
      if (error) return { ok: false, error: error.message };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('team:unassignAccount', async (_e, { accountId, userId }) => {
    try {
      auth();
      const client = getAuthedClient();
      if (!client) return { ok: false, error: 'Supabase not configured' };
      const { error } = await client.from('account_assignments').delete()
        .eq('social_account_id', Number(accountId)).eq('user_id', userId);
      if (error) return { ok: false, error: error.message };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('team:listAssignments', async (_e, { teamId }) => {
    try {
      auth();
      const client = getAuthedClient();
      if (!client) return { ok: false, error: 'Supabase not configured' };
      const { data, error } = await client.from('account_assignments').select('*');
      if (error) return { ok: false, error: error.message };
      // Filter locally by team membership
      const { data: members } = await client.from('team_members').select('user_id').eq('team_id', teamId);
      const memberIds = new Set((members || []).map(m => m.user_id));
      const filtered = (data || []).filter(a => memberIds.has(a.user_id));
      return { ok: true, assignments: filtered };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // ─────────────────────────────────────────────── existing team: handlers
  ipcMain.handle('team:listTeams', async () => {
    try {
      auth();
      const client = getAuthedClient();
      if (!client) return { ok: false, error: 'Supabase not configured' };
      const { data, error } = await withTimeout(client.from('teams').select('*'));
      if (error) return { ok: false, error: error.message };
      return { ok: true, teams: data || [] };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('team:getTeam', async (_e, { teamId }) => {
    try {
      auth();
      const client = getAuthedClient();
      if (!client) return { ok: false, error: 'Supabase not configured' };
      const { data, error } = await client.from('teams').select('*').eq('id', teamId).single();
      if (error) return { ok: false, error: error.message };
      return { ok: true, team: data };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('team:createTeam', async (_e, { name }) => {
    try {
      const user = auth();
      const client = getAuthedClient();
      if (!client) return { ok: false, error: 'Supabase not configured' };
      const { data: team, error: teamErr } = await client.from('teams').insert({
        name, owner_user_id: user.id,
      }).select().single();
      if (teamErr) return { ok: false, error: teamErr.message };
      const { error: memberErr } = await client.from('team_members').insert({
        team_id: team.id, user_id: user.id, role: 'owner',
      });
      if (memberErr) return { ok: false, error: memberErr.message };
      updateSessionRole('owner');
      await initTeamKey(team.id).catch(() => {});
      return { ok: true, team };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('team:listMembers', async (_e, { teamId }) => {
    try {
      auth();
      const client = getAuthedClient();
      if (!client) return { ok: false, error: 'Supabase not configured' };
      const { data, error } = await client.from('team_members').select('*').eq('team_id', teamId);
      if (error) return { ok: false, error: error.message };
      return { ok: true, members: data || [] };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('team:addMember', async (_e, { teamId, email, role, password }) => {
    try {
      const me = auth();
      const client = getAuthedClient();
      if (!client) return { ok: false, error: 'Supabase not configured' };

      if (role === 'admin' && !hasPermission(me, 'users.assign_admin')) {
        return { ok: false, error: "You don't have permission to assign admin role" };
      }
      if (role === 'owner') {
        return { ok: false, error: 'Cannot add an owner. Transfer ownership instead.' };
      }

      let userId;
      try {
        const adminClient = getAdminClient();
        if (adminClient) {
          const { data: users } = await adminClient.auth.admin.listUsers();
          const match = users?.users?.find((u) => u.email && u.email.toLowerCase() === email.toLowerCase());
          if (match) userId = match.id;
        }
      } catch {}

      if (!userId) {
        if (!password) {
          // No password → create pending invitation. Accepted when they sign up.
          const { error: invErr } = await client.from('team_invitations').insert({
            team_id: teamId, email, role: role || 'member', invited_by: me.id, status: 'pending',
          });
          if (invErr) return { ok: false, error: invErr.message };
          return { ok: true, method: 'invitation' };
        }
        const createRes = await createUserViaAdmin(email, password);
        if (!createRes.ok) return { ok: false, error: createRes.error };
        userId = createRes.user_id;
      }

      const { error: insertErr } = await client.from('team_members').insert({
        team_id: teamId, user_id: userId, role: role || 'member',
      });
      if (insertErr) return { ok: false, error: insertErr.message };
      return { ok: true, user_id: userId };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('team:removeMember', async (_e, { teamId, userId }) => {
    try {
      const me = auth();
      const client = getAuthedClient();
      if (!client) return { ok: false, error: 'Supabase not configured' };
      const { data: target } = await client.from('team_members').select('role').eq('team_id', teamId).eq('user_id', userId).single();
      if (target && target.role === 'owner') {
        return { ok: false, error: "Cannot remove the team owner. Transfer ownership first." };
      }
      const { error } = await client.from('team_members').delete().eq('team_id', teamId).eq('user_id', userId);
      if (error) return { ok: false, error: error.message };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('team:changeRole', async (_e, { teamId, userId, newRole }) => {
    try {
      const me = auth();
      const client = getAuthedClient();
      if (!client) return { ok: false, error: 'Supabase not configured' };
      const { data: target } = await client.from('team_members').select('role').eq('team_id', teamId).eq('user_id', userId).single();
      if (target && target.role === 'owner') {
        return { ok: false, error: "Cannot change the owner's role. Transfer ownership first." };
      }
      if (newRole === 'admin' && !hasPermission(me, 'users.assign_admin')) {
        return { ok: false, error: "You don't have permission to assign admin role" };
      }
      const { error } = await client.from('team_members').update({ role: newRole }).eq('team_id', teamId).eq('user_id', userId);
      if (error) return { ok: false, error: error.message };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('team:heartbeat', async (_e, { machineId, label, autopilotEnabled, appVersion }) => {
    try {
      const user = auth();
      const client = getAuthedClient();
      if (!client) return { ok: false, error: 'Supabase not configured' };
      const { data: members } = await client.from('team_members').select('team_id').eq('user_id', user.id);
      if (!members || members.length === 0) return { ok: true };
      for (const m of members) {
        await client.from('machine_sessions').upsert({
          machine_id: machineId,
          team_id: m.team_id,
          user_id: user.id,
          label: label || machineId,
          last_seen_at: new Date().toISOString(),
          autopilot_enabled: autopilotEnabled !== false,
          app_version: appVersion || 'unknown',
        }, { onConflict: 'machine_id' });
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('team:listMachines', async (_e, { teamId }) => {
    try {
      auth();
      const client = getAuthedClient();
      if (!client) return { ok: false, error: 'Supabase not configured' };
      const { data, error } = await client.from('machine_sessions').select('*').eq('team_id', teamId);
      if (error) return { ok: false, error: error.message };
      return { ok: true, machines: data || [] };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('team:toggleMachineAutopilot', async (_e, { machineId, enabled }) => {
    try {
      const user = auth();
      if (!hasPermission(user, 'users.manage')) {
        return { ok: false, error: 'Not authorized' };
      }
      const client = getAuthedClient();
      if (!client) return { ok: false, error: 'Supabase not configured' };
      const { error } = await client.from('machine_sessions').update({ autopilot_enabled: !!enabled }).eq('machine_id', machineId);
      if (error) return { ok: false, error: error.message };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  // ─────────────────────────────────────────────── team:overview
  // Aggregated per-user productivity metrics for the management hub.
  const ONLINE_GAP_MS   = 2  * 60 * 1000;
  const ACTIVE_GAP_MS   = 5  * 60 * 1000;
  function parseTs(s) {
    if (!s) return 0;
    return new Date(s.replace(' ', 'T') + 'Z').getTime();
  }
  function tierFor(lastSeenIso, lastActionIso) {
    const seenAge = Date.now() - parseTs(lastSeenIso);
    if (!lastSeenIso || seenAge > ONLINE_GAP_MS) return 'offline';
    const actAge = Date.now() - parseTs(lastActionIso || lastSeenIso);
    if (actAge > ACTIVE_GAP_MS) return 'idle';
    return 'online';
  }

  ipcMain.handle('team:overview', (_e, { teamId } = {}) => {
    try {
      auth();
      const db = getDb();

      const tf = teamId && /^[a-f0-9-]{36}$/i.test(teamId) ? ` AND p.team_id = '${teamId}'` : '';

      const rows = db.prepare(`
        SELECT
          u.id, u.username, u.display_name, u.role, u.avatar_color, u.created_at,
          (SELECT COUNT(*) FROM model_profiles WHERE assigned_user_id = u.id${teamId ? ` AND team_id = '${teamId}'` : ''}) AS models_assigned,
          (SELECT COUNT(*) FROM reddit_accounts a JOIN model_profiles p ON p.id = a.profile_id WHERE p.assigned_user_id = u.id AND a.status != 'banned'${tf}) AS accounts_active,
          (SELECT COUNT(*) FROM reddit_accounts a JOIN model_profiles p ON p.id = a.profile_id WHERE p.assigned_user_id = u.id AND a.status = 'banned'${tf}) AS accounts_banned,
          (SELECT COUNT(*) FROM post_events e WHERE e.status = 'posted' AND e.created_at >= datetime('now', '-1 day') AND (e.created_by_user_id = u.id OR e.account_id IN (SELECT a.id FROM reddit_accounts a JOIN model_profiles p ON p.id = a.profile_id WHERE p.assigned_user_id = u.id${tf}))) AS posts_today,
          (SELECT COUNT(*) FROM auto_comment_runs r WHERE r.status = 'posted' AND r.created_at >= datetime('now', '-1 day') AND r.account_id IN (SELECT a.id FROM reddit_accounts a JOIN model_profiles p ON p.id = a.profile_id WHERE p.assigned_user_id = u.id${tf})) AS comments_today,
          (SELECT COALESCE(SUM(s.seconds), 0) FROM engagement_sessions s WHERE s.started_at >= datetime('now', '-1 day') AND s.account_id IN (SELECT a.id FROM reddit_accounts a JOIN model_profiles p ON p.id = a.profile_id WHERE p.assigned_user_id = u.id${tf})) AS engagement_seconds_today,
          u.last_seen_at AS last_seen, u.last_action_at AS last_action,
          u.today_seconds AS today_seconds_active, u.today_date AS today_date,
          (SELECT COUNT(*) FROM activity_log WHERE user_id = u.id AND created_at >= datetime('now', '-1 day')) AS actions_today
        FROM users u ORDER BY u.role, u.username
      `).all();

      const today = (() => {
        const d = new Date();
        const tz = d.getTimezoneOffset() * 60000;
        return new Date(d.getTime() - tz).toISOString().slice(0, 10);
      })();

      const members = rows.map((r) => ({
        ...r,
        engagement_minutes_today: Math.round((r.engagement_seconds_today || 0) / 60),
        time_on_task_minutes: Math.round(((r.today_date === today ? (r.today_seconds_active || 0) : 0) / 60)),
        presence: tierFor(r.last_seen, r.last_action),
      }));

      const totals = {
        active_now:       members.filter((m) => m.presence === 'online').length,
        members_total:    members.length,
        posts_today:      members.reduce((s, m) => s + m.posts_today, 0),
        comments_today:   members.reduce((s, m) => s + m.comments_today, 0),
        karma_today:      0,
        engagement_minutes_today: members.reduce((s, m) => s + m.engagement_minutes_today, 0),
        time_on_task_minutes:     members.reduce((s, m) => s + (m.time_on_task_minutes || 0), 0),
        accounts_active:  db.prepare(`SELECT COUNT(*) AS n FROM reddit_accounts WHERE status != 'banned'${teamId ? ` AND team_id = '${teamId}'` : ''}`).get().n,
        accounts_banned:  db.prepare(`SELECT COUNT(*) AS n FROM reddit_accounts WHERE status = 'banned'${teamId ? ` AND team_id = '${teamId}'` : ''}`).get().n,
        models_total:     db.prepare(`SELECT COUNT(*) AS n FROM model_profiles${teamId ? ` WHERE team_id = '${teamId}'` : ''}`).get().n,
      };

      return { ok: true, members, totals, generatedAt: new Date().toISOString() };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ──────────────────────────────────────────── team:memberDetail
  ipcMain.handle('team:memberDetail', (_e, { userId, teamId }) => {
    try {
      auth();
      const db = getDb();

      const member = db.prepare(
        'SELECT id, username, display_name, role, avatar_color, created_at FROM users WHERE id = ?'
      ).get(Number(userId));
      if (!member) throw new Error('User not found');

      const teamFilter = teamId ? ` AND p.team_id = '${teamId}'` : '';

      const models = db.prepare(`
        SELECT p.id, p.name, p.niche,
               (SELECT COUNT(*) FROM reddit_accounts WHERE profile_id = p.id) AS accounts_count,
               (SELECT COUNT(*) FROM reddit_accounts WHERE profile_id = p.id AND status = 'banned') AS accounts_banned
        FROM model_profiles p WHERE p.assigned_user_id = ?${teamId ? ` AND p.team_id = '${teamId}'` : ''} ORDER BY p.name
      `).all(member.id);

      const accounts = db.prepare(`
        SELECT a.id, a.username, a.platform, a.status, a.starred,
               p.name AS profile_name,
               (SELECT MAX(created_at) FROM post_events WHERE account_id = a.id) AS last_post_at
        FROM reddit_accounts a JOIN model_profiles p ON p.id = a.profile_id
        WHERE p.assigned_user_id = ?${teamId ? ` AND p.team_id = '${teamId}'` : ''} ORDER BY p.name, a.platform, a.username
      `).all(member.id);

      const recentPosts = db.prepare(`
        SELECT e.id, e.subreddit, e.title, e.status, e.platform, e.source, e.created_at,
               a.username AS account_username FROM post_events e
        LEFT JOIN reddit_accounts a ON a.id = e.account_id
        WHERE e.created_by_user_id = ? OR e.account_id IN (SELECT a2.id FROM reddit_accounts a2 JOIN model_profiles p ON p.id = a2.profile_id WHERE p.assigned_user_id = ?${teamId ? ` AND p.team_id = '${teamId}'` : ''})
        ORDER BY e.id DESC LIMIT 15
      `).all(member.id, member.id);

      const recentActions = db.prepare(`
        SELECT id, action, entity_type, entity_id, detail, created_at FROM activity_log WHERE user_id = ? ORDER BY id DESC LIMIT 25
      `).all(member.id);

      const recentEngagement = db.prepare(`
        SELECT s.id, s.platform, s.started_at, s.ended_at, s.seconds, s.posts_seen, s.likes, s.follows, s.comments, s.error,
               a.username AS account_username FROM engagement_sessions s
        LEFT JOIN reddit_accounts a ON a.id = s.account_id
        WHERE s.account_id IN (SELECT a2.id FROM reddit_accounts a2 JOIN model_profiles p ON p.id = a2.profile_id WHERE p.assigned_user_id = ?${teamId ? ` AND p.team_id = '${teamId}'` : ''})
        ORDER BY s.id DESC LIMIT 15
      `).all(member.id);

      return {
        ok: true,
        member: { ...member, presence: tierFor(member.last_seen_at, member.last_action_at) },
        models, accounts,
        recent: { posts: recentPosts, actions: recentActions, engagement: recentEngagement, comments: [] },
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
}

module.exports = register;
