import React, { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { useCan } from '../lib/permissions.jsx';
import { useActiveAccount } from '../lib/activeAccount.jsx';
import ProxiesPanel from '../components/ProxiesPanel.jsx';
import AutopilotAIPanel from '../components/AutopilotAIPanel.jsx';

// Configuration page.
//
// Three top-level groups, in the order you actually configure things:
//
//   1. AI            — Anthropic + Grok + Autopilot's separate key.
//                      Each card explains exactly what its key powers.
//   2. Infrastructure — Boost providers (upvote.biz today) + Proxies.
//   3. Account       — Change password + per-account browser sessions.
//
// Removed from the previous version:
//   • SchedulingConfig — dead component, never rendered.
//   • cfgTab single-item tab bar — pointless when there's one tab.
//   • "Connected devices" placeholder — pure marketing surface for a
//     service that doesn't ship yet. Comes back when there's an
//     actual USB bridge to configure.
//   • Side-by-side Anthropic + Grok cards (two near-identical forms) —
//     replaced by one reusable KeyCard so the layout is uniform.

export default function SettingsPage() {
  const { token } = useAuth();
  const can = useCan();
  const { accounts, refresh } = useActiveAccount();

  const isAdmin = can('ai.admin');

  // ── AI state ──────────────────────────────────────────────────────
  const [providers, setProviders] = useState({
    provider: 'anthropic',
    anthropic: { hasKey: false, model: 'claude-haiku-4-5' },
    grok:      { hasKey: false },
  });
  const [grokHasKey, setGrokHasKey] = useState(false);

  const refreshAI = async () => {
    const [p, g] = await Promise.all([
      window.api.ai.getProviders({ token }),
      window.api.ai.hasApiKey({ token }),
    ]);
    if (p.ok) setProviders(p);
    if (g.ok) setGrokHasKey(!!g.hasKey);
  };
  useEffect(() => { refreshAI(); }, [token]);

  // Anthropic save/clear go through setProviderKey (the "providers"
  // surface, which also tracks the active selection). Grok historically
  // sat on the legacy ai.setApiKey IPC; both are wired here so the page
  // stays consistent regardless of which backend route the IPC takes.
  async function saveAnthropic(key) {
    const r = await window.api.ai.setProviderKey({ token, provider: 'anthropic', apiKey: key });
    if (!r.ok) throw new Error(r.error);
    await refreshAI();
  }
  async function clearAnthropic() {
    await window.api.ai.setProviderKey({ token, provider: 'anthropic', apiKey: null });
    await refreshAI();
  }
  async function saveGrok(key) {
    const r = await window.api.ai.setApiKey({ token, apiKey: key });
    if (!r.ok) throw new Error(r.error);
    await refreshAI();
  }
  async function clearGrok() {
    await window.api.ai.setApiKey({ token, apiKey: null });
    await refreshAI();
  }
  async function switchProvider(next) {
    await window.api.ai.setProvider({ token, provider: next });
    setProviders((p) => ({ ...p, provider: next }));
  }

  // ── Boost (upvote.biz) state ──────────────────────────────────────
  const [hasVoteKey, setHasVoteKey] = useState(false);
  useEffect(() => {
    window.api.votes.hasApiKey({ token }).then((r) => setHasVoteKey(!!(r.ok && r.hasKey)));
  }, [token]);
  async function saveVote(key) {
    const r = await window.api.votes.setApiKey({ token, apiKey: key });
    if (!r.ok) throw new Error(r.error);
    setHasVoteKey(true);
  }
  async function clearVote() {
    await window.api.votes.setApiKey({ token, apiKey: null });
    setHasVoteKey(false);
  }

  // ── Account ────────────────────────────────────────────────────────
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [pwMsg, setPwMsg] = useState(null);
  async function changePassword(e) {
    e.preventDefault();
    setPwMsg(null);
    if (pw.next.length < 6) { setPwMsg({ kind: 'err', text: 'Password must be at least 6 characters' }); return; }
    if (pw.next !== pw.confirm) { setPwMsg({ kind: 'err', text: "Passwords don't match" }); return; }
    const res = await window.api.auth.changePassword({
      token, currentPassword: pw.current, newPassword: pw.next,
    });
    if (!res.ok) { setPwMsg({ kind: 'err', text: res.error }); return; }
    setPwMsg({ kind: 'ok', text: 'Password changed.' });
    setPw({ current: '', next: '', confirm: '' });
  }
  async function clearSession(partitionKey) {
    if (!confirm("Log out this account's session? You'll need to log in again next time.")) return;
    await window.api.session.clear(partitionKey);
    refresh();
  }

  const bothAIProvidersConfigured = providers.anthropic?.hasKey && grokHasKey;

  return (
    <div>
      <div className="title-block">
        <div>
          <div className="eyebrow">Configuration</div>
          <h1>Settings</h1>
          <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
            API keys, proxies, and your operator account — all in one place.
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════ AI ═════ */}
      {isAdmin && (
        <Section
          title="AI"
          subtitle="LLM keys that power composing, research, and autopilot. Each key is encrypted using your OS keychain when saved."
        >
          <KeyCard
            title="Anthropic (Claude)"
            recommended
            configured={providers.anthropic?.hasKey}
            description="Powers the AI composer in Scheduler and the analyze + content-plan flow in Intelligence. Prompt caching cuts the static system prompt cost to about 10% after the first hit, so per-call cost stays small. Get a key at console.anthropic.com → API Keys."
            placeholder="sk-ant-…"
            onSave={saveAnthropic}
            onClear={clearAnthropic}
          />

          <KeyCard
            title="Grok (xAI)"
            configured={grokHasKey}
            description="Alternative LLM for the composer + research flows. Useful if you want a different voice on suggestions. Get a key at console.x.ai → API Keys. Switch the active provider below once both are configured."
            placeholder="xai-…"
            onSave={saveGrok}
            onClear={clearGrok}
          />

          {bothAIProvidersConfigured && (
            <Subcard title="Active AI provider"
              description="Decides which LLM the composer + research routes call into. Autopilot uses its own key (below) regardless of this setting.">
              <div style={{ display: 'flex', gap: 6 }}>
                <Toggle
                  active={providers.provider === 'anthropic'}
                  label={`Anthropic · ${providers.anthropic?.model?.includes('haiku') ? 'Claude Haiku 4.5' : 'Claude'}`}
                  onClick={() => switchProvider('anthropic')}
                />
                <Toggle
                  active={providers.provider === 'grok'}
                  label="Grok"
                  onClick={() => switchProvider('grok')}
                />
              </div>
            </Subcard>
          )}

          <Subcard
            title="Autopilot AI"
            badge="Separate key"
            description="A dedicated Anthropic key used only by the autopilot loop and the auto-comment generator. Keeping autopilot spend on its own key makes billing reviews easy and keeps the composer key from being drained by background runs. If this key is not set, autopilot fails closed — it does NOT fall back to the main Anthropic key. The trainer below lets you customize the system prompt per job (SFW post, NSFW post, comment), either globally or per model.">
            <AutopilotAIPanel token={token} />
          </Subcard>
        </Section>
      )}

      {/* ════════════════════════════════════ Infrastructure ════════ */}
      {isAdmin && (
        <Section
          title="Infrastructure"
          subtitle="Shared pools every model can pull from. Schedules attach a boost to a post and a proxy to an account from these here."
        >
          <KeyCard
            title="upvote.biz"
            badge="Reddit upvotes"
            configured={hasVoteKey}
            description="Provides paid Reddit upvotes that the Scheduler can attach to a post when it goes live. Drip rate (fast / medium / slow) is configurable per post — slow looks more organic. Without a key the Scheduler still works but boost attachments are disabled."
            placeholder="upvote.biz API key"
            onSave={saveVote}
            onClear={clearVote}
          />

          <ComingSoonProviders />

          <Subcard
            title="Proxy pool"
            description="HTTP / HTTPS / SOCKS5 proxies that can be attached to a model (inherited by its accounts) or to one account. Each Oserus Browser launch routes that account's session through the configured proxy. Health is auto-tested every 30 minutes and the result feeds the PROXY ISSUE pill on the Dashboard.">
            <ProxiesPanel />
          </Subcard>
        </Section>
      )}

      {/* ═════════════════════════════════════════════ Account ═════ */}
      <Section
        title="Account"
        subtitle="Your operator login and the per-account browser sessions Oserus Browser uses."
      >
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
          <Subcard title="Change password">
            <form onSubmit={changePassword}>
              {pwMsg && (
                <div className={pwMsg.kind === 'err' ? 'error-banner' : ''}
                     style={pwMsg.kind === 'ok' ? styles.ok : { marginBottom: 12 }}>
                  {pwMsg.text}
                </div>
              )}
              <div style={{ marginBottom: 12 }}>
                <label>Current password</label>
                <input type="password" value={pw.current}
                       onChange={(e) => setPw({ ...pw, current: e.target.value })} />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label>New password</label>
                <input type="password" value={pw.next}
                       onChange={(e) => setPw({ ...pw, next: e.target.value })} />
              </div>
              <div style={{ marginBottom: 14 }}>
                <label>Confirm new password</label>
                <input type="password" value={pw.confirm}
                       onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
              </div>
              <button type="submit" className="primary">Update password</button>
            </form>
          </Subcard>

          <Subcard
            title="Account sessions"
            description="Each linked social account uses its own isolated browser session (cookies, storage, partition). Clearing one logs that account out without affecting the others.">
            {accounts.length === 0 ? (
              <div className="empty-state" style={{ padding: 16 }}>No accounts yet.</div>
            ) : (
              <div>
                {accounts.map((a) => (
                  <div key={a.id} style={sessionRow}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13 }}>
                        <span style={platformChip}>{a.platform || 'reddit'}</span>
                        <span className="mono dim">{a.platform === 'redgifs' ? '@' : 'u/'}</span>
                        {a.username}
                      </div>
                      <div className="muted" style={{ fontSize: 11 }}>{a.profile_name}</div>
                    </div>
                    <button className="ghost" onClick={() => clearSession(a.partition_key)}>
                      Clear
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Subcard>
        </div>
      </Section>
    </div>
  );
}

// ──────────────────────────────────────────────────────────── helpers

function Section({ title, subtitle, children }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontFamily: 'var(--font-display)', fontWeight: 600 }}>
          {title}
        </h2>
        {subtitle && (
          <div className="muted" style={{ fontSize: 12, marginTop: 4, maxWidth: 760, lineHeight: 1.5 }}>
            {subtitle}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{children}</div>
    </div>
  );
}

// One reusable card for every API key in the app.
function KeyCard({
  title, description, placeholder,
  recommended, badge,
  configured,
  onSave, onClear,
}) {
  const [value, setValue] = useState('');
  const [busy,  setBusy]  = useState(false);
  const [msg,   setMsg]   = useState(null);

  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 3500);
    return () => clearTimeout(t);
  }, [msg]);

  async function submit(e) {
    e.preventDefault();
    if (!value.trim()) { setMsg({ kind: 'err', text: 'Paste a key first.' }); return; }
    setBusy(true);
    try {
      await onSave(value.trim());
      setValue('');
      setMsg({ kind: 'ok', text: 'Key saved and encrypted.' });
    } catch (err) {
      setMsg({ kind: 'err', text: err.message || 'Save failed.' });
    } finally { setBusy(false); }
  }
  async function remove() {
    if (!confirm(`Remove the saved ${title} key?`)) return;
    try {
      await onClear();
      setMsg({ kind: 'ok', text: 'Key removed.' });
    } catch (err) {
      setMsg({ kind: 'err', text: err.message || 'Remove failed.' });
    }
  }

  return (
    <div className="card" style={{ ...cardBase, borderColor: configured ? 'var(--ok)' : 'var(--border)' }}>
      <div style={cardHeader}>
        <h3 style={{ margin: 0, fontSize: 14 }}>{title}</h3>
        {configured && <Pill tone="ok">✓ configured</Pill>}
        {recommended && <Pill tone="rec">Recommended</Pill>}
        {badge && <Pill tone="neutral">{badge}</Pill>}
      </div>
      <p style={cardDesc}>{description}</p>
      {msg && (
        <div className={msg.kind === 'err' ? 'error-banner' : ''}
             style={msg.kind === 'ok' ? styles.ok : { marginBottom: 10 }}>
          {msg.text}
        </div>
      )}
      <form onSubmit={submit} style={{ display: 'flex', gap: 8 }}>
        <input
          type="password"
          placeholder={configured ? '••••••••••••••••  (paste a new key to replace)' : placeholder}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          style={{ flex: 1 }}
          autoComplete="off"
        />
        <button type="submit" className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        {configured && (
          <button type="button" className="danger" onClick={remove} disabled={busy}>Remove</button>
        )}
      </form>
    </div>
  );
}

