import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { useActiveAccount } from '../lib/activeAccount.jsx';
import { Banner, Tag } from '../components/ui.jsx';
import PopOutButton from '../components/PopOutButton.jsx';

const INNER_TABS = [
  { k: 'requirements', l: 'Requirements',  d: 'Karma/age gates & rules' },
  { k: 'compat',       l: 'Compatibility', d: 'Which subs qualify for an account' },
  { k: 'scraper',      l: 'Scraper',       d: 'Hot · Top · Rising · New · Users · Mods · Flairs' },
  { k: 'research',     l: 'Research',      d: 'Trending words & best posting times' },
];

function fmt(n) { return n == null ? '—' : n.toLocaleString(); }
function ago(unixSec) {
  if (!unixSec) return '';
  const s = Math.floor(Date.now() / 1000 - unixSec);
  if (s < 3600) return `${Math.floor(s/60)}m`;
  if (s < 86400) return `${Math.floor(s/3600)}h`;
  return `${Math.floor(s/86400)}d`;
}
function downloadFile(name, data, mime) {
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function toCSV(rows) {
  if (!rows.length) return '';
  const keys = Object.keys(rows[0]);
  const esc = (v) => {
    if (v == null) return '';
    const s = String(v).replace(/"/g, '""');
    return /[",\n]/.test(s) ? `"${s}"` : s;
  };
  return [keys.join(','), ...rows.map((r) => keys.map((k) => esc(r[k])).join(','))].join('\n');
}

export default function IntelligencePage() {
  const { token } = useAuth();
  const { forPlatform } = useActiveAccount();
  const { accounts } = forPlatform('reddit');

  const [accountId, setAccountId] = useState('');
  const [subs, setSubs] = useState('');
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);
  const [fetchKarma, setFetchKarma] = useState(true);
  const [fetchOther, setFetchOther] = useState(true);
  const [tab, setTab] = useState('requirements');

  const load = useCallback(async () => {
    const res = await window.api.intel.list({ token });
    if (res.ok) setRows(res.subs || []);
  }, [token]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!msg && !err) return;
    const t = setTimeout(() => { setMsg(null); setErr(null); }, 5000);
    return () => clearTimeout(t);
  }, [msg, err]);

  async function run() {
    if (!accountId) { setErr('Pick a scraper account first.'); return; }
    if (!subs.trim()) { setErr('Enter at least one subreddit.'); return; }
    setBusy(true); setErr(null);
    await window.api.session.prepareForAccount({ accountId: Number(accountId) });
    const res = await window.api.intel.fetch({ token, accountId: Number(accountId), subreddits: subs });
    setBusy(false);
    if (res.ok) {
      setMsg(`Fetched ${res.fetched} subreddit(s).${res.errors?.length ? ` ${res.errors.length} failed.` : ''}`);
      if (res.errors?.length) setErr(res.errors.join(' · '));
      load();
    } else setErr(res.error);
  }

  async function del(name) {
    await window.api.intel.delete({ token, name });
    load();
  }

  return (
    <div>
      <div className="title-block">
        <div>
          <div className="eyebrow">Research</div>
          <h1>Reddit Intelligence</h1>
          <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
            Scrape subreddit requirements (subscribers, karma/age gates, rules) using a logged-in account.
          </div>
        </div>
        <div style={{ marginLeft: 'auto' }}><PopOutButton route="intel" title="Reddit Intelligence" /></div>
      </div>

      <div style={{ background: 'rgba(60,110,180,0.10)', border: '1px solid #2c4a6e', borderRadius: 'var(--radius-lg)', padding: '10px 14px', marginBottom: 18, fontSize: 13, color: '#9fc0ea' }}>
        ⓘ Beta: karma/age gates depend on what each subreddit exposes — some hide them, so those columns may be blank.
      </div>

      {err && <Banner kind="err">{err}</Banner>}
      {msg && <Banner kind="ok">{msg}</Banner>}

      {/* Inner tabs: Requirements (existing) · Scraper (new) · Research (new) */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, borderBottom: '1px solid var(--border)' }}>
        {INNER_TABS.map((t) => (
          <button
            key={t.k}
            onClick={() => setTab(t.k)}
            title={t.d}
            style={{
              background: 'transparent', border: 'none',
              borderBottom: '2px solid ' + (tab === t.k ? 'var(--gold)' : 'transparent'),
              color: tab === t.k ? 'var(--gold-bright)' : 'var(--text-2)',
              padding: '10px 16px', fontSize: 13, fontWeight: 600,
              cursor: 'pointer', marginBottom: -1,
            }}
          >{t.l}</button>
        ))}
      </div>

      {tab === 'compat' && (
        <CompatibilityPanel token={token} accountId={accountId} accounts={accounts} onAccount={setAccountId} />
      )}
      {tab === 'scraper' && (
        <ScraperPanel token={token} accountId={accountId} accounts={accounts} onAccount={setAccountId} onMsg={setMsg} onError={setErr} />
      )}
      {tab === 'research' && (
        <ResearchPanel token={token} accountId={accountId} accounts={accounts} onAccount={setAccountId} onMsg={setMsg} onError={setErr} />
      )}

      {tab === 'requirements' && (<>
      <div className="card" style={{ marginBottom: 22, padding: 18 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 16 }}>
          <div>
            <label>Scraper account</label>
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">— select an account —</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>u/{a.username} · {a.profile_name}</option>)}
            </select>
            <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
              The logged-in account used to fetch the data.
            </div>
          </div>
          <div>
            <label>Subreddits (one per line)</label>
            <textarea
              value={subs}
              onChange={(e) => setSubs(e.target.value)}
              placeholder={'tittydrop\ngonewild\nnsfw'}
              style={{ minHeight: 120, fontFamily: 'var(--font-mono)', fontSize: 13 }}
            />
            <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
              Enter subreddit names (without r/), one per line.
            </div>
          </div>
        </div>

        <div style={{ marginTop: 18 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Fetch Options</div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', cursor: 'pointer', textTransform: 'none', letterSpacing: 0, fontSize: 13, color: 'var(--text-1)', fontWeight: 400 }}>
            <input type="checkbox" checked={fetchKarma} onChange={(e) => setFetchKarma(e.target.checked)} style={{ width: 'auto' }} />
            Fetch Karma Requirements
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', cursor: 'pointer', textTransform: 'none', letterSpacing: 0, fontSize: 13, color: 'var(--text-1)', fontWeight: 400 }}>
            <input type="checkbox" checked={fetchOther} onChange={(e) => setFetchOther(e.target.checked)} style={{ width: 'auto' }} />
            Fetch other Post Requirements
          </label>
        </div>

        <button onClick={run} disabled={busy} style={{
          marginTop: 18, width: '100%', padding: '14px 18px', borderRadius: 'var(--radius-lg)',
          border: 'none', cursor: busy ? 'not-allowed' : 'pointer',
          background: busy ? 'var(--bg-3)' : 'linear-gradient(90deg, #3a6f8c 0%, #6a4fc4 100%)',
          color: '#fff', fontWeight: 700, fontSize: 14, letterSpacing: '0.02em',
          boxShadow: busy ? 'none' : '0 4px 18px -6px rgba(106,79,196,0.6)',
        }}>
          {busy ? 'Fetching…' : 'Start Intelligence Fetch'}
        </button>
      </div>

      {rows.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'var(--bg-2)' }}>
                  <th style={th}>Subreddit</th>
                  <th style={{ ...th, textAlign: 'right' }}>Subscribers</th>
                  <th style={th}>NSFW</th>
                  <th style={th}>Type</th>
                  <th style={{ ...th, textAlign: 'right' }}>Min age</th>
                  <th style={{ ...th, textAlign: 'right' }}>Min post k</th>
                  <th style={{ ...th, textAlign: 'right' }}>Min cmt k</th>
                  <th style={th}>Rules</th>
                  <th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.name} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={td}><span style={{ color: 'var(--gold)' }}>r/{r.name}</span></td>
                    <td style={{ ...td, textAlign: 'right' }} className="mono">{r.subscribers != null ? r.subscribers.toLocaleString() : '—'}</td>
                    <td style={td}>{r.over18 ? <span style={{ color: '#d9a3d9' }}>NSFW</span> : <span className="dim">SFW</span>}</td>
                    <td style={td} className="mono" >{r.submission_type || 'any'}</td>
                    <td style={{ ...td, textAlign: 'right' }} className="mono">{r.min_account_age_days ?? '—'}</td>
                    <td style={{ ...td, textAlign: 'right' }} className="mono">{r.min_post_karma ?? '—'}</td>
                    <td style={{ ...td, textAlign: 'right' }} className="mono">{r.min_comment_karma ?? '—'}</td>
                    <td style={td}>{r.rules?.length ? <span className="dim">{r.rules.length} rule{r.rules.length > 1 ? 's' : ''}</span> : <span className="dim">—</span>}</td>
                    <td style={{ ...td, textAlign: 'right' }}><button className="ghost" onClick={() => del(r.name)} style={{ fontSize: 11, padding: '3px 8px' }}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      </>)}
    </div>
  );
}

