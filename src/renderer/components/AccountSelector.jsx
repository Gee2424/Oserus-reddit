import React, { useEffect, useMemo, useState } from 'react';
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

  async function launchInBrowser() {
    if (!accountId) return;
    try {
      const r = await window.api.oserusBrowser.openAccount({ token, accountId });
      if (r && r.ok === false) alert(r.error || 'Could not open Oserus Browser');
    } catch (e) { alert(e.message || 'Launch failed'); }
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
            return (
              <button
                key={a.id}
                onClick={() => onChange({ profileId, platform, accountId: a.id })}
                style={{
                  background: active ? 'rgba(212,166,74,0.18)' : 'var(--bg-1)',
                  border: `1px solid ${active ? 'var(--gold)' : 'var(--border)'}`,
                  borderRadius: 999, padding: '4px 10px',
                  color: active ? 'var(--gold)' : 'var(--text-1)',
                  fontSize: 11, fontFamily: 'var(--font-mono)', cursor: 'pointer',
                }}
                title={`Status: ${a.status || 'unknown'}`}
              >
                {a.username}
              </button>
            );
          })}
          {accountId && (
            <button
              onClick={launchInBrowser}
              title="Open the selected account in Oserus Browser"
              style={{
                background: 'var(--gold)', color: '#0d0c0a',
                border: 'none', borderRadius: 999,
                padding: '4px 12px', fontSize: 11, fontWeight: 700,
                cursor: 'pointer', marginLeft: 4,
                display: 'inline-flex', alignItems: 'center', gap: 4,
              }}
            >▶ Browser</button>
          )}
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
