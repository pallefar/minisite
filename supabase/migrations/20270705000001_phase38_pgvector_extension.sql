-- Phase 38 Plan 01 — pgvector extension (RECOMMEND-01).
--
-- pgvector ships pre-installed on Supabase managed Postgres but is NOT
-- auto-enabled on a project. This migration is idempotent.
--
-- Pitfall (memory `reference_supabase_migration_gotchas`): Supabase recommends
-- installing extensions in a dedicated `extensions` schema; however on hosted
-- Supabase the `vector` extension is conventionally installed in `public`
-- so that `vector(1536)` type references in `public.*` tables resolve without
-- explicit search_path manipulation. We follow that convention here.

create extension if not exists vector;

-- Sanity check (DO block — no-op if vector type already resolves).
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'vector') then
    raise exception 'pgvector extension failed to install';
  end if;
end $$;
