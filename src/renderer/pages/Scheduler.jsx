import React, { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';

const KIND_OPTIONS = [
  { v: 'self', label: 'Text post' },
  { v: 'link', label: 'Link post' },
  { v: 'image', label: 'Image post' },
];

const STATUS_STYLES = {
  pending:   { bg: 'rgba(212,166,74,0.12)', fg: 'var(--gold-bright)', border: 'var(--gold)' },
  posted:    { bg: 'rgba(122,154,90,0.12)', fg: '#bdd5a3', border: 'var(--green)' },
  failed:    { bg: 'rgba(179,71,58,0.12)', fg: '#f4b8af', border: 'var(--danger)' },
  cancelled: { bg: 'rgba(255,255,255,0.04)', fg: 'var(--text-2)', border: 'var(--border-strong)' },
};

export default function SchedulerPage({ embedded }) {
  const { token } = useAuth();
  const [posts, setPosts] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    account_id: '', subreddit: '', title: '', body: '', kind: 'self', url: '', date: '', time: '',
  });
  const [err, setErr] = useState(null);

  async function load() {
    const [s, a] = await Promise.all([
      window.api.scheduled.list({ token }),
      window.api.accounts.listForUser({ token }),
    ]);
    if (s.ok) setPosts(s.posts);
    if (a.ok) setAccounts(a.accounts.filter(x => x.platform !== 'redgifs'));
  }
  useEffect(() => { load(); }, [token]);

  function reset() {
    setForm({ account_id: '', subreddit: '', title: '', body: '', kind: 'self', url: '', date: '', time: '' });
    setErr(null);
  }

  async function submit(e) {
    e.preventDefault();
    setErr(null);
    if (!form.account_id || !form.subreddit || !form.title || !form.date || !form.time) {
      setErr('Account, subreddit, title, date and time are required'); return;
    }
    const scheduledFor = new Date(`${form.date}T${form.time}`).toISOString();
    const res = await window.api.scheduled.create({
      token,
      accountId: Number(form.account_id),
      subreddit: form.subreddit,
      title: form.title,
      body: form.body,
      kind: form.kind,
      url: form.url || null,
      scheduledFor,
    });
    if (!res.ok) { setErr(res.error); return; }
    setShowForm(false);
    reset();
    load();
  }

  async function cancel(id) {
    if (!confirm('Cancel this scheduled post?')) return;
    await window.api.scheduled.cancel({ token, id });
    load();
  }

  async function del(id) {
    if (!confirm('Delete this entry?')) return;
    await window.api.scheduled.delete({ token, id });
    load();
  }

  const pending = posts.filter(p => p.status === 'pending');
  const past = posts.filter(p => p.status !== 'pending');

  return (
    <div>
      <div className="title-block" style={{ justifyContent: 'space-between' }}>
        {embedded ? <div /> : (
          <div>
            <div className="eyebrow">Scheduled posts</div>
            <h1>Scheduler</h1>
            <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
              Plan posts ahead of time. Actual publishing to Reddit needs OAuth setup (next release) — until then, scheduled posts show up here as a queue the VA can post manually.
            </div>
          </div>
        )}
        <button className="primary" onClick={() => { setShowForm(v => !v); if (showForm) reset(); }}>
          {showForm ? 'Cancel' : '+ Schedule post'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={submit} className="card" style={{ marginBottom: 18 }}>
          {err && <div className="error-banner">{err}</div>}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label>Account</label>
              <select value={form.account_id} onChange={(e) => setForm({ ...form, account_id: e.target.value })}>
                <option value="">— pick an account —</option>
                {accounts.map(a => <option key={a.id} value={a.id}>u/{a.username} {a.profile_name ? `· ${a.profile_name}` : ''}</option>)}
              </select>
            </div>
            <div>
              <label>Subreddit</label>
              <input value={form.subreddit} onChange={(e) => setForm({ ...form, subreddit: e.target.value })} placeholder="e.g. AskReddit" />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label>Title</label>
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={300} />
            </div>
            <div>
              <label>Kind</label>
              <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                {KIND_OPTIONS.map(k => <option key={k.v} value={k.v}>{k.label}</option>)}
              </select>
            </div>
            {form.kind === 'link' && (
              <div>
                <label>URL</label>
                <input type="url" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://…" />
              </div>
            )}
            {form.kind === 'self' && (
              <div style={{ gridColumn: '1 / -1' }}>
                <label>Body</label>
                <textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} style={{ minHeight: 120 }} />
              </div>
            )}
            <div>
              <label>Date</label>
              <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </div>
            <div>
              <label>Time</label>
              <input type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} />
            </div>
          </div>
          <button type="submit" className="primary">Schedule</button>
        </form>
      )}

      <Section title="Upcoming" posts={pending} empty="Nothing scheduled." onCancel={cancel} onDelete={del} />
      <Section title="History" posts={past} empty="No past posts." onCancel={cancel} onDelete={del} historical />
    </div>
  );
}

function Section({ title, posts, empty, onCancel, onDelete, historical }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <h3 style={{ marginBottom: 10 }}>{title} <span className="mono dim" style={{ fontSize: 12 }}>{posts.length}</span></h3>
      {posts.length === 0 ? (
        <div className="empty-state" style={{ padding: 22, fontSize: 13 }}>{empty}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {posts.map(p => {
            const s = STATUS_STYLES[p.status] || STATUS_STYLES.pending;
            return (
              <div key={p.id} className="card" style={{ padding: 14, display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'center' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                    <span style={{ ...statusPill, background: s.bg, color: s.fg, border: `1px solid ${s.border}` }}>{p.status}</span>
                    <span className="mono dim" style={{ fontSize: 12 }}>r/{p.subreddit} · u/{p.account_username}{p.profile_name ? ` · ${p.profile_name}` : ''}</span>
                    <span className="mono dim" style={{ fontSize: 12 }}>{new Date(p.scheduled_for).toLocaleString()}</span>
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{p.title}</div>
                  {p.error && <div className="error-banner" style={{ marginTop: 6, marginBottom: 0, fontSize: 12 }}>{p.error}</div>}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {p.status === 'pending' && <button className="ghost" onClick={() => onCancel(p.id)}>Cancel</button>}
                  {historical && <button className="danger" onClick={() => onDelete(p.id)}>Delete</button>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const statusPill = {
  display: 'inline-flex', alignItems: 'center',
  padding: '2px 8px', borderRadius: 999,
  fontFamily: 'var(--font-mono)', fontSize: 10,
  textTransform: 'uppercase', letterSpacing: '0.06em',
};
