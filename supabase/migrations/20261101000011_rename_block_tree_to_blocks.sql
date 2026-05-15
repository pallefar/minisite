-- Phase 15 schema fix-up — reconcile column name with app code.
--
-- 15-01 migration `20261101000002_page_builder_tables.sql` created
-- `landing_page_revisions.block_tree`, but app code (page-save Edge Function,
-- page-render Edge Function, page-publish, frontend page-api) was authored
-- against `blocks`. The mismatch silently broke editor→publish→render until
-- caught at Phase 15 close.
--
-- Resolution: rename the column to match the app surface. The column is
-- empty in production (Phase 15 only just shipped Wave 1-4); zero-data
-- migration is safe.
--
-- Idempotent: only renames if the legacy name still exists.

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'landing_page_revisions'
      and column_name  = 'block_tree'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'landing_page_revisions'
      and column_name  = 'blocks'
  ) then
    alter table public.landing_page_revisions rename column block_tree to blocks;
  end if;
end $$;
