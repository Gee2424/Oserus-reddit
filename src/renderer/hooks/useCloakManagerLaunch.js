import { useState, useEffect, useCallback } from 'react';

/**
 * Custom hook for CloakManager WebSocket event handling and launch state management.
 * Provides consistent WebSocket integration across all components that handle profile launching.
 *
 * Features:
 * - WebSocket event subscriptions (profile_launched, profile_stopped, browser_crashed, etc.)
 * - Launch progress tracking with percentage updates
 * - Running profile status management
 * - CloakManager availability checking
 * - WebSocket connection status monitoring
 *
 * @returns {Object} Hook state and helper functions
 */
export function useCloakManagerLaunch() {
  const [cloakStatus, setCloakStatus] = useState({}); // { accountId: 'running' | 'stopped' | 'error' }
  const [launchProgress, setLaunchProgress] = useState({}); // { accountId: { progress: 0.5, stage: 'launching', message: '' } }
  const [runningProfiles, setRunningProfiles] = useState(new Set());
  const [isAvailable, setIsAvailable] = useState(null);
  const [wsConnected, setWsConnected] = useState(false);

  /**
   * Check if CloakManager backend is available
   * @param {string} token - User authentication token
   * @returns {Promise<boolean>} true if CloakManager is available
   */
  const checkAvailability = useCallback(async (token) => {
    try {
      const res = await window.api.cloakmanager.checkAvailable({ token });
      setIsAvailable(res.available);
      console.log('[useCloakManagerLaunch] CloakManager availability:', res.available);
      return res.available;
    } catch (err) {
      console.error('[useCloakManagerLaunch] Availability check failed:', err);
      setIsAvailable(false);
      return false;
    }
  }, []);

  /**
   * Setup WebSocket event listeners for CloakManager events
   * Handles: profile_launched, profile_stopped, browser_crashed, launch_progress, ws_connected, ws_disconnected
   */
  useEffect(() => {
    console.log('[useCloakManagerLaunch] Setting up WebSocket listeners');
    const unsubscribers = [];

    // Profile launched event
    unsubscribers.push(
      window.api.cloakmanager.onProfileLaunched((data) => {
        console.log('[useCloakManagerLaunch] Profile launched:', data);
        if (data && data.profile) {
          // Store by profile name since that's what CloakManager sends
          // We'll map this to accountId later when needed
          setRunningProfiles(prev => new Set([...prev, data.profile]));
          setCloakStatus(prev => ({ ...prev, [data.profile]: 'running' }));
          setLaunchProgress(prev => ({ ...prev, [data.profile]: null }));
        }
      })
    );

    // Profile stopped event
    unsubscribers.push(
      window.api.cloakmanager.onProfileStopped((data) => {
        console.log('[useCloakManagerLaunch] Profile stopped:', data);
        if (data && data.profile) {
          setRunningProfiles(prev => {
            const next = new Set(prev);
            next.delete(data.profile);
            return next;
          });
          setCloakStatus(prev => ({ ...prev, [data.profile]: 'stopped' }));
        }
      })
    );

    // Browser crashed event
    unsubscribers.push(
      window.api.cloakmanager.onBrowserCrashed((data) => {
        console.log('[useCloakManagerLaunch] Browser crashed:', data);
        if (data && data.profile) {
          setLaunchProgress(prev => ({ ...prev, [data.profile]: null }));
          setCloakStatus(prev => ({ ...prev, [data.profile]: 'error' }));
        }
      })
    );

    // Launch progress event
    unsubscribers.push(
      window.api.cloakmanager.onLaunchProgress((data) => {
        console.log('[useCloakManagerLaunch] Launch progress:', data);
        if (data && data.profile) {
          setLaunchProgress(prev => ({
            ...prev,
            [data.profile]: {
              progress: data.data?.percent ? data.data.percent / 100 : (data.progress || 0),
              stage: data.stage || 'launching',
              message: data.message || ''
            }
          }));
        }
      })
    );

    // WebSocket connection established
    unsubscribers.push(
      window.api.cloakmanager.onWSConnected(() => {
        console.log('[useCloakManagerLaunch] WebSocket connected');
        setWsConnected(true);
      })
    );

    // WebSocket connection lost
    unsubscribers.push(
      window.api.cloakmanager.onWSDisconnected(() => {
        console.log('[useCloakManagerLaunch] WebSocket disconnected');
        setWsConnected(false);
      })
    );

    // Cleanup: unsubscribe from all events
    return () => {
      console.log('[useCloakManagerLaunch] Cleaning up WebSocket listeners');
      unsubscribers.forEach(unsub => unsub());
    };
  }, []);

  /**
   * Check if an account is currently running
   * @param {string} profileName - Profile name to check
   * @returns {boolean} true if profile is running
   */
  const isAccountRunning = useCallback((profileName) => {
    return runningProfiles.has(profileName) && cloakStatus[profileName] === 'running';
  }, [runningProfiles, cloakStatus]);

  /**
   * Get launch progress for an account
   * @param {string} profileName - Profile name to get progress for
   * @returns {Object|null} Progress object { progress, stage, message } or null
   */
  const getAccountProgress = useCallback((profileName) => {
    return launchProgress[profileName] || null;
  }, [launchProgress]);

  /**
   * Get status for an account
   * @param {string} profileName - Profile name to get status for
   * @returns {string|null} Status string ('running' | 'stopped' | 'error') or null
   */
  const getAccountStatus = useCallback((profileName) => {
    return cloakStatus[profileName] || null;
  }, [cloakStatus]);

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
