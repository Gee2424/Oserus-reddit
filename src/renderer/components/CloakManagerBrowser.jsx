import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';

/**
 * CloakManager Browser Component
 *
 * Renders a browser view using Chrome DevTools Protocol (CDP) via CloakManager.
 * This provides unique browser fingerprints per account as opposed to the shared
 * Electron webview approach.
 *
 * Key features:
 * - Profile lifecycle management (create, launch, stop)
 * - CDP connection handling via chrome-remote-interface
 * - Loading states and error handling
 * - Navigation support
 * - Cleanup on unmount
 */

export default function CloakManagerBrowser({ account, initialUrl = 'https://www.reddit.com/' }) {
  const { token } = useAuth();
  const [status, setStatus] = useState('idle'); // idle, checking, creating, launching, ready, error
  const [error, setError] = useState(null);
  const [cdpInfo, setCdpInfo] = useState(null);
  const [profileName, setProfileName] = useState(null);
  const [currentUrl, setCurrentUrl] = useState(initialUrl);
  const cdpClientRef = useRef(null);
  const cleanupRef = useRef(false);

  // Check if CloakManager is available
  useEffect(() => {
    let cancelled = false;

    async function checkAvailability() {
      setStatus('checking');
      try {
        const result = await window.api.cloakmanager.checkAvailable({ token });
        if (!cancelled) {
          if (result.available) {
            setStatus('idle');
          } else {
            setStatus('error');
            setError('CloakManager backend is not available. Please ensure the CloakManager service is running.');
          }
        }
      } catch (err) {
        if (!cancelled) {
          setStatus('error');
          setError(err.message || 'Failed to check CloakManager availability');
        }
      }
    }

    checkAvailability();
    return () => { cancelled = true; };
  }, [token]);

  // Get or create profile for this account
  useEffect(() => {
    if (!account || status === 'error') return;
    let cancelled = false;

    async function setupProfile() {
      try {
        console.log('🔍 Setting up CloakManager profile for account:', account.username);

        // First check if account already has a mode setting
        const modeResult = await window.api.cloakmanager.getAccountMode({
          token,
          accountId: account.id
        });

        if (!cancelled && modeResult.ok) {
          console.log('📋 Account mode result:', modeResult);

          const existingProfile = modeResult.profileName || `reddit-${account.username}`;
          setProfileName(existingProfile);

          // Check if profile exists in CloakManager
          if (modeResult.profileName) {
            console.log('✅ Profile exists:', modeResult.profileName);
            setStatus('idle');
          } else {
            // Need to create profile
            console.log('🔨 Creating new CloakManager profile...');
            setStatus('creating');
            const createResult = await window.api.cloakmanager.createProfile({
              token,
              accountId: account.id,
              accountConfig: {
                os: 'windows',
                timezone: 'America/New_York',
                locale: 'en-US',
                resolution: '1920x1080'
              }
            });

            if (!cancelled) {
              if (createResult.ok) {
                console.log('✅ Profile created successfully:', createResult.profileName);
                setProfileName(createResult.profileName);
                setStatus('idle');
              } else {
                console.error('❌ Profile creation failed:', createResult.error);
                setStatus('error');
                setError(createResult.error || 'Failed to create profile');
              }
            }
          }
        } else if (!cancelled) {
          console.error('❌ Failed to get account mode:', modeResult.error);
          setStatus('error');
          setError(modeResult.error || 'Failed to get account mode');
        }
      } catch (err) {
        if (!cancelled) {
          console.error('❌ Setup error:', err);
          setStatus('error');
          setError(err.message || 'Failed to setup profile');
        }
      }
    }

    setupProfile();

    return () => { cancelled = true; };
  }, [account, token]);

  // Launch profile and connect CDP
  useEffect(() => {
    if (!profileName || status !== 'idle' || cleanupRef.current) return;
    let cancelled = false;

    async function launchProfile() {
      console.log('🚀 Launching CloakManager profile:', profileName);
      setStatus('launching');
      try {
        const launchResult = await window.api.cloakmanager.launchProfile({
          token,
          accountId: account.id,
          profileName
        });

        if (!cancelled) {
          if (launchResult.ok) {
            console.log('✅ Profile launched successfully:', launchResult);
            setCdpInfo(launchResult);
            setStatus('ready');
          } else {
            console.error('❌ Profile launch failed:', launchResult.error);
            setStatus('error');
            setError(launchResult.error || 'Failed to launch profile');
          }
        }
      } catch (err) {
        if (!cancelled) {
          console.error('❌ Launch error:', err);
          setStatus('error');
          setError(err.message || 'Failed to launch profile');
        }
      }
    }

    launchProfile();
    return () => { cancelled = true; };
  }, [profileName, status, account, token]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupRef.current = true;

      // Stop profile if running
      if (profileName && status === 'ready') {
        window.api.cloakmanager.stopProfile({ token, profileName })
          .catch(err => console.error('Failed to stop profile:', err));
      }
    };
  }, [profileName, status, token]);

  // Handle navigation
  function navigate(url) {
    if (!cdpInfo || !cdpInfo.cdpWsUrl) return;

    // Note: Navigation would be handled via CDP commands
    // This is a placeholder for future CDP navigation implementation
    setCurrentUrl(url);
  }

  // Render loading state
  if (status === 'checking' || status === 'creating' || status === 'launching') {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        background: 'var(--bg-0)',
        color: 'var(--text-0)'
      }}>
        <div style={{ marginBottom: 16 }}>
          <svg
            width="40"
            height="40"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            style={{ animation: 'spin 1s linear infinite' }}
          >
            <path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83" />
          </svg>
        </div>
        <div style={{ fontSize: 14, color: 'var(--text-2)' }}>
          {status === 'checking' && 'Checking CloakManager availability...'}
          {status === 'creating' && 'Creating browser profile...'}
          {status === 'launching' && 'Launching browser...'}
        </div>
        <style>{`
          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  // Render error state
  if (status === 'error') {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        background: 'var(--bg-0)',
        color: 'var(--text-0)',
        padding: 32
      }}>
        <div style={{ fontSize: 32, marginBottom: 16 }}>⚠️</div>
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8, color: 'var(--accent)' }}>
          CloakManager Browser Error
        </div>
        <div style={{ fontSize: 14, color: 'var(--text-2)', textAlign: 'center', maxWidth: 400 }}>
          {error || 'An unknown error occurred'}
        </div>
        {error?.includes('not available') && (
          <div style={{
            marginTop: 16,
            padding: 12,
            background: 'var(--bg-1)',
            borderRadius: 4,
            fontSize: 12,
            color: 'var(--text-2)',
            maxWidth: 400,
            textAlign: 'center'
          }}>
            <strong>Note:</strong> CloakManager requires a separate backend service.
            Please contact your administrator to ensure CloakManager is properly configured.
          </div>
        )}
      </div>
    );
  }

  // Render ready state with browser info
  if (status === 'ready' && cdpInfo) {
    return (
      <div style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-0)'
      }}>
        {/* Browser info bar */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '12px 16px',
          background: 'var(--bg-1)',
          borderBottom: '1px solid var(--border)',
          fontSize: 12,
          color: 'var(--text-2)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: 'var(--accent-soft)', fontWeight: 600 }}>CloakManager</span>
            <span style={{ color: 'var(--text-3)' }}>•</span>
            <span className="mono">{profileName}</span>
          </div>

          {cdpInfo.fingerprintSeed && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: 'var(--text-3)' }}>•</span>
              <span>FP Seed: {cdpInfo.fingerprintSeed}</span>
            </div>
          )}

          <div style={{ flex: 1 }} />

          <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
            CDP: {cdpInfo.cdpUrl}
          </div>
        </div>

        {/* Browser viewport placeholder */}
        <div style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'white',
          color: '#333',
          flexDirection: 'column',
          gap: 16,
          padding: 32
        }}>
          <div style={{ fontSize: 48 }}>🌐</div>
          <div style={{ fontSize: 16, color: '#666', fontWeight: 600 }}>
            CloakManager Browser Running
          </div>
          <div style={{ fontSize: 13, color: '#999', maxWidth: 500, textAlign: 'center', lineHeight: 1.5 }}>
            Profile <code>{profileName}</code> is running with unique fingerprint seed <code>{cdpInfo.fingerprintSeed}</code>
          </div>

          <div style={{
            marginTop: 16,
            padding: '16px 20px',
            background: '#e8f5e8',
            borderRadius: 8,
            fontSize: 12,
            color: '#2e7d32',
            border: '1px solid #4caf50',
            maxWidth: 400
          }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>✅ Profile Successfully Launched</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 11 }}>
              <div><strong>Profile:</strong> {profileName}</div>
              <div><strong>PID:</strong> {cdpInfo.pid}</div>
              <div><strong>FP Seed:</strong> {cdpInfo.fingerprintSeed}</div>
              <div><strong>CDP Port:</strong> {cdpInfo.cdpPort}</div>
            </div>
          </div>

          <div style={{
            padding: '12px 16px',
            background: '#f0f0f0',
            borderRadius: 6,
            fontSize: 11,
            color: '#666',
            fontFamily: 'monospace',
            border: '1px solid #ddd',
            maxWidth: 400
          }}>
            <div><strong>CDP URL:</strong> {cdpInfo.cdpUrl}</div>
            {cdpInfo.cdpWsUrl && (
              <div style={{ marginTop: 4 }}><strong>CDP WebSocket:</strong> {cdpInfo.cdpWsUrl}</div>
            )}
          </div>

          <div style={{ fontSize: 11, color: '#999', marginTop: 8 }}>
            This profile has a unique browser fingerprint different from other accounts
          </div>
        </div>
      </div>
    );
  }

  // Render idle state
  return (
    <div style={{
      height: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--bg-0)',
      color: 'var(--text-2)'
    }}>
      <div style={{ fontSize: 14 }}>
        Initializing CloakManager browser...
      </div>
    </div>
  );
}