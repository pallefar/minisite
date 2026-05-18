-- Phase 27 plan 27-04 — funnel_anomaly_acknowledge SECDEF RPC.
--
-- Decision refs: CONTEXT D-19 (acknowledged transition); D-21 (audit_logs
-- via log_admin_action). 27-PATTERNS S3 (suppress_audit GUC).
--
-- Single status-writer for the firing → acknowledged transition on
-- public.funnel_anomaly_alerts. Per status-machine ownership (Pattern S10):
--   - cron writes 'firing' on insert
--   - this RPC writes 'acknowledged'
--   - 'resolved' is DEFERRED to v1.4 per CONTEXT D-18 (no auto-resolve in v1).
--
-- AUTHZ:
--   - auth.uid() not null → otherwise raise 28000 not_authenticated
--   - is_admin_at_least('admin') → otherwise raise 42501 forbidden
--
-- AUDIT:
--   - perform set_config('app.suppress_audit', 'true', true) per Pattern S3:
--     prevents the BEFORE-UPDATE audit trigger (20260601000017) from firing,
--     so the only audit_logs row for this transition is the one log_admin_action
--     writes. WITHOUT this, the trigger AND the explicit insert both fire,
--     producing duplicate rows.
--   - Calls public.log_admin_action(action_name='anomaly_acknowledged', ...)
--     — uses the Phase 24 helper (correct column shape: actor_user_id, row_pk,
--     table_name). Do NOT raw-insert into audit_logs (column shape is
--     actor_user_id NOT user_id — would fail).
--
-- search_path = extensions, public, pg_catalog, pg_temp per [[reference_supabase_migration_gotchas]]
-- Pitfall 2.

create or replace function public.funnel_anomaly_acknowledge(
  p_alert_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_prev_status text;
  v_funnel_id uuid;
begin
  -- 1. Authentication gate.
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  -- 2. Authorization gate — admin or higher.
  if not public.is_admin_at_least('admin'::public.admin_role) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- 3. Lock + read prior status.
  select resolution_status, funnel_id
    into v_prev_status, v_funnel_id
    from public.funnel_anomaly_alerts
    where id = p_alert_id
    for update;

  if not found then
    raise exception 'not_found' using errcode = '22023';
  end if;

  -- 4. Idempotency guard — re-acknowledge is a no-op.
  if v_prev_status = 'acknowledged' then
    return;
  end if;

  -- 5. Suppress audit trigger so only log_admin_action's row lands.
  perform set_config('app.suppress_audit', 'true', true);

  -- 6. Status transition.
  update public.funnel_anomaly_alerts
     set resolution_status = 'acknowledged',
         acknowledged_by   = v_caller,
         acknowledged_at   = now()
   where id = p_alert_id;

  -- 7. Audit via Phase 24 helper (correct column shape).
  perform public.log_admin_action(
    p_action_name    => 'anomaly_acknowledged',
    p_target_user_id => null,
    p_table_name     => 'funnel_anomaly_alerts',
    p_row_pk         => p_alert_id::text,
    p_before         => jsonb_build_object('resolution_status', v_prev_status),
    p_after          => jsonb_build_object(
      'resolution_status', 'acknowledged',
      'alert_id', p_alert_id,
      'funnel_id', v_funnel_id
    )
  );
end;
$$;

-- Lock down: revoke public, grant only to authenticated (the SECDEF body
-- enforces the admin gate; the grant alone is not enough — Pattern S1).
revoke all on function public.funnel_anomaly_acknowledge(uuid) from public;
grant execute on function public.funnel_anomaly_acknowledge(uuid) to authenticated;

comment on function public.funnel_anomaly_acknowledge(uuid) is
  'Phase 27 plan 27-04 (D-19/D-21): admin-gated SECDEF RPC; firing → acknowledged. Audit via log_admin_action(anomaly_acknowledged) with suppress_audit GUC.';
