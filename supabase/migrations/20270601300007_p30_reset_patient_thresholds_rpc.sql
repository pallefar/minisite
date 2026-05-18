-- Phase 30 Plan 04 — Task 2 Step 0 (B4 unconditional)
-- reset_patient_dose_thresholds SECDEF — admin/staff role gate + DELETE from org_patient_thresholds
-- + audit_logs INSERT with suppress_audit GUC.
--
-- Plan 30-00 set_patient_dose_thresholds is upsert-only (INSERT...ON CONFLICT DO UPDATE).
-- There is NO delete path in that function. Reset requires this sibling SECDEF.
--
-- Role gate: org_members.role in ('admin', 'staff') for the caller's membership in p_org_id.
-- Side effects:
--   1. set_config('app.suppress_audit', 'on', true) — prevents audit trigger recursion (Phase 24 pattern)
--   2. DELETE FROM org_patient_thresholds WHERE org_id = p_org_id AND patient_user_id = p_patient_user_id
--   3. INSERT INTO audit_logs — records the reset action with actor_user_id
--
-- Security: SECURITY DEFINER set search_path = pg_catalog, public, extensions
-- Grant: REVOKE all from public; GRANT EXECUTE to authenticated

begin;

create or replace function public.reset_patient_dose_thresholds(
  p_org_id          uuid,
  p_patient_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_caller_uid   uuid := auth.uid();
  v_caller_role  public.org_member_role;
  v_user_id_hash text;
begin
  -- Unauthenticated guard
  if v_caller_uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  -- Pattern S1: DB-level role re-check (admin or staff)
  select role into v_caller_role
  from public.org_members
  where org_id = p_org_id and user_id = v_caller_uid;

  if v_caller_role is null or v_caller_role not in ('admin', 'staff') then
    raise exception 'admin or staff role required' using errcode = '42501';
  end if;

  -- Suppress audit trigger recursion (Phase 24 GUC pattern)
  perform set_config('app.suppress_audit', 'on', true);

  -- Delete the per-patient threshold override (no-op if no override exists)
  delete from public.org_patient_thresholds
  where org_id = p_org_id
    and patient_user_id = p_patient_user_id;

  -- Audit log: direct INSERT (NOT log_admin_action — that requires platform-admin role)
  v_user_id_hash := encode(
    extensions.digest(v_caller_uid::text, 'sha256'), 'hex'
  );

  insert into public.audit_logs(
    user_id_hash, table_name, action,
    user_id, actor_user_id, action_name, row_pk, after_data, source
  ) values (
    v_user_id_hash, 'org_patient_thresholds', 'delete',
    v_caller_uid, v_caller_uid,
    'reset_patient_dose_thresholds',
    format('%s:%s', p_org_id, p_patient_user_id),
    jsonb_build_object(
      'org_id', p_org_id,
      'patient_user_id', p_patient_user_id,
      'reset_by', v_caller_uid
    ),
    'rpc'
  );
end;
$$;

revoke all on function public.reset_patient_dose_thresholds(uuid, uuid) from public;
grant execute on function public.reset_patient_dose_thresholds(uuid, uuid) to authenticated;

commit;
