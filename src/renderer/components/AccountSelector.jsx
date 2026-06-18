import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useAuth } from '../lib/auth.jsx';

// Shared account picker used by Autopilot + Scheduler.
//
// Three connected controls: Model → Platform → Account. Each step
// narrows the next. The selected account, platform, and profileId
// are surfaced via onChange so the parent can scope its panels.
//
// `requireAccount`: when true (Scheduler), platform pills only show
//   platforms that actually have a linked account on the model.
//   When false (Autopilot), all five platforms are listed so the
//   operator can configure a profile+platform pair even before any
//   accounts exist.
//
// `accounts` is the master list (window.api.accounts.listForUser
// result). Cached upstream so we don't refetch per page.

const PLATFORMS = [
  { v: 'reddit',    l: 'Reddit',    c: '#ff4500' },
  { v: 'x',         l: 'X',         c: '#dddddd' },
  { v: 'instagram', l: 'Instagram', c: '#e2497d' },
  { v: 'tiktok',    l: 'TikTok',    c: '#69c9d0' },
  { v: 'redgifs',   l: 'RedGifs',   c: '#d63d3d' },
];

// Browser mode configuration
const BROWSER_MODES = {
  electron: { label: 'Electron', color: '#4a90e2', icon: '⚡' },
  cloakmanager: { label: 'CloakManager', color: '#9b59b6', icon: '👻' },
  inherit: { label: 'Inherit', color: '#95a5a6', icon: '🔄' },
};

