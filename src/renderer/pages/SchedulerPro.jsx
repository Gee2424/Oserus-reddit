import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { useActiveAccount } from '../lib/activeAccount.jsx';
import PopOutButton from '../components/PopOutButton.jsx';
import AccountSelector from '../components/AccountSelector.jsx';
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


// ────────────────────────────────────────────────── Scheduler page
//
// Account-driven workflow. The operator picks Model → Platform →
// Account at the top, and the composer + timeline + history kanban
// below all filter to that account. No more 4-tab Configure / Run /
// Monitor / Replenish flow — that was a wrapper around the same data.

export default function SchedulerProPage() {
  const { token } = useAuth();
  const { accounts } = useActiveAccount();

  const [profiles, setProfiles] = useState([]);
  const [sel, setSel] = useState({ profileId: null, platform: null, accountId: null });
  const [posts, setPosts] = useState([]);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    window.api.profiles.list({ token }).then((r) => { if (r.ok) setProfiles(r.profiles || []); });
  }, [token]);

  const load = useCallback(async () => {
    if (!sel.accountId) { setPosts([]); return; }
    const res = await window.api.scheduled.list({ token, accountId: sel.accountId });
    if (res.ok) setPosts(res.posts || []);
    else setErr(res.error);
  }, [token, sel.accountId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, [load]);
  useEffect(() => {
    if (!msg && !err) return;
    const t = setTimeout(() => { setMsg(null); setErr(null); }, 4000);
    return () => clearTimeout(t);
  }, [msg, err]);

  async function cancel(id) {
    const r = await window.api.scheduled.cancel({ token, id });
    if (r.ok) { setMsg('Cancelled.'); load(); } else setErr(r.error);
  }
  async function del(id) {
    if (!confirm('Delete this scheduled post?')) return;
    const r = await window.api.scheduled.delete({ token, id });
    if (r.ok) load(); else setErr(r.error);
  }

  // Composer needs the full account list narrowed by the selector. The
  // existing Composer component already has its own platform pill row,
  // but we hide it visually by pre-filtering accounts here.
  const composerAccounts = useMemo(() => {
    if (!sel.profileId) return accounts;
    return accounts.filter((a) =>
      a.profile_id === sel.profileId &&
      (!sel.platform || (a.platform || 'reddit') === sel.platform)
    );
  }, [accounts, sel]);

  const pendingConflicts = posts.filter((p) => p.status === 'pending' && p.conflicts?.length).length;

  return (
    <div>
      <div className="title-block">
        <div>
          <div className="eyebrow">Automation</div>
          <h1>Scheduler</h1>
          <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
            Schedule posts for a specific account. Due posts fire automatically while the app is open.
          </div>
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <PopOutButton route="scheduler-pro" title="Scheduler" />
        </div>
      </div>

      <AccountSelector
        profiles={profiles}
        accounts={accounts}
        value={sel}
        onChange={setSel}
        requireAccount={true}
      />

      {err && <Banner kind="err">{err}</Banner>}
      {msg && <Banner kind="ok">{msg}</Banner>}
      {pendingConflicts > 0 && (
        <div style={warnBanner}>
          ⚠ {pendingConflicts} scheduled post{pendingConflicts > 1 ? 's' : ''} conflict with this account's posting protocol.
        </div>
      )}

      {!sel.accountId ? (
        <div className="card" style={{ padding: 20, color: 'var(--text-3)', fontSize: 13 }}>
          Pick a model, platform, and account to compose and view scheduled posts.
        </div>
      ) : (
        <>
          <Composer
            token={token}
            accounts={composerAccounts}
            preselectAccountId={sel.accountId}
            onDone={() => { load(); setMsg('Scheduled.'); }}
            onError={setErr}
          />

          <AISettings token={token} onMsg={setMsg} onError={setErr} />

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '14px 0 10px' }}>
            <h3 style={{ margin: 0, fontSize: 15 }}>Queue for this account</h3>
            <button className="ghost" onClick={load}>↻ Refresh</button>
          </div>

          <StatusColumns posts={posts} onCancel={cancel} onDelete={del} />
        </>
      )}
    </div>
  );
}

/* --------------------- Status Columns (kanban) --------------------- */

