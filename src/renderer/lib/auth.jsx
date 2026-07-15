import React, { createContext, useContext, useEffect, useRef, useState } from 'react';

const AuthCtx = createContext(null);

function normalizeUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    email: u.email,
    username: u.display_name || u.email || u.id,
    display_name: u.display_name || u.email || 'User',
    role: u.role || 'member',
  };
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTeamId, setActiveTeamId] = useState(null);
  const lastInputAt = useRef(Date.now());

  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const res = await window.api.teamAuth.me();
        if (cancelled) return;
        if (res.ok && res.user) {
          const u = normalizeUser(res.user);
          setUser(u);
          const teamsRes = await window.api.team.listTeams({});
          if (teamsRes.ok && teamsRes.teams && teamsRes.teams.length > 0) {
            const teamId = teamsRes.teams[0].id;
            setActiveTeamId(teamId);
            window.api.settings.setTeam({ teamId }).catch(() => {});
          }
        } else {
          setUser(null);
        }
      } catch {
        setUser(null);
      }
      setLoading(false);
    }
    check();
    return () => { cancelled = true; };
  }, []);

  async function signUp(email, password) {
    const res = await window.api.teamAuth.signUp({ email, password });
    if (res.ok) {
      const u = normalizeUser(res.user);
      setUser(u);
      const teamId = res.defaultTeamId;
      if (teamId) {
        setActiveTeamId(teamId);
        window.api.settings.setTeam({ teamId }).catch(() => {});
        window.api.team.backfillData({ teamId }).catch(() => {});
        window.api.team.loadTeamKey({ teamId }).catch(() => {});
      }
      // Wire auth client for sync
      const sessionRes = await window.api.teamAuth.getSession({});
      if (sessionRes.ok && sessionRes.session?.access_token) {
        window.api.cloud.setAccessToken({ token: sessionRes.session.access_token }).catch(() => {});
      }
      return { ok: true };
    }
    return { ok: false, error: res.error };
  }

  async function signIn(email, password) {
    const res = await window.api.teamAuth.signIn({ email, password });
    if (res.ok) {
      const u = normalizeUser(res.user);
      setUser(u);
      const teamId = res.defaultTeamId;
      if (teamId) {
        setActiveTeamId(teamId);
        window.api.settings.setTeam({ teamId }).catch(() => {});
        window.api.team.backfillData({ teamId }).catch(() => {});
        window.api.team.loadTeamKey({ teamId }).catch(() => {});
      }
      // Wire auth client for sync
      const sessionRes = await window.api.teamAuth.getSession({});
      if (sessionRes.ok && sessionRes.session?.access_token) {
        window.api.cloud.setAccessToken({ token: sessionRes.session.access_token }).catch(() => {});
      }
      return { ok: true };
    }
    return { ok: false, error: res.error };
  }

  async function changePassword(newPassword) {
    const res = await window.api.teamAuth.changePassword({ newPassword });
    return res.ok ? { ok: true } : { ok: false, error: res.error };
  }

  async function logout() {
    await window.api.teamAuth.signOut();
    setUser(null);
    setActiveTeamId(null);
  }

  function setActiveTeam(teamId) {
    setActiveTeamId(teamId);
    window.api.settings.setTeam({ teamId }).catch(() => {});
  }

  useEffect(() => {
    if (!user) return;
    const bump = () => { lastInputAt.current = Date.now(); };
    const opts = { passive: true, capture: true };
    window.addEventListener('mousedown', bump, opts);
    window.addEventListener('keydown',   bump, opts);
    window.addEventListener('wheel',     bump, opts);
    window.addEventListener('touchstart',bump, opts);
    window.addEventListener('focus',     bump);
    return () => {
      window.removeEventListener('mousedown', bump, opts);
      window.removeEventListener('keydown',   bump, opts);
      window.removeEventListener('wheel',     bump, opts);
      window.removeEventListener('touchstart',bump, opts);
      window.removeEventListener('focus',     bump);
    };
  }, [user]);

  useEffect(() => {
    if (!user) return;
    let stopped = false;
    const machineId = 'desktop-' + (user.id || 'unknown').slice(0, 8);
    const beat = () => {
      if (stopped) return;
      try {
        window.api.team.heartbeat?.({ machineId, label: 'Desktop', autopilotEnabled: true, appVersion: '' });
      } catch {}
    };
    beat();
    const id = setInterval(beat, 30000);
    return () => { stopped = true; clearInterval(id); };
  }, [user]);

  return (
    <AuthCtx.Provider value={{ user, loading, signIn, signUp, logout, changePassword, isFirstLogin: false, activeTeamId, setActiveTeam }}>
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth() {
  return useContext(AuthCtx);
}
