import React, { useState } from 'react';
import InboxPage from './Inbox.jsx';
import { PLATFORMS as PLATFORM_PILLS } from '../lib/platforms.js';

// Account Manager Pro — Inbox-first workspace. Scheduling lives in the
// sidebar Scheduler entry now (one scheduler, not two), so the old Posting
// tab is gone. Platform pills filter the inbox view; the proxy quick-link
// stays because it's the most common cross-page jump.
export default function RedditApiPage({ navigate }) {
  const [platform, setPlatform] = useState('reddit');

  return (
    <div>
      <div className="title-block">
        <div>
          <div className="eyebrow">Workspace</div>
          <h1>Account Manager Pro</h1>
          <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
            DMs and modmail across every platform. Sessions stay per-account.
            Scheduling lives in the Scheduler.
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 18 }}>
        {PLATFORM_PILLS.map((p) => {
          const active = platform === p.v;
          return (
            <button
              key={p.v}
              onClick={() => setPlatform(p.v)}
              title={p.label}
              style={{
                background: active ? p.color : 'var(--bg-1)',
                color: active ? '#fff' : 'var(--text-1)',
                border: `1px solid ${active ? p.color : 'var(--border)'}`,
                borderRadius: 999, padding: '5px 14px', fontSize: 12, fontWeight: 600,
                cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 6,
              }}
            >
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: p.color }} />
              {p.label}
            </button>
          );
        })}
        <div style={{ flex: 1 }} />
        {navigate && (
          <>
            <button
              onClick={() => navigate('scheduler-pro')}
              className="ghost"
              style={{ fontSize: 12, padding: '5px 14px' }}
            >◷ Scheduler</button>
            <button
              onClick={() => navigate('add-accounts', { tab: 'proxies' })}
              className="ghost"
              style={{ fontSize: 12, padding: '5px 14px' }}
              title="Manage proxy pool"
            >⚙ Proxies</button>
          </>
        )}
      </div>

      <InboxPage embedded navigate={navigate} />
    </div>
  );
}
