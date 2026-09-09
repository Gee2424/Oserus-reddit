import React, { useEffect, useState } from 'react';

export default function UpdateBanner() {
  const [state, setState] = useState({ status: 'idle', version: '', percent: 0 });

  useEffect(() => {
    if (!window.api?.updater) return;
    window.api.updater.onAvailable(({ version }) =>
      setState({ status: 'downloading', version, percent: 0 })
    );
    window.api.updater.onProgress(({ percent }) =>
      setState((s) => ({ ...s, status: 'downloading', percent }))
    );
    window.api.updater.onReady(({ version }) =>
      setState({ status: 'ready', version, percent: 100 })
    );
  }, []);

  if (state.status === 'idle') return null;

  const restart = () => window.api.updater.installNow();

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 20,
        right: 20,
        zIndex: 9999,
        background: 'var(--bg-1)',
        border: '1px solid var(--gold-bright)',
        borderRadius: 'var(--radius-lg)',
        padding: '12px 16px',
        color: 'var(--text-0)',
        fontSize: 'var(--text-body)',
        boxShadow: '0 6px 24px rgba(0,0,0,0.5)',
        maxWidth: 320,
      }}
    >
      {state.status === 'downloading' && (
        <>
          <div style={{ color: 'var(--gold-bright)', fontWeight: 600, marginBottom: 4 }}>
            Update {state.version} downloading
          </div>
          <div style={{ fontSize: 'var(--text-sm)', opacity: 0.8 }}>{state.percent}% — will install on restart</div>
        </>
      )}
      {state.status === 'ready' && (
        <>
          <div style={{ color: 'var(--gold-bright)', fontWeight: 600, marginBottom: 6 }}>
            Update {state.version} ready
          </div>
          <div style={{ fontSize: 'var(--text-sm)', opacity: 0.85, marginBottom: 10 }}>
            Will install automatically next time you close the app — or restart now.
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={restart}
              style={{
                background: 'var(--gold-bright)',
                color: 'var(--bg-0)',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                padding: '6px 12px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Restart now
            </button>
            <button
              onClick={() => setState({ status: 'idle', version: '', percent: 0 })}
              style={{
                background: 'transparent',
                color: 'var(--text-0)',
                border: '1px solid var(--border-strong)',
                borderRadius: 'var(--radius-sm)',
                padding: '6px 12px',
                cursor: 'pointer',
              }}
            >
              Install on close
            </button>
          </div>
        </>
      )}
    </div>
  );
}
