import React, { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { useCan } from '../lib/permissions.jsx';
import { useActiveAccount } from '../lib/activeAccount.jsx';
import { usePlatforms, platformUsernamePrefix } from '../lib/platforms.js';
import { useCloakManagerLaunch } from '../hooks/useCloakManagerLaunch';
import { launchAccountBrowser, launchModelBrowser } from '../lib/launchAccount.js';
import { Banner } from '../components/ui.jsx';
import { ModelDetailSkeleton } from '../components/Skeletons.jsx';
import { useToast } from '../lib/toast.jsx';
import { useConfirm } from '../lib/confirm.jsx';
import LaunchScriptsPanel from '../components/LaunchScriptsPanel.jsx';
import LaunchStatus from '../components/LaunchStatus.jsx';

const STATUS_OPTIONS = [
  { v: 'warming', label: 'Warming up' },
  { v: 'ready', label: 'Ready' },
  { v: 'paused', label: 'Paused' },
  { v: 'banned', label: 'Banned' },
];

const STATUS_COLORS = { warming: 'var(--gold)', ready: 'var(--green-bright)', paused: 'var(--text-2)', banned: 'var(--danger)' };

// CloakManager only accepts alphanumeric characters, hyphens, and
// underscores in a profile name — mirrors src/main/lib/profileName.js's
// sanitizeForCmName so an override built here never fails backend
// validation (e.g. a model name with a space in it).
// CloakManager sometimes bubbles up a raw backend validation dump (a
// stringified Python list/dict) instead of a plain message — show something
// a non-technical user can read instead of dumping that verbatim.
function friendlyCmError(msg) {
  const text = String(msg || 'Unknown error');
  if (/^\s*[\[{]/.test(text) && text.includes("'type':")) {
    return 'CloakManager rejected this request (invalid profile configuration). Try again — if it keeps failing, contact support.';
  }
  return text.length > 160 ? text.slice(0, 160) + '…' : text;
}

function sanitizeForCmName(str) {
  return String(str || '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'model';
}

// Browser mode configuration
const BROWSER_MODES = {
  electron: { label: 'Electron', color: '#4a90e2', icon: '⚡' },
  cloakmanager: { label: 'CloakManager', color: '#9b59b6', icon: '👻' },
};

export default function ModelDetailPage({ modelId, navigate }) {
  // Platform list from shared source (includes icons + admin-added ones).
  // Read live so this page reflects loadPlatforms() as soon as it resolves,
  // rather than freezing whatever was loaded at first module evaluation.
  const PLATFORMS = usePlatforms();
  const { token, user, activeTeamId } = useAuth();
  const { refresh: refreshActive, startAccount } = useActiveAccount();
  const [model, setModel] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [proxies, setProxies] = useState([]);
  const [promoSubs, setPromoSubs] = useState([]);
  const [newPromoSub, setNewPromoSub] = useState('');
  const [promoSubError, setPromoSubError] = useState(null);
  const [showAddPlatform, setShowAddPlatform] = useState(null); // 'reddit' or 'redgifs'
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blankForm());
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const [showAddProxy, setShowAddProxy] = useState(false);
  const [proxyForm, setProxyForm] = useState({ label: '', kind: 'http', host: '', port: '', username: '', password: '' });
  const [proxyError, setProxyError] = useState(null);

  const [activityEntries, setActivityEntries] = useState([]);
  const [tab, setTab] = useState('resources'); // resources | analytics | activity
  const [addMenuOpen, setAddMenuOpen] = useState(false);

  const can = useCan();
  const canManage = can('profiles.manage');
  const {
    isAvailable, checkAvailability, checkAvailabilityWithRetry, startCloakManager,
    launchProgress, cloakStatus, isAccountRunning,
    getLaunchPhase, getAttention, clearAttentionLocal,
  } = useCloakManagerLaunch();
  const [startingCm, setStartingCm] = useState(false);
  const [accountOperation, setAccountOperation] = useState(null); // { type: 'creating' | 'launching', accountId: null }
  const [operationMessage, setOperationMessage] = useState(null);
  const [launchingId, setLaunchingId] = useState(null);
  const [showPasswords, setShowPasswords] = useState(false);
  const [showScriptsPanel, setShowScriptsPanel] = useState(false);
  const canViewActivity = can('activity.view');
  const { toast } = useToast();
  const { confirm } = useConfirm();

  function blankForm() {
    return {
      username: '', password: '', email: '', emailPassword: '',
      status: 'warming', proxy_id: '', notes: '',
      os_profile: 'desktop',
    };
  }

  async function load() {
    setLoading(true);
    const [profilesRes, accountsRes, proxiesRes, promoRes, activityRes] = await Promise.all([
      window.api.profiles.list({ token, teamId: activeTeamId }),
      window.api.accounts.listForProfile({ token, profileId: Number(modelId), teamId: activeTeamId }),
      window.api.proxies.list({ token, teamId: activeTeamId }),
      window.api.subs.listPromo({ token, profileId: Number(modelId) }),
      canViewActivity
        ? window.api.activity.list({ token, limit: 20 })
        : Promise.resolve({ ok: true, entries: [] }),
    ]);
    if (profilesRes.ok) {
      const found = profilesRes.profiles.find(p => p.id === Number(modelId));
      setModel(found || null);
    }
    if (accountsRes.ok) setAccounts(accountsRes.accounts);
    if (proxiesRes.ok) setProxies(proxiesRes.proxies);
    if (promoRes.ok) setPromoSubs(promoRes.subs);
    if (activityRes.ok) setActivityEntries(activityRes.entries);
    setLoading(false);
  }

  // Provisions (or re-provisions) the model's shared CloakManager profile.
  // Shared by the mode toggle (fires on electron<->cloakmanager) and the
  // "Retry profile setup" button (fires with the same 'cloakmanager' value
  // when already in that mode, since the toggle itself only calls onChange
  // on an actual value change).
  async function provisionCmProfile(v) {
    if (v === 'cloakmanager') setOperationMessage('Creating CloakManager profile...');
    const res = await window.api.profiles.update({
      token, profileId: Number(modelId),
      updates: { browser_mode: v },
      teamId: activeTeamId,
    });
    if (res.ok) {
      if (v === 'cloakmanager') {
        const cp = res.cmProfile;
        if (cp?.ok) setOperationMessage(`CM profile "${cp.profileName}" created`);
        else setOperationMessage(`Failed: ${friendlyCmError(cp?.error)}`);
        setTimeout(() => setOperationMessage(null), 4000);
      }
      await load();
    } else {
      setOperationMessage(`Failed: ${friendlyCmError(res.error)}`);
      setTimeout(() => setOperationMessage(null), 4000);
    }
  }

  async function addPromoSub(e) {
    e.preventDefault();
    setPromoSubError(null);
    if (!newPromoSub.trim()) return;
    const res = await window.api.subs.createPromo({
      token, profileId: Number(modelId), name: newPromoSub.trim(),
    });
    if (!res.ok) { setPromoSubError(res.error); return; }
    setNewPromoSub('');
    load();
  }

  async function delPromoSub(id) {
    await window.api.subs.deletePromo({ token, id });
    load();
  }

  useEffect(() => {
    load();
    // Retry-aware: app startup spawns/health-checks the CloakManager backend
    // asynchronously and that can take up to ~60s, so a check that lands
    // right on mount can easily race ahead of it actually being ready. A
    // plain one-shot check that comes back false would otherwise get stuck
    // showing "Unavailable" forever with nothing to re-trigger it.
    if (token) checkAvailabilityWithRetry(token);
  }, [modelId, token, activeTeamId, checkAvailabilityWithRetry]);

  async function handleStartCloakManager() {
    setStartingCm(true);
    setOperationMessage('Starting CloakManager…');
    try {
      const res = await startCloakManager(token);
      setOperationMessage(res?.ok ? 'CloakManager started' : `Failed: ${friendlyCmError(res?.error)}`);
    } finally {
      setStartingCm(false);
      setTimeout(() => setOperationMessage(null), 4000);
    }
  }

  function startAddFor(platform) {
    setEditing(null);
    setForm(blankForm());
    setShowAddPlatform(platform);
    setError(null);
  }

  function startEdit(account) {
    setEditing(account);
    setForm({
      username: account.username,
      password: '',
      email: account.email || '',
      emailPassword: '',
      status: account.status,
      proxy_id: account.proxy_id || '',
      notes: account.notes || '',
      os_profile: account.os_profile || 'desktop',
    });
    setShowAddPlatform(account.platform);
  }

  function cancel() {
    setShowAddPlatform(null);
    setEditing(null);
    setForm(blankForm());
    setError(null);
    setShowPasswords(false);
  }

  async function submit(e) {
    e.preventDefault();
    setError(null);
    if (!form.username) { setError('Username required'); return; }
    let res;
    if (editing) {
      const updates = {
        status: form.status,
        proxy_id: form.proxy_id ? Number(form.proxy_id) : null,
        notes: form.notes,
        email: form.email || null,
        os_profile: form.os_profile || 'desktop',
      };
      if (form.password) updates.password = form.password;
      if (form.emailPassword) updates.emailPassword = form.emailPassword;
      res = await window.api.accounts.update({ token, accountId: editing.id, updates });
    } else {
      res = await window.api.accounts.create({
        token,
        profileId: Number(modelId),
        platform: showAddPlatform,
        username: form.username.trim().replace(/^[u@]\//, '').replace(/^@/, ''),
        password: form.password || null,
        email: form.email || null,
        emailPassword: form.emailPassword || null,
        status: form.status,
        proxyId: form.proxy_id ? Number(form.proxy_id) : null,
        notes: form.notes,
        osProfile: form.os_profile || 'desktop',
        teamId: activeTeamId,
      });
    }
    if (!res.ok) { setError(res.error); return; }
    setShowPasswords(false);
    await load();
    cancel();
    await refreshActive();
  }

  async function quickStatus(accountId, status) {
    await window.api.accounts.update({ token, accountId, updates: { status } });
    await load();
    await refreshActive();
  }

  async function del(accountId) {
    const ok = await confirm('Delete this account record? The actual account on the platform is untouched.', { confirmLabel: 'Remove', variant: 'danger' });
    if (!ok) return;
    await window.api.accounts.delete({ token, accountId });
    await load();
    await refreshActive();
  }

  async function start(accountId) {
    setLaunchingId(accountId);
    try {
      // Browsing happens in a dedicated Oserus Browser window now, not an
      // in-app page. Mode (Electron vs CloakManager) is resolved server-side.
      await launchAccountBrowser({ token, accountId, startAccount });
    } finally {
      setLaunchingId(null);
    }
  }

  async function addProxy(e) {
    e.preventDefault();
    setProxyError(null);
    if (!proxyForm.host || !proxyForm.port) { setProxyError('Host and port required'); return; }
    const res = await window.api.proxies.create({
      token,
      label: proxyForm.label || `${proxyForm.host}:${proxyForm.port}`,
      kind: proxyForm.kind,
      host: proxyForm.host,
      port: Number(proxyForm.port),
      username: proxyForm.username || null,
      password: proxyForm.password || null,
      teamId: activeTeamId,
    });
    if (!res.ok) { setProxyError(res.error); return; }
    setProxyForm({ label: '', kind: 'http', host: '', port: '', username: '', password: '' });
    setShowAddProxy(false);
    await load();
  }

  // Which proxies are actually attached to this model's accounts?
  const usedProxyIds = new Set(accounts.map(a => a.proxy_id).filter(Boolean));
  const modelProxies = proxies.filter(p => usedProxyIds.has(p.id));
  const proxyUsageCount = (proxyId) => accounts.filter(a => a.proxy_id === proxyId).length;

  if (loading) {
    return <ModelDetailSkeleton />;
  }
  if (!model) {
    return (
      <div style={{ padding: 48, textAlign: 'center', border: '1px dashed var(--border)', borderRadius: 'var(--radius-lg)', background: 'var(--bg-1)' }}>
        <div style={{ fontSize: 36, marginBottom: 10, color: 'var(--text-3)' }}>◇</div>
        <h2 style={{ marginBottom: 8, fontSize: 18 }}>Model not found</h2>
        <div className="muted" style={{ fontSize: 13, marginBottom: 16 }}>The model profile you're looking for doesn't exist or was deleted.</div>
        <button className="primary" onClick={() => navigate('profiles')}>← Back to models</button>
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <button className="ghost" onClick={() => navigate('profiles')} style={{ fontSize: 12 }}>← All models</button>
      </div>

      <div className="title-block" style={{ alignItems: 'center', gap: 16 }}>
        <div style={{
          width: 56, height: 56, borderRadius: '50%',
          background: model.avatar_color
            ? `linear-gradient(135deg, ${model.avatar_color}, var(--gold))`
            : 'var(--gradient-brand)',
          color: 'var(--bg-0)',
          display: 'grid', placeItems: 'center',
          fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700,
          boxShadow: '0 4px 14px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.06) inset',
          flexShrink: 0,
        }}>
          {(model.name || '?').charAt(0).toUpperCase()}
        </div>
        <div style={{ flex: 1 }}>
          <div className="eyebrow">Model profile</div>
          <h1 style={{ marginTop: 2 }}>{model.name}</h1>
          <div className="muted" style={{ fontSize: 13, marginTop: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {model.niche && <span className="pill green">{model.niche}</span>}
            <span className="mono dim">{accounts.filter(a => a.platform !== 'redgifs').length} Reddit · {accounts.filter(a => a.platform === 'redgifs').length} RedGifs · {modelProxies.length} proxies</span>
            {model.assigned_to_name && <>Assigned to <span style={{ color: 'var(--text-1)' }}>{model.assigned_to_username}</span></>}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* One "Open Browser" for the model. Electron mode: one window,
              one tab per linked account. CloakManager mode: the model's
              shared external browser. Mode is resolved server-side. */}
          <button
            title={(model.browser_mode || 'electron') === 'cloakmanager'
              ? "Open this model's shared CloakManager browser"
              : 'Open one window with a tab per linked account'}
            disabled={launchingId === 'model'}
            onClick={async () => {
              setLaunchingId('model');
              try {
                const r = await launchModelBrowser({ token, profileId: Number(modelId) });
                if (!r.ok) {
                  setOperationMessage(`Failed: ${friendlyCmError(r.error)}`);
                  setTimeout(() => setOperationMessage(null), 4000);
                }
              } finally {
                setLaunchingId(null);
              }
            }}
            style={{ ...playBtnStyle, opacity: launchingId === 'model' ? 0.6 : 1 }}
          >{launchingId === 'model' ? '⏳ Launching…' : '▶ Open Browser'}</button>
          <ModeBadge mode={(model.browser_mode || 'electron') === 'cloakmanager' ? 'cloakmanager' : 'electron'} />
        </div>
      </div>

      {/* CloakManager Status + Browser Mode */}
      <div style={{
        padding: '8px 12px',
        background: isAvailable ? 'rgba(122,154,90,0.12)' : 'rgba(180,90,90,0.12)',
        borderWidth: 1, borderStyle: 'solid',
        borderColor: isAvailable ? 'var(--ok)' : 'var(--danger)',
        borderRadius: 'var(--radius)',
        fontSize: 12,
        marginBottom: 14,
        display: 'flex',
        alignItems: 'center',
        gap: 8
      }}>
        <span style={{
          width: 8, height: 8, borderRadius: '50%',
          background: isAvailable ? 'var(--online-green)' : 'var(--danger-fg)'
        }} />
        CloakManager: {isAvailable ? 'Available' : 'Unavailable'}
        {!isAvailable && (user?.role === 'admin' || user?.role === 'owner') && (
          <button className="ghost" style={{ fontSize: 11, padding: '2px 8px', marginLeft: 'auto' }}
            disabled={startingCm}
            onClick={handleStartCloakManager}
            title="Retry the availability check, or start the CloakManager backend if it isn't running">
            {startingCm ? 'Starting…' : '↻ Start CloakManager'}
          </button>
        )}
      </div>

      {/* Model Browser Mode Selector */}
      {canManage && (
        <div style={{
          padding: '10px 14px',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          background: 'var(--bg-elev)',
          marginBottom: 14,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}>
          <span className="muted" style={{ fontSize: 12, fontWeight: 600 }}>Browser mode:</span>
          <ToggleGroup
            options={[
              { v: 'electron', label: 'Electron', hint: 'Built-in browser with shared fingerprint per model' },
              { v: 'cloakmanager', label: 'CloakManager', hint: 'External antidetect browser — one shared instance per model, used by every linked account on any platform' },
            ]}
            value={model.browser_mode || 'electron'}
            onChange={provisionCmProfile}
          />
          {model.browser_mode === 'cloakmanager' && model.cloak_profile_name && (
            <span className="mono dim" style={{ fontSize: 11 }}>
              Instance: {model.cloak_profile_name}
            </span>
          )}
          {canManage && model.browser_mode === 'cloakmanager' && !model.cloak_profile_name && (
            // The toggle above only fires onChange when the value actually
            // changes, so once this model is already set to 'cloakmanager'
            // but profile creation failed (e.g. a transient CloakManager
            // error), there was no way to retry from here — clicking the
            // already-selected "CloakManager" option is a no-op. This button
            // resends the exact same provisioning call explicitly.
            <button className="ghost" style={{ fontSize: 11, padding: '4px 8px', color: 'var(--danger-fg)' }}
              onClick={() => provisionCmProfile('cloakmanager')}
              title="No CloakManager profile was created yet — retry provisioning it">
              ⚠ Retry profile setup
            </button>
          )}
          {canManage && model.browser_mode === 'cloakmanager' && (
            <button className="ghost" style={{ fontSize: 11, padding: '4px 8px' }}
              onClick={() => setShowScriptsPanel(true)}
              title="Configure the setup/login sequence that runs when this model's shared browser opens">
              Scripts
            </button>
          )}
          {operationMessage && (
            <span style={{
              fontSize: 11,
              color: operationMessage.startsWith('Failed') || operationMessage.startsWith('Error')
                ? 'var(--danger-fg)' : 'var(--gold-bright)',
              marginLeft: 'auto', maxWidth: '50%',
            }}>{operationMessage}</span>
          )}
        </div>
      )}

      {/* Model Proxy Selector — same "one per model" logic as fingerprint/
          browser mode: CloakManager's shared profile has exactly one proxy,
          not one per account. */}
      {canManage && (
        <div style={{
          padding: '10px 14px',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          background: 'var(--bg-elev)',
          marginBottom: 14,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}>
          <span className="muted" style={{ fontSize: 12, fontWeight: 600 }}>Model proxy:</span>
          <select
            value={model.proxy_id || ''}
            style={{ maxWidth: 320 }}
            onChange={async (e) => {
              const proxyId = e.target.value ? Number(e.target.value) : null;
              const res = await window.api.profiles.update({
                token, profileId: Number(modelId),
                updates: { proxy_id: proxyId },
                teamId: activeTeamId,
              });
              if (res.ok) {
                if (model.browser_mode === 'cloakmanager') {
                  const cp = res.cmProfile;
                  setOperationMessage(cp?.ok ? 'CloakManager profile updated with new proxy' : `Failed: ${friendlyCmError(cp?.error)}`);
                  setTimeout(() => setOperationMessage(null), 4000);
                }
                await load();
              } else {
                setOperationMessage(`Failed: ${friendlyCmError(res.error)}`);
                setTimeout(() => setOperationMessage(null), 4000);
              }
            }}
          >
            <option value="">— no proxy —</option>
            {proxies.map(p => <option key={p.id} value={p.id}>{p.label} ({p.kind} {p.host}:{p.port})</option>)}
          </select>
          <span className="muted" style={{ fontSize: 11 }}>
            {model.browser_mode === 'cloakmanager'
              ? 'Shared by every account on this model — CloakManager launches one browser, one proxy.'
              : 'Default for accounts without their own proxy set.'}
          </span>
        </div>
      )}

      {(model.brand_voice || model.notes) && (
        <div className="card" style={{ marginBottom: 22 }}>
          {model.brand_voice && (
            <div style={{ marginBottom: model.notes ? 8 : 0 }}>
              <label>Brand voice</label>
              <div style={{ fontStyle: 'italic', color: 'var(--text-1)' }}>"{model.brand_voice}"</div>
            </div>
          )}
          {model.notes && (
            <div>
              <label>Notes</label>
              <div className="muted">{model.notes}</div>
            </div>
          )}
        </div>
      )}

      <div style={tabBarStyle}>
        <div style={{ display: 'flex', gap: 4 }}>
          {[
            { v: 'resources', label: 'Linked accounts', count: accounts.length + modelProxies.length },
            { v: 'analytics', label: 'Analytics', count: 0 },
            ...(canManage ? [{ v: 'activity', label: 'Activity', count: activityEntries.length }] : []),
          ].map(t => (
            <button
              key={t.v}
              onClick={() => setTab(t.v)}
              style={{
                ...tabStyle,
                ...(tab === t.v ? tabActiveStyle : {}),
              }}
            >
              {t.label}
              {t.count > 0 && <span className="mono dim" style={{ marginLeft: 6, fontSize: 11 }}>{t.count}</span>}
            </button>
          ))}
        </div>
        {canManage && tab === 'resources' && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="dim" style={{ fontSize: 11, marginRight: 4 }}>+ Link account:</span>
            {PLATFORMS.map((plat) => {
              const active = showAddPlatform === plat.v;
              const connected = accounts.filter((a) => (a.platform || 'reddit') === plat.v).length;
              return (
                <button
                  key={plat.v}
                  onClick={() => startAddFor(plat.v)}
                  title={connected > 0
                    ? `Link another ${plat.label} account (${connected} already linked)`
                    : `Link a new ${plat.label} account to this model`}
                  style={{
                    background: active ? plat.color : 'var(--bg-1)',
                    color: active ? '#fff' : 'var(--text-1)',
                    borderWidth: 1, borderStyle: 'solid',
                    borderColor: active ? plat.color : 'var(--border)',
                    borderRadius: 'var(--radius-pill)', padding: '5px 14px', fontSize: 12, fontWeight: 600,
                    cursor: 'pointer',
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                  }}
                >
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: plat.color }} />
                  {plat.label}
                  {connected > 0 && (
                    <span className="mono" style={{ fontSize: 10, opacity: 0.75 }}>· {connected}</span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {tab === 'resources' && PLATFORMS.map(plat => {
        // Every platform gets its own always-visible section — Reddit,
        // RedGIFs, X, Instagram, TikTok, and anything added later in
        // Platforms — none is the "default" and none is hidden when empty.
        const platAccounts = accounts.filter(a => (a.platform || 'reddit') === plat.v);

        return (
          <div key={plat.v} style={{ marginBottom: 28 }}>
            <div style={styles.platformHeader}>
              <span style={{ fontSize: 20 }}>{plat.icon}</span>
              <h2>{plat.label} accounts</h2>
              <span className="mono dim" style={{ fontSize: 12 }}>{platAccounts.length} linked</span>
              <div style={{ flex: 1 }} />
              {canManage && (
                <button className="primary" onClick={() => startAddFor(plat.v)}>
                  + Add account
                </button>
              )}
            </div>

            {platAccounts.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', border: '1px dashed var(--border)', borderRadius: 'var(--radius-lg)', background: 'var(--bg-1)' }}>
                <div style={{ fontSize: 24, marginBottom: 6, color: 'var(--text-3)' }}>{plat.icon}</div>
                <div style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 14 }}>No {plat.label} accounts linked yet.</div>
                {canManage && (
                  <button className="primary" onClick={() => startAddFor(plat.v)}>+ Add account</button>
                )}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {platAccounts.map(a => {
                  const browserMode = model?.browser_mode || 'electron';
                  const modeConfig = BROWSER_MODES[browserMode] || BROWSER_MODES.electron;
                  const isRunning = a.cloak_actual_name && cloakStatus[a.cloak_actual_name] === 'running';
                  const isLaunching = launchingId === a.id;
                  const launchPct = a.cloak_actual_name && launchProgress[a.cloak_actual_name];
                  const cmName = a.effective_cm_name || a.cloak_actual_name;
                  const cmPhase = browserMode === 'cloakmanager' ? getLaunchPhase(cmName) : null;
                  const cmAttention = getAttention(a.id)
                    || (a.needs_attention ? { code: (a.attention_reason || '').split(':')[0] || 'not_logged_in', reason: a.attention_reason } : null);
                  const cmBusy = cmPhase && cmPhase.stage && cmPhase.stage !== 'ready' && cmPhase.stage !== 'failed';

                  // Same-platform conflict detection
                  const samePlatformAccounts = platAccounts.filter(o => o.id !== a.id);
                  const hasConflict = samePlatformAccounts.length > 0 && browserMode === 'cloakmanager';
                  const hasOverride = !!a.cloak_profile_override;
                  return (
                    <React.Fragment key={a.id}>
                  <div style={styles.accountRow}>
                    <button
                      className="primary"
                      disabled={isLaunching}
                      onClick={() => start(a.id)}
                      style={{
                        ...styles.startBtn,
                        opacity: isLaunching ? 0.6 : 1,
                        cursor: isLaunching ? 'not-allowed' : 'pointer',
                      }}
                      title={isRunning ? 'Browser is running' : `Open ${plat.label} as ${a.username} (${modeConfig.label})`}
                    >
                      {isRunning ? '● Running' : isLaunching && launchPct ?
                        `${Math.round(launchPct.progress * 100)}%…` : isLaunching ? '⏳ Launching…' : '▶ Open Browser'}
                    </button>
                    {(cmPhase || cmAttention) && !isRunning && (
                      <LaunchStatus
                        compact
                        phase={cmPhase}
                        attention={cmAttention}
                        running={isRunning}
                        actions={{
                          fixCredentials: () => startEdit(a),
                          openBrowser: () => start(a.id),
                          openProxies: () => navigate('proxies'),
                          retry: cmBusy ? undefined : () => start(a.id),
                          startBinary: () => navigate('settings'),
                          clearAttention: cmAttention?.code ? async () => {
                            try {
                              await window.api.accounts.clearAttention({ token, accountId: a.id });
                              clearAttentionLocal(a.id);
                              const r = await window.api.accounts.listForProfile({ token, profileId: modelId });
                              if (r.ok) setAccounts(r.accounts || []);
                            } catch {}
                          } : undefined,
                        }}
                      />
                    )}
                    <span style={{ ...styles.dot, background: STATUS_COLORS[a.status] }} title={a.status} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 500 }}>
                        <span className="mono dim">{plat.usernamePrefix}</span>{a.username}
                        {a.has_password && <span className="mono dim" style={{ fontSize: 11, marginLeft: 8 }}>🔑</span>}
                        <ModeBadge mode={browserMode} title={`Browser: ${modeConfig.label} (model-level)`} style={{ marginLeft: 8 }} />
                        {hasOverride && (
                          <span style={{
                            fontSize: 9,
                            padding: '1px 4px',
                            borderRadius: 'var(--radius-pill)',
                            background: 'rgba(155,89,182,0.2)',
                            color: '#9b59b6',
                            fontWeight: 600,
                            marginLeft: 4,
                          }} title={`Override: ${a.cloak_profile_override}`}>
                            {a.cloak_profile_override}
                          </span>
                        )}
                        {/* Account running status badge */}
                        {a.cloak_actual_name && cloakStatus[a.cloak_actual_name] === 'running' && (
                          <span style={{
                            position: 'relative',
                            marginLeft: 8,
                            background: 'var(--ok)',
                            color: '#0d0c0a',
                            fontSize: 8,
                            padding: '1px 4px',
                            borderRadius: 'var(--radius-pill)',
                            fontWeight: 700
                          }}>
                            RUNNING
                          </span>
                        )}
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            const next = !a.autopilot_skip;
                            try {
                              const setRes = await window.api.accounts.setAutopilotSkip({ token, accountId: a.id, skip: next });
                              if (!setRes.ok) throw new Error(setRes.error);
                              const r = await window.api.accounts.listForProfile({ token, profileId: modelId });
                              if (r.ok) setAccounts(r.accounts || []);
                            } catch (err) {
                              toast('err', err.message || 'Failed to update autopilot skip');
                            }
                          }}
                          title={a.autopilot_skip ? 'Excluded from autopilot' : 'Included in autopilot (when master is running)'}
                          style={{
                            fontSize: 8, padding: '2px 6px', borderRadius: 'var(--radius-pill)',
                            fontFamily: 'monospace', fontWeight: 700,
                            background: a.autopilot_skip ? 'rgba(180,90,90,0.2)' : 'rgba(122,154,90,0.2)',
                            color: a.autopilot_skip ? 'var(--danger-fg)' : 'var(--success-fg)',
                            border: 'none', cursor: 'pointer', marginLeft: 4,
                          }}
                        >{a.autopilot_skip ? 'SKIP' : 'AUTO'}</button>
                        {/* Account launch progress badge */}
                        {a.cloak_actual_name && launchProgress[a.cloak_actual_name] && launchProgress[a.cloak_actual_name].progress < 1 && (
                          <span style={{
                            position: 'relative',
                            marginLeft: 8,
                            background: 'var(--blue)',
                            color: '#fff',
                            fontSize: 8,
                            padding: '1px 4px',
                            borderRadius: 'var(--radius-pill)',
                            fontWeight: 700,
                            animation: 'pulse 1s infinite'
                          }}>
                            {Math.round(launchProgress[a.cloak_actual_name].progress * 100)}%
                          </span>
                        )}
                      </div>
                      {a.notes && <div className="muted" style={{ fontSize: 12 }}>{a.notes}</div>}
                    </div>
                    {a.proxy_label && (
                      <span className="mono dim" style={{ fontSize: 11 }}>
                        via {a.proxy_label}
                      </span>
                    )}
                    <select
                      value={a.status}
                      onChange={(e) => quickStatus(a.id, e.target.value)}
                      style={styles.miniSelect}
                    >
                      {STATUS_OPTIONS.map(s => <option key={s.v} value={s.v}>{s.label}</option>)}
                    </select>
                    {canManage && (
                      <>
                        <button className="ghost" onClick={() => startEdit(a)}>Edit</button>
                        {a.cloak_actual_name && (
                          <button className="ghost" style={{ fontSize: 11, padding: '4px 8px' }} onClick={async () => {
                            toast('info', 'Testing CDP connection…');
                            const r = await window.api.cloakmanager.testCDPConnection({ token, accountId: a.id });
                            if (r.ok) toast('ok', r.message || 'CDP connection OK');
                            else toast('err', r.error || 'CDP test failed');
                          }}>Test CDP</button>
                        )}
                        <button className="danger" onClick={() => del(a.id)}>Remove</button>
                      </>
                    )}
                  </div>
                  {/* Same-platform conflict warning */}
                  {hasConflict && !hasOverride && (
                    <div style={{
                      marginLeft: 38,
                      padding: '8px 12px',
                      background: 'rgba(180,90,90,0.08)',
                      border: '1px solid rgba(180,90,90,0.2)',
                      borderRadius: 'var(--radius)',
                      fontSize: 11,
                      color: 'var(--text-2)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                    }}>
                      <span style={{ fontSize: 14 }}>⚠️</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, marginBottom: 2 }}>Same-platform conflict</div>
                        <div>
                          This account shares a platform ({plat.label}) with {samePlatformAccounts.length} other account{samePlatformAccounts.length > 1 ? 's' : ''} on this model.
                          Sharing a CM browser instance means cookies overlap — only one {plat.label} account can be logged in at a time.
                        </div>
                      </div>
                      <button
                        className="primary"
                        style={{ fontSize: 11, padding: '4px 10px', whiteSpace: 'nowrap' }}
                        onClick={async () => {
                          const overrideName = sanitizeForCmName(`model-${modelId}-${model.name}-${a.platform}${a.id}`);
                          const r = await window.api.accounts.setCloakOverride({ token, accountId: a.id, overrideName });
                          if (r.ok) {
                            // Create the CM profile for the override
                            setOperationMessage(`Creating CM instance "${overrideName}"...`);
                            try {
                              const cr = await window.api.cloakmanager.createProfile({
                                token, accountId: a.id, accountConfig: { os: 'windows' },
                              });
                              if (cr.ok) setOperationMessage(`Instance "${overrideName}" created`);
                              else setOperationMessage(`Failed: ${friendlyCmError(cr.error)}`);
                            } catch (err) {
                              setOperationMessage(`Error: ${friendlyCmError(err.message)}`);
                            }
                            setTimeout(() => setOperationMessage(null), 4000);
                            await load();
                          }
                        }}
                      >
                        Create separate instance
                      </button>
                      <button
                        className="ghost"
                        style={{ fontSize: 11, padding: '4px 10px' }}
                        onClick={async () => {
                          // Just dismiss — keep shared
                          toast('info', 'Keeping shared instance. You can create a separate instance later from Edit.');
                        }}
                      >
                        Keep shared
                      </button>
                    </div>
                  )}
                  {hasConflict && hasOverride && (
                    <div style={{
                      marginLeft: 38,
                      padding: '6px 12px',
                      background: 'rgba(155,89,182,0.08)',
                      border: '1px solid rgba(155,89,182,0.2)',
                      borderRadius: 'var(--radius)',
                      fontSize: 11,
                      color: 'var(--text-2)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}>
                      <span>👻</span>
                      <span>Separate CM instance: <span className="mono" style={{ color: '#9b59b6' }}>{a.cloak_profile_override}</span></span>
                      <button
                        className="ghost"
                        style={{ fontSize: 10, padding: '2px 8px', marginLeft: 'auto' }}
                        onClick={async () => {
                          const r = await window.api.accounts.setCloakOverride({ token, accountId: a.id, overrideName: null });
                          if (r.ok) await load();
                        }}
                      >
                        Revert to shared
                      </button>
                    </div>
                  )}
                    </React.Fragment>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {(showAddPlatform || editing) && (() => {
        const modalPlat = PLATFORMS.find(p => p.v === (editing ? editing.platform : showAddPlatform)) || PLATFORMS[0];
        const isCmMode = (model.browser_mode || 'electron') === 'cloakmanager';
        return (
          <div className="modal-overlay" onClick={cancel}>
          <form onSubmit={submit} onClick={(e) => e.stopPropagation()} style={{
            width: 560, maxHeight: '90vh', overflowY: 'auto',
            background: 'var(--bg-elev)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)',
            borderTop: `3px solid ${modalPlat.color}`,
            padding: 22,
          }} className="modal-card">
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: modalPlat.color, marginRight: 8, flexShrink: 0 }} />
              <h3 style={{ margin: 0, flex: 1 }}>
                {editing ? `Edit ${modalPlat.label} account` : 'Add account'}
              </h3>
              <button type="button" onClick={cancel} style={{
                width: 26, height: 26, borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border)', background: 'var(--bg-2)',
                color: 'var(--text-2)', cursor: 'pointer', display: 'grid',
                placeItems: 'center', fontSize: 13, padding: 0,
              }}>×</button>
            </div>
            {error && <div className="error-banner">{error}</div>}
            {operationMessage && (
              <Banner kind={operationMessage.startsWith('Failed') || operationMessage.startsWith('Error') ? 'err' : 'ok'}>
                {operationMessage}
              </Banner>
            )}

            {/* ── Platform ── */}
            {!editing && (
              <>
                <SectionLabel color={modalPlat.color}>Website</SectionLabel>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 18 }}>
                  {PLATFORMS.map((p) => {
                    const active = p.v === modalPlat.v;
                    return (
                      <button
                        key={p.v}
                        type="button"
                        onClick={() => setShowAddPlatform(p.v)}
                        style={{
                          background: active ? p.color : 'var(--bg-1)',
                          color: active ? '#fff' : 'var(--text-1)',
                          borderWidth: 1, borderStyle: 'solid',
                          borderColor: active ? p.color : 'var(--border)',
                          borderRadius: 'var(--radius-pill)', padding: '5px 14px', fontSize: 12, fontWeight: 600,
                          cursor: 'pointer',
                          display: 'inline-flex', alignItems: 'center', gap: 6,
                        }}
                      >
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: p.color }} />
                        {p.label}
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {/* ── Credentials ── */}
            <SectionLabel color={modalPlat.color}>Credentials</SectionLabel>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 18 }}>
              <div>
                <label>{modalPlat.label} username</label>
                <input
                  value={form.username}
                  disabled={!!editing}
                  onChange={(e) => setForm({ ...form, username: e.target.value })}
                  placeholder={modalPlat.v === 'reddit' ? 'e.g. throwaway_redhead' : 'e.g. luna_creator'}
                />
              </div>
              <div>
                <label>Password {editing && <span className="dim mono" style={{textTransform:'none',letterSpacing:0,fontSize:'var(--text-xs)'}}>(leave blank to keep)</span>}</label>
                <div style={{ display: 'flex', gap: 4 }}>
                  <input
                    type={showPasswords ? 'text' : 'password'}
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    style={{ flex: 1 }}
                  />
                  <button type="button" onClick={() => setShowPasswords(v => !v)} style={{
                    width: 34, height: 34, borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border)', background: 'var(--bg-2)',
                    color: 'var(--text-2)', cursor: 'pointer', display: 'grid',
                    placeItems: 'center', fontSize: 12, padding: 0, flexShrink: 0,
                  }} title={showPasswords ? 'Hide password' : 'Show password'}>
                    {showPasswords ? '🙈' : '👁'}
                  </button>
                </div>
              </div>
              <div>
                <label>Linked email (optional)</label>
                <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div>
                <label>Email password (optional)</label>
                <input type={showPasswords ? 'text' : 'password'} value={form.emailPassword} onChange={(e) => setForm({ ...form, emailPassword: e.target.value })} />
              </div>
            </div>

            {/* ── Configuration ── */}
            <SectionLabel color={modalPlat.color}>Configuration</SectionLabel>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 18 }}>
              <div>
                <label>Status</label>
                <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                  {STATUS_OPTIONS.map(s => <option key={s.v} value={s.v}>{s.label}</option>)}
                </select>
              </div>
              <div>
                <label>Proxy</label>
                {isCmMode && !editing?.cloak_profile_override ? (
                  <div className="muted" style={{ fontSize: 12, paddingTop: 6 }}>
                    👻 Shared model proxy (set above) — this account uses CloakManager's one instance.
                  </div>
                ) : (
                  <select value={form.proxy_id} onChange={(e) => setForm({ ...form, proxy_id: e.target.value })}>
                    <option value="">— no proxy —</option>
                    {proxies.map(p => <option key={p.id} value={p.id}>{p.label} ({p.kind} {p.host}:{p.port})</option>)}
                  </select>
                )}
              </div>
            </div>

            {/* ── Device ── */}
            {isCmMode ? (
              <div style={{ marginBottom: 18, padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--bg-1)', fontSize: 12, color: 'var(--text-2)' }}>
                <span style={{ marginRight: 6 }}>👻</span>
                This model uses CloakManager — fingerprint is one shared identity for the whole model (set in Browser mode above), not per account.
              </div>
            ) : (
              <>
                <SectionLabel color={modalPlat.color}>Device fingerprint</SectionLabel>
                <div style={{ marginBottom: 18 }}>
                  <ToggleGroup
                    options={[
                      { v: 'desktop', label: 'Desktop', hint: 'Windows / macOS UA, 1920×1080 screen, no touch' },
                      { v: 'android', label: 'Android', hint: 'Pixel / Galaxy UA, 412×915 screen, touch enabled' },
                      { v: 'ios',     label: 'iPhone',  hint: 'Mobile Safari UA, iPhone screen — pair with jailbroken-phone proxies' },
                    ]}
                    value={form.os_profile}
                    onChange={(v) => setForm({ ...form, os_profile: v })}
                  />
                  <div className="muted" style={{ fontSize: 'var(--text-xs)', marginTop: 6 }}>
                    Match to your proxy: residential mobile IPs → Android/iPhone, datacenter → Desktop
                  </div>
                </div>
              </>
            )}

            <div style={{ marginBottom: 14 }}>
              <label>Notes</label>
              <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" className="primary">{editing ? 'Save changes' : 'Add account'}</button>
              <button type="button" className="ghost" onClick={cancel}>Cancel</button>
            </div>
          </form>
          </div>
        );
      })()}

      {tab === 'resources' && (
      <div style={{ marginBottom: 28 }}>
        <div style={styles.platformHeader}>
          <span style={{ fontSize: 20 }}>⌁</span>
          <h2>Proxies</h2>
          <span className="mono dim" style={{ fontSize: 12 }}>
            {modelProxies.length} in use{proxies.length > modelProxies.length ? ` · ${proxies.length - modelProxies.length} available` : ''}
          </span>
          <div style={{ flex: 1 }} />
          {canManage && (
            <button className="primary" onClick={() => setShowAddProxy(v => !v)}>
              {showAddProxy ? 'Cancel' : '+ Add proxy'}
            </button>
          )}
        </div>

        {showAddProxy && (
          <form onSubmit={addProxy} className="card" style={{ marginBottom: 14 }}>
            <h3 style={{ marginBottom: 14 }}>New proxy</h3>
            {proxyError && <div className="error-banner">{proxyError}</div>}
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 2fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <label>Label</label>
                <input value={proxyForm.label} onChange={(e) => setProxyForm({ ...proxyForm, label: e.target.value })} placeholder="e.g. Mobile 1" />
              </div>
              <div>
                <label>Kind</label>
                <select value={proxyForm.kind} onChange={(e) => setProxyForm({ ...proxyForm, kind: e.target.value })}>
                  <option value="http">HTTP</option>
                  <option value="https">HTTPS</option>
                  <option value="socks5">SOCKS5</option>
                </select>
              </div>
              <div>
                <label>Host</label>
                <input value={proxyForm.host} onChange={(e) => setProxyForm({ ...proxyForm, host: e.target.value })} placeholder="proxy.example.com" />
              </div>
              <div>
                <label>Port</label>
                <input type="number" value={proxyForm.port} onChange={(e) => setProxyForm({ ...proxyForm, port: e.target.value })} placeholder="1080" />
              </div>
              <div>
                <label>Username</label>
                <input value={proxyForm.username} onChange={(e) => setProxyForm({ ...proxyForm, username: e.target.value })} placeholder="optional" />
              </div>
              <div style={{ gridColumn: 'span 3' }}>
                <label>Password</label>
                <input type="text" value={proxyForm.password} onChange={(e) => setProxyForm({ ...proxyForm, password: e.target.value })} placeholder="optional" />
              </div>
            </div>
            <button type="submit" className="primary">Save proxy</button>
          </form>
        )}

        {modelProxies.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', border: '1px dashed var(--border)', borderRadius: 'var(--radius-lg)', background: 'var(--bg-1)', fontSize: 13, color: 'var(--text-3)' }}>
            No proxies in use by this model's accounts.
            {canManage && proxies.length > 0 && (
              <span> Open an account above to assign one.</span>
            )}
            {canManage && proxies.length === 0 && (
              <div style={{ marginTop: 10 }}>
                <button className="primary" onClick={() => setShowAddProxy(true)}>+ Add proxy</button>
              </div>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {modelProxies.map(p => (
              <div key={p.id} style={styles.accountRow}>
                <div style={{ ...styles.dot, background: 'var(--green-bright)' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>
                    {p.label}
                    {p.has_password && <span className="mono dim" style={{ fontSize: 11, marginLeft: 8 }}>🔑</span>}
                  </div>
                  <div className="muted mono" style={{ fontSize: 12 }}>
                    {p.kind} · {p.host}:{p.port}
                    {p.username && ` · ${p.username}`}
                  </div>
                </div>
                <span className="mono dim" style={{ fontSize: 11 }}>
                  {proxyUsageCount(p.id)} account{proxyUsageCount(p.id) === 1 ? '' : 's'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      )}

      {tab === 'inbox' && (
        <div style={{ marginBottom: 28 }}>
          <div className="card bordered-glow">
            <h3 style={{ marginBottom: 6 }}>Inbox for {model.name}</h3>
            <div className="muted" style={{ fontSize: 13, lineHeight: 1.7 }}>
              Per-account Reddit DM and modmail viewer goes here. Needs Reddit OAuth
              connected on each account — one-click <strong>Connect to Reddit</strong>
              button shipping next release. Until then, use the Reddit browser ▶ button
              up top to open the inbox manually.
            </div>
          </div>
        </div>
      )}

      {tab === 'analytics' && (
        <ModelAnalyticsTab token={token} profileId={Number(modelId)} accounts={accounts} activeTeamId={activeTeamId} />
      )}

      {tab === 'activity' && canViewActivity && activityEntries.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <div style={styles.platformHeader}>
            <span style={{ fontSize: 20 }}>☷</span>
            <h2>Recent activity</h2>
            <div style={{ flex: 1 }} />
            <button className="ghost" onClick={() => navigate('activity')}>Full log →</button>
          </div>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {activityEntries.slice(0, 6).map((e, i) => (
              <div key={e.id} style={{
                padding: '10px 14px',
                borderTop: i === 0 ? 'none' : '1px solid var(--border)',
                display: 'flex', alignItems: 'center', gap: 10, fontSize: 13,
              }}>
                <span className="mono dim" style={{ fontSize: 11, minWidth: 130 }}>
                  {new Date(e.created_at + 'Z').toLocaleString()}
                </span>
                <span style={{ minWidth: 90 }}>{e.username || <span className="dim">system</span>}</span>
                <span className="mono" style={{ fontSize: 11, color: 'var(--gold-bright)' }}>{e.action}</span>
                <span className="muted" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {e.detail}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'promo' && (
      <div style={{ marginBottom: 28 }}>
        <div style={styles.platformHeader}>
          <span style={{ fontSize: 20 }}>🎯</span>
          <h2>NSFW promo subreddits</h2>
          <span className="mono dim" style={{ fontSize: 12 }}>{promoSubs.length} configured</span>
        </div>

        <div className="card" style={{ marginBottom: 14 }}>
          <div className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
            When this model's accounts are in <strong>ready</strong> status, the AI composer pulls from this list for NSFW promo post suggestions.
          </div>
          <form onSubmit={addPromoSub} style={{ display: 'flex', gap: 8 }}>
            <input
              placeholder="Add a subreddit (e.g. gonewild, RealGirls)"
              value={newPromoSub}
              onChange={(e) => setNewPromoSub(e.target.value)}
              style={{ flex: 1 }}
            />
            <button type="submit" className="primary">Add</button>
          </form>
          {promoSubError && <div className="error-banner" style={{ marginTop: 10 }}>{promoSubError}</div>}
        </div>

        {promoSubs.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', border: '1px dashed var(--border)', borderRadius: 'var(--radius-lg)', background: 'var(--bg-1)', fontSize: 13, color: 'var(--text-3)' }}>
            No promo subreddits configured for this model yet.
          </div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {promoSubs.map(s => (
              <div key={s.id} style={styles.subChip}>
                <span className="mono">r/{s.name}</span>
                <button
                  onClick={() => delPromoSub(s.id)}
                  style={styles.subChipClose}
                  title="Remove"
                >×</button>
              </div>
            ))}
          </div>
        )}
      </div>
    )}
    {showScriptsPanel && <LaunchScriptsPanel
      profileId={Number(modelId)}
      modelName={model.name}
      onClose={() => setShowScriptsPanel(false)}
    />}
    </div>
  );
}

function ModelAnalyticsTab({ token, profileId, accounts, activeTeamId }) {
  const [data, setData] = React.useState(null);
  React.useEffect(() => {
    let alive = true;
    window.api.analytics.summary({ token, profileId, teamId: activeTeamId }).then(r => {
      if (alive && r.ok) setData(r);
    });
    return () => { alive = false; };
  }, [token, profileId, activeTeamId]);

  if (!data) return (
    <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-3)', fontSize: 12 }}>
      <div style={{
        width: 20, height: 20, borderRadius: '50%',
        border: '2px solid var(--border-strong)',
        borderTopColor: 'var(--gold)',
        animation: 'spinner-rotate 0.7s linear infinite',
        margin: '0 auto 8px',
      }} />
      Loading analytics…
    </div>
  );

  const reddit = data.accounts.filter(a => a.platform === 'reddit');
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 18 }}>
        <div className="card" style={{ padding: '12px 14px' }}>
          <div className="muted" style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase' }}>Accounts</div>
          <div style={{ fontSize: 22, fontFamily: 'var(--font-display)', marginTop: 2 }}>{data.totals.accounts}</div>
        </div>
        <div className="card" style={{ padding: '12px 14px' }}>
          <div className="muted" style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase' }}>Ready</div>
          <div style={{ fontSize: 22, fontFamily: 'var(--font-display)', color: 'var(--green-bright)', marginTop: 2 }}>{data.totals.ready}</div>
        </div>
        <div className="card" style={{ padding: '12px 14px' }}>
          <div className="muted" style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase' }}>Warming</div>
          <div style={{ fontSize: 22, fontFamily: 'var(--font-display)', color: 'var(--gold)', marginTop: 2 }}>{data.totals.warming}</div>
        </div>
        <div className="card" style={{ padding: '12px 14px' }}>
          <div className="muted" style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase' }}>Total karma</div>
          <div style={{ fontSize: 22, fontFamily: 'var(--font-display)', color: 'var(--gold-bright)', marginTop: 2 }}>{data.totals.total_karma.toLocaleString()}</div>
        </div>
      </div>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
          <h3>Per-account karma</h3>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            Manual snapshots for now. Open <strong>Analytics</strong> in the sidebar to record new ones.
          </div>
        </div>
        {reddit.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-3)', fontSize: 12, borderTop: '1px solid var(--border)' }}>
            No Reddit accounts linked.
          </div>
        ) : (
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase' }}>
                <th style={{ padding: '10px 14px', fontWeight: 500 }}>Account</th>
                <th style={{ padding: '10px 14px', fontWeight: 500 }}>Post karma</th>
                <th style={{ padding: '10px 14px', fontWeight: 500 }}>Comment karma</th>
                <th style={{ padding: '10px 14px', fontWeight: 500 }}>Scheduled</th>
              </tr>
            </thead>
            <tbody>
              {reddit.map(a => (
                <tr key={a.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '8px 14px' }} className="mono">{platformUsernamePrefix(a.platform)}{a.username}</td>
                  <td style={{ padding: '8px 14px' }}>{a.post_karma == null ? <span className="dim">—</span> : a.post_karma.toLocaleString()}</td>
                  <td style={{ padding: '8px 14px' }}>{a.comment_karma == null ? <span className="dim">—</span> : a.comment_karma.toLocaleString()}</td>
                  <td style={{ padding: '8px 14px' }}>{a.scheduled_pending}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function ModeBadge({ mode, title, style }) {
  const modeConfig = BROWSER_MODES[mode] || BROWSER_MODES.electron;
  return (
    <span style={{
      color: modeConfig.color,
      fontSize: 10,
      fontWeight: 600,
      display: 'inline-flex',
      alignItems: 'center',
      gap: 3,
      ...style,
    }} title={title || `Browser mode: ${modeConfig.label}`}>
      {modeConfig.icon} {modeConfig.label}
    </span>
  );
}

function SectionLabel({ color, children }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      marginBottom: 12, marginTop: 4,
    }}>
      <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
      <span style={{
        fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)',
        fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase',
        color: color || 'var(--text-3)',
      }}>{children}</span>
      <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
    </div>
  );
}

function ToggleGroup({ options, value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 4, background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 3 }}>
      {options.map((o) => {
        const active = value === o.v;
        return (
          <button
            key={o.v}
            type="button"
            onClick={() => onChange(o.v)}
            title={o.hint}
            style={{
              flex: 1, padding: '6px 10px',
              background: active ? 'var(--gold-soft)' : 'transparent',
              color: active ? 'var(--gold-bright)' : 'var(--text-2)',
              borderWidth: 1, borderStyle: 'solid',
              borderColor: active ? 'var(--gold)' : 'transparent',
              borderRadius: 'var(--radius-sm)', cursor: 'pointer',
              fontWeight: active ? 600 : 400, fontSize: 'var(--text-sm)',
            }}
          >{o.label}</button>
        );
      })}
    </div>
  );
}

const tabBarStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  borderBottom: '1px solid var(--border)',
  marginBottom: 18,
  paddingBottom: 8,
  position: 'relative',
};

const tabStyle = {
  background: 'transparent',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'transparent',
  borderBottomColor: 'transparent',
  color: 'var(--text-2)',
  padding: '8px 14px',
  borderRadius: '6px 6px 0 0',
  marginBottom: -9,
  fontSize: 13,
  cursor: 'pointer',
};

const tabActiveStyle = {
  background: 'var(--bg-elev)',
  borderColor: 'var(--border)',
  borderBottomColor: 'var(--bg-elev)',
  color: 'var(--gold-bright)',
};

const addMenuStyle = {
  position: 'absolute',
  right: 0,
  top: 'calc(100% + 6px)',
  zIndex: 10,
  background: 'var(--bg-elev)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  boxShadow: '0 6px 22px rgba(0,0,0,0.5)',
  minWidth: 200,
  padding: 4,
};

const addMenuItemStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  width: '100%',
  background: 'transparent',
  border: 'none',
  padding: '10px 12px',
  textAlign: 'left',
  fontSize: 13,
  color: 'var(--text-0)',
  cursor: 'pointer',
  borderRadius: 'var(--radius-sm)',
};

const playBtnStyle = {
  background: 'var(--gradient-brand)',
  color: 'var(--bg-0)',
  border: '1px solid var(--gold)',
  borderRadius: 'var(--radius-pill)',
  padding: '8px 14px',
  fontSize: 13,
  fontWeight: 700,
  cursor: 'pointer',
  boxShadow: '0 2px 10px rgba(212,166,74,0.3)',
};

const styles = {
  platformHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
    paddingBottom: 8,
    borderBottom: '1px solid var(--border)',
  },
  accountRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 12px 8px 8px',
    background: 'var(--bg-elev)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
  },
  startBtn: {
    height: 36,
    padding: '0 14px',
    borderRadius: 'var(--radius-pill)',
    fontSize: 12,
    fontWeight: 700,
    whiteSpace: 'nowrap',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  dot: { width: 10, height: 10, borderRadius: '50%', flexShrink: 0 },
  miniSelect: { width: 'auto', padding: '5px 8px', fontSize: 12 },
  subChip: {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '6px 4px 6px 12px',
    background: 'var(--bg-elev)', border: '1px solid var(--border)',
    borderRadius: 'var(--radius-pill)', fontSize: 12,
  },
  subChipClose: {
    width: 22, height: 22, padding: 0, fontSize: 14, lineHeight: 1,
    background: 'transparent', border: 'none', color: 'var(--text-3)',
    borderRadius: '50%',
  },
};
