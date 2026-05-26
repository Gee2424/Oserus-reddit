import React, { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';

// Reusable composer panel — takes the active reddit account as a prop.
export default function ComposerPanel({ account }) {
  const { token } = useAuth();

  const [mode, setMode] = useState('sfw');
  const [hint, setHint] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [loadingAi, setLoadingAi] = useState(false);
  const [aiError, setAiError] = useState(null);
  const [hasApiKey, setHasApiKey] = useState(false);

  const [drafts, setDrafts] = useState([]);
  const [form, setForm] = useState(blankForm());
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  const [titleVariants, setTitleVariants] = useState([]);
  const [loadingTitle, setLoadingTitle] = useState(false);

  function blankForm() {
    return {
      subreddit: '', title: '', body: '', link_url: '',
      kind: 'self', flair: '', nsfw: false, scheduled_for: '',
    };
  }

  useEffect(() => {
    if (account) {
      setMode(account.status === 'warming' ? 'sfw' : 'nsfw');
      setForm(f => ({ ...f, nsfw: account.status !== 'warming' }));
      loadDrafts();
    }
  }, [account?.id]);

  useEffect(() => { setForm(f => ({ ...f, nsfw: mode === 'nsfw' })); }, [mode]);

  useEffect(() => {
    window.api.ai.hasApiKey({ token }).then(r => setHasApiKey(!!(r.ok && r.hasKey)));
  }, [token]);

  async function loadDrafts() {
    if (!account) return;
    const res = await window.api.posts.list({ token, accountId: account.id });
    if (res.ok) setDrafts(res.drafts);
  }

  async function getSuggestions() {
    setAiError(null);
    setLoadingAi(true);
    setSuggestions([]);
    const res = await window.api.ai.suggestPost({
      token, accountId: account.id, mode, hint: hint || null,
      targetSubreddit: form.subreddit || null,
    });
    setLoadingAi(false);
    if (!res.ok) { setAiError(res.error); return; }
    setSuggestions(res.suggestions);
  }

  function useSuggestion(s) {
    setForm({
      ...form,
      subreddit: s.subreddit,
      title: s.title,
      body: s.body || '',
      kind: s.kind || (mode === 'sfw' ? 'self' : 'image'),
      nsfw: mode === 'nsfw',
    });
    setSuggestions([]);
  }

  async function improveTitle() {
    if (!form.title) return;
    setLoadingTitle(true);
    setTitleVariants([]);
    const res = await window.api.ai.improveTitle({
      token, accountId: account.id, mode,
      currentTitle: form.title, subreddit: form.subreddit,
    });
    setLoadingTitle(false);
    if (res.ok) setTitleVariants(res.variants);
  }

  async function save(status) {
    setError(null);
    setSaved(false);
    if (!form.subreddit || !form.title) { setError('Subreddit and title required'); return; }
    const draft = {
      account_id: account.id,
      subreddit: form.subreddit.replace(/^\/?r\//, '').trim(),
      title: form.title,
      body: form.kind === 'self' ? form.body : null,
      link_url: form.kind === 'link' ? form.link_url : null,
      kind: form.kind, flair: form.flair || null,
      nsfw: form.nsfw, status,
      scheduled_for: status === 'scheduled' ? form.scheduled_for : null,
    };
    const res = await window.api.posts.create({ token, draft });
    if (!res.ok) { setError(res.error); return; }
    setSaved(true);
    setForm({ ...form, title: '', body: '', link_url: '' });
    loadDrafts();
    setTimeout(() => setSaved(false), 2500);
  }

  async function del(id) {
    if (!confirm('Delete this draft?')) return;
    await window.api.posts.delete({ token, draftId: id });
    loadDrafts();
  }

  return (
    <div>
      <div style={styles.modeBar}>
        <div style={{ fontSize: 12, color: 'var(--text-2)', marginRight: 12 }}>Mode:</div>
        <button onClick={() => setMode('sfw')} style={{ ...styles.modeBtn, ...(mode === 'sfw' ? styles.modeBtnActive : {}) }}>
          SFW Warm-up
        </button>
        <button onClick={() => setMode('nsfw')} style={{ ...styles.modeBtn, ...(mode === 'nsfw' ? styles.modeBtnActive : {}) }}>
          NSFW Promo
        </button>
        <div style={{ flex: 1 }} />
        <div className="muted" style={{ fontSize: 11, fontStyle: 'italic' }}>
          {mode === 'sfw'
            ? 'Engagement posts for mainstream subs — no promo.'
            : "Promo posts for this model's NSFW subs."}
        </div>
      </div>

      {!hasApiKey && (
        <div className="error-banner" style={{ marginBottom: 18 }}>
          AI features need an Anthropic API key. Admin: Settings → Anthropic API key.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 22 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div className="card">
            <h3 style={{ marginBottom: 14 }}>AI suggestions</h3>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <input
                placeholder='Optional vibe / topic hint'
                value={hint}
                onChange={(e) => setHint(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && hasApiKey && getSuggestions()}
                disabled={!hasApiKey}
              />
              <button className="primary" onClick={getSuggestions} disabled={!hasApiKey || loadingAi} style={{ whiteSpace: 'nowrap' }}>
                {loadingAi ? 'Thinking…' : 'Get ideas'}
              </button>
            </div>

            {aiError && <div className="error-banner">{aiError}</div>}

            {suggestions.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {suggestions.map((s, i) => (
                  <div key={i} style={styles.suggestion}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
                      <span className="mono" style={{ color: 'var(--accent)', fontSize: 12 }}>r/{s.subreddit}</span>
                      <div style={{ flex: 1 }} />
                      <button className="primary" onClick={() => useSuggestion(s)} style={{ fontSize: 11, padding: '3px 10px' }}>Use this</button>
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 6 }}>{s.title}</div>
                    {s.body && <div style={styles.suggestionBody}>{s.body}</div>}
                    {s.image_direction && <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>📷 {s.image_direction}</div>}
                    {s.rationale && <div className="muted" style={{ fontSize: 11, fontStyle: 'italic' }}>{s.rationale}</div>}
                  </div>
                ))}
                <div className="muted" style={{ fontSize: 11, marginTop: 4, fontStyle: 'italic' }}>
                  Starting points — edit before posting to sound like you.
                </div>
              </div>
            )}
          </div>

          <div className="card">
            {error && <div className="error-banner">{error}</div>}
            {saved && <div style={styles.savedBanner}>Saved.</div>}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
              <div>
                <label>Subreddit</label>
                <input placeholder="r/somesubreddit" value={form.subreddit} onChange={(e) => setForm({ ...form, subreddit: e.target.value })} />
              </div>
              <div>
                <label>Post type</label>
                <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                  <option value="self">Text</option>
                  <option value="link">Link</option>
                  <option value="image">Image (upload on Reddit)</option>
                </select>
              </div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                <label>Title</label>
                <button className="ghost" onClick={improveTitle} disabled={!hasApiKey || !form.title || loadingTitle} style={{ fontSize: 11, padding: '2px 8px' }}>
                  {loadingTitle ? 'Thinking…' : '✨ Improve with AI'}
                </button>
              </div>
              <input maxLength={300} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              <div className="muted mono" style={{ fontSize: 11, marginTop: 4 }}>{form.title.length} / 300</div>

              {titleVariants.length > 0 && (
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div className="muted" style={{ fontSize: 11 }}>Alternatives — click to use:</div>
                  {titleVariants.map((v, i) => (
                    <button key={i} onClick={() => { setForm({ ...form, title: v }); setTitleVariants([]); }} style={styles.variantBtn}>{v}</button>
                  ))}
                </div>
              )}
            </div>

            {form.kind === 'self' && (
              <div style={{ marginBottom: 14 }}>
                <label>Body</label>
                <textarea rows={8} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
              </div>
            )}

            {form.kind === 'link' && (
              <div style={{ marginBottom: 14 }}>
                <label>Link URL</label>
                <input placeholder="https://…" value={form.link_url} onChange={(e) => setForm({ ...form, link_url: e.target.value })} />
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
              <div>
                <label>Flair (optional)</label>
                <input value={form.flair} onChange={(e) => setForm({ ...form, flair: e.target.value })} />
              </div>
              <div>
                <label>Schedule for (optional)</label>
                <input type="datetime-local" value={form.scheduled_for} onChange={(e) => setForm({ ...form, scheduled_for: e.target.value })} />
              </div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, textTransform: 'none', letterSpacing: 0, fontSize: 13, color: 'var(--text-0)' }}>
                <input type="checkbox" style={{ width: 'auto' }} checked={form.nsfw} onChange={(e) => setForm({ ...form, nsfw: e.target.checked })} />
                Mark as NSFW
              </label>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button className="primary" onClick={() => save('draft')}>Save draft</button>
              <button onClick={() => save('scheduled')} disabled={!form.scheduled_for}>Schedule</button>
              <div style={{ flex: 1 }} />
              <span className="muted mono" style={{ fontSize: 11, alignSelf: 'center' }}>
                Publishing via Reddit API — coming next
              </span>
            </div>
          </div>
        </div>

        <div>
          <h3 style={{ marginBottom: 10 }}>Drafts</h3>
          {drafts.length === 0 ? (
            <div className="empty-state" style={{ padding: 22 }}>No drafts yet.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {drafts.map((d) => (
                <div key={d.id} className="card" style={{ padding: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span className="pill">{d.status}</span>
                    <span className="mono dim" style={{ fontSize: 11 }}>r/{d.subreddit}</span>
                    {d.nsfw ? <span className="mono" style={{ fontSize: 9, color: 'var(--accent)' }}>NSFW</span> : null}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>{d.title}</div>
                  {d.scheduled_for && <div className="muted mono" style={{ fontSize: 11 }}>→ {d.scheduled_for}</div>}
                  <button className="danger" onClick={() => del(d.id)} style={{ marginTop: 8, fontSize: 11, padding: '4px 8px' }}>Delete</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const styles = {
  modeBar: {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '8px 14px', marginBottom: 18,
    background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
  },
  modeBtn: { fontSize: 12, padding: '5px 14px', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-2)' },
  modeBtnActive: { background: 'var(--accent-soft)', borderColor: 'var(--accent)', color: 'var(--accent)' },
  suggestion: { padding: 12, background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' },
  suggestionBody: {
    fontSize: 12, color: 'var(--text-1)', marginBottom: 6,
    padding: 8, background: 'var(--bg-1)', borderRadius: 3,
    fontStyle: 'italic', whiteSpace: 'pre-wrap',
  },
  variantBtn: {
    textAlign: 'left', padding: '6px 10px', fontSize: 12,
    background: 'var(--bg-2)', border: '1px solid var(--border)', color: 'var(--text-1)',
  },
  savedBanner: {
    background: 'rgba(122,154,90,0.12)', border: '1px solid var(--ok)', color: '#bdd5a3',
    padding: '10px 14px', borderRadius: 4, marginBottom: 12,
  },
};
