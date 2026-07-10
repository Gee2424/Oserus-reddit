-- Run this in Supabase SQL Editor before enabling sync.
-- Idempotent: safe to re-run.
--
-- This schema supports the Oserus Management team architecture:
-- Postgres is authoritative, local SQLite is cache.
--
-- Phase 0: Old anon_all policies are kept for backward compatibility
-- with the existing sync engine. They will be replaced with scoped
-- RLS policies in Phase 4 when the sync rewire is complete.

-- ─────────────────────────── append-only event logs

create table if not exists activity_log (
  id bigint primary key,
  user_id bigint,
  username text,
  action text not null,
  entity_type text,
  entity_id bigint,
  detail text,
  created_at timestamptz not null default now()
);
create index if not exists idx_activity_log_created on activity_log(created_at desc);

create table if not exists post_events (
  id bigint primary key,
  team_id uuid,
  platform text not null,
  account_id bigint not null,
  profile_id bigint,
  subreddit text,
  title text,
  remote_id text,
  status text not null default 'posted',
  source text not null default 'manual',
  error text,
  created_by_user_id bigint,
  created_at timestamptz not null default now()
);
create index if not exists idx_post_events_created on post_events(created_at desc);

create table if not exists auto_comment_runs (
  id bigint primary key,
  account_id bigint not null,
  subreddit text,
  post_id text,
  post_title text,
  comment_text text,
  status text,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists idx_auto_comment_runs_created on auto_comment_runs(created_at desc);

create table if not exists engagement_sessions (
  id bigint primary key,
  account_id bigint not null,
  platform text not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  seconds integer,
  posts_seen integer not null default 0,
  likes integer not null default 0,
  follows integer not null default 0,
  comments integer not null default 0,
  error text
);
create index if not exists idx_engagement_sessions_started on engagement_sessions(started_at desc);

-- ─────────────────────────── team-shared editable tables

create table if not exists users (
  id bigint primary key,
  username text,
  password_hash text,
  role text,
  display_name text,
  email text,
  phone text,
  notes text,
  avatar_color text,
  created_at text,
  last_seen_at text,
  last_action_at text,
  today_seconds integer not null default 0,
  today_date text,
  updated_at bigint not null default 0
);

create table if not exists model_profiles (
  id bigint primary key,
  name text,
  assigned_user_id bigint,
  niche text,
  brand_voice text,
  notes text,
  avatar_color text,
  proxy_id bigint,
  main_email text,
  fingerprint_json text,
  os_profile text,
  geo_timezone text,
  geo_country text,
  geo_checked_at text,
  team_id uuid,
  created_at text,
  updated_at bigint not null default 0
);

create table if not exists reddit_accounts (
  id bigint primary key,
  profile_id bigint,
  platform text,
  username text,
  partition_key text,
  status text,
  proxy_id bigint,
  notes text,
  user_agent text,
  os_profile text,
  fingerprint_json text,
  geo_timezone text,
  geo_country text,
  geo_checked_at text,
  team_id uuid,
  created_at text,
  updated_at bigint not null default 0
);

create table if not exists proxies (
  id bigint primary key,
  label text,
  kind text,
  host text,
  port integer,
  username text,
  rotation_url text,
  rotation_minutes integer,
  session_user_template text,
  team_id uuid,
  created_at text,
  updated_at bigint not null default 0
);

create table if not exists posting_protocols (
  id bigint primary key,
  scope text,
  scope_id text,
  config_json text,
  updated_at bigint not null default 0
);

create table if not exists engagement_protocols (
  account_id bigint primary key,
  enabled integer not null default 0,
  sessions_per_day integer,
  session_minutes_min integer,
  session_minutes_max integer,
  like_rate_pct integer,
  follow_rate_pct integer,
  watch_full_rate_pct integer,
  comment_rate_pct integer,
  comment_videos_only integer,
  hashtags_json text,
  follow_list_json text,
  last_run_at text,
  updated_at bigint not null default 0
);

create table if not exists auto_comment_protocols (
  account_id bigint primary key,
  enabled integer not null default 0,
  target_subs_json text,
  comments_per_day integer,
  session_minutes_min integer,
  session_minutes_max integer,
  last_run_at text,
  updated_at bigint not null default 0
);

create table if not exists autopilot_protocols (
  id bigint primary key,
  profile_id bigint,
  platform text,
  enabled integer not null default 0,
  sessions_per_day integer,
  session_minutes_min integer,
  session_minutes_max integer,
  hours_between_min real,
  hours_between_max real,
  daily_cap_comments integer,
  daily_cap_posts integer,
  quiet_start integer,
  quiet_end integer,
  like_rate_pct integer,
  follow_rate_pct integer,
  watch_full_rate_pct integer,
  comment_rate_pct integer,
  comment_videos_only integer,
  min_upvote_ratio real,
  min_post_score integer,
  nsfw_only integer,
  hashtags_json text,
  follow_list_json text,
  target_filter_json text,
  target_subs_json text,
  comment_persona text,
  comment_prompt text,
  ai_provider text,
  posts_per_day integer,
  last_run_at text,
  last_post_at text,
  created_at text,
  updated_at bigint not null default 0
);

create table if not exists scheduled_posts (
  id bigint primary key,
  account_id bigint,
  platform text,
  profile_id bigint,
  subreddit text,
  title text,
  body text,
  kind text,
  url text,
  scheduled_for text,
  status text,
  error text,
  created_by_user_id bigint,
  created_at text,
  posted_at text,
  posted_url text,
  auto_generate integer,
  updated_at bigint not null default 0
);

create table if not exists content_sources (
  id bigint primary key,
  platform text,
  scope text,
  scope_id bigint,
  kind text,
  name text,
  description text,
  metadata_json text,
  created_at text,
  updated_at bigint not null default 0
);

create table if not exists warmup_subreddits (
  id bigint primary key,
  name text,
  description text,
  vibe text,
  created_at text,
  updated_at bigint not null default 0
);

create table if not exists promo_subreddits (
  id bigint primary key,
  profile_id bigint,
  name text,
  description text,
  created_at text,
  updated_at bigint not null default 0
);

create table if not exists messaging_templates (
  id bigint primary key,
  name text,
  body text,
  scope text,
  profile_id bigint,
  created_by_user_id bigint,
  created_at text,
  updated_at bigint not null default 0
);

create table if not exists messaging_rules (
  id bigint primary key,
  name text,
  enabled integer not null default 1,
  profile_id bigint,
  account_id bigint,
  match_pattern text,
  template_id bigint,
  daily_limit integer,
  created_by_user_id bigint,
  created_at text,
  last_fired_at text,
  updated_at bigint not null default 0
);

create table if not exists schedule_templates (
  id bigint primary key,
  name text,
  status text,
  accounts_json text,
  subreddits_json text,
  cadence_min_h real,
  cadence_max_h real,
  posts_per_account integer,
  created_by_user_id bigint,
  created_at text,
  last_started_at text,
  updated_at bigint not null default 0
);

create table if not exists docs (
  id bigint primary key,
  title text,
  body text,
  profile_id bigint,
  author_user_id bigint,
  created_at text,
  updated_at bigint not null default 0
);

create table if not exists homepage_tiles (
  id bigint primary key,
  label text,
  url text,
  color text,
  sort_order integer not null default 0,
  created_at text,
  updated_at bigint not null default 0
);

create table if not exists roles (
  key text primary key,
  label text,
  description text,
  is_builtin integer not null default 0,
  created_at text,
  updated_at bigint not null default 0
);

create table if not exists role_permissions (
  role_key text not null,
  perm_key text not null,
  updated_at bigint not null default 0,
  primary key (role_key, perm_key)
);

create table if not exists settings (
  key text primary key,
  value text,
  updated_at bigint not null default 0
);

-- ─────────────────────────── team model tables (new architecture)

create table if not exists teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_user_id uuid not null,
  encrypted_key text,
  key_version integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists team_members (
  team_id uuid not null references teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'manager', 'member')),
  joined_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

