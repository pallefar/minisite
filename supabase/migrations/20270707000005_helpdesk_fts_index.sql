-- Phase 37 Plan 37-02 Task 1 — KB FTS: GENERATED tsvector columns + GIN indexes.
--
-- Adds EN + ES storred-generated tsvector columns to public.kb_articles plus a
-- per-locale GIN index for sub-100ms p99 search across small-to-medium corpora
-- (HELP-08, HELP-11).
--
-- Why GENERATED ALWAYS AS ... STORED (Postgres 12+):
--   - No trigger code to maintain (atomic on INSERT/UPDATE).
--   - tsvector is recomputed automatically when title/body changes.
--   - STORED variant is fully indexable by GIN (VIRTUAL would not be).
--
-- Why two columns (en + es) instead of one polyglot column:
--   - to_tsvector(regconfig) needs a STATIC regconfig literal for STORED gen cols
--     (Postgres parser folds it into the column dependency).
--   - A per-row dynamic locale would require a trigger; two STORED columns avoid that.
--   - Storage cost is small (tsvector dedupes lexemes).
--
-- Pitfall 5 (RESEARCH): GENERATED columns may NOT reference other tables. Title and
-- body live on kb_articles itself; version-table search is out of scope.
--
-- Plan 37-01 owns the kb_articles table itself (migration 20270707000002). This
-- migration assumes:
--   - public.kb_articles(id, org_id, slug, title, body, title_es, body_es, ...)
--   - title + body are text columns (nullable allowed; coalesce handles NULL).
-- A grep-time invariant only — Plan 37-01 is parallel-safe and need not be applied
-- before this migration is committed to the worktree branch.

alter table public.kb_articles
  add column if not exists search_vector_en tsvector generated always as (
    to_tsvector('english',
      coalesce(title, '') || ' ' || coalesce(body, ''))
  ) stored,
  add column if not exists search_vector_es tsvector generated always as (
    to_tsvector('spanish',
      coalesce(title_es, '') || ' ' || coalesce(body_es, ''))
  ) stored;

create index if not exists kb_articles_search_en_gin
  on public.kb_articles using gin (search_vector_en);

create index if not exists kb_articles_search_es_gin
  on public.kb_articles using gin (search_vector_es);
