-- Phase 24 Plan 24-06 — audit_archive_delete SECURITY DEFINER RPC.
--
-- Decision: D-16, D-17, T-24-03c.
--
-- Background:
--   D-17 (audit_logs Append-only RLS) DENY DELETE for all roles including
--   service_role. The audit-archive Edge Function therefore cannot directly
--   DELETE archived rows. This migration adds a SECURITY DEFINER function
--   owned by `postgres` (table owner) that bypasses RLS by privilege.
--
-- Security constraints (T-24-03c):
--   1. `p_cutoff` is validated to be at least 89 days in the past to prevent
--      abuse that would delete recent audit data.
--   2. `app.suppress_audit = 'on'` is set for the duration to prevent the
--      audit trigger from generating recursive rows when deleting from
--      audit_logs itself.
--   3. Only callable via service_role context (the Edge Function).
--
-- SECURITY DEFINER requires `set search_path = extensions, public, pg_temp`
-- per [[reference_supabase_migration_gotchas]].

create or replace function public.delete_archived_audit_rows(
  p_cutoff timestamptz
)
returns integer
language plpgsql
security definer
set search_path = extensions, public, pg_temp
as $$
declare
  v_deleted integer;
  v_min_cutoff timestamptz;
begin
  -- T-24-03c: reject cutoffs that are too recent (within 89 days)
  v_min_cutoff := now() - interval '89 days';
  if p_cutoff > v_min_cutoff then
    raise exception 'delete_archived_audit_rows: p_cutoff must be at least 90 days ago (got %)', p_cutoff
      using errcode = '22023';
  end if;

  -- Suppress recursive audit triggers while deleting from audit_logs itself
  -- (prevents infinite recursion when the PHI trigger is attached to audit_logs)
  perform set_config('app.suppress_audit', 'on', true); -- local to this transaction

  -- D-17 bypass: SECURITY DEFINER runs as `postgres` (table owner), not caller
  delete from public.audit_logs
  where created_at < p_cutoff;

  get diagnostics v_deleted = row_count;

  return v_deleted;
end;
$$;

-- Grant EXECUTE to authenticated role so Edge Function (which uses service_role
-- JWT) can call the RPC via supabase-js .rpc(). service_role bypasses RLS but
-- still needs EXECUTE on the function.
grant execute on function public.delete_archived_audit_rows(timestamptz)
  to authenticated, service_role;

comment on function public.delete_archived_audit_rows(timestamptz) is
  'SECURITY DEFINER: deletes audit_logs rows older than p_cutoff (must be >= 90 days ago). '
  'Called by the audit-archive Edge Function after Parquet/CSV upload to cold storage. '
  'Bypasses D-17 RLS DENY DELETE; sets app.suppress_audit to prevent recursive audit rows.';
