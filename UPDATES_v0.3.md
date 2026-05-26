# v0.3 changes

**Multi-role team system.** The single "creator" role is gone. Four roles now:

- **Admin** — full access to everything, including creating other admins
- **Manager** — almost everything: can create/edit non-admin team members, manage all model profiles, proxies, accounts. Can't touch admin accounts or create new admins.
- **Reddit VA** — posts to assigned model profiles on Reddit. Can browse/post but can't change team or proxies.
- **Chatter** — read-only access to assigned model profiles. Can see accounts but not post.

**Permissions enforced at every layer:**
- Sidebar shows only routes the user can access
- IPC handlers in the main process re-check permissions on every call (so the renderer can't bypass)
- Database constraint enforces only the 4 valid role strings

**Auto-migration.** If you've used v0.2, your existing `creator` users are automatically migrated to `reddit_va` on first launch. The migration prints to the console (it'll show in the cmd window when you run `npm run dev`).

**Updates to install:**
1. Stop the app (Ctrl+C in cmd if running)
2. Replace your project folder with this new zip's contents (keep your DB file safe in `%APPDATA%\reddit-manager\` — don't delete it, the migration will handle it)
3. Run `npm install` (only needed if package.json changed — it didn't, but doesn't hurt)
4. Run `npm run dev`
5. Sign in, go to **Team Profiles**, you'll see your existing users with the new role labels
