import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { useCan } from '../lib/permissions.jsx';

const FIELDS = [
  { key: 'hoursBetweenMin', label: 'Min hours between posts', type: 'number', step: 0.5 },
  { key: 'hoursBetweenMax', label: 'Max hours between posts', type: 'number', step: 0.5 },
  { key: 'postsBeforeBreak', label: 'Posts before a forced break', type: 'number', step: 1 },
  { key: 'breakHoursMin', label: 'Break length min (h)', type: 'number', step: 0.5 },
  { key: 'breakHoursMax', label: 'Break length max (h)', type: 'number', step: 0.5 },
  { key: 'dailyCap', label: 'Max posts per day', type: 'number', step: 1 },
  { key: 'quietStart', label: 'Quiet hours start (0–23)', type: 'number', step: 1 },
  { key: 'quietEnd', label: 'Quiet hours end (0–23)', type: 'number', step: 1 },
  { key: 'jitterMinutes', label: 'Jitter (± minutes)', type: 'number', step: 1 },
];

const SCOPES = [
  { key: 'global', label: 'Global' },
  { key: 'platform', label: 'Platform' },
];

export default function AutopilotPage() {
  const { token } = useAuth();
  const can = useCan();
  const canManage = can('protocols.manage');
  const canRun = can('protocols.run');

  const [scope, setScope] = useState('global');
  const [scopeId, setScopeId] = useState(null);
  const [raw, setRaw] = useState({});
  const [effective, setEffective] = useState({});
  const [defaults, setDefaults] = useState({});
  const [status, setStatus] = useState(null);
  const [events, setEvents] = useState([]);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [interval, setIntervalMin] = useState(30);
  const [cloud, setCloud] = useState({ backend: 'local', url: '', hasKey: false });
  const [cloudKey, setCloudKey] = useState('');
  const [cloudTest, setCloudTest] = useState(null);

  const loadConfig = useCallback(async () => {
    const sid = scope === 'platform' ? (scopeId || 'reddit') : null;
    const res = await window.api.protocols.get({ token, scope, scopeId: sid });
    if (res.ok) { setRaw(res.raw || {}); setEffective(res.effective || {}); setDefaults(res.defaults || {}); }
  }, [token, scope, scopeId]);

  const loadStatus = useCallback(async () => {
    const [s, e] = await Promise.all([
      window.api.autopilot.status({ token }),
      window.api.protocols.events({ token, limit: 50 }),
    ]);
    if (s.ok) { setStatus(s); setIntervalMin(s.intervalMin || 30); }
    if (e.ok) setEvents(e.events || []);
  }, [token]);

  const loadCloud = useCallback(async () => {
    const res = await window.api.coordination.get({ token });
    if (res.ok) setCloud(res);
  }, [token]);

  async function saveCloud(nextBackend) {
    const res = await window.api.coordination.set({
      token,
      backend: nextBackend ?? cloud.backend,
      url: cloud.url,
      key: cloudKey || undefined,
    });
    if (res.ok) { setCloudKey(''); setMsg('Cloud sync settings saved.'); loadCloud(); loadStatus(); }
    else setErr(res.error);
  }
  async function testCloud() {
    setCloudTest('testing');
    const res = await window.api.coordination.test({ token });
    setCloudTest(res.ok ? 'ok' : `fail: ${res.error}`);
  }

  useEffect(() => { loadConfig(); }, [loadConfig]);
  useEffect(() => { loadCloud(); }, [loadCloud]);
  useEffect(() => {
    loadStatus();
    const id = setInterval(loadStatus, 15000);
    return () => clearInterval(id);
  }, [loadStatus]);

  useEffect(() => {
    if (!msg && !err) return;
    const t = setTimeout(() => { setMsg(null); setErr(null); }, 4500);
    return () => clearTimeout(t);
  }, [msg, err]);

  function field(key) {
    // raw value overrides; placeholder shows effective/default
    return raw[key] ?? '';
  }
  function placeholder(key) {
    const v = effective[key] ?? defaults[key];
    return v == null ? '' : String(v);
  }

  async function save() {
    setBusy(true); setErr(null);
    const sid = scope === 'platform' ? (scopeId || 'reddit') : null;
    const clean = {};
    for (const f of FIELDS) {
      if (raw[f.key] !== '' && raw[f.key] != null) clean[f.key] = Number(raw[f.key]);
    }
    if (raw.enabled != null) clean.enabled = !!raw.enabled;
    const res = await window.api.protocols.set({ token, scope, scopeId: sid, config: clean });
    setBusy(false);
    if (res.ok) { setMsg('Protocol saved.'); loadConfig(); }
    else setErr(res.error);
  }

  async function toggleAutopilot() {
    const next = !status?.enabled;
    const res = await window.api.autopilot.setEnabled({ token, enabled: next });
    if (res.ok) { setMsg(next ? 'Autopilot enabled.' : 'Autopilot paused.'); loadStatus(); }
    else setErr(res.error);
  }

  async function saveInterval() {
    const res = await window.api.autopilot.setInterval({ token, minutes: interval });
    if (res.ok) setMsg('Interval saved.'); else setErr(res.error);
  }

  async function runNow(dryRun) {
    setBusy(true); setErr(null);
    const res = await window.api.autopilot.runNow({ token, dryRun });
    setBusy(false);
    if (res.ok) {
      const s = res.summary;
      setMsg(`${dryRun ? 'Dry run' : 'Pass'} complete — posted ${s.posted}, skipped ${s.skipped}, failed ${s.failed}.`);
      loadStatus();
    } else setErr(res.error);
  }

  const on = !!status?.enabled;

  return (
    <div>
      <div className="title-block">
        <div>
          <div className="eyebrow">Automation</div>
          <h1>Autopilot & Protocols</h1>
          <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
            Claude posts warm-up content on a schedule while the app is open, obeying the rules below.
          </div>
        </div>
      </div>

      {err && <div className="error-banner" style={{ marginBottom: 14 }}>{err}</div>}
      {msg && <div style={okBanner}>{msg}</div>}

      {/* Master control */}
      <div className="card" style={{ marginBottom: 18, padding: 18, display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ ...dot, background: on ? 'var(--ok)' : 'var(--text-3)', boxShadow: on ? '0 0 10px var(--ok)' : 'none' }} />
          <div>
            <div style={{ fontWeight: 600, fontSize: 15 }}>{on ? 'Autopilot is ON' : 'Autopilot is OFF'}</div>
            <div className="muted" style={{ fontSize: 12 }}>
              {status?.lastRun ? `Last pass ${new Date(status.lastRun).toLocaleString()}` : 'No passes yet'}
              {status?.running ? ' · running now…' : ''}
            </div>
          </div>
        </div>
        {canManage && (
          <button className={on ? 'danger' : 'primary'} onClick={toggleAutopilot}>
            {on ? 'Pause autopilot' : 'Enable autopilot'}
          </button>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ fontSize: 12 }}>Every</label>
          <input type="number" min={5} value={interval} onChange={(e) => setIntervalMin(e.target.value)} style={{ width: 70 }} disabled={!canManage} />
          <span className="muted" style={{ fontSize: 12 }}>min</span>
          {canManage && <button className="ghost" onClick={saveInterval}>Set</button>}
        </div>
        {canRun && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button className="ghost" onClick={() => runNow(true)} disabled={busy}>Dry run</button>
            <button className="primary" onClick={() => runNow(false)} disabled={busy}>Run one pass now</button>
          </div>
        )}
      </div>

      {/* Cloud sync (multi-VA coordination) */}
      {canManage && (
        <div className="card" style={{ marginBottom: 18, padding: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <h3 style={{ margin: 0 }}>Multi-VA coordination</h3>
            <span style={{ ...pill, ...(cloud.backend === 'supabase' ? { background: 'rgba(122,154,90,0.15)', color: '#bdd5a3' } : { background: 'rgba(255,255,255,0.06)', color: 'var(--text-3)' }) }}>
              {cloud.backend === 'supabase' ? 'Cloud (shared)' : 'Local only'}
            </span>
          </div>
          <div className="muted" style={{ fontSize: 12, marginBottom: 14, lineHeight: 1.6 }}>
            Local only: each PC tracks its own posts — VAs can't see each other's activity.
            Cloud: all machines share one Supabase DB, so autopilot never double-posts an account across VAs.
            Run the schema in <span className="mono">docs/supabase-schema.sql</span> first.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 2fr auto', gap: 10, alignItems: 'end' }}>
            <div>
              <label>Supabase URL</label>
              <input placeholder="https://xxxx.supabase.co" value={cloud.url} onChange={(e) => setCloud({ ...cloud, url: e.target.value })} />
            </div>
            <div>
              <label>Service key {cloud.hasKey && <span className="dim" style={{ textTransform: 'none' }}>(saved — leave blank to keep)</span>}</label>
              <input type="password" placeholder={cloud.hasKey ? '••••••••' : 'service_role key'} value={cloudKey} onChange={(e) => setCloudKey(e.target.value)} />
            </div>
            <button className="ghost" onClick={testCloud}>Test</button>
          </div>
          {cloudTest && (
            <div style={{ fontSize: 12, marginTop: 8, color: cloudTest === 'ok' ? '#bdd5a3' : cloudTest === 'testing' ? 'var(--text-2)' : '#e2a3a3' }}>
              {cloudTest === 'ok' ? '✓ Connected — tables reachable.' : cloudTest === 'testing' ? 'Testing…' : `✗ ${cloudTest.replace('fail: ', '')}`}
            </div>
          )}
          <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
            <button className="ghost" onClick={() => saveCloud()}>Save settings</button>
            {cloud.backend === 'supabase'
              ? <button className="danger" onClick={() => saveCloud('local')}>Switch to local</button>
              : <button className="primary" onClick={() => saveCloud('supabase')}>Enable cloud sync</button>}
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: 18 }}>
        {/* Protocol editor */}
        <div className="card" style={{ padding: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <h3 style={{ margin: 0 }}>Protocol rules</h3>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              {SCOPES.map((s) => (
                <button
                  key={s.key}
                  className={scope === s.key ? 'primary' : 'ghost'}
                  onClick={() => { setScope(s.key); setScopeId(s.key === 'platform' ? 'reddit' : null); }}
                  style={{ fontSize: 12, padding: '4px 10px' }}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {scope === 'platform' && (
            <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
              Editing <strong>reddit</strong> overrides. Empty fields fall back to Global → defaults.
            </div>
          )}

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, cursor: canManage ? 'pointer' : 'default' }}>
            <input
              type="checkbox"
              checked={raw.enabled ?? effective.enabled ?? false}
              onChange={(e) => setRaw({ ...raw, enabled: e.target.checked })}
              disabled={!canManage}
            />
            <span>Protocol enabled (accounts in this scope may auto-post)</span>
          </label>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {FIELDS.map((f) => (
              <div key={f.key}>
                <label style={{ fontSize: 12 }}>{f.label}</label>
                <input
                  type="number"
                  step={f.step}
                  value={field(f.key)}
                  placeholder={placeholder(f.key)}
                  onChange={(e) => setRaw({ ...raw, [f.key]: e.target.value })}
                  disabled={!canManage}
                />
              </div>
            ))}
          </div>

          {canManage && (
            <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
              <button className="primary" onClick={save} disabled={busy}>Save protocol</button>
              <span className="muted" style={{ fontSize: 11, alignSelf: 'center' }}>
                Blank = inherit. Override hierarchy: account → model → platform → global.
              </span>
            </div>
          )}
        </div>

        {/* Recent activity */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
            <h3 style={{ margin: 0 }}>Recent posts</h3>
          </div>
          {events.length === 0 ? (
            <div className="empty-state" style={{ padding: 30, border: 'none' }}>No posts yet.</div>
          ) : (
            <div style={{ maxHeight: 460, overflowY: 'auto' }}>
              {events.map((e) => (
                <div key={e.id} style={eventRow}>
                  <span style={{ ...pill, ...statusPill(e.status) }}>{e.status}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {e.subreddit ? `r/${e.subreddit} · ` : ''}{e.title || e.error || '—'}
                    </div>
                    <div className="muted" style={{ fontSize: 11 }}>
                      u/{e.account_username || e.account_id}
                      {e.profile_name ? ` · ${e.profile_name}` : ''}
                      {' · '}{e.source}
                      {' · '}{e.created_at ? new Date(e.created_at.replace(' ', 'T') + 'Z').toLocaleString() : ''}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const okBanner = {
  background: 'rgba(122,154,90,0.12)', border: '1px solid var(--ok)', color: '#bdd5a3',
  padding: '10px 14px', borderRadius: 4, marginBottom: 12,
};
const dot = { width: 12, height: 12, borderRadius: '50%', flexShrink: 0 };
const eventRow = {
  display: 'flex', alignItems: 'flex-start', gap: 10,
  padding: '10px 16px', borderBottom: '1px solid var(--border)',
};
const pill = { fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 999, textTransform: 'uppercase', flexShrink: 0, marginTop: 2 };
function statusPill(s) {
  if (s === 'posted') return { background: 'rgba(122,154,90,0.15)', color: '#bdd5a3' };
  if (s === 'failed') return { background: 'rgba(180,90,90,0.15)', color: '#e2a3a3' };
  return { background: 'rgba(255,255,255,0.06)', color: 'var(--text-3)' };
}
