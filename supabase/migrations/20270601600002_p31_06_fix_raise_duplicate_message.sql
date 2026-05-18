-- Phase 31 Plan 06 Rule-1 fix #2: fix RAISE option already specified error.
--
-- Root cause: RAISE 'text' already sets the message property.
-- Adding `message = '...'` in the USING clause is a duplicate → PG error:
-- "RAISE option already specified: MESSAGE"
--
-- Fix: remove the redundant `message = '...'` from each affected SECDEF.
-- Affected functions shipped by 31-04 and 31-06 (fix 1):
--   save_org_onboarding_flow
--   (other SECDEFs use `raise exception using errcode =..., message =...`
--    WITHOUT a leading string literal, which is valid — only the string literal
--    form conflicts with the USING message clause.)

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
  -- RAISE 'text' already sets the message; errcode= in USING is separate and valid.
  if not public.has_permission(public.get_caller_role(p_org_id), 'onboarding.edit') then
    raise exception using errcode = '42501', message = 'insufficient_privilege';
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