create table if not exists account_assignments (
  social_account_id bigint not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  access_level text not null default 'use' check (access_level in ('use', 'manage')),
  assigned_at timestamptz not null default now(),
  primary key (social_account_id, user_id)
);

create table if not exists machine_sessions (
  machine_id text primary key,
  team_id uuid not null references teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  label text,
  last_seen_at timestamptz not null default now(),
  autopilot_enabled boolean not null default true,
  app_version text
);

-- post_locks had a different schema in earlier versions (social_account_id,
-- holder_user_id instead of platform/account_id/holder). Locks are ephemeral
-- (expire after TTL), so drop-and-recreate is safe.
DROP TABLE IF EXISTS post_locks CASCADE;
create table if not exists post_locks (
  id uuid primary key default gen_random_uuid(),
  team_id uuid,
  platform text not null,
  account_id bigint not null,
  holder text not null,
  acquired_at timestamptz not null default now(),
  expires_at timestamptz not null,
  unique (platform, account_id)
);

create table if not exists team_invitations (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  email text not null,
  role text not null default 'member' check (role in ('admin', 'manager', 'member')),
  invited_by uuid not null references auth.users(id),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  unique(team_id, email)
);

-- Shared credentials: login passwords shared across team members
-- Application-level encrypted with the team's AES-256-GCM key.
create table if not exists shared_credentials (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  account_id bigint not null,
  credential_type text not null check (credential_type in ('account_password', 'email_password')),
  encrypted_payload text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(team_id, account_id, credential_type)
);

