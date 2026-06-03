import React, { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import ModelLauncher from './ModelLauncher.jsx';

// Browser page = the inline model launcher. ▶ on a model row anywhere in the
// app routes here with { modelId }; we render the tabbed multi-webview
// surface right in the page (no popout). When opened bare, lists models so
// you can pick one.
export default function UnifiedBrowser({ navigate, modelId: initialModelId }) {
  const { token } = useAuth();
  const [activeId, setActiveId] = useState(initialModelId ? Number(initialModelId) : null);
  const [models, setModels] = useState([]);

  useEffect(() => {
    if (initialModelId) setActiveId(Number(initialModelId));
  }, [initialModelId]);

  useEffect(() => {
    (async () => {
      const r = await window.api.profiles.list({ token });
      if (r.ok) setModels(r.profiles || []);
    })();
  }, [token]);

  // When a model is active, pre-warm every linked account's session partition
  // before mounting the launcher so each webview tab lands logged in.
  useEffect(() => {
    if (!activeId) return;
    (async () => {
      const r = await window.api.accounts.listForProfile({ token, profileId: activeId });
      if (!r.ok) return;
      for (const a of (r.accounts || [])) {
        if (a.status === 'banned') continue;
        try { await window.api.session.prepareForAccount({ accountId: a.id }); } catch {}
      }
    })();
  }, [activeId, token]);

  // Pop-out: opens the launcher for the current model in its own BrowserWindow
  // via window:openModelLauncher. The popout is keyed by model id so a second
  // click just focuses the existing window. While popped out the user can keep
  // navigating the main workspace; the popout stays alive until they close it.
  async function popOutActive() {
    if (!activeId) return;
    await window.api.windows.openModelLauncher({ profileId: Number(activeId) });
  }

  if (activeId) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 60px)', margin: -24 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '8px 14px', borderBottom: '1px solid var(--border)',
          background: 'var(--bg-1)',
        }}>
          <button className="ghost" onClick={() => setActiveId(null)} style={{ fontSize: 12 }}>← Models</button>
          <select
            value={activeId}
            onChange={(e) => setActiveId(Number(e.target.value))}
            style={{ background: 'transparent', color: 'var(--text-1)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 10px', fontSize: 13 }}
          >
            {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <button
            className="ghost"
            onClick={popOutActive}
            style={{ marginLeft: 'auto', fontSize: 12 }}
            title="Open this model's launcher in its own window — keeps running while you use the rest of the app"
          >⧉ Pop out</button>
        </div>
        <div style={{ flex: 1, minHeight: 0 }}>
          <ModelLauncher modelId={activeId} />
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="title-block">
        <div>
          <div className="eyebrow">Workspace</div>
          <h1>Browser</h1>
          <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
            Pick a model — every linked account opens in a tab right here. ▶
            on a model row anywhere else jumps straight to this view.
          </div>
        </div>
      </div>

      {models.length === 0 ? (
        <div style={{
          marginTop: 40, padding: '40px 30px', textAlign: 'center',
          background: 'var(--bg-elev)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
        }}>
          <h2 style={{ marginBottom: 8 }}>No models yet</h2>
          <div className="muted" style={{ fontSize: 13, marginBottom: 16 }}>
            Add a model and link accounts to launch them here.
          </div>
          {navigate && <button className="primary" onClick={() => navigate('profiles')}>Model Profiles</button>}
        </div>
      ) : (
        <div style={{ marginTop: 18, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
          {models.map((m) => (
            <button
              key={m.id}
              onClick={() => setActiveId(m.id)}
              style={{
                background: 'var(--bg-elev)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius-lg)', padding: 18, cursor: 'pointer',
                textAlign: 'left', color: 'var(--text-1)',
                display: 'flex', alignItems: 'center', gap: 12,
              }}
            >
              <div style={{
                width: 42, height: 42, borderRadius: '50%',
                background: 'linear-gradient(135deg, var(--green), var(--gold))',
                color: '#1a1a14', display: 'grid', placeItems: 'center',
                fontWeight: 800, fontSize: 14,
              }}>▶</div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{m.name}</div>
                <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>Launch in this view</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
