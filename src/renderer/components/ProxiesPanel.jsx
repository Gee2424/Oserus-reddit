import React, { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';
import { useCan } from '../lib/permissions.jsx';
import { useToast } from '../lib/toast.jsx';
import { useConfirm } from '../lib/confirm.jsx';

const PROXY_KINDS = [
  { v: 'http',   label: 'HTTP' },
  { v: 'https',  label: 'HTTPS' },
  { v: 'socks5', label: 'SOCKS5' },
  { v: 'socks4', label: 'SOCKS4' },
];

function blankProxy() {
  return {
    label: '', kind: 'http', host: '', port: '',
    username: '', password: '',
    rotation_minutes: 0,
    session_user_template: '',
    rotation_url: '',
  };
}

// Parse the common proxy-URL formats residential providers hand out.
// Accepts (case-insensitive):
//   scheme://host:port:user:pass     (fxdx, IPRoyal, SOAX, BrightData)
//   scheme://user:pass@host:port     (RFC URL form)
//   host:port:user:pass              (no scheme — defaults to http)
//   host:port                        (no auth)
// Returns a partial form patch or { error }.
function parseProxyUrl(raw) {
  if (!raw) return { error: 'Empty' };
  let s = String(raw).trim();
  let kind = null;
  const schemeMatch = s.match(/^([a-z0-9+]+):\/\//i);
  if (schemeMatch) {
    const k = schemeMatch[1].toLowerCase();
    if (k === 'socks5' || k === 'socks' || k === 'socks5h') kind = 'socks5';
    else if (k === 'socks4' || k === 'socks4a')             kind = 'socks4';
    else if (k === 'https')                                  kind = 'https';
    else if (k === 'http')                                   kind = 'http';
    else return { error: `Unsupported scheme: ${k}` };
    s = s.slice(schemeMatch[0].length);
  }
  // user:pass@host:port form
  if (s.includes('@')) {
    const at = s.lastIndexOf('@');
    const auth = s.slice(0, at);
    const hp = s.slice(at + 1);
    const [u, p] = splitOnce(auth, ':');
    const [h, port] = splitOnce(hp, ':');
    if (!h || !port) return { error: 'Could not find host:port' };
    return { kind: kind || 'http', host: h, port: port.replace(/\/.*$/, ''), username: u || '', password: p || '' };
  }
  // host:port[:user:pass] form
  const parts = s.split(':');
  if (parts.length < 2) return { error: 'Need at least host:port' };
  const host = parts[0];
  const port = parts[1];
  let username = '', password = '';
  if (parts.length >= 4) {
    username = parts[2];
    // Password may itself contain ':' — rejoin the tail.
    password = parts.slice(3).join(':');
  } else if (parts.length === 3) {
    // Ambiguous — treat the 3rd token as username with empty password.
    username = parts[2];
  }
  return { kind: kind || 'http', host, port: port.replace(/\/.*$/, ''), username, password };
}
function splitOnce(s, sep) {
  const i = s.indexOf(sep);
  if (i < 0) return [s, ''];
  return [s.slice(0, i), s.slice(i + 1)];
}

// Proxy management. Reused on the Operations page.
export default function ProxiesPanel() {
  const { token, activeTeamId } = useAuth();
  const can = useCan();
  const canManage = can('infra.proxies.manage');
  const { toast } = useToast();
  const { confirm } = useConfirm();
  const [proxies, setProxies] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blankProxy());
  const [error, setError] = useState(null);
  const [pasteUrl, setPasteUrl] = useState('');
  const [pasteMsg, setPasteMsg] = useState(null);

  function applyPaste() {
    setPasteMsg(null);
    const parsed = parseProxyUrl(pasteUrl);
    if (parsed.error) { setPasteMsg({ kind: 'err', text: parsed.error }); return; }
    setForm((f) => ({
      ...f,
      kind: parsed.kind || f.kind,
      host: parsed.host || f.host,
      port: parsed.port || f.port,
      username: parsed.username ?? f.username,
      password: parsed.password ?? f.password,
      label: f.label || `${parsed.host}:${parsed.port}`,
    }));
    setPasteMsg({ kind: 'ok', text: `Parsed → ${parsed.kind} ${parsed.host}:${parsed.port}${parsed.username ? ` (auth: ${parsed.username})` : ''}` });
  }

  async function load() {
    const res = await window.api.proxies.list({ token, teamId: activeTeamId });
    if (res.ok) setProxies(res.proxies);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [token]);

  async function submit(e) {
    e.preventDefault();
    setError(null);
    if (!form.label || !form.host || !form.port) {
      setError('Label, host, and port are required');
      return;
    }
    let res;
    if (editing) {
      const updates = {
        label: form.label, kind: form.kind, host: form.host, port: Number(form.port),
        username: form.username || null,
        rotation_minutes: Math.max(0, Number(form.rotation_minutes) || 0),
        session_user_template: form.session_user_template || null,
        rotation_url: form.rotation_url || null,
      };
      if (form.password) updates.password = form.password;
      res = await window.api.proxies.update({ token, proxyId: editing, updates });
    } else {
      res = await window.api.proxies.create({
        token, label: form.label, kind: form.kind, host: form.host, port: form.port,
        username: form.username, password: form.password,
        rotation_minutes: Math.max(0, Number(form.rotation_minutes) || 0),
        session_user_template: form.session_user_template || null,
        rotation_url: form.rotation_url || null,
        teamId: activeTeamId,
      });
    }
    if (!res.ok) { setError(res.error); return; }
    setShowAdd(false); setEditing(null); setForm(blankProxy()); load();
  }

  function startEdit(p) {
    setEditing(p.id);
    setForm({
      label: p.label, kind: p.kind, host: p.host, port: p.port,
      username: p.username || '', password: '',
      rotation_minutes: p.rotation_minutes || 0,
      session_user_template: p.session_user_template || '',
      rotation_url: p.rotation_url || '',
    });
    setShowAdd(true);
  }

  async function del(id) {
    const ok = await confirm('Delete this proxy? Any account using it will fall back to no proxy.', { confirmLabel: 'Delete', variant: 'danger' });
    if (!ok) return;
    await window.api.proxies.delete({ token, proxyId: id });
    load();
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: 18, padding: 14, display: 'flex', alignItems: 'center', gap: 14 }}>
        <div className="muted" style={{ fontSize: 13, lineHeight: 1.6, flex: 1 }}>
          Proxies are assigned per account. Each account routes its browsing and posting through its assigned proxy.
          Supported types: HTTP, HTTPS, SOCKS5.
        </div>
        {canManage && (
          <button className="primary" onClick={() => { setEditing(null); setForm(blankProxy()); setShowAdd(v => !v); }}>
            {showAdd ? 'Cancel' : '+ Add proxy'}
          </button>
        )}
      </div>

      {showAdd && canManage && (
        <form onSubmit={submit} className="card" style={{ marginBottom: 22 }}>
          <h3 style={{ marginBottom: 14 }}>{editing ? 'Edit proxy' : 'Add proxy'}</h3>
          {error && <div className="error-banner">{error}</div>}

          {/* Paste a proxy URL — auto-fills host / port / user / pass.
              Accepts every common residential format: socks5://host:port:user:pass,
              user:pass@host:port, bare host:port, etc. */}
          <div style={{ marginBottom: 14, padding: 12, borderRadius: 6, background: 'var(--bg-elev)', border: '1px solid var(--border)' }}>
            <label>Paste a proxy URL <span className="dim" style={{ textTransform: 'none', letterSpacing: 0, fontSize: 11 }}>(socks5://host:port:user:pass, user:pass@host:port, or host:port)</span></label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                placeholder="socks5://zxlycpht4j.cn.fxdx.in:13916:user:pass"
                value={pasteUrl}
                onChange={(e) => setPasteUrl(e.target.value)}
                onPaste={(e) => {
                  // If a full URL is pasted, parse + apply on the next tick.
                  const v = e.clipboardData?.getData('text');
                  if (v && /:/.test(v)) {
                    setPasteUrl(v);
                    setTimeout(() => {
                      const parsed = parseProxyUrl(v);
                      if (!parsed.error) {
                        setForm((f) => ({
                          ...f,
                          kind: parsed.kind || f.kind,
                          host: parsed.host, port: parsed.port,
                          username: parsed.username ?? f.username,
                          password: parsed.password ?? f.password,
                          label: f.label || `${parsed.host}:${parsed.port}`,
                        }));
                        setPasteMsg({ kind: 'ok', text: `Parsed → ${parsed.kind} ${parsed.host}:${parsed.port}${parsed.username ? ` (auth: ${parsed.username})` : ''}` });
                      } else setPasteMsg({ kind: 'err', text: parsed.error });
                    }, 0);
                    e.preventDefault();
                  }
                }}
                className="mono"
                style={{ flex: 1 }}
              />
              <button type="button" onClick={applyPaste} disabled={!pasteUrl}>Parse</button>
            </div>
            {pasteMsg && (
              <div className="dim" style={{
                fontSize: 11, marginTop: 6,
                color: pasteMsg.kind === 'err' ? 'var(--danger)' : 'var(--ok)',
              }}>{pasteMsg.text}</div>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14, marginBottom: 14 }}>
            <div>
              <label>Label</label>
              <input placeholder="e.g. NYC residential 1" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
            </div>
            <div>
              <label>Type</label>
              <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                {PROXY_KINDS.map(k => <option key={k.v} value={k.v}>{k.label}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14, marginBottom: 14 }}>
            <div>
              <label>Host</label>
              <input placeholder="e.g. proxy.example.com" value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} />
            </div>
            <div>
              <label>Port</label>
              <input type="number" value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
            <div>
              <label>Username (optional)</label>
              <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
            </div>
            <div>
              <label>Password {editing && <span className="dim mono" style={{textTransform:'none',letterSpacing:0,fontSize:10}}>(leave blank to keep)</span>}</label>
              <input type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 14, marginBottom: 14 }}>
            <div>
              <label>Rotation TTL (minutes)</label>
              <input
                type="number" min={0}
                placeholder="0 = sticky"
                value={form.rotation_minutes}
                onChange={(e) => setForm({ ...form, rotation_minutes: e.target.value })}
              />
              <div className="dim" style={{ fontSize: 11, marginTop: 4 }}>
                0 = no rotation. Anything &gt; 0 rotates exit IP every N minutes (residential providers).
              </div>
            </div>
            <div>
              <label>Sticky-session username template (optional)</label>
              <input
                placeholder="{user}-session-{sid}"
                value={form.session_user_template}
                onChange={(e) => setForm({ ...form, session_user_template: e.target.value })}
              />
              <div className="dim" style={{ fontSize: 11, marginTop: 4 }}>
                Use <code>{'{user}'}</code> and <code>{'{sid}'}</code>. Defaults to <code>{'{user}-session-{sid}'}</code> (IPRoyal / SOAX). BrightData: <code>{'{user}-sessid-{sid}'}</code>.
              </div>
            </div>
          </div>
          <div style={{ marginBottom: 14 }}>
            <label>Rotation URL <span className="dim" style={{ textTransform: 'none', letterSpacing: 0, fontSize: 11 }}>(optional — provider endpoint that rotates the exit IP on GET, e.g. fxdx changeip link)</span></label>
            <input
              placeholder="https://i.fxdx.in/actionlinks/do/changeip/…"
              value={form.rotation_url}
              onChange={(e) => setForm({ ...form, rotation_url: e.target.value })}
              className="mono"
            />
            <div className="dim" style={{ fontSize: 11, marginTop: 4 }}>
              When set, the Proxies table shows a Rotate button that hits this URL to flip the exit IP on demand. Independent from the rotation TTL above (which controls per-account sticky-session ID flips).
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" className="primary">{editing ? 'Save changes' : 'Add proxy'}</button>
            <button type="button" className="ghost" onClick={() => { setShowAdd(false); setEditing(null); }}>Cancel</button>
          </div>
        </form>
      )}

      {proxies.length === 0 ? (
        <div style={{ padding: 24, textAlign: 'center', border: '1px dashed var(--border)', borderRadius: 'var(--radius-lg)', background: 'var(--bg-1)', fontSize: 12, color: 'var(--text-3)' }}>
          No proxies configured yet.
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--bg-1)' }}>
                <th style={th}>Label</th>
                <th style={th}>Type</th>
                <th style={th}>Address</th>
                <th style={th}>Auth</th>
                <th style={th}>Rotation</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {proxies.map(p => (
                <tr key={p.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={td}>{p.label}</td>
                  <td style={td}><span className="pill">{p.kind}</span></td>
                  <td style={td}><span className="mono">{p.host}:{p.port}</span></td>
                  <td style={td}>{p.username ? <span className="mono">{p.username}</span> : <span className="dim">none</span>}</td>
                  <td style={td}>
                    {p.rotation_minutes > 0
                      ? <span className="pill" style={{ background: 'rgba(122,154,90,0.18)' }}>{p.rotation_minutes}m</span>
                      : <span className="dim">sticky</span>}
                  </td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    {canManage && (
                      <>
                        {p.rotation_url && (
                          <button
                            className="ghost"
                            title="Hit the provider's change-IP endpoint to rotate the exit IP now"
                            onClick={async () => {
                              const r = await window.api.proxies.rotate({ token, proxyId: p.id });
                              if (!r.ok) { toast('err', 'Rotate failed: ' + r.error); return; }
                              if (!r.result?.ok) { toast('err', 'Provider returned ' + (r.result?.status || r.result?.error)); return; }
                              toast('ok', 'Rotated. Status ' + r.result.status);
                            }}
                          >Rotate</button>
                        )}
                        <button className="ghost" onClick={() => startEdit(p)} style={{ marginLeft: 6 }}>Edit</button>
                        <button className="danger" onClick={() => del(p.id)} style={{ marginLeft: 6 }}>Delete</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const th = { textAlign: 'left', padding: '10px 14px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-3)', fontWeight: 500 };
const td = { padding: '10px 14px' };