-- Per-user wrapped copies of the team encryption key.
-- Each team member gets the team key encrypted with a key
-- derived from the service_role key + their user_id.
create table if not exists team_key_shares (
  team_id uuid not null references teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  wrapped_key text not null,
  key_version integer not null default 1,
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

-- ─────────────────────────── ensure new columns on existing tables
-- These tables may already exist from previous schema runs.
-- ALTER TABLE ADD COLUMN IF NOT EXISTS is idempotent (Postgres 9.6+).

ALTER TABLE IF EXISTS model_profiles    ADD COLUMN IF NOT EXISTS team_id uuid;
ALTER TABLE IF EXISTS reddit_accounts   ADD COLUMN IF NOT EXISTS team_id uuid;
ALTER TABLE IF EXISTS proxies           ADD COLUMN IF NOT EXISTS team_id uuid;
ALTER TABLE IF EXISTS post_events       ADD COLUMN IF NOT EXISTS team_id uuid;
ALTER TABLE IF EXISTS teams             ADD COLUMN IF NOT EXISTS encrypted_key text;
ALTER TABLE IF EXISTS teams             ADD COLUMN IF NOT EXISTS key_version integer NOT NULL DEFAULT 0;

-- ─────────────────────────── SECURITY DEFINER helper functions
--
-- team_members' own RLS policies (and ~26 other policies across this file)
-- need to check "does auth.uid() belong to / have a role on team X" by
-- querying team_members. Doing that with a plain subquery inside a
-- team_members policy is self-referential: Postgres re-applies
-- team_members' RLS to evaluate the subquery, which re-triggers the same
-- policy, forever. These SECURITY DEFINER functions read team_members
-- with RLS bypassed, breaking the recursion. Every policy below that
-- needs to check team membership/role goes through one of these instead
-- of querying team_members directly.

drop function if exists public.user_team_ids() cascade;
create function public.user_team_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select team_id from public.team_members where user_id = auth.uid();
$$;

drop function if exists public.user_has_role_on_team(uuid, text[]) cascade;
create function public.user_has_role_on_team(p_team_id uuid, p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.team_members
    where user_id = auth.uid()
      and team_id = p_team_id
      and role = any(p_roles)
  );
$$;

drop function if exists public.user_has_any_role(text[]) cascade;
create function public.user_has_any_role(p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.team_members
    where user_id = auth.uid()
      and role = any(p_roles)
  );
$$;

grant execute on function public.user_team_ids() to authenticated;
grant execute on function public.user_has_role_on_team(uuid, text[]) to authenticated;
grant execute on function public.user_has_any_role(text[]) to authenticated;

-- These functions run per-row on every policy check below, so make sure
-- the lookups they do are index-backed.
create index if not exists idx_team_members_user_id on team_members(user_id);
create index if not exists idx_team_members_user_team on team_members(user_id, team_id);

-- ─────────────────────────── RLS policies for new tables

alter table teams enable row level security;
alter table team_members enable row level security;
alter table account_assignments enable row level security;
alter table machine_sessions enable row level security;
alter table post_locks enable row level security;
alter table team_invitations enable row level security;
alter table shared_credentials enable row level security;
alter table team_key_shares enable row level security;

-- Team members can see their own team
drop policy if exists teams_select on teams;
create policy teams_select on teams
  for select to authenticated
  using (
    id in (select public.user_team_ids())
    or owner_user_id = auth.uid()
  );

-- A user creating their first team must be allowed to insert the teams
-- row itself (RLS was previously enabled here with no insert policy at
-- all, which blocked first-time team creation independently of the
-- team_members recursion bug below).
drop policy if exists teams_insert on teams;
create policy teams_insert on teams
  for insert to authenticated
  with check (
    owner_user_id = auth.uid()
  );

-- Only owners/admins can update team settings
drop policy if exists teams_update on teams;
create policy teams_update on teams
  for update to authenticated
  using (
    public.user_has_role_on_team(teams.id, array['owner', 'admin'])
  );

-- Team members: see all members of your teams
drop policy if exists team_members_select on team_members;
create policy team_members_select on team_members
  for select to authenticated
  using (
    user_id = auth.uid()
    or team_id in (select public.user_team_ids())
  );

-- Owners/admins/managers can manage members. First-time team creation
-- also allows a user to insert themselves as 'owner' on a team they
-- just created (checked against teams, not team_members, to avoid
-- requiring a team_members row before the first one can be inserted).
drop policy if exists team_members_insert on team_members;
create policy team_members_insert on team_members
  for insert to authenticated
  with check (
    public.user_has_role_on_team(team_id, array['owner', 'admin', 'manager'])
    or (
      user_id = auth.uid()
      and role = 'owner'
      and team_id in (select id from public.teams where owner_user_id = auth.uid())
    )
  );

drop policy if exists team_members_delete on team_members;
create policy team_members_delete on team_members
  for delete to authenticated
  using (
    public.user_has_role_on_team(team_members.team_id, array['owner', 'admin'])
  );

-- Account assignments: visible to owners/admins/managers, or the assigned user
-- NOTE: this checks role on ANY team, not the team that owns the account,
-- because account_assignments has no team_id column to scope by. That's
-- pre-existing behavior, preserved as-is here — flagged for a follow-up
-- decision, not fixed in this pass.
drop policy if exists account_assignments_select on account_assignments;
create policy account_assignments_select on account_assignments
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.user_has_any_role(array['owner', 'admin', 'manager'])
  );

