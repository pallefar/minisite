-- Phase 31 Plan 06 Rule-1 fix: wrap log_admin_action call in save_org_onboarding_flow
-- with best-effort exception handling.
--
-- Context (31-04 SUMMARY carry-forward):
--   "Phase 24's audit guard is_admin_at_least('staff'::admin_role) may reject clinic OWNERS
--   who aren't SYSTEM admins. Post-push T12 should be run; if it fails, wrap in
--   BEGIN ... EXCEPTION WHEN OTHERS THEN NULL; END;"
--
-- This migration wraps the log_admin_action call so the SECDEF succeeds for org owners
-- even when the Phase 24 audit guard rejects them (they are org_member_role, not admin_role).
-- The flow IS saved correctly; only the audit row may be missing for non-system-admins.

create or replace function public.save_org_onboarding_flow(
  p_org_id uuid,
  p_steps  jsonb
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_next_version int;
  v_new_id       uuid;
begin
  -- Permission gate: onboarding.edit is owner-only per D-03.
  -- NOTE: RAISE 'text' sets the message; do NOT also specify message= in USING (duplicate).
  if not public.has_permission(public.get_caller_role(p_org_id), 'onboarding.edit') then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  -- Shape validation.
  perform public._validate_onboarding_steps(p_steps);

  -- Advisory lock: prevents split-brain versioning under concurrent saves for same org.
  perform pg_advisory_xact_lock(hashtext('org_onboarding_flow:' || p_org_id::text));

  -- Compute next version number.
  select coalesce(max(version), 0) + 1
    into v_next_version
    from public.org_onboarding_flows
   where org_id = p_org_id;

  -- Atomically deactivate the current active row (if any).
  update public.org_onboarding_flows
     set is_active = false
   where org_id = p_org_id
     and is_active = true;

  -- Insert new version as the active row.
  insert into public.org_onboarding_flows (org_id, steps, version, is_active, created_by)
  values (p_org_id, p_steps, v_next_version, true, auth.uid())
  returning id into v_new_id;

  -- Audit log (best-effort — org owners are not system admins; log_admin_action may reject).
  begin
    perform public.log_admin_action(
      'org_onboarding_flow.save',
      null::uuid,
      'org_onboarding_flows',
      v_new_id::text,
      null,
      jsonb_build_object(
        'org_id',  p_org_id,
        'flow_id', v_new_id,
        'version', v_next_version
      )
    );
  exception when others then
    -- Best-effort: audit write fails for non-system-admin callers; flow save still succeeds.
    null;
  end;

  return v_new_id;
end;
$$;
