import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { useCan } from '../lib/permissions.jsx';
import PopOutButton from '../components/PopOutButton.jsx';
import { Banner } from '../components/ui.jsx';

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
        <div style={{ marginLeft: 'auto' }}>
          <PopOutButton route="autopilot" title="Autopilot" />
        </div>
      </div>

      {err && <Banner kind="err">{err}</Banner>}
      {msg && <Banner kind="ok">{msg}</Banner>}

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
            <span style={{ ...pill, background: 'rgba(60,110,180,0.15)', color: '#9fc0ea' }}>
              Scaffold · further build coming
            </span>
          </div>
          <div className="muted" style={{ fontSize: 11, marginBottom: 10, lineHeight: 1.5, fontStyle: 'italic' }}>
            Placeholder for the multi-VA workflow — presence, per-account
            ownership leasing, per-VA quotas, and a "who's on which model"
            view will land in a later batch. The local↔cloud switch below is
            wired and works today.
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

      {/* Per-account example library — autopilot seeds Grok with these. */}
      <ExampleLibrary token={token} />

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

function ExampleLibrary({ token }) {
  const [accounts, setAccounts] = useState([]);
  const [accountId, setAccountId] = useState('');
  const [posts, setPosts] = useState([]);
  const [images, setImages] = useState([]);
  const [draft, setDraft] = useState({ title: '', body: '', subreddit: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    window.api.accounts.listForUser({ token }).then((r) => {
      if (r.ok) {
        const list = r.accounts || [];
        setAccounts(list);
        if (!accountId && list.length) setAccountId(String(list[0].id));
      }
    });
  }, [token]);

  const loadFor = useCallback(async (id) => {
    if (!id) { setPosts([]); setImages([]); return; }
    const [p, i] = await Promise.all([
      window.api.examples.listPosts({ token, accountId: Number(id) }),
      window.api.examples.listImages({ token, accountId: Number(id) }),
    ]);
    if (p.ok) setPosts(p.posts || []);
    if (i.ok) setImages(i.images || []);
  }, [token]);

  useEffect(() => { loadFor(accountId); }, [accountId, loadFor]);

  async function addPost() {
    if (!accountId) return;
    if (!draft.title.trim()) { setErr('Title required'); return; }
    setBusy(true);
    const r = await window.api.examples.addPost({ token, accountId: Number(accountId), ...draft });
    setBusy(false);
    if (r.ok) { setDraft({ title: '', body: '', subreddit: '' }); loadFor(accountId); }
    else setErr(r.error);
  }
  async function delPost(id) {
    await window.api.examples.deletePost({ token, id });
    loadFor(accountId);
  }
  async function uploadImage(file) {
    if (!file || !accountId) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const dataBase64 = reader.result.split(',')[1];
      const r = await window.api.examples.addImage({ token, accountId: Number(accountId), fileName: file.name, dataBase64 });
      if (r.ok) loadFor(accountId); else setErr(r.error);
    };
    reader.readAsDataURL(file);
  }
  async function delImage(id) {
    await window.api.examples.deleteImage({ token, id });
    loadFor(accountId);
  }

  return (
    <div className="card" style={{ padding: 18, marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <h3 style={{ margin: 0 }}>Example library</h3>
        <span className="muted" style={{ fontSize: 11 }}>per account — autopilot mirrors these when generating new posts</span>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14 }}>
        <label style={{ fontSize: 12, margin: 0 }}>Account</label>
        <select value={accountId} onChange={(e) => setAccountId(e.target.value)} style={{ minWidth: 280 }}>
          <option value="">— pick an account —</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {(a.platform || 'reddit')} · {a.username}{a.profile_name ? ` · ${a.profile_name}` : ''}
            </option>
          ))}
        </select>
      </div>

      {err && <Banner kind="err">{err}</Banner>}

      {accountId && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
          {/* Example posts */}
          <div>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Example posts ({posts.length})</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
              <input placeholder="Title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
              <input placeholder="r/subreddit (optional)" value={draft.subreddit} onChange={(e) => setDraft({ ...draft, subreddit: e.target.value.replace(/^r\//i, '') })} />
            </div>
            <textarea placeholder="Body (optional)" value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} style={{ minHeight: 60, width: '100%', fontSize: 13 }} />
            <div style={{ marginTop: 8 }}>
              <button className="primary" onClick={addPost} disabled={busy}>+ Add example post</button>
            </div>
            <div style={{ marginTop: 12, maxHeight: 280, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {posts.length === 0
                ? <div className="muted" style={{ fontSize: 12 }}>No example posts yet.</div>
                : posts.map((p) => (
                    <div key={p.id} style={{ background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px' }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                        {p.subreddit && <span className="mono dim" style={{ fontSize: 11 }}>r/{p.subreddit}</span>}
                        <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{p.title}</span>
                        <button className="ghost" onClick={() => delPost(p.id)} style={{ fontSize: 11, padding: '2px 8px' }}>×</button>
                      </div>
                      {p.body && <div className="muted" style={{ fontSize: 12, marginTop: 4, whiteSpace: 'pre-wrap' }}>{p.body}</div>}
                    </div>
                  ))}
            </div>
          </div>

          {/* Example images */}
          <div>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Example images ({images.length})</div>
            <label style={{ display: 'inline-block', cursor: 'pointer', textTransform: 'none', letterSpacing: 0 }}>
              <input
                type="file" accept="image/*" multiple
                onChange={(e) => { for (const f of e.target.files || []) uploadImage(f); e.target.value = ''; }}
                style={{ display: 'none' }}
              />
              <span className="primary" style={{ display: 'inline-block', padding: '6px 12px', borderRadius: 999, fontSize: 12, fontWeight: 600 }}>+ Add image(s)</span>
            </label>
            <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>Pool autopilot draws from for image posts on this account.</div>
            <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, maxHeight: 280, overflowY: 'auto' }}>
              {images.length === 0
                ? <div className="muted" style={{ fontSize: 12, gridColumn: '1 / -1' }}>No example images yet.</div>
                : images.map((img) => (
                    <div key={img.id} style={{ position: 'relative', background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 8, aspectRatio: '1 / 1', overflow: 'hidden' }}>
                      <ImageThumb token={token} id={img.id} />
                      <button onClick={() => delImage(img.id)} style={{
                        position: 'absolute', top: 4, right: 4,
                        background: 'rgba(0,0,0,0.6)', color: '#fff', border: 'none',
                        borderRadius: 999, width: 22, height: 22, cursor: 'pointer', fontSize: 12,
                      }}>×</button>
                    </div>
                  ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ImageThumb({ token, id }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let active = true;
    window.api.examples.readImage({ token, id }).then((r) => {
      if (active && r.ok) setSrc(`data:image/*;base64,${r.dataBase64}`);
    });
    return () => { active = false; };
  }, [token, id]);
  if (!src) return <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', color: 'var(--text-3)', fontSize: 11 }}>…</div>;
  return <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />;
}

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
