/**
 * CDP Orchestrator
 *
 * Single owner of the CloakManager launch lifecycle. Everything that wants a
 * model's CloakManager browser running + set up goes through
 * `ensureProfileRunning()` — the account Launch button, the model Launch
 * button, the debug launch IPC, and the autopilot / scheduler / inbox task
 * paths. There is exactly one launch in flight per profile at a time and it
 * is idempotent: concurrent callers join the same promise.
 *
 * Launch state machine (per profile):
 *
 *   idle → launching → warming → cdp_connecting → running_scripts → ready
 *                                                              ↘ failed(reason)
 *
 * - `launching`       : POST /launch in flight (or verifying an already-up profile)
 * - `warming`         : launched, waiting for CDP to become reachable
 * - `cdp_connecting`  : opening the Playwright CDP connection
 * - `running_scripts` : executing the model's launch script sequence
 * - `ready`           : browser up, logged in, set up
 * - `failed`          : terminal for this attempt; a later call retries
 *
 * The `cdp_ready` WebSocket event is only needed for (a) profiles launched
 * out-of-band (CloakManager's own UI) and (b) the rare case where our own
 * launch returned before CDP was verified. Our own launches normally don't
 * depend on the event at all — `client.launchProfile()` already blocks until
 * the browser is up and verifies the CDP endpoint.
 *
 * @module cdp/orchestrator
 */

const elog = require('electron-log');
const { getCloakManagerClient } = require('../cloakmanager');
const { getDb } = require('../db');
const { resolveBrowserMode } = require('../lib/browserMode');
const connectionManager = require('./connection-manager');
const scriptExecutor = require('./script-executor');
const { toCdpError, LaunchFailed, CdpUnavailable, Timeout } = require('./errors');

/**
 * Launch state, keyed by profile name.
 * Map<string, LaunchState>
 *
 * LaunchState = {
 *   phase: 'launching'|'warming'|'cdp_connecting'|'running_scripts'|'ready'|'failed',
 *   accountId: number|null,
 *   platform: string|null,
 *   reason: string,
 *   startedAt: number,
 *   error: string|null,
 *   code: string|null,
 *   promise: Promise<{ok, ...}>,
 *   cdpReady: Promise<void>,        // resolves when cdp_ready fires for this profile
 *   _resolveCdpReady: () => void,
 * }
 */
const launches = new Map();

// --------------------------------------------------------- per-profile mutex
//
// Serialises everything that drives a profile's page: the launch script
// sequence AND any task script. A manual launch and an autopilot post on the
// same model can no longer touch the same Playwright page concurrently — the
// second waiter simply runs after the first settles.
//
// Map<profileName, Promise> — the tail of the chain for that profile.
const profileLocks = new Map();

/**
 * Run `fn` with exclusive access to `profileName`. Returns fn's result;
 * rejects with fn's error. The lock is released when fn settles.
 * NOT re-entrant — never call withProfileLock again inside `fn` for the same
 * profile (it would deadlock).
 *
 * @template T
 * @param {string} profileName
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
function withProfileLock(profileName, fn) {
  const prev = profileLocks.get(profileName) || Promise.resolve();
  const cur = prev.catch(() => {}).then(() => fn());
  profileLocks.set(profileName, cur);
  cur.catch(() => {}).then(() => {
    if (profileLocks.get(profileName) === cur) profileLocks.delete(profileName);
  });
  return cur;
}

/** How long to wait for the `cdp_ready` event when our launch didn't verify CDP. */
const CDP_READY_TIMEOUT_MS = 90_000;

let _mainWindow = null;

/**
 * Initialize the orchestrator. Called once at app startup from
 * ipc/cloakmanager.js after the CloakManager client + WS are wired.
 *
 * @param {Object} mainWindow
 * @param {Object} [client] - unused, kept for signature compatibility
 */
function initialize(mainWindow /* , client */) {
  _mainWindow = mainWindow;
  global.cdpMainWindow = mainWindow;
  elog.info('[CDP Orchestrator] initialized');
}

// --------------------------------------------------------------- launch API

