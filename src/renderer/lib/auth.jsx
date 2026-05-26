import React, { createContext, useContext, useEffect, useState } from 'react';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem('token') || null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

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
