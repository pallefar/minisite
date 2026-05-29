-- Plan 70-07 cascade-40 — remote-DB reconciliation (R3b).
--
-- Sibling of cascade-39 R3 (20290108000003_p70_fix_log_admin_action_user_id_hash):
-- public.log_org_action (20270601700001_p31_07_log_org_action_helper.sql) — the
-- ORG-scoped audit helper, parallel to log_admin_action — also INSERTs into
-- public.audit_logs WITHOUT user_id_hash. audit_logs.user_id_hash is `text not null`
-- (20260601000001_audit_logs.sql:62), so every log_org_action() call fails with
-- `23502 null value in column "user_id_hash"`. This was MASKED until cascade-39
-- cleared the org_members RLS recursion + log_admin_action; cascade-39's CI run
-- (26630934057) then surfaced it as the remaining ~18 RLS-org failures.
--
-- The 4 org SECDEF RPCs that `perform log_org_action(...)` all roll back on this:
-- save_org_branding, save_org_onboarding_flow, activate_onboarding_flow_version,
-- change_member_role — so rls-org-branding, rls-org-invites,
-- rls-org-onboarding-flows, and rls-change-member-role tests fail.
--
-- Fix: create-or-replace log_org_action with user_id_hash added to the INSERT,
-- using the SAME canonical value as fn_audit_phi_trigger (20270601200005) and
-- log_admin_action (cascade-39):
--   encode(digest(coalesce(auth.uid()::text, 'service_role'), 'sha256'), 'hex')
-- Signature, membership gate, search_path, grants, and the 4 callers are unchanged.

create or replace function public.log_org_action(
  p_org_id          uuid,
  p_action_name     text,
  p_target_user_id  uuid    default null,
  p_table_name      text    default null,
  p_row_pk          text    default null,
  p_before          jsonb   default null,
  p_after           jsonb   default null
)
returns uuid
language plpgsql
security definer
set search_path to 'extensions', 'public', 'pg_temp'
as $$
declare
  v_id          uuid;
  v_actor_role  public.org_member_role;
begin
  -- Caller must be authenticated.
  if auth.uid() is null then
    raise exception 'log_org_action: caller is not authenticated'
      using errcode = '42501';
  end if;

  -- Caller must be a member of the org (any role). The CALLING SECDEF is
  -- responsible for the per-action permission gate; this function just enforces
  -- the org-membership boundary so non-members can't write audit rows for orgs
  -- they don't belong to.
  v_actor_role := public.get_caller_role(p_org_id);
  if v_actor_role is null then
    raise exception 'log_org_action: caller is not a member of org %', p_org_id
      using errcode = '42501';
  end if;

  insert into public.audit_logs (
    actor_user_id,
    actor_type,
    user_id_hash,
    target_user_id,
    org_id,
    action_name,
    table_name,
    row_pk,
    before_data,
    after_data,
    source,
    metadata
  ) values (
    auth.uid(),
    'org_member'::public.audit_actor_type,
    -- Phase 70-07 R3b fix: audit_logs.user_id_hash is NOT NULL. Same canonical
    -- value used by fn_audit_phi_trigger + log_admin_action.
    encode(digest(coalesce(auth.uid()::text, 'service_role'), 'sha256'), 'hex'),
    p_target_user_id,
    p_org_id,
    p_action_name,
    p_table_name,
    p_row_pk,
    p_before,
    p_after,
    'rpc',
    jsonb_build_object('actor_role', v_actor_role::text)
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.log_org_action(uuid, text, uuid, text, text, jsonb, jsonb) from public;
grant execute on function public.log_org_action(uuid, text, uuid, text, text, jsonb, jsonb) to authenticated, service_role;
