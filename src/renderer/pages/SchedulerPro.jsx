import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { useActiveAccount } from '../lib/activeAccount.jsx';

const PLATFORM_ICON = { reddit: '◈', redgifs: '▮', x: '𝕏', instagram: '◉', tiktok: '♪' };
const STATUS_COLOR = {
  pending: { bg: 'rgba(201,162,39,0.15)', fg: 'var(--gold)' },
  posted: { bg: 'rgba(122,154,90,0.15)', fg: '#bdd5a3' },
  failed: { bg: 'rgba(180,90,90,0.15)', fg: '#e2a3a3' },
  cancelled: { bg: 'rgba(255,255,255,0.05)', fg: 'var(--text-3)' },
};

// datetime-local string -> "YYYY-MM-DD HH:MM:SS" (local, what the backend stores)
function toStored(dtLocal) {
  if (!dtLocal) return null;
  return dtLocal.replace('T', ' ') + ':00';
}
function fromStored(s) {
  if (!s) return '';
  return s.replace(' ', 'T').slice(0, 16);
}
function dayLabel(s) {
  try {
    const d = new Date(s.replace(' ', 'T'));
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  } catch { return s; }
}
function timeLabel(s) {
  try {
    return new Date(s.replace(' ', 'T')).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  } catch { return s; }
}

