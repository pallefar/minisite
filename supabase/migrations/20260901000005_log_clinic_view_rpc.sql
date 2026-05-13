-- Phase 10 Plan 10-04 — log_clinic_view SECURITY DEFINER RPC.
--
-- D-21: per-section operator audit writes from the drill-in UI.
-- Plan 10-07 calls this once per section component on first mount.
--
-- Three-check gate (T-10-04-02 mitigation):
--   1. Caller has the required permission for the section being viewed.
--      Photos section requires 'patient_photos.read'; all other sections
--      require 'patient_data.read'.
--   2. Target patient MUST have an active (non-revoked) membership in p_org_id.
--      Checked AFTER the permission gate so non-members can't enumerate
--      patient org membership via error-code timing differences.
--   3. On both checks passing: INSERT one audit_logs row with
--      action='section_view', actor_type='org_member', org_id,
--      row_id=p_target_user_id::text (patient being viewed), and
--      table_name='clinic_view/{section}' (encodes the section for HBNR queries).
--
-- Memory `reference_supabase_migration_gotchas.md` gotcha #2:
--   SECURITY DEFINER functions MUST set search_path = public, extensions, pg_catalog
--   so pgcrypto helpers (digest etc.) resolve. digest() is called inside the
--   audit_logs INSERT for user_id_hash.
--
-- Schema note: audit_logs uses the Phase 7 column layout:
--   user_id, user_id_hash, table_name, row_id, action, actor_type, org_id
-- There are no dedicated `actor_id`, `target_user_id`, or `metadata` columns;
-- we encode patient context via table_name + row_id as established in
-- Phase 9's log_clinic_event RPC pattern.
--
-- Cross-tenant impersonation proof (project rule from `reference_supabase_project.md`):
--   e2e/rls-log-clinic-view.test.ts asserts:
--     - Operator in Org 1 calling log_clinic_view(org_2_id, ...) → RAISES access_denied
--     - Operator in Org 1 calling log_clinic_view(org_1_id, patient_in_org_2) → RAISES patient_not_in_org
--     - Operator without patient_data.read calling non-photos section → RAISES access_denied
--     - Operator with only patient_photos.read calling 'photos' section → succeeds
--     - Happy path: writes exactly 1 audit_logs row with action='section_view'

create or replace function public.log_clinic_view(
  p_org_id uuid,
  p_target_user_id uuid,
  p_section_name text
)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_caller_uid uuid := auth.uid();
  v_required_permission text;
begin
  if v_caller_uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  -- Determine the required permission for this section.
  -- Photos section requires patient_photos.read; all others require patient_data.read.
  v_required_permission := case
    when p_section_name = 'photos' then 'patient_photos.read'
    else 'patient_data.read'
  end;

  -- Check 1: caller must have the required permission in the org.
  -- has_permission() inner-joins on memberships WHERE revoked_at IS NULL, so
  -- this also implicitly verifies the caller is an active member of p_org_id.
  if not public.has_permission(v_caller_uid, p_org_id, v_required_permission) then
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

  -- Both checks passed: write the per-section audit row.
  -- Column layout follows Phase 7/9 audit_logs schema (no target_user_id/metadata columns):
  --   user_id       = caller (operator)
  --   user_id_hash  = sha256(caller uid) for post-deletion attribution
  --   table_name    = 'clinic_view' identifies this as a drill-in view event
  --   row_id        = '{target_user_id}/{section_name}' encodes who + what was viewed
  --   action        = 'section_view' (Phase 10 enum value added in 20260901000001)
  --   actor_type    = 'org_member' (operators are org members)
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
    'clinic_view',
    p_target_user_id::text || '/' || p_section_name,
    'section_view',
    'org_member',
    p_org_id
  );
end;
$$;

revoke all on function public.log_clinic_view(uuid, uuid, text) from public;
grant execute on function public.log_clinic_view(uuid, uuid, text) to authenticated;
