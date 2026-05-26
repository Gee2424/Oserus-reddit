import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useAuth } from './auth.jsx';

const ActiveAccountCtx = createContext(null);

// Each platform tracks its own active account independently.
// localStorage keys: activeAccount_reddit, activeAccount_redgifs
function loadActive(platform) {
  const v = localStorage.getItem(`activeAccount_${platform}`);
  return v ? Number(v) : null;
}

export function ActiveAccountProvider({ children }) {
  const { token, user } = useAuth();
  const [accounts, setAccounts] = useState([]);
  const [activeIds, setActiveIds] = useState({
    reddit: loadActive('reddit'),
    redgifs: loadActive('redgifs'),
  });
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    const res = await window.api.accounts.listForUser({ token });
    setLoading(false);
    if (res.ok) {
      setAccounts(res.accounts);
      // Clear any active IDs whose accounts no longer exist
      setActiveIds(prev => {
        const next = { ...prev };
        for (const plat of ['reddit', 'redgifs']) {
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

  // Re-prepare session whenever an active id changes
  useEffect(() => {
    for (const id of Object.values(activeIds)) {
      if (id) window.api.session.prepareForAccount({ accountId: id });
    }
  }, [activeIds.reddit, activeIds.redgifs]);

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
    return {
      accounts: accounts.filter(a => (a.platform || 'reddit') === platform),
      active: platform === 'reddit' ? activeReddit : activeRedgifs,
      activeId: activeIds[platform],
      setActive: (id) => setActiveForPlatform(platform, id),
    };
  }

  return (
    <ActiveAccountCtx.Provider
      value={{
        accounts,
        activeReddit, activeRedgifs,
        setActiveForPlatform,
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
