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
        background: '#13110d',
        border: '1px solid #c9a227',
        borderRadius: 8,
        padding: '12px 16px',
        color: '#f5efe0',
        fontSize: 13,
        boxShadow: '0 6px 24px rgba(0,0,0,0.5)',
        maxWidth: 320,
      }}
    >
      {state.status === 'downloading' && (
        <>
          <div style={{ color: '#c9a227', fontWeight: 600, marginBottom: 4 }}>
            Update {state.version} downloading
          </div>
          <div style={{ fontSize: 12, opacity: 0.8 }}>{state.percent}% — will install on restart</div>
        </>
      )}
      {state.status === 'ready' && (
        <>
          <div style={{ color: '#c9a227', fontWeight: 600, marginBottom: 6 }}>
            Update {state.version} ready
          </div>
          <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 10 }}>
            Restart Oserus Management to apply.
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={restart}
              style={{
                background: '#c9a227',
                color: '#0d0c0a',
                border: 'none',
                borderRadius: 4,
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
                color: '#f5efe0',
                border: '1px solid #3a352b',
                borderRadius: 4,
                padding: '6px 12px',
                cursor: 'pointer',
              }}
            >
              Later
            </button>
          </div>
        </>
      )}
    </div>
  );
}