/* --------------------- COMPATIBILITY (account × intel) ------------------ */
function CompatibilityPanel({ token, accountId, accounts, onAccount }) {
  const [subs, setSubs] = useState([]);
  const [karma, setKarma] = useState({});
  const [acct, setAcct] = useState(null);
  const [pickedSub, setPickedSub] = useState('');

  useEffect(() => {
    window.api.intel.list({ token }).then((r) => { if (r.ok) setSubs(r.subs || []); });
    window.api.analytics.summary({ token }).then((r) => {
      if (r.ok) {
        const m = {};
        for (const a of r.accounts) m[a.id] = a;
        setKarma(m);
      }
    });
  }, [token]);

  useEffect(() => {
    if (!accountId) { setAcct(null); return; }
    setAcct(accounts.find((a) => String(a.id) === String(accountId)) || null);
  }, [accountId, accounts]);

  const rows = useMemo(() => {
    if (!acct) return [];
    const k = karma[acct.id] || {};
    const ageDays = acct.created_at
      ? Math.floor((Date.now() - new Date(acct.created_at.replace(' ', 'T') + 'Z').getTime()) / 86400000)
      : null;
    return subs.map((s) => {
      const reasons = [];
      if (s.min_post_karma != null && (k.post_karma == null || k.post_karma < s.min_post_karma))
        reasons.push(`post karma ${k.post_karma ?? '?'} < ${s.min_post_karma}`);
      if (s.min_comment_karma != null && (k.comment_karma == null || k.comment_karma < s.min_comment_karma))
        reasons.push(`comment karma ${k.comment_karma ?? '?'} < ${s.min_comment_karma}`);
      if (s.min_account_age_days != null && (ageDays == null || ageDays < s.min_account_age_days))
        reasons.push(`age ${ageDays ?? '?'}d < ${s.min_account_age_days}d`);
      return { ...s, qualifies: reasons.length === 0, reasons };
    });
  }, [subs, karma, acct]);

  const qualifying = rows.filter((r) => r.qualifies);
  const failing = rows.filter((r) => !r.qualifies);

  // Reverse lookup: for a picked subreddit, which accounts meet its gates.
  const recommendedAccounts = useMemo(() => {
    if (!pickedSub) return [];
    const intel = subs.find((s) => s.name.toLowerCase() === pickedSub.toLowerCase());
    if (!intel) return [];
    return accounts
      .filter((a) => (a.platform || 'reddit') === 'reddit')
      .map((a) => {
        const k = karma[a.id] || {};
        const ageDays = a.created_at
          ? Math.floor((Date.now() - new Date(a.created_at.replace(' ', 'T') + 'Z').getTime()) / 86400000)
          : null;
        const reasons = [];
        if (intel.min_post_karma != null && (k.post_karma == null || k.post_karma < intel.min_post_karma))
          reasons.push(`post karma`);
        if (intel.min_comment_karma != null && (k.comment_karma == null || k.comment_karma < intel.min_comment_karma))
          reasons.push(`comment karma`);
        if (intel.min_account_age_days != null && (ageDays == null || ageDays < intel.min_account_age_days))
          reasons.push(`age`);
        return { ...a, k, ageDays, qualifies: reasons.length === 0, reasons };
      })
      .sort((a, b) => Number(b.qualifies) - Number(a.qualifies));
  }, [pickedSub, subs, accounts, karma]);

  return (
    <div>
      <div className="card" style={{ padding: 18, marginBottom: 14 }}>
        <label>Check account</label>
        <select value={accountId} onChange={(e) => onAccount(e.target.value)}>
          <option value="">— pick an account —</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>u/{a.username} · {a.profile_name}</option>)}
        </select>
        {acct && (
          <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            Post karma {karma[acct.id]?.post_karma ?? '—'} · Comment karma {karma[acct.id]?.comment_karma ?? '—'} · Age {acct.created_at ? Math.floor((Date.now() - new Date(acct.created_at.replace(' ', 'T') + 'Z').getTime()) / 86400000) + 'd' : '—'}
          </div>
        )}
      </div>

      {/* Recommended accounts for a subreddit */}
      <div className="card" style={{ padding: 18, marginBottom: 14 }}>
        <label>Recommended accounts for a subreddit</label>
        <select value={pickedSub} onChange={(e) => setPickedSub(e.target.value)}>
          <option value="">— pick a subreddit —</option>
          {subs.map((s) => <option key={s.name} value={s.name}>r/{s.name}</option>)}
        </select>
        {pickedSub && recommendedAccounts.length > 0 && (
          <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {recommendedAccounts.slice(0, 24).map((a) => (
              <span key={a.id} style={{
                padding: '4px 10px', borderRadius: 999, fontSize: 12,
                border: '1px solid ' + (a.qualifies ? 'var(--green)' : 'var(--border)'),
                background: a.qualifies ? 'var(--green-soft)' : 'var(--bg-1)',
                color: a.qualifies ? 'var(--green-bright)' : 'var(--text-3)',
              }} title={a.qualifies ? 'Meets all gates' : `Missing: ${a.reasons.join(', ')}`}>
                {a.qualifies ? '✓ ' : '✗ '}u/{a.username}
              </span>
            ))}
            {recommendedAccounts.length > 24 && (
              <span className="muted" style={{ fontSize: 11, alignSelf: 'center' }}>…and {recommendedAccounts.length - 24} more</span>
            )}
          </div>
        )}
      </div>

      {!acct ? null : subs.length === 0 ? (
        <div className="card" style={{ padding: 30, textAlign: 'center' }} className="muted">
          No subreddit intel yet. Fetch some under the Requirements tab first.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div className="card" style={{ padding: 14 }}>
            <div style={{ fontSize: 11, color: 'var(--green-bright)', marginBottom: 10, letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 700 }}>
              ✓ Qualifies · {qualifying.length}
            </div>
            {qualifying.length === 0 ? <div className="muted" style={{ fontSize: 12 }}>None.</div>
              : qualifying.map((s) => (
                <div key={s.name} style={{ padding: '6px 0', borderTop: '1px solid var(--border)', fontSize: 13 }}>
                  <span style={{ color: 'var(--gold)' }}>r/{s.name}</span>
                  <span className="muted" style={{ marginLeft: 8, fontSize: 11 }}>{s.subscribers ? `${s.subscribers.toLocaleString()} subs` : ''}</span>
                </div>
              ))}
          </div>
          <div className="card" style={{ padding: 14 }}>
            <div style={{ fontSize: 11, color: '#e2a3a3', marginBottom: 10, letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 700 }}>
              ✗ Fails · {failing.length}
            </div>
            {failing.length === 0 ? <div className="muted" style={{ fontSize: 12 }}>None.</div>
              : failing.map((s) => (
                <div key={s.name} style={{ padding: '8px 0', borderTop: '1px solid var(--border)', fontSize: 13 }}>
                  <div><span style={{ color: 'var(--gold)' }}>r/{s.name}</span></div>
                  <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{s.reasons.join(' · ')}</div>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ----------------------- SCRAPER (inside Intelligence) ------------------- */
function AccountSelect({ accounts, accountId, onAccount }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label>Scraper account</label>
      <select value={accountId} onChange={(e) => onAccount(e.target.value)}>
        <option value="">— select an account —</option>
        {accounts.map((a) => <option key={a.id} value={a.id}>u/{a.username} · {a.profile_name}</option>)}
      </select>
    </div>
  );
}

function ScraperPanel({ token, accountId, accounts, onAccount, onMsg, onError }) {
  const [mode, setMode] = useState('posts'); // posts | user | mods | flairs
  const [subreddit, setSubreddit] = useState('');
  const [username, setUsername] = useState('');
  const [sort, setSort] = useState('hot');
  const [tWin, setTWin] = useState('day');
  const [limit, setLimit] = useState(25);
  const [posts, setPosts] = useState([]);
  const [userData, setUserData] = useState(null);
  const [mods, setMods] = useState([]);
  const [flairs, setFlairs] = useState([]);
  const [busy, setBusy] = useState(false);

  const requireAccount = () => {
    if (!accountId) { onError('Pick a scraper account first.'); return false; }
    return true;
  };

  async function runPosts() {
    if (!requireAccount() || !subreddit.trim()) { onError('Enter a subreddit.'); return; }
    setBusy(true);
    await window.api.session.prepareForAccount({ accountId: Number(accountId) });
    const r = await window.api.intel.scrapePosts({ token, accountId: Number(accountId), subreddit, sort, t: tWin, limit: Number(limit) });
    setBusy(false);
    if (r.ok) { setPosts(r.posts); onMsg(`Fetched ${r.posts.length} posts.`); } else onError(r.error);
  }
  async function runUser() {
    if (!requireAccount() || !username.trim()) { onError('Enter a username.'); return; }
    setBusy(true);
    await window.api.session.prepareForAccount({ accountId: Number(accountId) });
    const r = await window.api.intel.scrapeUser({ token, accountId: Number(accountId), username });
    setBusy(false);
    if (r.ok) { setUserData(r); onMsg(`Loaded u/${r.user.username}.`); } else onError(r.error);
  }
  async function runMods() {
    if (!requireAccount() || !subreddit.trim()) { onError('Enter a subreddit.'); return; }
    setBusy(true);
    await window.api.session.prepareForAccount({ accountId: Number(accountId) });
    const r = await window.api.intel.scrapeMods({ token, accountId: Number(accountId), subreddit });
    setBusy(false);
    if (r.ok) { setMods(r.mods); onMsg(`Fetched ${r.mods.length} moderators.`); } else onError(r.error);
  }
  async function runFlairs() {
    if (!requireAccount() || !subreddit.trim()) { onError('Enter a subreddit.'); return; }
    setBusy(true);
    await window.api.session.prepareForAccount({ accountId: Number(accountId) });
    const r = await window.api.intel.scrapeFlairs({ token, accountId: Number(accountId), subreddit });
    setBusy(false);
    if (r.ok) { setFlairs(r.flairs); onMsg(`Fetched ${r.flairs.length} flairs.`); } else onError(r.error);
  }

  return (
    <div>
      <div className="card" style={{ padding: 18, marginBottom: 16 }}>
        <AccountSelect accounts={accounts} accountId={accountId} onAccount={onAccount} />

        <div style={{ display: 'flex', gap: 4, marginBottom: 14, flexWrap: 'wrap' }}>
          {[
            { k: 'posts',  l: '🔥 Posts' },
            { k: 'user',   l: '👤 User' },
            { k: 'mods',   l: '🛡 Mods' },
            { k: 'flairs', l: '🏷 Flairs' },
          ].map((m) => (
            <button key={m.k} onClick={() => setMode(m.k)}
              className={mode === m.k ? 'primary' : 'ghost'}
              style={{ fontSize: 12, padding: '6px 12px' }}>{m.l}</button>
          ))}
        </div>

        {mode === 'posts' && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 10 }}>
              <div>
                <label>Subreddit</label>
                <input value={subreddit} onChange={(e) => setSubreddit(e.target.value)} placeholder="e.g. gonewild" />
              </div>
              <div>
                <label>Sort</label>
                <select value={sort} onChange={(e) => setSort(e.target.value)}>
                  <option value="hot">Hot</option>
                  <option value="top">Top</option>
                  <option value="rising">Rising</option>
                  <option value="new">New</option>
                </select>
              </div>
              {sort === 'top' ? (
                <div>
                  <label>Window</label>
                  <select value={tWin} onChange={(e) => setTWin(e.target.value)}>
                    {['hour','day','week','month','year','all'].map((x) => <option key={x} value={x}>{x}</option>)}
                  </select>
                </div>
              ) : <div />}
              <div>
                <label>Limit</label>
                <input type="number" min={1} max={100} value={limit} onChange={(e) => setLimit(e.target.value)} />
              </div>
            </div>
            <button onClick={runPosts} disabled={busy} className="primary" style={{ marginTop: 12 }}>
              {busy ? 'Fetching…' : 'Fetch posts'}
            </button>
          </div>
        )}

        {mode === 'user' && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <label>Username</label>
              <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="e.g. spez" />
            </div>
            <button onClick={runUser} disabled={busy} className="primary">{busy ? 'Loading…' : 'Load profile'}</button>
          </div>
        )}

        {(mode === 'mods' || mode === 'flairs') && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <label>Subreddit</label>
              <input value={subreddit} onChange={(e) => setSubreddit(e.target.value)} placeholder="e.g. nsfw" />
            </div>
            <button onClick={mode === 'mods' ? runMods : runFlairs} disabled={busy} className="primary">
              {busy ? 'Fetching…' : (mode === 'mods' ? 'List moderators' : 'List flairs')}
            </button>
          </div>
        )}
      </div>

      {mode === 'posts' && posts.length > 0 && <PostsResult posts={posts} subreddit={subreddit} />}
      {mode === 'user' && userData && <UserResult data={userData} />}
      {mode === 'mods' && mods.length > 0 && <ModsResult mods={mods} subreddit={subreddit} />}
      {mode === 'flairs' && flairs.length > 0 && <FlairsResult flairs={flairs} subreddit={subreddit} />}
    </div>
  );
}

