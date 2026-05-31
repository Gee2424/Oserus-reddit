import React, { useState } from 'react';
import { AuthProvider, useAuth } from './lib/auth.jsx';
import { PermissionsProvider } from './lib/permissions.jsx';
import { ActiveAccountProvider } from './lib/activeAccount.jsx';
import LoginPage from './pages/Login.jsx';
import Shell from './components/Shell.jsx';
import DashboardPage from './pages/Dashboard.jsx';
import RedditBrowser from './pages/RedditBrowser.jsx';
import RedGifsBrowser from './pages/RedGifsBrowser.jsx';
import ProfilesPage from './pages/Profiles.jsx';
import ModelDetailPage from './pages/ModelDetail.jsx';
import TeamPage from './pages/Team.jsx';
import SubredditsPage from './pages/Subreddits.jsx';
import WebviewsPage from './pages/Webviews.jsx';
import SettingsPage from './pages/Settings.jsx';
import DocsPage from './pages/Docs.jsx';
import AnalyticsPage from './pages/Analytics.jsx';
import ActivityPage from './pages/Activity.jsx';
import AutopilotPage from './pages/Autopilot.jsx';
import SchedulerProPage from './pages/SchedulerPro.jsx';
import IntelligencePage from './pages/Intelligence.jsx';
import AddAccountsPage from './pages/AddAccounts.jsx';
import RedGifsDashboardPage from './pages/RedGifsDashboard.jsx';
import ModelHubPage from './pages/ModelHub.jsx';
import RedditApiPage from './pages/RedditApi.jsx';
import UpdateBanner from './components/UpdateBanner.jsx';

// A pop-out window loads the renderer with #popout=<route>. Detect it and
// render a minimal standalone shell (no sidebar) for that one module.
function getPopoutRoute() {
  const m = (window.location.hash || '').match(/popout=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

function Inner() {
  const { user, loading } = useAuth();
  const [route, setRoute] = useState('dashboard');
  const [routeParams, setRouteParams] = useState({});
  const popoutRoute = getPopoutRoute();

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
      case 'reddit': return <RedditBrowser navigate={navigate} />;
      case 'redgifs': return <RedGifsDashboardPage navigate={navigate} />;
      case 'redgifs-browse': return <RedGifsBrowser />;
      case 'reddit-api': return <RedditApiPage initialTab={routeParams.tab} navigate={navigate} />;
      case 'accounts': return <RedditApiPage initialTab="reddit" navigate={navigate} />;
      case 'scheduler': return <RedditApiPage initialTab="posting" navigate={navigate} />;
      case 'inbox': return <RedditApiPage initialTab="inbox" navigate={navigate} />;
      case 'profiles': return <ProfilesPage navigate={navigate} />;
      case 'model': return <ModelDetailPage modelId={routeParams.modelId} navigate={navigate} />;
      case 'users': return <TeamPage />;
      case 'infra':
      case 'proxies':
        return <AddAccountsPage navigate={navigate} initialTab="proxies" />;
      case 'votes':
        return <SchedulerProPage initialProTab="configure" />;
      case 'subreddits': return <SubredditsPage />;
      case 'webviews': return <WebviewsPage />;
      case 'settings': return <SettingsPage navigate={navigate} />;
      case 'docs': return <DocsPage />;
      case 'analytics': return <AnalyticsPage />;
      case 'activity': return <ActivityPage />;
      case 'autopilot': return <AutopilotPage />;
      case 'scheduler-pro': return <SchedulerProPage initialProTab={routeParams.tab} />;
      case 'intel': return <IntelligencePage />;
      case 'model-hub': return <ModelHubPage modelId={routeParams.modelId} navigate={navigate} />;
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
        case 'activity': return <ActivityPage />;
        case 'subreddits': return <SubredditsPage />;
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
        <Shell route={route} navigate={navigate}>{page}</Shell>
        <UpdateBanner />
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
