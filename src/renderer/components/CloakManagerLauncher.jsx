import React, { useEffect, useState, useRef } from 'react';
import { useAuth } from '../lib/auth.jsx';

/**
 * CloakManager Launcher Component
 *
 * Launches headed Chrome browsers with unique fingerprints via CloakManager.
 * Uses WebSocket events for real-time state tracking and proper error handling.
 *
 * Features:
 * - Checks CloakManager backend availability before launching
 * - Creates unique profile per account (if not exists)
 * - Launches headed browser window (visible to user)
 * - Uses WebSocket events for real-time launch progress
 * - Handles profile state gracefully (already running, stopped, crashed)
 * - No aggressive retry loops - single launch attempt per account change
 *
 * @param {Object} account - Reddit account object
 * @param {string} initialUrl - Initial URL to navigate to (default: reddit.com)
 */
export default function CloakManagerLauncher({ account, initialUrl = 'https://www.reddit.com/' }) {
  const { token } = useAuth();
  const [status, setStatus] = useState('idle'); // idle, checking, launching, launched, error
  const [error, setError] = useState(null);
  const [profileName, setProfileName] = useState(null);
  const [launchProgress, setLaunchProgress] = useState(null);
  const [backendAvailable, setBackendAvailable] = useState(null);

  // Use ref to track current profileName for event listeners
  const profileNameRef = useRef(null);

  // Keep ref in sync with state
  useEffect(() => {
    profileNameRef.current = profileName;
  }, [profileName]);

  useEffect(() => {
    if (!account) return;

    let cancelled = false;

    async function launch() {
      try {
        console.log('🚀 Starting CloakManager launch sequence for account:', account.username);
        setStatus('checking');
        setLaunchProgress({ stage: 'checking', message: 'Checking CloakManager backend...' });
        setError(null);

        // Validate account object
        if (!account || !account.id) {
          throw new Error('Invalid account object: missing id');
        }

        // Step 1: Check if CloakManager backend is available
        console.log('📞 Checking CloakManager availability...');
        const availabilityResult = await window.api.cloakmanager.checkAvailable({ token });
        console.log('📞 Availability result:', availabilityResult);

        if (!cancelled) {
          if (!availabilityResult.ok || !availabilityResult.available) {
            setBackendAvailable(false);
            throw new Error('CloakManager backend is not available. Please ensure CloakManager is running.');
          }
          setBackendAvailable(true);
          console.log('✅ CloakManager backend is available');
        }

        // Step 2: Check if account has existing CloakManager profile
        console.log('📞 Getting account mode for accountId:', account.id);
        const modeResult = await window.api.cloakmanager.getAccountMode({
          token,
          accountId: account.id
        });
        console.log('📞 Account mode result:', modeResult);

        if (!cancelled) {
          if (!modeResult.ok) {
            throw new Error(modeResult.error || 'Failed to get account mode');
          }

          // Step 3: Determine profile name
          const profile = modeResult.profileName || `reddit-${account.username}`;
          console.log('📋 Profile name:', profile);
          setProfileName(profile);

          // Step 4: Create profile if it doesn't exist
          if (!modeResult.profileName && modeResult.mode === 'cloakmanager') {
            console.log('🔨 Creating new CloakManager profile:', profile);
            setLaunchProgress({ stage: 'creating', message: 'Creating browser profile...' });

            const createResult = await window.api.cloakmanager.createProfile({
              token,
              accountId: account.id,
              accountConfig: { headless: false }
            });

            if (!cancelled) {
              if (!createResult.ok) {
                throw new Error(createResult.error || 'Failed to create profile');
              }
              console.log('✅ Profile created:', createResult.profileName);
              setProfileName(createResult.profileName);
            }
          } else {
            console.log('⏭️ Profile already exists:', profile);
          }

          // Step 5: Launch the profile (single attempt only - no retry loop)
          if (!cancelled) {
            console.log('🌐 Launching CloakManager profile:', profile);
            setStatus('launching');
            setLaunchProgress({ stage: 'launching', message: 'Starting browser with unique fingerprint...' });

            const launchResult = await window.api.cloakmanager.launchProfile({
              token,
              accountId: account.id,
              profileName: profile
            });

            console.log('🌐 Launch result:', launchResult);

            if (!cancelled) {
              if (!launchResult.ok) {
                // Handle different error types
                if (launchResult.error?.includes('not available')) {
                  throw new Error('CloakManager backend is not available. Please ensure CloakManager is running.');
                } else if (launchResult.error?.includes('already running')) {
                  // This is OK - profile is already running
                  console.log('ℹ️ Profile already running, will connect via WebSocket events');
                  setLaunchProgress({ stage: 'connecting', message: 'Connecting to existing browser session...' });
                  setStatus('launched');
                  return;
                } else {
                  throw new Error(launchResult.error || 'Failed to launch profile');
                }
              }

              console.log('✅ Launch initiated successfully');
              setLaunchProgress({ stage: 'launched', message: 'Browser launched successfully!' });

              // Handle already-running case
              if (launchResult.alreadyRunning) {
                console.log('ℹ️ Profile was already running');
                setLaunchProgress({ stage: 'connected', message: 'Connected to existing browser session' });
              }

              setStatus('launched');
            }
          }
        }
      } catch (err) {
        if (!cancelled) {
          console.error('❌ Launch failed:', err);
          console.error('❌ Error details:', {
            message: err.message,
            name: err.name
          });

          setStatus('error');
          setError(err.message || 'Failed to launch browser');
          setLaunchProgress({
            stage: 'error',
            message: `Launch failed: ${err.message || 'Unknown error'}`
          });
        } else {
          console.log('🛌 Launch cancelled');
        }
      }
    }

    launch();

    // WebSocket event listeners for real-time updates
    const cleanupProfileLaunched = window.api.cloakmanager.onProfileLaunched((data) => {
      console.log('📡 WebSocket: Profile launched event received for', data.profile);
      if (data.profile === profileNameRef.current) {
        setStatus('launched');
        setLaunchProgress({ stage: 'launched', message: 'Browser launched successfully!' });
      }
    });

    const cleanupProfileStopped = window.api.cloakmanager.onProfileStopped((data) => {
      console.log('📡 WebSocket: Profile stopped event received for', data.profile);
      if (data.profile === profileNameRef.current) {
        setStatus('idle');
        setLaunchProgress(null);
        setError('Profile was stopped');
      }
    });

    const cleanupWindowClosed = window.api.cloakmanager.onWindowClosed((data) => {
      console.log('📡 WebSocket: Window closed event received for', data.profile);
      if (data.profile === profileNameRef.current) {
        setStatus('idle');
        setLaunchProgress(null);
        setError(null);
      }
    });

    const cleanupBrowserCrashed = window.api.cloakmanager.onBrowserCrashed((data) => {
      console.log('📡 WebSocket: Browser crashed event received for', data.profile);
      if (data.profile === profileNameRef.current) {
        setStatus('error');
        setError('Browser crashed: ' + (data.data?.error || 'Unknown error'));
        setLaunchProgress({ stage: 'error', message: 'Browser crashed unexpectedly' });
      }
    });

    const cleanupLaunchProgress = window.api.cloakmanager.onLaunchProgress((data) => {
      console.log('📡 WebSocket: Launch progress for', data.profile, ':', data.stage, data.message);
      if (data.profile === profileNameRef.current) {
        setLaunchProgress({ stage: data.stage, message: data.message });
      }
    });

    const cleanupWSConnected = window.api.cloakmanager.onWSConnected(() => {
      console.log('📡 WebSocket: Connected to CloakManager');
      setBackendAvailable(true);
    });

    const cleanupWSDisconnected = window.api.cloakmanager.onWSDisconnected(() => {
      console.log('📡 WebSocket: Disconnected from CloakManager');
      // Don't change status based on WebSocket disconnection - could be temporary
    });

    const cleanupWSFallback = window.api.cloakmanager.onWSFallback(() => {
      console.log('📡 WebSocket: Falling back to HTTP polling');
    });

    return () => {
      cancelled = true;
      console.log('🧹 Cleaning up CloakManagerLauncher effect');
      cleanupProfileLaunched();
      cleanupProfileStopped();
      cleanupWindowClosed();
      cleanupBrowserCrashed();
      cleanupLaunchProgress();
      cleanupWSConnected();
      cleanupWSDisconnected();
      cleanupWSFallback();
    };
  }, [account, token]); // Only re-run when account or token changes (NOT profileName!)

  // Styles
  const containerStyle = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    background: 'var(--bg-0)',
    color: 'var(--text-0)',
    padding: 32,
    textAlign: 'center'
  };

  const iconStyle = {
    fontSize: 48,
    marginBottom: 16
  };

  const titleStyle = {
    fontSize: 18,
    fontWeight: 600,
    marginBottom: 12,
    color: 'var(--text-0)'
  };

  const messageStyle = {
    fontSize: 14,
    color: 'var(--text-2)',
    marginBottom: 8,
    maxWidth: 400
  };

  const hintStyle = {
    fontSize: 12,
    color: 'var(--text-3)',
    marginTop: 16,
    padding: '12px 16px',
    background: 'var(--bg-1)',
    borderRadius: 6,
    border: '1px solid var(--border)',
    maxWidth: 400
  };

  const successStyle = {
    fontSize: 13,
    color: 'var(--accent-soft)',
    marginTop: 12,
    padding: '12px 16px',
    background: 'rgba(26, 147, 108, 0.1)',
    borderRadius: 6,
    border: '1px solid var(--accent-soft)',
    maxWidth: 400
  };

  const warningStyle = {
    fontSize: 12,
    padding: '12px 16px',
    background: 'rgba(255, 193, 7, 0.1)',
    borderRadius: 6,
    border: '1px solid #ffc107',
    color: '#ffc107',
    marginTop: 12,
    maxWidth: 400
  };

  // Render states
  if (status === 'idle') {
    return (
      <div style={containerStyle}>
        <div style={iconStyle}>🔄</div>
        <div style={titleStyle}>Ready to Launch</div>
        <div style={messageStyle}>
          Click play to start browser with unique fingerprint
        </div>
      </div>
    );
  }

  if (status === 'checking') {
    return (
      <div style={containerStyle}>
        <div style={iconStyle}>🔍</div>
        <div style={titleStyle}>Checking Backend...</div>
        <div style={messageStyle}>
          {launchProgress?.message || 'Verifying CloakManager is available'}
        </div>
      </div>
    );
  }

  if (status === 'launching') {
    return (
      <div style={containerStyle}>
        <div style={iconStyle}>🚀</div>
        <div style={titleStyle}>Launching Browser...</div>
        <div style={messageStyle}>
          {launchProgress?.message || 'Starting browser with unique fingerprint'}
        </div>
        {launchProgress?.stage === 'creating' && (
          <div style={warningStyle}>
            ⏳ Creating new browser profile (this only happens once)
          </div>
        )}
        <div style={hintStyle}>
          This may take 10-15 seconds. A separate browser window will open.
        </div>
      </div>
    );
  }

  if (status === 'launched') {
    return (
      <div style={containerStyle}>
        <div style={iconStyle}>✅</div>
        <div style={titleStyle}>Browser Launched Successfully</div>
        <div style={messageStyle}>
          Profile <strong>{profileName}</strong> is running with unique fingerprint
        </div>
        {launchProgress && (
          <div style={{...messageStyle, color: 'var(--accent-soft)'}}>
            {launchProgress.message}
          </div>
        )}
        <div style={successStyle}>
          ✓ Browser window opened separately<br/>
          ✓ Check your taskbar/dock for the browser window<br/>
          ✓ Unique fingerprint assigned to this account
        </div>
        <div style={hintStyle}>
          <strong>Note:</strong> The browser window is separate from this app.
          You can interact with it directly. This window will stay here to show status.
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div style={containerStyle}>
        <div style={iconStyle}>❌</div>
        <div style={titleStyle}>Launch Failed</div>
        <div style={messageStyle}>
          {error || 'Unable to launch browser'}
        </div>
        {launchProgress && (
          <div style={{...messageStyle, fontSize: 12, marginTop: 8}}>
            Stage: {launchProgress.stage}
          </div>
        )}
        {error?.includes('not available') && (
          <div style={warningStyle}>
            <strong>⚠️ CloakManager Backend Not Running</strong><br/>
            The CloakManager backend service is not available.<br/>
            Please ensure it's running and try again.
          </div>
        )}
        {error?.includes('already running') && (
          <div style={warningStyle}>
            <strong>ℹ️ Profile Already Running</strong><br/>
            This profile is already active. Check your taskbar for the browser window.
          </div>
        )}
      </div>
    );
  }

  return null;
}
