import React from 'react';
import ReactDOM from 'react-dom/client';
import BrowserShell from './browser/BrowserShell.jsx';
import './styles/global.css';

// Visible error boundary so a chrome render failure becomes a red banner
// instead of a black window. The chrome is the only UI in this window
// — if it crashes silently, the operator sees an inert frame with no
// way to diagnose. Catch and show.
class ChromeErrorBoundary extends React.Component {
  constructor(p) { super(p); this.state = { err: null, stack: null }; }
  static getDerivedStateFromError(err) { return { err: err?.message || String(err) }; }
  componentDidCatch(err, info) {
    this.setState({ err: err?.message || String(err), stack: info?.componentStack });
    // eslint-disable-next-line no-console
    console.error('[oserus-chrome] crash', err, info);
  }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div style={{
        padding: 20, color: '#fff', background: '#5a1e1a', height: '100vh',
        fontFamily: 'monospace', fontSize: 12, overflow: 'auto',
      }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 10 }}>
          Oserus Browser chrome crashed
        </div>
        <div style={{ marginBottom: 12 }}>{this.state.err}</div>
        {this.state.stack && <pre style={{ whiteSpace: 'pre-wrap', opacity: 0.8 }}>{this.state.stack}</pre>}
        <button
          onClick={() => location.reload()}
          style={{
            marginTop: 14, padding: '6px 12px',
            background: '#fff', color: '#5a1e1a', border: 'none',
            borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit',
          }}
        >Retry</button>
      </div>
    );
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <ChromeErrorBoundary><BrowserShell /></ChromeErrorBoundary>
);
