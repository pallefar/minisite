-- Phase 49 Plan 49-01 Task 2 — course_lessons FTS: GENERATED tsvector + GIN.
--
-- Implements D-01 (per-table tsvector) + D-02 (setweight discipline):
--   - title at weight A
--   - content_md at weight B
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
-- Depends on Phase 46 having shipped public.course_lessons (D-24 sequencing).

begin;

alter table public.course_lessons
  add column if not exists search_en tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(content_md, '')), 'B')
  ) stored,
  add column if not exists search_es tsvector generated always as (
    setweight(to_tsvector('spanish', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('spanish', coalesce(content_md, '')), 'B')
  ) stored;

create index if not exists course_lessons_search_en_gin
  on public.course_lessons using gin (search_en);

create index if not exists course_lessons_search_es_gin
  on public.course_lessons using gin (search_es);

commit;
