# CLAUDE.md — session notes for Oserus Management

See `HANDOFF.md` for full project context. This file holds workflow preferences.

## Releases

The user's preferred release flow, every time:

1. Bump version in `package.json`
2. Commit + push to the working branch
3. **User triggers** the GitHub Action manually: repo → **Actions** → **"Release Windows installer"** → **Run workflow** → pick the branch.

Do **not** push tags from this environment — tag pushes are blocked by the sandbox (HTTP 403). The `workflow_dispatch` button is the standard path. Don't propose other release methods unless the user asks.

## Branch

All work happens on `claude/pensive-bell-VtMGj`. Never push to `main` without explicit user permission.
