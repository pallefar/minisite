-- Phase 10 Plan 10-10 — log_bulk_export_inclusion SECURITY DEFINER RPC.
--
-- D-22: per-included-patient audit row writes during bulk export operations.
-- BulkExportPDFFlow calls this once per patient when generating a bulk PDF.
-- bulk-csv-export Edge Function calls this once per included patient.
--
-- Three-check gate:
--   1. Caller has 'patient_data.read' permission in p_org_id via has_permission().
--      has_permission() inner-joins on memberships WHERE revoked_at IS NULL so
--      this also confirms the caller is an active org member.
--   2. p_export_type must be one of 'pdf' or 'csv' — otherwise raises
--      invalid_export_type.
--   3. Target patient (p_target_user_id) must have an active (non-revoked)
--      membership in p_org_id. Checked AFTER the permission gate to avoid
--      timing-based patient enumeration.
--
-- On all checks passing: INSERT one audit_logs row with:
--   action = 'bulk_pdf_export' (when p_export_type = 'pdf')
--   action = 'bulk_csv_export' (when p_export_type = 'csv')
--
-- Memory `reference_supabase_migration_gotchas.md` gotcha #2:
--   SECURITY DEFINER functions MUST set search_path = public, extensions, pg_catalog
--   so pgcrypto helpers (digest etc.) resolve. digest() is used inside the
--   audit_logs INSERT for user_id_hash.
--
-- Schema note: audit_logs uses the Phase 7/10 column layout:
--   user_id, user_id_hash, table_name, row_id, action, actor_type, org_id
-- The action values 'bulk_pdf_export' and 'bulk_csv_export' were added to the
-- audit_logs_action_check constraint in migration 20260901000001.
--
-- Cross-tenant impersonation proof:
--   e2e/rls-bulk-export.test.ts asserts:
--     1. Operator A in Org 1 calls log_bulk_export_inclusion(org_1_id, patient_in_org_1, 'pdf') → succeeds, audit row written.
--     2. Operator A calls for Org 2 → access_denied.
--     3. Operator A in Org 1 calls for patient in Org 2 → patient_not_in_org.
--     4. p_export_type='csv' writes 'bulk_csv_export'; p_export_type='pdf' writes 'bulk_pdf_export'; other → invalid_export_type.

create or replace function public.log_bulk_export_inclusion(
  p_org_id uuid,
  p_target_user_id uuid,
  p_export_type text
)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_caller_uid uuid := auth.uid();
  v_action text;
begin
  if v_caller_uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  -- Check: p_export_type must be 'pdf' or 'csv'.
  if p_export_type not in ('pdf', 'csv') then
    raise exception 'invalid_export_type';
  end if;

  -- Map export type to audit action.
  v_action := case
    when p_export_type = 'pdf' then 'bulk_pdf_export'
    else 'bulk_csv_export'
  end;

  -- Check 1: caller must have patient_data.read in the org.
  -- has_permission() inner-joins memberships WHERE revoked_at IS NULL, so
  -- this also confirms the caller is an active member of p_org_id.
  if not public.has_permission(v_caller_uid, p_org_id, 'patient_data.read') then
    raise exception 'access_denied';
  end if;

  -- Check 2: target patient must have an active membership in the org.
  -- Prevents writing audit rows for patients who never joined or were revoked.
  if not exists (
    select 1
    from public.memberships m
    where m.user_id = p_target_user_id
      and m.org_id = p_org_id
      and m.revoked_at is null
  ) then
    raise exception 'patient_not_in_org';
  end if;

  -- All checks passed: write the per-patient bulk export audit row.
  -- Column layout follows Phase 7/10 audit_logs schema:
  --   user_id       = caller (operator performing the export)
  --   user_id_hash  = sha256(caller uid) for post-deletion attribution
  --   table_name    = 'bulk_export' identifies this as a bulk export event
  --   row_id        = p_target_user_id::text (patient included in export)
  --   action        = 'bulk_pdf_export' or 'bulk_csv_export'
  --   actor_type    = 'org_member'
  --   org_id        = p_org_id
  insert into public.audit_logs (
    user_id,
    user_id_hash,
    table_name,
    row_id,
    action,
    actor_type,
    org_id
  )
  values (
    v_caller_uid,
    encode(digest(v_caller_uid::text, 'sha256'), 'hex'),
    'bulk_export',
    p_target_user_id::text,
    v_action,
    'org_member',
    p_org_id
  );
end;
$$;

revoke all on function public.log_bulk_export_inclusion(uuid, uuid, text) from public;
grant execute on function public.log_bulk_export_inclusion(uuid, uuid, text) to authenticated;
