import React, { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';

/**
 * CloakManager Status Display Component
 *
 * Shows comprehensive status of CloakManager binary and backend:
 * - Binary state: not downloaded / downloading / downloaded / corrupted
 * - Backend state: not running / starting / running / connected / error
 * - Download progress with percentage
 * - Connection health
 * - Port information
 * - Error messages with actions
 *
 * Admin-only in production. Shows manual config option in dev mode only.
 */

export default function CloakManagerStatus() {
  const { token, user } = useAuth();
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [initState, setInitState] = useState(null);
  const [progress, setProgress] = useState(null);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);

  // Check if user is admin
  if (user?.role !== 'admin') {
    return (
      <div style={{
        padding: '20px 24px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg-0)'
      }}>
        <div style={{
          padding: '16px',
          background: 'var(--accent-soft)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          fontSize: 13,
          color: 'var(--text-2)',
          display: 'flex',
          alignItems: 'center',
          gap: 12
        }}>
          <span style={{ fontSize: 18 }}>🔒</span>
          <div>
            <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--text-0)' }}>
              CloakManager Status
            </div>
            <div style={{ fontSize: 12 }}>
              CloakManager management is restricted to administrators.
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Load status on mount and periodically
  useEffect(() => {
    let cancelled = false;

    async function loadStatus() {
      try {
        const result = await window.api.cloakmanager.getBinaryStatus({ token });
        if (!cancelled && result.ok) {
          setStatus(result.status);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to load CloakManager status:', err);
          setLoading(false);
        }
      }
    }

    loadStatus();

    // Poll every 2 seconds for status updates
    const interval = setInterval(loadStatus, 2000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [token]);

  // Listen for initialization failure
  useEffect(() => {
    const cleanup = window.api.cloakmanager.onInitFailed((data) => {
      setInitState({
        status: 'failed',
        error: data.error,
        actionableError: data.actionableError
      });
    });

    return () => cleanup();
  }, []);

  // Listen for download/spawn progress
  useEffect(() => {
    const cleanup = window.api.cloakmanager.onBinaryProgress((data) => {
      setProgress(data);

      if (data.stage === 'ready') {
        setStarting(false);
        // Reload status
        setTimeout(() => {
          window.api.cloakmanager.getBinaryStatus({ token }).then(result => {
            if (result.ok) setStatus(result.status);
          });
        }, 1000);
      }

      if (data.stage === 'error') {
        setStarting(false);
      }
    });

    return () => cleanup();
  }, [token]);

  // Handle manual start
  async function handleStart() {
    setStarting(true);
    setProgress(null);
    setInitState(null);

    try {
      const result = await window.api.cloakmanager.startBinary({ token });

      if (!result.ok) {
        setInitState({
          status: 'failed',
          error: result.error,
          actionableError: result.error
        });
        setStarting(false);
      }
    } catch (err) {
      setInitState({
        status: 'failed',
        error: err.message,
        actionableError: err.message
      });
      setStarting(false);
    }
  }

  // Handle manual stop
  async function handleStop() {
    setStopping(true);

    try {
      const result = await window.api.cloakmanager.stopBinary({ token });

      if (result.ok) {
        // Reload status
        setTimeout(() => {
          window.api.cloakmanager.getBinaryStatus({ token }).then(result => {
            if (result.ok) setStatus(result.status);
          });
        }, 500);
      }
    } catch (err) {
      console.error('Failed to stop binary:', err);
    } finally {
      setStopping(false);
    }
  }

  // Determine display state
  const getDisplayState = () => {
    if (initState?.status === 'failed') {
      return 'error';
    }

    if (progress) {
      return progress.stage === 'error' ? 'error' : 'progress';
    }

    if (starting) {
      return 'starting';
    }

    if (!status || loading) {
      return 'loading';
    }

    if (status.autoStartEnabled === false) {
      return 'dev_mode';
    }

    if (!status.binaryExists) {
      return 'not_downloaded';
    }

    if (!status.isRunning) {
      return 'not_running';
    }

    if (status.backendAvailable) {
      return 'ready';
    }

    return 'unhealthy';
  };

  const displayState = getDisplayState();

  // Render states
  const renderLoading = () => (
    <div style={{ padding: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{
        width: 8, height: 8, borderRadius: '50%',
        background: 'var(--gold)',
        boxShadow: '0 0 0 2px rgba(212,166,74,0.2)',
        animation: 'pulse 2s infinite'
      }} />
      <div style={{ fontSize: 13, color: 'var(--text-2)' }}>
        Checking CloakManager status...
      </div>
    </div>
  );

  const renderDevMode = () => (
    <div style={{ padding: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{
        width: 8, height: 8, borderRadius: '50%',
        background: 'var(--accent-soft)',
        boxShadow: '0 0 0 2px rgba(26,147,108,0.2)'
      }} />
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 500, fontSize: 13, color: 'var(--text-0)' }}>
          Development Mode
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
          CloakManager not auto-managed in dev mode. Configure manually in settings.
        </div>
      </div>
    </div>
  );

  const renderNotDownloaded = () => (
    <div style={{ padding: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{
        width: 8, height: 8, borderRadius: '50%',
        background: '#f59e0b',
        boxShadow: '0 0 0 2px rgba(245,158,11,0.2)'
      }} />
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 500, fontSize: 13, color: 'var(--text-0)' }}>
          CloakManager Not Installed
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
          CloakManager binary needs to be downloaded (one-time setup).
        </div>
      </div>
      <button
        onClick={handleStart}
        disabled={starting}
        style={{
          padding: '6px 12px',
          fontSize: 12,
          fontWeight: 500,
          background: 'var(--accent)',
          color: '#1a0d08',
          border: 'none',
          borderRadius: 4,
          cursor: starting ? 'not-allowed' : 'pointer',
          opacity: starting ? 0.6 : 1
        }}
      >
        {starting ? 'Starting...' : 'Download CloakManager'}
      </button>
    </div>
  );

  const renderProgress = () => (
    <div style={{ padding: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{
        width: 8, height: 8, borderRadius: '50%',
        background: 'var(--gold)',
        boxShadow: '0 0 0 2px rgba(212,166,74,0.2)',
        animation: 'pulse 2s infinite'
      }} />
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 500, fontSize: 13, color: 'var(--text-0)' }}>
          {progress?.message || 'Initializing...'}
        </div>
        {progress?.percent !== null && progress?.percent !== undefined && (
          <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 4 }}>
            {progress.percent}% complete
          </div>
        )}
      </div>
      <div style={{
        width: 24, height: 24,
        border: '2px solid var(--border)',
        borderTopColor: 'var(--accent)',
        borderRadius: '50%',
        animation: 'spin 1s linear infinite'
      }} />
    </div>
  );

  const renderReady = () => (
    <div style={{ padding: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{
        width: 8, height: 8, borderRadius: '50%',
        background: 'var(--accent)',
        boxShadow: '0 0 0 2px rgba(26,147,108,0.2)'
      }} />
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 500, fontSize: 13, color: 'var(--text-0)' }}>
          CloakManager Ready
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
          Running on port {status?.port} • Version {status?.currentVersion?.version || 'unknown'}
        </div>
      </div>
      <button
        onClick={handleStop}
        disabled={stopping}
        style={{
          padding: '6px 12px',
          fontSize: 12,
          background: 'var(--bg-0)',
          border: '1px solid var(--border)',
          borderRadius: 4,
          color: 'var(--text-2)',
          cursor: stopping ? 'not-allowed' : 'pointer',
          opacity: stopping ? 0.6 : 1
        }}
      >
        {stopping ? 'Stopping...' : 'Stop'}
      </button>
    </div>
  );

  const renderNotRunning = () => (
    <div style={{ padding: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{
        width: 8, height: 8, borderRadius: '50%',
        background: '#f59e0b',
        boxShadow: '0 0 0 2px rgba(245,158,11,0.2)'
      }} />
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 500, fontSize: 13, color: 'var(--text-0)' }}>
          CloakManager Not Running
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
          Binary is installed but service is not running.
        </div>
      </div>
      <button
        onClick={handleStart}
        disabled={starting}
        style={{
          padding: '6px 12px',
          fontSize: 12,
          fontWeight: 500,
          background: 'var(--accent)',
          color: '#1a0d08',
          border: 'none',
          borderRadius: 4,
          cursor: starting ? 'not-allowed' : 'pointer',
          opacity: starting ? 0.6 : 1
        }}
      >
        {starting ? 'Starting...' : 'Start CloakManager'}
      </button>
    </div>
  );

  const renderUnhealthy = () => (
    <div style={{ padding: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{
        width: 8, height: 8, borderRadius: '50%',
        background: '#ef4444',
        boxShadow: '0 0 0 2px rgba(239,68,68,0.2)'
      }} />
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 500, fontSize: 13, color: 'var(--text-0)' }}>
          CloakManager Unhealthy
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
          Service is running but not responding to health checks.
        </div>
      </div>
      <button
        onClick={handleStart}
        disabled={starting}
        style={{
          padding: '6px 12px',
          fontSize: 12,
          fontWeight: 500,
          background: 'var(--accent)',
          color: '#1a0d08',
          border: 'none',
          borderRadius: 4,
          cursor: starting ? 'not-allowed' : 'pointer',
          opacity: starting ? 0.6 : 1
        }}
      >
        {starting ? 'Restarting...' : 'Restart CloakManager'}
      </button>
    </div>
  );

  const renderError = () => (
    <div style={{ padding: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{
        width: 8, height: 8, borderRadius: '50%',
        background: '#ef4444',
        boxShadow: '0 0 0 2px rgba(239,68,68,0.2)'
      }} />
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 500, fontSize: 13, color: 'var(--text-0)' }}>
          CloakManager Error
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 4 }}>
          {initState?.actionableError || initState?.error || 'Unknown error'}
        </div>
      </div>
      <button
        onClick={handleStart}
        disabled={starting}
        style={{
          padding: '6px 12px',
          fontSize: 12,
          fontWeight: 500,
          background: 'var(--accent)',
          color: '#1a0d08',
          border: 'none',
          borderRadius: 4,
          cursor: starting ? 'not-allowed' : 'pointer',
          opacity: starting ? 0.6 : 1
        }}
      >
        {starting ? 'Retrying...' : 'Retry'}
      </button>
    </div>
  );

  return (
    <div style={{
      padding: '20px 24px',
      borderBottom: '1px solid var(--border)',
      background: 'var(--bg-0)'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--text-0)' }}>
            CloakManager Status
          </h3>
          <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 4 }}>
            Backend service status and management
          </div>
        </div>
      </div>

      <div style={{
        padding: 16,
        background: 'var(--bg-1)',
        border: '1px solid var(--border)',
        borderRadius: 6,
        marginBottom: 16
      }}>
        {displayState === 'loading' && renderLoading()}
        {displayState === 'dev_mode' && renderDevMode()}
        {displayState === 'not_downloaded' && renderNotDownloaded()}
        {displayState === 'progress' && renderProgress()}
        {displayState === 'ready' && renderReady()}
        {displayState === 'not_running' && renderNotRunning()}
        {displayState === 'unhealthy' && renderUnhealthy()}
        {displayState === 'error' && renderError()}
      </div>

      {/* Last update check info */}
      {status?.currentVersion && (
        <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 8 }}>
          Last update check: {status.currentVersion.lastCheck ? new Date(status.currentVersion.lastCheck).toLocaleString() : 'Never'}
          {' '}• Version: {status.currentVersion.version || 'unknown'}
        </div>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
