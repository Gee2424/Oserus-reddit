// Permission registry — single source of truth for both main and renderer.
// Permission keys are stable strings stored in DB (role_permissions.perm_key).
// Adding a permission: add the constant + put it in a group + assign to
// builtin roles below. Removing a permission: keep the key reserved so old
// rows in role_permissions still parse — or write a migration to clear it.

const PERMISSIONS = [
  // Pages — controls sidebar visibility AND blocks the page guard.
  { key: 'page.dashboard',     group: 'Pages',      label: 'Dashboard' },
  { key: 'page.analytics',     group: 'Pages',      label: 'Analytics' },
  { key: 'page.profiles',      group: 'Pages',      label: 'Models' },
  { key: 'page.reddit-api',    group: 'Pages',      label: 'Inbox' },
  { key: 'page.autopilot',     group: 'Pages',      label: 'Automation' },
  { key: 'page.scheduler',     group: 'Pages',      label: 'Scheduler' },
  { key: 'page.intel',         group: 'Pages',      label: 'Intelligence' },
  { key: 'page.scripts',       group: 'Pages',      label: 'Scripts' },
  { key: 'page.team',          group: 'Pages',      label: 'Team' },
  { key: 'page.settings',      group: 'Pages',      label: 'Settings / account' },
  { key: 'page.docs',          group: 'Pages',      label: 'Docs' },

  // Reserved legacy page keys — kept so old role_permissions rows parse.
  // Not shown in the Roles editor (filtered by group 'Legacy').
  { key: 'page.operations',    group: 'Legacy',     label: '(legacy) Operations' },
  { key: 'page.subreddits',    group: 'Legacy',     label: '(legacy) Warm-up subs' },
  { key: 'page.activity',      group: 'Legacy',     label: '(legacy) Activity log' },
  { key: 'page.reddit',        group: 'Legacy',     label: '(legacy) Reddit browser' },
  { key: 'page.redgifs',       group: 'Legacy',     label: '(legacy) RedGifs browser' },
  { key: 'page.webviews',      group: 'Legacy',     label: '(legacy) Custom pages' },
  { key: 'redditapi.posting',  group: 'Legacy',     label: '(legacy) Posting tab' },
  { key: 'redditapi.reddit',   group: 'Legacy',     label: '(legacy) Reddit tab' },
  { key: 'redditapi.inbox',    group: 'Legacy',     label: '(legacy) Inbox tab' },
  { key: 'infra.upvotes.view',        group: 'Legacy', label: '(legacy) See Upvotes tab' },
  { key: 'infra.upvotes.place_order', group: 'Legacy', label: '(legacy) Place upvote orders' },
  { key: 'infra.upvotes.admin',       group: 'Legacy', label: '(legacy) Admin upvote settings' },
  { key: 'subreddits.manage',  group: 'Legacy',     label: '(legacy) Manage warm-up subreddits' },
  { key: 'webviews.manage',    group: 'Legacy',     label: '(legacy) Manage custom webview pages' },

  // Infrastructure
  { key: 'infra.proxies.view',   group: 'Infrastructure', label: 'See Proxies' },
  { key: 'infra.proxies.manage', group: 'Infrastructure', label: 'Create / edit / delete proxies' },

  // Models / accounts
  { key: 'profiles.manage',      group: 'Models',   label: 'Create / edit / delete model profiles' },
  { key: 'accounts.create',      group: 'Models',   label: 'Add linked accounts' },
  { key: 'accounts.edit',        group: 'Models',   label: 'Edit accounts' },
  { key: 'accounts.delete',      group: 'Models',   label: 'Delete accounts' },
  { key: 'accounts.bulk_import', group: 'Models',   label: 'Bulk import accounts' },

  // Posts / scheduling
  { key: 'posts.publish',      group: 'Posting',    label: 'Publish posts on behalf of accounts' },
  { key: 'content.add',        group: 'Posting',    label: 'Add content (drafts / scheduled posts) from the Browser sidebar' },

  // Automation / engagement protocols
  { key: 'protocols.manage',   group: 'Automation', label: 'Edit engagement runs & autopilot protocols' },
  { key: 'protocols.run',      group: 'Automation', label: 'Run an engagement / autopilot pass manually' },

  // Scripts (content Sets)
  { key: 'scripts.manage',     group: 'Scripts',    label: 'Build & assign content Sets' },
  { key: 'scripts.use',        group: 'Scripts',    label: 'View & use content Sets for assigned models' },

  // Dashboard
  { key: 'dashboard.earnings', group: 'Dashboard',  label: 'See & enter earnings figures' },

  // Activity
  { key: 'activity.view',      group: 'Activity',   label: 'View activity log' },

  // Docs
  { key: 'docs.manage',        group: 'Docs',       label: 'Create / edit / delete docs' },

  // Team
  { key: 'users.manage',       group: 'Team',       label: 'Invite / edit / remove team members' },
  { key: 'users.assign_admin', group: 'Team',       label: 'Promote members to admin' },
  { key: 'roles.manage',       group: 'Team',       label: 'Create / edit / delete custom roles' },
  { key: 'team.schedule',      group: 'Team',       label: 'Create & edit shift schedules' },
  { key: 'team.admin_settings',group: 'Team',       label: 'Open the Team → Admin settings tab' },

  // Settings / system
  { key: 'settings.admin',     group: 'Settings',   label: 'Edit admin-only settings' },
  { key: 'ai.admin',           group: 'Settings',   label: 'Edit AI / API keys' },
];

const PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);

// ── Built-in roles ──────────────────────────────────────────────────────
//
// appflow.md permission table:
//   Dashboard ............... Owner / Admin / Manager
//   Team (full) ............. Owner / Admin / Manager   (Chatter/VA: own shift only)
//   Inbox .................. Owner / Admin              (Chatter: assigned models)
//   Browser/Automation/
//     Scheduler/Intel ...... Owner / Admin / VA
//   Scripts ................ Owner / Admin build        (Manager/Chatter use assigned)
//   Admin settings ......... Owner / Admin
//
// admin/owner get every key. Everyone gets 'page.settings' so they can
// still reach the "change my password" panel (the admin sections there
// self-gate on ai.admin); Phase 4 folds that panel into the Team page.

const EVERYONE = ['page.settings'];

const MANAGER_PERMISSIONS = [
  ...EVERYONE,
  'page.dashboard', 'dashboard.earnings',
  'page.analytics',
  'page.profiles', 'profiles.manage',
  'accounts.create', 'accounts.edit', 'accounts.delete', 'accounts.bulk_import',
  'page.team', 'team.schedule', 'users.manage',
  'page.scripts', 'scripts.use',
  'page.docs', 'docs.manage',
  'posts.publish', 'content.add',
  'activity.view',
  'infra.proxies.view',
].filter((p) => PERMISSION_KEYS.includes(p));

const CHATTER_PERMISSIONS = [
  ...EVERYONE,
  'page.profiles',
  'page.reddit-api',            // Inbox — assigned models only (assignment filter enforces)
  'page.team',                  // own shift only (Team page gates the management UI)
  'page.scripts', 'scripts.use',
  'content.add',
].filter((p) => PERMISSION_KEYS.includes(p));

const VA_PERMISSIONS = [
  ...EVERYONE,
  'page.profiles',
  'page.autopilot',             // Automation
  'page.scheduler',             // Scheduler
  'page.intel',                 // Intelligence
  'page.team',                  // own shift only
  'page.scripts', 'scripts.use',
  'protocols.manage', 'protocols.run',
  'posts.publish', 'content.add',
  'accounts.edit',
  'infra.proxies.view',
].filter((p) => PERMISSION_KEYS.includes(p));

const BUILTIN_ROLES = [
  {
    key: 'owner',
    label: 'Owner',
    description: 'Team owner — full access to everything.',
    permissions: PERMISSION_KEYS,
  },
  {
    key: 'admin',
    label: 'Admin',
    description: 'Full access to everything.',
    permissions: PERMISSION_KEYS,
  },
  {
    key: 'manager',
    label: 'Manager',
    description: 'Runs the roster — dashboard, models, analytics, team & shift scheduling, and Script building. No Browser / Automation / Inbox.',
    permissions: MANAGER_PERMISSIONS,
  },
  {
    key: 'chatter',
    label: 'Chatter',
    description: 'Handles messaging for assigned models — Inbox + Scripts only.',
    permissions: CHATTER_PERMISSIONS,
  },
  {
    key: 'va',
    label: 'VA',
    description: 'Runs Browser / Automation / Scheduler / Intelligence for assigned models. No Inbox, no dashboard.',
    permissions: VA_PERMISSIONS,
  },
];

const BUILTIN_ROLE_KEYS = BUILTIN_ROLES.map((r) => r.key);

module.exports = {
  PERMISSIONS,
  PERMISSION_KEYS,
  BUILTIN_ROLES,
  BUILTIN_ROLE_KEYS,
};