-- Machine sessions: visible to owners/admins/managers, or own machine
drop policy if exists machine_sessions_select on machine_sessions;
create policy machine_sessions_select on machine_sessions
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.user_has_role_on_team(machine_sessions.team_id, array['owner', 'admin', 'manager'])
  );

-- Post locks: any authenticated user can manage (coordinated via unique constraint)
drop policy if exists post_locks_all on post_locks;
create policy post_locks_all on post_locks
  for all to authenticated
  using (true);

-- Team invitations: owners/admins can create and view
drop policy if exists team_invitations_select on team_invitations;
create policy team_invitations_select on team_invitations
  for select to authenticated
  using (
    email = (select email from auth.users where id = auth.uid())
    or public.user_has_role_on_team(team_invitations.team_id, array['owner', 'admin'])
  );

drop policy if exists team_invitations_insert on team_invitations;
create policy team_invitations_insert on team_invitations
  for insert to authenticated
  with check (
    public.user_has_role_on_team(team_invitations.team_id, array['owner', 'admin'])
  );

drop policy if exists team_invitations_update on team_invitations;
create policy team_invitations_update on team_invitations
  for update to authenticated
  using (
    email = (select email from auth.users where id = auth.uid())
  );

-- ─────────────────────────── RLS policies: shared credentials

