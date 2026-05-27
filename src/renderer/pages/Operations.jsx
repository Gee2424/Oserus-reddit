import React, { useState } from 'react';
import { useCan } from '../lib/permissions.jsx';
import UpvotesPanel from '../components/UpvotesPanel.jsx';
import ProxiesPanel from '../components/ProxiesPanel.jsx';

export default function OperationsPage() {
  const can = useCan();
  const showProxies = can('infra.proxies.view') || can('infra.proxies.manage');
  const showUpvotes = can('infra.upvotes.view');
  const [tab, setTab] = useState(showUpvotes ? 'upvotes' : 'proxies');

  if (!showProxies && !showUpvotes) {
    return <div className="empty-state">You don't have permission to view this page.</div>;
  }

  const activeTab = !showUpvotes ? 'proxies' : (!showProxies ? 'upvotes' : tab);

  return (
    <div>
      <div className="title-block">
        <div>
          <div className="eyebrow">Infrastructure</div>
          <h1>Operations</h1>
          <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
            Place upvote orders and manage your proxies — everything in one place.
          </div>
        </div>
      </div>

      {showProxies && showUpvotes && (
        <div style={tabBar}>
          <button
            style={{ ...tabBtn, ...(activeTab === 'upvotes' ? tabBtnActive : {}) }}
            onClick={() => setTab('upvotes')}
          >
            ▲ Upvotes
          </button>
          <button
            style={{ ...tabBtn, ...(activeTab === 'proxies' ? tabBtnActive : {}) }}
            onClick={() => setTab('proxies')}
          >
            ⌁ Proxies
          </button>
        </div>
      )}

      {activeTab === 'upvotes' && <UpvotesPanel />}
      {activeTab === 'proxies' && <ProxiesPanel />}
    </div>
  );
}

const tabBar = { display: 'flex', gap: 6, marginBottom: 18, borderBottom: '1px solid var(--border)' };
const tabBtn = {
  background: 'transparent',
  border: 'none',
  color: 'var(--text-2)',
  padding: '10px 16px',
  fontSize: 13,
  cursor: 'pointer',
  borderBottom: '2px solid transparent',
  marginBottom: -1,
};
const tabBtnActive = {
  color: 'var(--gold-bright)',
  borderBottomColor: 'var(--gold)',
};
