import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { err: null, info: null };
  }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err, info) {
    this.setState({ info });
    try { console.error('[ErrorBoundary]', this.props.label || '', err, info?.componentStack); } catch {}
  }
  reset = () => this.setState({ err: null, info: null });
  render() {
    if (!this.state.err) return this.props.children;
    const stack = this.state.info?.componentStack || '';
    return (
      <div style={{ padding: 24 }}>
        <div style={{ background: 'rgba(180,90,90,0.1)', border: '1px solid rgba(180,90,90,0.4)', borderRadius: 8, padding: 16, color: '#e2a3a3' }}>
          <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>
            {this.props.label || 'Page'} crashed
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, marginBottom: 8 }}>
            {String(this.state.err?.message || this.state.err)}
          </div>
          {stack && (
            <details>
              <summary style={{ cursor: 'pointer', fontSize: 11, color: 'var(--text-2)' }}>component stack</summary>
              <pre style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)', whiteSpace: 'pre-wrap', marginTop: 6 }}>{stack}</pre>
            </details>
          )}
          <button onClick={this.reset} style={{ marginTop: 10 }}>Retry</button>
        </div>
      </div>
    );
  }
}
