import React, { useEffect, useState, useCallback } from "react";
import { useAuth } from "../lib/auth.jsx";
import { useActiveAccount } from "../lib/activeAccount.jsx";

const STATUS_OPTIONS = [
  { v: "warming", label: "Warming up" },
  { v: "ready", label: "Ready" },
  { v: "paused", label: "Paused" },
  { v: "banned", label: "Banned" },
];

const STATUS_META = {
  warming: {
    color: "#c89a3a",
    bg: "rgba(200,154,58,.12)",
    label: "Warming up",
  },
  ready: { color: "#4a9b6a", bg: "rgba(74,155,106,.12)", label: "Ready" },
  paused: { color: "#888", bg: "rgba(136,136,136,.1)", label: "Paused" },
  banned: { color: "#c94040", bg: "rgba(201,64,64,.12)", label: "Banned" },
};

function blankForm() {
  return {
    profile_id: "",
    platform: "reddit",
    username: "",
    password: "",
    email: "",
    emailPassword: "",
    status: "warming",
    proxy_id: "",
    notes: "",
    browser_mode: "electron",
    cloak_profile_name: "",
  };
}

export default function AccountsPage({ navigate }) {
  const { token } = useAuth();
  const { refresh: refreshActive, startAccount } = useActiveAccount();

  const [profiles, setProfiles] = useState([]);
  const [proxies, setProxies] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [filter, setFilter] = useState("all");
  const [platformFilter, setPlatformFilter] = useState("all");
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(blankForm());
  const [error, setError] = useState(null);
  const [showBulk, setShowBulk] = useState(false);
  const [bulkForm, setBulkForm] = useState({
    profileId: "",
    platform: "reddit",
    proxyId: "",
    status: "warming",
    lines: "",
  });
  const [bulkResult, setBulkResult] = useState(null);

  const [runningProfiles, setRunningProfiles] = useState(new Set());
  const [accountProfileNames, setAccountProfileNames] = useState({});
  const [accountLaunchStatus, setAccountLaunchStatus] = useState({});

  // ─── data loading ─────────────────────────────────────────────────────────

  async function load() {
    const [p, a, px] = await Promise.all([
      window.api.profiles.list({ token }),
      window.api.accounts.listForUser({ token }),
      window.api.proxies.list({ token }),
    ]);
    if (p.ok) setProfiles(p.profiles);
    if (px.ok) setProxies(px.proxies);
    if (a.ok) {
      setAccounts(a.accounts);
      await loadAccountProfileNames(a.accounts);
    }
    try {
      const running = await window.api.cloakmanager.getRunningProfiles({
        token,
      });
      if (running.ok) {
        const names = Array.isArray(running.running)
          ? running.running
          : Object.keys(running.running ?? {});
        setRunningProfiles(new Set(names));
      }
    } catch (err) {
      console.error("Failed to load running profiles:", err);
    }
  }

  async function loadAccountProfileNames(accs) {
    const names = {};
    for (const acc of accs.filter(
      (a) => (a.platform || "reddit") === "reddit",
    )) {
      try {
        const res = await window.api.cloakmanager.getAccountMode({
          token,
          accountId: acc.id,
        });
        names[acc.id] =
          res.ok && res.profileName
            ? res.profileName
            : `reddit-${acc.username}`;
      } catch {
        names[acc.id] = `reddit-${acc.username}`;
      }
    }
    setAccountProfileNames(names);
  }

  useEffect(() => {
    load();
  }, []);

  // ─── WebSocket listeners ───────────────────────────────────────────────────

  // Stable ref for accountProfileNames so the effect below doesn't need to re-run on every map change
  const profileNamesRef = React.useRef(accountProfileNames);
  useEffect(() => {
    profileNamesRef.current = accountProfileNames;
  }, [accountProfileNames]);

  useEffect(() => {
    if (!token) return;

    function accountIdForProfile(profileName) {
      return (
        Object.keys(profileNamesRef.current).find(
          (id) => profileNamesRef.current[id] === profileName,
        ) ?? null
      );
    }

    function markLaunchStatus(profileName, status) {
      const accountId = accountIdForProfile(profileName);
      if (!accountId) return;
      setAccountLaunchStatus((prev) => ({ ...prev, [accountId]: status }));
    }

    function clearLaunchStatus(accountId, delay = 3000) {
      setTimeout(() => {
        setAccountLaunchStatus((prev) => {
          const next = { ...prev };
          delete next[accountId];
          return next;
        });
      }, delay);
    }

    const offs = [
      window.api.cloakmanager.onProfileLaunched(({ profile }) => {
        setRunningProfiles((prev) => new Set([...prev, profile]));
        const id = accountIdForProfile(profile);
        if (id) {
          markLaunchStatus(profile, {
            stage: "launched",
            message: "Browser launched!",
          });
          clearLaunchStatus(id, 3000);
        }
      }),
      window.api.cloakmanager.onProfileStopped(({ profile }) => {
        setRunningProfiles((prev) => {
          const n = new Set(prev);
          n.delete(profile);
          return n;
        });
      }),
      window.api.cloakmanager.onWindowClosed(({ profile }) => {
        setRunningProfiles((prev) => {
          const n = new Set(prev);
          n.delete(profile);
          return n;
        });
      }),
      window.api.cloakmanager.onBrowserCrashed(({ profile }) => {
        setRunningProfiles((prev) => {
          const n = new Set(prev);
          n.delete(profile);
          return n;
        });
      }),
      window.api.cloakmanager.onCDPReady(({ profile }) => {
        setRunningProfiles((prev) => new Set([...prev, profile]));
      }),
      window.api.cloakmanager.onLaunchProgress(
        ({ profile, stage, message }) => {
          markLaunchStatus(profile, { stage, message });
        },
      ),
    ];
    return () => offs.forEach((fn) => fn());
  }, [token]);

  // ─── CRUD actions ──────────────────────────────────────────────────────────

  async function submit(e) {
    e.preventDefault();
    setError(null);
    if (!form.profile_id || !form.username) {
      setError("Profile and username are required.");
      return;
    }

    const payload = {
      token,
      profileId: Number(form.profile_id),
      platform: form.platform || "reddit",
      username: form.username
        .trim()
        .replace(/^[u@]\//, "")
        .replace(/^@/, ""),
      password: form.password || null,
      email: form.email || null,
      emailPassword: form.emailPassword || null,
      status: form.status,
      proxyId: form.proxy_id ? Number(form.proxy_id) : null,
      notes: form.notes,
    };

    let res;
    if (editing) {
      res = await window.api.accounts.update({
        token,
        accountId: editing,
        updates: {
          status: form.status,
          proxy_id: form.proxy_id ? Number(form.proxy_id) : null,
          notes: form.notes,
          email: form.email || null,
          ...(form.password ? { password: form.password } : {}),
          ...(form.emailPassword ? { emailPassword: form.emailPassword } : {}),
        },
      });
      if (res.ok && (form.browser_mode || form.cloak_profile_name)) {
        try {
          await window.api.cloakmanager.setAccountMode({
            token,
            accountId: editing,
            mode: form.browser_mode || "inherit",
            profileName: form.cloak_profile_name || null,
          });
        } catch (err) {
          console.error("Failed to update browser mode:", err);
        }
      }
    } else {
      res = await window.api.accounts.create(payload);
      if (res.ok) {
        try {
          await window.api.cloakmanager.setAccountMode({
            token,
            accountId: res.id,
            mode: form.browser_mode || "inherit",
            profileName: form.cloak_profile_name || null,
          });
          if (
            form.browser_mode === "cloakmanager" &&
            form.platform === "reddit"
          ) {
            const pr = await window.api.cloakmanager.createProfile({
              token,
              accountId: res.id,
              accountConfig: {
                os: "windows",
                timezone: "America/New_York",
                locale: "en-US",
                resolution: "1920x1080",
              },
            });
            if (!pr.ok)
              setError(
                `Account created but CloakManager profile failed: ${pr.error}`,
              );
          }
        } catch (err) {
          setError(
            `Account created but browser mode setup failed: ${err.message}`,
          );
        }
      }
    }

    if (!res.ok) {
      setError(res.error);
      return;
    }
    setShowAdd(false);
    setEditing(null);
    setForm(blankForm());
    await load();
    await refreshActive();
  }

  async function quickStatus(accountId, status) {
    await window.api.accounts.update({ token, accountId, updates: { status } });
    await load();
    await refreshActive();
  }

  async function quickProxy(accountId, proxyId) {
    await window.api.accounts.update({
      token,
      accountId,
      updates: { proxy_id: proxyId ? Number(proxyId) : null },
    });
    await load();
    await refreshActive();
  }

  function startEdit(account) {
    setEditing(account.id);
    setForm({
      profile_id: account.profile_id,
      username: account.username,
      password: "",
      email: account.email || "",
      emailPassword: "",
      status: account.status,
      proxy_id: account.proxy_id || "",
      notes: account.notes || "",
      browser_mode: "inherit",
      cloak_profile_name: "",
    });
    setShowAdd(true);
    window.api.cloakmanager
      .getAccountMode({ token, accountId: account.id })
      .then((r) => {
        if (r.ok)
          setForm((prev) => ({
            ...prev,
            browser_mode: r.mode || "inherit",
            cloak_profile_name: r.profileName || "",
          }));
      })
      .catch(console.error);
  }

  async function del(id) {
    if (
      !confirm(
        "Delete this account record? The Reddit account itself is untouched.",
      )
    )
      return;
    await window.api.accounts.delete({ token, accountId: id });
    await load();
    await refreshActive();
  }

  // ─── launch ───────────────────────────────────────────────────────────────

  function setLaunchStatus(accountId, status) {
    setAccountLaunchStatus((prev) => ({ ...prev, [accountId]: status }));
  }

  function clearLaunchStatusDelayed(accountId, delay = 5000) {
    setTimeout(() => {
      setAccountLaunchStatus((prev) => {
        const n = { ...prev };
        delete n[accountId];
        return n;
      });
    }, delay);
  }

  async function start(account) {
    const profileName = accountProfileNames[account.id];
    if (account.platform === "reddit") {
      await launchCloakManagerProfile(account, profileName);
    } else {
      await startAccount(account.id);
      if (navigate) navigate("redgifs");
    }
  }

  async function launchCloakManagerProfile(account, profileName) {
    try {
      setLaunchStatus(account.id, {
        stage: "checking",
        message: "Checking backend…",
      });

      const available = await window.api.cloakmanager.checkAvailable({ token });
      if (!available.ok || !available.available)
        throw new Error("CloakManager backend is not available.");

      const finalProfileName = profileName || `reddit-${account.username}`;
      setLaunchStatus(account.id, {
        stage: "launching",
        message: "Starting browser…",
      });

      const result = await window.api.cloakmanager.launchProfile({
        token,
        accountId: account.id,
        profileName: finalProfileName,
      });
      if (!result.ok)
        throw new Error(result.error || "Failed to launch profile.");

      setLaunchStatus(account.id, {
        stage: "launched",
        message: "Browser launched!",
      });
      clearLaunchStatusDelayed(account.id, 5000);
    } catch (err) {
      console.error("Launch failed:", err);
      setLaunchStatus(account.id, { stage: "error", message: err.message });
      clearLaunchStatusDelayed(account.id, 5000);
    }
  }

  // ─── derived state ─────────────────────────────────────────────────────────

  const filtered = accounts.filter(
    (a) =>
      (filter === "all" || a.status === filter) &&
      (platformFilter === "all" || (a.platform || "reddit") === platformFilter),
  );

  const grouped = {};
  for (const a of filtered)
    (grouped[a.profile_name] = grouped[a.profile_name] || []).push(a);

  const statusCounts = accounts.reduce((acc, a) => {
    acc[a.status] = (acc[a.status] || 0) + 1;
    return acc;
  }, {});

  // ─── render ───────────────────────────────────────────────────────────────

  return (
    <div>
      {/* ── Page header ── */}
      <div className="title-block">
        <div>
          <div className="eyebrow">Manage</div>
          <h1>Logins</h1>
          <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
            Every Reddit and RedGifs login across all your models, in one list.
          </div>
        </div>
        <div
          style={{
            marginLeft: "auto",
            display: "flex",
            gap: 8,
            alignItems: "center",
          }}
        >
          <button
            className="ghost"
            onClick={() => navigate && navigate("webviews")}
          >
            Custom pages →
          </button>
          <button
            className="ghost"
            onClick={() => {
              setShowBulk((v) => !v);
              setShowAdd(false);
            }}
          >
            {showBulk ? "Close bulk import" : "↥ Bulk import"}
          </button>
          <button
            className="primary"
            onClick={() => {
              setEditing(null);
              setForm(blankForm());
              setShowAdd((v) => !v);
              setShowBulk(false);
            }}
          >
            {showAdd ? "Cancel" : "+ Add login"}
          </button>
        </div>
      </div>

      {/* ── Filters ── */}
      <div style={s.filterRow}>
        {["all", "reddit", "redgifs"].map((p) => (
          <button
            key={p}
            onClick={() => setPlatformFilter(p)}
            style={{ ...s.chip, ...(platformFilter === p ? s.chipActive : {}) }}
          >
            {p === "all"
              ? "Both platforms"
              : p === "reddit"
                ? "Reddit"
                : "RedGifs"}
            <span style={s.chipCount}>
              {p === "all"
                ? accounts.length
                : accounts.filter((a) => (a.platform || "reddit") === p).length}
            </span>
          </button>
        ))}
        <div style={s.divider} />
        {["all", ...STATUS_OPTIONS.map((o) => o.v)].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{ ...s.chip, ...(filter === f ? s.chipActive : {}) }}
          >
            {f === "all" ? "All statuses" : (STATUS_META[f]?.label ?? f)}
            <span style={s.chipCount}>
              {f === "all" ? accounts.length : statusCounts[f] || 0}
            </span>
          </button>
        ))}
      </div>

      {/* ── Bulk import ── */}
      {showBulk && (
        <div className="card" style={{ marginBottom: 22 }}>
          <h3 style={{ marginBottom: 6 }}>Bulk import</h3>
          <div className="muted" style={{ fontSize: 12, marginBottom: 14 }}>
            One credential per line.{" "}
            <code style={{ color: "var(--gold-bright)" }}>
              username:password
            </code>{" "}
            or{" "}
            <code style={{ color: "var(--gold-bright)" }}>
              username:password:email:emailpassword
            </code>
            . Lines starting with # are skipped.
          </div>
          {bulkResult?.error && (
            <div className="error-banner">{bulkResult.error}</div>
          )}
          {bulkResult?.created != null && (
            <div
              className="card bordered-glow"
              style={{ marginBottom: 12, padding: 14 }}
            >
              <strong>{bulkResult.created} imported.</strong>
              {bulkResult.errors?.length > 0 && (
                <div style={{ marginTop: 8, fontSize: 12 }}>
                  <div className="muted">
                    {bulkResult.errors.length} errors:
                  </div>
                  <ul style={{ margin: "4px 0 0 18px" }}>
                    {bulkResult.errors.slice(0, 10).map((e, i) => (
                      <li key={i}>
                        Line {e.line}
                        {e.username ? ` (${e.username})` : ""}: {e.error}
                      </li>
                    ))}
                    {bulkResult.errors.length > 10 && (
                      <li>…and {bulkResult.errors.length - 10} more</li>
                    )}
                  </ul>
                </div>
              )}
            </div>
          )}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "2fr 1fr 1fr 2fr",
              gap: 10,
              marginBottom: 12,
            }}
          >
            <div>
              <label>Model</label>
              <select
                value={bulkForm.profileId}
                onChange={(e) =>
                  setBulkForm({ ...bulkForm, profileId: e.target.value })
                }
              >
                <option value="">— pick a model —</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label>Platform</label>
              <select
                value={bulkForm.platform}
                onChange={(e) =>
                  setBulkForm({ ...bulkForm, platform: e.target.value })
                }
              >
                <option value="reddit">Reddit</option>
                <option value="redgifs">RedGifs</option>
              </select>
            </div>
            <div>
              <label>Initial status</label>
              <select
                value={bulkForm.status}
                onChange={(e) =>
                  setBulkForm({ ...bulkForm, status: e.target.value })
                }
              >
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.v} value={o.v}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label>Proxy (optional)</label>
              <select
                value={bulkForm.proxyId}
                onChange={(e) =>
                  setBulkForm({ ...bulkForm, proxyId: e.target.value })
                }
              >
                <option value="">— no proxy —</option>
                {proxies.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label} ({p.kind})
                  </option>
                ))}
              </select>
            </div>
          </div>
          <textarea
            value={bulkForm.lines}
            onChange={(e) =>
              setBulkForm({ ...bulkForm, lines: e.target.value })
            }
            placeholder={
              "throwaway123:mypassword\nanother_user:pw:user@mail.com:mailpw"
            }
            style={{
              minHeight: 180,
              fontFamily: "var(--font-mono)",
              fontSize: 12,
            }}
          />
          <div style={{ marginTop: 12 }}>
            <button
              className="primary"
              onClick={async () => {
                setBulkResult(null);
                if (!bulkForm.profileId) {
                  setBulkResult({ error: "Pick a model first." });
                  return;
                }
                if (!bulkForm.lines.trim()) {
                  setBulkResult({ error: "Paste some credentials first." });
                  return;
                }
                const res = await window.api.accounts.bulkCreate({
                  token,
                  profileId: Number(bulkForm.profileId),
                  platform: bulkForm.platform,
                  status: bulkForm.status,
                  proxyId: bulkForm.proxyId ? Number(bulkForm.proxyId) : null,
                  lines: bulkForm.lines,
                });
                if (!res.ok) {
                  setBulkResult({ error: res.error });
                  return;
                }
                setBulkResult({
                  created: res.created.length,
                  errors: res.errors,
                });
                if (res.created.length) {
                  setBulkForm({ ...bulkForm, lines: "" });
                  load();
                }
              }}
            >
              Import all
            </button>
          </div>
        </div>
      )}

      {/* ── Add / edit form ── */}
      {showAdd && (
        <form onSubmit={submit} className="card" style={{ marginBottom: 22 }}>
          <h3 style={{ marginBottom: 14 }}>
            {editing
              ? "Edit login"
              : `Add ${form.platform === "redgifs" ? "RedGifs" : "Reddit"} login`}
          </h3>
          {error && <div className="error-banner">{error}</div>}

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: 14,
            }}
          >
            <div>
              <label>Model profile</label>
              <select
                value={form.profile_id}
                disabled={!!editing}
                onChange={(e) =>
                  setForm({ ...form, profile_id: e.target.value })
                }
              >
                <option value="">— pick a profile —</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label>Platform</label>
              <select
                value={form.platform}
                disabled={!!editing}
                onChange={(e) => setForm({ ...form, platform: e.target.value })}
              >
                <option value="reddit">Reddit</option>
                <option value="redgifs">RedGifs</option>
              </select>
            </div>
            <div>
              <label>Status</label>
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
              >
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.v} value={o.v}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label>
                {form.platform === "redgifs" ? "RedGifs" : "Reddit"} username
              </label>
              <input
                value={form.username}
                disabled={!!editing}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
              />
            </div>
            <div>
              <label>
                Password{" "}
                {editing && (
                  <span
                    className="dim mono"
                    style={{
                      textTransform: "none",
                      letterSpacing: 0,
                      fontSize: 10,
                    }}
                  >
                    (leave blank to keep current)
                  </span>
                )}
              </label>
              <input
                type="text"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </div>

            <div>
              <label>
                Linked email{" "}
                <span className="muted" style={{ fontWeight: 400 }}>
                  (optional)
                </span>
              </label>
              <input
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div>
              <label>
                Email password{" "}
                <span className="muted" style={{ fontWeight: 400 }}>
                  (optional)
                </span>
              </label>
              <input
                type="text"
                value={form.emailPassword}
                onChange={(e) =>
                  setForm({ ...form, emailPassword: e.target.value })
                }
              />
            </div>

            <div>
              <label>Proxy</label>
              <select
                value={form.proxy_id}
                onChange={(e) => setForm({ ...form, proxy_id: e.target.value })}
              >
                <option value="">— no proxy —</option>
                {proxies.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label} ({p.kind} {p.host}:{p.port})
                  </option>
                ))}
              </select>
              {proxies.length === 0 && (
                <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                  No proxies configured. Add some under <strong>Proxies</strong>
                  .
                </div>
              )}
            </div>

            {/* Browser mode */}
            <div
              style={{
                gridColumn: "1 / -1",
                marginTop: 8,
                paddingTop: 16,
                borderTop: "1px solid var(--border)",
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 12 }}>
                Browser mode{" "}
                <span className="muted" style={{ fontWeight: 400 }}>
                  (Reddit only)
                </span>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 14,
                }}
              >
                <div>
                  <label>Mode</label>
                  <select
                    value={form.browser_mode}
                    disabled={form.platform === "redgifs"}
                    onChange={(e) =>
                      setForm({ ...form, browser_mode: e.target.value })
                    }
                  >
                    <option value="inherit">
                      Inherit (use system default)
                    </option>
                    <option value="electron">Electron (standard)</option>
                    <option value="cloakmanager">
                      CloakManager (advanced)
                    </option>
                  </select>
                  <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                    {form.platform === "redgifs" &&
                      "CloakManager is only available for Reddit accounts."}
                    {form.browser_mode === "inherit" &&
                      form.platform !== "redgifs" &&
                      "Uses the default browser mode set in Settings."}
                    {form.browser_mode === "electron" &&
                      "Standard Electron webview — shared fingerprint across accounts."}
                    {form.browser_mode === "cloakmanager" &&
                      "Unique fingerprint per account. Requires CloakManager service."}
                  </div>
                </div>
                <div>
                  <label>CloakManager profile name</label>
                  <input
                    value={form.cloak_profile_name}
                    onChange={(e) =>
                      setForm({ ...form, cloak_profile_name: e.target.value })
                    }
                    placeholder="Auto-generated if blank"
                    disabled={
                      form.browser_mode !== "cloakmanager" ||
                      form.platform === "redgifs"
                    }
                    style={{ fontFamily: "monospace" }}
                  />
                  {form.browser_mode === "cloakmanager" && (
                    <div
                      className="muted"
                      style={{ fontSize: 11, marginTop: 4 }}
                    >
                      {form.cloak_profile_name ? (
                        <>
                          Using: <code>{form.cloak_profile_name}</code>
                        </>
                      ) : (
                        <>
                          Auto:{" "}
                          <code>reddit-{form.username || "username"}</code>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div style={{ gridColumn: "1 / -1" }}>
              <label>
                Notes{" "}
                <span className="muted" style={{ fontWeight: 400 }}>
                  (optional)
                </span>
              </label>
              <input
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>
          </div>

          <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
            <button type="submit" className="primary">
              {editing ? "Save changes" : "Add account"}
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setShowAdd(false);
                setEditing(null);
                setForm(blankForm());
              }}
            >
              Cancel
            </button>
          </div>
          <div
            className="muted"
            style={{ fontSize: 12, marginTop: 14, fontStyle: "italic" }}
          >
            Credentials are encrypted on disk using your OS keychain and shown
            only when explicitly requested.
          </div>
        </form>
      )}

      {/* ── Account list ── */}
      {filtered.length === 0 ? (
        <div className="empty-state">
          {accounts.length === 0
            ? profiles.length === 0
              ? "Create a model profile first."
              : "No accounts yet — add one above."
            : `No accounts match the current filter.`}
        </div>
      ) : (
        Object.entries(grouped).map(([profileName, items]) => (
          <div key={profileName} style={{ marginBottom: 24 }}>
            <h3
              style={{
                marginBottom: 10,
                fontSize: 13,
                fontWeight: 600,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                opacity: 0.55,
              }}
            >
              {profileName}
            </h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {items.map((a) => (
                <AccountRow
                  key={a.id}
                  account={a}
                  proxies={proxies}
                  profileName={accountProfileNames[a.id] ?? null}
                  isRunning={runningProfiles.has(
                    accountProfileNames[a.id] ?? "",
                  )}
                  launchStatus={accountLaunchStatus[a.id] ?? null}
                  onStart={() => start(a)}
                  onStatusChange={(v) => quickStatus(a.id, v)}
                  onProxyChange={(v) => quickProxy(a.id, v)}
                  onEdit={() => startEdit(a)}
                  onDelete={() => del(a.id)}
                />
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ─── Account row ────────────────────────────────────────────────────────────

function AccountRow({
  account: a,
  proxies,
  isRunning,
  launchStatus,
  onStart,
  onStatusChange,
  onProxyChange,
  onEdit,
  onDelete,
}) {
  const busy = isRunning || !!launchStatus;
  const meta = STATUS_META[a.status] ?? STATUS_META.paused;
  const prefix = a.platform === "redgifs" ? "@" : "u/";

  return (
    <div style={s.row}>
      {/* Launch button */}
      <button
        onClick={() => !busy && onStart()}
        disabled={busy}
        title={
          launchStatus
            ? launchStatus.message
            : isRunning
              ? "Profile is currently running"
              : `Open ${a.platform} browser as ${prefix}${a.username}`
        }
        style={{
          ...s.launchBtn,
          ...(isRunning ? s.launchBtnRunning : {}),
          ...(launchStatus && !isRunning ? s.launchBtnBusy : {}),
          ...(busy ? { cursor: "not-allowed", opacity: 0.5 } : {}),
        }}
      >
        {launchStatus ? "…" : isRunning ? "■" : "▶"}
      </button>

      {/* Status dot */}
      <span style={{ ...s.dot, background: meta.color }} title={meta.label} />

      {/* Main info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <span style={s.platformBadge}>{a.platform || "reddit"}</span>
          <span style={{ fontSize: 14, fontWeight: 500 }}>
            <span className="mono dim">{prefix}</span>
            {a.username}
          </span>
          {a.has_password && (
            <span className="mono dim" style={{ fontSize: 11 }}>
              🔑
            </span>
          )}
          {isRunning && <span style={s.runningBadge}>● Running</span>}
          {launchStatus && <LaunchBadge status={launchStatus} />}
        </div>
        {a.notes && (
          <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
            {a.notes}
          </div>
        )}
      </div>

      {/* Quick controls */}
      <div
        style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}
      >
        <div style={s.selectWrap}>
          <span style={s.selectLabel}>Status</span>
          <select
            value={a.status}
            onChange={(e) => onStatusChange(e.target.value)}
            style={s.miniSelect}
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.v} value={o.v}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div style={s.selectWrap}>
          <span style={s.selectLabel}>Proxy</span>
          <select
            value={a.proxy_id || ""}
            onChange={(e) => onProxyChange(e.target.value)}
            style={s.miniSelect}
          >
            <option value="">none</option>
            {proxies.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        <button className="ghost" onClick={onEdit} style={{ fontSize: 12 }}>
          Edit
        </button>
        <button onClick={onDelete} style={s.deleteBtn}>
          Remove
        </button>
      </div>
    </div>
  );
}

function LaunchBadge({ status }) {
  const map = {
    checking: {
      icon: "🔍",
      color: "var(--gold, #c89a3a)",
      bg: "rgba(200,154,58,.1)",
      border: "rgba(200,154,58,.3)",
    },
    launching: {
      icon: "↑",
      color: "var(--gold, #c89a3a)",
      bg: "rgba(200,154,58,.1)",
      border: "rgba(200,154,58,.3)",
    },
    launched: {
      icon: "✓",
      color: "#4a9b6a",
      bg: "rgba(74,155,106,.1)",
      border: "rgba(74,155,106,.3)",
    },
    error: {
      icon: "✕",
      color: "#c94040",
      bg: "rgba(201,64,64,.1)",
      border: "rgba(201,64,64,.3)",
    },
  };
  const t = map[status.stage] ?? map.launching;
  return (
    <span
      style={{
        fontSize: 11,
        padding: "2px 8px",
        borderRadius: 4,
        fontWeight: 500,
        whiteSpace: "nowrap",
        color: t.color,
        background: t.bg,
        border: `1px solid ${t.border}`,
      }}
    >
      {t.icon} {status.message}
    </span>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const s = {
  filterRow: {
    display: "flex",
    gap: 6,
    marginBottom: 18,
    flexWrap: "wrap",
    alignItems: "center",
  },
  chip: {
    fontSize: 11,
    padding: "4px 10px",
    borderRadius: 6,
    background: "var(--bg-1, rgba(0,0,0,.04))",
    border: "1px solid var(--border, rgba(0,0,0,.12))",
    color: "var(--text-2, inherit)",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: 5,
    transition: "background 0.15s, border-color 0.15s",
  },
  chipActive: {
    background: "rgba(212,166,74,.12)",
    borderColor: "rgba(212,166,74,.5)",
    color: "var(--gold-bright, #d4a84a)",
  },
  chipCount: {
    fontFamily: "var(--font-mono, monospace)",
    fontSize: 10,
    opacity: 0.5,
    minWidth: 14,
    textAlign: "right",
  },
  divider: {
    width: 1,
    height: 20,
    background: "var(--border, rgba(0,0,0,.12))",
    margin: "0 4px",
  },

  row: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 14px",
    background: "var(--bg-elev, var(--bg-1, rgba(0,0,0,.02)))",
    border: "1px solid var(--border, rgba(0,0,0,.1))",
    borderRadius: "var(--radius, 8px)",
    transition: "border-color 0.15s",
  },

  launchBtn: {
    width: 34,
    height: 34,
    padding: 0,
    borderRadius: "50%",
    fontSize: 12,
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
    background: "var(--gradient-brand, #c89a3a)",
    color: "#1a1a14",
    border: "1px solid rgba(212,166,74,.6)",
    cursor: "pointer",
    fontWeight: 700,
    transition: "opacity 0.15s",
    boxShadow: "0 1px 6px rgba(212,166,74,.25)",
  },
  launchBtnRunning: {
    background: "transparent",
    border: "1px solid #4a9b6a",
    color: "#4a9b6a",
    boxShadow: "none",
  },
  launchBtnBusy: {
    background: "transparent",
    border: "1px solid rgba(212,166,74,.4)",
    color: "var(--gold, #c89a3a)",
    boxShadow: "none",
  },

  dot: { width: 8, height: 8, borderRadius: "50%", flexShrink: 0 },

  platformBadge: {
    fontSize: 10,
    padding: "1px 5px",
    background: "var(--bg-2, rgba(0,0,0,.06))",
    borderRadius: 3,
    textTransform: "uppercase",
    fontFamily: "var(--font-mono, monospace)",
    opacity: 0.7,
    letterSpacing: "0.03em",
  },

  runningBadge: {
    fontSize: 10,
    padding: "2px 7px",
    borderRadius: 4,
    fontWeight: 500,
    background: "rgba(74,155,106,.12)",
    color: "#4a9b6a",
    border: "1px solid rgba(74,155,106,.3)",
  },

  selectWrap: { display: "flex", flexDirection: "column", gap: 2 },
  selectLabel: {
    fontSize: 9,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    opacity: 0.45,
  },
  miniSelect: { width: "auto", padding: "4px 8px", fontSize: 12 },

  deleteBtn: {
    fontSize: 12,
    padding: "5px 10px",
    background: "transparent",
    border: "1px solid rgba(201,64,64,.3)",
    color: "#c94040",
    borderRadius: "var(--radius, 6px)",
    cursor: "pointer",
    transition: "background 0.15s, border-color 0.15s",
  },
};
