-- Phase 62 Plan 01 — Research publications + review audit table + ENUM + RLS
-- =============================================================================
--
-- Creates the schema foundation for the LeanShot research publishing pipeline:
--   1. ENUM: public.research_publication_status (draft|in_review|published|archived)
--   2. public.research_publications  — one row per publication version
--   3. public.research_review_log    — append-only audit trail (ON DELETE CASCADE)
--
-- RLS enforcement:
--   - Staff tables: using (public.is_staff()) — mirrors Phase 61 RLS pattern
--   - Public read: status = 'published' for anon / authenticated
--
-- Idempotent: ENUM via DO-block pg_type guard, tables via IF NOT EXISTS,
--             policies via DROP IF EXISTS + bare CREATE POLICY (NO IF NOT EXISTS —
--             unsupported on remote PG per Phase 61 close-out lesson),
--             trigger via DO-block pg_trigger guard.
--
-- DO NOT db push here — close-out plan 62-08 owns push ordering.
-- Per [[reference_supabase_back_dated_migration_blocks_push]] — timestamp 20290102+
-- Per [[reference_supabase_is_staff_helper]] — uses public.is_staff() directly.
-- tg_set_updated_at() already exists from Phase 61 — NOT redefined here.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. ENUM: public.research_publication_status
--    Guard: DO block checks pg_type before creating to stay idempotent.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_type
    where typname = 'research_publication_status'
      and typnamespace = 'public'::regnamespace
  ) then
    create type public.research_publication_status as enum (
      'draft',
      'in_review',
      'published',
      'archived'
    );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. public.research_publications — one row per white-paper publication
--
--    publish-time DP fields (cohort_size, epsilon, suppressed_buckets) let the
--    DpMethodsFooter on /research/<slug> render real provenance numbers
--    from the publications row (per D-CONTEXT specifics on transparency).
--
--    reviewer_id != created_by enforced by SECDEF publish_research RPC (Plan 62-02)
--    SELF_REVIEW_REJECTED guard — two-person rule at the application layer.
-- ---------------------------------------------------------------------------

create table if not exists public.research_publications (
  id                  uuid                              not null default gen_random_uuid() primary key,
  slug                text                              not null unique,
  markdown_path       text                              not null,
  title               text                              not null,
  abstract            text,
  status              public.research_publication_status not null default 'draft',
  created_by          uuid                              references auth.users(id) on delete set null,
  reviewer_id         uuid                              references auth.users(id) on delete set null,
  published_at        timestamptz,
  -- Differential privacy metadata: rendered in /research/<slug> methods footer
  cohort_size         integer,
  epsilon             numeric default 0.5,
  suppressed_buckets  integer default 0,
  created_at          timestamptz                       not null default now(),
  updated_at          timestamptz                       not null default now()
);

-- Status lookup index (supports admin dashboard status-filter queries)
create index if not exists idx_research_publications_status
  on public.research_publications(status);

-- Slug lookup index (supports /research/<slug> resolution)
create index if not exists idx_research_publications_published_slug
  on public.research_publications(slug)
  where status = 'published';

-- ---------------------------------------------------------------------------
-- 3. public.research_review_log — append-only audit trail
--    ON DELETE CASCADE keeps audit trail together with the publication.
--    action CHECK mirrors Phase 61 protocol_review_log pattern.
-- ---------------------------------------------------------------------------

create table if not exists public.research_review_log (
  id              uuid        not null default gen_random_uuid() primary key,
  publication_id  uuid        not null references public.research_publications(id) on delete cascade,
  actor           uuid        references auth.users(id) on delete set null,
  action          text        not null check (action in (
                    'submitted', 'reviewed', 'published', 'archived', 'rejected'
                  )),
  notes           text,
  created_at      timestamptz not null default now()
);

-- Audit lookup index (newest-first for admin review timeline)
create index if not exists idx_research_review_log_publication
  on public.research_review_log(publication_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 4. Enable Row Level Security
-- ---------------------------------------------------------------------------

alter table public.research_publications  enable row level security;
alter table public.research_review_log    enable row level security;

-- ---------------------------------------------------------------------------
-- 5. RLS policies
--    Bare CREATE POLICY — NO `IF NOT EXISTS` (unsupported on remote PG).
--    DROP IF EXISTS first for idempotency.
-- ---------------------------------------------------------------------------

-- --- public.research_publications ---

drop policy if exists "staff_all_research_publications" on public.research_publications;
create policy "staff_all_research_publications"
  on public.research_publications
  for all
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- Public anon/authenticated SELECT for published papers (SEO-discoverable)
drop policy if exists "public_read_published_research" on public.research_publications;
create policy "public_read_published_research"
  on public.research_publications
  for select
  using (status = 'published');

-- --- public.research_review_log ---

drop policy if exists "staff_all_research_review_log" on public.research_review_log;
create policy "staff_all_research_review_log"
  on public.research_review_log
  for all
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- ---------------------------------------------------------------------------
-- 6. updated_at trigger on research_publications
--    Wrapped in DO-block existence check on pg_trigger.tgname for idempotency.
--    tg_set_updated_at() already exists from Phase 61 (20290101000001).
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'set_updated_at_research_publications'
      and tgrelid = 'public.research_publications'::regclass
  ) then
    create trigger set_updated_at_research_publications
      before update on public.research_publications
      for each row execute function public.tg_set_updated_at();
  end if;
end $$;

commit;
