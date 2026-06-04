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

      {canManage && <AdminSetupPanel token={token} />}
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

      {/* Unified per-profile-per-platform autopilot: scroll + like + follow
          + AI commenting, with targeting + persona. Replaces the old
          per-account Engagement and Auto-comment panels. */}
      <AutopilotProtocolPanel token={token} />

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
  const [platformFilter, setPlatformFilter] = useState('all');
  const [accountId, setAccountId] = useState('');
  const [posts, setPosts] = useState([]);
  const [images, setImages] = useState([]);
  const [comments, setComments] = useState([]);
  const [draft, setDraft] = useState({ title: '', body: '', subreddit: '' });
  const [commentDraft, setCommentDraft] = useState({ parentTitle: '', parentBody: '', parentUrl: '', subreddit: '', commentBody: '' });
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

  // Visible accounts respect the platform filter.
  const visibleAccounts = (platformFilter === 'all')
    ? accounts
    : accounts.filter((a) => (a.platform || 'reddit') === platformFilter);

  useEffect(() => {
    // If the filter hides the current account, pick the first visible one.
    if (!visibleAccounts.find((a) => String(a.id) === String(accountId))) {
      setAccountId(visibleAccounts[0] ? String(visibleAccounts[0].id) : '');
    }
  }, [platformFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadFor = useCallback(async (id) => {
    if (!id) { setPosts([]); setImages([]); setComments([]); return; }
    const [p, i, c] = await Promise.all([
      window.api.examples.listPosts({ token, accountId: Number(id) }),
      window.api.examples.listImages({ token, accountId: Number(id) }),
      window.api.examples.listComments({ token, accountId: Number(id) }),
    ]);
    if (p.ok) setPosts(p.posts || []);
    if (i.ok) setImages(i.images || []);
    if (c.ok) setComments(c.comments || []);
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
  async function addComment() {
    if (!accountId) return;
    if (!commentDraft.parentTitle.trim() || !commentDraft.commentBody.trim()) {
      setErr('Parent post title and your reply are required.'); return;
    }
    setBusy(true);
    const r = await window.api.examples.addComment({ token, accountId: Number(accountId), ...commentDraft });
    setBusy(false);
    if (r.ok) { setCommentDraft({ parentTitle: '', parentBody: '', parentUrl: '', subreddit: '', commentBody: '' }); loadFor(accountId); }
    else setErr(r.error);
  }
  async function delComment(id) {
    await window.api.examples.deleteComment({ token, id });
    loadFor(accountId);
  }

  return (
    <div className="card" style={{ padding: 18, marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <h3 style={{ margin: 0 }}>Example library</h3>
        <span className="muted" style={{ fontSize: 11 }}>per account — autopilot mirrors these when generating new posts</span>
      </div>
      <PlatformFilter value={platformFilter} onChange={setPlatformFilter} />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14 }}>
        <label style={{ fontSize: 12, margin: 0 }}>Account</label>
        <select value={accountId} onChange={(e) => setAccountId(e.target.value)} style={{ minWidth: 320 }}>
          <option value="">— pick an account —</option>
          {visibleAccounts.map((a) => (
            <option key={a.id} value={a.id}>
              {(a.platform || 'reddit')} · {a.username}{a.profile_name ? ` · ${a.profile_name}` : ''}
            </option>
          ))}
        </select>
      </div>

      {err && <Banner kind="err">{err}</Banner>}

      {accountId && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 18 }}>
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
            <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8, maxHeight: 280, overflowY: 'auto' }}>
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

          {/* Example comments — pairs of (parent post) + (this account's reply)
              so autopilot learns how this voice forms opinions, not just style. */}
          <div>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Example comments ({comments.length})</div>
            <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>
              Paste the post + your reply. Autopilot reads both so it learns the angle this account takes.
            </div>
            <input placeholder="Parent post title" value={commentDraft.parentTitle}
              onChange={(e) => setCommentDraft({ ...commentDraft, parentTitle: e.target.value })} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 6 }}>
              <input placeholder="r/subreddit (optional)" value={commentDraft.subreddit}
                onChange={(e) => setCommentDraft({ ...commentDraft, subreddit: e.target.value.replace(/^r\//i, '') })} />
              <input placeholder="Post URL (optional)" value={commentDraft.parentUrl}
                onChange={(e) => setCommentDraft({ ...commentDraft, parentUrl: e.target.value })} />
            </div>
            <textarea placeholder="Parent post body (optional)" value={commentDraft.parentBody}
              onChange={(e) => setCommentDraft({ ...commentDraft, parentBody: e.target.value })}
              style={{ minHeight: 50, width: '100%', fontSize: 12, marginTop: 6 }} />
            <textarea placeholder="Your reply (required)" value={commentDraft.commentBody}
              onChange={(e) => setCommentDraft({ ...commentDraft, commentBody: e.target.value })}
              style={{ minHeight: 60, width: '100%', fontSize: 13, marginTop: 6 }} />
            <div style={{ marginTop: 8 }}>
              <button className="primary" onClick={addComment} disabled={busy}>+ Add example comment</button>
            </div>
            <div style={{ marginTop: 12, maxHeight: 280, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {comments.length === 0
                ? <div className="muted" style={{ fontSize: 12 }}>No example comments yet.</div>
                : comments.map((c) => (
                    <div key={c.id} style={{ background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px' }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                        {c.subreddit && <span className="mono dim" style={{ fontSize: 11 }}>r/{c.subreddit}</span>}
                        <span style={{ fontSize: 12, fontWeight: 600, flex: 1 }}>{c.parent_title}</span>
                        <button className="ghost" onClick={() => delComment(c.id)} style={{ fontSize: 11, padding: '2px 8px' }}>×</button>
                      </div>
                      {c.parent_body && <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>{String(c.parent_body).slice(0, 140)}</div>}
                      <div style={{ fontSize: 12, marginTop: 6, padding: '6px 8px', background: 'var(--bg-elev)', borderRadius: 6, whiteSpace: 'pre-wrap' }}>
                        ↳ {c.comment_body}
                      </div>
                    </div>
                  ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Admin-only setup panel — warmup subreddit pool + live status snapshot for
// every account. One screen so the admin can manage the autopilot's
// global inputs and see who's healthy / banned / paused at a glance.
function AdminSetupPanel({ token }) {
  const [warmupSubs, setWarmupSubs] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [newSub, setNewSub] = useState({ name: '', vibe: '', description: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [open, setOpen] = useState(true);

  const load = useCallback(async () => {
    const [s, a] = await Promise.all([
      window.api.subs.listWarmup({ token }),
      window.api.accounts.listForUser({ token }),
    ]);
    if (s.ok) setWarmupSubs(s.subs || []);
    if (a.ok) setAccounts(a.accounts || []);
  }, [token]);
  useEffect(() => { load(); }, [load]);

  async function addSub() {
    if (!newSub.name.trim()) return;
    setBusy(true); setErr(null);
    const clean = newSub.name.trim().replace(/^\/?r\//i, '').replace(/\/.*$/, '');
    const r = await window.api.subs.createWarmup({ token, name: clean, vibe: newSub.vibe || null, description: newSub.description || null });
    setBusy(false);
    if (r.ok) { setNewSub({ name: '', vibe: '', description: '' }); load(); }
    else setErr(r.error);
  }
  async function delSub(id) {
    await window.api.subs.deleteWarmup({ token, id });
    load();
  }

  // Aggregate counts so the admin sees the funnel at a glance.
  const counts = accounts.reduce((m, a) => {
    const k = a.status || 'unknown';
    m[k] = (m[k] || 0) + 1;
    return m;
  }, {});
  const byPlatform = accounts.reduce((m, a) => {
    const k = a.platform || 'reddit';
    m[k] = (m[k] || 0) + 1;
    return m;
  }, {});

  return (
    <div className="card" style={{ padding: 18, marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <h3 style={{ margin: 0 }}>Admin setup</h3>
        <span className="muted" style={{ fontSize: 11 }}>warm-up pool + agency-wide account snapshot</span>
        <button className="ghost" style={{ marginLeft: 'auto', fontSize: 12 }} onClick={() => setOpen((v) => !v)}>
          {open ? '− Collapse' : '+ Expand'}
        </button>
      </div>

      {open && (
        <>
          {err && <Banner kind="err">{err}</Banner>}

          {/* Status snapshot tiles */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginTop: 14 }}>
            {[
              { l: 'Warming', k: 'warming', tone: '#d4a64a' },
              { l: 'Ready',   k: 'ready',   tone: '#7fd99a' },
              { l: 'Paused',  k: 'paused',  tone: '#9aa0a6' },
              { l: 'Banned',  k: 'banned',  tone: '#e2a3a3' },
            ].map((s) => (
              <div key={s.k} style={{ background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px' }}>
                <div style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>{s.l}</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: s.tone, marginTop: 4 }}>{counts[s.k] || 0}</div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            {Object.entries(byPlatform).map(([p, n]) => (
              <span key={p} className="mono" style={{ fontSize: 11, padding: '3px 9px', borderRadius: 999, background: 'var(--bg-1)', border: '1px solid var(--border)', color: 'var(--text-2)' }}>
                {p}: {n}
              </span>
            ))}
          </div>

          {/* Warmup subreddit pool */}
          <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
              Warm-up subreddit pool <span className="muted" style={{ fontWeight: 400, fontSize: 11 }}>({warmupSubs.length}) — autopilot picks from here for warming-status accounts</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 2fr auto', gap: 8 }}>
              <input placeholder="subreddit name" value={newSub.name} onChange={(e) => setNewSub({ ...newSub, name: e.target.value })} />
              <input placeholder="vibe (e.g. ask, chat, niche)" value={newSub.vibe} onChange={(e) => setNewSub({ ...newSub, vibe: e.target.value })} />
              <input placeholder="description (optional)" value={newSub.description} onChange={(e) => setNewSub({ ...newSub, description: e.target.value })} />
              <button className="primary" onClick={addSub} disabled={busy || !newSub.name.trim()}>+ Add</button>
            </div>
            <div style={{ marginTop: 10, maxHeight: 260, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {warmupSubs.length === 0
                ? <div className="muted" style={{ fontSize: 12 }}>No warm-up subs yet. Add a few mainstream subs (AskReddit, casualconversation, etc.).</div>
                : warmupSubs.map((s) => (
                    <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, padding: '5px 10px', background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 6 }}>
                      <span className="mono" style={{ minWidth: 160, color: 'var(--text-1)' }}>r/{s.name}</span>
                      {s.vibe && <span className="dim" style={{ fontSize: 11 }}>{s.vibe}</span>}
                      {s.description && <span className="muted" style={{ fontSize: 11, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.description}</span>}
                      <button className="ghost" onClick={() => delSub(s.id)} style={{ marginLeft: 'auto', fontSize: 11, padding: '2px 8px' }}>×</button>
                    </div>
                  ))}
            </div>
          </div>

          {/* All-account status table */}
          <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
              Agency-wide account status <span className="muted" style={{ fontWeight: 400, fontSize: 11 }}>({accounts.length} total)</span>
            </div>
            <div style={{ maxHeight: 360, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: 'var(--bg-1)', position: 'sticky', top: 0 }}>
                    <th style={statusTh}>Platform</th>
                    <th style={statusTh}>Account</th>
                    <th style={statusTh}>Model</th>
                    <th style={statusTh}>Status</th>
                    <th style={statusTh}>Proxy</th>
                    <th style={statusTh}>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((a) => (
                    <tr key={a.id} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={statusTd} className="mono">{a.platform || 'reddit'}</td>
                      <td style={statusTd}>{a.username}</td>
                      <td style={statusTd}>{a.profile_name || '—'}</td>
                      <td style={statusTd}>
                        <span style={{
                          fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 999,
                          textTransform: 'uppercase', letterSpacing: '0.04em',
                          background: a.status === 'banned' ? 'rgba(226,163,163,0.14)' : a.status === 'ready' ? 'rgba(127,217,154,0.14)' : a.status === 'paused' ? 'rgba(154,160,166,0.14)' : 'rgba(212,166,74,0.14)',
                          color: a.status === 'banned' ? '#e2a3a3' : a.status === 'ready' ? '#7fd99a' : a.status === 'paused' ? '#9aa0a6' : '#d4a64a',
                        }}>{a.status}</span>
                      </td>
                      <td style={statusTd} className="mono dim">{a.proxy_label || '—'}</td>
                      <td style={statusTd} className="mono dim">{a.created_at?.slice(0, 10) || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
const statusTh = { textAlign: 'left', padding: '8px 10px', fontSize: 10, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em' };
const statusTd = { padding: '7px 10px', color: 'var(--text-1)' };

// Platform filter pills — used in Example library + Engagement to narrow the
// account picker so each platform's setup is easier to find.
function PlatformFilter({ value, onChange }) {
  const opts = [
    { v: 'all', l: 'All', c: '#999' },
    { v: 'reddit', l: 'Reddit', c: '#ff4500' },
    { v: 'x', l: 'X', c: '#fff' },
    { v: 'instagram', l: 'Instagram', c: '#e2497d' },
    { v: 'tiktok', l: 'TikTok', c: '#69c9d0' },
    { v: 'redgifs', l: 'RedGIFs', c: '#d63d3d' },
  ];
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
      {opts.map((o) => {
        const active = value === o.v;
        return (
          <button
            key={o.v}
            onClick={() => onChange(o.v)}
            style={{
              background: active ? 'rgba(255,255,255,0.06)' : 'transparent',
              border: `1px solid ${active ? o.c : 'var(--border)'}`,
              borderRadius: 999, padding: '4px 11px',
              color: active ? '#fff' : 'var(--text-2)',
              fontSize: 11, fontWeight: 600, cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: o.c }} />
            {o.l}
          </button>
        );
      })}
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


// ============================================================================
// AutopilotProtocolPanel — unified per-profile-per-platform autopilot config.
//
// Replaces the older per-account EngagementPanel + AutoCommentPanel pair.
// The operator picks a model profile, picks a platform, and edits one
// protocol row in autopilot_protocols. Switching profile or platform
// swaps the whole config so VAs don't have to reason about which
// account they're editing.
// ============================================================================

const PLATFORMS_ALL = [
  { v: 'reddit',    l: 'Reddit',    c: '#ff4500' },
  { v: 'x',         l: 'X',         c: '#fff' },
  { v: 'instagram', l: 'Instagram', c: '#e2497d' },
  { v: 'tiktok',    l: 'TikTok',    c: '#69c9d0' },
  { v: 'redgifs',   l: 'RedGifs',   c: '#d63d3d' },
];

const PERSONAS = [
  { v: 'curious', l: 'Curious',  hint: 'Asks short questions, notices specifics.' },
  { v: 'playful', l: 'Playful',  hint: 'Light teasing, real-viewer energy.' },
  { v: 'flirty',  l: 'Flirty',   hint: 'Confident, not crude.' },
  { v: 'dry',     l: 'Dry',      hint: 'Deadpan, one short observation.' },
  { v: 'custom',  l: 'Custom',   hint: 'Write your own system prompt below.' },
];

function AutopilotProtocolPanel({ token }) {
  const [profiles, setProfiles] = useState([]);
  const [profileId, setProfileId] = useState('');
  const [platform, setPlatform] = useState('reddit');
  const [proto, setProto] = useState(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);

  // Free-text mirrors of the JSON fields so the user types in a textarea.
  const [hashtagsText, setHashtagsText] = useState('');
  const [followText, setFollowText] = useState('');
  const [subsText, setSubsText] = useState('');
  const [excludeText, setExcludeText] = useState('');

  // Load every profile the user can see. Reuse the profiles IPC.
  useEffect(() => {
    window.api.profiles.list({ token }).then((r) => {
      if (r.ok) {
        const list = r.profiles || [];
        setProfiles(list);
        if (!profileId && list.length) setProfileId(String(list[0].id));
      }
    });
  }, [token]);

  const load = useCallback(async () => {
    if (!profileId || !platform) { setProto(null); return; }
    const r = await window.api.autopilot.get({
      token, profileId: Number(profileId), platform,
    });
    if (!r.ok) { setProto(null); return; }
    const p = r.protocol;
    setProto(p);
    try { setHashtagsText((JSON.parse(p.hashtags_json    || '[]') || []).join(', ')); } catch { setHashtagsText(''); }
    try { setFollowText  ((JSON.parse(p.follow_list_json || '[]') || []).join(', ')); } catch { setFollowText(''); }
    try { setSubsText    ((JSON.parse(p.target_subs_json || '[]') || []).join(', ')); } catch { setSubsText(''); }
    try {
      const f = JSON.parse(p.target_filter_json || '{}') || {};
      setExcludeText((f.exclude_keywords || []).join(', '));
    } catch { setExcludeText(''); }
  }, [token, profileId, platform]);

  useEffect(() => { load(); }, [load]);

  function set(patch) { setProto((p) => ({ ...(p || {}), ...patch })); }

  async function save() {
    if (!profileId || !platform || !proto) return;
    setBusy(true); setStatus(null);
    const arr = (s) => String(s || '').split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
    let filter = {};
    try { filter = JSON.parse(proto.target_filter_json || '{}'); } catch {}
    filter.exclude_keywords = arr(excludeText);
    const r = await window.api.autopilot.set({
      token,
      profileId: Number(profileId),
      platform,
      patch: {
        ...proto,
        hashtags:    arr(hashtagsText),
        follow_list: arr(followText),
        target_subs: arr(subsText),
        target_filter: filter,
      },
    });
    setBusy(false);
    setStatus(r.ok ? '✓ Saved' : (r.error || 'Failed'));
    if (r.ok) setProto(r.protocol);
    setTimeout(() => setStatus(null), 2500);
  }

  async function runNow(dryRun = false) {
    setBusy(true); setStatus('Running…');
    const r = await window.api.autopilot.runNow({
      token, profileId: Number(profileId), platform, dryRun,
    });
    setBusy(false);
    if (!r?.ok) { setStatus(r?.error || 'Failed'); return; }
    setStatus(`Ran · ${r.stats?.likes || 0} likes · ${r.stats?.follows || 0} follows · ${r.stats?.comments || 0} comments`);
  }

  const supportsHashtags = platform === 'tiktok' || platform === 'instagram';
  const supportsTargetSubs = platform === 'reddit';

  let targetFilter = {};
  try { targetFilter = JSON.parse(proto?.target_filter_json || '{}') || {}; } catch {}

  return (
    <div className="card" style={{ padding: 18, marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Autopilot Engagement</h2>
        <span className="muted" style={{ fontSize: 12 }}>
          one config per model + platform — drives scrolling, liking, following, and AI commenting
        </span>
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <select value={profileId} onChange={(e) => setProfileId(e.target.value)} style={{ minWidth: 220 }}>
          {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <div style={{ display: 'flex', gap: 4 }}>
          {PLATFORMS_ALL.map((o) => {
            const active = platform === o.v;
            return (
              <button
                key={o.v}
                onClick={() => setPlatform(o.v)}
                style={{
                  background: active ? 'rgba(255,255,255,0.06)' : 'transparent',
                  border: `1px solid ${active ? o.c : 'var(--border)'}`,
                  borderRadius: 999, padding: '4px 11px',
                  color: active ? '#fff' : 'var(--text-2)',
                  fontSize: 11, fontWeight: 600, cursor: 'pointer',
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                }}
              >
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: o.c }} />
                {o.l}
              </button>
            );
          })}
        </div>
        {status && <span className="muted" style={{ fontSize: 12, marginLeft: 'auto' }}>{status}</span>}
      </div>

      {!proto ? <div className="muted">Pick a model and a platform.</div> : (
        <>
          {/* Enabled toggle */}
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 14, fontSize: 13 }}>
            <input
              type="checkbox"
              checked={!!proto.enabled}
              onChange={(e) => set({ enabled: e.target.checked ? 1 : 0 })}
            />
            Autopilot enabled for this profile + platform
          </label>

          {/* Pacing */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 12 }}>
            <div>
              <label>Sessions per day</label>
              <input type="number" min={1} value={proto.sessions_per_day ?? 3}
                     onChange={(e) => set({ sessions_per_day: Number(e.target.value) })} />
            </div>
            <div>
              <label>Session min (minutes)</label>
              <input type="number" min={1} value={proto.session_minutes_min ?? 6}
                     onChange={(e) => set({ session_minutes_min: Number(e.target.value) })} />
            </div>
            <div>
              <label>Session max (minutes)</label>
              <input type="number" min={1} value={proto.session_minutes_max ?? 14}
                     onChange={(e) => set({ session_minutes_max: Number(e.target.value) })} />
            </div>
          </div>

          {/* Engagement rates */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 12 }}>
            <div>
              <label>Like rate (%)</label>
              <input type="number" min={0} max={100} value={proto.like_rate_pct ?? 18}
                     onChange={(e) => set({ like_rate_pct: Number(e.target.value) })} />
            </div>
            <div>
              <label>Follow rate (%)</label>
              <input type="number" min={0} max={100} value={proto.follow_rate_pct ?? 4}
                     onChange={(e) => set({ follow_rate_pct: Number(e.target.value) })} />
            </div>
            <div>
              <label>Watch-fully rate (%)</label>
              <input type="number" min={0} max={100} value={proto.watch_full_rate_pct ?? 25}
                     onChange={(e) => set({ watch_full_rate_pct: Number(e.target.value) })} />
            </div>
            <div>
              <label title="Probability the session leaves an AI comment on a given post. Needs the Autopilot AI key.">
                Comment rate (%)
              </label>
              <input type="number" min={0} max={100} value={proto.comment_rate_pct ?? 0}
                     onChange={(e) => set({ comment_rate_pct: Number(e.target.value) })} />
            </div>
          </div>

          {/* Targeting */}
          <div style={{ marginBottom: 12 }}>
            <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
              Targeting · which accounts your model engages with
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label>Min followers</label>
                <input
                  type="number" min={0}
                  value={targetFilter.min_followers ?? ''}
                  onChange={(e) => {
                    const f = { ...targetFilter };
                    const v = e.target.value.trim();
                    if (v === '') delete f.min_followers;
                    else f.min_followers = Number(v);
                    set({ target_filter_json: JSON.stringify(f) });
                  }}
                />
              </div>
              <div>
                <label>Max followers</label>
                <input
                  type="number" min={0}
                  value={targetFilter.max_followers ?? ''}
                  onChange={(e) => {
                    const f = { ...targetFilter };
                    const v = e.target.value.trim();
                    if (v === '') delete f.max_followers;
                    else f.max_followers = Number(v);
                    set({ target_filter_json: JSON.stringify(f) });
                  }}
                />
              </div>
            </div>
            <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                <input
                  type="checkbox"
                  checked={!!targetFilter.verified_only}
                  onChange={(e) => {
                    const f = { ...targetFilter, verified_only: e.target.checked };
                    if (!e.target.checked) delete f.verified_only;
                    set({ target_filter_json: JSON.stringify(f) });
                  }}
                />
                Verified accounts only
              </label>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                <input
                  type="checkbox"
                  checked={!!(proto.comment_videos_only ?? 1)}
                  onChange={(e) => set({ comment_videos_only: e.target.checked ? 1 : 0 })}
                />
                Only comment on videos
              </label>
            </div>
            <div style={{ marginTop: 10 }}>
              <label>Exclude posts whose caption contains</label>
              <textarea
                rows={2}
                placeholder="onlyfans, fansly, link in bio"
                value={excludeText}
                onChange={(e) => setExcludeText(e.target.value)}
                style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
              />
              <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>Comma-separated. Case-insensitive substring match.</div>
            </div>
          </div>

          {/* AI comment persona */}
          <div style={{ marginBottom: 12 }}>
            <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
              How the AI comments
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
              {PERSONAS.map((p) => {
                const active = (proto.comment_persona || 'curious') === p.v;
                return (
                  <button
                    key={p.v}
                    onClick={() => set({ comment_persona: p.v })}
                    title={p.hint}
                    style={{
                      background: active ? 'rgba(212,166,74,0.18)' : 'transparent',
                      border: `1px solid ${active ? 'var(--gold)' : 'var(--border)'}`,
                      borderRadius: 999, padding: '4px 11px',
                      color: active ? 'var(--gold)' : 'var(--text-2)',
                      fontSize: 11, fontWeight: 600, cursor: 'pointer',
                    }}
                  >{p.l}</button>
                );
              })}
            </div>
            {(proto.comment_persona === 'custom') && (
              <div>
                <label>Custom system prompt for comments</label>
                <textarea
                  rows={4}
                  value={proto.comment_prompt || ''}
                  onChange={(e) => set({ comment_prompt: e.target.value })}
                  placeholder="You react to videos like a real viewer in… one short line, no hashtags, never promotional, …"
                  style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
                />
              </div>
            )}
          </div>

          {/* Per-platform lists */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
            <div>
              <label>Follow-list (handles)</label>
              <textarea
                rows={3}
                placeholder="@modelhandle1, @modelhandle2"
                value={followText}
                onChange={(e) => setFollowText(e.target.value)}
                style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
              />
              <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                Empty = follow anyone the rate allows. Filled = only follow these handles.
              </div>
            </div>
            <div>
              <label>
                Hashtags {supportsHashtags ? '(IG / TikTok will land on one per session)' : '(N/A for this platform)'}
              </label>
              <textarea
                rows={3}
                disabled={!supportsHashtags}
                value={hashtagsText}
                onChange={(e) => setHashtagsText(e.target.value)}
                placeholder="#fitness, #cosplay"
                style={{ fontFamily: 'var(--font-mono)', fontSize: 12, opacity: supportsHashtags ? 1 : 0.5 }}
              />
            </div>
          </div>

          {supportsTargetSubs && (
            <div style={{ marginBottom: 14 }}>
              <label>Reddit target subreddits (for the API-comment path)</label>
              <textarea
                rows={3}
                placeholder="askreddit, casualconversation, …"
                value={subsText}
                onChange={(e) => setSubsText(e.target.value)}
                style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
              />
              <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                When comment rate &gt; 0 and platform = Reddit, one API-based comment runs after each engagement session, drawing from these subs.
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <button className="primary" disabled={busy} onClick={save}>Save</button>
            <button className="ghost" disabled={busy} onClick={() => runNow(true)}>Test run (dry)</button>
            <button className="ghost" disabled={busy} onClick={() => runNow(false)}>Run now</button>
            <div style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-3)' }}>
              Last run: {proto.last_run_at || 'never'}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
