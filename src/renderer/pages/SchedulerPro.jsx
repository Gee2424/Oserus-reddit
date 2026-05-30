import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { useActiveAccount } from '../lib/activeAccount.jsx';
import PopOutButton from '../components/PopOutButton.jsx';
import { Banner } from '../components/ui.jsx';

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

const PRO_TABS = [
  { key: 'configure',    icon: '⚙', title: 'Configure Pro Schedules', desc: 'Create and manage schedule templates' },
  { key: 'run',          icon: '▷', title: 'Run Pro Schedules',       desc: 'Select accounts and schedules, then start execution' },
  { key: 'monitor',      icon: '◉', title: 'Monitor Pro Schedules',   desc: 'Watch status and logs of running schedules' },
  { key: 'replenish',    icon: '⊕', title: 'Realtime Replenishment',  desc: 'Replace banned accounts with backups in realtime' },
];

export default function SchedulerProPage() {
  const { token } = useAuth();
  const { accounts } = useActiveAccount();

  const [proTab, setProTab] = useState('configure');
  const [posts, setPosts] = useState([]);
  const [filters, setFilters] = useState({ platform: '', profileId: '', accountId: '', status: '' });
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);
  const [showCompose, setShowCompose] = useState(false);
  const [showAI, setShowAI] = useState(false);

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
        <div style={{ display: 'flex', gap: 8 }}>
          <PopOutButton route="scheduler-pro" title="Scheduler Pro" />
          <button className="ghost" onClick={() => setShowAI((v) => !v)}>{showAI ? 'Close AI' : '✦ AI Settings'}</button>
          <button className="primary" onClick={() => setShowCompose((v) => !v)}>
            {showCompose ? 'Close' : '+ Schedule posts'}
          </button>
        </div>
      </div>

      {err && <Banner kind="err">{err}</Banner>}
      {msg && <Banner kind="ok">{msg}</Banner>}
      {pendingConflicts > 0 && (
        <div style={warnBanner}>⚠ {pendingConflicts} scheduled post{pendingConflicts > 1 ? 's' : ''} conflict with posting protocols.</div>
      )}

      {/* Pro-tab selector cards */}
      <div style={proTabRow}>
        {PRO_TABS.map((t) => (
          <button key={t.key} onClick={() => setProTab(t.key)}
            style={{ ...proTabCard, ...(proTab === t.key ? proTabCardActive : {}) }}>
            <span style={{ fontSize: 18, color: 'var(--gold)' }}>{t.icon}</span>
            <div style={{ marginTop: 8, fontSize: 13, fontWeight: 600, color: 'var(--text-0)' }}>{t.title}</div>
            <div style={{ marginTop: 2, fontSize: 11, color: 'var(--text-2)', lineHeight: 1.4 }}>{t.desc}</div>
          </button>
        ))}
      </div>

      {proTab === 'run' && <RunProSchedules token={token} accounts={accounts} onMsg={setMsg} onError={setErr} />}
      {proTab === 'monitor' && <MonitorProSchedules token={token} />}
      {proTab === 'replenish' && <ReplenishProSchedules accounts={accounts} posts={posts} />}

      {proTab !== 'configure' ? null : <>

      {showAI && <AISettings token={token} onMsg={setMsg} onError={setErr} />}

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
      </>}
    </div>
  );
}

/* --------------------- Run / Monitor / Replenishment --------------------- */

