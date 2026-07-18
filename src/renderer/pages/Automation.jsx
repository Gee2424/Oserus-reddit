import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import SchedulerProPage, { AISettings } from './SchedulerPro.jsx';
import AutopilotPage from './Autopilot.jsx';
import ErrorBoundary from '../components/ErrorBoundary.jsx';
import { Banner } from '../components/ui.jsx';
import PopOutButton from '../components/PopOutButton.jsx';

// Automation = Scheduler + Autopilot + AI Settings under one sidebar entry.
// AI Settings was moved out of the Scheduler's hidden <details> into its
// own tab so power users can reach it without scrolling past the kanban.

function StatsBar() {
  const { token } = useAuth();
  const [stats, setStats] = useState({ scheduledToday: 0, totalPending: 0, totalFailed: 0, failedWithErr: 0 });
  const [apStatus, setApStatus] = useState(null);

  const load = useCallback(async () => {
    try {
      const [allRes, statusRes] = await Promise.all([
        window.api.scheduled.list({ token }),
        window.api.autopilot.status({ token }).catch(() => ({ ok: false })),
      ]);
      if (allRes.ok && allRes.posts) {
        const posts = allRes.posts;
        const today = new Date().toISOString().slice(0, 10);
        setStats({
          scheduledToday: posts.filter((p) =>
            p.status === 'pending' && (p.scheduled_for || '').startsWith(today)
          ).length,
          totalPending: posts.filter((p) => p.status === 'pending').length,
          totalFailed: posts.filter((p) => p.status === 'failed').length,
          failedWithErr: posts.filter((p) => p.status === 'failed' && p.error).length,
        });
      }
      if (statusRes.ok) setApStatus(statusRes);
    } catch {}
  }, [token]);

  useEffect(() => { load(); const id = setInterval(load, 15000); return () => clearInterval(id); }, [load]);

  const masterOn = apStatus?.enabled;
  const apLast = apStatus?.lastRun ? new Date(apStatus.lastRun).toLocaleTimeString() : null;

  const items = [
    { label: 'Scheduled today', value: stats.scheduledToday, tone: 'gold' },
    { label: 'Total pending', value: stats.totalPending, tone: 'blue' },
    { label: 'Failed', value: stats.totalFailed, tone: 'red', sub: stats.failedWithErr > 0 ? `${stats.failedWithErr} with errors` : null },
    { label: 'Autopilot', value: masterOn ? 'Running' : 'Paused', tone: masterOn ? 'green' : 'neutral', sub: apLast ? `Last run ${apLast}` : null },
  ];

  return (
    <div style={{ display: 'flex', gap: 10, marginBottom: 18 }}>
      {items.map((it) => (
        <div key={it.label} style={{
          flex: 1, minWidth: 100,
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          padding: '12px 14px',
          background: 'var(--bg-elev)',
        }}>
          <div className="muted" style={{
            fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.1em',
            fontWeight: 600, marginBottom: 4,
          }}>{it.label}</div>
          <div style={{
            fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 600,
            color: it.tone === 'gold' ? 'var(--gold-bright)' :
                   it.tone === 'red' ? '#e2a3a3' :
                   it.tone === 'green' ? 'var(--green-bright)' :
                   'var(--text-0)',
          }}>
            {it.value}
          </div>
          {it.sub && <div className="muted" style={{ fontSize: 10, marginTop: 2 }}>{it.sub}</div>}
        </div>
      ))}
    </div>
  );
}

export default function AutomationPage({ navigate, initialSection }) {
  const { token } = useAuth();
  const [section, setSection] = useState(initialSection || 'scheduler');
  const [aiMsg, setAiMsg] = useState(null);
  const [aiErr, setAiErr] = useState(null);

  useEffect(() => {
    if (!aiMsg && !aiErr) return;
    const t = setTimeout(() => { setAiMsg(null); setAiErr(null); }, 4000);
    return () => clearTimeout(t);
  }, [aiMsg, aiErr]);

  const tabs = [
    { k: 'scheduler', l: 'Scheduler', d: 'Compose posts, schedule, monitor queue' },
    { k: 'autopilot', l: 'Autopilot', d: 'Engagement rules, run controls, activity' },
    { k: 'ai',        l: 'AI Settings', d: 'Persona, tone, length, provider, system prompt' },
  ];

  return (
    <div>
      <div className="title-block">
        <div>
          <div className="eyebrow">Workspace</div>
          <h1>Automation</h1>
          <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
            One workspace for everything that runs while the app is open —
            scheduled posts, autopilot rules, and AI generation settings.
          </div>
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <PopOutButton route={section === 'autopilot' ? 'autopilot' : section === 'ai' ? 'scheduler-pro' : 'scheduler-pro'} title="Automation" />
        </div>
      </div>

      <StatsBar />

      <div style={{ display: 'flex', gap: 6, marginBottom: 18, borderBottom: '1px solid var(--border)' }}>
        {tabs.map((t) => (
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
      {section === 'ai' && (
        <ErrorBoundary label="AI Settings">
          {aiErr && <Banner kind="err">{aiErr}</Banner>}
          {aiMsg && <Banner kind="ok">{aiMsg}</Banner>}
          <AISettings token={token} onMsg={setAiMsg} onError={setAiErr} />
        </ErrorBoundary>
      )}
    </div>
  );
}
