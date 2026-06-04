import React, { useEffect, useState } from 'react';

// Profile picker — full-tab. Lists every model profile the operator can
// reach; each profile shows its bound model email (Oserus account) or a
// "guest" chip when none. Clicking an account row asks the main process
// to swap this window into a locked browsing session for that account.

export default function Picker() {
  const [token, setToken] = useState(null);
  const [profiles, setProfiles] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const stored = localStorage.getItem('auth_token');
        if (!stored) { setError('Not signed in. Open Oserus Management first.'); setLoading(false); return; }
        setToken(stored);
        const res = await window.oserusBrowser.picker.listProfiles({ token: stored });
        if (!res?.ok) { setError(res?.error || 'Failed to load profiles.'); setLoading(false); return; }
        setProfiles(res.profiles || []);
        setLoading(false);
      } catch (e) {
        setError(e?.message || 'Unexpected error');
        setLoading(false);
      }
    })();
  }, []);

  async function launch(accountId) {
    const res = await window.oserusBrowser.picker.launchAccount({ accountId });
    if (!res?.ok) setError(res?.error || 'Could not launch session.');
  }

  return (
    <div style={page}>
      <header style={header}>
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 600 }}>Oserus Browser</div>
          <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>Pick a model profile to open a locked session.</div>
        </div>
      </header>

      {loading && <div className="muted" style={{ padding: 40 }}>Loading profiles…</div>}
      {error && <div className="error-banner" style={{ marginBottom: 16 }}>{error}</div>}

      {!loading && !error && profiles.length === 0 && (
        <div className="muted" style={{ padding: 40 }}>No profiles available. Create one in Oserus Management → Model Profiles.</div>
      )}

      <div style={grid}>
        {profiles.map((p) => (
          <div key={p.id} style={card}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
              <div style={{ fontSize: 16, fontWeight: 600 }}>{p.name}</div>
              {p.main_email
                ? <span style={chipEmail} title="Bound to Oserus account">{p.main_email}</span>
                : <span style={chipGuest} title="No model email bound — guest profile">GUEST</span>}
            </div>

            {(p.accounts || []).length === 0 ? (
              <div className="muted" style={{ fontSize: 12 }}>No accounts linked yet.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {p.accounts.map((a) => (
                  <button key={a.id} onClick={() => launch(a.id)} style={acctRow}>
                    <span style={{ ...dot, background: a.status === 'banned' ? '#e2a3a3' : a.status === 'ready' ? '#7fd99a' : '#d4a64a' }} />
                    <span className="mono" style={{ fontSize: 12 }}>{a.platform}</span>
                    <span style={{ flex: 1, textAlign: 'left', fontWeight: 500 }}>{a.username}</span>
                    {a.proxy_label && <span className="mono dim" style={{ fontSize: 10 }}>via {a.proxy_label}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

const page = { padding: 28, maxWidth: 1100, margin: '0 auto' };
const header = { marginBottom: 20 };
const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 };
const card = {
  background: 'var(--bg-elev)', border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)', padding: 14,
};
const acctRow = {
  display: 'flex', alignItems: 'center', gap: 8,
  background: 'var(--bg-1)', border: '1px solid var(--border)',
  borderRadius: 8, padding: '7px 10px', cursor: 'pointer',
  color: 'var(--text-1)',
};
const dot = { width: 8, height: 8, borderRadius: '50%' };
const chipEmail = {
  fontFamily: 'var(--font-mono)', fontSize: 10, padding: '2px 6px',
  background: 'rgba(127,217,154,0.12)', color: '#7fd99a',
  border: '1px solid rgba(127,217,154,0.4)', borderRadius: 4,
};
const chipGuest = {
  fontFamily: 'var(--font-mono)', fontSize: 10, padding: '2px 6px',
  background: 'rgba(212,166,74,0.12)', color: 'var(--gold)',
  border: '1px solid rgba(212,166,74,0.4)', borderRadius: 4,
  letterSpacing: '0.08em',
};