function RunProSchedules({ token, accounts, onMsg, onError }) {
  const [templates, setTemplates] = useState([]);
  const [showCreate, setShowCreate] = useState(false);

  const load = async () => {
    const r = await window.api.templates.list({ token });
    if (r.ok) setTemplates(r.templates || []);
  };
  useEffect(() => {
    load();
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
    /* eslint-disable-next-line */
  }, [token]);

  async function start(id) {
    const r = await window.api.templates.start({ token, id });
    if (r.ok) { onMsg(`Started — ${r.created} posts queued.`); load(); } else onError(r.error);
  }
  async function stop(id) {
    const r = await window.api.templates.stop({ token, id });
    if (r.ok) { onMsg(`Stopped — ${r.cancelled} pending posts cancelled.`); load(); } else onError(r.error);
  }
  async function del(id) {
    if (!confirm('Delete this template? Pending posts from it will be cancelled.')) return;
    const r = await window.api.templates.delete({ token, id });
    if (r.ok) { load(); } else onError(r.error);
  }

  return (
    <div>
      <SectionHeader title="Run Pro Schedules" desc="Templates bundle accounts + subreddits + cadence. Start spreads a batch of posts across the cadence window; Stop cancels its remaining pending posts." />
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
        <button className="primary" onClick={() => setShowCreate((v) => !v)}>{showCreate ? 'Close' : '+ New Template'}</button>
      </div>
      {showCreate && (
        <TemplateForm token={token} accounts={accounts}
          onDone={() => { setShowCreate(false); onMsg('Template saved.'); load(); }}
          onError={onError} />
      )}
      {templates.length === 0 ? (
        <div className="card" style={{ padding: 30, textAlign: 'center', color: 'var(--text-2)' }}>
          No templates yet. Create one above to bundle accounts × subreddits × cadence.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
          {templates.map((t) => {
            const running = t.status === 'running' || t.pendingPosts > 0;
            return (
              <div key={t.id} style={{ ...runCard, borderColor: running ? 'var(--green)' : 'var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: running ? 'var(--green-bright)' : 'var(--text-3)', boxShadow: running ? '0 0 8px var(--green-bright)' : 'none' }} />
                  <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-0)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
                  <button className="ghost" onClick={() => del(t.id)} title="Delete template" style={{ fontSize: 11, padding: '3px 8px' }}>✕</button>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.6 }}>
                  {t.accountIds.length} account{t.accountIds.length === 1 ? '' : 's'} · {t.subreddits.length} subreddit{t.subreddits.length === 1 ? '' : 's'}<br />
                  Cadence {t.cadenceMinH}–{t.cadenceMaxH}h · {t.postsPerAccount}/account<br />
                  Pending: <span style={{ color: t.pendingPosts > 0 ? 'var(--gold)' : 'var(--text-3)' }}>{t.pendingPosts}</span>
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
                  {running
                    ? <button className="danger" onClick={() => stop(t.id)} style={{ flex: 1 }}>Stop</button>
                    : <button className="primary" onClick={() => start(t.id)} style={{ flex: 1 }}>▷ Start</button>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TemplateForm({ token, accounts, onDone, onError }) {
  const [name, setName] = useState('');
  const [subs, setSubs] = useState('');
  const [accIds, setAccIds] = useState([]);
  const [minH, setMinH] = useState(4);
  const [maxH, setMaxH] = useState(8);
  const [perAccount, setPerAccount] = useState(3);
  const [busy, setBusy] = useState(false);

  function toggleAcc(id) {
    setAccIds((cur) => cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  }
  async function save() {
    setBusy(true);
    const r = await window.api.templates.create({
      token, name, accountIds: accIds,
      subreddits: subs.split(/[\n,]/).map((s) => s.trim()).filter(Boolean),
      cadenceMinH: Number(minH), cadenceMaxH: Number(maxH),
      postsPerAccount: Number(perAccount),
    });
    setBusy(false);
    if (r.ok) onDone(); else onError(r.error);
  }

  return (
    <div className="card bordered-glow" style={{ padding: 18, marginBottom: 16 }}>
      <h3 style={{ marginTop: 0, marginBottom: 14 }}>New Template</h3>
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14 }}>
        <div>
          <label>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Mia · main run" />
        </div>
        <div>
          <label>Posts per account</label>
          <input type="number" min={1} value={perAccount} onChange={(e) => setPerAccount(e.target.value)} />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 12 }}>
        <div>
          <label>Cadence min (hours)</label>
          <input type="number" min={0.25} step={0.25} value={minH} onChange={(e) => setMinH(e.target.value)} />
        </div>
        <div>
          <label>Cadence max (hours)</label>
          <input type="number" min={0.5} step={0.25} value={maxH} onChange={(e) => setMaxH(e.target.value)} />
        </div>
      </div>
      <div style={{ marginTop: 14 }}>
        <label>Subreddits (one per line, no r/)</label>
        <textarea value={subs} onChange={(e) => setSubs(e.target.value)} style={{ minHeight: 90, fontFamily: 'var(--font-mono)', fontSize: 13 }} placeholder={'gonewild\ntittydrop\nnsfw'} />
      </div>
      <div style={{ marginTop: 14 }}>
        <label>Accounts {accIds.length > 0 && <span className="dim">({accIds.length} selected)</span>}</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 130, overflowY: 'auto', marginTop: 6 }}>
          {accounts.filter((a) => (a.platform || 'reddit') === 'reddit').map((a) => {
            const on = accIds.includes(a.id);
            return (
              <button key={a.id} onClick={() => toggleAcc(a.id)} className={on ? 'primary' : 'ghost'} style={{ fontSize: 12, padding: '4px 10px' }}>
                u/{a.username}
              </button>
            );
          })}
        </div>
      </div>
      <button className="primary" onClick={save} disabled={busy || !name.trim()} style={{ marginTop: 14 }}>
        {busy ? 'Saving…' : 'Save Template'}
      </button>
    </div>
  );
}

function MonitorProSchedules({ token }) {
  const [events, setEvents] = useState([]);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const r = await window.api.protocols.events({ token, limit: 100 });
      if (!cancelled && r.ok) setEvents(r.events || []);
    };
    load();
    const id = setInterval(load, 8000);
    return () => { cancelled = true; clearInterval(id); };
  }, [token]);

  return (
    <div>
      <SectionHeader title="Monitor Pro Schedules" desc="Live console of every autopilot / scheduled post the app has handled. Refreshes every ~8s." />
      <div style={consoleBox}>
        {events.length === 0 && <div style={{ color: 'var(--text-3)' }}>No events yet.</div>}
        {events.map((e) => (
          <div key={e.id} style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
            <span style={{ color: e.status === 'posted' ? '#7fd99a' : e.status === 'failed' ? '#e2a3a3' : 'var(--text-3)' }}>●</span>
            <span className="mono" style={{ color: 'var(--text-3)' }}>{(e.created_at || '').replace(' ', ' ')}</span>
            <span className="mono" style={{ color: 'var(--text-2)' }}>{e.source}</span>
            <span style={{ color: 'var(--gold)' }}>r/{e.subreddit || '—'}</span>
            <span style={{ color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{e.title || e.error || '—'}</span>
            <span style={{ color: 'var(--text-3)' }}>u/{e.account_username || e.account_id}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ReplenishProSchedules({ accounts, posts }) {
  const pendingByAccount = new Set(posts.filter((p) => p.status === 'pending').map((p) => p.account_id));
  const operating = accounts.filter((a) => pendingByAccount.has(a.id) && a.status !== 'banned');
  const banned = accounts.filter((a) => a.status === 'banned');
  const backup = accounts.filter((a) => a.status === 'warming' && !pendingByAccount.has(a.id));

  return (
    <div>
      <SectionHeader title="Realtime Replenishment" desc="Spot banned accounts in your schedules and swap in warming/backup accounts." />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <ReplenishCol title={`Operating · ${operating.length}`} accounts={operating} statusLabel="LIVE" statusFg="#7fd99a" />
        <ReplenishCol title={`Banned · ${banned.length}`} accounts={banned} statusLabel="BANNED" statusFg="#e2a3a3" />
      </div>
      <div style={{ marginTop: 14 }}>
        <ReplenishCol title={`Backup pool (warming) · ${backup.length}`} accounts={backup} statusLabel="WARMING" statusFg="var(--gold)" />
      </div>
    </div>
  );
}

function ReplenishCol({ title, accounts, statusLabel, statusFg }) {
  return (
    <div className="card" style={{ padding: 14 }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 10 }}>{title}</div>
      {accounts.length === 0
        ? <div style={{ color: 'var(--text-3)', fontSize: 12 }}>None.</div>
        : accounts.map((a) => (
          <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderTop: '1px solid var(--border)' }}>
            <span style={{ fontSize: 13 }}>u/{a.username}</span>
            <span style={{ marginLeft: 'auto', fontSize: 10, color: statusFg, fontWeight: 700, letterSpacing: '0.05em' }}>{statusLabel}</span>
          </div>
        ))}
    </div>
  );
}

function SectionHeader({ title, desc }) {
  return (
    <div className="card" style={{ padding: '14px 18px', marginBottom: 14, background: 'linear-gradient(135deg, rgba(58,111,140,0.10), transparent)' }}>
      <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-0)' }}>{title}</div>
      {desc && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{desc}</div>}
    </div>
  );
}

const proTabRow = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginBottom: 18 };
const proTabCard = {
  background: 'var(--bg-elev)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
  padding: 14, textAlign: 'left', cursor: 'pointer', display: 'flex', flexDirection: 'column',
};
const proTabCardActive = {
  borderColor: 'var(--blue)',
  background: 'linear-gradient(135deg, rgba(58,111,140,0.16), rgba(212,166,74,0.06))',
  boxShadow: 'inset 0 0 0 1px var(--blue)',
};
const runCard = {
  background: 'var(--bg-elev)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
  padding: 12, boxShadow: '0 0 12px -8px var(--green-glow)',
};
const consoleBox = {
  background: '#0a0a0a', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)',
  padding: 14, fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-1)',
  maxHeight: '60vh', overflowY: 'auto',
};

