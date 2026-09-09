// Single source of truth for platform metadata. Every renderer file should
// import from here — if a brand color, login URL, or display label needs to
// change, this is the one place to touch it.
//
// On app startup, loadPlatforms() fetches the merged list (built-in +
// admin-configured) from the backend and caches it here.
//
// IMPORTANT: PLATFORMS is populated asynchronously (loadPlatforms() is an
// IPC round-trip, called once from App.jsx after login) and gets REASSIGNED
// (not mutated) each time it reloads. Never copy it into a module-top-level
// const in a consuming file — e.g. `const PLATFORMS = SHARED_PLATFORMS` —
// that snapshots whichever value existed at that file's first evaluation,
// which can be before loadPlatforms() has resolved, and it will never
// update again even after loadPlatforms()/refreshPlatforms() succeed. Read
// it live via usePlatforms() inside a component instead.

import { useSyncExternalStore } from 'react';

export let PLATFORMS = [];
export let PLATFORM_MAP = {};

const _listeners = new Set();
function _notify() { for (const fn of _listeners) fn(); }

/**
 * Fetch platforms from the backend and cache them.
 * Call this once on app mount before rendering.
 */
export async function loadPlatforms() {
  try {
    const res = await window.api.platforms.list();
    if (res.ok && res.platforms) {
      // Map DB rows to the shape renderer components expect
      PLATFORMS = res.platforms.map(p => ({
        v: p.key,
        label: p.label,
        short: p.short || p.key.charAt(0).toUpperCase(),
        color: p.color || '#888888',
        home: p.home_url || '',
        login: p.login_url || '',
        usernamePrefix: p.username_prefix || '@',
        icon: p.icon || null,
        isBuiltin: !!p.is_builtin,
      }));
      PLATFORM_MAP = Object.fromEntries(PLATFORMS.map(p => [p.v, p]));
      _notify();
    }
  } catch (e) {
    console.warn('[platforms] Failed to load platforms:', e?.message);
  }
}

/**
 * Refresh platforms after admin changes. Same as loadPlatforms but can
 * be called explicitly after a CRUD operation.
 */
export async function refreshPlatforms() {
  await loadPlatforms();
}

/**
 * Reactive read of the current platform list — re-renders the calling
 * component the instant loadPlatforms()/refreshPlatforms() updates it.
 */
export function usePlatforms() {
  return useSyncExternalStore(
    (onStoreChange) => { _listeners.add(onStoreChange); return () => _listeners.delete(onStoreChange); },
    () => PLATFORMS,
  );
}

export function platformColor(v)  { return (PLATFORM_MAP[v] || {}).color || '#888888'; }
export function platformLabel(v)  { return (PLATFORM_MAP[v] || {}).label || v || 'Unknown'; }
export function platformHome(v)   { return (PLATFORM_MAP[v] || {}).home || ''; }
export function platformShort(v)  { return (PLATFORM_MAP[v] || {}).short || (v || '?').charAt(0).toUpperCase(); }
export function platformIcon(v)   { return (PLATFORM_MAP[v] || {}).icon || '◈'; }
export function platformUsernamePrefix(v) { return (PLATFORM_MAP[v] || {}).usernamePrefix || '@'; }
export function isBuiltinPlatform(v) { return !!(PLATFORM_MAP[v] || {}).isBuiltin; }