-- shared_credentials: team members who are assigned to the account, or owners/admins/managers
drop policy if exists shared_credentials_select on shared_credentials;
create policy shared_credentials_select on shared_credentials
  for select to authenticated
  using (
    public.user_has_role_on_team(shared_credentials.team_id, array['owner', 'admin', 'manager'])
    or exists (
      select 1 from account_assignments aa
      where aa.social_account_id = shared_credentials.account_id
        and aa.user_id = auth.uid()
    )
  );

drop policy if exists shared_credentials_insert on shared_credentials;
create policy shared_credentials_insert on shared_credentials
  for insert to authenticated
  with check (
    public.user_has_role_on_team(shared_credentials.team_id, array['owner', 'admin', 'manager'])
  );

drop policy if exists shared_credentials_delete on shared_credentials;
create policy shared_credentials_delete on shared_credentials
  for delete to authenticated
  using (
    public.user_has_role_on_team(shared_credentials.team_id, array['owner', 'admin', 'manager'])
  );

-- team_key_shares: users see their own share; owners/admins see all
drop policy if exists team_key_shares_select on team_key_shares;
create policy team_key_shares_select on team_key_shares
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.user_has_role_on_team(team_key_shares.team_id, array['owner', 'admin'])
  );

drop policy if exists team_key_shares_insert on team_key_shares;
create policy team_key_shares_insert on team_key_shares
  for insert to authenticated
  with check (
    public.user_has_role_on_team(team_key_shares.team_id, array['owner', 'admin'])
  );

drop policy if exists team_key_shares_delete on team_key_shares;
create policy team_key_shares_delete on team_key_shares
  for delete to authenticated
  using (
    public.user_has_role_on_team(team_key_shares.team_id, array['owner', 'admin'])
  );

-- ─────────────────────────── RLS policies for data tables (team-scoped)

alter table reddit_accounts enable row level security;
alter table model_profiles enable row level security;
alter table proxies enable row level security;

-- reddit_accounts: team-scoped. Owners/admins/managers see all accounts
-- in the team. Members see only accounts assigned to them.
drop policy if exists reddit_accounts_select on reddit_accounts;
create policy reddit_accounts_select on reddit_accounts
  for select to authenticated
  using (
    team_id in (select public.user_team_ids())
    and (
      public.user_has_role_on_team(reddit_accounts.team_id, array['owner', 'admin', 'manager'])
      or exists (
        select 1 from account_assignments aa
        where aa.social_account_id = reddit_accounts.id
          and aa.user_id = auth.uid()
      )
    )
  );

drop policy if exists reddit_accounts_insert on reddit_accounts;
create policy reddit_accounts_insert on reddit_accounts
  for insert to authenticated
  with check (
    public.user_has_role_on_team(reddit_accounts.team_id, array['owner', 'admin', 'manager'])
  );

drop policy if exists reddit_accounts_update on reddit_accounts;
create policy reddit_accounts_update on reddit_accounts
  for update to authenticated
  using (
    public.user_has_role_on_team(reddit_accounts.team_id, array['owner', 'admin', 'manager'])
  );

