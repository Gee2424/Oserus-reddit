import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import SchedulerProPage, { AISettings } from './SchedulerPro.jsx';
import AutopilotPage from './Autopilot.jsx';
import ErrorBoundary from '../components/ErrorBoundary.jsx';
import { Banner } from '../components/ui.jsx';
import PopOutButton from '../components/PopOutButton.jsx';
import RunHistory from '../components/RunHistory.jsx';
import PageHeader from '../components/PageHeader.jsx';
import TabBar from '../components/TabBar.jsx';

// Automation = Scheduler + Autopilot + AI Settings under one sidebar entry.
// AI Settings was moved out of the Scheduler's hidden <details> into its
// own tab so power users can reach it without scrolling past the kanban.

function StatsBar() {
  const { token } = useAuth();
  const [stats, setStats] = useState({ scheduledToday: 0, totalPending: 0, totalFailed: 0, failedWithErr: 0 });
  const [apStatus, setApStatus] = useState(null);
  const [runStats, setRunStats] = useState({ todayCompleted: 0, todayFailed: 0, cmRuns: 0 });
  const [circuits, setCircuits] = useState([]);

  const load = useCallback(async () => {
    try {
      const [allRes, statusRes, runRes, circuitRes] = await Promise.all([
        window.api.scheduled.list({ token }),
        window.api.autopilot.status({ token }).catch(() => ({ ok: false })),
        window.api.automation.runStats({ token }).catch(() => ({ ok: false })),
        window.api.autopilot.circuitStatus({ token }).catch(() => ({ ok: false })),
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
      if (runRes.ok && runRes.stats) setRunStats(runRes.stats);
      if (circuitRes.ok && circuitRes.paused) setCircuits(circuitRes.paused);
    } catch {}
  }, [token]);

  useEffect(() => { load(); const id = setInterval(load, 15000); return () => clearInterval(id); }, [load]);

  const masterOn = apStatus?.enabled;
  const apLast = apStatus?.lastRun ? new Date(apStatus.lastRun).toLocaleTimeString() : null;

  const items = [
    { label: 'Scheduled today', value: stats.scheduledToday, tone: 'gold' },
    { label: 'Total pending', value: stats.totalPending, tone: 'blue' },
    { label: 'Failed', value: stats.totalFailed, tone: 'red', sub: stats.failedWithErr > 0 ? `${stats.failedWithErr} with errors` : null },
    { label: 'Auto runs today', value: runStats.todayCompleted + runStats.todayFailed, tone: 'green',
      sub: `${runStats.todayCompleted} ok · ${runStats.todayFailed} fail · ${runStats.cmRuns} CM` },
    { label: 'Autopilot', value: masterOn ? 'Running' : 'Paused', tone: masterOn ? 'green' : 'neutral', sub: apLast ? `Last run ${apLast}` : null },
  ];

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
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
                     it.tone === 'red' ? 'var(--danger-fg)' :
                     it.tone === 'green' ? 'var(--green-bright)' :
                     'var(--text-0)',
            }}>
              {it.value}
            </div>
            {it.sub && <div className="muted" style={{ fontSize: 10, marginTop: 2 }}>{it.sub}</div>}
          </div>
        ))}
      </div>
      {circuits.length > 0 && (
        <div style={{ marginBottom: 18, padding: '10px 14px', background: 'rgba(180,90,90,0.1)', border: '1px solid rgba(180,90,90,0.25)', borderRadius: 'var(--radius-lg)', fontSize: 12 }}>
          <span style={{ color: 'var(--danger-fg)', fontWeight: 700 }}>Circuit breaker active: </span>
          {circuits.map((c, i) => (
            <span key={c.accountId}>
              Account {c.accountId} paused ({c.failures} consecutive failures{', '}
              until {new Date(c.pausedUntil).toLocaleTimeString()}){i < circuits.length - 1 ? ' · ' : ''}
            </span>
          ))}
        </div>
      )}
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

  return (
    <div>
      <PageHeader eyebrow="Workspace" title="Automation" subtitle="One workspace for everything that runs while the app is open — scheduled posts, autopilot rules, AI settings, and run history.">
        <PopOutButton route={section === 'autopilot' ? 'autopilot' : 'scheduler-pro'} title="Automation" />
      </PageHeader>

      <StatsBar />

      <TabBar
        items={[
          { key: 'scheduler', label: 'Scheduler', hint: 'Schedule posts for a specific account. Due posts fire automatically while the app is open.' },
          { key: 'autopilot', label: 'Autopilot', hint: 'One protocol per platform — posts-to-comments pacing + content mix, runs in the background.' },
          { key: 'ai', label: 'AI Settings', hint: 'Pick the Grok model, tune the persona, and decide which platforms use AI-generated content.' },
          { key: 'history', label: 'Run History', hint: 'Automation execution log across all platforms' },
        ]}
        activeKey={section}
        onChange={setSection}
        style={{ marginBottom: 18 }}
      />

      {section === 'scheduler' && <ErrorBoundary label="Scheduler"><SchedulerProPage navigate={navigate} /></ErrorBoundary>}
      {section === 'autopilot' && <ErrorBoundary label="Autopilot"><AutopilotPage /></ErrorBoundary>}
      {section === 'ai' && (
        <ErrorBoundary label="AI Settings">
          {aiErr && <Banner kind="err">{aiErr}</Banner>}
          {aiMsg && <Banner kind="ok">{aiMsg}</Banner>}
          <AISettings token={token} onMsg={setAiMsg} onError={setAiErr} />
        </ErrorBoundary>
      )}
      {section === 'history' && (
        <ErrorBoundary label="Run History">
          <RunHistory />
        </ErrorBoundary>
      )}
    </div>
  );
}