/**
 * Ensure a CloakManager profile is running, CDP-connected, and set up
 * (logged in via the launch script sequence). Idempotent per profile.
 *
 * @param {string} profileName
 * @param {Object} [opts]
 * @param {number|null} [opts.accountId] - the account this launch is for (drives login / inbox scripts)
 * @param {string|null} [opts.platform]  - that account's platform
 * @param {string} [opts.reason]         - 'manual' | 'model' | 'task' | 'out-of-band' | 'manual-trigger'
 * @param {boolean} [opts.waitForScripts=true] - resolve only after the launch
 *        script sequence finishes (login etc.). `false` resolves as soon as the
 *        browser is up + CDP connected, leaving scripts to finish in the
 *        background — used by manual launches so the operator isn't blocked.
 * @returns {Promise<{ok: boolean, profileName?: string, accountId?: number|null, error?: string, code?: string, results?: Object, alreadyRunning?: boolean}>}
 */
async function ensureProfileRunning(profileName, opts = {}) {
  if (!profileName) return { ok: false, error: 'No profile name', code: 'no_profile' };
  const { accountId = null, platform = null, reason = 'manual', waitForScripts = true } = opts;

  const existing = launches.get(profileName);
  if (existing) {
    if (existing.phase === 'ready') {
      // Verify it's actually still up before trusting the cached state.
      const client = getCloakManagerClient();
      const running = await client.getRunningProfiles().catch(() => ({ running: {} }));
      if (running.running && running.running[profileName]) {
        return { ok: true, alreadyRunning: true, profileName, accountId: existing.accountId };
      }
      launches.delete(profileName); // stale — fall through and relaunch
    } else if (existing.phase === 'failed') {
      launches.delete(profileName); // allow a fresh attempt
    } else {
      // A launch is in flight — join it. Upgrade the identity if this caller
      // knows which account it's for and the in-flight one doesn't.
      if (accountId && !existing.accountId) {
        existing.accountId = accountId;
        existing.platform = platform;
        elog.info('[CDP Orchestrator] upgraded in-flight launch identity', { profileName, accountId });
      }
      return waitForScripts ? existing.promise : existing.brought;
    }
  }

  const state = {
    phase: 'launching',
    accountId,
    platform,
    reason,
    startedAt: Date.now(),
    error: null,
    code: null,
  };
  state.cdpReady = new Promise((resolve) => { state._resolveCdpReady = resolve; });
  // Resolves once the browser is up + CDP connected (before the script phase).
  state.brought = new Promise((resolve) => { state._resolveBrought = resolve; });
  // The lock is held for the FULL runLaunch (through the script sequence),
  // even when the caller only awaits `state.brought` — so a task script can
  // never interleave with the launch scripts.
  state.promise = withProfileLock(profileName, () => runLaunch(profileName, state)).finally(() => {
    const s = launches.get(profileName);
    if (s && s.phase !== 'ready' && s.phase !== 'failed') launches.delete(profileName);
  });
  launches.set(profileName, state);
  return waitForScripts ? state.promise : state.brought;
}

/**
 * Drive one launch attempt through the state machine.
 * @param {string} profileName
 * @param {Object} state
 */