function ExportRow({ name, rows }) {
  if (!rows || !rows.length) return null;
  return (
    <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
      <button className="ghost" onClick={() => navigator.clipboard.writeText(JSON.stringify(rows, null, 2))}>📋 Copy JSON</button>
      <button className="ghost" onClick={() => downloadFile(`${name}.json`, JSON.stringify(rows, null, 2), 'application/json')}>⬇ JSON</button>
      <button className="ghost" onClick={() => downloadFile(`${name}.csv`, toCSV(rows), 'text/csv')}>⬇ CSV</button>
    </div>
  );
}

function PostsResult({ posts, subreddit }) {
  return (
    <div className="card" style={{ padding: 14 }}>
      <ExportRow name={`r-${subreddit || 'posts'}`} rows={posts} />
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr style={{ background: 'var(--bg-2)' }}>
            <th style={th}>Title</th>
            <th style={th}>Author</th>
            <th style={{ ...th, textAlign: 'right' }}>Score</th>
            <th style={{ ...th, textAlign: 'right' }}>Comments</th>
            <th style={th}>Flair</th>
            <th style={th}>Age</th>
            <th style={th}></th>
          </tr></thead>
          <tbody>{posts.map((p) => (
            <tr key={p.id} style={{ borderTop: '1px solid var(--border)' }}>
              <td style={td}>{p.title}{p.over_18 ? <Tag tone="pink" style={{ marginLeft: 6 }}>NSFW</Tag> : null}</td>
              <td style={td} className="mono dim">u/{p.author}</td>
              <td style={{ ...td, textAlign: 'right' }} className="mono">{fmt(p.score)}</td>
              <td style={{ ...td, textAlign: 'right' }} className="mono">{fmt(p.num_comments)}</td>
              <td style={td}>{p.link_flair_text ? <Tag tone="blue">{p.link_flair_text}</Tag> : <span className="dim">—</span>}</td>
              <td style={td} className="mono dim">{ago(p.created)}</td>
              <td style={td}><a href={p.permalink} target="_blank" rel="noreferrer">↗</a></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}

function UserResult({ data }) {
  const u = data.user || {};
  return (
    <div className="card" style={{ padding: 16 }}>
      <ExportRow name={`u-${u.username || 'profile'}`} rows={[u]} />
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 14 }}>
        {u.icon_url
          ? <img src={u.icon_url} alt={u.username} style={{ width: 56, height: 56, borderRadius: '50%' }} />
          : <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--bg-3)' }} />}
        <div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>u/{u.username}</div>
          <div className="muted" style={{ fontSize: 12 }}>
            Total karma {fmt(u.total_karma)} · Posts {fmt(u.link_karma)} · Comments {fmt(u.comment_karma)} · Created {ago(u.created)} ago
            {u.is_gold ? ' · ★ Gold' : ''}{u.verified ? ' · ✓ Verified' : ''}
          </div>
        </div>
      </div>
      {data.recentPosts && data.recentPosts.length > 0 && (
        <>
          <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Recent posts ({data.recentPosts.length})</div>
          <PostsResult posts={data.recentPosts} subreddit={`u-${u.username}`} />
        </>
      )}
    </div>
  );
}

function ModsResult({ mods, subreddit }) {
  return (
    <div className="card" style={{ padding: 14 }}>
      <ExportRow name={`mods-${subreddit}`} rows={mods} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {mods.map((m) => (
          <div key={m.name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 999 }}>
            <span style={{ fontWeight: 600 }}>u/{m.name}</span>
            {(m.permissions || []).map((p) => <Tag key={p} tone="blue" style={{ marginLeft: 2 }}>{p}</Tag>)}
          </div>
        ))}
      </div>
    </div>
  );
}

function FlairsResult({ flairs, subreddit }) {
  return (
    <div className="card" style={{ padding: 14 }}>
      <ExportRow name={`flairs-${subreddit}`} rows={flairs} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {flairs.map((f) => (
          <span key={f.id} style={{
            padding: '4px 12px', borderRadius: 999, fontSize: 12, fontWeight: 600,
            background: f.background_color || 'var(--bg-2)', color: f.text_color === 'light' ? '#fff' : '#1a1a14',
            border: '1px solid var(--border-strong)',
          }}>{f.text || '(unnamed)'}{f.mod_only ? ' 🛡' : ''}</span>
        ))}
      </div>
    </div>
  );
}

/* ----------------------- RESEARCH (analysis of scraped) ----------------- */
function ResearchPanel({ token, accountId, accounts, onAccount, onMsg, onError }) {
  const [subreddit, setSubreddit] = useState('');
  const [sort, setSort] = useState('top');
  const [tWin, setTWin] = useState('week');
  const [busy, setBusy] = useState(false);
  const [insight, setInsight] = useState(null);

  async function go() {
    if (!accountId) { onError('Pick a scraper account first.'); return; }
    if (!subreddit.trim()) { onError('Enter a subreddit.'); return; }
    setBusy(true);
    await window.api.session.prepareForAccount({ accountId: Number(accountId) });
    const r = await window.api.intel.scrapePosts({ token, accountId: Number(accountId), subreddit, sort, t: tWin, limit: 100 });
    if (!r.ok) { setBusy(false); onError(r.error); return; }
    const a = await window.api.intel.analyze({ token, posts: r.posts });
    setBusy(false);
    if (a.ok) { setInsight({ ...a, subreddit }); onMsg(`Analyzed ${a.sample} posts.`); } else onError(a.error);
  }

  return (
    <div>
      <div className="card" style={{ padding: 18, marginBottom: 16 }}>
        <AccountSelect accounts={accounts} accountId={accountId} onAccount={onAccount} />
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', gap: 10, alignItems: 'end' }}>
          <div>
            <label>Subreddit</label>
            <input value={subreddit} onChange={(e) => setSubreddit(e.target.value)} placeholder="e.g. nsfw" />
          </div>
          <div>
            <label>Sort</label>
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="hot">Hot</option>
              <option value="top">Top</option>
              <option value="rising">Rising</option>
              <option value="new">New</option>
            </select>
          </div>
          <div>
            <label>Window</label>
            <select value={tWin} onChange={(e) => setTWin(e.target.value)}>
              {['day','week','month','year','all'].map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </div>
          <button onClick={go} disabled={busy} className="primary">{busy ? 'Analyzing…' : 'Analyze 100 posts'}</button>
        </div>
      </div>

      {insight && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 14 }}>
            <StatCard label="Sample" value={insight.sample} />
            <StatCard label="Avg score" value={insight.avgScore} accent="green" />
            <StatCard label="Avg comments" value={insight.avgComments} accent="blue" />
            <StatCard label="Best hour (UTC)" value={`${insight.bestHourUTC?.hour ?? '—'}:00`} accent="gold" />
          </div>
          <div className="card" style={{ padding: 14, marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Top words in titles</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {insight.topWords.map((w) => (
                <span key={w.word} style={{
                  padding: '4px 10px', borderRadius: 999, fontSize: 12,
                  background: 'var(--bg-1)', border: '1px solid var(--border)',
                }}>{w.word} <span style={{ color: 'var(--gold)', fontWeight: 700 }}>{w.n}</span></span>
              ))}
            </div>
          </div>
          <div className="card" style={{ padding: 14 }}>
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Avg score by hour (UTC)</div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 80 }}>
              {insight.hourly.map((h) => {
                const max = Math.max(1, ...insight.hourly.map((x) => x.avg));
                const pct = (h.avg / max) * 100;
                return (
                  <div key={h.hour} title={`${h.hour}:00 UTC · avg ${h.avg}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <div style={{ width: '100%', height: `${pct}%`, background: 'linear-gradient(0deg, var(--blue), var(--gold))', borderRadius: 3 }} />
                    <div style={{ fontSize: 9, color: 'var(--text-3)', marginTop: 4 }}>{h.hour}</div>
                  </div>
                );
              })}
            </div>
            <ExportRow name={`research-${insight.subreddit}`} rows={insight.hourly} />
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, accent = 'neutral' }) {
  const fg = ({
    blue: '#7fa8e0', green: 'var(--green-bright)', gold: 'var(--gold-bright)', neutral: 'var(--text-0)',
  })[accent];
  return (
    <div style={{
      flex: 1, border: '1px solid var(--border)', background: 'var(--bg-elev)',
      borderRadius: 'var(--radius-lg)', padding: '14px 16px',
    }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'var(--text-3)' }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 600, color: fg, marginTop: 4 }}>{value}</div>
    </div>
  );
}

const th = { textAlign: 'left', padding: '10px 12px', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-3)', fontWeight: 500, fontFamily: 'var(--font-mono)' };
const td = { padding: '9px 12px', verticalAlign: 'middle' };
