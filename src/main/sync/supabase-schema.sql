-- Run this in Supabase SQL Editor before enabling sync.
-- Idempotent: safe to re-run. Mirrors the four local SQLite tables that
-- Oserus Management syncs across machines.

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

alter table activity_log enable row level security;
alter table post_events enable row level security;
alter table auto_comment_runs enable row level security;
alter table engagement_sessions enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'activity_log' and policyname = 'anon_all') then
    create policy anon_all on activity_log for all to anon using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'post_events' and policyname = 'anon_all') then
    create policy anon_all on post_events for all to anon using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'auto_comment_runs' and policyname = 'anon_all') then
    create policy anon_all on auto_comment_runs for all to anon using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'engagement_sessions' and policyname = 'anon_all') then
    create policy anon_all on engagement_sessions for all to anon using (true) with check (true);
  end if;
end $$;

alter publication supabase_realtime add table activity_log, post_events, auto_comment_runs, engagement_sessions;
