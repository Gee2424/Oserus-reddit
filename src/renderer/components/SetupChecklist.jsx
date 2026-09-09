import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { useToast } from '../lib/toast.jsx';

const DISMISS_KEY = 'oserus.setupChecklist.dismissed';

// First-run guidance. Derives each step's state from existing IPC, so it stays
// truthful — a step un-ticks if its data goes away. Dismissible; the flag is
// per-machine (localStorage). Hidden entirely once every step is done.
export default function SetupChecklist({ navigate }) {
  const { token } = useAuth();
  const { toast } = useToast();
  const [steps, setSteps] = useState(null);
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; }
  });

  const refresh = useCallback(async () => {
    try {
      const [teams, models, proxies, accounts, cloud, cdp] = await Promise.all([
        window.api.team.listTeams({}).catch(() => ({ ok: false })),
        window.api.profiles.list({ token }).catch(() => ({ ok: false })),
        window.api.proxies.list({ token }).catch(() => ({ ok: false })),
        window.api.accounts.listForUser({ token }).catch(() => ({ ok: false })),
        window.api.cloud.getStatus().catch(() => null),
        window.api.cloakmanager.getExecutionHistory({ token, limit: 1 }).catch(() => ({ ok: false })),
      ]);
      const modelList = models.ok ? (models.profiles || models.models || []) : [];
      const proxyList = proxies.ok ? (proxies.proxies || []) : [];
      const acctList = accounts.ok ? (accounts.accounts || []) : [];
      const sqlOk = !!(cloud && cloud.connected && !cloud.lastError);
      const launched = cdp.ok && (cdp.executions || []).length > 0;

      setSteps([
        { key: 'team', label: 'Create a team', done: teams.ok && (teams.teams || []).length > 0, go: () => navigate('team') },
        { key: 'model', label: 'Create a model profile', done: modelList.length > 0, go: () => navigate('profiles') },
        { key: 'proxy', label: 'Add a residential proxy', done: proxyList.length > 0, go: () => navigate('proxies') },
        { key: 'account', label: 'Link a platform account', done: acctList.length > 0, go: () => navigate('profiles') },
        {
          key: 'sql', label: 'Run the Cloud Sync setup SQL', done: sqlOk,
          go: async () => {
            try {
              const r = await window.api.cloud.getSchemaSql();
              const sql = r?.sql || r;
              if (sql) { await navigator.clipboard.writeText(sql); toast('ok', 'Setup SQL copied — paste it in the Supabase SQL editor'); }
              else navigate('settings');
            } catch { navigate('settings'); }
          },
          goLabel: 'Copy SQL',
        },
        { key: 'launch', label: 'Launch a model browser', done: launched, go: () => navigate('profiles') },
      ]);
    } catch { /* keep last */ }
  }, [token, navigate, toast]);

  useEffect(() => { refresh(); const id = setInterval(refresh, 20000); return () => clearInterval(id); }, [refresh]);

  if (dismissed || !steps) return null;
  const doneCount = steps.filter((s) => s.done).length;
  if (doneCount === steps.length) return null;

  return (
    <div style={{
      border: '1px solid var(--gold)', borderRadius: 'var(--radius-lg)',
      background: 'var(--gold-soft)', padding: '14px 16px', marginBottom: 18,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <strong style={{ fontSize: 13, color: 'var(--gold-bright)' }}>Finish setting up Oserus</strong>
        <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>{doneCount}/{steps.length}</span>
        <button
          className="ghost"
          style={{ marginLeft: 'auto', fontSize: 11 }}
          onClick={() => { try { localStorage.setItem(DISMISS_KEY, '1'); } catch {} setDismissed(true); }}
        >Dismiss</button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {steps.map((s) => (
          <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
            <span style={{
              width: 16, height: 16, borderRadius: '50%', flexShrink: 0, display: 'grid', placeItems: 'center',
              fontSize: 10, fontWeight: 700,
              background: s.done ? 'var(--ok)' : 'transparent',
              border: s.done ? 'none' : '1px solid var(--border-strong)',
              color: s.done ? '#0d0c0a' : 'var(--text-3)',
            }}>{s.done ? '✓' : ''}</span>
            <span style={{ color: s.done ? 'var(--text-3)' : 'var(--text-1)', textDecoration: s.done ? 'line-through' : 'none' }}>
              {s.label}
            </span>
            {!s.done && (
              <button className="ghost" style={{ marginLeft: 'auto', fontSize: 11 }} onClick={s.go}>
                {s.goLabel || 'Go →'}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
