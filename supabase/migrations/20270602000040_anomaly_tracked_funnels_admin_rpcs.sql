-- Phase 27 plan 27-05 — TAXO-05 admin self-serve SECDEF RPCs for the
-- anomaly_tracked_funnels config surface.
--
-- Decision refs: CONTEXT D-14 (admin-configurable funnels); D-19 (status
-- machine ownership). 27-PATTERNS S1 (UI gate + SECDEF re-check) + S3
-- (suppress_audit GUC) + S10 (status writer ownership).
--
-- Three RPCs ship the founder's post-deploy CRUD path for tracked funnels.
-- Without these, adding a 6th funnel after the 5 v1 seeds (migration
-- 20260601000031) requires a code change + migration deploy; with these the
-- founder edits live via /admin/anomaly (Plan 27-05 UI).
--
--   anomaly_funnel_define(event_name, lookback_days?, sigma_threshold?)
--     returns uuid — inserts a new row, returns funnel_id; UNIQUE violation
--     surfaces as 'duplicate_event_name' (errcode 23505 native).
--
--   anomaly_funnel_update(funnel_id, is_enabled?, lookback_days?,
--                         sigma_threshold?)
--     returns void — COALESCE pattern for partial updates; 'not_found' (22023)
--     when no row matches. Diff before/after via row_to_json.
--
--   anomaly_funnel_delete(funnel_id) returns void — refuses with
--     'has_alerts' (22023) when any funnel_anomaly_alerts row exists for the
--     funnel_id. T-27-05-02 mitigation: delete-then-recreate cannot erase
--     alert history.
--
-- AUTHZ — all three:
--   - auth.uid() not null → otherwise raise 28000 not_authenticated
--   - is_admin_at_least('superadmin') → otherwise raise 42501 forbidden
--     (matches table-level RLS in 20260601000031 — INSERT/UPDATE/DELETE
--      policies all superadmin-only; SECDEF body is the same gate.)
--
-- AUDIT — all three:
--   - perform set_config('app.suppress_audit', 'true', true) per Pattern S3
--     to keep the audit trigger from firing in addition to log_admin_action.
--   - log_admin_action(action_name, target_user_id=null, table_name=
--     'anomaly_tracked_funnels', row_pk=funnel_id::text, before, after) —
--     uses the Phase 24 helper (correct columns: actor_user_id, row_pk,
--     table_name). Do NOT raw-insert into audit_logs (column shape is
--     actor_user_id NOT user_id — would fail).
--
-- search_path = public, extensions, pg_catalog, pg_temp per
-- [[reference_supabase_migration_gotchas]] Pitfall 2 (SECDEF needs
-- extensions on the path).
--
-- TIMESTAMP NOTE: this migration uses the 20270602* slot rather than the
-- plan-spec'd 20260601000040 because 20260601* collides with already-applied
-- pending_account_deletions migrations on the linked DB. Same pattern as
-- 27-02's renamed cohort batch.

