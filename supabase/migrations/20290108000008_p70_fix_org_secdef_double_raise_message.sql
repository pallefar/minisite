-- Plan 70-07 cascade-44 — remote-DB reconciliation (R3f, final DB layer): invalid
-- double-`message` RAISE in change_member_role + activate_onboarding_flow_version.
--
-- Root (see 70-07-UNIT-DRIFT-ROOTCAUSE.md): both SECDEFs (defined in
-- 20270601700001_p31_07_log_org_action_helper.sql) raise the permission-denied path as
--   raise exception 'insufficient_privilege' using errcode = '...', message = '...';
-- which supplies the RAISE message BOTH positionally AND via the `message =` option.
-- PL/pgSQL rejects that at runtime with `RAISE option already specified: MESSAGE`
-- (SQLSTATE 42601). So the negative-path tests (change_member_role TC2/TC3,
-- activate_onboarding_flow_version A4) got that error string instead of the expected
-- `insufficient_privilege`, and their assertions (regex /insufficient_privilege|caller
-- lacks/) failed. Masked behind earlier audit failures until cascades 39-43 cleared
-- those paths.
--
-- Fix: drop the redundant `message =` option; keep the positional message. Bodies are
-- otherwise byte-faithful to 20270601700001; only the offending RAISE statements change.

-- ── activate_onboarding_flow_version ─────────────────────────────────────────
create or replace function public.activate_onboarding_flow_version(p_org_id uuid, p_flow_id uuid)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'extensions'
as $$
declare
  v_already_active boolean;
begin
  if not public.has_permission(public.get_caller_role(p_org_id), 'onboarding.edit') then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.org_onboarding_flows
     where id = p_flow_id and org_id = p_org_id
  ) then
    raise exception 'FLOW_NOT_IN_ORG' using errcode = 'P0001';
  end if;

  select is_active into v_already_active
    from public.org_onboarding_flows
   where id = p_flow_id;

  if v_already_active then
    return;
  end if;

  perform 1 from public.org_onboarding_flows
   where (id = p_flow_id or (org_id = p_org_id and is_active = true))
   for update;

  update public.org_onboarding_flows
     set is_active = false
   where org_id = p_org_id
     and is_active = true
     and id <> p_flow_id;

  update public.org_onboarding_flows
     set is_active = true
   where id = p_flow_id;

  perform public.log_org_action(
    p_org_id,
    'org_onboarding_flow.activate_version',
    null::uuid,
    'org_onboarding_flows',
    p_flow_id::text,
    null,
    jsonb_build_object('org_id', p_org_id, 'flow_id', p_flow_id)
  );
end;
$$;

-- ── change_member_role ───────────────────────────────────────────────────────
create or replace function public.change_member_role(p_org_id uuid, p_user_id uuid, p_role public.org_member_role)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'extensions'
as $$
declare
  v_current_role public.org_member_role;
  v_owner_count  int;
begin
  if not public.has_permission(public.get_caller_role(p_org_id), 'members.role.edit') then
    raise exception 'insufficient_privilege' using errcode = 'P0001';
  end if;

  select role into v_current_role
    from public.org_members
   where org_id = p_org_id
     and user_id = p_user_id;

  if v_current_role is null then
    raise exception 'NOT_MEMBER' using errcode = 'P0001';
  end if;

  if v_current_role = 'owner' and p_role <> 'owner' then
    select count(*) into v_owner_count
      from public.org_members
     where org_id = p_org_id
       and role = 'owner';

    if v_owner_count <= 1 then
      raise exception 'LAST_OWNER_DEMOTE_DENIED' using errcode = 'P0001';
    end if;
  end if;

  update public.org_members
     set role = p_role
   where org_id = p_org_id
     and user_id = p_user_id;

  perform public.log_org_action(
    p_org_id,
    'org_member.role_changed',
    p_user_id,
    'org_members',
    p_user_id::text,
    jsonb_build_object('old_role', v_current_role::text),
    jsonb_build_object('new_role', p_role::text)
  );
end;
$$;
