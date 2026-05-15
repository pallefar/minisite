-- Phase 15 Plan 01 — `landing_pages` + `landing_page_revisions` tables.
--
-- Circular FK split (RESEARCH Pitfall 6):
--   `landing_pages.published_revision_id` references `landing_page_revisions.id`
--   AND `landing_page_revisions.page_id` references `landing_pages.id`.
--   This is a circular FK pair. We:
--     - Create `landing_pages` with `published_revision_id` as a plain uuid
--       column (no FK yet).
--     - Create `landing_page_revisions` with the non-circular `page_id` FK.
--     - Migration 03 ADDS the deferrable FK on `landing_pages.published_revision_id`
--       (`DEFERRABLE INITIALLY DEFERRED` so publish + revision insert can happen
--       in a single transaction).
--
-- Partial-index predicate IMMUTABILITY (RESEARCH Pitfall 1):
--   The partial index `where page_id is not null` uses ONLY column nullability,
--   which is IMMUTABLE — no `now()`, no function calls, no time-dependent
--   predicates. Safe.
--
-- Notes:
--   - `status` is a text + CHECK constraint, not an enum (avoids the
--     "ENUM in the same tx as a table that uses it" planner-iter1 anti-pattern).
--   - No RLS yet — enabled in migration 07.

-- ----------------------------------------------------------------------------
-- 1. landing_pages
-- ----------------------------------------------------------------------------
create table public.landing_pages (
  id                       uuid primary key default gen_random_uuid(),
  slug                     text not null unique,
  title                    text not null default '',
  status                   text not null default 'draft' check (status in ('draft', 'published')),
  -- FK to landing_page_revisions(id) added in migration 03 (DEFERRABLE INITIALLY DEFERRED).
  -- Kept as plain uuid here to break the circular FK at create time (Pitfall 6).
  published_revision_id    uuid,
  seo_title                text,
  seo_description          text,
  seo_og_image             text,
  seo_canonical            text,
  seo_schema_type          text not null default 'WebPage',
  created_by               uuid references auth.users(id) on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index idx_landing_pages_status on public.landing_pages(status);
create index idx_landing_pages_slug on public.landing_pages(slug);

-- ----------------------------------------------------------------------------
-- 2. updated_at trigger on landing_pages
-- ----------------------------------------------------------------------------
create or replace function public.landing_pages_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'landing_pages_set_updated_at_trigger'
  ) then
    create trigger landing_pages_set_updated_at_trigger
      before update on public.landing_pages
      for each row execute function public.landing_pages_set_updated_at();
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 3. landing_page_revisions (APPEND-ONLY — no updated_at column)
-- ----------------------------------------------------------------------------
create table public.landing_page_revisions (
  id          uuid primary key default gen_random_uuid(),
  page_id     uuid not null references public.landing_pages(id) on delete cascade,
  block_tree  jsonb not null default '[]'::jsonb,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

-- Partial index — IMMUTABLE predicate (column nullability only). Pitfall 1 safe.
create index idx_landing_page_revisions_page_created_desc
  on public.landing_page_revisions(page_id, created_at desc)
  where page_id is not null;
