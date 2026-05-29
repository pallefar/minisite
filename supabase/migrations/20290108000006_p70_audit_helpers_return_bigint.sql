-- Plan 70-07 cascade-42 — remote-DB reconciliation (R3d): fix audit-helper return type.
--
-- Root (see 70-07-UNIT-DRIFT-ROOTCAUSE.md): public.audit_logs.id is BIGINT
-- (bigserial), but log_admin_action and log_org_action both declare `returns uuid`
-- with `v_id uuid; ... returning id into v_id; return v_id;`. The bigint→uuid cast
-- in `returning id into v_id` raises `22P02 invalid input syntax for type uuid:
-- "<bigint>"`. This was latent until cascades 39-41 made the INSERT succeed (the
-- function never reached `returning` before — it 23502'd on user_id_hash/action/
-- table_name first). cascades 39/40 carried the wrong `returns uuid` over verbatim.
--
-- The rag_topic_* RPCs `perform log_admin_action(...)` (9 sites in
-- 20260519000010_rag_admin_rpcs.sql), so they fail with the same 22P02; the 4 org
-- SECDEFs `perform log_org_action(...)` likewise.
--
-- Fix: change the return type to bigint. Return-type changes require DROP+CREATE
-- (CREATE OR REPLACE cannot alter the return type). Callers `perform` the function
-- (discard the return), so they are unaffected; tests that capture the return use it
-- as the bigint audit_logs.id (`.eq('id', logId)`). The PL/pgSQL callers late-bind,
-- so DROP does not cascade to them. Bodies are identical to cascades 39/40 (incl. the
-- user_id_hash fix) except `v_id`/return are now bigint.

-- ── log_admin_action ────────────────────────────────────────────────────────
drop function if exists public.log_admin_action(text, uuid, text, text, jsonb, jsonb);

create function public.log_admin_action(
  p_action_name    text,
  p_target_user_id uuid,
  p_table_name     text   default null,
  p_row_pk         text   default null,
  p_before         jsonb  default null,
  p_after          jsonb  default null
)
returns bigint
language plpgsql
security definer
set search_path = extensions, public, pg_temp
as $$
declare
  v_id bigint;
begin
  if auth.uid() is null or not public.is_admin_at_least('staff'::public.admin_role) then
    raise exception 'log_admin_action: caller is not admin'
      using errcode = '42501';
  end if;

  insert into public.audit_logs (
    actor_user_id,
    target_user_id,
    user_id_hash,
    action_name,
    table_name,
    row_pk,
    before_data,
    after_data,
    source
  ) values (
    auth.uid(),
    p_target_user_id,
    encode(digest(coalesce(auth.uid()::text, 'service_role'), 'sha256'), 'hex'),
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

grant execute on function public.log_admin_action(text, uuid, text, text, jsonb, jsonb)
  to authenticated;

-- ── log_org_action ──────────────────────────────────────────────────────────
drop function if exists public.log_org_action(uuid, text, uuid, text, text, jsonb, jsonb);

create function public.log_org_action(
  p_org_id          uuid,
  p_action_name     text,
  p_target_user_id  uuid    default null,
  p_table_name      text    default null,
  p_row_pk          text    default null,
  p_before          jsonb   default null,
  p_after           jsonb   default null
)
returns bigint
language plpgsql
security definer
set search_path to 'extensions', 'public', 'pg_temp'
as $$
declare
  v_id          bigint;
  v_actor_role  public.org_member_role;
begin
  if auth.uid() is null then
    raise exception 'log_org_action: caller is not authenticated'
      using errcode = '42501';
  end if;

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
