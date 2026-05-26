import React, { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';

// Ideas-only panel — like the composer but without the form, just generates and shows ideas.
export default function IdeasPanel({ account }) {
  const { token } = useAuth();
  const [mode, setMode] = useState('sfw');
  const [hint, setHint] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [hasApiKey, setHasApiKey] = useState(false);

  useEffect(() => {
    if (account) setMode(account.status === 'warming' ? 'sfw' : 'nsfw');
  }, [account?.id]);

  useEffect(() => {
    window.api.ai.hasApiKey({ token }).then(r => setHasApiKey(!!(r.ok && r.hasKey)));
  }, [token]);

  async function generate() {
    setError(null);
    setLoading(true);
    setSuggestions([]);
    const res = await window.api.ai.suggestPost({
      token, accountId: account.id, mode, hint: hint || null,
    });
    setLoading(false);
    if (!res.ok) { setError(res.error); return; }
    setSuggestions(res.suggestions);
  }

  function copy(s) {
    const text = `r/${s.subreddit}\n\n${s.title}${s.body ? '\n\n' + s.body : ''}`;
    navigator.clipboard.writeText(text);
  }

  return (
    <div>
      <div style={styles.header}>
        <div>
          <div className="eyebrow">Brainstorm — for <span className="mono" style={{ color: 'var(--text-1)' }}>u/{account.username}</span></div>
          <h1>Post Ideas</h1>
        </div>
      </div>

      <div style={styles.modeBar}>
        <div style={{ fontSize: 12, color: 'var(--text-2)', marginRight: 12 }}>Mode:</div>
        <button onClick={() => setMode('sfw')} style={{ ...styles.modeBtn, ...(mode === 'sfw' ? styles.modeBtnActive : {}) }}>SFW Warm-up</button>
        <button onClick={() => setMode('nsfw')} style={{ ...styles.modeBtn, ...(mode === 'nsfw' ? styles.modeBtnActive : {}) }}>NSFW Promo</button>
      </div>

      {!hasApiKey && (
        <div className="error-banner">AI features need an Anthropic API key. Admin: Settings → Anthropic API key.</div>
      )}

      <div className="card" style={{ marginBottom: 18 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <input
            placeholder='Optional vibe / theme hint (e.g. "weekend story", "asking about coffee")'
            value={hint}
            onChange={(e) => setHint(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && hasApiKey && generate()}
            disabled={!hasApiKey}
            style={{ flex: 1 }}
          />
          <button className="primary" onClick={generate} disabled={!hasApiKey || loading} style={{ whiteSpace: 'nowrap' }}>
            {loading ? 'Thinking…' : 'Generate ideas'}
          </button>
        </div>
        {error && <div className="error-banner">{error}</div>}
        {suggestions.length === 0 && !loading && !error && (
          <div className="muted" style={{ fontSize: 13, fontStyle: 'italic' }}>
            Click "Generate ideas" to get 3 post suggestions tailored to this account.
          </div>
        )}
      </div>

      {suggestions.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {suggestions.map((s, i) => (
            <div key={i} className="card">
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
                <span className="mono" style={{ color: 'var(--accent)', fontSize: 13 }}>r/{s.subreddit}</span>
                <div style={{ flex: 1 }} />
                <button className="ghost" onClick={() => copy(s)} style={{ fontSize: 11 }}>Copy</button>
              </div>
              <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 8 }}>{s.title}</div>
              {s.body && <div style={styles.body}>{s.body}</div>}
              {s.image_direction && <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>📷 {s.image_direction}</div>}
              {s.rationale && <div className="muted" style={{ fontSize: 12, fontStyle: 'italic' }}>{s.rationale}</div>}
            </div>
          ))}
          <div className="muted" style={{ fontSize: 11, fontStyle: 'italic', textAlign: 'center', marginTop: 6 }}>
            These are starting points — edit before posting to make it sound like you.
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  header: { marginBottom: 18, paddingBottom: 14, borderBottom: '1px solid var(--border)' },
  modeBar: {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '8px 14px', marginBottom: 18,
    background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
  },
  modeBtn: { fontSize: 12, padding: '5px 14px', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-2)' },
  modeBtnActive: { background: 'var(--accent-soft)', borderColor: 'var(--accent)', color: 'var(--accent)' },
  body: {
    fontSize: 13, color: 'var(--text-1)', marginBottom: 8,
    padding: 10, background: 'var(--bg-1)', borderRadius: 4,
    whiteSpace: 'pre-wrap',
  },
};
