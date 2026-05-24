-- Phase 49 Plan 49-01 Task 3 — events FTS: GENERATED tsvector + GIN.
--
-- Implements D-01 (per-table tsvector) + D-02 (setweight discipline):
--   - title at weight A
--   - description at weight B
-- Per-locale (EN + ES) GIN indexes power Plan 49-02 search_content RPC.
--
-- Why GENERATED ALWAYS AS … STORED (Postgres 12+):
--   - Atomic recompute on INSERT/UPDATE without trigger code.
--   - STORED is GIN-indexable (VIRTUAL is not).
--   - to_tsvector(regconfig, …) + coalesce(…, '') + setweight is IMMUTABLE.
--
-- Why two columns (en + es): to_tsvector(regconfig) needs a STATIC regconfig
-- literal for STORED gen cols; per-row dynamic locale would require a trigger.
--
-- Depends on Phase 47 having shipped public.events (D-24 sequencing).

begin;

alter table public.events
  add column if not exists search_en tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B')
  ) stored,
  add column if not exists search_es tsvector generated always as (
    setweight(to_tsvector('spanish', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('spanish', coalesce(description, '')), 'B')
  ) stored;

create index if not exists events_search_en_gin
  on public.events using gin (search_en);

create index if not exists events_search_es_gin
  on public.events using gin (search_es);

commit;
