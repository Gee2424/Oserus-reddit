import React, { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { useCan } from '../lib/permissions.jsx';
import { useActiveAccount } from '../lib/activeAccount.jsx';
import ProxiesPanel from '../components/ProxiesPanel.jsx';
import ExtensionsPanel from '../components/ExtensionsPanel.jsx';
import HomepageTilesPanel from '../components/HomepageTilesPanel.jsx';
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
  async function saveOpenAI(key) {
    const r = await window.api.ai.setProviderKey({ token, provider: 'openai', apiKey: key });
    if (!r.ok) throw new Error(r.error);
    await refreshAI();
  }
  async function clearOpenAI() {
    await window.api.ai.setProviderKey({ token, provider: 'openai', apiKey: null });
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

      {isAdmin && <CloudSyncSection />}

      {isAdmin && <BrowserDevicesSection />}

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
            title="OpenAI"
            configured={providers.openai?.hasKey}
            description="Optional alternative for autopilot comment generation. The Autopilot page lets you pick which provider each (model, platform) protocol uses; Claude is the default. Get a key at platform.openai.com → API Keys."
            placeholder="sk-…"
            onSave={saveOpenAI}
            onClear={clearOpenAI}
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
            description="HTTP / HTTPS / SOCKS5 proxies that can be attached to a model (inherited by its accounts) or to one account. Each Oserus Browser launch routes that account's session through the configured proxy. Health is auto-tested every 30 minutes and the result feeds the PROXY ISSUE pill on the Dashboard. Set a rotation TTL for residential providers to flip exit IPs on a sticky-session interval.">
            <ProxiesPanel />
          </Subcard>

          <Subcard
            title="Chrome extensions"
            description="Unpacked extensions loaded into every account's session partition. Each profile gets its own extension storage / cookies / badges, so uBlock, MetaMask, etc. behave correctly per-account.">
            <ExtensionsPanel />
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

function BrowserDevicesSection() {
  const [tools, setTools] = useState({ adb: '', libimobiledeviceDir: '' });
  const [toolsMsg, setToolsMsg] = useState(null);
  const [scan, setScan] = useState(null);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const t = await window.api.devices.getTools();
        if (t) setTools({
          adb: t.adb && t.adb !== 'adb' ? t.adb : '',
          libimobiledeviceDir: '',
        });
      } catch {}
    })();
  }, []);

  async function saveTools() {
    setToolsMsg(null);
    try {
      await window.api.devices.setTools({
        adb: tools.adb || null,
        libimobiledeviceDir: tools.libimobiledeviceDir || null,
      });
      setToolsMsg({ kind: 'ok', text: 'Saved.' });
    } catch (e) {
      setToolsMsg({ kind: 'err', text: e.message || 'Save failed.' });
    }
  }
  async function scanNow() {
    setScanning(true);
    try {
      const r = await window.api.devices.list();
      setScan(r || { android: [], ios: [] });
    } catch (e) {
      setScan({ android: [], ios: [], error: e.message });
    } finally {
      setScanning(false);
    }
  }

  return (
    <Section
      title="Browser & Devices"
      subtitle="Oserus Browser is a custom Chromium build — like Opera GX, it ships with its own features baked in. Also detects connected phones over USB."
    >
      <Subcard
        title="Oserus Browser"
        description="A custom Chromium build with operator-grade features wired in: per-account session isolation, antidetect fingerprinting, rotating residential proxies, Chrome extension support, an integrated content sidebar, and a profile picker. One window per account, every tab in real Chromium frames — not a webview wrapper."
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
          <Feature icon="◐"  title="Per-account isolation"     body="Each profile gets its own Chromium partition — cookies, storage, service workers stay separate." />
          <Feature icon="◇"  title="Antidetect fingerprint"    body="UA, screen, WebGL, Canvas, Audio, timezone spoofed in the main world before any page script runs." />
          <Feature icon="↻"  title="Rotating residential"      body="Sticky-session usernames flip on a TTL — IPRoyal, SOAX, BrightData, Webshare formats supported." />
          <Feature icon="⛶"  title="Chrome extensions"         body="Load unpacked extensions (uBlock, MetaMask…) per-partition, each profile keeps its own extension state." />
          <Feature icon="☰"  title="Content sidebar"           body="Right-side pane with this week's scheduled posts + drafts, grouped by week, platform-aware tabs." />
          <Feature icon="⎘"  title="Profile picker"            body="Switch between sibling accounts on the same model without leaving the window." />
          <Feature icon="⌕"  title="Find / zoom / devtools"    body="Ctrl+F find-in-page, Ctrl±/0 zoom, F12 devtools, real right-click context menu." />
          <Feature icon="⚑"  title="Login autofill"            body="Account credentials injected on every page load — VAs never see or paste passwords." />
        </div>
        <div className="muted" style={{ fontSize: 11, marginTop: 14, lineHeight: 1.6 }}>
          Launch from any account row's <span className="mono">▶</span> button, or from a model profile's <span className="mono">▶ Reddit</span> button to open every account on that profile in parallel.
        </div>
      </Subcard>

      <Subcard
        title="New-Tab Homepage Tiles"
        description="Operator-configurable quick-launch grid shown on the Oserus Browser new-tab page (the page that opens when you click + on the tab strip). Edit, reorder, recolor, save."
      >
        <HomepageTilesPanel />
      </Subcard>

      <Subcard title="Connected Phones"
        description="We detect phones via Android Debug Bridge (adb) and libimobiledevice (idevice_id). Install those tools and paste their paths below. Account hosting on the phone is coming — detection is the first step.">
        {toolsMsg && (
          <div className={toolsMsg.kind === 'err' ? 'error-banner' : ''}
               style={toolsMsg.kind === 'ok' ? styles.ok : { marginBottom: 10 }}>
            {toolsMsg.text}
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div>
            <label>ADB path</label>
            <input
              type="text"
              placeholder="adb (PATH) or full path to adb.exe"
              value={tools.adb}
              onChange={(e) => setTools({ ...tools, adb: e.target.value })}
              autoComplete="off"
            />
          </div>
          <div>
            <label>libimobiledevice tools dir</label>
            <input
              type="text"
              placeholder="dir containing idevice_id + ideviceinfo"
              value={tools.libimobiledeviceDir}
              onChange={(e) => setTools({ ...tools, libimobiledeviceDir: e.target.value })}
              autoComplete="off"
            />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <button type="button" className="primary" onClick={saveTools}>Save paths</button>
          <button type="button" className="ghost" onClick={scanNow} disabled={scanning}>
            {scanning ? 'Scanning…' : 'Scan now'}
          </button>
        </div>

        {scan && (
          (scan.android.length === 0 && scan.ios.length === 0) ? (
            <div className="empty-state" style={{ padding: 16, fontSize: 13 }}>
              No phones connected. Plug one in and click Scan now.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <div className="eyebrow" style={{ marginBottom: 6 }}>Android</div>
                {scan.android.length === 0 ? (
                  <div className="muted" style={{ fontSize: 12 }}>None</div>
                ) : scan.android.map((d) => (
                  <div key={d.id} style={sessionRow}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13 }}>{d.model || d.id}</div>
                      <div className="mono dim" style={{ fontSize: 11 }}>{d.id}</div>
                    </div>
                    <span style={platformChip}>{d.status || 'detected'}</span>
                  </div>
                ))}
              </div>
              <div>
                <div className="eyebrow" style={{ marginBottom: 6 }}>iOS</div>
                {scan.ios.length === 0 ? (
                  <div className="muted" style={{ fontSize: 12 }}>None</div>
                ) : scan.ios.map((d) => (
                  <div key={d.udid} style={sessionRow}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13 }}>{d.name || d.udid}</div>
                      <div className="mono dim" style={{ fontSize: 11 }}>{d.udid}</div>
                    </div>
                    <span style={platformChip}>detected</span>
                  </div>
                ))}
              </div>
            </div>
          )
        )}
      </Subcard>
    </Section>
  );
}

