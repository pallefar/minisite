-- Phase 24: log_admin_action() SECURITY DEFINER write path for admin RPCs
-- Decision ref: D-14
--
-- Single privileged write path for admin-initiated audit events.
-- Every admin RPC ends with:
--   select log_admin_action(action_name, target_user_id, ...);
--
-- Security guarantees:
--   - Caller MUST be authenticated (auth.uid() not null)
--   - Caller MUST be at least 'staff' role (is_admin_at_least check)
--   - Raises exception on unauthorized call (non-admin cannot forge audit rows)
--
-- SECURITY DEFINER requires `set search_path = extensions, public, pg_temp`
-- per [[reference_supabase_migration_gotchas]].

create or replace function public.log_admin_action(
  p_action_name    text,
  p_target_user_id uuid,
  p_table_name     text   default null,
  p_row_pk         text   default null,
  p_before         jsonb  default null,
  p_after          jsonb  default null
)
returns uuid
language plpgsql
security definer
set search_path = extensions, public, pg_temp
as $$
declare
  v_id uuid;
begin
  -- Caller must be authenticated and at least staff
  if auth.uid() is null or not public.is_admin_at_least('staff'::public.admin_role) then
    raise exception 'log_admin_action: caller is not admin'
      using errcode = '42501';
  end if;

  insert into public.audit_logs (
    actor_user_id,
    target_user_id,
    action_name,
    table_name,
    row_pk,
    before_data,
    after_data,
    source
  ) values (
    auth.uid(),
    p_target_user_id,
    p_action_name,
    p_table_name,
    p_row_pk,
    p_before,
    p_after,
    'rpc'
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- Grant execute to authenticated so admin RPCs can call this from client context.
-- The SECURITY DEFINER body enforces the role check — the grant alone is not enough.
grant execute on function public.log_admin_action(text, uuid, text, text, jsonb, jsonb)
  to authenticated;
