import React, { useState } from 'react';
import SchedulerProPage from './SchedulerPro.jsx';
import AutopilotPage from './Autopilot.jsx';
import ErrorBoundary from '../components/ErrorBoundary.jsx';

// Automation = Scheduler + Autopilot under one sidebar entry, split into
// inner sections so the user has a single workspace instead of two tabs.
// Sections:
//   Scheduler — the existing SchedulerPro page (Configure / Run / Monitor /
//     Replenish + AI Settings + Composer)
//   Autopilot — the existing Autopilot page (rules, Example library,
//     Engagement, recent posts)
export default function AutomationPage({ navigate, initialSection }) {
  const [section, setSection] = useState(initialSection || 'scheduler');

  return (
    <div>
      <div className="title-block">
        <div>
          <div className="eyebrow">Workspace</div>
          <h1>Automation</h1>
          <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
            One workspace for everything that runs while the app is open —
            scheduled posts, autopilot rules, example libraries, and engagement.
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 18, borderBottom: '1px solid var(--border)' }}>
        {[
          { k: 'scheduler', l: 'Scheduler', d: 'Compose posts, AI settings, timeline, Run/Monitor/Replenish' },
          { k: 'autopilot', l: 'Autopilot', d: 'Per-account rules, example library, engagement, recent activity' },
        ].map((t) => (
          <button
            key={t.k}
            onClick={() => setSection(t.k)}
            title={t.d}
            style={{
              background: 'transparent', border: 'none',
              borderBottom: '2px solid ' + (section === t.k ? 'var(--gold)' : 'transparent'),
              color: section === t.k ? 'var(--gold-bright)' : 'var(--text-2)',
              padding: '10px 18px', fontSize: 14, fontWeight: 600, cursor: 'pointer', marginBottom: -1,
            }}
          >{t.l}</button>
        ))}
      </div>

      {section === 'scheduler' && <ErrorBoundary label="Scheduler"><SchedulerProPage navigate={navigate} /></ErrorBoundary>}
      {section === 'autopilot' && <ErrorBoundary label="Autopilot"><AutopilotPage /></ErrorBoundary>}
    </div>
  );
}
