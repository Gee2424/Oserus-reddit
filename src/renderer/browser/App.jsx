import React from 'react';
import Picker from './Picker.jsx';
import BrowserShell from './BrowserShell.jsx';

// Top-level switch: ?account=<id> → BrowserShell locked to that account's
// session. Otherwise → Picker. The main process closes and reopens this
// window on profile switch, so the route is fixed for the window's life.
export default function BrowserApp() {
  const accountId = window.oserusBrowser?.session?.currentAccountId?.() ?? null;
  return accountId ? <BrowserShell accountId={accountId} /> : <Picker />;
}
