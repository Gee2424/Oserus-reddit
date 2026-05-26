# Publishing a new version of Oserus Management

You don't need to install anything on your computer. GitHub builds the
`.exe` for you in the cloud, and every installed copy auto-updates within
3 hours.

## Whenever you want to ship a change

1. Open `package.json` and bump the `"version"` number.
   - Small fix: `0.8.0` → `0.8.1`
   - New feature: `0.8.0` → `0.9.0`
2. Commit the change in GitHub Desktop with a message like
   `Release v0.8.1`, then click **Push origin**.
3. In your browser, go to the repo on GitHub → **Releases** → **Draft a
   new release** → click **Choose a tag** and type `v0.8.1` (must match
   the version, with a leading `v`) → **Create new tag on publish** →
   **Publish release**.
4. Wait ~5–8 minutes. GitHub builds `Oserus-Management-Setup-0.8.1.exe`
   and attaches it to the release automatically.

That's it. Every running copy will detect the update within 3 hours,
download it silently in the background, and prompt the VA to restart.

## First-time setup (only once)

The repo has to be public **or** every VA's installed app needs a GitHub
token to read releases. Public is simplest — but the repo contents are
visible. If you want the repo private, ping Claude and we'll add a token
flow.

## Where to download the installer manually

GitHub repo → **Releases** → latest → download the `Setup` `.exe`.
Double-click to install. Start Menu shortcut + desktop icon appear.

## If a build fails

GitHub will email you. Open the repo → **Actions** tab → click the red
run to see the error. Paste it to Claude.
