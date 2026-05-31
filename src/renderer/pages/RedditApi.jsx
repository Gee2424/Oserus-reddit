import React, { useState } from 'react';
import SchedulerProPage from './SchedulerPro.jsx';
import InboxPage from './Inbox.jsx';

const TABS = [
  { key: 'inbox',   label: 'Inbox',   icon: '✉', hint: 'DMs & modmail' },
  { key: 'posting', label: 'Posting', icon: '◷', hint: 'Scheduled posts' },
];

const PLATFORM_PILLS = [
  { v: 'reddit',    label: 'Reddit',    color: '#ff4500' },
  { v: 'redgifs',   label: 'RedGIFs',   color: '#ff2e74' },
  { v: 'x',         label: 'X',         color: '#1d9bf0' },
  { v: 'instagram', label: 'Instagram', color: '#e1306c' },
  { v: 'tiktok',    label: 'TikTok',    color: '#25f4ee' },
];

export default function RedditApiPage({ initialTab, navigate }) {
  const [tab, setTab] = useState(
    TABS.find((t) => t.key === initialTab) ? initialTab : 'inbox'
  );
  const [platform, setPlatform] = useState('reddit');

  return (
    <div>
      <div className="title-block">
        <div>
          <div className="eyebrow">Workspace</div>
          <h1>Account Manager Pro</h1>
          <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
            Posting, accounts, and inbox in one workspace — across every
            platform. Sessions and tokens stay per-account.
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
          <button
            onClick={() => navigate('add-accounts', { tab: 'proxies' })}
            className="ghost"
            style={{ fontSize: 12, padding: '5px 14px' }}
            title="Manage proxy pool"
          >⚙ Proxies</button>
        )}
      </div>

      <div style={tabBar}>
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{ ...tabBtn, ...(active ? tabBtnActive : {}) }}
            >
              <span style={{ marginRight: 8, fontFamily: 'var(--font-mono)' }}>{t.icon}</span>
              {t.label}
              <span className="dim" style={{ marginLeft: 8, fontSize: 11, fontWeight: 400 }}>
                {t.hint}
              </span>
            </button>
          );
        })}
      </div>

      {tab === 'inbox'   && <InboxPage embedded navigate={navigate} />}
      {tab === 'posting' && <SchedulerProPage navigate={navigate} />}
    </div>
  );
}

const tabBar = {
  display: 'flex',
  gap: 4,
  marginBottom: 22,
  borderBottom: '1px solid var(--border)',
};
const tabBtn = {
  background: 'transparent',
  border: 'none',
  color: 'var(--text-2)',
  padding: '12px 18px',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  borderBottom: '2px solid transparent',
  marginBottom: -1,
  display: 'flex',
  alignItems: 'center',
};
const tabBtnActive = {
  color: 'var(--gold-bright)',
  borderBottomColor: 'var(--gold)',
};
