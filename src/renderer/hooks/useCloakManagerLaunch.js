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
  launchProgress: {},
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
            message: data.message || ''
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

  const { cloakStatus, launchProgress, runningProfiles, isAvailable, wsConnected } = state;

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

  return {
    isAvailable,
    checkAvailability,
    wsConnected,
    cloakStatus,
    launchProgress,
    runningProfiles,
    isAccountRunning,
    getAccountProgress,
    getAccountStatus
  };
}
