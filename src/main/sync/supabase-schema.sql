-- Run this in Supabase SQL Editor before enabling sync.
-- Idempotent: safe to re-run. Mirrors every local table that Oserus
-- Management replicates across machines so any change on one operator's
-- box reaches everyone else within ~1-2 seconds.
--
-- The schema rewrite in 0.85.0 dropped placeholder `(id, data)` rows for
-- tables whose local schema is actually wide (model_profiles,
-- scheduled_posts, etc.). Pushes for those tables used to fail with
-- "column X does not exist". The list below mirrors the live SQLite
-- columns one-for-one so upserts succeed end-to-end.

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
-- Every column listed here mirrors an existing local SQLite column so
-- the JS-side rowToPayload() can upsert without "column does not
-- exist" errors. Type-loose (text everywhere except integer counters
-- and the bigint updated_at watermark) so older app versions don't
-- break when newer ones add fields — adding a new local column is a
-- one-line ALTER TABLE here, no app downtime.
--
-- updated_at is the watermark for push and pull. SQLite triggers
-- (see ensureUpdatedAtColumns in syncSchema.js) maintain it as
-- epoch millis on every INSERT/UPDATE.

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
  user_agent text,
  os_profile text,
  fingerprint_json text,
  geo_timezone text,
  geo_country text,
  geo_checked_at text,
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
  rotation_url text,
  rotation_minutes integer,
  session_user_template text,
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

-- ─────────────────────────── RLS + anon access
--
-- Sync uses the anon (publishable) key. Real gating happens at the
-- Supabase project level (private project, only your team holds the
-- URL + key). Within the project we let anon read+write every synced
-- table.

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
--
-- Add every synced table to the supabase_realtime publication so the
-- client receives INSERT/UPDATE/DELETE notifications.

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
    begin
      execute format('alter publication supabase_realtime add table %I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
