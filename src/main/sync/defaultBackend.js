// Central backend defaults — baked into the build so every installed
// copy of Oserus Management auto-connects to the same Supabase project
// on first launch.
//
// ┌────────────────────────────────────────────────────────────────┐
// │ ADMIN — set these values ONCE before publishing a release.    │
// │ All operators who install that build will join this backend.   │
// │                                                                │
// │ Where to find them:                                            │
// │   Supabase Dashboard → Project Settings → API                  │
// │     • URL       → SUPABASE_URL                                 │
// │     • anon public key (the long JWT) → SUPABASE_ANON_KEY       │
// │                                                                │
// │ Don't put the service-role key here. Anon-only.                │
// └────────────────────────────────────────────────────────────────┘
//
// When SUPABASE_URL is empty, the app falls back to per-install
// configuration (the Settings → Cloud sync panel). When it's filled,
// new installs auto-enable sync on first launch using these values
// unless an admin has overridden them locally.

const SUPABASE_URL = 'https://zjqnblddfcumknjepynp.supabase.co';

// Paste the anon (public) JWT here. Safe to ship — it's the same key
// the Supabase JS SDK uses in any web client; row-level-security on
// the project is what actually gates access.
const SUPABASE_ANON_KEY = '';

module.exports = {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  hasBakedBackend() {
    return !!(SUPABASE_URL && SUPABASE_ANON_KEY);
  },
};
