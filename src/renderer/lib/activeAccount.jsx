import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useAuth } from './auth.jsx';

const ActiveAccountCtx = createContext(null);

// Preference order when auto-picking which account to "start" — ready first,
// then warming, then paused, banned last. Shared by play buttons.
const STATUS_PRIORITY = { ready: 0, warming: 1, paused: 2, banned: 3 };
export function pickPreferredAccount(accounts) {
  if (!accounts || !accounts.length) return null;
  return [...accounts].sort(
    (a, b) => (STATUS_PRIORITY[a.status] ?? 99) - (STATUS_PRIORITY[b.status] ?? 99)
  )[0];
}

// Each platform tracks its own active account independently.
// localStorage keys: activeAccount_reddit, activeAccount_redgifs
function loadActive(platform) {
  const v = localStorage.getItem(`activeAccount_${platform}`);
  return v ? Number(v) : null;
}

const KNOWN_PLATFORMS = ['reddit', 'redgifs', 'x', 'instagram', 'tiktok'];

export function ActiveAccountProvider({ children }) {
  const { token, user } = useAuth();
  const [accounts, setAccounts] = useState([]);
  const [activeIds, setActiveIds] = useState(() => {
    const o = {};
    for (const p of KNOWN_PLATFORMS) o[p] = loadActive(p);
    return o;
  });
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    const res = await window.api.accounts.listForUser({ token });
    setLoading(false);
    if (res.ok) {
      setAccounts(res.accounts);
      setActiveIds(prev => {
        const next = { ...prev };
        for (const plat of KNOWN_PLATFORMS) {
          if (next[plat] && !res.accounts.find(a => a.id === next[plat])) {
            next[plat] = null;
            localStorage.removeItem(`activeAccount_${plat}`);
          }
        }
        return next;
      });
    }
  }, [token]);

  useEffect(() => {
    if (token && user) refresh();
  }, [token, user, refresh]);

  useEffect(() => {
    for (const id of Object.values(activeIds)) {
      if (id) window.api.session.prepareForAccount({ accountId: id });
    }
  }, [activeIds.reddit, activeIds.redgifs, activeIds.x, activeIds.instagram, activeIds.tiktok]);

  async function setActiveForPlatform(platform, accountId) {
    setActiveIds(prev => ({ ...prev, [platform]: accountId }));
    if (accountId) {
      localStorage.setItem(`activeAccount_${platform}`, String(accountId));
      await window.api.session.prepareForAccount({ accountId });
    } else {
      localStorage.removeItem(`activeAccount_${platform}`);
    }
  }

  // Click ▶ on an account — sets active for that account's platform.
  async function startAccount(accountId) {
    const acct = accounts.find(a => a.id === accountId);
    if (!acct) return null;
    const plat = acct.platform || 'reddit';
    await setActiveForPlatform(plat, accountId);
    return acct;
  }

  const activeReddit = accounts.find(a => a.id === activeIds.reddit) || null;
  const activeRedgifs = accounts.find(a => a.id === activeIds.redgifs) || null;

  // For a given platform, return its accounts + active + setter
  function forPlatform(platform) {
    const id = activeIds[platform];
    return {
      accounts: accounts.filter(a => (a.platform || 'reddit') === platform),
      active: accounts.find(a => a.id === id) || null,
      activeId: id,
      setActive: (newId) => setActiveForPlatform(platform, newId),
    };
  }

  return (
    <ActiveAccountCtx.Provider
      value={{
        accounts,
        activeReddit, activeRedgifs,
        setActiveForPlatform,
        // shorter alias used by the Model Hub quick-open buttons
        setActiveFor: setActiveForPlatform,
        startAccount,
        forPlatform,
        refresh,
        loading,
      }}
    >
      {children}
    </ActiveAccountCtx.Provider>
  );
}

export function useActiveAccount() {
  return useContext(ActiveAccountCtx);
}
