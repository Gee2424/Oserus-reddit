import React, { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';

export default function DashboardPage({ navigate }) {
  const { token, user } = useAuth();
  const [stats, setStats] = useState({
    models: 0,
    accounts: 0,
    ready: 0,
    warming: 0,
    paused: 0,
    banned: 0,
    proxies: 0,
  });
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const [p, a, px] = await Promise.all([
      window.api.profiles.list({ token }),
      window.api.accounts.listForUser({ token }),
      window.api.proxies.list({ token }),
    ]);
    const accounts = a.ok ? a.accounts : [];
    setStats({
      models: p.ok ? p.profiles.length : 0,
      accounts: accounts.length,
      ready: accounts.filter(x => x.status === 'ready').length,
      warming: accounts.filter(x => x.status === 'warming').length,
      paused: accounts.filter(x => x.status === 'paused').length,
      banned: accounts.filter(x => x.status === 'banned').length,
      proxies: px.ok ? px.proxies.length : 0,
    });
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const quickActions = [
    {
      key: 'reddit',
      icon: 'R',
      title: 'Open Reddit',
      desc: 'Browse, compose, and post as one of your linked Reddit accounts',
    },
    {
      key: 'redgifs',
      icon: 'G',
      title: 'Open RedGifs',
      desc: 'Browse RedGifs while logged into a linked account',
    },
    {
      key: 'profiles',
      icon: '◇',
      title: 'Model Profiles',
      desc: 'View, edit, and manage all model profiles you have access to',
    },
    {
      key: 'accounts',
      icon: '◈',
      title: 'All Accounts',
      desc: 'Reddit + RedGifs accounts across all models, with status and proxy info',
    },
  ];

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <div>
      <div style={styles.header}>
        <div style={styles.eyebrow}>{now.toDateString().toUpperCase()}</div>
        <h1 style={styles.title}>
          {greeting}, <span style={styles.name}>{user.display_name || user.username}</span>.
        </h1>
        <div style={styles.subtitle}>Here's where things stand today.</div>
      </div>

      {/* Status overview - small stat cards */}
      <div style={styles.statsGrid}>
        <StatCard label="Models" value={stats.models} color="var(--green-bright)" />
        <StatCard label="Accounts" value={stats.accounts} color="var(--gold)" />
        <StatCard label="Ready" value={stats.ready} color="var(--green-bright)" suffix="ready to post" />
        <StatCard label="Warming up" value={stats.warming} color="var(--gold)" suffix="building karma" />
        <StatCard label="Paused" value={stats.paused} color="var(--text-2)" />
        <StatCard label="Proxies" value={stats.proxies} color="var(--green-bright)" />
      </div>

      {/* Quick action cards */}
      <div style={{ marginTop: 28 }}>
        <div style={styles.sectionLabel}>Quick actions</div>
        <div className="selector-grid">
          {quickActions.map(a => (
            <button
              key={a.key}
              className="selector-card"
              onClick={() => navigate(a.key)}
            >
              <div className="selector-icon">{a.icon}</div>
              <div>
                <div className="selector-title">{a.title}</div>
                <div className="selector-desc">{a.desc}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, color, suffix }) {
  return (
    <div style={styles.statCard}>
      <div style={styles.statLabel}>{label}</div>
      <div style={{ ...styles.statValue, color }}>{value}</div>
      {suffix && <div style={styles.statSuffix}>{suffix}</div>}
    </div>
  );
}

const styles = {
  header: { marginBottom: 28 },
  eyebrow: {
    fontFamily: 'var(--font-mono)',
    fontSize: 10,
    letterSpacing: '0.18em',
    color: 'var(--green-bright)',
    marginBottom: 8,
  },
  title: { fontSize: 38, marginBottom: 4, fontVariationSettings: '"opsz" 144' },
  name: {
    background: 'linear-gradient(90deg, var(--green-bright), var(--gold))',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    backgroundClip: 'text',
  },
  subtitle: { color: 'var(--text-2)', fontStyle: 'italic', fontSize: 15 },
  sectionLabel: {
    fontFamily: 'var(--font-mono)',
    fontSize: 10,
    letterSpacing: '0.18em',
    textTransform: 'uppercase',
    color: 'var(--text-3)',
    marginBottom: 12,
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
    gap: 10,
  },
  statCard: {
    background: 'var(--bg-elev)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-lg)',
    padding: 16,
  },
  statLabel: {
    fontFamily: 'var(--font-mono)',
    fontSize: 10,
    letterSpacing: '0.15em',
    textTransform: 'uppercase',
    color: 'var(--text-3)',
    marginBottom: 6,
  },
  statValue: {
    fontFamily: 'var(--font-display)',
    fontSize: 32,
    fontWeight: 400,
    lineHeight: 1,
    fontVariationSettings: '"opsz" 144',
  },
  statSuffix: {
    fontSize: 10,
    color: 'var(--text-2)',
    marginTop: 6,
    fontStyle: 'italic',
  },
};
