import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './lib/auth.jsx';
import { PermissionsProvider } from './lib/permissions.jsx';
import { ActiveAccountProvider } from './lib/activeAccount.jsx';
import { InboxLiveProvider } from './lib/inboxLive.jsx';
import LoginPage from './pages/Login.jsx';
import Shell from './components/Shell.jsx';
import DashboardPage from './pages/Dashboard.jsx';
import ProfilesPage from './pages/Profiles.jsx';
import ModelDetailPage from './pages/ModelDetail.jsx';
// Team page merged into the Management Hub (Dashboard).
import TeamPage from './pages/Team.jsx';
import SettingsPage from './pages/Settings.jsx';
import DocsPage from './pages/Docs.jsx';
import AnalyticsPage from './pages/Analytics.jsx';
// Activity page merged into the Management Hub (Dashboard).
import AutopilotPage from './pages/Autopilot.jsx';
import SchedulerProPage from './pages/SchedulerPro.jsx';
import AutomationPage from './pages/Automation.jsx';
import IntelligencePage from './pages/Intelligence.jsx';
import AddAccountsPage from './pages/AddAccounts.jsx';
import RedGifsDashboardPage from './pages/RedGifsDashboard.jsx';
import RedditApiPage from './pages/RedditApi.jsx';
import InboxPage from './pages/Inbox.jsx';
import UpdateBanner from './components/UpdateBanner.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { installCloudReloadBridge } from './lib/cloudReload.jsx';

installCloudReloadBridge();