async function runLaunch(profileName, state) {
  const client = getCloakManagerClient();

  try {
    // Does any model own this profile? (row exists the moment a model is put
    // into CloakManager mode, independent of linked accounts.)
    const owner = getDb().prepare(
      'SELECT profile_id FROM cloakmanager_profiles WHERE profile_name = ?'
    ).get(profileName);
    if (!owner) {
      throw new LaunchFailed(`Profile "${profileName}" is not owned by any model`);
    }

    // 1. launching — start it, or attach to an already-running instance
    setPhase(profileName, state, 'launching', 'Starting browser…');
    const running = await client.getRunningProfiles().catch(() => ({ running: {} }));
    const alreadyUp = !!(running.running && running.running[profileName]);

    let cdpInfo = null;
    if (!alreadyUp) {
      const launchResult = await client.launchProfile(profileName).catch((e) => {
        throw new LaunchFailed(e.message, { cause: e });
      });
      if (!launchResult || !launchResult.ok) {
        throw new LaunchFailed((launchResult && launchResult.error) || 'CloakManager launch failed');
      }
      cdpInfo = launchResult;

      // 2. warming — launchProfile normally verifies CDP itself. Only wait for
      //    the event when it explicitly told us CDP wasn't ready.
      if (launchResult.cdpReady === false) {
        setPhase(profileName, state, 'warming', 'Waiting for CDP…');
        await Promise.race([
          state.cdpReady,
          rejectAfter(CDP_READY_TIMEOUT_MS, () => new Timeout(`cdp_ready never arrived for ${profileName}`)),
        ]);
      }

      persistProfileRunning(profileName, launchResult);
    } else {
      // Already up (out-of-band launch, or a relaunch while state was stale).
      setPhase(profileName, state, 'warming', 'Attaching to running browser…');
      const info = await connectionManager.getProfileCDPInfo(profileName);
      if (!info || !info.cdp_ws_url) {
        throw new CdpUnavailable(`Profile ${profileName} is running but exposes no CDP endpoint`);
      }
      cdpInfo = { cdpPort: info.cdp_port, cdpUrl: info.cdp_url, cdpWsUrl: info.cdp_ws_url };
    }

    // 3. cdp_connecting — open (or reuse) the pooled Playwright connection
    setPhase(profileName, state, 'cdp_connecting', 'Connecting…');
    const connection = state.accountId
      ? await connectionManager.getConnectionForAccount(state.accountId)
      : await connectionManager.getConnectionForProfile(profileName);
    if (!connection) {
      throw new CdpUnavailable(`Could not open a CDP connection to ${profileName}`);
    }

    // Browser is up + reachable. Unblock any waitForScripts:false caller.
    const brought = {
      ok: true,
      profileName,
      accountId: state.accountId,
      cdpPort: cdpInfo && cdpInfo.cdpPort,
      cdpUrl: cdpInfo && cdpInfo.cdpUrl,
      cdpWsUrl: cdpInfo && cdpInfo.cdpWsUrl,
    };
    state._resolveBrought(brought);

    // 4. running_scripts — the model's launch sequence (login, warmers, etc.)
    setPhase(profileName, state, 'running_scripts', 'Running setup…');
    const results = await scriptExecutor.executeLaunchSequence(
      profileName, state.accountId, state.platform
    );
    await scriptExecutor.recordExecution(profileName, 'launch-sequence', 'launch', results);

    // A hard auth failure inside the sequence marks the account and should
    // stop us calling this a success.
    const authFail = firstAuthFailure(results);
    if (authFail) {
      throw toCdpError(new Error(authFail));
    }

    setPhase(profileName, state, 'ready', 'Ready');
    return { ...brought, results };
  } catch (err) {
    const cdpErr = toCdpError(err);
    state.error = cdpErr.message;
    state.code = cdpErr.code;
    setPhase(profileName, state, 'failed', `Failed: ${cdpErr.message}`, cdpErr.code);
    elog.warn('[CDP Orchestrator] launch failed', { profileName, code: cdpErr.code, error: cdpErr.message });

    if (cdpErr.attention && state.accountId) {
      flagAccountNeedsAttention(state.accountId, cdpErr.code, cdpErr.message);
    }
    await scriptExecutor.recordExecution(profileName, 'launch-sequence', 'launch', null, cdpErr.message);

    const failResult = { ok: false, error: cdpErr.message, code: cdpErr.code, profileName };
    // If we failed before CDP connected, waitForScripts:false callers are
    // still waiting on `brought` — resolve it with the failure.
    state._resolveBrought(failResult);
    return failResult;
  }
}

/**
 * WebSocket `cdp_ready` handler. Resolves the CDP gate for an in-flight
 * launch, or kicks off a launch sequence for a profile that came up
 * out-of-band (CloakManager's own UI).
 *
 * @param {string} profileName
 */
