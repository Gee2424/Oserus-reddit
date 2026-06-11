import { useEffect } from 'react';

// Bridge cloud:dataChanged IPC → window CustomEvent. Mount once at app
// root so every page can opt in via useCloudReload(tables, fn) without
// each one re-subscribing to the preload bridge.
//
// Event name: 'oserus:data'  detail: { table, eventType, id }

export function installCloudReloadBridge() {
  if (typeof window === 'undefined') return;
  if (window.__oserusCloudBridgeInstalled) return;
  window.__oserusCloudBridgeInstalled = true;
  try {
    window.api?.cloud?.onDataChanged?.((payload) => {
      try {
        window.dispatchEvent(new CustomEvent('oserus:data', { detail: payload }));
      } catch {}
    });
  } catch {}
}

// useCloudReload(['model_profiles', 'reddit_accounts'], () => refetch())
// Calls fn whenever the cloud bridge says one of those tables changed.
// Pass [] to fire on every table change.
export function useCloudReload(tables, fn) {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const wanted = Array.isArray(tables) ? new Set(tables) : null;
    const handler = (e) => {
      const t = e?.detail?.table;
      if (wanted && wanted.size && !wanted.has(t)) return;
      try { fn(e.detail); } catch {}
    };
    window.addEventListener('oserus:data', handler);
    return () => window.removeEventListener('oserus:data', handler);
  }, [Array.isArray(tables) ? tables.join('|') : '', fn]);
}
