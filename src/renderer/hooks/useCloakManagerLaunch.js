import { useState, useEffect, useCallback, useSyncExternalStore } from 'react';

/**
 * Custom hook for CloakManager WebSocket event handling and launch state management.
 *
 * Module-level state persists across component mounts/unmounts so WebSocket
 * events are never lost when routes change or React re-renders the tree.
 *
 * Uses useSyncExternalStore to properly integrate external (WebSocket-driven)
 * state with React's render cycle. The cached snapshot prevents infinite
 * re-renders by returning the same object reference unless state changed.
 */

// Module-level cached snapshot — replaced only on state change
let _storeSnapshot = {
  cloakStatus: {},
  launchProgress: {},   // per profile — CloakManager's own launch_progress events
  cdpProgress: {},      // per profile — our orchestrator state machine (cdp:progress)
  attention: {},        // per accountId — { code, reason, at }
  runningProfiles: new Set(),
  isAvailable: null,
  wsConnected: false,
};
const _listeners = new Set(); // onStoreChange callbacks

function _updateSnapshot(partial) {
  _storeSnapshot = { ..._storeSnapshot, ...partial };
  for (const fn of _listeners) fn();
}

// One-time WebSocket subscription — never cleaned up while the app is open
let _wsInitDone = false;
function _ensureWS() {
  if (_wsInitDone) return;
  _wsInitDone = true;

  window.api.cloakmanager.onProfileLaunched((data) => {
    if (data && data.profile) {
      const nextProfiles = new Set(_storeSnapshot.runningProfiles);
      nextProfiles.add(data.profile);
      _updateSnapshot({
        cloakStatus: { ..._storeSnapshot.cloakStatus, [data.profile]: 'running' },
        launchProgress: { ..._storeSnapshot.launchProgress, [data.profile]: null },
        runningProfiles: nextProfiles,
      });
    }
  });

  window.api.cloakmanager.onProfileStopped((data) => {
    if (data && data.profile) {
      const nextProfiles = new Set(_storeSnapshot.runningProfiles);
      nextProfiles.delete(data.profile);
      _updateSnapshot({
        cloakStatus: { ..._storeSnapshot.cloakStatus, [data.profile]: 'stopped' },
        runningProfiles: nextProfiles,
      });
    }
  });

  window.api.cloakmanager.onBrowserCrashed((data) => {
    if (data && data.profile) {
      _updateSnapshot({
        launchProgress: { ..._storeSnapshot.launchProgress, [data.profile]: null },
        cloakStatus: { ..._storeSnapshot.cloakStatus, [data.profile]: 'error' },
      });
    }
  });

  window.api.cloakmanager.onLaunchProgress((data) => {
    if (data && data.profile) {
      _updateSnapshot({
        launchProgress: {
          ..._storeSnapshot.launchProgress,
          [data.profile]: {
            progress: data.data?.percent ? data.data.percent / 100 : (data.progress || 0),
            stage: data.stage || 'launching',
            message: data.message || '',
            at: Date.now(),
          }
        }
      });
    }
  });

  window.api.cloakmanager.onWSConnected(() => {
    _updateSnapshot({ wsConnected: true });
  });

  window.api.cloakmanager.onWSDisconnected(() => {
    _updateSnapshot({ wsConnected: false });
  });

  // Our orchestrator's launch state machine: { profile, accountId, stage, ok, reason, message }
  window.api.cloakmanager.onCDPProgress?.((data) => {
    if (!data || !data.profile) return;
    _updateSnapshot({
      cdpProgress: {
        ..._storeSnapshot.cdpProgress,
        [data.profile]: {
          stage: data.stage, ok: data.ok !== false,
          reason: data.reason || null, message: data.message || '',
          accountId: data.accountId ?? null, at: Date.now(),
        },
      },
      ...(data.stage === 'ready' || data.stage === 'failed'
        ? { cloakStatus: { ..._storeSnapshot.cloakStatus, [data.profile]: data.stage === 'ready' ? 'running' : 'error' } }
        : {}),
    });
  });

  // An account flagged needs_attention by a hard CM login/task failure.
  window.api.accounts?.onNeedsAttention?.((data) => {
    if (!data || !data.accountId) return;
    _updateSnapshot({
      attention: {
        ..._storeSnapshot.attention,
        [data.accountId]: { code: data.code, reason: data.reason, at: Date.now() },
      },
    });
  });
}

export function useCloakManagerLaunch() {
  _ensureWS();

  const state = useSyncExternalStore(
    (onStoreChange) => {
      _listeners.add(onStoreChange);
      return () => { _listeners.delete(onStoreChange); };
    },
    () => _storeSnapshot
  );

  const { cloakStatus, launchProgress, cdpProgress, attention, runningProfiles, isAvailable, wsConnected } = state;

  const checkAvailability = useCallback(async (token) => {
    try {
      const res = await window.api.cloakmanager.checkAvailable({ token });
      _updateSnapshot({ isAvailable: res.available });
      return res.available;
    } catch (err) {
      _updateSnapshot({ isAvailable: false });
      return false;
    }
  }, []);

  const isAccountRunning = useCallback((profileName) => {
    return state.runningProfiles.has(profileName) && state.cloakStatus[profileName] === 'running';
  }, [state]);

  const getAccountProgress = useCallback((profileName) => {
    return state.launchProgress[profileName] || null;
  }, [state]);

  const getAccountStatus = useCallback((profileName) => {
    return state.cloakStatus[profileName] || null;
  }, [state]);

  // Combined launch phase for a profile. Whichever signal updated most
  // recently wins — NOT a blanket "our orchestrator always wins" rule.
  // Our orchestrator sets one cdp:progress phase ('launching') right before
  // the launchProfile() HTTP call and doesn't touch it again until that
  // call resolves — which, on a first-ever launch, can be minutes later
  // while CloakManager silently downloads ~550MB of CloakBrowser first. If
  // cdp:progress always won, that stale "Starting browser…" message would
  // sit on screen for the whole download, completely hiding CloakManager's
  // own live launch_progress events (stage: 'downloading_browser', with a
  // real percent) that arrive over the same window. Comparing timestamps
  // lets the more specific, actively-updating signal surface instead.
  const getLaunchPhase = useCallback((profileName) => {
    const cdp = state.cdpProgress[profileName];
    const lp = state.launchProgress[profileName];
    if (cdp && lp) {
      return (lp.at || 0) > (cdp.at || 0)
        ? { stage: lp.stage || 'launching', ok: true, message: lp.message || '', progress: lp.progress }
        : cdp;
    }
    if (cdp) return cdp; // { stage, ok, reason, message }
    if (lp) return { stage: lp.stage || 'launching', ok: true, message: lp.message || '', progress: lp.progress };
    return null;
  }, [state]);

  const getAttention = useCallback((accountId) => state.attention[accountId] || null, [state]);
  const clearAttentionLocal = useCallback((accountId) => {
    if (!state.attention[accountId]) return;
    const next = { ...state.attention };
    delete next[accountId];
    _updateSnapshot({ attention: next });
  }, [state]);

  return {
    isAvailable,
    checkAvailability,
    wsConnected,
    cloakStatus,
    launchProgress,
    cdpProgress,
    attention,
    runningProfiles,
    isAccountRunning,
    getAccountProgress,
    getAccountStatus,
    getLaunchPhase,
    getAttention,
    clearAttentionLocal,
  };
}
