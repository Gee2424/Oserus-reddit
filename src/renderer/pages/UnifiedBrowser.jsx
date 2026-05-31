import React from 'react';

// Minimal Browser entry. Per the new architecture: every actual browsing
// happens via Model Profile → ▶ on a model row (which hands the URLs off to
// Opera GX / the OS default browser). This page just nudges the user there.

export default function UnifiedBrowser({ navigate }) {
  async function openReddit() {
    await window.api.windows.openExternalTabs({ urls: ['https://www.reddit.com/'] });
  }

  return (
    <div>
      <div className="title-block">
        <div>
          <div className="eyebrow">Workspace</div>
          <h1>Browser</h1>
          <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
            Open accounts from Model Profile — every linked platform launches
            in your external browser, pre-tabbed.
          </div>
        </div>
      </div>

      <div style={{
        marginTop: 40, padding: '60px 30px', textAlign: 'center',
        background: 'var(--bg-elev)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
      }}>
        <button
          onClick={openReddit}
          title="Open Reddit in your browser"
          style={{
            width: 96, height: 96, borderRadius: '50%',
            background: 'linear-gradient(135deg, var(--green), var(--gold))',
            color: '#1a1a14', border: '1px solid var(--gold)',
            fontSize: 36, fontWeight: 800, cursor: 'pointer',
            display: 'grid', placeItems: 'center',
            boxShadow: '0 8px 30px rgba(127,217,154,0.35)',
            margin: '0 auto 20px',
          }}
        >▶</button>
        <h2 style={{ marginBottom: 8 }}>Pick a model to start</h2>
        <div className="muted" style={{ fontSize: 13, maxWidth: 480, margin: '0 auto 22px', lineHeight: 1.6 }}>
          The browser opens externally (Opera GX if installed, otherwise your
          default). Head to <strong style={{ color: 'var(--text-1)' }}>Model Profiles</strong> to add accounts
          or pick a model to launch all of its linked platforms at once.
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          {navigate && <button className="primary" onClick={() => navigate('profiles')}>Model Profiles</button>}
          {navigate && <button className="ghost" onClick={() => navigate('dashboard')}>Dashboard</button>}
        </div>
      </div>
    </div>
  );
}