function Toggle({ label, value, onChange }) {
  return (
    <button
      onClick={() => onChange(!value)}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
        background: 'transparent', border: '1px solid var(--border)', borderRadius: 8,
        color: 'var(--text-1)', cursor: 'pointer', textAlign: 'left',
      }}
    >
      <span style={{
        width: 32, height: 18, borderRadius: 999, position: 'relative', flexShrink: 0,
        background: value ? 'var(--blue)' : 'var(--bg-3)',
        border: '1px solid ' + (value ? 'var(--blue-bright)' : 'var(--border-strong)'),
        transition: 'background 0.15s, border-color 0.15s',
      }}>
        <span style={{
          position: 'absolute', top: 1, left: value ? 14 : 1,
          width: 14, height: 14, borderRadius: '50%', background: '#fff',
          transition: 'left 0.15s',
        }} />
      </span>
      <span style={{ fontSize: 12 }}>{label}</span>
    </button>
  );
}

function AISettings({ token, onMsg, onError }) {
  const [cfg, setCfg] = useState({
    mode: 'assistive', gender: 'female', age: '20', location: '',
    titleMin: 3, titleMax: 8, model: 'grok-2-latest', customPrompt: '',
    nightInfo: '', ctaInfo: '', typoRate: 0,
    matchCity: false, randomCta: true, detectLanguage: false,
    customCtas: [], // [{ platform, url }]
  });
  const [hasKey, setHasKey] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    window.api.aiconfig.get({ token }).then((r) => { if (r.ok && r.config) setCfg((c) => ({ ...c, ...r.config })); });
    window.api.ai.hasApiKey({ token }).then((r) => setHasKey(!!(r.ok && r.hasKey)));
  }, [token]);

  async function save() {
    setBusy(true);
    const res = await window.api.aiconfig.set({ token, config: cfg });
    setBusy(false);
    if (res.ok) onMsg('AI settings saved.'); else onError(res.error);
  }

  const set = (k, v) => setCfg((c) => ({ ...c, [k]: v }));

  return (
    <div className="card bordered-glow" style={{ padding: 18, marginBottom: 18 }}>
      <h3 style={{ marginTop: 0, marginBottom: 4 }}>AI Settings</h3>
      <div style={{ fontSize: 12, color: hasKey ? '#bdd5a3' : 'var(--gold)', marginBottom: 14 }}>
        {hasKey ? '✓ Grok API is configured and ready to use.' : '⚠ No Grok key yet — add one in Configuration.'}
      </div>

      <label>AI mode</label>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        {[
          { v: 'none', l: 'No AI', d: 'Use captions from vault only' },
          { v: 'assistive', l: 'Assistive', d: 'Tweak captions to match subreddit rules' },
          { v: 'creator', l: 'Creator', d: 'Generate titles with AI' },
        ].map((m) => (
          <button key={m.v} onClick={() => set('mode', m.v)} title={m.d}
            className={cfg.mode === m.v ? 'primary' : 'ghost'} style={{ flex: 1, flexDirection: 'column', alignItems: 'flex-start', padding: '10px 12px' }}>
            <span style={{ fontWeight: 600 }}>{m.l}</span>
            <span style={{ fontSize: 10, opacity: 0.8, marginTop: 2 }}>{m.d}</span>
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 14 }}>
        <div>
          <label>Poster gender</label>
          <select value={cfg.gender} onChange={(e) => set('gender', e.target.value)}>
            <option value="female">Female</option>
            <option value="male">Male</option>
          </select>
        </div>
        <div>
          <label>Poster age</label>
          <input type="number" min={18} value={cfg.age} onChange={(e) => set('age', e.target.value)} />
        </div>
        <div>
          <label>Location (city or country)</label>
          <input value={cfg.location} placeholder="e.g. Arizona" onChange={(e) => set('location', e.target.value)} />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 14 }}>
        <div>
          <label>Title length min (words)</label>
          <input type="number" min={1} value={cfg.titleMin} onChange={(e) => set('titleMin', e.target.value)} />
        </div>
        <div>
          <label>Title length max (words)</label>
          <input type="number" min={1} value={cfg.titleMax} onChange={(e) => set('titleMax', e.target.value)} />
        </div>
        <div>
          <label>Grok model</label>
          <input value={cfg.model} onChange={(e) => set('model', e.target.value)} placeholder="grok-2-latest" />
        </div>
      </div>

      <label>System prompt override (optional)</label>
      <textarea
        value={cfg.customPrompt}
        onChange={(e) => set('customPrompt', e.target.value)}
        placeholder="Leave blank to use the built-in prompt. Add instructions here to override per your needs."
        style={{ minHeight: 90, fontSize: 13 }}
      />

      <div style={{ borderTop: '1px solid var(--border)', marginTop: 22, paddingTop: 18 }}>
        <h3 style={{ marginTop: 0, marginBottom: 4 }}>CTA & Persona Details</h3>
        <div className="muted" style={{ fontSize: 12, marginBottom: 16 }}>
          Optional context the AI weaves into generated posts/comments (no
          field is required).
        </div>

        <label>Setting / night info</label>
        <textarea
          value={cfg.nightInfo}
          onChange={(e) => set('nightInfo', e.target.value)}
          placeholder="e.g. You finished your homework. You are now bored and lonely cleaning your bedroom."
          style={{ minHeight: 70, fontSize: 13, marginBottom: 14 }}
        />

        <label>CTA info</label>
        <textarea
          value={cfg.ctaInfo}
          onChange={(e) => set('ctaInfo', e.target.value)}
          placeholder="e.g. Your page is $3 a month. You post full nude videos. You are active every day…"
          style={{ minHeight: 70, fontSize: 13, marginBottom: 14 }}
        />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
          <div>
            <label>Typo rate (0–1)</label>
            <input
              type="number" min={0} max={1} step={0.05}
              value={cfg.typoRate}
              onChange={(e) => set('typoRate', Number(e.target.value))}
            />
            <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
              0 = perfect grammar. 0.2 ≈ occasional realistic typo.
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, justifyContent: 'center' }}>
            <Toggle label="Match city / location"   value={cfg.matchCity}      onChange={(v) => set('matchCity', v)} />
            <Toggle label="Choose random CTA"       value={cfg.randomCta}      onChange={(v) => set('randomCta', v)} />
            <Toggle label="Detect language"         value={cfg.detectLanguage} onChange={(v) => set('detectLanguage', v)} />
          </div>
        </div>

        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <span style={{ fontWeight: 600 }}>Use Custom CTA Data</span>
            <span className="muted" style={{ fontSize: 11 }}>
              If provided, these replace the CTAs saved to your preset.
            </span>
          </div>
          {cfg.customCtas.length === 0 && (
            <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>No custom CTAs yet.</div>
          )}
          {cfg.customCtas.map((c, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 2fr auto', gap: 8, marginBottom: 8 }}>
              <input
                placeholder="platform (e.g. onlyfans)"
                value={c.platform}
                onChange={(e) => { const list = [...cfg.customCtas]; list[i] = { ...list[i], platform: e.target.value }; set('customCtas', list); }}
              />
              <input
                placeholder="URL or handle"
                value={c.url}
                onChange={(e) => { const list = [...cfg.customCtas]; list[i] = { ...list[i], url: e.target.value }; set('customCtas', list); }}
              />
              <button className="danger" onClick={() => set('customCtas', cfg.customCtas.filter((_, j) => j !== i))}>Remove</button>
            </div>
          ))}
          <button className="ghost" onClick={() => set('customCtas', [...cfg.customCtas, { platform: '', url: '' }])} style={{ marginTop: 4 }}>
            + Add CTA Entry
          </button>
        </div>
      </div>

      <button className="primary" onClick={save} disabled={busy} style={{ marginTop: 14 }}>
        {busy ? 'Saving…' : 'Save AI settings'}
      </button>
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

const warnBanner = { background: 'rgba(201,162,39,0.12)', border: '1px solid var(--gold)', color: 'var(--gold-bright)', padding: '10px 14px', borderRadius: 4, marginBottom: 12, fontSize: 13 };
const dayHeader = { fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 6, paddingLeft: 4 };
const row = { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid var(--border)' };
const pill = { fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 999, textTransform: 'uppercase', flexShrink: 0 };
const tiny = { fontSize: 11, padding: '4px 8px' };