function CloudSyncSection() {
  const [cfg, setCfg] = useState({ url: '', anonKey: '', deviceName: '', enabled: false, source: 'none', hasBaked: false });
  const [status, setStatus] = useState({ connected: false, lastSyncAt: null, lastError: null, pushed: 0, pulled: 0, peers: [] });
  const [showKey, setShowKey] = useState(false);
  const [testMsg, setTestMsg] = useState(null);
  const [saveMsg, setSaveMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [overrideMode, setOverrideMode] = useState(false);

  useEffect(() => {
    if (!window.api?.cloud) return;
    window.api.cloud.getConfig().then((c) => c && setCfg((prev) => ({ ...prev, ...c, anonKey: '' })));
    window.api.cloud.getStatus().then((s) => s && setStatus(s));
    const off = window.api.cloud.onStatus((s) => setStatus(s));
    return () => { try { off && off(); } catch {} };
  }, []);

  async function onTest() {
    setTestMsg(null);
    setBusy(true);
    try {
      const r = await window.api.cloud.test({ url: cfg.url, anonKey: cfg.anonKey });
      setTestMsg(r.ok ? { kind: 'ok', text: 'Connection OK.' } : { kind: 'err', text: r.error || 'Connection failed.' });
    } finally { setBusy(false); }
  }
  async function onSave() {
    setSaveMsg(null);
    setBusy(true);
    try {
      const r = await window.api.cloud.setConfig({ url: cfg.url, anonKey: cfg.anonKey, deviceName: cfg.deviceName, enabled: true });
      if (r && r.ok === false) setSaveMsg({ kind: 'err', text: r.error || 'Save failed.' });
      else setSaveMsg({ kind: 'ok', text: 'Saved. Connecting…' });
      const c = await window.api.cloud.getConfig();
      if (c) setCfg((prev) => ({ ...prev, ...c, anonKey: '' }));
    } finally { setBusy(false); }
  }
  async function onDisconnect() {
    setBusy(true);
    try {
      await window.api.cloud.setConfig({ enabled: false });
      await window.api.cloud.stop();
      setSaveMsg({ kind: 'ok', text: 'Disconnected.' });
    } finally { setBusy(false); }
  }
  async function onCopySql() {
    try {
      const sql = await window.api.cloud.getSchemaSql();
      await navigator.clipboard.writeText(sql);
      setSaveMsg({ kind: 'ok', text: 'Setup SQL copied to clipboard.' });
    } catch (e) {
      setSaveMsg({ kind: 'err', text: e.message || 'Copy failed.' });
    }
  }

  const pillBg = status.connected ? 'rgba(122,154,90,0.18)'
    : status.lastError ? 'rgba(200,90,90,0.18)' : 'rgba(255,255,255,0.06)';
  const pillColor = status.connected ? '#bdd5a3'
    : status.lastError ? '#e8b4b4' : 'var(--text-2)';
  const pillText = status.connected ? 'Connected'
    : status.lastError ? 'Error' : 'Disconnected';

  return (
    <Section
      title="Cloud Sync"
      subtitle={cfg.source === 'baked'
        ? "This build ships with a central Supabase backend baked in — every install auto-connects to the same project, so activity, posts, comments, and engagement sessions stay in sync across the whole team without per-machine setup."
        : "Mirror activity, posts, comments, and engagement sessions to Supabase so multiple computers stay in sync in near-realtime. Paste your project URL + anon key, run the setup SQL once, then save."}
    >
      <Subcard title="Supabase">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <span
            title={status.lastError || ''}
            style={{
              background: pillBg, color: pillColor,
              fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700,
              letterSpacing: '0.04em', padding: '3px 10px', borderRadius: 4,
            }}
          >
            {pillText}
          </span>
          <span className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>
            Pushed {status.pushed || 0} · Pulled {status.pulled || 0}
            {status.lastSyncAt ? ` · Last sync ${relTime(status.lastSyncAt)}` : ''}
            {' · '}Peers online {Array.isArray(status.peers) ? status.peers.length : 0}
          </span>
        </div>

        {/* Up-front diagnostic. The most common "no data is moving"
            cause is the baked SUPABASE_ANON_KEY in the build being
            empty (admin forgot to paste it before the release) AND no
            per-install override having been saved. Call that out
            directly instead of leaving the operator to interpret a
            blank Pushed/Pulled counter. */}
        {!status.connected && cfg.url && !cfg.anonKey && (
          <div style={{
            background: 'rgba(231,196,120,0.10)',
            border: '1px solid var(--gold)',
            borderRadius: 6,
            padding: '10px 12px',
            marginBottom: 12,
            fontSize: 12,
            color: 'var(--gold-bright)',
          }}>
            ⚠ <strong>Not connected.</strong> The build has a Supabase URL but no anon key.
            Paste the anon key below + click <em>Save and connect</em> to start syncing.
            (Anon key lives in Supabase Dashboard → Project Settings → API → "anon public".)
          </div>
        )}
        {!status.connected && !cfg.url && (
          <div style={{
            background: 'rgba(231,196,120,0.10)',
            border: '1px solid var(--gold)',
            borderRadius: 6,
            padding: '10px 12px',
            marginBottom: 12,
            fontSize: 12,
            color: 'var(--gold-bright)',
          }}>
            ⚠ <strong>Not connected.</strong> No Supabase project configured.
            Paste your URL + anon key below + click <em>Save and connect</em>.
          </div>
        )}

        {saveMsg && (
          <div className={saveMsg.kind === 'err' ? 'error-banner' : ''}
               style={saveMsg.kind === 'ok' ? styles.ok : { marginBottom: 10 }}>
            {saveMsg.text}
          </div>
        )}
        {testMsg && (
          <div className={testMsg.kind === 'err' ? 'error-banner' : ''}
               style={testMsg.kind === 'ok' ? styles.ok : { marginBottom: 10 }}>
            {testMsg.text}
          </div>
        )}

        {cfg.source === 'baked' && !overrideMode && (
          <div style={{
            background: 'rgba(122,154,90,0.08)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: 12,
            marginBottom: 12,
          }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
              Central backend (built-in)
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.5 }}>
              This install is auto-connected to the central Oserus Supabase project shipped with the build.
              You don't need to paste anything — sync is on by default.
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              <div>
                <label style={{ fontSize: 10 }}>Device name</label>
                <input
                  type="text"
                  placeholder="e.g. Studio iMac"
                  value={cfg.deviceName}
                  onChange={(e) => setCfg({ ...cfg, deviceName: e.target.value })}
                  autoComplete="off"
                />
              </div>
              <div style={{ alignSelf: 'flex-end' }}>
                <button type="button" className="ghost" onClick={() => setOverrideMode(true)}>
                  Override (admin)
                </button>
              </div>
            </div>
          </div>
        )}

        {(cfg.source !== 'baked' || overrideMode) && (<>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div>
            <label>Supabase URL</label>
            <input
              type="text"
              placeholder="https://xxxx.supabase.co"
              value={cfg.url}
              onChange={(e) => setCfg({ ...cfg, url: e.target.value })}
              autoComplete="off"
            />
          </div>
          <div>
            <label>Device name</label>
            <input
              type="text"
              placeholder="e.g. Studio iMac"
              value={cfg.deviceName}
              onChange={(e) => setCfg({ ...cfg, deviceName: e.target.value })}
              autoComplete="off"
            />
          </div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <label>Anon key</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              type={showKey ? 'text' : 'password'}
              placeholder="paste anon public key (leave blank to keep existing)"
              value={cfg.anonKey}
              onChange={(e) => setCfg({ ...cfg, anonKey: e.target.value })}
              style={{ flex: 1 }}
              autoComplete="off"
            />
            <button type="button" className="ghost" onClick={() => setShowKey((v) => !v)}>
              {showKey ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="ghost" onClick={onTest} disabled={busy}>Test connection</button>
          <button type="button" className="primary" onClick={onSave} disabled={busy}>Save and connect</button>
          <button type="button" className="danger" onClick={onDisconnect} disabled={busy}>Disconnect</button>
          <button type="button" className="ghost" onClick={onCopySql} disabled={busy}>Copy setup SQL</button>
          {cfg.source === 'baked' && overrideMode && (
            <button type="button" className="ghost" onClick={() => setOverrideMode(false)}>
              Cancel override
            </button>
          )}
        </div>

        <p style={{ ...cardDesc, marginTop: 12, marginBottom: 0 }}>
          Paste the URL and anon key from your Supabase project (Project Settings → API).
          Click "Copy setup SQL", run it once in the SQL editor, then click "Save and connect".
        </p>
        </>)}
      </Subcard>

      <Subcard title="Per-table sync status">
        <TableSyncDiagnostic />
      </Subcard>
    </Section>
  );
}

// Per-table sync diagnostic. Lists every table the client tries to
// push/pull with its current state. Shows a colored dot per table, the
// last error verbatim, and a Push-now / Pull-all pair to force a sync
// attempt and re-paint immediately. This is what to look at when the
// global pill says "Connected" but a specific table (model_profiles,
// users, …) isn't moving — the row's lastError tells you why.
function TableSyncDiagnostic() {
  const [rows, setRows] = React.useState([]);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState(null);

  const refresh = React.useCallback(async () => {
    try {
      const r = await window.api.cloud.tableStatus();
      if (r && r.ok) setRows(r.tables || []);
    } catch {}
  }, []);
  React.useEffect(() => { refresh(); const id = setInterval(refresh, 4000); return () => clearInterval(id); }, [refresh]);

  async function onPush() {
    setBusy(true); setMsg(null);
    try {
      const r = await window.api.cloud.pushNow();
      if (r && r.ok) { setRows(r.tables || []); setMsg('Pushed. Check the per-row status for any failures.'); }
      else setMsg(r?.error || 'Push failed.');
    } finally { setBusy(false); }
  }
  async function onPull() {
    setBusy(true); setMsg(null);
    try {
      const r = await window.api.cloud.pullAll();
      if (r && r.ok) { setRows(r.tables || []); setMsg('Pulled. Local DB now mirrors Supabase.'); }
      else setMsg(r?.error || 'Pull failed.');
    } finally { setBusy(false); }
  }

  return (
    <div>
      <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
        Each row is one synced table. Green = pushing + pulling cleanly. Red = the last attempt errored — hover the row to read the message. Use <em>Push now</em> after editing model profiles / accounts / etc. to force a sync right away; use <em>Pull all</em> on a fresh install to mirror everything Supabase already has.
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <button className="primary" type="button" disabled={busy} onClick={onPush}>{busy ? '…' : 'Push now'}</button>
        <button className="ghost"   type="button" disabled={busy} onClick={onPull}>{busy ? '…' : 'Pull all'}</button>
        <button className="ghost"   type="button" disabled={busy} onClick={refresh}>↻ Refresh</button>
      </div>
      {msg && <div className="muted" style={{ fontSize: 11, marginBottom: 8 }}>{msg}</div>}
      <div style={{
        display: 'grid', gridTemplateColumns: '14px 1fr 80px 80px 1fr',
        rowGap: 2, fontSize: 12, fontFamily: 'var(--font-mono)',
      }}>
        <div className="muted" style={{ fontSize: 10 }}></div>
        <div className="muted" style={{ fontSize: 10 }}>TABLE</div>
        <div className="muted" style={{ fontSize: 10, textAlign: 'right' }}>PUSHED</div>
        <div className="muted" style={{ fontSize: 10, textAlign: 'right' }}>PULLED</div>
        <div className="muted" style={{ fontSize: 10 }}>LAST EVENT</div>
        {rows.length === 0 && (
          <div style={{ gridColumn: '1 / -1', padding: 12, color: 'var(--text-3)' }}>
            Sync isn't running yet, or no tables have been touched. If sync is enabled and you've used the app, click <em>Push now</em>.
          </div>
        )}
        {rows.map((r) => {
          const color = r.ok === true ? 'var(--ok)' : r.ok === false ? '#e2a3a3' : 'var(--text-3)';
          const last = r.lastError ? `✗ ${r.lastError}`
            : r.lastPushAt ? `pushed ${relTime(r.lastPushAt)}`
            : r.lastPullAt ? `pulled ${relTime(r.lastPullAt)}`
            : '(no activity yet)';
          return (
            <React.Fragment key={r.table}>
              <div title={r.ok === false ? 'Last attempt errored' : r.ok === true ? 'OK' : 'No activity yet'} style={{ alignSelf: 'center' }}>
                <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: color }} />
              </div>
              <div style={{ alignSelf: 'center', color: 'var(--text-1)' }}>{r.table}</div>
              <div style={{ alignSelf: 'center', textAlign: 'right' }}>{r.pushed || 0}</div>
              <div style={{ alignSelf: 'center', textAlign: 'right' }}>{r.pulled || 0}</div>
              <div style={{ alignSelf: 'center', color: r.lastError ? '#e2a3a3' : 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.lastError || ''}>
                {last}
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

function relTime(iso) {
  try {
    const t = new Date(iso).getTime();
    const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  } catch { return ''; }
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

function Feature({ icon, title, body }) {
  return (
    <div style={{
      padding: 12, borderRadius: 8,
      background: 'var(--bg-elev)', border: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{
          width: 22, height: 22, borderRadius: 6, flexShrink: 0,
          background: 'var(--gold-soft)', color: 'var(--gold)',
          display: 'grid', placeItems: 'center',
          fontSize: 13, fontWeight: 700,
        }}>{icon}</span>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-0)' }}>{title}</div>
      </div>
      <div className="muted" style={{ fontSize: 11, lineHeight: 1.5 }}>{body}</div>
    </div>
  );
}
