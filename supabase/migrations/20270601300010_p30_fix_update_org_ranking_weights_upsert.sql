-- Phase 30 Plan 05 — Fix update_org_ranking_weights: pre-validate + upsert
--
-- Root cause: the SECDEF uses `UPDATE org_settings SET ranking_weights = p_weights`
-- which silently matches 0 rows when no org_settings row exists (newly created orgs
-- have no row yet). The BEFORE UPDATE trigger never fires → invalid weights are
-- silently accepted without raising P0001. Rule 1 auto-fix.
--
-- Fix: add pre-validation call to _validate_ranking_weights() BEFORE the UPDATE,
-- then use INSERT ... ON CONFLICT DO UPDATE (upsert) so the trigger always fires
-- on both new and existing rows.
--
-- Also: the BEFORE INSERT trigger on org_settings also validates ranking_weights,
-- so the upsert path still gets trigger-level validation as a belt-and-suspenders.

begin;

create or replace function public.update_org_ranking_weights(
  p_org_id   uuid,
  p_weights  jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_caller_uid    uuid := auth.uid();
  v_role          public.org_member_role;
  v_user_id_hash  text;
begin
  -- Unauthenticated guard
  if v_caller_uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  -- Pattern S1: DB-level admin role re-check (SECURITY DEFINER bypasses org_members RLS)
  select role into v_role
  from public.org_members
  where org_id = p_org_id and user_id = v_caller_uid;

  if v_role is null or v_role <> 'admin' then
    raise exception 'admin role required' using errcode = '42501';
  end if;

  -- Pre-validate BEFORE the upsert so validation fires even when no org_settings
  -- row exists (the BEFORE UPDATE trigger does not fire on 0-row UPDATEs).
  perform public._validate_ranking_weights(p_weights);

  -- Upsert org_settings: INSERT when no row exists, UPDATE when row exists.
  -- BEFORE INSERT/UPDATE trigger also validates (belt-and-suspenders).
  insert into public.org_settings (org_id, ranking_weights)
  values (p_org_id, p_weights)
  on conflict (org_id) do update
    set ranking_weights = excluded.ranking_weights;

  -- Audit log (direct INSERT — bypasses log_admin_action platform-admin check)
  -- GUC prevents audit trigger recursion (Phase 24 pattern)
  perform set_config('app.suppress_audit', 'on', true);

  v_user_id_hash := encode(
    extensions.digest(v_caller_uid::text, 'sha256'), 'hex'
  );

  insert into public.audit_logs(
    user_id_hash, table_name, action,
    user_id, actor_user_id, action_name, row_pk, after_data, source
  ) values (
    v_user_id_hash, 'org_settings', 'update',
    v_caller_uid, v_caller_uid,
    'update_org_ranking_weights', p_org_id::text,
    jsonb_build_object('org_id', p_org_id, 'ranking_weights', p_weights),
    'rpc'
  );
end;
$$;

revoke all on function public.update_org_ranking_weights(uuid, jsonb) from public;
grant execute on function public.update_org_ranking_weights(uuid, jsonb) to authenticated;

commit;
