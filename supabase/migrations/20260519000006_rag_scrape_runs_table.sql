-- Phase 50: rag_scrape_runs — per-topic-per-source scrape attempt log per D-26
--
-- Captures each scrape attempt (running → ok | partial | failed). Drives the
-- admin "Recent runs" surface and feeds the consecutive_failures roll-up on
-- rag_sources (Plan 50-04 owner: source-health worker).
--
-- Idempotent.

create table if not exists public.rag_scrape_runs (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.rag_topics(id) on delete cascade,
  source_id uuid references public.rag_sources(id),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null check (status in ('running', 'ok', 'partial', 'failed')) default 'running',
  chunks_found int not null default 0,
  error_message text,
  attempt int not null default 1
);

create index if not exists rag_scrape_runs_topic_idx
  on public.rag_scrape_runs (topic_id, started_at desc);

create index if not exists rag_scrape_runs_source_status_idx
  on public.rag_scrape_runs (source_id, status, completed_at desc);

alter table public.rag_scrape_runs enable row level security;
