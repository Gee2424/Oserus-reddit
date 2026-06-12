-- Run this in Supabase SQL Editor before enabling sync.
-- Idempotent: safe to re-run. Mirrors every local table that Oserus
-- Management replicates across machines so any change on one operator's
-- box reaches everyone else within ~1-2 seconds.

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
--
-- All of these carry an `updated_at bigint` epoch-millis watermark.
-- The SQLite side maintains it via triggers (see syncSchema.js); the
-- server side just stores it and exposes it back to the watermark query.
-- Columns are intentionally permissive (text everywhere) so older app
-- versions don't break when newer ones add fields.

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
  created_at text,
  updated_at bigint not null default 0
);

create table if not exists reddit_accounts (
  id bigint primary key,
  profile_id bigint,
  platform text,
  username text,
  partition_key text,
  password_encrypted text,
  email text,
  email_password_encrypted text,
  status text,
  proxy_id bigint,
  notes text,
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
  password_encrypted text,
  created_at text,
  updated_at bigint not null default 0
);

create table if not exists posting_protocols (
  id bigint primary key,
  account_id bigint,
  data text,
  created_at text,
  updated_at bigint not null default 0
);

create table if not exists autopilot_protocols (
  id bigint primary key,
  scope text,
  scope_id bigint,
  platform text,
  enabled integer,
  data text,
  created_at text,
  updated_at bigint not null default 0
);

create table if not exists autopilot_prompts (
  id bigint primary key,
  platform text,
  kind text,
  prompt text,
  data text,
  created_at text,
  updated_at bigint not null default 0
);

create table if not exists engagement_protocols (
  id bigint primary key,
  account_id bigint,
  data text,
  created_at text,
  updated_at bigint not null default 0
);

create table if not exists auto_comment_protocols (
  id bigint primary key,
  account_id bigint,
  data text,
  created_at text,
  updated_at bigint not null default 0
);

create table if not exists scheduled_posts (
  id bigint primary key,
  account_id bigint,
  data text,
  status text,
  scheduled_for text,
  created_at text,
  updated_at bigint not null default 0
);

create table if not exists content_sources (
  id bigint primary key,
  data text,
  created_at text,
  updated_at bigint not null default 0
);

create table if not exists warmup_subreddits (
  id bigint primary key,
  name text,
  created_at text,
  updated_at bigint not null default 0
);

create table if not exists promo_subreddits (
  id bigint primary key,
  name text,
  created_at text,
  updated_at bigint not null default 0
);

create table if not exists messaging_templates (
  id bigint primary key,
  data text,
  created_at text,
  updated_at bigint not null default 0
);

create table if not exists messaging_rules (
  id bigint primary key,
  data text,
  created_at text,
  updated_at bigint not null default 0
);

create table if not exists homepage_tiles (
  id bigint primary key,
  data text,
  sort_order integer,
  created_at text,
  updated_at bigint not null default 0
);

create table if not exists schedule_templates (
  id bigint primary key,
  data text,
  created_at text,
  updated_at bigint not null default 0
);

create table if not exists docs (
  id bigint primary key,
  data text,
  created_at text,
  updated_at bigint not null default 0
);

create table if not exists roles (
  id bigint primary key,
  data text,
  created_at text,
  updated_at bigint not null default 0
);

create table if not exists role_permissions (
  id bigint primary key,
  data text,
  created_at text,
  updated_at bigint not null default 0
);

create table if not exists settings (
  key text primary key,
  value text,
  updated_at bigint not null default 0
);

-- ─────────────────────────── RLS + anon access
--
-- Sync uses the anon key. Real gating happens at the Supabase project
-- level (private project, only your team holds the URL+key). Within the
-- project we let anon read+write every synced table.

do $$
declare t text;
begin
  for t in select unnest(array[
    'activity_log','post_events','auto_comment_runs','engagement_sessions',
    'users','model_profiles','reddit_accounts','proxies','posting_protocols',
    'autopilot_protocols','autopilot_prompts','engagement_protocols',
    'auto_comment_protocols','scheduled_posts','content_sources',
    'warmup_subreddits','promo_subreddits','messaging_templates',
    'messaging_rules','homepage_tiles','schedule_templates','docs',
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
--
-- Add every synced table to the supabase_realtime publication so the
-- client receives INSERT/UPDATE/DELETE notifications.

do $$
declare t text;
begin
  for t in select unnest(array[
    'activity_log','post_events','auto_comment_runs','engagement_sessions',
    'users','model_profiles','reddit_accounts','proxies','posting_protocols',
    'autopilot_protocols','autopilot_prompts','engagement_protocols',
    'auto_comment_protocols','scheduled_posts','content_sources',
    'warmup_subreddits','promo_subreddits','messaging_templates',
    'messaging_rules','homepage_tiles','schedule_templates','docs',
    'roles','role_permissions','settings'
  ]) loop
    begin
      execute format('alter publication supabase_realtime add table %I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
