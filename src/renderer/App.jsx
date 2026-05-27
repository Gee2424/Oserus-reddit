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
import OperationsPage from './pages/Operations.jsx';
import RedditApiPage from './pages/RedditApi.jsx';
import UpdateBanner from './components/UpdateBanner.jsx';

function Inner() {
  const { user, loading } = useAuth();
  const [route, setRoute] = useState('dashboard');
  const [routeParams, setRouteParams] = useState({});

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
      case 'reddit': return <RedditBrowser />;
      case 'redgifs': return <RedGifsBrowser />;
      case 'reddit-api': return <RedditApiPage initialTab={routeParams.tab} navigate={navigate} />;
      case 'accounts': return <RedditApiPage initialTab="reddit" navigate={navigate} />;
      case 'scheduler': return <RedditApiPage initialTab="posting" navigate={navigate} />;
      case 'inbox': return <RedditApiPage initialTab="inbox" navigate={navigate} />;
      case 'profiles': return <ProfilesPage navigate={navigate} />;
      case 'model': return <ModelDetailPage modelId={routeParams.modelId} navigate={navigate} />;
      case 'users': return <TeamPage />;
      case 'infra':
      case 'proxies':
      case 'votes':
        return <OperationsPage />;
      case 'subreddits': return <SubredditsPage />;
      case 'webviews': return <WebviewsPage />;
      case 'settings': return <SettingsPage />;
      case 'docs': return <DocsPage />;
      case 'analytics': return <AnalyticsPage />;
      case 'activity': return <ActivityPage />;
      case 'operations': return <OperationsPage navigate={navigate} />;
      default: return <DashboardPage navigate={navigate} />;
    }
  })();

  return (
    <PermissionsProvider>
      <ActiveAccountProvider>
        <Shell route={route} navigate={navigate}>{page}</Shell>
        <UpdateBanner />
      </ActiveAccountProvider>
    </PermissionsProvider>
  );
}

export default function App() {
  return <AuthProvider><Inner /></AuthProvider>;
}