const STATUS_COLUMNS = [
  { key: 'pending',   label: 'Scheduled' },
  { key: 'running',   label: 'Running'   },
  { key: 'posted',    label: 'Completed' },
  { key: 'failed',    label: 'Failed'    },
  { key: 'cancelled', label: 'Paused'    },
];

function StatusColumns({ posts, onCancel, onDelete }) {
  const buckets = useMemo(() => {
    const m = {};
    for (const c of STATUS_COLUMNS) m[c.key] = [];
    for (const p of posts) {
      const k = m[p.status] ? p.status : 'pending';
      m[k].push(p);
    }
    for (const k of Object.keys(m)) m[k].sort((a, b) => (a.scheduled_for || '').localeCompare(b.scheduled_for || ''));
    return m;
  }, [posts]);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${STATUS_COLUMNS.length}, minmax(220px, 1fr))`, gap: 10, alignItems: 'start' }}>
      {STATUS_COLUMNS.map((c) => {
        const items = buckets[c.key] || [];
        const sc = STATUS_COLOR[c.key] || {};
        return (
          <div key={c.key} style={{ background: 'var(--bg-elev)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
            <div style={{
              padding: '10px 12px', borderBottom: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', gap: 8,
              background: sc.bg || 'var(--bg-2)', color: sc.fg || 'var(--text-2)',
              fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
            }}>
              <span>{c.label}</span>
              <span style={{ marginLeft: 'auto', opacity: 0.8 }}>{items.length}</span>
            </div>
            <div style={{ padding: 8, maxHeight: '60vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {items.length === 0 ? (
                <div className="muted" style={{ fontSize: 11, padding: 14, textAlign: 'center' }}>None</div>
              ) : items.map((p) => (
                <div key={p.id} style={{
                  background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 8,
                  padding: '8px 10px', fontSize: 12,
                }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)' }}>
                    {(PLATFORM_ICON[p.platform] || '◈')} {timeLabel(p.scheduled_for)} · {(p.scheduled_for || '').slice(5, 10)}
                  </div>
                  <div style={{ marginTop: 3, color: 'var(--gold)', fontSize: 11 }}>r/{p.subreddit}</div>
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 }}>{p.title}</div>
                  {p.boost_status && (
                    <div style={{
                      marginTop: 4, display: 'inline-block', fontSize: 9, fontWeight: 700,
                      padding: '2px 6px', borderRadius: 999, letterSpacing: '0.05em', textTransform: 'uppercase',
                      background: p.boost_status === 'ordered' ? 'rgba(127,217,154,0.14)'
                        : p.boost_status === 'failed' ? 'rgba(226,163,163,0.14)'
                        : 'rgba(212,166,74,0.14)',
                      color: p.boost_status === 'ordered' ? '#7fd99a'
                        : p.boost_status === 'failed' ? '#e2a3a3' : '#d4a64a',
                    }} title={`Boost · ${p.boost_qty} · ${p.boost_status}${p.boost_fire_at ? ` · fires ${p.boost_fire_at}` : ''}`}>
                      ▲ {p.boost_qty} {p.boost_status}
                    </div>
                  )}
                  <div className="muted" style={{ fontSize: 10, marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                    {p.profile_color && <span style={{ width: 6, height: 6, borderRadius: 999, background: p.profile_color }} />}
                    {p.profile_name || '—'} · u/{p.account_username}
                    <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                      {p.status === 'pending' && <button className="ghost" onClick={() => onCancel(p.id)} style={tiny}>Pause</button>}
                      <button className="ghost" onClick={() => onDelete(p.id)} style={tiny} title="Delete">✕</button>
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* --------------------- Run / Monitor / Replenishment --------------------- */


function AISettings({ token, onMsg, onError }) {
  const [cfg, setCfg] = useState({
    mode: 'assistive', gender: 'female', age: '20', location: '',
    titleMin: 3, titleMax: 8, model: 'grok-2-latest', customPrompt: '',
    nightInfo: '', ctaInfo: '', typoRate: 0,
    matchCity: false, randomCta: true, detectLanguage: false,
    includeMedia: false,
    customCtas: [], // [{ platform, url }]
  });
  const [hasKey, setHasKey] = useState(false);
  const [providerLabel, setProviderLabel] = useState('AI');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    window.api.aiconfig.get({ token }).then((r) => { if (r.ok && r.config) setCfg((c) => ({ ...c, ...r.config })); });
    window.api.ai.hasApiKey({ token }).then((r) => setHasKey(!!(r.ok && r.hasKey)));
    window.api.ai.getProviders?.({ token }).then((r) => {
      if (!r?.ok) return;
      const active = r.provider === 'grok' && r.grok?.hasKey ? 'Grok'
                   : r.provider === 'anthropic' && r.anthropic?.hasKey ? 'Anthropic (Claude)'
                   : r.anthropic?.hasKey ? 'Anthropic (Claude)'
                   : r.grok?.hasKey ? 'Grok'
                   : 'AI';
      setProviderLabel(active);
    });
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
        {hasKey ? `✓ ${providerLabel} is configured and ready to use.` : '⚠ No AI key yet — add Anthropic (recommended) or Grok in Configuration.'}
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

      <div style={{ marginBottom: 14 }}>
        <Toggle label="Include media (photo/video) in AI generation" value={cfg.includeMedia} onChange={(v) => set('includeMedia', v)} />
        <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 6, lineHeight: 1.5 }}>
          Sends the post's image/video to Grok for visual context when generating titles. More accurate captions, but uses many more tokens.
        </div>
      </div>

      <div style={{ background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 12, marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)', marginBottom: 8, fontFamily: 'var(--font-mono)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Token Usage Comparison
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ color: 'var(--text-3)', textAlign: 'left', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              <th style={{ padding: '6px 8px', fontWeight: 500 }}>Input Type</th>
              <th style={{ padding: '6px 8px', fontWeight: 500 }}>Typical Tokens Added</th>
              <th style={{ padding: '6px 8px', fontWeight: 500 }}>Cost vs Text-Only</th>
            </tr>
          </thead>
          <tbody>
            <tr style={{ borderTop: '1px solid var(--border)' }}>
              <td style={{ padding: '7px 8px' }}>Text only</td>
              <td style={{ padding: '7px 8px' }} className="mono">100 – 5,000</td>
              <td style={{ padding: '7px 8px', color: 'var(--green-bright)' }}>1× (cheapest)</td>
            </tr>
            <tr style={{ borderTop: '1px solid var(--border)' }}>
              <td style={{ padding: '7px 8px' }}>+ 1 Photo</td>
              <td style={{ padding: '7px 8px' }} className="mono">+256 – 1,792</td>
              <td style={{ padding: '7px 8px', color: 'var(--gold)' }}>2× – 10× higher</td>
            </tr>
            <tr style={{ borderTop: '1px solid var(--border)' }}>
              <td style={{ padding: '7px 8px' }}>+ Video (short)</td>
              <td style={{ padding: '7px 8px' }} className="mono">+1,000 – 5,000</td>
              <td style={{ padding: '7px 8px', color: '#e2a3a3' }}>5× – 50× higher</td>
            </tr>
          </tbody>
        </table>
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

function Composer({ token, accounts, onDone, onError, preselectAccountId }) {
  // When the page passes a pre-selected account, snap to its platform
  // and seed targets so the composer drops the operator straight into
  // the form for that account.
  const preselectedAccount = preselectAccountId
    ? accounts.find((a) => a.id === preselectAccountId)
    : null;
  const [platform, setPlatform] = useState(preselectedAccount?.platform || 'reddit');
  const [form, setForm] = useState({ subreddit: '', title: '', body: '', kind: 'self', url: '', when: '' });
  const [targets, setTargets] = useState(preselectAccountId ? [preselectAccountId] : []);

  // Resync when the page swaps which account is selected.
  useEffect(() => {
    if (!preselectAccountId) return;
    const acc = accounts.find((a) => a.id === preselectAccountId);
    if (acc) setPlatform(acc.platform || 'reddit');
    setTargets([preselectAccountId]);
  }, [preselectAccountId, accounts]);

  // Accounts visible in the picker are filtered to the selected platform.
  const platformAccounts = useMemo(() => accounts.filter((a) => (a.platform || 'reddit') === platform), [accounts, platform]);
  const [conflicts, setConflicts] = useState([]);
  const [busy, setBusy] = useState(false);
  // Boosting: integrated from Operations → Upvotes per the new architecture.
  const [boost, setBoost] = useState({ enabled: false, serviceId: '', qty: 25, delayMinutes: 0, dripRate: 'medium' });
  const [services, setServices] = useState([]);
  const [balance, setBalance] = useState(null);
  // Eligibility intel: subreddit gates × account karma/age.
  const [intelMap, setIntelMap] = useState(new Map());
  const [karmaMap, setKarmaMap] = useState(new Map());
  // Preferred subreddits per profile. Pulled from promo_subreddits so the
  // composer can offer quick-pick chips + one-click 'post to all preferred'.
  const [preferredByProfile, setPreferredByProfile] = useState({}); // { [profileId]: ['sub1', 'sub2'] }

  useEffect(() => {
    window.api.votes.hasApiKey({ token }).then((r) => {
      if (!(r.ok && r.hasKey)) return;
      window.api.votes.services({ token }).then((s) => { if (s.ok) setServices(s.services || []); });
      window.api.votes.balance({ token }).then((b) => { if (b.ok) setBalance({ balance: b.balance, currency: b.currency }); });
    });
    window.api.intel.list({ token }).then((r) => {
      if (r.ok) setIntelMap(new Map((r.subs || []).map((s) => [s.name.toLowerCase(), s])));
    });
    window.api.analytics.summary({ token }).then((r) => {
      if (r.ok) setKarmaMap(new Map((r.accounts || []).map((a) => [a.id, a])));
    });
  }, [token]);

  // Pull preferred subs for every profile whose accounts appear in the
  // picker. Caches per profile id so re-selecting doesn't re-fetch.
  useEffect(() => {
    const profileIds = [...new Set(platformAccounts.map((a) => a.profile_id).filter(Boolean))];
    for (const pid of profileIds) {
      if (preferredByProfile[pid]) continue;
      window.api.subs.listPromo({ token, profileId: pid }).then((r) => {
        if (r.ok) setPreferredByProfile((m) => ({ ...m, [pid]: (r.subs || []).map((s) => s.name) }));
      });
    }
  }, [platformAccounts, token]); // eslint-disable-line react-hooks/exhaustive-deps

  // Unique preferred subs across the selected targets. Drives the quick-pick
  // chip row + the 'Schedule to all preferred' button.
  const preferredAcrossTargets = useMemo(() => {
    const set = new Set();
    for (const id of targets) {
      const acc = platformAccounts.find((a) => a.id === id);
      if (!acc) continue;
      const list = preferredByProfile[acc.profile_id] || [];
      for (const s of list) set.add(s);
    }
    return [...set].sort();
  }, [targets, platformAccounts, preferredByProfile]);

  // Compute per-target eligibility warnings against the typed subreddit.
  const eligibilityWarnings = useMemo(() => {
    if (!form.subreddit || !targets.length) return [];
    const intel = intelMap.get(form.subreddit.replace(/^r\//i, '').trim().toLowerCase());
    if (!intel) return [];
    const out = [];
    for (const id of targets) {
      const acc = accounts.find((a) => a.id === id);
      if (!acc) continue;
      const k = karmaMap.get(id) || {};
      const reasons = [];
      if (intel.min_post_karma != null && (k.post_karma == null || k.post_karma < intel.min_post_karma))
        reasons.push(`post karma ${k.post_karma ?? '?'} / need ${intel.min_post_karma}`);
      if (intel.min_comment_karma != null && (k.comment_karma == null || k.comment_karma < intel.min_comment_karma))
        reasons.push(`comment karma ${k.comment_karma ?? '?'} / need ${intel.min_comment_karma}`);
      if (intel.min_account_age_days != null && acc.created_at) {
        const days = Math.floor((Date.now() - new Date(acc.created_at.replace(' ', 'T') + 'Z').getTime()) / 86400000);
        if (days < intel.min_account_age_days) reasons.push(`age ${days}d / need ${intel.min_account_age_days}d`);
      }
      if (reasons.length) out.push(`u/${acc.username}: ${reasons.join(' · ')}`);
    }
    return out;
  }, [form.subreddit, targets, intelMap, karmaMap, accounts]);

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
    if (!targets.length || !form.title || !form.when) {
      onError('Pick at least one account, a title/caption, and time.');
      return;
    }
    if (platform === 'reddit' && !form.subreddit) {
      onError('Subreddit required for Reddit posts.');
      return;
    }
    setBusy(true);
    const items = targets.map((accountId) => ({
      accountId,
      subreddit: platform === 'reddit' ? form.subreddit : '',
      title: form.title,
      body: form.body,
      kind: form.kind,
      url: form.url,
      scheduledFor: toStored(form.when),
      boostServiceId: boost.enabled && platform === 'reddit' ? boost.serviceId : null,
      boostQty: boost.enabled && platform === 'reddit' ? Number(boost.qty) : 0,
      boostDelayMinutes: boost.enabled && platform === 'reddit' ? Number(boost.delayMinutes) || 0 : 0,
      boostDripRate: boost.enabled && platform === 'reddit' ? boost.dripRate : null,
    }));
    const res = await window.api.scheduled.bulkCreate({ token, items });
    setBusy(false);
    if (res.ok) onDone();
    else onError(res.error);
  }

  // Fan-out: one scheduled post per (target account × that account's model's
  // preferred subs). Spaces them 7 minutes apart per account so the back end
  // doesn't get a thundering herd and the user doesn't trip Reddit's
  // submission rate limit.
  async function submitAllPreferred() {
    if (!targets.length || !form.title || !form.when) {
      onError('Pick at least one account, a title, and a start time.');
      return;
    }
    if (platform !== 'reddit') { onError('Preferred subs are Reddit-only for now.'); return; }
    if (!preferredAcrossTargets.length) { onError('No preferred subs saved on these models. Add them on the Model profile.'); return; }
    setBusy(true);
    const base = new Date(form.when.replace('T', ' ')).getTime();
    const items = [];
    for (const accountId of targets) {
      const acc = platformAccounts.find((a) => a.id === accountId);
      const subs = (preferredByProfile[acc?.profile_id] || []);
      if (!subs.length) continue;
      subs.forEach((sub, i) => {
        const when = new Date(base + i * 7 * 60 * 1000);
        const stored = when.toISOString().slice(0, 19).replace('T', ' ');
        items.push({
          accountId, subreddit: sub,
          title: form.title, body: form.body, kind: form.kind, url: form.url,
          scheduledFor: stored,
          boostServiceId: boost.enabled ? boost.serviceId : null,
          boostQty: boost.enabled ? Number(boost.qty) : 0,
          boostDelayMinutes: boost.enabled ? Number(boost.delayMinutes) || 0 : 0,
          boostDripRate: boost.enabled ? boost.dripRate : null,
        });
      });
    }
    if (!items.length) { setBusy(false); onError('No (account × preferred sub) pairs to schedule.'); return; }
    const res = await window.api.scheduled.bulkCreate({ token, items });
    setBusy(false);
    if (res.ok) onDone();
    else onError(res.error);
  }

  return (
    <div className="card bordered-glow" style={{ padding: 18, marginBottom: 18 }}>
      <h3 style={{ marginTop: 0, marginBottom: 12 }}>Schedule a post {targets.length > 1 ? `to ${targets.length} accounts` : ''}</h3>

      {/* Platform selector — switches the composer to per-platform fields.
          Reddit posts fire automatically; non-Reddit posts save as drafts that
          appear in the timeline until their adapters land. */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        {[
          { k: 'reddit',    l: 'Reddit',    icon: '◈', color: '#ff4500' },
          { k: 'redgifs',   l: 'RedGIFs',   icon: '▮', color: '#d63d3d' },
          { k: 'x',         l: 'X',         icon: '𝕏', color: '#fff'    },
          { k: 'instagram', l: 'Instagram', icon: '◉', color: '#e2497d' },
          { k: 'tiktok',    l: 'TikTok',    icon: '♪', color: '#69c9d0' },
        ].map((p) => {
          const isActive = platform === p.k;
          return (
            <button
              key={p.k}
              onClick={() => { setPlatform(p.k); setTargets([]); }}
              style={{
                background: isActive ? 'linear-gradient(135deg, rgba(212,166,74,0.16), rgba(58,111,140,0.06))' : 'var(--bg-1)',
                border: '1px solid ' + (isActive ? 'var(--gold)' : 'var(--border)'),
                borderRadius: 999, padding: '5px 12px',
                color: isActive ? 'var(--gold-bright)' : 'var(--text-2)',
                fontSize: 11, fontWeight: 600, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              <span style={{ color: p.color }}>{p.icon}</span> {p.l}
            </button>
          );
        })}
      </div>

      {platform !== 'reddit' && (
        <div style={{
          background: 'rgba(212,166,74,0.10)', border: '1px solid var(--gold)',
          borderRadius: 'var(--radius-lg)', padding: '8px 12px', marginBottom: 14,
          fontSize: 12, color: 'var(--gold-bright)',
        }}>
          ⓘ {platform} posts save to the timeline as drafts. Auto-publish lands when the {platform} adapter ships — until then post manually via Browser.
        </div>
      )}

      {platform === 'reddit' ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label>Subreddit</label>
              <input placeholder="any subreddit, e.g. AskReddit" value={form.subreddit} onChange={(e) => setForm({ ...form, subreddit: e.target.value })} />
              {preferredAcrossTargets.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                  <span className="dim" style={{ fontSize: 10, alignSelf: 'center', marginRight: 4 }}>Preferred:</span>
                  {preferredAcrossTargets.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, subreddit: s }))}
                      title={`Use r/${s}`}
                      style={{
                        fontSize: 10, padding: '2px 8px', borderRadius: 999,
                        background: form.subreddit === s ? 'var(--gold)' : 'var(--bg-1)',
                        color: form.subreddit === s ? '#1a1a14' : 'var(--text-2)',
                        border: '1px solid var(--border)', cursor: 'pointer',
                      }}
                    >r/{s}</button>
                  ))}
                </div>
              )}
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
        </>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label>{platform === 'x' ? 'Tweet text' : 'Caption'}</label>
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder={platform === 'x' ? 'What\'s happening?' : 'Caption…'} />
            </div>
            <div>
              <label>When</label>
              <input type="datetime-local" value={form.when} onChange={(e) => setForm({ ...form, when: e.target.value })} />
            </div>
          </div>
          {platform !== 'x' && (
            <div style={{ marginTop: 12 }}>
              <label>Media URL (image/video)</label>
              <input placeholder="https://…" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value, kind: 'image' })} />
            </div>
          )}
          {platform === 'x' && (
            <div style={{ marginTop: 12 }}>
              <label>Media URL (optional)</label>
              <input placeholder="https://… (optional)" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value, kind: form.url ? 'image' : 'self' })} />
            </div>
          )}
          <div style={{ marginTop: 12 }}>
            <label>Notes (optional)</label>
            <input value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })}
              placeholder="Internal notes — not posted." />
          </div>
        </>
      )}

      <div style={{ marginTop: 14 }}>
        <label>Accounts {targets.length > 0 && <span className="dim">({targets.length} selected)</span>}</label>
        {(() => {
          const modelMap = new Map();
          for (const a of platformAccounts) if (a.profile_id) {
            const key = a.profile_id;
            if (!modelMap.has(key)) modelMap.set(key, { id: key, name: a.profile_name || `Model ${key}`, accountIds: [] });
            modelMap.get(key).accountIds.push(a.id);
          }
          const models = [...modelMap.values()];
          if (!models.length) return null;
          return (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6, marginBottom: 6 }}>
              <span className="dim" style={{ fontSize: 11, alignSelf: 'center', marginRight: 4 }}>Models:</span>
              {models.map((m) => {
                const allOn = m.accountIds.every((id) => targets.includes(id));
                return (
                  <button
                    key={m.id}
                    onClick={() => setTargets((t) => {
                      const s = new Set(t);
                      if (allOn) { for (const id of m.accountIds) s.delete(id); }
                      else { for (const id of m.accountIds) s.add(id); }
                      return [...s];
                    })}
                    className={allOn ? 'primary' : 'ghost'}
                    style={{ fontSize: 11, padding: '3px 10px', borderRadius: 999 }}
                    title={`Schedule to all ${m.accountIds.length} accounts under ${m.name}`}
                  >
                    ◇ {m.name} <span style={{ opacity: 0.7 }}>({m.accountIds.length})</span>
                  </button>
                );
              })}
            </div>
          );
        })()}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6, maxHeight: 130, overflowY: 'auto' }}>
          {platformAccounts.length === 0 ? (
            <span className="dim" style={{ fontSize: 11 }}>No {platform} accounts. Add one in Account Setup.</span>
          ) : platformAccounts.map((a) => {
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

      {platform === 'reddit' && eligibilityWarnings.length > 0 && (
        <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 'var(--radius-lg)', background: 'rgba(180,90,90,0.08)', border: '1px solid #6e2c2c', fontSize: 12, color: '#e2a3a3' }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>⚠ Subreddit gate may reject these accounts:</div>
          {eligibilityWarnings.map((w, i) => <div key={i} style={{ marginTop: 2 }}>{w}</div>)}
        </div>
      )}

      {/* Boosting — Reddit only, integrated from Operations → Upvotes. */}
      {platform === 'reddit' && <div style={{ marginTop: 16, border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 14, background: 'var(--bg-1)' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, textTransform: 'none', letterSpacing: 0, cursor: 'pointer', color: 'var(--text-1)', fontWeight: 600, fontSize: 13, marginBottom: 0 }}>
          <input type="checkbox" checked={boost.enabled} onChange={(e) => setBoost({ ...boost, enabled: e.target.checked })} style={{ width: 'auto' }} />
          ▲ Boost this post after it fires
          {balance && <span className="muted" style={{ marginLeft: 'auto', fontWeight: 400, fontSize: 12 }}>Balance: ${balance.balance}</span>}
        </label>
        {boost.enabled && (
          services.length === 0
            ? <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>No upvote.biz services available. Set an API key under Operations → Upvotes.</div>
            : (
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 10, marginTop: 10 }}>
                <div>
                  <label>Service</label>
                  <select value={boost.serviceId} onChange={(e) => setBoost({ ...boost, serviceId: e.target.value })}>
                    <option value="">— pick a service —</option>
                    {services.map((s) => (
                      <option key={s.service} value={s.service}>{s.name} {s.rate ? `· $${s.rate}/1k` : ''}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label>Quantity</label>
                  <input type="number" min={1} value={boost.qty} onChange={(e) => setBoost({ ...boost, qty: e.target.value })} />
                </div>
                <div>
                  <label>Start delay (min)</label>
                  <input type="number" min={0} value={boost.delayMinutes} onChange={(e) => setBoost({ ...boost, delayMinutes: e.target.value })} placeholder="0 = fire immediately" />
                </div>
                <div>
                  <label>Drip rate</label>
                  <select value={boost.dripRate} onChange={(e) => setBoost({ ...boost, dripRate: e.target.value })}>
                    <option value="fast">Fast</option>
                    <option value="medium">Medium</option>
                    <option value="slow">Slow (steady)</option>
                  </select>
                </div>
              </div>
            )
        )}
      </div>}

      <div style={{ marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="primary" onClick={submit} disabled={busy}>
          {busy ? 'Scheduling…' : (targets.length > 1 ? `Schedule to ${targets.length} accounts` : 'Schedule post')}
        </button>
        {platform === 'reddit' && preferredAcrossTargets.length > 0 && (
          <button
            className="ghost"
            onClick={submitAllPreferred}
            disabled={busy}
            title={`Fan this post out to all ${preferredAcrossTargets.length} preferred sub(s) across selected models, spaced 7 minutes apart per account`}
          >
            ✦ Schedule to all preferred ({preferredAcrossTargets.length})
          </button>
        )}
      </div>
    </div>
  );
}

const warnBanner = { background: 'rgba(201,162,39,0.12)', border: '1px solid var(--gold)', color: 'var(--gold-bright)', padding: '10px 14px', borderRadius: 4, marginBottom: 12, fontSize: 13 };
const dayHeader = { fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 6, paddingLeft: 4 };
const row = { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid var(--border)' };
const pill = { fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 999, textTransform: 'uppercase', flexShrink: 0 };
const tiny = { fontSize: 11, padding: '4px 8px' };
