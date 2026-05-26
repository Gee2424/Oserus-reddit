import React, { useState } from 'react';
import { AuthProvider, useAuth } from './lib/auth.jsx';
import { ActiveAccountProvider } from './lib/activeAccount.jsx';
import LoginPage from './pages/Login.jsx';
import Shell from './components/Shell.jsx';
import DashboardPage from './pages/Dashboard.jsx';
import RedditBrowser from './pages/RedditBrowser.jsx';
import RedGifsBrowser from './pages/RedGifsBrowser.jsx';
import AccountsPage from './pages/Accounts.jsx';
import ProfilesPage from './pages/Profiles.jsx';
import ModelDetailPage from './pages/ModelDetail.jsx';
import UsersPage from './pages/Users.jsx';
import ProxiesPage from './pages/Proxies.jsx';
import SubredditsPage from './pages/Subreddits.jsx';
import WebviewsPage from './pages/Webviews.jsx';
import SettingsPage from './pages/Settings.jsx';
import VotesPage from './pages/Votes.jsx';
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
      case 'accounts': return <AccountsPage navigate={navigate} />;
      case 'profiles': return <ProfilesPage navigate={navigate} />;
      case 'model': return <ModelDetailPage modelId={routeParams.modelId} navigate={navigate} />;
      case 'users': return <UsersPage />;
      case 'proxies': return <ProxiesPage />;
      case 'subreddits': return <SubredditsPage />;
      case 'webviews': return <WebviewsPage />;
      case 'settings': return <SettingsPage />;
      case 'votes': return <VotesPage />;
      default: return <DashboardPage navigate={navigate} />;
    }
  })();

  return (
    <ActiveAccountProvider>
      <Shell route={route} navigate={navigate}>{page}</Shell>
      <UpdateBanner />
    </ActiveAccountProvider>
  );
}

export default function App() {
  return <AuthProvider><Inner /></AuthProvider>;
}
