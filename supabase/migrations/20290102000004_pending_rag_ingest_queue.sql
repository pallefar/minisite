-- Phase 62 Plan 01 — pending_rag_ingest queue table + on-publish trigger
-- =============================================================================
--
-- Creates the async RAG feedback loop (INSIGHTS-09):
--   1. public.pending_rag_ingest — queue table, one row per publication needing ingest
--   2. public.tg_enqueue_rag_ingest() — trigger function fires on status→'published'
--   3. Trigger enqueue_rag_ingest_on_publish on research_publications AFTER UPDATE
--
-- Design: publish action is DECOUPLED from RAG ingestion latency.
--   Admin publishes → trigger inserts pending_rag_ingest row → Phase 60 ingest
--   cron polls pending queue → chunks + embeds with source_type='leanshot_research'.
--
-- Trigger fires ONLY on status transition to 'published' (not on every UPDATE).
--   ON CONFLICT DO NOTHING prevents duplicate queue entries on accidental re-publish.
--
-- Per [[feedback_fn_deploy_before_cron_db_push]]: per-Fn cron jobs NOT registered
--   here — cron registration lives in 62-08 close-out.
--
-- Per [[reference_supabase_back_dated_migration_blocks_push]] — timestamp 20290102+
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. public.pending_rag_ingest — queue table
-- ---------------------------------------------------------------------------

create table if not exists public.pending_rag_ingest (
  id              uuid        not null default gen_random_uuid() primary key,
  publication_id  uuid        not null references public.research_publications(id) on delete cascade,
  queued_at       timestamptz not null default now(),
  picked_at       timestamptz,
  completed_at    timestamptz,
  error_message   text
);

-- Partial index: fast scan for unpicked queue entries (ingest cron WHERE picked_at IS NULL)
create index if not exists idx_pending_rag_ingest_unpicked
  on public.pending_rag_ingest(queued_at)
  where picked_at is null;

-- ---------------------------------------------------------------------------
-- 2. public.tg_enqueue_rag_ingest() — trigger function
--    Fires AFTER UPDATE on research_publications.
--    Inserts into pending_rag_ingest ONLY on status transition to 'published'.
--    ON CONFLICT DO NOTHING: idempotent against accidental double-publish.
-- ---------------------------------------------------------------------------

create or replace function public.tg_enqueue_rag_ingest()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'published'
     and (old.status is null or old.status <> 'published')
  then
    insert into public.pending_rag_ingest(publication_id, queued_at)
    values (new.id, now())
    on conflict do nothing;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Trigger on research_publications — idempotent via pg_trigger check
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'enqueue_rag_ingest_on_publish'
      and tgrelid = 'public.research_publications'::regclass
  ) then
    create trigger enqueue_rag_ingest_on_publish
      after update on public.research_publications
      for each row execute function public.tg_enqueue_rag_ingest();
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. RLS on pending_rag_ingest
-- ---------------------------------------------------------------------------

alter table public.pending_rag_ingest enable row level security;

drop policy if exists "staff_all_pending_rag_ingest" on public.pending_rag_ingest;
create policy "staff_all_pending_rag_ingest"
  on public.pending_rag_ingest
  for all
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

commit;
