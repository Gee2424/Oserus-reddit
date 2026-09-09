import React, { useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { useActiveAccount } from '../lib/activeAccount.jsx';
import { useCloakManagerLaunch } from '../hooks/useCloakManagerLaunch';
import { launchAccountBrowser } from '../lib/launchAccount.js';
import { usePlatforms } from '../lib/platforms.js';
import { useToast } from '../lib/toast.jsx';
import LaunchStatus from './LaunchStatus.jsx';

// Shared account picker used by Autopilot + Scheduler.
//
// Three connected controls: Model → Platform → Account. Each step
// narrows the next. The selected account, platform, and profileId
// are surfaced via onChange so the parent can scope its panels.
//
// `requireAccount`: when true (Scheduler), platform pills only show
//   platforms that actually have a linked account on the model.
//   When false (Autopilot), all platforms are listed so the
//   operator can configure a profile+platform pair even before any
//   accounts exist.
//
// `accounts` is the master list (window.api.accounts.listForUser
// result). Cached upstream so we don't refetch per page.

// Browser mode configuration
const BROWSER_MODES = {
  electron: { label: 'Electron', color: '#4a90e2', icon: '⚡' },
  cloakmanager: { label: 'CloakManager', color: '#9b59b6', icon: '👻' },
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
  const { startAccount } = useActiveAccount();
  const { toast } = useToast();

  // Derive from the shared platform list — read live so this reflects
  // loadPlatforms() as soon as it resolves, not a frozen first-load snapshot.
  const rawPlatforms = usePlatforms();
  const PLATFORMS = useMemo(() => rawPlatforms.map(p => ({ v: p.v, l: p.label, c: p.color })), [rawPlatforms]);

  // Shared CloakManager status store (keyed by CM profile name) — same one
  // ModelDetail.jsx uses, so status stays in sync across screens.
  const {
    launchProgress, isAccountRunning: isProfileRunning,
    getLaunchPhase, getAttention, clearAttentionLocal,
  } = useCloakManagerLaunch();

  // Get browser mode for an account (reads from model-level resolved_browser_mode)
  const getBrowserMode = useCallback((account) => {
    if (!account) return 'electron';
    return account.resolved_browser_mode || 'electron';
  }, []);

  const cmProfileName = (account) => account && (account.effective_cm_name || account.cloak_actual_name);

  // Check if an account's CloakManager profile is running
  const isAccountRunning = useCallback((account) => {
    const name = cmProfileName(account);
    return !!name && isProfileRunning(name);
  }, [isProfileRunning]);

  async function launchInBrowser() {
    if (!accountId) return;
    try {
      const r = await launchAccountBrowser({ token, accountId, startAccount });
      if (r && r.ok === false) toast('err', r.error || 'Launch failed');
    } catch (e) { toast('err', e.message || 'Launch failed'); }
  }

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
                borderRadius: 'var(--radius-pill)', padding: '5px 12px',
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
            const running = isAccountRunning(a);
            const progress = launchProgress[cmProfileName(a)];

            return (
              <button
                key={a.id}
                onClick={() => onChange({ profileId, platform, accountId: a.id })}
                style={{
                  background: active ? 'rgba(212,166,74,0.18)' : 'var(--bg-1)',
                  border: `1px solid ${active ? 'var(--gold)' : modeConfig.color}`,
                  borderRadius: 'var(--radius-pill)', padding: '4px 10px',
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
                {progress && (
                  <span style={{
                    position: 'absolute', top: -2, right: -2,
                    background: modeConfig.color, color: '#fff',
                    fontSize: 8, padding: '1px 3px', borderRadius: 'var(--radius-pill)',
                    animation: 'pulse 1s infinite'
                  }}>
                    {Math.round((progress.progress || 0) * 100)}%
                  </span>
                )}
              </button>
            );
          })}
          {accountId && (() => {
            const account = accounts.find(a => a.id === accountId);
            const browserMode = account ? getBrowserMode(account) : 'electron';
            const modeConfig = BROWSER_MODES[browserMode] || BROWSER_MODES.electron;
            const isCM = browserMode === 'cloakmanager';
            const profileName = cmProfileName(account);
            const phase = isCM ? getLaunchPhase(profileName) : null;
            const attention = getAttention(accountId);
            const running = isAccountRunning(account);
            const busy = phase && phase.stage && phase.stage !== 'ready' && phase.stage !== 'failed';

            // For CM accounts, show the rich launch status once anything is happening.
            if (isCM && (phase || attention || running)) {
              return (
                <span style={{ marginLeft: 4, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <LaunchStatus
                    compact
                    phase={phase}
                    attention={attention}
                    running={running}
                    actions={{
                      retry: busy ? undefined : launchInBrowser,
                      openBrowser: launchInBrowser,
                      clearAttention: attention?.code ? async () => {
                        try { await window.api.accounts.clearAttention({ token, accountId }); } catch {}
                        clearAttentionLocal(accountId);
                      } : undefined,
                    }}
                  />
                </span>
              );
            }

            return (
              <button
                onClick={launchInBrowser}
                disabled={!!busy}
                title={`Open in ${modeConfig.label}${running ? ' (already running)' : ''}`}
                style={{
                  background: running ? 'var(--green)' : modeConfig.color,
                  color: '#fff',
                  border: 'none', borderRadius: 'var(--radius-pill)',
                  padding: '4px 12px', fontSize: 11, fontWeight: 700,
                  cursor: busy ? 'wait' : 'pointer',
                  marginLeft: 4, opacity: busy ? 0.7 : 1,
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                }}
              >
                {running ? <>● Running</> : <>{modeConfig.icon} ▶ {modeConfig.label}</>}
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
  borderRadius: 'var(--radius-lg)', marginBottom: 16,
};
