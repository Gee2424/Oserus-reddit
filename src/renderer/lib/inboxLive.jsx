import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from './auth.jsx';
import { useActiveAccount } from './activeAccount.jsx';

// Root-level inbox polling. Mounted once at the app root; keeps fetching
// inbox + unread counts for every Reddit account every 60s even when the
// user is on Dashboard / Scheduler / wherever. The Inbox page then just
// reads from this context so messages stay live across tab switches.

const InboxLiveCtx = createContext({
  byAccount: {},
  unreadByAccount: {},
  loading: {},
  refresh: () => {},
});

export function InboxLiveProvider({ children }) {
  const { token, user } = useAuth();
  const { accounts } = useActiveAccount();
  // byAccount[id] = { messages, fetchedAt }
  const [byAccount, setByAccount] = useState({});
  const [unreadByAccount, setUnreadByAccount] = useState({});
  const [loading, setLoading] = useState({});
  // Snapshot of accounts so the polling loop doesn't reset when other state
  // mutates; we refresh from the ref each tick.
  const accountsRef = useRef([]);
  useEffect(() => { accountsRef.current = accounts; }, [accounts]);

  async function fetchAccount(a, folder = 'all') {
    if (!a || a.status === 'banned' || (a.platform || 'reddit') !== 'reddit') return;
    setLoading((m) => ({ ...m, [a.id]: true }));
    try {
      await window.api.session.prepareForAccount({ accountId: a.id });
      const r = await window.api.inbox.fetch({ token, accountId: a.id, folder });
      if (r.ok) {
        const messages = r.messages || [];
        setByAccount((m) => ({ ...m, [a.id]: { messages, fetchedAt: Date.now() } }));
        const u = messages.filter((x) => x.isNew).length;
        setUnreadByAccount((m) => ({ ...m, [a.id]: u }));
      }
    } catch {}
    finally {
      setLoading((m) => ({ ...m, [a.id]: false }));
    }
  }

  // Initial pass + 60s tick. We round-robin across accounts: each tick fetches
  // one full inbox (to refresh messages) and the rest just get an unread count.
  useEffect(() => {
    if (!token || !user) return;
    let cancelled = false;
    let cursor = 0;

    const tick = async () => {
      const list = (accountsRef.current || []).filter((a) => (a.platform || 'reddit') === 'reddit' && a.status !== 'banned');
      if (!list.length) return;
      // Full fetch for the cursor account, unread-only for the rest.
      const focus = list[cursor % list.length];
      cursor++;
      if (focus) await fetchAccount(focus, 'all');
      for (const a of list) {
        if (cancelled) return;
        if (a.id === focus?.id) continue;
        try {
          await window.api.session.prepareForAccount({ accountId: a.id });
          const r = await window.api.inbox.fetch({ token, accountId: a.id, folder: 'unread' });
          if (r.ok) setUnreadByAccount((m) => ({ ...m, [a.id]: (r.messages || []).length }));
        } catch {}
      }
    };

    tick();
    const id = setInterval(tick, 60000);
    return () => { cancelled = true; clearInterval(id); };
  }, [token, user]);

  function refresh(accountId, folder = 'all') {
    const a = (accountsRef.current || []).find((x) => x.id === accountId);
    if (a) return fetchAccount(a, folder);
  }

  // Patch a single account's messages from the page (e.g. optimistic reply
  // append) so the Inbox UI stays in sync without re-fetching.
  function patchMessages(accountId, updater) {
    setByAccount((m) => {
      const cur = m[accountId]?.messages || [];
      const next = updater(cur);
      return { ...m, [accountId]: { messages: next, fetchedAt: m[accountId]?.fetchedAt || Date.now() } };
    });
  }

  return (
    <InboxLiveCtx.Provider value={{ byAccount, unreadByAccount, loading, refresh, patchMessages }}>
      {children}
    </InboxLiveCtx.Provider>
  );
}

export function useInboxLive() { return useContext(InboxLiveCtx); }
