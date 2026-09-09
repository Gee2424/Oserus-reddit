// Single entry point for "open this account's browser." Mode resolution
// (Electron vs CloakManager) happens server-side in oserus-browser:openAccount
// — this never talks to window.api.cloakmanager directly, so there is only
// one place that can get the branching logic wrong.
export async function launchAccountBrowser({ token, accountId, startAccount }) {
  await startAccount(accountId);
  return window.api.oserusBrowser.openAccount({ token, accountId });
}
