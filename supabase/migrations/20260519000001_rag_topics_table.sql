-- Phase 50: rag_topics — admin-curated research topic CRUD per D-08/D-09/D-12/D-13/D-14
--
-- Creates two enums + the rag_topics table + soft-delete-aware unique index +
-- updated_at trigger. RLS is enabled here; policies are defined in
-- 20260519000009_rag_rls_policies.sql.
--
-- Idempotent: all CREATE statements use IF NOT EXISTS / DO-block guards.

-- ---------------------------------------------------------------------------
-- Enums (DO-block guards because Postgres < 16 lacks CREATE TYPE IF NOT EXISTS)
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_type
    where typname = 'rag_topic_posture' and typnamespace = 'public'::regnamespace
  ) then
    create type public.rag_topic_posture as enum ('curated', 'open-web');
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_type
    where typname = 'rag_topic_cadence' and typnamespace = 'public'::regnamespace
  ) then
    create type public.rag_topic_cadence as enum ('daily', 'weekly', 'monthly', 'manual');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table if not exists public.rag_topics (
  id uuid primary key default gen_random_uuid(),
  query text not null,
  tag text not null,
  posture public.rag_topic_posture not null default 'curated',
  cadence public.rag_topic_cadence not null default 'weekly',
  next_scrape_at timestamptz,
  last_scraped_at timestamptz,
  created_by uuid references auth.users(id),
  last_edited_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

-- Unique active-topic index: (query) WHERE deleted_at IS NULL.
-- Per [[reference_supabase_migration_gotchas]] the predicate uses only IS NULL
-- on a column (IMMUTABLE), satisfying the partial-index requirement.
create unique index if not exists rag_topics_query_active_uq
  on public.rag_topics (query)
  where deleted_at is null;

create index if not exists rag_topics_tag_idx
  on public.rag_topics (tag);

create index if not exists rag_topics_next_scrape_idx
  on public.rag_topics (next_scrape_at)
  where deleted_at is null;

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------

create or replace function public.tg_rag_topics_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'trg_rag_topics_updated_at'
  ) then
    create trigger trg_rag_topics_updated_at
      before update on public.rag_topics
      for each row execute function public.tg_rag_topics_updated_at();
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.rag_topics enable row level security;