// Card-shaped container for non-key UI (sub-feature inside a Section).
function Subcard({ title, description, badge, children }) {
  return (
    <div className="card" style={cardBase}>
      <div style={cardHeader}>
        <h3 style={{ margin: 0, fontSize: 14 }}>{title}</h3>
        {badge && <Pill tone="neutral">{badge}</Pill>}
      </div>
      {description && <p style={cardDesc}>{description}</p>}
      {children}
    </div>
  );
}

function Pill({ tone, children }) {
  const tones = {
    ok:      { background: 'rgba(122,154,90,0.18)',  color: '#bdd5a3' },
    rec:     { background: 'rgba(212,166,74,0.18)',  color: 'var(--gold-bright)' },
    neutral: { background: 'rgba(255,255,255,0.06)', color: 'var(--text-2)' },
  };
  return (
    <span style={{
      ...tones[tone] || tones.neutral,
      fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700,
      letterSpacing: '0.04em', padding: '2px 8px', borderRadius: 4,
    }}>{children}</span>
  );
}

function Toggle({ active, label, onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={active ? 'primary' : 'ghost'}
      style={{ fontSize: 12 }}
    >{label}</button>
  );
}

// Placeholder pills for future boost integrations. Disabled, with a
// tooltip explaining what each provider type will cover. Kept here
// (not deleted) so the seam stays visible — when an adapter lands,
// it slots into this row without restructuring the page.
function ComingSoonProviders() {
  const slots = [
    { v: 'tiktok-views',    label: 'TikTok views',          color: '#25f4ee' },
    { v: 'instagram-likes', label: 'Instagram likes',       color: '#e1306c' },
    { v: 'x-engagement',    label: 'X engagement',          color: '#1d9bf0' },
    { v: 'reddit-other',    label: 'Other Reddit provider', color: '#ff4500' },
  ];
  return (
    <div className="card" style={{ ...cardBase, background: 'transparent', borderStyle: 'dashed' }}>
      <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        Coming soon
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {slots.map((p) => (
          <span key={p.v} title={`${p.label} — provider slot coming soon`} style={{
            background: 'var(--bg-1)', border: '1px dashed var(--border)',
            borderRadius: 999, padding: '4px 12px', fontSize: 11, fontWeight: 600,
            color: 'var(--text-3)', display: 'inline-flex', alignItems: 'center', gap: 6,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: p.color, opacity: 0.55 }} />
            {p.label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────── styles

const cardBase = {
  padding: 16,
  borderRadius: 'var(--radius-lg)',
};
const cardHeader = {
  display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6,
};
const cardDesc = {
  margin: '0 0 12px',
  fontSize: 12, color: 'var(--text-2)', lineHeight: 1.55,
  maxWidth: 760,
};
const sessionRow = {
  display: 'flex', alignItems: 'center', gap: 10,
  padding: '10px 0', borderBottom: '1px solid var(--border)',
};
const platformChip = {
  fontFamily: 'var(--font-mono)', fontSize: 10, marginRight: 6,
  padding: '1px 5px', background: 'var(--bg-2)', borderRadius: 3,
  textTransform: 'uppercase', color: 'var(--text-3)',
};
const styles = {
  ok: {
    background: 'rgba(122,154,90,0.12)',
    border: '1px solid var(--ok)',
    color: '#bdd5a3',
    padding: '10px 14px',
    borderRadius: 4,
    marginBottom: 12,
  },
};
