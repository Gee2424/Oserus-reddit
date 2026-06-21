# Publishing a new version of Oserus Management

You don't need to install anything on your computer. GitHub builds the
`.exe` for you in the cloud, and every installed copy auto-updates
within ~3 hours of a new release.

## Whenever you want to ship a change

1. Open `package.json` and bump the `"version"` number.
   - Small fix: `0.85.5` → `0.85.6`
   - New feature: `0.85.5` → `0.86.0`
2. Commit the change in GitHub Desktop with a message like
   `Release v0.85.6`, then click **Push origin**.
3. In your browser, go to the repo on GitHub → **Actions** tab →
   **Release Windows installer** workflow (left sidebar) → click the
   **Run workflow** button on the right → pick the branch (usually
   `claude/pensive-bell-VtMGj` for in-progress work, `main` for the
   stable release) → click **Run workflow**.
4. Wait ~5–8 minutes. GitHub builds `Oserus-Management-Setup-<version>.exe`
   and attaches it to a GitHub Release automatically.

That's it. Every running copy detects the update within ~3 hours,
downloads it silently in the background, and prompts the VA to restart.

> **Don't push git tags from your local machine.** Tag pushes are
> blocked in our environment. The workflow_dispatch flow above is the
> standard path — it tags + builds + releases in one step.

## First-time setup (only once)

The repo has to be public **or** every VA's installed app needs a GitHub
token to read releases. Public is simplest, but the repo contents are
visible. If you want the repo private, ping Claude and we'll add a token
flow.

## Where to download the installer manually

GitHub repo → **Releases** → latest → download the `Setup` `.exe`.
Double-click to install. Start Menu shortcut + desktop icon appear.

## If a build fails

GitHub will email you. Open the repo → **Actions** tab → click the red
run to see the error. Paste it to Claude.

## Branch rules

All in-progress work happens on `claude/pensive-bell-VtMGj`. When you
want that work to become the live release branch:

1. GitHub Desktop → fetch / pull `main` so it's up to date.
2. Merge `claude/pensive-bell-VtMGj` into `main` (Claude can do this
   for you — ask in a Claude Code session).
3. Run the workflow against `main`.

Never push directly to `main` — go through the working branch.