drop policy if exists reddit_accounts_delete on reddit_accounts;
create policy reddit_accounts_delete on reddit_accounts
  for delete to authenticated
  using (
    public.user_has_role_on_team(reddit_accounts.team_id, array['owner', 'admin', 'manager'])
  );

-- model_profiles: team-scoped. Same pattern.
drop policy if exists model_profiles_select on model_profiles;
create policy model_profiles_select on model_profiles
  for select to authenticated
  using (
    team_id in (select public.user_team_ids())
  );

drop policy if exists model_profiles_insert on model_profiles;
create policy model_profiles_insert on model_profiles
  for insert to authenticated
  with check (
    public.user_has_role_on_team(model_profiles.team_id, array['owner', 'admin', 'manager'])
  );

drop policy if exists model_profiles_update on model_profiles;
create policy model_profiles_update on model_profiles
  for update to authenticated
  using (
    public.user_has_role_on_team(model_profiles.team_id, array['owner', 'admin', 'manager'])
  );

drop policy if exists model_profiles_delete on model_profiles;
create policy model_profiles_delete on model_profiles
  for delete to authenticated
  using (
    public.user_has_role_on_team(model_profiles.team_id, array['owner', 'admin', 'manager'])
  );

-- proxies: team-scoped. Same pattern.
drop policy if exists proxies_select on proxies;
create policy proxies_select on proxies
  for select to authenticated
  using (
    team_id in (select public.user_team_ids())
  );

drop policy if exists proxies_insert on proxies;
create policy proxies_insert on proxies
  for insert to authenticated
  with check (
    public.user_has_role_on_team(proxies.team_id, array['owner', 'admin', 'manager'])
  );

drop policy if exists proxies_update on proxies;
create policy proxies_update on proxies
  for update to authenticated
  using (
    public.user_has_role_on_team(proxies.team_id, array['owner', 'admin', 'manager'])
  );

drop policy if exists proxies_delete on proxies;
create policy proxies_delete on proxies
  for delete to authenticated
  using (
    public.user_has_role_on_team(proxies.team_id, array['owner', 'admin', 'manager'])
  );

-- ─────────────────────────── existing RLS + anon access (legacy sync)
-- These remain until Phase 4 when the sync rewire replaces them with
-- scoped RLS policies.

do $$
declare t text;
begin
  for t in select unnest(array[
    'activity_log','post_events','auto_comment_runs','engagement_sessions',
    'users','model_profiles','reddit_accounts','proxies',
    'autopilot_protocols','engagement_protocols','auto_comment_protocols',
    'posting_protocols','scheduled_posts',
    'content_sources','warmup_subreddits','promo_subreddits','homepage_tiles',
    'messaging_templates','messaging_rules','schedule_templates','docs',
    'roles','role_permissions','settings'
  ]) loop
    execute format('alter table %I enable row level security', t);
    if not exists (
      select 1 from pg_policies where tablename = t and policyname = 'anon_all'
    ) then
      execute format(
        'create policy anon_all on %I for all to anon using (true) with check (true)', t
      );
    end if;
  end loop;
end $$;

-- ─────────────────────────── Realtime publication

do $$
declare t text;
begin
  for t in select unnest(array[
    'activity_log','post_events','auto_comment_runs','engagement_sessions',
    'users','model_profiles','reddit_accounts','proxies',
    'autopilot_protocols','engagement_protocols','auto_comment_protocols',
    'posting_protocols','scheduled_posts',
    'content_sources','warmup_subreddits','promo_subreddits','homepage_tiles',
    'messaging_templates','messaging_rules','schedule_templates','docs',
    'roles','role_permissions','settings',
    'teams','team_members','account_assignments','machine_sessions','post_locks','team_invitations','shared_credentials','team_key_shares'
  ]) loop
    begin
      execute format('alter publication supabase_realtime add table %I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