function onCdpReady(profileName) {
  if (!profileName) return;
  const state = launches.get(profileName);
  if (state && state.phase !== 'ready' && state.phase !== 'failed') {
    if (state._resolveCdpReady) state._resolveCdpReady();
    return;
  }
  // No launch we started — profile was launched elsewhere. Run the model-level
  // setup sequence (identity-scoped scripts like login are skipped when there's
  // no targeted account).
  elog.info('[CDP Orchestrator] cdp_ready for a profile we did not launch — running model-level setup:', profileName);
  ensureProfileRunning(profileName, { accountId: null, reason: 'out-of-band' })
    .catch((e) => elog.warn('[CDP Orchestrator] out-of-band launch failed:', e && e.message));
  // The event we just received IS the CDP-ready signal — unblock the state
  // machine's warming gate immediately instead of waiting for a timeout.
  const fresh = launches.get(profileName);
  if (fresh && fresh._resolveCdpReady) fresh._resolveCdpReady();
}

/**
 * WebSocket `profile_stopped` handler. Clears launch state + CDP connection.
 * @param {string} profileName
 */
function onProfileStopped(profileName) {
  if (!profileName) return;
  launches.delete(profileName);
  connectionManager.closeConnection(profileName).catch(() => {});
  try {
    getDb().prepare(
      "UPDATE cloakmanager_profiles SET status = 'stopped', cdp_port = NULL, cdp_url = NULL WHERE profile_name = ?"
    ).run(profileName);
  } catch { /* ignore */ }
  elog.info('[CDP Orchestrator] profile stopped, state cleared:', profileName);
}

/**
 * WebSocket `browser_crashed` handler.
 * @param {Object} data
 */
function onBrowserCrashed(data) {
  const profileName = data && data.profile;
  if (!profileName) return;
  elog.error('[CDP Orchestrator] browser crashed:', profileName);
  onProfileStopped(profileName);
  broadcastProgress({ profile: profileName, stage: 'failed', ok: false, reason: 'browser_crashed', message: 'Browser crashed' });
}

// ----------------------------------------------------------------- task API

/**
 * Execute a task script (post, inbox fetch/reply, …) against a profile,
 * launching + setting it up first when needed.
 *
 * @param {string} scriptId
 * @param {Object} context - { accountId, profileName?, platform?, ...taskParams }
 * @param {Object} [opts]
 * @param {boolean} [opts.autoLaunch=true]
 * @returns {Promise<{ok: boolean, result?: any, error?: string, code?: string, scriptId: string, notRunning?: boolean}>}
 */
async function executeTask(scriptId, context, { autoLaunch = true } = {}) {
  try {
    const profileName = context.profileName || await getProfileNameForAccount(context.accountId);
    if (!profileName) {
      return { ok: false, error: 'No CloakManager profile found for account', scriptId };
    }

    if (autoLaunch) {
      // Full launch + setup (login) before the task runs. Acquires + releases
      // the per-profile lock itself; idempotent + fast when already ready.
      const launch = await ensureProfileRunning(profileName, {
        accountId: context.accountId,
        platform: context.platform || null,
        reason: 'task',
      });
      if (!launch.ok) {
        return { ok: false, error: launch.error, code: launch.code, scriptId };
      }
    } else {
      const client = getCloakManagerClient();
      const running = await client.getRunningProfiles().catch(() => ({ running: {} }));
      if (!(running.running && running.running[profileName])) {
        return { ok: false, error: 'Profile is not running', scriptId, notRunning: true };
      }
    }

    // Serialise the task itself against launches + other tasks on this profile.
    return await withProfileLock(profileName, () =>
      executeTaskNow({ scriptId, context: { ...context, profileName } })
    );
  } catch (error) {
    const e = toCdpError(error);
    elog.warn('[CDP Orchestrator] task execution failed', { scriptId, code: e.code, error: e.message });
    return { ok: false, error: e.message, code: e.code, scriptId };
  }
}

/**
 * Run a task script immediately against an already-running profile.
 * @param {{scriptId: string, context: Object}} task
 */
