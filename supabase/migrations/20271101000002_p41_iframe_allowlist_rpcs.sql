-- Phase 41 Plan 41-02 — SECDEF RPCs for Custom-iframe allowlist mutations.
-- Decision refs: D-17 (superadmin-only), EMBED-07.
--
-- Two SECURITY DEFINER functions that are the SOLE write path into
-- public.iframe_allowlist (the table has no INSERT/UPDATE/DELETE RLS
-- policies). Both:
--   • gate on public.is_admin_at_least('superadmin'::public.admin_role)
--     and raise 42501 ('forbidden') otherwise — server-side enforcement
--     of D-17 superadmin posture; UI is not the security boundary
--     (Pattern S1 dual-layer).
--   • reject malformed hostnames with errcode 22023 — defensive layer
--     matching the UI-SPEC §Surface E client-side validation.
--   • call public.log_admin_action(p_action_name, p_target_user_id,
--     p_table_name, p_row_pk, p_before, p_after) — the canonical 6-arg
--     signature verified against 20270601000029_log_admin_action_function
--     lines 16-23. Action names 'iframe_allowlist.add' and
--     'iframe_allowlist.remove' flow into the existing 90d retention
--     sweep (audit_retention_cron — no new cron needed).
--
-- SECURITY DEFINER requires `set search_path = extensions, public, pg_temp`
-- per reference_supabase_migration_gotchas.
--
-- The RPCs reference auth.uid(); they are called by the Plan 41-06 admin
-- UI using the authenticated supabase-js client (NOT service-role) — the
-- user's JWT carries the superadmin role that the gate checks.

create function public.add_iframe_allowlist_hostname(p_hostname text)
returns uuid
language plpgsql
security definer
set search_path = extensions, public, pg_temp
as $$
declare
  v_id uuid;
begin
  -- D-17 dual-layer gate: server-side superadmin check, regardless of
  -- whatever the client claims. Pattern S1.
  if not public.is_admin_at_least('superadmin'::public.admin_role) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_hostname is null or p_hostname = '' then
    raise exception 'hostname required' using errcode = '22023';
  end if;

  -- Reject anything that isn't a bare hostname. UI-SPEC §Surface E does
  -- the same client-side; this is the defense-in-depth layer.
  if p_hostname like '%://%'
     or p_hostname like '%/%'
     or p_hostname like '%*%'
     or p_hostname like '.%' then
    raise exception 'hostname must be a bare hostname' using errcode = '22023';
  end if;

  insert into public.iframe_allowlist (hostname, added_by_user_id)
  values (p_hostname, auth.uid())
  returning id into v_id;

  -- 6-arg canonical log_admin_action signature.
  --   (p_action_name, p_target_user_id, p_table_name, p_row_pk, p_before, p_after)
  perform public.log_admin_action(
    'iframe_allowlist.add',
    null,
    'iframe_allowlist',
    v_id::text,
    null,
    jsonb_build_object('hostname', p_hostname)
  );

  return v_id;
end;
$$;

grant execute on function public.add_iframe_allowlist_hostname(text)
  to authenticated;


create function public.remove_iframe_allowlist_hostname(p_id uuid)
returns void
language plpgsql
security definer
set search_path = extensions, public, pg_temp
as $$
declare
  v_hostname text;
begin
  if not public.is_admin_at_least('superadmin'::public.admin_role) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_id is null then
    raise exception 'id required' using errcode = '22023';
  end if;

  -- Capture before-state for the audit log p_before payload.
  select hostname into v_hostname
  from public.iframe_allowlist
  where id = p_id;

  delete from public.iframe_allowlist
  where id = p_id;

  perform public.log_admin_action(
    'iframe_allowlist.remove',
    null,
    'iframe_allowlist',
    p_id::text,
    jsonb_build_object('hostname', v_hostname),
    null
  );
end;
$$;

grant execute on function public.remove_iframe_allowlist_hostname(uuid)
  to authenticated;