-- =============================================================================
-- 1. anomaly_funnel_define — INSERT a new tracked funnel
-- =============================================================================
create or replace function public.anomaly_funnel_define(
  p_event_name       text,
  p_lookback_days    int     default 7,
  p_sigma_threshold  numeric default 2.0
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_catalog, pg_temp
as $$
declare
  v_caller     uuid := auth.uid();
  v_funnel_id  uuid;
  v_after      jsonb;
begin
  -- 1. Authentication gate.
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  -- 2. Authorization gate — superadmin only (matches RLS in 20260601000031).
  if not public.is_admin_at_least('superadmin'::public.admin_role) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- 3. Suppress audit trigger so only log_admin_action's row lands.
  perform set_config('app.suppress_audit', 'true', true);

  -- 4. Insert. UNIQUE(event_name) violation raises errcode 23505 natively;
  --    the client wrapper maps that to 'duplicate_event_name'.
  begin
    insert into public.anomaly_tracked_funnels (
      event_name,
      is_enabled,
      baseline_lookback_days,
      sigma_threshold,
      created_by
    ) values (
      p_event_name,
      true,
      p_lookback_days,
      p_sigma_threshold,
      v_caller
    )
    returning funnel_id into v_funnel_id;
  exception when unique_violation then
    -- Re-raise with explicit token; preserve 23505 so the client can
    -- discriminate via either code or token.
    raise exception 'duplicate_event_name' using errcode = '23505';
  end;

  -- 5. Audit via Phase 24 helper.
  v_after := jsonb_build_object(
    'funnel_id',              v_funnel_id,
    'event_name',             p_event_name,
    'is_enabled',             true,
    'baseline_lookback_days', p_lookback_days,
    'sigma_threshold',        p_sigma_threshold,
    'created_by',             v_caller
  );

  perform public.log_admin_action(
    p_action_name    => 'anomaly_funnel_defined',
    p_target_user_id => null,
    p_table_name     => 'anomaly_tracked_funnels',
    p_row_pk         => v_funnel_id::text,
    p_before         => null,
    p_after          => v_after
  );

  return v_funnel_id;
end;
$$;

revoke all on function public.anomaly_funnel_define(text, int, numeric) from public;
grant execute on function public.anomaly_funnel_define(text, int, numeric) to authenticated;

comment on function public.anomaly_funnel_define(text, int, numeric) is
  'Phase 27 plan 27-05 (D-14): superadmin-gated SECDEF RPC; INSERT into anomaly_tracked_funnels. Audit via log_admin_action(anomaly_funnel_defined).';

-- =============================================================================
-- 2. anomaly_funnel_update — partial UPDATE via COALESCE
-- =============================================================================
create or replace function public.anomaly_funnel_update(
  p_funnel_id        uuid,
  p_is_enabled       boolean default null,
  p_lookback_days    int     default null,
  p_sigma_threshold  numeric default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog, pg_temp
as $$
declare
  v_caller  uuid := auth.uid();
  v_before  jsonb;
  v_after   jsonb;
  v_rows    int;
begin
  -- 1. Authentication gate.
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  -- 2. Authorization gate.
  if not public.is_admin_at_least('superadmin'::public.admin_role) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- 3. Snapshot BEFORE state for the audit diff. Locks the row for the
  --    duration of the txn so concurrent updates serialize.
  select row_to_json(t)::jsonb
    into v_before
    from public.anomaly_tracked_funnels t
    where t.funnel_id = p_funnel_id
    for update;

  if v_before is null then
    raise exception 'not_found' using errcode = '22023';
  end if;

  -- 4. Suppress audit trigger so only log_admin_action's row lands.
  perform set_config('app.suppress_audit', 'true', true);

  -- 5. Partial update via COALESCE (NULL param → keep existing value).
  update public.anomaly_tracked_funnels
     set is_enabled             = coalesce(p_is_enabled, is_enabled),
         baseline_lookback_days = coalesce(p_lookback_days, baseline_lookback_days),
         sigma_threshold        = coalesce(p_sigma_threshold, sigma_threshold)
   where funnel_id = p_funnel_id;

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    -- Defensive: row vanished between the SELECT FOR UPDATE and the UPDATE.
    -- Shouldn't happen under FOR UPDATE locking, but covers the race.
    raise exception 'not_found' using errcode = '22023';
  end if;

  -- 6. Snapshot AFTER state.
  select row_to_json(t)::jsonb
    into v_after
    from public.anomaly_tracked_funnels t
    where t.funnel_id = p_funnel_id;

  -- 7. Audit via Phase 24 helper.
  perform public.log_admin_action(
    p_action_name    => 'anomaly_funnel_updated',
    p_target_user_id => null,
    p_table_name     => 'anomaly_tracked_funnels',
    p_row_pk         => p_funnel_id::text,
    p_before         => v_before,
    p_after          => v_after
  );
end;
$$;

revoke all on function public.anomaly_funnel_update(uuid, boolean, int, numeric) from public;
grant execute on function public.anomaly_funnel_update(uuid, boolean, int, numeric) to authenticated;

comment on function public.anomaly_funnel_update(uuid, boolean, int, numeric) is
  'Phase 27 plan 27-05 (D-14): superadmin-gated SECDEF RPC; partial UPDATE via COALESCE. Audit via log_admin_action(anomaly_funnel_updated) with before/after row_to_json diff.';

-- =============================================================================
-- 3. anomaly_funnel_delete — DELETE with has_alerts guard
-- =============================================================================
create or replace function public.anomaly_funnel_delete(
  p_funnel_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog, pg_temp
as $$
declare
  v_caller       uuid := auth.uid();
  v_before       jsonb;
  v_alert_count  int;
begin
  -- 1. Authentication gate.
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  -- 2. Authorization gate.
  if not public.is_admin_at_least('superadmin'::public.admin_role) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- 3. Snapshot BEFORE state + lock row.
  select row_to_json(t)::jsonb
    into v_before
    from public.anomaly_tracked_funnels t
    where t.funnel_id = p_funnel_id
    for update;

  if v_before is null then
    raise exception 'not_found' using errcode = '22023';
  end if;

  -- 4. has_alerts guard — T-27-05-02 mitigation.
  --    Even though funnel_anomaly_alerts has ON DELETE CASCADE, we refuse
  --    the delete when alert history exists so a delete-then-recreate
  --    cycle cannot erase the audit trail. Disable (is_enabled=false) is
  --    the documented alternative.
  select count(*)
    into v_alert_count
    from public.funnel_anomaly_alerts
    where funnel_id = p_funnel_id;

  if v_alert_count > 0 then
    raise exception 'has_alerts' using errcode = '22023';
  end if;

  -- 5. Suppress audit trigger so only log_admin_action's row lands.
  perform set_config('app.suppress_audit', 'true', true);

  -- 6. Delete.
  delete from public.anomaly_tracked_funnels
   where funnel_id = p_funnel_id;

  -- 7. Audit via Phase 24 helper.
  perform public.log_admin_action(
    p_action_name    => 'anomaly_funnel_deleted',
    p_target_user_id => null,
    p_table_name     => 'anomaly_tracked_funnels',
    p_row_pk         => p_funnel_id::text,
    p_before         => v_before,
    p_after          => null
  );
end;
$$;

revoke all on function public.anomaly_funnel_delete(uuid) from public;
grant execute on function public.anomaly_funnel_delete(uuid) to authenticated;

comment on function public.anomaly_funnel_delete(uuid) is
  'Phase 27 plan 27-05 (D-14): superadmin-gated SECDEF RPC; refuses delete when funnel_anomaly_alerts has rows (T-27-05-02). Audit via log_admin_action(anomaly_funnel_deleted).';