async function executeTaskNow(task) {
  const { scriptId, context } = task;
  const startTime = Date.now();
  try {
    const result = await scriptExecutor.executeTaskScript(scriptId, context);

    const profileName = context.profileName || await getProfileNameForAccount(context.accountId);
    if (profileName) {
      await scriptExecutor.recordExecution(
        profileName, scriptId, 'task',
        result.ok ? result.result : null,
        result.ok ? null : result.error
      );
    }

    // A task hitting a hard auth / not-logged-in wall should flag the account.
    if (!result.ok && context.accountId) {
      const e = toCdpError(new Error(result.error || 'task failed'));
      if (e.attention) flagAccountNeedsAttention(context.accountId, e.code, e.message);
      result.code = e.code;
    }

    elog.info('[CDP Orchestrator] task done', { scriptId, ok: result.ok, ms: Date.now() - startTime });
    return result;
  } catch (error) {
    const e = toCdpError(error);
    if (e.attention && context.accountId) flagAccountNeedsAttention(context.accountId, e.code, e.message);
    return { ok: false, error: e.message, code: e.code, scriptId };
  }
}

// ------------------------------------------------------------- account state

/**
 * Flag an account as needing a human. Excluded from autopilot / scheduler
 * until an operator clears it (accounts:clearAttention).
 *
 * @param {number} accountId
 * @param {string} code
 * @param {string} reason
 */
function flagAccountNeedsAttention(accountId, code, reason) {
  try {
    getDb().prepare(`
      UPDATE reddit_accounts
      SET needs_attention = 1,
          attention_reason = ?,
          attention_at = datetime('now')
      WHERE id = ?
    `).run(`${code}: ${String(reason || '').slice(0, 300)}`, accountId);
    elog.warn('[CDP Orchestrator] account flagged needs_attention', { accountId, code });
    if (_mainWindow && !_mainWindow.isDestroyed()) {
      _mainWindow.webContents.send('account:needsAttention', { accountId, code, reason });
    }
  } catch (e) {
    elog.warn('[CDP Orchestrator] failed to flag account', { accountId, err: e && e.message });
  }
}

/**
 * Scan a launch-sequence result object for a hard auth failure.
 * @param {Object} results - keyed by scriptId → { success, error, skipped }
 * @returns {string|null} the error message, or null
 */
function firstAuthFailure(results) {
  if (!results) return null;
  for (const [scriptId, r] of Object.entries(results)) {
    if (!r || r.success || r.skipped || !r.error) continue;
    if (!/login|auth/i.test(scriptId)) continue;
    const e = toCdpError(new Error(r.error));
    if (e.attention) return r.error;
  }
  return null;
}

// ------------------------------------------------------------------- helpers

function setPhase(profileName, state, phase, message, reason) {
  state.phase = phase;
  broadcastProgress({
    profile: profileName,
    accountId: state.accountId,
    stage: phase,
    ok: phase !== 'failed',
    reason: reason || (phase === 'failed' ? state.code : null),
    message: message || phase,
  });
  // Legacy channel still consumed by the autopilot launch UI.
  if (state.accountId) broadcastLaunchProgress(state.accountId, profileName, phase, message || phase);
}

function persistProfileRunning(profileName, launchResult) {
  try {
    getDb().prepare(`
      UPDATE cloakmanager_profiles
      SET cdp_port = ?, cdp_url = ?, cdp_ws_url = ?, fp_seed = ?, status = 'running'
      WHERE profile_name = ?
    `).run(
      launchResult.cdpPort || null,
      launchResult.cdpUrl || null,
      launchResult.cdpWsUrl || null,
      launchResult.fpSeed || launchResult.fingerprintSeed || null,
      profileName
    );
  } catch (e) {
    elog.warn('[CDP Orchestrator] persistProfileRunning failed', { profileName, err: e && e.message });
  }
}

function broadcastProgress(payload) {
  try {
    if (_mainWindow && !_mainWindow.isDestroyed()) {
      _mainWindow.webContents.send('cdp:progress', payload);
    }
  } catch { /* ignore */ }
}

function broadcastLaunchProgress(accountId, profileName, stage, message) {
  try {
    const win = _mainWindow || global.cdpMainWindow;
    if (win && !win.isDestroyed()) {
      win.webContents.send('autopilot:cmLaunchProgress', { accountId, profileName, stage, message });
    }
  } catch { /* ignore */ }
}

