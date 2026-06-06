import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { Banner } from '../components/ui.jsx';
import PopOutButton from '../components/PopOutButton.jsx';
import AccountSelector from '../components/AccountSelector.jsx';

// Intelligence.
//
// Account-driven research workspace. The operator picks Model →
// Platform → Account at the top; everything below adapts to that
// selection's native terminology and runs the right backend.
//
//   • Reddit         — Discover, Requirements scrape, Compatibility check
//   • X / IG / TikTok — Discover (browser-driven DOM scrape via
//                       services/discover.js), with platform-native
//                       labels (handle / hashtag / sound / reel / etc.)
//
// What was removed (dead duplicates from older rewrites)
//   • ScraperPanel, ResearchPanel, PlanPanel — defined but never
//     rendered (3 redundant copies of the same scrape→analyze→plan
//     flow that UnifiedDiscoverPanel already covered).
//   • AccountSelect, ExportRow, PostsResult, UserResult, ModsResult,
//     FlairsResult, StatCard — only consumed by those dead panels.
//
// What was fixed
//   • Account list is now per-platform. The old page filtered to
//     `forPlatform('reddit')` once at the top, so picking X still
//     left a Reddit account in the dropdown — and the X scraper
//     would silently use the wrong session. Now the AccountSelector
//     swaps the account list to the chosen platform.

const PLATFORM_LANG = {
  reddit: {
    target:        { label: 'Subreddit',     placeholder: 'e.g. fitness, r/fitness, or full URL' },
    query:         { label: 'Search keywords (optional)', placeholder: 'e.g. espresso' },
    targetEmpty:   'Enter a subreddit.',
    runLabel:      'Scrape · Analyze · Plan',
    resultUnit:    'posts',
    targetPrefix:  'r/',
    supportsSort:  true,
  },
  x: {
    target:        { label: 'Handle or topic', placeholder: '#fitness or @handle' },
    query:         { label: 'Optional extra keyword', placeholder: 'e.g. running' },
    targetEmpty:   'Enter a hashtag or @handle.',
    runLabel:      'Scrape posts · Analyze · Plan',
    resultUnit:    'posts',
    targetPrefix:  '',
    supportsSort:  false,
  },
  instagram: {
    target:        { label: 'Hashtag or @handle', placeholder: '#cosplay or @handle' },
    query:         { label: 'Optional extra keyword', placeholder: 'e.g. studio' },
    targetEmpty:   'Enter a hashtag or @handle.',
    runLabel:      'Scrape reels · Analyze · Plan',
    resultUnit:    'reels',
    targetPrefix:  '',
    supportsSort:  false,
  },
  tiktok: {
    target:        { label: 'Hashtag, sound, or @handle', placeholder: '#fyp, sound, or @handle' },
    query:         { label: 'Optional extra keyword', placeholder: 'e.g. dance' },
    targetEmpty:   'Enter a hashtag, sound, or @handle.',
    runLabel:      'Scrape videos · Analyze · Plan',
    resultUnit:    'videos',
    targetPrefix:  '',
    supportsSort:  false,
  },
  redgifs: {
    target:        { label: 'Tag',           placeholder: 'e.g. cosplay' },
    query:         { label: 'Optional extra keyword', placeholder: '' },
    targetEmpty:   'Enter a tag.',
    runLabel:      'Scrape clips · Analyze · Plan',
    resultUnit:    'clips',
    targetPrefix:  '',
    supportsSort:  false,
  },
};

