import React, { createContext, useContext, useEffect, useRef, useState } from 'react';

const AuthCtx = createContext(null);

// Presence heartbeat config — matches the main process IDLE_GAP_MS (5
// min). The renderer pings every 20s with the timestamp of its last
// real user input; the main process credits time-on-task only when
// that timestamp is within the 5-minute window.
const HEARTBEAT_MS = 20_000;

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem('token') || null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const lastInputAt = useRef(Date.now());

  useEffect(() => {
    let cancelled = false;
    async function check() {
      if (!token) {
        setUser(null);
        setLoading(false);
        return;
      }
      const res = await window.api.auth.me({ token });
      if (cancelled) return;
      if (res.ok) setUser(res.user);
      else {
        setToken(null);
        localStorage.removeItem('token');
        setUser(null);
      }
      setLoading(false);
    }
    check();
    return () => { cancelled = true; };
  }, [token]);

  async function login(username, password) {
    const res = await window.api.auth.login({ username, password });
    if (res.ok) {
      localStorage.setItem('token', res.token);
      setToken(res.token);
      setUser(res.user);
      return { ok: true };
    }
    return { ok: false, error: res.error };
  }

  // Track real user input so the heartbeat can tell the main process
  // when we're idle. Any of these resets the timer.
  useEffect(() => {
    if (!token) return;
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
  }, [token]);

  // Heartbeat loop. Fires immediately on login + every HEARTBEAT_MS
  // while logged in. Carries the last-input timestamp so the server
  // can pause the timer after 5 minutes of nothing.
  useEffect(() => {
    if (!token) return;
    let stopped = false;
    const beat = () => {
      if (stopped) return;
      try {
        window.api.auth.heartbeat?.({ token, lastActionAt: lastInputAt.current, source: 'app' });
      } catch {}
    };
    beat();
    const id = setInterval(beat, HEARTBEAT_MS);
    return () => { stopped = true; clearInterval(id); };
  }, [token]);

  async function logout() {
    if (token) await window.api.auth.logout({ token });
    localStorage.removeItem('token');
    setToken(null);
    setUser(null);
  }

  return (
    <AuthCtx.Provider value={{ token, user, loading, login, logout }}>
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth() {
  return useContext(AuthCtx);
}
