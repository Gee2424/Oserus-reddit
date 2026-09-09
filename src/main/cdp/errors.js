/**
 * Structured CDP / CloakManager automation errors.
 *
 * Every failure in the launch → connect → run-scripts → task pipeline is
 * one of these, carrying:
 *   - `code`      — stable machine string (persisted, matched on, shown in UI)
 *   - `retryable` — whether the script executor may retry automatically
 *   - `attention` — whether the account should be flagged needs_attention
 *
 * Rule of thumb: anything that touches credentials or could be a
 * challenge / lockout / rate-limit signal is NEVER retryable and DOES
 * flag the account. Only pre-interaction transport failures retry.
 */

class CdpError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {{ retryable?: boolean, attention?: boolean, cause?: any }} [opts]
   */
  constructor(code, message, opts = {}) {
    super(message || code);
    this.name = 'CdpError';
    this.code = code;
    this.retryable = !!opts.retryable;
    this.attention = !!opts.attention;
    if (opts.cause) this.cause = opts.cause;
  }
}

// --- auth / identity: never retry, always flag the account ---------------
class AuthRejected extends CdpError {
  constructor(message, opts = {}) {
    super('auth_rejected', message || 'Login rejected — wrong username or password', { attention: true, ...opts, retryable: false });
    this.name = 'AuthRejected';
  }
}
class TwoFactorRequired extends CdpError {
  constructor(message, opts = {}) {
    super('two_factor_required', message || 'Reddit is asking for a 2FA code', { attention: true, ...opts, retryable: false });
    this.name = 'TwoFactorRequired';
  }
}
class NotLoggedIn extends CdpError {
  constructor(message, opts = {}) {
    super('not_logged_in', message || 'Account is not logged into Reddit', { attention: true, ...opts, retryable: false });
    this.name = 'NotLoggedIn';
  }
}
class ChallengeRequired extends CdpError {
  constructor(message, opts = {}) {
    super('challenge_required', message || 'Reddit is showing a captcha / verification challenge', { attention: true, ...opts, retryable: false });
    this.name = 'ChallengeRequired';
  }
}

// --- rate limiting: never retry inside one run (would compound) ----------
class RateLimited extends CdpError {
  constructor(message, opts = {}) {
    super('rate_limited', message || 'Reddit rate-limited this account', { attention: false, ...opts, retryable: false });
    this.name = 'RateLimited';
  }
}

// --- infrastructure: safe to retry (nothing was submitted yet) -----------
class TransportError extends CdpError {
  constructor(message, opts = {}) {
    super('transport_error', message || 'CDP transport error', { retryable: true, attention: false, ...opts });
    this.name = 'TransportError';
  }
}
class Timeout extends CdpError {
  constructor(message, opts = {}) {
    super('timeout', message || 'Operation timed out', { retryable: true, attention: false, ...opts });
    this.name = 'Timeout';
  }
}

// --- launch pipeline ----------------------------------------------------
class LaunchFailed extends CdpError {
  constructor(message, opts = {}) {
    super('launch_failed', message || 'CloakManager failed to launch the profile', { retryable: false, attention: false, ...opts });
    this.name = 'LaunchFailed';
  }
}
class CdpUnavailable extends CdpError {
  constructor(message, opts = {}) {
    super('cdp_unavailable', message || 'Profile is running but CDP is not reachable', { retryable: true, attention: false, ...opts });
    this.name = 'CdpUnavailable';
  }
}

// --- catch-all for a script that threw something we don't recognise -----
class ScriptError extends CdpError {
  constructor(message, opts = {}) {
    super('script_error', message || 'Script failed', { retryable: false, attention: false, ...opts });
    this.name = 'ScriptError';
  }
}

/**
 * Coerce an arbitrary thrown value into a CdpError.
 * Used at the boundary where legacy scripts still throw plain Error /
 * return `{ error: 'NOT_LOGGED_IN' }`-style strings.
 *
 * @param {any} err
 * @returns {CdpError}
 */
function toCdpError(err) {
  if (err instanceof CdpError) return err;
  const msg = (err && (err.message || String(err))) || 'Unknown error';
  const lower = msg.toLowerCase();

  if (/incorrect|wrong password|wrong username|bad password|invalid.*(password|username|credential)|incorrect_credentials/.test(lower)) {
    return new AuthRejected(msg, { cause: err });
  }
  if (/2fa|two.?factor|otp|verification code/.test(lower)) {
    return new TwoFactorRequired(msg, { cause: err });
  }
  if (/not logged in|not_logged_in|no modhash|logged out|401|403/.test(lower)) {
    return new NotLoggedIn(msg, { cause: err });
  }
  if (/captcha|prove you are human|are you a robot|challenge|verify you/.test(lower)) {
    return new ChallengeRequired(msg, { cause: err });
  }
  if (/429|too many requests|rate limit|try again later|doing that too much/.test(lower)) {
    return new RateLimited(msg, { cause: err });
  }
  if (/econnrefused|econnreset|etimedout|socket hang up|websocket|network|tunnel|proxy connection/.test(lower)) {
    return new TransportError(msg, { cause: err });
  }
  if (/timed out|timeout|deadline/.test(lower)) {
    return new Timeout(msg, { cause: err });
  }
  if (/target closed|session closed|browser has been closed|page.*closed/.test(lower)) {
    // mid-run disconnect — not safe to blindly retry a post, but not an
    // account problem either.
    return new CdpError('disconnected', msg, { retryable: false, attention: false, cause: err });
  }
  return new ScriptError(msg, { cause: err });
}

module.exports = {
  CdpError,
  AuthRejected,
  TwoFactorRequired,
  NotLoggedIn,
  ChallengeRequired,
  RateLimited,
  TransportError,
  Timeout,
  LaunchFailed,
  CdpUnavailable,
  ScriptError,
  toCdpError,
};
