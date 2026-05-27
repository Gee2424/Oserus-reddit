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
  { key: 'page.reddit-api',    group: 'Pages',      label: 'Reddit API workspace' },
  { key: 'page.operations',    group: 'Pages',      label: 'Operations' },
  { key: 'page.subreddits',    group: 'Pages',      label: 'Warm-up subs' },
  { key: 'page.team',          group: 'Pages',      label: 'Team' },
  { key: 'page.activity',      group: 'Pages',      label: 'Activity log' },
  { key: 'page.docs',          group: 'Pages',      label: 'Docs' },
  { key: 'page.settings',      group: 'Pages',      label: 'Settings' },
  { key: 'page.reddit',        group: 'Pages',      label: 'Reddit browser' },
  { key: 'page.redgifs',       group: 'Pages',      label: 'RedGifs browser' },
  { key: 'page.webviews',      group: 'Pages',      label: 'Custom pages' },

  // Reddit API workspace tabs
  { key: 'redditapi.posting',  group: 'Reddit API', label: 'Posting tab (Scheduler)' },
  { key: 'redditapi.reddit',   group: 'Reddit API', label: 'Reddit tab (Logins)' },
  { key: 'redditapi.inbox',    group: 'Reddit API', label: 'Inbox tab' },

  // Infrastructure tabs / actions
  { key: 'infra.proxies.view',          group: 'Infrastructure', label: 'See Proxies tab' },
  { key: 'infra.proxies.manage',        group: 'Infrastructure', label: 'Create / edit / delete proxies' },
  { key: 'infra.upvotes.view',          group: 'Infrastructure', label: 'See Upvotes tab' },
  { key: 'infra.upvotes.place_order',   group: 'Infrastructure', label: 'Place upvote orders' },
  { key: 'infra.upvotes.admin',         group: 'Infrastructure', label: 'Admin upvote settings (API keys, services)' },

  // Models / accounts
  { key: 'profiles.manage',    group: 'Models',     label: 'Create / edit / delete model profiles' },
  { key: 'accounts.create',    group: 'Models',     label: 'Add Reddit/RedGifs accounts' },
  { key: 'accounts.edit',      group: 'Models',     label: 'Edit accounts' },
  { key: 'accounts.delete',    group: 'Models',     label: 'Delete accounts' },
  { key: 'accounts.bulk_import', group: 'Models',   label: 'Bulk import accounts' },

  // Posts / scheduling
  { key: 'posts.publish',      group: 'Posting',    label: 'Publish posts on behalf of accounts' },

  // Subreddits
  { key: 'subreddits.manage',  group: 'Subreddits', label: 'Manage warm-up subreddits' },

  // Activity
  { key: 'activity.view',      group: 'Activity',   label: 'View activity log' },

  // Docs
  { key: 'docs.manage',        group: 'Docs',       label: 'Create / edit / delete docs' },

  // Settings / system
  { key: 'settings.admin',     group: 'Settings',   label: 'Edit admin-only settings' },
  { key: 'ai.admin',           group: 'Settings',   label: 'Edit AI / API keys' },
  { key: 'webviews.manage',    group: 'Settings',   label: 'Manage custom webview pages' },

  // Team / users
  { key: 'users.manage',       group: 'Team',       label: 'Create / edit / delete users' },
  { key: 'users.assign_admin', group: 'Team',       label: 'Promote users to admin' },
  { key: 'roles.manage',       group: 'Team',       label: 'Create / edit / delete custom roles' },
];

const PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);

// Builtin role definitions — seeded on first run. Existing installs migrate
// existing users.role values into these keys (already named admin/manager/
// reddit_va/chatter).
const BUILTIN_ROLES = [
  {
    key: 'admin',
    label: 'Admin',
    description: 'Full access to everything.',
    permissions: PERMISSION_KEYS, // all
  },
  {
    key: 'manager',
    label: 'Manager',
    description: 'Day-to-day operations. Cannot promote admins or edit API keys.',
    permissions: PERMISSION_KEYS.filter((k) => ![
      'users.assign_admin',
      'roles.manage',
      'settings.admin',
      'ai.admin',
      'infra.upvotes.admin',
    ].includes(k)),
  },
  {
    key: 'reddit_va',
    label: 'Reddit VA',
    description: 'Reddit assistant. Can post, place upvotes, view proxies.',
    permissions: [
      'page.dashboard', 'page.analytics', 'page.profiles', 'page.reddit-api',
      'page.operations', 'page.subreddits', 'page.docs',
      'page.settings', 'page.reddit', 'page.redgifs', 'page.webviews',
      'redditapi.posting', 'redditapi.reddit', 'redditapi.inbox',
      'infra.upvotes.view', 'infra.upvotes.place_order',
      'posts.publish',
    ],
  },
  {
    key: 'chatter',
    label: 'Chatter',
    description: 'DM/inbox only. No posting or admin actions.',
    permissions: [
      'page.dashboard', 'page.analytics', 'page.profiles', 'page.reddit-api',
      'page.docs', 'page.settings', 'page.reddit',
      'redditapi.reddit', 'redditapi.inbox',
    ],
  },
];

const BUILTIN_ROLE_KEYS = BUILTIN_ROLES.map((r) => r.key);

module.exports = {
  PERMISSIONS,
  PERMISSION_KEYS,
  BUILTIN_ROLES,
  BUILTIN_ROLE_KEYS,
};
