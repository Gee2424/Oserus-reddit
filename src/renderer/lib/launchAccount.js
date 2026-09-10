// Single entry point for "open this account's browser." Mode resolution
// (Electron vs CloakManager) happens server-side in oserus-browser:openAccount
// — this never talks to window.api.cloakmanager directly, so there is only
// one place that can get the branching logic wrong.
export async function launchAccountBrowser({ token, accountId, startAccount }) {
  await startAccount(accountId);
  return window.api.oserusBrowser.openAccount({ token, accountId });
}

// Open a MODEL's browser — one window, one tab per linked account (Electron
// mode) or the shared CloakManager browser (CM mode). Mode resolution is
// server-side in oserus-browser:openForModel.
export async function launchModelBrowser({ token, profileId }) {
  return window.api.oserusBrowser.openForModel({ token, profileId: Number(profileId) });
}
