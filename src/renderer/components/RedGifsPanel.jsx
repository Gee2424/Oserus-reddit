import React, { useEffect, useRef, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { useActiveAccount } from '../lib/activeAccount.jsx';
import AccountSwitcher from './AccountSwitcher.jsx';

export default function RedGifsPanel() {
  const { token } = useAuth();
  const { forPlatform } = useActiveAccount();
  const { active } = forPlatform('redgifs');
  const [creds, setCreds] = useState(null);
  const webviewRef = useRef(null);

  useEffect(() => {
    setCreds(null);
    if (!active) return;
    let cancelled = false;
    (async () => {
      const res = await window.api.accounts.getCredentials({ token, accountId: active.id });
      if (!cancelled && res.ok && (res.password || res.username)) setCreds(res);
    })();
    return () => { cancelled = true; };
  }, [active?.id, token]);

  function copy(text) { navigator.clipboard.writeText(text); }

  return (
    <div style={styles.wrap}>
      <div style={styles.header}>
        <AccountSwitcher platform="redgifs" />
      </div>

      {!active ? (
        <div className="empty-state" style={{ margin: 16, fontSize: 13 }}>
          Pick a RedGifs account above to start browsing.
        </div>
      ) : (
        <>
          {creds && (
            <div style={styles.credsBar}>
              <div style={{ fontSize: 11, color: 'var(--text-2)', marginRight: 4 }}>Saved:</div>
              <div style={styles.chip}>
                <span className="mono" style={{ fontSize: 11 }}>{creds.username}</span>
                <button className="ghost" onClick={() => copy(creds.username)} style={styles.copyBtn}>copy</button>
              </div>
              {creds.password && (
                <div style={styles.chip}>
                  <span className="mono" style={{ fontSize: 11 }}>{'•'.repeat(Math.min(creds.password.length, 10))}</span>
                  <button className="ghost" onClick={() => copy(creds.password)} style={styles.copyBtn}>copy</button>
                </div>
              )}
            </div>
          )}
          <div style={styles.controls}>
            <button className="ghost" onClick={() => webviewRef.current?.goBack()}>←</button>
            <button className="ghost" onClick={() => webviewRef.current?.goForward()}>→</button>
            <button className="ghost" onClick={() => webviewRef.current?.reload()}>↻</button>
            <span className="mono dim" style={{ fontSize: 11, marginLeft: 'auto' }}>
              @{active.username}
            </span>
          </div>
          <webview
            key={active.partition_key}
            ref={webviewRef}
            src="https://www.redgifs.com/"
            partition={`persist:${active.partition_key}`}
            style={styles.webview}
            allowpopups="true"
          />
        </>
      )}
    </div>
  );
}

const styles = {
  wrap: { display: 'flex', flexDirection: 'column', height: '100%', margin: -20 },
  header: {
    display: 'flex', alignItems: 'center', padding: '10px 14px',
    background: 'var(--bg-1)', borderBottom: '1px solid var(--border)',
  },
  credsBar: {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '6px 14px', background: 'var(--accent-soft)', borderBottom: '1px solid var(--border)',
  },
  chip: {
    display: 'flex', alignItems: 'center', gap: 4,
    padding: '2px 6px', background: 'var(--bg-1)', borderRadius: 3, border: '1px solid var(--border)',
  },
  copyBtn: { padding: '0 4px', fontSize: 10 },
  controls: {
    display: 'flex', gap: 6, alignItems: 'center',
    padding: '8px 14px', background: 'var(--bg-1)', borderBottom: '1px solid var(--border)',
  },
  webview: { flex: 1, width: '100%', background: 'white' },
};
