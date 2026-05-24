-- Phase 49 Plan 49-01 Task 1 — community_posts FTS: GENERATED tsvector + GIN.
--
-- Implements D-01 (per-table tsvector) + D-17 (whole-body weight A): the
-- community_posts table stores authored content in a single text column at
-- weight A; per-locale GIN indexes power Plan 49-02 search_content RPC.
--
-- Why GENERATED ALWAYS AS … STORED (Postgres 12+):
--   - Atomic recompute on INSERT/UPDATE without trigger code.
--   - STORED is GIN-indexable (VIRTUAL is not).
--   - to_tsvector(regconfig, …) + coalesce(…, '') is IMMUTABLE — required for
--     STORED generated columns.
--
-- Why two columns (en + es) instead of one polyglot column:
--   - to_tsvector(regconfig) needs a STATIC regconfig literal for STORED gen cols.
--   - Per-row dynamic locale would require a trigger; two STORED columns avoid that.
--   - Storage cost is small (tsvector dedupes lexemes).
--
-- Idempotency: guarded with IF NOT EXISTS on both ALTER and CREATE INDEX.

begin;

alter table public.community_posts
  add column if not exists search_en tsvector generated always as (
    setweight(to_tsvector('english', coalesce(body, '')), 'A')
  ) stored,
  add column if not exists search_es tsvector generated always as (
    setweight(to_tsvector('spanish', coalesce(body, '')), 'A')
  ) stored;

create index if not exists community_posts_search_en_gin
  on public.community_posts using gin (search_en);

create index if not exists community_posts_search_es_gin
  on public.community_posts using gin (search_es);

commit;
