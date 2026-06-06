import React from 'react';
import ReactDOM from 'react-dom/client';
import BrowserShell from './browser/BrowserShell.jsx';
import './styles/global.css';

// Single chrome UI for every Oserus Browser window — there's no
// account/profile picker anymore. Windows are spawned by Management
// (oserus-browser:openAccount / openAllForProfile), each bound to
// one account.
ReactDOM.createRoot(document.getElementById('root')).render(<BrowserShell />);
