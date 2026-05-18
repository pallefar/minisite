-- Phase 50: rag_chunks — admin-reviewed scrape output per D-15/D-16/D-17/D-19/D-20/D-21/D-32
--
-- State machine (D-19): queued → approved | rejected → retracted; re-queued allows
-- a previously approved chunk to re-enter the queue after edit.
-- Transition functions own state writes (Plan 50-06); this plan owns the columns.
-- Dedup key (D-21): (topic_id, source_id, content_hash) unique to prevent re-scrape duplicates.
--
-- Idempotent.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_type
    where typname = 'rag_chunk_status' and typnamespace = 'public'::regnamespace
  ) then
    create type public.rag_chunk_status as enum (
      'queued', 'approved', 'rejected', 'retracted', 're-queued'
    );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_type
    where typname = 'rag_reject_reason' and typnamespace = 'public'::regnamespace
  ) then
    create type public.rag_reject_reason as enum (
      'off-topic',
      'factually-wrong',
      'off-label',
      'low-quality',
      'duplicate',
      'safety-concern'
    );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table if not exists public.rag_chunks (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.rag_topics(id) on delete cascade,
  source_id uuid not null references public.rag_sources(id),
  canonical_url text not null,
  source_text_excerpt text not null,
  summary text not null,
  quote_blocks jsonb default '[]'::jsonb,
  content_hash text not null,
  topic_tag text not null,
  source_tier public.rag_source_tier not null,
  status public.rag_chunk_status not null default 'queued',
  published_at timestamptz,
  retracted_at timestamptz,
  retracted_reason text,
  reject_reason public.rag_reject_reason,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  erratum_flag boolean not null default false,
  scraped_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  -- D-16: rejected ⇔ reject_reason populated
  constraint rag_chunks_rejected_reason_required
    check ((status = 'rejected') = (reject_reason is not null)),
  -- D-20: retracted ⇔ retracted_at populated
  constraint rag_chunks_retracted_at_required
    check ((status = 'retracted') = (retracted_at is not null))
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

-- Dedup: (topic_id, source_id, content_hash) unique per D-21
create unique index if not exists rag_chunks_dedup_uq
  on public.rag_chunks (topic_id, source_id, content_hash);

-- Queue scan: only queued rows, newest first
create index if not exists rag_chunks_queue_scan_idx
  on public.rag_chunks (status, scraped_at desc)
  where status = 'queued';

-- Published lookup per topic (retrieval / hub)
create index if not exists rag_chunks_published_idx
  on public.rag_chunks (topic_id, status)
  where published_at is not null;

-- 30-day rejection rolling window per source (D-16 source-quality monitoring)
create index if not exists rag_chunks_source_reviewed_idx
  on public.rag_chunks (source_id, reviewed_at);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.rag_chunks enable row level security;
