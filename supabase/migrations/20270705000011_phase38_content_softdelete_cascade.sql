-- Phase 38 Plan 01 — soft-delete 7d cascade cleanup function (D-19).
--
-- Per D-19: when content.deleted_at is set, embedding row is RETAINED for 7
-- days (audit window). After 7 days, cron job deletes the embedding row.
--
-- This migration defines the cleanup FUNCTION. The pg_cron schedule that
-- invokes it is owned by Plan 38-09 (cron migrations).
--
-- SECURITY DEFINER + explicit search_path per memory
-- `reference_supabase_migration_gotchas`.

create or replace function public.cleanup_content_embeddings_soft_deleted()
returns void
language sql
security definer
set search_path = public, extensions
as $fn$
  delete from public.content_embeddings ce
  where exists (
    select 1 from public.content c
    where c.id = ce.content_id
      and c.deleted_at is not null
      and c.deleted_at < now() - interval '7 days'
  );
$fn$;

revoke all on function public.cleanup_content_embeddings_soft_deleted() from public;

-- Grant service_role (cron caller).
grant execute on function public.cleanup_content_embeddings_soft_deleted()
  to service_role;

comment on function public.cleanup_content_embeddings_soft_deleted() is
  'Phase 38 — deletes content_embeddings rows whose parent content was soft-deleted >7d ago (D-19). Scheduled in Plan 38-09.';
