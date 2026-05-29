-- Oserus Management — multi-VA coordination schema (Supabase / Postgres)
--
-- Run this once in the Supabase SQL editor before enabling Cloud sync on the
-- Autopilot page. Then paste your project URL + service_role key there.
--
-- These two tables mirror the local SQLite ones the app already uses. When
-- Cloud sync is on, every VA's app reads/writes here instead, so the autopilot
-- coordinator across all machines sees one shared picture and never
-- double-posts an account.

-- Distributed lock. UNIQUE(platform, account_id) is what makes lock
-- acquisition atomic: a second machine's INSERT 409s and it backs off.
create table if not exists post_locks (
  platform     text    not null,
  account_id   bigint  not null,
  holder       text,
  acquired_at  timestamptz not null default now(),
  expires_at   timestamptz not null,
  primary key (platform, account_id)
);

-- Shared post log — the source of truth for "who posted what, when".
create table if not exists post_events (
  id                  bigint generated always as identity primary key,
  platform            text   not null,
  account_id          bigint not null,
  profile_id          bigint,
  subreddit           text,
  title               text,
  remote_id           text,
  status              text   not null default 'posted',  -- posted | failed | skipped
  source              text   not null default 'manual',  -- manual | auto | scheduled
  error               text,
  created_by_user_id  bigint,
  created_at          timestamptz not null default now()
);

create index if not exists post_events_lookup
  on post_events (platform, account_id, status, created_at desc);

-- The app authenticates with the service_role key (server-to-server from each
-- desktop app). If you'd rather use anon keys + RLS, add policies here.
