import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './lib/auth.jsx';
import { PermissionsProvider } from './lib/permissions.jsx';
import { ActiveAccountProvider } from './lib/activeAccount.jsx';
import { InboxLiveProvider } from './lib/inboxLive.jsx';
import { ToastProvider } from './lib/toast.jsx';
import { ConfirmProvider } from './lib/confirm.jsx';
import { loadPlatforms } from './lib/platforms.js';
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
import PlatformsPage from './pages/Platforms.jsx';
import RedGifsDashboardPage from './pages/RedGifsDashboard.jsx';
import RedditApiPage from './pages/RedditApi.jsx';
import InboxPage from './pages/Inbox.jsx';
import ScriptsPage from './pages/Scripts.jsx';
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
  // Navigation history stack. Top of stack is the current view. `navigate`
  // pushes; `goBack` pops. `resetRoute` replaces the whole stack (used by the
  // post-login routing effect so Back can't land on a stale/loading view).
  const [history, setHistory] = useState([{ route: 'loading', params: {} }]);
  const top = history[history.length - 1];
  const route = top.route;
  const routeParams = top.params || {};
  const [loadError, setLoadError] = useState(null);
  const [, forceHash] = React.useState(0);

  const resetRoute = React.useCallback((r, params = {}) => {
    setHistory([{ route: r, params }]);
  }, []);
  const navigate = React.useCallback((r, params = {}) => {
    setHistory((h) => {
      const cur = h[h.length - 1];
      if (cur && cur.route === r && JSON.stringify(cur.params || {}) === JSON.stringify(params || {})) return h;
      return [...h, { route: r, params }];
    });
  }, []);
  const goBack = React.useCallback(() => {
    setHistory((h) => (h.length > 1 ? h.slice(0, -1) : h));
  }, []);
  const canGoBack = history.length > 1;

  // After login, load platforms and check if user has teams
  useEffect(() => {
    if (!user) { resetRoute('login'); return; }
    // Load platforms first (needed by all pages), then check teams
    loadPlatforms().then(() => window.api.team.listTeams({})).then(res => {
      if (res.ok && res.teams && res.teams.length > 0) {
        resetRoute('dashboard');
      } else if (!res.ok) {
        setLoadError(res.error || 'Could not connect to server — check your internet connection');
        resetRoute('dashboard');
      } else {
        resetRoute('team');
      }
    }).catch((err) => {
      setLoadError(err?.message || 'Could not connect to server');
      resetRoute('dashboard');
    });
  }, [user, resetRoute]);

  React.useEffect(() => {
    const onHash = () => forceHash((n) => n + 1);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const popoutInfo = getPopoutInfo();
  const popoutRoute = popoutInfo?.route;
  const popoutParams = popoutInfo?.params || {};

  if (loading || route === 'loading') {
    return (
      <div style={{ height: '100%', display: 'grid', placeItems: 'center', background: 'var(--bg-0)' }}>
        <div style={{ textAlign: 'center' }}>
          {loadError && (
            <div className="error-banner" style={{ maxWidth: 400, margin: '0 auto 16px' }}>
              {loadError}
            </div>
          )}
          <div style={{
            width: 48, height: 48, borderRadius: '50%',
            border: '2px solid var(--border-strong)',
            borderTopColor: 'var(--gold)',
            animation: 'spinner-rotate 0.7s linear infinite',
            margin: '0 auto 16px',
          }} />
          <div className="mono dim" style={{ fontSize: 12, letterSpacing: '0.1em' }}>Loading Oserus…</div>
        </div>
      </div>
    );
  }
  if (!user) return <LoginPage />;

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
      case 'scripts': return <ScriptsPage navigate={navigate} />;
      case 'docs': return <DocsPage />;
      case 'analytics': return <AnalyticsPage />;
      case 'activity': return <DashboardPage navigate={navigate} />;
      case 'automation': return <AutomationPage navigate={navigate} initialSection={routeParams.section} />;
      case 'scheduler': return <SchedulerProPage navigate={navigate} />;
      // Legacy routes — kept so deep links from older versions still resolve.
      case 'autopilot': return <AutomationPage navigate={navigate} initialSection="autopilot" />;
      case 'scheduler-pro': return <SchedulerProPage navigate={navigate} />;
      case 'intel': return <IntelligencePage initialTab={routeParams.tab} />;
      case 'add-accounts': return <AddAccountsPage navigate={navigate} initialTab={routeParams.tab} />;
      case 'platforms': return <PlatformsPage navigate={navigate} />;
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
          <ToastProvider>
            <ConfirmProvider>
              <PopoutShell><ErrorBoundary label={popoutRoute}><div className="page-wrap" key={popoutRoute}>{popPage}</div></ErrorBoundary></PopoutShell>
            </ConfirmProvider>
          </ToastProvider>
        </ActiveAccountProvider>
      </PermissionsProvider>
    );
  }

  return (
    <PermissionsProvider>
      <ActiveAccountProvider>
        <ToastProvider>
          <ConfirmProvider>
            <InboxLiveProvider>
              <Shell route={route} navigate={navigate} goBack={goBack} canGoBack={canGoBack}>
                <ErrorBoundary key={route} label={route}>
                  <div className="page-wrap">{page}</div>
                </ErrorBoundary>
              </Shell>
              <UpdateBanner />
            </InboxLiveProvider>
          </ConfirmProvider>
        </ToastProvider>
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
            borderRadius: 'var(--radius)', padding: '4px 10px', fontSize: 'var(--text-sm)', cursor: 'pointer',
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
