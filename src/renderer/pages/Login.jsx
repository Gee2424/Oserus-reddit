import React, { useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import logoUrl from '../assets/logo.png';

export default function LoginPage() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const res = await login(username, password);
    setBusy(false);
    if (!res.ok) setError(res.error || 'Login failed');
  }

  return (
    <div style={styles.wrap}>
      {/* Ambient gradient glow */}
      <div style={styles.glowA} />
      <div style={styles.glowB} />

      <div style={styles.frame}>
        <div style={styles.logoWrap}>
          <img src={logoUrl} alt="Oserus Management" style={styles.logo} />
        </div>

        <form onSubmit={submit} style={styles.form}>
          <div style={styles.eyebrow}>Team access</div>
          <h1 style={styles.title}>Welcome back.</h1>
          <div style={styles.sub}>Sign in to continue.</div>

          {error && <div className="error-banner">{error}</div>}

          <div style={{ marginBottom: 14 }}>
            <label>Username</label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              autoComplete="username"
            />
          </div>
          <div style={{ marginBottom: 22 }}>
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          <button type="submit" className="primary" disabled={busy} style={{ width: '100%' }}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
          <div style={styles.hint} className="mono">
            Default admin → <span style={{ color: 'var(--gold)' }}>admin / changeme</span>
          </div>
        </form>

        <div style={styles.footer} className="mono">
          OSERUS · MANAGEMENT
        </div>
      </div>
    </div>
  );
}

const styles = {
  wrap: {
    position: 'relative',
    height: '100%',
    display: 'grid',
    placeItems: 'center',
    background: 'var(--bg-0)',
    overflow: 'hidden',
  },
  glowA: {
    position: 'absolute',
    inset: 0,
    background: 'radial-gradient(ellipse 50% 40% at 20% 25%, rgba(61, 107, 79, 0.18), transparent 60%)',
    pointerEvents: 'none',
  },
  glowB: {
    position: 'absolute',
    inset: 0,
    background: 'radial-gradient(ellipse 40% 30% at 80% 75%, rgba(212, 166, 74, 0.08), transparent 60%)',
    pointerEvents: 'none',
  },
  frame: {
    position: 'relative',
    width: 430,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },
  logoWrap: {
    width: 280,
    marginBottom: 22,
    display: 'flex',
    justifyContent: 'center',
  },
  logo: {
    width: '100%',
    height: 'auto',
    filter: 'drop-shadow(0 4px 16px rgba(61, 107, 79, 0.3))',
  },
  form: {
    width: '100%',
    padding: '34px 32px',
    background: 'var(--bg-elev)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-lg)',
    boxShadow: 'var(--shadow-2)',
  },
  eyebrow: {
    fontFamily: 'var(--font-mono)',
    fontSize: 10,
    letterSpacing: '0.18em',
    textTransform: 'uppercase',
    color: 'var(--green-bright)',
    marginBottom: 10,
  },
  title: {
    fontSize: 30,
    fontVariationSettings: '"opsz" 144',
    marginBottom: 4,
    background: 'linear-gradient(90deg, var(--green-bright), var(--gold))',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    backgroundClip: 'text',
  },
  sub: {
    color: 'var(--text-2)',
    fontStyle: 'italic',
    marginBottom: 26,
  },
  hint: {
    marginTop: 18,
    fontSize: 11,
    color: 'var(--text-3)',
    textAlign: 'center',
  },
  footer: {
    marginTop: 18,
    fontSize: 10,
    letterSpacing: '0.3em',
    color: 'var(--text-3)',
  },
};
