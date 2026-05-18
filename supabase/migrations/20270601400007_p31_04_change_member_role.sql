-- =============================================================================
-- Phase 31 Plan 04 — change_member_role SECDEF (moved from 31-05; closes BLOCKER 1+3)
--
-- TS3 timestamp: 20270601400007 (lexicographically after TS2 20270601400006)
--
-- Provides:
--   public.change_member_role(p_org_id uuid, p_user_id uuid, p_role org_member_role) returns void
--
-- Security contract (D-13):
--   - Permission gate: has_permission(get_caller_role(p_org_id), 'members.role.edit')
--     'members.role.edit' is owner-only per D-03.
--   - NOT_MEMBER guard: raises if target user is not a member of the org.
--   - LAST_OWNER_DEMOTE_DENIED guard: cannot demote the last owner of an org.
--   - Audit: writes log_admin_action('org_member.role_changed', ...) on every success.
--
-- Moved from 31-05 to 31-04 to close plan-checker BLOCKER 1+3 (push-race avoidance):
-- Plan 31-05 ships NO migrations; all of Wave 1-2 server state lands in this single push.
--
-- DO NOT wrap in BEGIN/COMMIT — Supabase CLI manages transaction per migration.
-- =============================================================================

create or replace function public.change_member_role(
  p_org_id  uuid,
  p_user_id uuid,
  p_role    public.org_member_role
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_current_role public.org_member_role;
  v_owner_count  int;
begin
  -- (a) Permission gate: members.role.edit is owner-only per D-03.
  if not public.has_permission(public.get_caller_role(p_org_id), 'members.role.edit') then
    raise exception 'insufficient_privilege' using errcode = 'P0001', message = 'caller lacks members.role.edit';
  end if;

  -- (b) Look up target's current role; raise NOT_MEMBER if absent.
  select role into v_current_role
    from public.org_members
   where org_id = p_org_id
     and user_id = p_user_id;

  if v_current_role is null then
    raise exception 'NOT_MEMBER' using errcode = 'P0001';
  end if;

  -- (c) Last-owner guard: cannot demote the final owner of an org.
  if v_current_role = 'owner' and p_role <> 'owner' then
    select count(*) into v_owner_count
      from public.org_members
     where org_id = p_org_id
       and role = 'owner';

    if v_owner_count <= 1 then
      raise exception 'LAST_OWNER_DEMOTE_DENIED' using errcode = 'P0001';
    end if;
  end if;

  -- (d) Apply the role change.
  update public.org_members
     set role = p_role
   where org_id = p_org_id
     and user_id = p_user_id;

  -- (e) Audit log per Phase 24 contract (metadata only, no PHI).
  perform public.log_admin_action(
    'org_member.role_changed',
    jsonb_build_object(
      'org_id',   p_org_id,
      'user_id',  p_user_id,
      'new_role', p_role::text
    )
  );
end;
$$;

revoke all on function public.change_member_role(uuid, uuid, public.org_member_role) from public;
grant execute on function public.change_member_role(uuid, uuid, public.org_member_role) to authenticated, service_role;

comment on function public.change_member_role(uuid, uuid, public.org_member_role) is
  'P31 D-13: assigns org_member_role to a user with has_permission gate + last-owner guard. '
  'Moved from 31-05 to 31-04 to close plan-checker BLOCKER 1+3 (push race avoidance). '
  'All mutations write log_admin_action(org_member.role_changed).';