export default function IntelligencePage() {
  const { token } = useAuth();

  const [profiles, setProfiles] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [sel, setSel] = useState({ profileId: null, platform: 'reddit', accountId: null });
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    window.api.profiles.list({ token }).then((r) => { if (r.ok) setProfiles(r.profiles || []); });
    window.api.accounts.listForUser({ token }).then((r) => { if (r.ok) setAccounts(r.accounts || []); });
  }, [token]);

  useEffect(() => {
    if (!msg && !err) return;
    const t = setTimeout(() => { setMsg(null); setErr(null); }, 5000);
    return () => clearTimeout(t);
  }, [msg, err]);

  const platform = sel.platform || 'reddit';
  const lang = PLATFORM_LANG[platform] || PLATFORM_LANG.reddit;

  return (
    <div>
      <div className="title-block">
        <div>
          <div className="eyebrow">Research</div>
          <h1>Intelligence</h1>
          <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
            Scrape, analyze, and plan content using a logged-in account. The platform you pick
            decides which session is used and what to call things.
          </div>
        </div>
        <div style={{ marginLeft: 'auto' }}><PopOutButton route="intel" title="Intelligence" /></div>
      </div>

      <AccountSelector
        profiles={profiles}
        accounts={accounts}
        value={sel}
        onChange={setSel}
        requireAccount={false}
      />

      {err && <Banner kind="err">{err}</Banner>}
      {msg && <Banner kind="ok">{msg}</Banner>}

      {!sel.accountId ? (
        <div className="card" style={{ padding: 20, color: 'var(--text-3)', fontSize: 13 }}>
          Pick a model and platform above, then an account on that platform. Scraping uses that
          account's logged-in session so the platform serves real data (not the visitor wall).
        </div>
      ) : (
        <>
          <DiscoverPanel
            token={token}
            accountId={sel.accountId}
            profileId={sel.profileId}
            platform={platform}
            lang={lang}
            onMsg={setMsg}
            onError={setErr}
          />

          {platform === 'reddit' && (
            <>
              <RequirementsPanel
                token={token}
                accountId={sel.accountId}
                onMsg={setMsg}
                onError={setErr}
              />
              <CompatibilityPanel token={token} accountId={sel.accountId} accounts={accounts} />
            </>
          )}
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────── Discover (per platform)

function DiscoverPanel({ token, accountId, profileId, platform, lang, onMsg, onError }) {
  const [target, setTarget] = useState('');
  const [query,  setQuery]  = useState('');
  // Reddit-only.
  const [sort,    setSort]    = useState('hot');
  const [tWindow, setTWindow] = useState('week');
  const [limit,   setLimit]   = useState(50);

  const [savePlanProfileId, setSavePlanProfileId] = useState('');
  const [profiles, setProfiles] = useState([]);
  useEffect(() => {
    window.api.profiles.list({ token }).then((r) => { if (r.ok) setProfiles(r.profiles || []); });
  }, [token]);
  // If a model is already picked upstream, default the save-target to it.
  useEffect(() => {
    if (profileId) setSavePlanProfileId(String(profileId));
  }, [profileId]);

  // Reset form when platform / account changes — keeps the wrong-terminology
  // text from a previous platform out of view.
  useEffect(() => {
    setTarget(''); setQuery(''); setPosts([]); setAnalysis(null); setPlan(null);
  }, [platform, accountId]);

  const [posts, setPosts]       = useState([]);
  const [analysis, setAnalysis] = useState(null);
  const [plan, setPlan]         = useState(null);
  const [stage, setStage]       = useState('idle');   // idle | scraping | analyzing | planning
  const [busy, setBusy]         = useState(false);

  async function run() {
    if (!target.trim()) { onError(lang.targetEmpty); return; }
    setBusy(true); setPosts([]); setAnalysis(null); setPlan(null);
    try {
      // 1) Scrape
      setStage('scraping');
      // Make sure the partition is fresh — proxy / UA / antidetect get
      // re-applied before the scrape opens a network connection.
      await window.api.session.prepareForAccount({ accountId: Number(accountId) });
      let r;
      if (platform === 'reddit') {
        r = await window.api.intel.scrapePosts({
          token, accountId: Number(accountId),
          subreddit: target, sort, t: tWindow,
          limit: Number(limit) || 50,
          query: query.trim() || undefined,
        });
      } else {
        // X / IG / TikTok all share the discover.js browser scraper. We
        // hand it whichever combined search term the operator typed.
        const keyword = [target, query].map((s) => s.trim()).filter(Boolean).join(' ').trim();
        r = await window.api.intel.discoverScrape({
          token, accountId: Number(accountId), platform, keyword,
        });
      }
      if (!r.ok) { onError(r.error || 'Scrape failed'); return; }
      const fetched = r.posts || [];
      setPosts(fetched);
      if (!fetched.length) {
        onMsg(platform === 'reddit'
          ? 'No posts came back from that subreddit.'
          : `No ${lang.resultUnit} surfaced. Either the page didn't load (try again — sessions cold-start slow) or ${platform} changed its DOM.`);
        return;
      }

      // 2) Analyze (trend words + best post-hour)
      setStage('analyzing');
      const an = await window.api.intel.analyze({ token, posts: fetched });
      if (an.ok) setAnalysis(an);

      // 3) Plan via AI
      setStage('planning');
      const findings = fetched.slice(0, 12).map((p) => ({
        subreddit: p.subreddit || (platform === 'reddit' ? target : platform),
        title: p.title, ups: p.score, num_comments: p.num_comments,
      }));
      const pl = await window.api.intel.synthesizePlan({
        token,
        profileId: savePlanProfileId ? Number(savePlanProfileId) : null,
        findings,
        save: !!savePlanProfileId,
      });
      if (pl.ok) setPlan(pl);
      else onError(pl.error || 'Plan synthesis failed');
    } catch (e) {
      onError(e.message);
    } finally {
      setStage('idle'); setBusy(false);
    }
  }

  const stageLabel = {
    idle:      lang.runLabel,
    scraping:  `Scraping ${lang.resultUnit}…`,
    analyzing: 'Analyzing trends…',
    planning:  'Synthesizing plan with AI…',
  }[stage];

  return (
    <div className="card" style={{ padding: 18, marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>Discover</h3>
        <span className="muted" style={{ fontSize: 12 }}>
          scrape → trend analysis → AI content plan
        </span>
      </div>

      {platform !== 'reddit' && (
        <div style={infoNote}>
          ⓘ {platform} discover opens a hidden browser on this account's session, lands on the
          {platform === 'tiktok' ? ' hashtag or @handle' : platform === 'instagram' ? ' tag or profile' : ' search'}
          {' '}page, scrolls, and scrapes the visible cards. Selectors are best-effort — if
          results come back empty repeatedly, {platform} likely changed its DOM.
        </div>
      )}

      {/* Top row: target + optional save-to-model */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
        <div>
          <label>{lang.target.label}</label>
          <input
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder={lang.target.placeholder}
          />
        </div>
        <div>
          <label>Save plan to model (optional)</label>
          <select value={savePlanProfileId} onChange={(e) => setSavePlanProfileId(e.target.value)}>
            <option value="">— don't save (preview only) —</option>
            {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      </div>

      {/* Second row: per-platform fields */}
      {platform === 'reddit' ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr 1fr', gap: 10 }}>
          <div>
            <label>{lang.query.label}</label>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={lang.query.placeholder} />
          </div>
          <div>
            <label>Sort</label>
            <select value={sort} onChange={(e) => setSort(e.target.value)}>
              <option>hot</option><option>top</option><option>rising</option><option>new</option>
            </select>
          </div>
          <div>
            <label>Window</label>
            <select value={tWindow} onChange={(e) => setTWindow(e.target.value)} disabled={sort !== 'top'}>
              <option>hour</option><option>day</option><option>week</option><option>month</option><option>year</option><option>all</option>
            </select>
          </div>
          <div>
            <label>Limit</label>
            <input type="number" min={5} max={100} value={limit} onChange={(e) => setLimit(e.target.value)} />
          </div>
        </div>
      ) : (
        <div>
          <label>{lang.query.label}</label>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={lang.query.placeholder} />
        </div>
      )}

      <button
        onClick={run}
        disabled={busy}
        className="primary"
        style={{
          width: '100%', padding: '12px 18px', marginTop: 14,
          background: busy ? 'var(--bg-1)' : 'linear-gradient(90deg, #3a6f8c, #6a4fc4)',
        }}
      >
        {busy ? <><Spinner /> {stageLabel}</> : `→ ${stageLabel}`}
      </button>

      {posts.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div style={subhead}>{lang.resultUnit[0].toUpperCase() + lang.resultUnit.slice(1)} · {posts.length}</div>
          <div style={{ maxHeight: 280, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {posts.slice(0, 60).map((p) => (
              <a key={p.id || p.url || p.title} href={p.url} target="_blank" rel="noreferrer" style={resultRow}>
                <span className="mono" style={{ minWidth: 60, color: 'var(--gold)' }}>
                  {(p.score ?? 0).toLocaleString()}{platform === 'reddit' ? '↑' : ''}
                </span>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.title || '(no caption)'}
                </span>
                <span className="dim" style={{ minWidth: 70, textAlign: 'right' }}>
                  {p.author ? `@${p.author}` : ''}
                </span>
              </a>
            ))}
          </div>
        </div>
      )}

      {analysis && (
        <div style={trendBox}>
          <div style={subhead}>Trends</div>
          {Array.isArray(analysis.topWords) && analysis.topWords.length > 0 && (
            <div style={{ fontSize: 12, marginBottom: 8 }}>
              <span className="muted">Top words: </span>
              {analysis.topWords.slice(0, 12).map((w, i) => (
                <span key={i} style={chip}>{w.word} <span className="dim">×{w.count}</span></span>
              ))}
            </div>
          )}
          {analysis.bestHour != null && (
            <div style={{ fontSize: 12 }}>
              <span className="muted">Best posting hour (UTC):</span>{' '}
              <span className="mono" style={{ color: 'var(--gold)' }}>{analysis.bestHour}:00</span>
            </div>
          )}
        </div>
      )}

      {plan && (
        <div style={planBox}>
          <div style={subhead}>AI content plan {plan.savedDocId ? '· saved to docs' : ''}</div>
          <div style={{ whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.55 }}>
            {plan.plan || plan.text || JSON.stringify(plan)}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────── Reddit-only: requirements scrape

function RequirementsPanel({ token, accountId, onMsg, onError }) {
  const [subs, setSubs] = useState('');
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await window.api.intel.list({ token });
    if (r.ok) setRows(r.subs || []);
  }, [token]);
  useEffect(() => { load(); }, [load]);

  async function run() {
    if (!subs.trim()) { onError('Enter at least one subreddit.'); return; }
    setBusy(true);
    await window.api.session.prepareForAccount({ accountId: Number(accountId) });
    const r = await window.api.intel.fetch({ token, accountId: Number(accountId), subreddits: subs });
    setBusy(false);
    if (r.ok) {
      onMsg(`Fetched ${r.fetched} subreddit(s).${r.errors?.length ? ` ${r.errors.length} failed.` : ''}`);
      if (r.errors?.length) onError(r.errors.join(' · '));
      load();
    } else onError(r.error);
  }
  async function del(name) {
    await window.api.intel.delete({ token, name });
    load();
  }

  return (
    <div className="card" style={{ padding: 18, marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>Subreddit requirements</h3>
        <span className="muted" style={{ fontSize: 12 }}>
          karma + age gates + rules — cached for the Scheduler / Autopilot eligibility checks
        </span>
      </div>

      <label>Subreddits (one per line)</label>
      <textarea
        value={subs}
        onChange={(e) => setSubs(e.target.value)}
        placeholder={'tittydrop\ngonewild\nnsfw'}
        style={{ minHeight: 100, fontFamily: 'var(--font-mono)', fontSize: 13 }}
      />

      <button
        onClick={run}
        disabled={busy}
        style={primaryGradientBtn(busy)}
      >
        {busy ? 'Fetching…' : 'Scrape requirements'}
      </button>

      {rows.length > 0 && (
        <div style={{ marginTop: 18, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--bg-2)' }}>
                <th style={th}>Subreddit</th>
                <th style={{ ...th, textAlign: 'right' }}>Subscribers</th>
                <th style={th}>NSFW</th>
                <th style={th}>Type</th>
                <th style={{ ...th, textAlign: 'right' }}>Min age (d)</th>
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
                  <td style={td} className="mono">{r.submission_type || 'any'}</td>
                  <td style={{ ...td, textAlign: 'right' }} className="mono">{r.min_account_age_days ?? '—'}</td>
                  <td style={{ ...td, textAlign: 'right' }} className="mono">{r.min_post_karma ?? '—'}</td>
                  <td style={{ ...td, textAlign: 'right' }} className="mono">{r.min_comment_karma ?? '—'}</td>
                  <td style={td}>{r.rules?.length ? <span className="dim">{r.rules.length}</span> : <span className="dim">—</span>}</td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    <button className="ghost" onClick={() => del(r.name)} style={{ fontSize: 11, padding: '3px 8px' }}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────── Reddit-only: account × subreddit gates

function CompatibilityPanel({ token, accountId, accounts }) {
  const [subs, setSubs] = useState([]);
  const [karma, setKarma] = useState({});

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

  const acct = useMemo(
    () => accounts.find((a) => a.id === accountId) || null,
    [accountId, accounts]
  );

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
  const failing    = rows.filter((r) => !r.qualifies);

  if (!acct) return null;
  if (subs.length === 0) {
    return (
      <div className="card muted" style={{ padding: 24, textAlign: 'center', fontSize: 13, marginBottom: 16 }}>
        Scrape some subreddit requirements first — then this panel shows which qualify for u/{acct.username}.
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: 16, marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>Compatibility</h3>
        <span className="muted" style={{ fontSize: 12 }}>
          u/{acct.username} · post karma {karma[acct.id]?.post_karma ?? '—'} · comment karma {karma[acct.id]?.comment_karma ?? '—'}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div style={{ padding: 12, background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 8 }}>
          <div style={{ ...subhead, color: 'var(--green-bright)' }}>✓ Qualifies · {qualifying.length}</div>
          {qualifying.length === 0
            ? <div className="muted" style={{ fontSize: 12 }}>None.</div>
            : qualifying.map((s) => (
                <div key={s.name} style={compatRow}>
                  <span style={{ color: 'var(--gold)' }}>r/{s.name}</span>
                  <span className="muted" style={{ marginLeft: 8, fontSize: 11 }}>
                    {s.subscribers ? `${s.subscribers.toLocaleString()} subs` : ''}
                  </span>
                </div>
              ))}
        </div>
        <div style={{ padding: 12, background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 8 }}>
          <div style={{ ...subhead, color: '#e2a3a3' }}>✗ Fails · {failing.length}</div>
          {failing.length === 0
            ? <div className="muted" style={{ fontSize: 12 }}>None.</div>
            : failing.map((s) => (
                <div key={s.name} style={compatRow}>
                  <div><span style={{ color: 'var(--gold)' }}>r/{s.name}</span></div>
                  <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{s.reasons.join(' · ')}</div>
                </div>
              ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────── small helpers

function Spinner() {
  return <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--gold)', display: 'inline-block', marginRight: 6, animation: 'pulse 1s ease-in-out infinite' }} />;
}

const infoNote = {
  background: 'rgba(60,110,180,0.10)',
  border: '1px solid #2c4a6e',
  borderRadius: 'var(--radius-lg)',
  padding: '10px 14px', marginBottom: 14,
  fontSize: 12, color: '#9fc0ea',
};
const subhead   = { fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 8 };
const resultRow = { display: 'flex', gap: 8, fontSize: 12, padding: '6px 8px', borderBottom: '1px dashed var(--border)', color: 'inherit', textDecoration: 'none' };
const chip      = { display: 'inline-block', marginRight: 6, marginBottom: 4, padding: '2px 8px', borderRadius: 999, background: 'var(--bg-elev)', border: '1px solid var(--border)', fontSize: 11 };
const trendBox  = { marginTop: 18, padding: 14, background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 10 };
const planBox   = { marginTop: 18, padding: 14, background: 'var(--bg-1)', border: '1px solid var(--gold)', borderRadius: 10 };
const th        = { textAlign: 'left', padding: '8px 12px', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-3)', fontWeight: 600, fontFamily: 'var(--font-mono)' };
const td        = { padding: '7px 12px', verticalAlign: 'middle' };
const compatRow = { padding: '6px 0', borderTop: '1px solid var(--border)', fontSize: 12 };
const primaryGradientBtn = (busy) => ({
  marginTop: 14, width: '100%', padding: '12px 18px', borderRadius: 'var(--radius-lg)',
  border: 'none', cursor: busy ? 'not-allowed' : 'pointer',
  background: busy ? 'var(--bg-3)' : 'linear-gradient(90deg, #3a6f8c 0%, #6a4fc4 100%)',
  color: '#fff', fontWeight: 700, fontSize: 13, letterSpacing: '0.02em',
});