function rejectAfter(ms, makeError) {
  return new Promise((_, reject) => {
    setTimeout(() => reject(makeError ? makeError() : new Error('timeout')), ms);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ------------------------------------------------------------- profile lookup

/**
 * Effective CloakManager profile name for an account (override or model default).
 * @param {number} accountId
 * @returns {Promise<string|null>}
 */
async function getProfileNameForAccount(accountId) {
  try {
    if (!accountId) return null;
    const row = getDb().prepare(`
      SELECT COALESCE(bs.cloak_profile_override, mp.cloak_profile_name) AS effective_cm_name
      FROM reddit_accounts ra
      JOIN model_profiles mp ON mp.id = ra.profile_id
      LEFT JOIN account_browser_settings bs ON bs.account_id = ra.id
      WHERE ra.id = ?
    `).get(accountId);
    return (row && row.effective_cm_name) || null;
  } catch (error) {
    elog.warn('[CDP Orchestrator] getProfileNameForAccount failed', { accountId, err: error && error.message });
    return null;
  }
}

/**
 * Is CDP automation available for this account right now?
 * @param {number} accountId
 * @returns {Promise<boolean>}
 */
async function hasCDPAvailable(accountId) {
  try {
    const { mode, profileName } = resolveBrowserMode(accountId);
    if (mode !== 'cloakmanager' || !profileName) return false;
    const client = getCloakManagerClient();
    if (!await client.isAvailable()) return false;
    const running = await client.getRunningProfiles();
    return !!(running.running && running.running[profileName]);
  } catch (error) {
    elog.warn('[CDP Orchestrator] hasCDPAvailable failed', { accountId, err: error && error.message });
    return false;
  }
}

// ------------------------------------------------------------------ debug/stats

async function testConnection(accountId) {
  try {
    const connection = await connectionManager.getConnectionForAccount(accountId);
    if (!connection) {
      return { success: false, error: 'Failed to establish CDP connection', message: 'Could not connect to profile via CDP' };
    }
    const testScript = require('../cdp-scripts/test/basic-connection-test');
    const profileName = await getProfileNameForAccount(accountId);
    return await testScript.execute(connection, { accountId, profileName: profileName || 'unknown' });
  } catch (error) {
    return { success: false, error: error.message, message: 'CDP connection test failed' };
  }
}

function getStats() {
  const byPhase = {};
  for (const s of launches.values()) byPhase[s.phase] = (byPhase[s.phase] || 0) + 1;
  return {
    connections: connectionManager.getConnectionStats
      ? connectionManager.getConnectionStats()
      : { total: 0 },
    cache: scriptExecutor.getCacheStats ? scriptExecutor.getCacheStats() : { total: 0 },
    launches: launches.size,
    launchesByPhase: byPhase,
    lockedProfiles: profileLocks.size,
  };
}

async function recordExecution(profileName, scriptId, category, result, error) {
  try {
    await scriptExecutor.recordExecution(profileName, scriptId, category, result, error);
  } catch (e) {
    elog.warn('[CDP Orchestrator] recordExecution failed', e && e.message);
  }
}

async function getExecutionHistory(profileName, limit) {
  try {
    return await scriptExecutor.getExecutionHistory(profileName, limit);
  } catch {
    return [];
  }
}

async function shutdown() {
  elog.info('[CDP Orchestrator] shutting down…');
  const deadline = Date.now() + 30_000;
  while ([...launches.values()].some((s) => s.phase !== 'ready' && s.phase !== 'failed') && Date.now() < deadline) {
    await sleep(500);
  }
  await connectionManager.cleanupAllConnections().catch(() => {});
  launches.clear();
  elog.info('[CDP Orchestrator] shutdown complete');
}

module.exports = {
  initialize,

  // launch lifecycle
  ensureProfileRunning,
  onCdpReady,
  onProfileStopped,
  onBrowserCrashed,

  // tasks
  executeTask,
  executeTaskNow,
  withProfileLock,

  // status / lookup
  hasCDPAvailable,
  getProfileNameForAccount,
  getStats,

  // debug
  testConnection,
  recordExecution,
  getExecutionHistory,

  // shutdown
  shutdown,

  // utilities
  broadcastLaunchProgress,
  sleep,
};