export default function SchedulerProPage() {
  const { token } = useAuth();
  const { accounts } = useActiveAccount();

  const [posts, setPosts] = useState([]);
  const [filters, setFilters] = useState({ platform: '', profileId: '', accountId: '', status: '' });
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);
  const [showCompose, setShowCompose] = useState(false);

  const load = useCallback(async () => {
    const res = await window.api.scheduled.list({
      token,
      platform: filters.platform || undefined,
      profileId: filters.profileId || undefined,
      accountId: filters.accountId || undefined,
      status: filters.status || undefined,
    });
    if (res.ok) setPosts(res.posts || []);
    else setErr(res.error);
  }, [token, filters]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [load]);
  useEffect(() => {
    if (!msg && !err) return;
    const t = setTimeout(() => { setMsg(null); setErr(null); }, 4500);
    return () => clearTimeout(t);
  }, [msg, err]);

  // Build model + platform option lists from the accounts we can see.
  const profiles = useMemo(() => {
    const map = new Map();
    for (const a of accounts) if (a.profile_id) map.set(a.profile_id, a.profile_name || `Model ${a.profile_id}`);
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [accounts]);
  const platforms = useMemo(() => {
    const set = new Set(accounts.map((a) => a.platform || 'reddit'));
    return [...set];
  }, [accounts]);

  // Group posts by day for the timeline.
  const grouped = useMemo(() => {
    const g = {};
    for (const p of posts) {
      const k = (p.scheduled_for || '').slice(0, 10);
      (g[k] = g[k] || []).push(p);
    }
    return Object.entries(g).sort(([a], [b]) => a.localeCompare(b));
  }, [posts]);

  const pendingConflicts = posts.filter((p) => p.status === 'pending' && p.conflicts?.length).length;

  async function reschedule(id, dtLocal) {
    const res = await window.api.scheduled.reschedule({ token, id, scheduledFor: toStored(dtLocal) });
    if (res.ok) { setMsg('Rescheduled.'); load(); } else setErr(res.error);
  }
  async function cancel(id) {
    const res = await window.api.scheduled.cancel({ token, id });
    if (res.ok) { setMsg('Cancelled.'); load(); } else setErr(res.error);
  }
  async function del(id) {
    if (!confirm('Delete this scheduled post?')) return;
    const res = await window.api.scheduled.delete({ token, id });
    if (res.ok) { load(); } else setErr(res.error);
  }

  return (
    <div>
      <div className="title-block">
        <div>
          <div className="eyebrow">Workspace</div>
          <h1>Scheduler Pro</h1>
          <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
            Every scheduled post across all accounts and platforms in one timeline.
            Due posts fire automatically while the app is open.
          </div>
        </div>
        <button className="primary" onClick={() => setShowCompose((v) => !v)}>
          {showCompose ? 'Close' : '+ Schedule posts'}
        </button>
      </div>

      {err && <div className="error-banner" style={{ marginBottom: 14 }}>{err}</div>}
      {msg && <div style={okBanner}>{msg}</div>}
      {pendingConflicts > 0 && (
        <div style={warnBanner}>⚠ {pendingConflicts} scheduled post{pendingConflicts > 1 ? 's' : ''} conflict with posting protocols.</div>
      )}

      {showCompose && (
        <Composer
          token={token}
          accounts={accounts}
          onDone={() => { setShowCompose(false); load(); setMsg('Scheduled.'); }}
          onError={setErr}
        />
      )}

      {/* Filters */}
      <div className="card" style={{ padding: 12, marginBottom: 16, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="muted" style={{ fontSize: 12 }}>Filter:</span>
        <select value={filters.platform} onChange={(e) => setFilters({ ...filters, platform: e.target.value })}>
          <option value="">All platforms</option>
          {platforms.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={filters.profileId} onChange={(e) => setFilters({ ...filters, profileId: e.target.value })}>
          <option value="">All models</option>
          {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={filters.accountId} onChange={(e) => setFilters({ ...filters, accountId: e.target.value })}>
          <option value="">All accounts</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{(PLATFORM_ICON[a.platform] || '') + ' ' + a.username}</option>)}
        </select>
        <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
          <option value="">Any status</option>
          {['pending', 'posted', 'failed', 'cancelled'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <button className="ghost" onClick={load} style={{ marginLeft: 'auto' }}>Refresh</button>
      </div>

      {grouped.length === 0 ? (
        <div className="empty-state" style={{ padding: 40 }}>No scheduled posts match these filters.</div>
      ) : (
        grouped.map(([day, items]) => (
          <div key={day} style={{ marginBottom: 18 }}>
            <div style={dayHeader}>{dayLabel(day + ' 00:00')}<span className="dim" style={{ marginLeft: 8 }}>{items.length}</span></div>
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              {items.map((p) => (
                <div key={p.id} style={row}>
                  <div style={{ width: 70, flexShrink: 0, fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-2)' }}>
                    {timeLabel(p.scheduled_for)}
                  </div>
                  <span style={{ fontSize: 14, width: 18, flexShrink: 0 }} title={p.platform}>
                    {PLATFORM_ICON[p.platform] || '◈'}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <span style={{ color: 'var(--gold)' }}>r/{p.subreddit}</span> · {p.title}
                    </div>
                    <div className="muted" style={{ fontSize: 11, display: 'flex', gap: 6, alignItems: 'center', marginTop: 2 }}>
                      {p.profile_color && <span style={{ width: 7, height: 7, borderRadius: 999, background: p.profile_color }} />}
                      u/{p.account_username}{p.profile_name ? ` · ${p.profile_name}` : ''}
                      {p.error ? <span style={{ color: '#e2a3a3' }}>· {p.error}</span> : null}
                    </div>
                    {p.conflicts?.length > 0 && (
                      <div style={{ fontSize: 11, color: 'var(--gold)', marginTop: 3 }}>
                        ⚠ {p.conflicts.join(' · ')}
                      </div>
                    )}
                  </div>
                  <span style={{ ...pill, background: (STATUS_COLOR[p.status] || {}).bg, color: (STATUS_COLOR[p.status] || {}).fg }}>
                    {p.status}
                  </span>
                  {p.status === 'pending' && (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                      <input
                        type="datetime-local"
                        defaultValue={fromStored(p.scheduled_for)}
                        onBlur={(e) => { if (e.target.value && toStored(e.target.value) !== p.scheduled_for) reschedule(p.id, e.target.value); }}
                        style={{ fontSize: 11, padding: '3px 6px', width: 170 }}
                        title="Change time"
                      />
                      <button className="ghost" onClick={() => cancel(p.id)} style={tiny}>Cancel</button>
                    </div>
                  )}
                  <button className="ghost" onClick={() => del(p.id)} style={tiny} title="Delete">✕</button>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function Composer({ token, accounts, onDone, onError }) {
  const [form, setForm] = useState({ subreddit: '', title: '', body: '', kind: 'self', url: '', when: '' });
  const [targets, setTargets] = useState([]); // account ids for "send to all"
  const [conflicts, setConflicts] = useState([]);
  const [busy, setBusy] = useState(false);

  // Live conflict preview against the first selected target.
  useEffect(() => {
    if (!targets.length || !form.when) { setConflicts([]); return; }
    let active = true;
    window.api.scheduled.checkConflicts({ token, accountId: targets[0], scheduledFor: toStored(form.when) })
      .then((r) => { if (active && r.ok) setConflicts(r.conflicts || []); });
    return () => { active = false; };
  }, [targets, form.when, token]);

  function toggleTarget(id) {
    setTargets((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]));
  }

  async function submit() {
    if (!targets.length || !form.subreddit || !form.title || !form.when) {
      onError('Pick at least one account, a subreddit, title, and time.');
      return;
    }
    setBusy(true);
    const items = targets.map((accountId) => ({
      accountId,
      subreddit: form.subreddit,
      title: form.title,
      body: form.body,
      kind: form.kind,
      url: form.url,
      scheduledFor: toStored(form.when),
    }));
    const res = await window.api.scheduled.bulkCreate({ token, items });
    setBusy(false);
    if (res.ok) onDone();
    else onError(res.error);
  }

  return (
    <div className="card bordered-glow" style={{ padding: 18, marginBottom: 18 }}>
      <h3 style={{ marginTop: 0, marginBottom: 12 }}>Schedule a post {targets.length > 1 ? `to ${targets.length} accounts` : ''}</h3>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label>Subreddit</label>
          <input placeholder="any subreddit, e.g. AskReddit" value={form.subreddit} onChange={(e) => setForm({ ...form, subreddit: e.target.value })} />
        </div>
        <div>
          <label>When</label>
          <input type="datetime-local" value={form.when} onChange={(e) => setForm({ ...form, when: e.target.value })} />
        </div>
      </div>
      <div style={{ marginTop: 12 }}>
        <label>Title</label>
        <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 12, marginTop: 12 }}>
        <div>
          <label>Type</label>
          <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
            <option value="self">Text</option>
            <option value="link">Link</option>
            <option value="image">Image/Link</option>
          </select>
        </div>
        <div>
          <label>{form.kind === 'self' ? 'Body (optional)' : 'URL'}</label>
          {form.kind === 'self'
            ? <input value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
            : <input placeholder="https://…" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />}
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <label>Accounts {targets.length > 0 && <span className="dim">({targets.length} selected)</span>}</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6, maxHeight: 130, overflowY: 'auto' }}>
          {accounts.map((a) => {
            const on = targets.includes(a.id);
            return (
              <button
                key={a.id}
                onClick={() => toggleTarget(a.id)}
                className={on ? 'primary' : 'ghost'}
                style={{ fontSize: 12, padding: '4px 10px' }}
              >
                {(PLATFORM_ICON[a.platform] || '◈')} {a.username}
              </button>
            );
          })}
        </div>
      </div>

      {conflicts.length > 0 && (
        <div style={{ ...warnBanner, marginTop: 12, marginBottom: 0 }}>
          ⚠ {conflicts.join(' · ')} (you can still schedule it)
        </div>
      )}

      <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
        <button className="primary" onClick={submit} disabled={busy}>
          {busy ? 'Scheduling…' : (targets.length > 1 ? `Schedule to ${targets.length} accounts` : 'Schedule post')}
        </button>
      </div>
    </div>
  );
}

const okBanner = { background: 'rgba(122,154,90,0.12)', border: '1px solid var(--ok)', color: '#bdd5a3', padding: '10px 14px', borderRadius: 4, marginBottom: 12 };
const warnBanner = { background: 'rgba(201,162,39,0.12)', border: '1px solid var(--gold)', color: 'var(--gold-bright)', padding: '10px 14px', borderRadius: 4, marginBottom: 12, fontSize: 13 };
const dayHeader = { fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 6, paddingLeft: 4 };
const row = { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid var(--border)' };
const pill = { fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 999, textTransform: 'uppercase', flexShrink: 0 };
const tiny = { fontSize: 11, padding: '4px 8px' };
