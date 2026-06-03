import React, { useState } from 'react';
import { AuthProvider, useAuth } from './lib/auth.jsx';
import { PermissionsProvider } from './lib/permissions.jsx';
import { ActiveAccountProvider } from './lib/activeAccount.jsx';
import { InboxLiveProvider } from './lib/inboxLive.jsx';
import LoginPage from './pages/Login.jsx';
import Shell from './components/Shell.jsx';
import DashboardPage from './pages/Dashboard.jsx';
import UnifiedBrowser from './pages/UnifiedBrowser.jsx';
import ModelLauncher from './pages/ModelLauncher.jsx';
import ProfilesPage from './pages/Profiles.jsx';
import ModelDetailPage from './pages/ModelDetail.jsx';
import TeamPage from './pages/Team.jsx';
import SettingsPage from './pages/Settings.jsx';
import DocsPage from './pages/Docs.jsx';
import AnalyticsPage from './pages/Analytics.jsx';
import ActivityPage from './pages/Activity.jsx';
import AutopilotPage from './pages/Autopilot.jsx';
import SchedulerProPage from './pages/SchedulerPro.jsx';
import AutomationPage from './pages/Automation.jsx';
import IntelligencePage from './pages/Intelligence.jsx';
import AddAccountsPage from './pages/AddAccounts.jsx';
import RedGifsDashboardPage from './pages/RedGifsDashboard.jsx';
import RedditApiPage from './pages/RedditApi.jsx';
import UpdateBanner from './components/UpdateBanner.jsx';

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
  const [route, setRoute] = useState('dashboard');
  const [routeParams, setRouteParams] = useState({});
  // Force a re-parse of the hash whenever it changes so popouts can switch
  // routes / modelId in-place (e.g. ModelLauncher's model picker) without a
  // full page reload that would destroy every webview.
  const [, forceHash] = React.useState(0);
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

  const navigate = (r, params = {}) => {
    setRoute(r);
    setRouteParams(params);
  };

  const page = (() => {
    switch (route) {
      case 'dashboard': return <DashboardPage navigate={navigate} />;
      case 'browser': return <UnifiedBrowser navigate={navigate} modelId={routeParams.modelId} defaultPlatform={routeParams.platform} />;
      case 'reddit': return <UnifiedBrowser navigate={navigate} defaultPlatform="reddit" />;
      case 'redgifs': return <RedGifsDashboardPage navigate={navigate} />;
      case 'redgifs-browse': return <UnifiedBrowser navigate={navigate} defaultPlatform="redgifs" />;
      case 'reddit-api':
      case 'inbox':
        return <RedditApiPage navigate={navigate} />;
      case 'profiles': return <ProfilesPage navigate={navigate} />;
      case 'model': return <ModelDetailPage modelId={routeParams.modelId} navigate={navigate} />;
      case 'users': return <TeamPage />;
      case 'infra':
      case 'proxies':
        return <SettingsPage navigate={navigate} />;
      case 'votes':
        return <SchedulerProPage initialProTab="configure" navigate={navigate} />;
      case 'settings': return <SettingsPage navigate={navigate} />;
      case 'docs': return <DocsPage />;
      case 'analytics': return <AnalyticsPage />;
      case 'activity': return <ActivityPage />;
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
      // Per-model launcher (one tabbed window per model) — popout key is
      // model-launcher-<id>, hash carries modelId explicitly.
      if (popoutInfo?.params?.route === 'model-launcher') {
        return <ModelLauncher modelId={popoutInfo.params.modelId} />;
      }
      switch (popoutRoute) {
        case 'inbox': return <InboxPage embedded standalone />;
        case 'scheduler-pro': return <SchedulerProPage />;
        case 'autopilot': return <AutopilotPage />;
        case 'analytics': return <AnalyticsPage />;
        case 'intel': return <IntelligencePage />;
        case 'dashboard': return <DashboardPage navigate={navigate} />;
        case 'redgifs-dashboard': return <RedGifsDashboardPage navigate={navigate} />;
        case 'activity': return <ActivityPage />;
        default: return <InboxPage embedded standalone />;
      }
    })();
    return (
      <PermissionsProvider>
        <ActiveAccountProvider>
          <PopoutShell>{popPage}</PopoutShell>
        </ActiveAccountProvider>
      </PermissionsProvider>
    );
  }

  return (
    <PermissionsProvider>
      <ActiveAccountProvider>
        <InboxLiveProvider>
          <Shell route={route} navigate={navigate}>{page}</Shell>
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
