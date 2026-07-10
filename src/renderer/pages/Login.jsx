import React, { useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import logoUrl from '../assets/logo.png';

export default function LoginPage() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    if (mode === 'signup' && password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setBusy(true);
    const fn = mode === 'signin' ? signIn : signUp;
    const res = await fn(email, password);
    setBusy(false);
    if (!res.ok) setError(res.error || 'Authentication failed');
  }

  function toggleMode() {
    setMode(mode === 'signin' ? 'signup' : 'signin');
    setError(null);
  }

  return (
    <div style={styles.wrap}>
      <div style={styles.glowA} />
      <div style={styles.glowB} />

      <div style={styles.frame}>
        <div style={styles.logoWrap}>
          <img src={logoUrl} alt="Oserus Management" style={styles.logo} />
        </div>

        <form onSubmit={submit} style={styles.form}>
          <div style={styles.eyebrow}>Team access</div>
          <h1 style={styles.title}>
            {mode === 'signin' ? 'Welcome back.' : 'Create account.'}
          </h1>
          <div style={styles.sub}>
            {mode === 'signin' ? 'Sign in to continue.' : 'Sign up to get started.'}
          </div>

          {error && <div className="error-banner">{error}</div>}

          <div style={{ marginBottom: 14 }}>
            <label>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
              autoComplete="email"
              required
            />
          </div>
          <div style={{ marginBottom: mode === 'signup' ? 14 : 22 }}>
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              required
              minLength={6}
            />
          </div>
          {mode === 'signup' && (
            <div style={{ marginBottom: 22 }}>
              <label>Confirm password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                required
                minLength={6}
              />
            </div>
          )}
          <button type="submit" className="primary" disabled={busy} style={{ width: '100%' }}>
            {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>

          <div style={styles.switchMode}>
            <button type="button" className="ghost" onClick={toggleMode} style={{ fontSize: 12 }}>
              {mode === 'signin'
                ? "Don't have an account? Sign up"
                : 'Already have an account? Sign in'}
            </button>
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
    width: 80,
    height: 80,
    marginBottom: 18,
    display: 'grid',
    placeItems: 'center',
    borderRadius: '50%',
    background: 'linear-gradient(135deg, rgba(61, 107, 79, 0.20), rgba(212, 166, 74, 0.10))',
    border: '1px solid rgba(212, 166, 74, 0.15)',
  },
  logo: { width: 48, height: 'auto', opacity: 0.85 },
  form: {
    width: '100%',
    background: 'var(--bg-1)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-lg)',
    padding: '28px 32px 24px',
  },
  eyebrow: {
    fontFamily: 'var(--font-mono)',
    fontSize: 9,
    letterSpacing: '0.2em',
    textTransform: 'uppercase',
    color: 'var(--text-3)',
    marginBottom: 2,
  },
  title: {
    fontFamily: 'var(--font-display)',
    fontSize: 24,
    fontWeight: 600,
    color: 'var(--text-1)',
    margin: '0 0 2px',
  },
  sub: {
    fontSize: 13,
    color: 'var(--text-2)',
    marginBottom: 22,
  },
  switchMode: {
    marginTop: 14,
    textAlign: 'center',
  },
  footer: {
    marginTop: 18,
    fontSize: 10,
    letterSpacing: '0.2em',
    color: 'var(--text-3)',
    opacity: 0.5,
  },
};