// A pop-out window loads the renderer with #popout=<route>&k=v&k=v.
// Detect it, parse extra hash params, and render a minimal standalone shell
// (no sidebar) for that one module.
function getPopoutInfo() {
  const hash = (window.location.hash || '').replace(/^#/, '');
  if (!hash) return null;
  const out = {};
  for (const pair of hash.split('&')) {
    const [k, v] = pair.split('=');
    if (k) out[decodeURIComponent(k)] = v ? decodeURIComponent(v) : '';
  }
  if (!out.popout) return null;
  return { route: out.popout, params: out };
}

function Inner() {
  const { user, loading } = useAuth();
  const [route, setRoute] = useState('loading');
  const [routeParams, setRouteParams] = useState({});
  const [, forceHash] = React.useState(0);

  // After login, check if user has teams — if zero, go to team creation
  useEffect(() => {
    if (!user) return;
    window.api.team.listTeams({}).then(res => {
      if (res.ok && res.teams && res.teams.length > 0) {
        setRoute('dashboard');
      } else {
        setRoute('team');
      }
    }).catch(() => setRoute('dashboard'));
  }, [user]);

  React.useEffect(() => {
    const onHash = () => forceHash((n) => n + 1);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const popoutInfo = getPopoutInfo();
  const popoutRoute = popoutInfo?.route;
  const popoutParams = popoutInfo?.params || {};

  if (loading) {
    return <div style={{ height: '100%', display: 'grid', placeItems: 'center' }}>
      <div className="mono dim">loading…</div>
    </div>;
  }
  if (!user) return <LoginPage />;
  if (route === 'loading') {
    return <div style={{ height: '100%', display: 'grid', placeItems: 'center' }}>
      <div className="mono dim">loading…</div>
    </div>;
  }

  const navigate = (r, params = {}) => {
    setRoute(r);
    setRouteParams(params);
  };

  const page = (() => {
    switch (route) {
      case 'dashboard': return <DashboardPage navigate={navigate} />;
      // Browsing is no longer an in-app page. Account-bound browsing
      // lives in the standalone Oserus Browser window, opened from
      // any account's Launch button (see oserusBrowser.openAccount).
      case 'redgifs': return <RedGifsDashboardPage navigate={navigate} />;
      case 'reddit-api':
      case 'inbox':
        return <RedditApiPage navigate={navigate} />;
      case 'profiles': return <ProfilesPage navigate={navigate} />;
      case 'model': return <ModelDetailPage modelId={routeParams.modelId} navigate={navigate} />;
      // 'users' + 'activity' both land on the Management Hub now —
      // each former page is a section inside Dashboard.
      case 'users':    return <DashboardPage navigate={navigate} />;
      case 'infra':
      case 'proxies':
        return <SettingsPage navigate={navigate} />;
      case 'votes':
        return <SchedulerProPage initialProTab="configure" navigate={navigate} />;
      case 'team': return <TeamPage navigate={navigate} />;
      case 'settings': return <SettingsPage navigate={navigate} />;
      case 'docs': return <DocsPage />;
      case 'analytics': return <AnalyticsPage />;
      case 'activity': return <DashboardPage navigate={navigate} />;
      case 'automation': return <AutomationPage navigate={navigate} initialSection={routeParams.section} />;
      // Legacy routes — kept so deep links from older versions still resolve.
      case 'autopilot': return <AutomationPage navigate={navigate} initialSection="autopilot" />;
      case 'scheduler-pro': return <AutomationPage navigate={navigate} initialSection="scheduler" />;
      case 'intel': return <IntelligencePage initialTab={routeParams.tab} />;
      case 'add-accounts': return <AddAccountsPage navigate={navigate} initialTab={routeParams.tab} />;
      default: return <DashboardPage navigate={navigate} />;
    }
  })();

  // Standalone pop-out: just the module + a slim pinnable titlebar.
  if (popoutRoute) {
    const popPage = (() => {
      switch (popoutRoute) {
        case 'inbox': return <InboxPage embedded standalone />;
        case 'scheduler-pro': return <SchedulerProPage />;
        case 'autopilot': return <AutopilotPage />;
        case 'analytics': return <AnalyticsPage />;
        case 'intel': return <IntelligencePage />;
        case 'dashboard': return <DashboardPage navigate={navigate} />;
        case 'redgifs-dashboard': return <RedGifsDashboardPage navigate={navigate} />;
        case 'activity': return <DashboardPage navigate={navigate} />;
        default: return <InboxPage embedded standalone />;
      }
    })();
    return (
      <PermissionsProvider>
        <ActiveAccountProvider>
          <PopoutShell><ErrorBoundary label={popoutRoute}>{popPage}</ErrorBoundary></PopoutShell>
        </ActiveAccountProvider>
      </PermissionsProvider>
    );
  }

  return (
    <PermissionsProvider>
      <ActiveAccountProvider>
        <InboxLiveProvider>
          <Shell route={route} navigate={navigate}>
            <ErrorBoundary label={route}>{page}</ErrorBoundary>
          </Shell>
          <UpdateBanner />
        </InboxLiveProvider>
      </ActiveAccountProvider>
    </PermissionsProvider>
  );
}

function PopoutShell({ children }) {
  const [pinned, setPinned] = useState(false);
  async function togglePin() {
    const next = !pinned;
    setPinned(next);
    await window.api.windows.setAlwaysOnTop({ value: next });
  }
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-0)' }}>
      <div style={{
        height: 38, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
        gap: 6, padding: '0 10px', borderBottom: '1px solid var(--border)',
        background: 'var(--bg-1)', WebkitAppRegion: 'drag', paddingTop: 4,
      }}>
        <button
          onClick={togglePin}
          title={pinned ? 'Unpin (allow behind other windows)' : 'Pin on top'}
          style={{
            WebkitAppRegion: 'no-drag', background: pinned ? 'var(--gold)' : 'transparent',
            color: pinned ? 'var(--bg-0)' : 'var(--text-2)', border: '1px solid var(--border)',
            borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer',
          }}
        >
          {pinned ? '📌 Pinned' : '📌 Pin on top'}
        </button>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 14 }}>{children}</div>
    </div>
  );
}

export default function App() {
  return <AuthProvider><Inner /></AuthProvider>;
}