export default function AccountSelector({
  accounts,
  profiles,
  value,                  // { profileId, platform, accountId }
  onChange,
  requireAccount = false,
  showAccountChips = true,
}) {
  const { profileId, platform, accountId } = value || {};
  const { token } = useAuth();

  // CloakManager state
  const [cloakStatus, setCloakStatus] = useState({}); // { accountId: status }
  const [launchProgress, setLaunchProgress] = useState({}); // { accountId: progress }
  const [runningProfiles, setRunningProfiles] = useState(new Set());

  // Get browser mode for an account
  const getBrowserMode = useCallback((account) => {
    if (!account) return 'electron';

    const accountMode = account.browser_mode;
    if (accountMode === 'cloakmanager') return 'cloakmanager';
    if (accountMode === 'electron') return 'electron';

    // For 'inherit' or missing, default to electron
    return 'electron';
  }, []);

  // Check if an account is running in CloakManager
  const isAccountRunning = useCallback((accountId) => {
    return runningProfiles.has(accountId) && cloakStatus[accountId] === 'running';
  }, [runningProfiles, cloakStatus]);

  // Enhanced launch function that checks browser mode
  async function launchInBrowser() {
    if (!accountId) return;

    const account = accounts.find(a => a.id === accountId);
    if (!account) return;

    const browserMode = getBrowserMode(account);

    // CloakManager mode launch
    if (browserMode === 'cloakmanager') {
      const profileName = account.cloak_profile_name || account.cloak_actual_name;
      if (!profileName) {
        alert('No CloakManager profile configured for this account');
        return;
      }

      setLaunchProgress(prev => ({ ...prev, [accountId]: { status: 'launching', progress: 0 } }));

      try {
        const result = await window.api.cloakmanager.launchProfile({
          token,
          accountId,
          profileName
        });

        setLaunchProgress(prev => ({ ...prev, [accountId]: null }));

        if (result && result.ok === false) {
          alert(result.error || 'Failed to launch CloakManager profile');
        } else if (result && result.ok) {
          setRunningProfiles(prev => new Set([...prev, accountId]));
          setCloakStatus(prev => ({ ...prev, [accountId]: 'running' }));
        }
      } catch (e) {
        setLaunchProgress(prev => ({ ...prev, [accountId]: null }));
        alert(e.message || 'CloakManager launch failed');
      }
      return;
    }

    // Electron mode launch (original behavior)
    try {
      const r = await window.api.oserusBrowser.openAccount({ token, accountId });
      if (r && r.ok === false) alert(r.error || 'Could not open Oserus Browser');
    } catch (e) { alert(e.message || 'Launch failed'); }
  }

  // WebSocket event listeners for real-time status updates
  useEffect(() => {
    const unsubscribers = [];

    // Profile launched event
    unsubscribers.push(
      window.api.cloakmanager.onProfileLaunched((data) => {
        if (data && data.accountId) {
          setRunningProfiles(prev => new Set([...prev, data.accountId]));
          setCloakStatus(prev => ({ ...prev, [data.accountId]: 'running' }));
          setLaunchProgress(prev => ({ ...prev, [data.accountId]: null }));
        }
      })
    );

    // Profile stopped event
    unsubscribers.push(
      window.api.cloakmanager.onProfileStopped((data) => {
        if (data && data.accountId) {
          setRunningProfiles(prev => {
            const next = new Set(prev);
            next.delete(data.accountId);
            return next;
          });
          setCloakStatus(prev => ({ ...prev, [data.accountId]: 'stopped' }));
        }
      })
    );

    // Window closed event
    unsubscribers.push(
      window.api.cloakmanager.onWindowClosed((data) => {
        if (data && data.accountId) {
          setRunningProfiles(prev => {
            const next = new Set(prev);
            next.delete(data.accountId);
            return next;
          });
          setCloakStatus(prev => ({ ...prev, [data.accountId]: 'stopped' }));
        }
      })
    );

    // Launch progress event
    unsubscribers.push(
      window.api.cloakmanager.onLaunchProgress((data) => {
        if (data && data.accountId) {
          setLaunchProgress(prev => ({
            ...prev,
            [data.accountId]: { status: 'launching', progress: data.progress || 0 }
          }));
        }
      })
    );

    // Browser crashed event
    unsubscribers.push(
      window.api.cloakmanager.onBrowserCrashed((data) => {
        if (data && data.accountId) {
          setLaunchProgress(prev => ({ ...prev, [data.accountId]: null }));
          setCloakStatus(prev => ({ ...prev, [data.accountId]: 'error' }));
          alert(`CloakManager browser crashed for account ${data.accountId}`);
        }
      })
    );

    return () => {
      unsubscribers.forEach(unsub => unsub());
    };
  }, []);

  // Default selection: first profile, first platform that has at least
  // one account on that profile (or 'reddit' as a stable fallback).
  useEffect(() => {
    if (!profileId && profiles?.length) {
      const next = profiles[0].id;
      onChange({ profileId: next, platform: null, accountId: null });
    }
  }, [profileId, profiles, onChange]);

  // Accounts narrowed to the chosen profile.
  const accountsOnProfile = useMemo(
    () => (profileId ? accounts.filter((a) => a.profile_id === profileId) : []),
    [accounts, profileId]
  );

  // Platforms that actually have an account on this profile. Used to
  // grey out / hide irrelevant platform pills.
  const populatedPlatforms = useMemo(() => {
    const set = new Set();
    for (const a of accountsOnProfile) set.add(a.platform || 'reddit');
    return set;
  }, [accountsOnProfile]);

  const visiblePlatforms = requireAccount
    ? PLATFORMS.filter((p) => populatedPlatforms.has(p.v))
    : PLATFORMS;

  // When the chosen platform isn't visible anymore (model switched),
  // snap to the first available.
  useEffect(() => {
    if (!visiblePlatforms.length) return;
    if (!visiblePlatforms.find((p) => p.v === platform)) {
      onChange({ profileId, platform: visiblePlatforms[0].v, accountId: null });
    }
  }, [visiblePlatforms, platform, profileId, onChange]);

  const accountsOnSelection = useMemo(
    () => accountsOnProfile.filter((a) => (a.platform || 'reddit') === platform),
    [accountsOnProfile, platform]
  );

  // Auto-pick first account on (profile, platform) whenever the
  // selection changes and there's no account chosen yet.
  useEffect(() => {
    if (!accountId && accountsOnSelection.length) {
      onChange({ profileId, platform, accountId: accountsOnSelection[0].id });
    }
  }, [accountId, accountsOnSelection, profileId, platform, onChange]);

  return (
    <div style={shell}>
      <select
        value={profileId || ''}
        onChange={(e) => {
          const next = Number(e.target.value) || null;
          onChange({ profileId: next, platform: null, accountId: null });
        }}
        style={{ minWidth: 220 }}
      >
        {(profiles || []).map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>

      <div style={{ display: 'flex', gap: 4 }}>
        {visiblePlatforms.map((p) => {
          const active = platform === p.v;
          const populated = populatedPlatforms.has(p.v);
          return (
            <button
              key={p.v}
              onClick={() => onChange({ profileId, platform: p.v, accountId: null })}
              style={{
                background: active ? 'rgba(255,255,255,0.06)' : 'transparent',
                border: `1px solid ${active ? p.c : 'var(--border)'}`,
                borderRadius: 999, padding: '5px 12px',
                color: active ? '#fff' : (populated ? 'var(--text-2)' : 'var(--text-3)'),
                fontSize: 11, fontWeight: 600, cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 6,
                opacity: populated ? 1 : 0.55,
              }}
              title={populated ? `${p.l} accounts on this model` : `No ${p.l} accounts linked to this model yet`}
            >
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: p.c }} />
              {p.l}
            </button>
          );
        })}
      </div>

      {showAccountChips && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center', maxWidth: '50%' }}>
          {accountsOnSelection.length === 0 ? (
            <span className="muted" style={{ fontSize: 11, alignSelf: 'center', fontStyle: 'italic' }}>
              No {platform || ''} accounts linked yet
            </span>
          ) : accountsOnSelection.map((a) => {
            const active = accountId === a.id;
            const browserMode = getBrowserMode(a);
            const modeConfig = BROWSER_MODES[browserMode] || BROWSER_MODES.electron;
            const running = isAccountRunning(a.id);
            const progress = launchProgress[a.id];

            return (
              <button
                key={a.id}
                onClick={() => onChange({ profileId, platform, accountId: a.id })}
                style={{
                  background: active ? 'rgba(212,166,74,0.18)' : 'var(--bg-1)',
                  border: `1px solid ${active ? 'var(--gold)' : modeConfig.color}`,
                  borderRadius: 999, padding: '4px 10px',
                  color: active ? 'var(--gold)' : 'var(--text-1)',
                  fontSize: 11, fontFamily: 'var(--font-mono)', cursor: 'pointer',
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  position: 'relative',
                }}
                title={`Status: ${a.status || 'unknown'} | Browser: ${modeConfig.label}${running ? ' | Running' : ''}`}
              >
                <span style={{ fontSize: 10 }}>{modeConfig.icon}</span>
                {a.username}
                {running && (
                  <span style={{
                    width: 6, height: 6, borderRadius: '50%',
                    background: '#2ecc71', boxShadow: '0 0 4px #2ecc71'
                  }} />
                )}
                {progress && progress.status === 'launching' && (
                  <span style={{
                    position: 'absolute', top: -2, right: -2,
                    background: modeConfig.color, color: '#fff',
                    fontSize: 8, padding: '1px 3px', borderRadius: 999,
                    animation: 'pulse 1s infinite'
                  }}>
                    {Math.round(progress.progress * 100)}%
                  </span>
                )}
              </button>
            );
          })}
          {accountId && (() => {
            const account = accounts.find(a => a.id === accountId);
            const browserMode = account ? getBrowserMode(account) : 'electron';
            const modeConfig = BROWSER_MODES[browserMode] || BROWSER_MODES.electron;
            const progress = launchProgress[accountId];
            const running = isAccountRunning(accountId);

            return (
              <button
                onClick={launchInBrowser}
                disabled={progress && progress.status === 'launching'}
                title={`Open in ${modeConfig.label}${running ? ' (already running)' : ''}`}
                style={{
                  background: running ? 'var(--green)' : modeConfig.color,
                  color: '#fff',
                  border: 'none', borderRadius: 999,
                  padding: '4px 12px', fontSize: 11, fontWeight: 700,
                  cursor: progress && progress.status === 'launching' ? 'wait' : 'pointer',
                  marginLeft: 4, opacity: progress && progress.status === 'launching' ? 0.7 : 1,
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                }}
              >
                {progress && progress.status === 'launching' ? (
                  <>⟳ Launching...</>
                ) : running ? (
                  <>● Running</>
                ) : (
                  <>{modeConfig.icon} ▶ {modeConfig.label}</>
                )}
              </button>
            );
          })()}
        </div>
      )}
    </div>
  );
}

const shell = {
  display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap',
  padding: '10px 12px',
  background: 'var(--bg-1)', border: '1px solid var(--border)',
  borderRadius: 10, marginBottom: 16,
};

// Add pulse animation for launch progress
if (typeof document !== 'undefined' && !document.getElementById('account-selector-styles')) {
  const style = document.createElement('style');
  style.id = 'account-selector-styles';
  style.textContent = `
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
  `;
  document.head.appendChild(style);
}
