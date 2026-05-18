-- Phase 30 Plan 00 — Task 2 (migration 3/5)
-- 4 status-machine SECDEFs + AFTER UPDATE pg_notify trigger for ranking_weights.
-- Per CONTEXT D-10, D-06 (RESEARCH correction: AFTER UPDATE, not BEFORE).
--
-- SECDEFs:
--   update_org_ranking_weights(p_org_id, p_weights) — admin-only; validates shape via trigger
--   set_patient_dose_thresholds(p_org_id, p_patient_user_id, p_thresholds) — admin or staff
--   acknowledge_clinician_alert(p_alert_id) — admin or staff; status: pending → acknowledged
--   snooze_clinician_alert(p_alert_id, p_duration) — admin or staff; status: pending → snoozed
--
-- All SECDEFs:
--   security definer set search_path = pg_catalog, public, extensions
--   direct INSERT INTO audit_logs (NOT log_admin_action — requires platform-admin)
--   perform set_config('app.suppress_audit', 'on', true) before audit INSERT (prevents recursion)
--   role check via org_members using 'admin' / 'staff' (NOT 'clinician')
--
-- Trigger:
--   _notify_org_settings_weights_changed() — AFTER UPDATE OF ranking_weights
--   fires pg_notify('org_settings_weights_changed', ...) on committed ranking_weights change

begin;

-- =============================================================================
-- SECDEF 1: update_org_ranking_weights
-- =============================================================================
-- Admin-only: updates org_settings.ranking_weights.
-- Validation is handled by the BEFORE UPDATE trigger (_trg_validate_ranking_weights)
-- on org_settings, which raises P0001 if shape is invalid.
-- =============================================================================
create or replace function public.update_org_ranking_weights(
  p_org_id  uuid,
  p_weights jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_caller_uid uuid := auth.uid();
  v_role       public.org_member_role;
  v_user_id_hash text;
begin
  -- Unauthenticated guard
  if v_caller_uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  -- Pattern S1: DB-level admin role re-check
  select role into v_role
  from public.org_members
  where org_id = p_org_id and user_id = v_caller_uid;

  if v_role is null or v_role <> 'admin' then
    raise exception 'admin role required' using errcode = '42501';
  end if;

  -- Update org_settings (trigger validates ranking_weights shape — raises P0001 on violation)
  update public.org_settings
  set ranking_weights = p_weights
  where org_id = p_org_id;

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

-- =============================================================================
-- SECDEF 2: set_patient_dose_thresholds
-- =============================================================================
-- Admin or staff: upserts per-patient threshold overrides.
-- Re-checks that the patient has an active link to this org.
-- =============================================================================
create or replace function public.set_patient_dose_thresholds(
  p_org_id          uuid,
  p_patient_user_id uuid,
  p_thresholds      jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_caller_uid uuid := auth.uid();
  v_role       public.org_member_role;
  v_link_exists boolean;
  v_user_id_hash text;
begin
  -- Unauthenticated guard
  if v_caller_uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  -- Pattern S1: DB-level role re-check (admin or staff)
  select role into v_role
  from public.org_members
  where org_id = p_org_id and user_id = v_caller_uid;

  if v_role is null or v_role not in ('admin', 'staff') then
    raise exception 'admin or staff role required' using errcode = '42501';
  end if;

  -- Verify active org_patient_links row exists (unlinked_at IS NULL)
  select exists(
    select 1 from public.org_patient_links
    where org_id = p_org_id
      and patient_user_id = p_patient_user_id
      and unlinked_at is null
  ) into v_link_exists;

  if not v_link_exists then
    raise exception 'no active patient link found for this org + patient combination'
      using errcode = '42704';
  end if;

  -- Upsert per-patient threshold override
  insert into public.org_patient_thresholds(
    org_id, patient_user_id, thresholds, set_by, set_at
  )
  values(
    p_org_id, p_patient_user_id, p_thresholds, v_caller_uid, now()
  )
  on conflict (org_id, patient_user_id) do update
    set thresholds = excluded.thresholds,
        set_by     = v_caller_uid,
        set_at     = now();

  -- Audit log
  perform set_config('app.suppress_audit', 'on', true);

  v_user_id_hash := encode(
    extensions.digest(v_caller_uid::text, 'sha256'), 'hex'
  );

  insert into public.audit_logs(
    user_id_hash, table_name, action,
    user_id, actor_user_id, action_name, row_pk, after_data, source
  ) values (
    v_user_id_hash, 'org_patient_thresholds', 'upsert',
    v_caller_uid, v_caller_uid,
    'set_patient_dose_thresholds',
    format('%s:%s', p_org_id, p_patient_user_id),
    jsonb_build_object(
      'org_id', p_org_id,
      'patient_user_id', p_patient_user_id,
      'thresholds', p_thresholds
    ),
    'rpc'
  );
end;
$$;

revoke all on function public.set_patient_dose_thresholds(uuid, uuid, jsonb) from public;
grant execute on function public.set_patient_dose_thresholds(uuid, uuid, jsonb) to authenticated;

-- =============================================================================
-- SECDEF 3: acknowledge_clinician_alert
-- =============================================================================
-- Admin or staff: transitions alert status pending → acknowledged.
-- Re-checks org membership and that caller has access to this alert's org.
-- Raises 22023 if alert is not in 'pending' status (guards re-ack).
-- =============================================================================
create or replace function public.acknowledge_clinician_alert(
  p_alert_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_caller_uid uuid := auth.uid();
  v_alert      record;
  v_role       public.org_member_role;
  v_rows_updated int;
  v_user_id_hash text;
begin
  -- Unauthenticated guard
  if v_caller_uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  -- Fetch the alert to get its org_id
  select id, org_id, status
  into v_alert
  from public.clinician_alerts
  where id = p_alert_id;

  if not found then
    raise exception 'alert not found' using errcode = '42704';
  end if;

  -- Pattern S1: DB-level role re-check for alert's org (cross-tenant defense T-30-00-03)
  select role into v_role
  from public.org_members
  where org_id = v_alert.org_id and user_id = v_caller_uid;

  if v_role is null or v_role not in ('admin', 'staff') then
    raise exception 'admin or staff role required for this organization' using errcode = '42501';
  end if;

  -- Transition: pending → acknowledged (raise 22023 if already not pending)
  update public.clinician_alerts
  set status = 'acknowledged',
      ack_by = v_caller_uid,
      ack_at = now()
  where id = p_alert_id
    and status = 'pending';

  get diagnostics v_rows_updated = row_count;

  if v_rows_updated = 0 then
    raise exception 'alert is not in pending status (may already be acknowledged, snoozed, or resolved)'
      using errcode = '22023';
  end if;

  -- Audit log
  perform set_config('app.suppress_audit', 'on', true);

  v_user_id_hash := encode(
    extensions.digest(v_caller_uid::text, 'sha256'), 'hex'
  );

  insert into public.audit_logs(
    user_id_hash, table_name, action,
    user_id, actor_user_id, action_name, row_pk, after_data, source
  ) values (
    v_user_id_hash, 'clinician_alerts', 'update',
    v_caller_uid, v_caller_uid,
    'acknowledge_clinician_alert', p_alert_id::text,
    jsonb_build_object(
      'status', 'acknowledged',
      'ack_by', v_caller_uid,
      'ack_at', now()
    ),
    'rpc'
  );
end;
$$;

revoke all on function public.acknowledge_clinician_alert(uuid) from public;
grant execute on function public.acknowledge_clinician_alert(uuid) to authenticated;

-- =============================================================================
-- SECDEF 4: snooze_clinician_alert
-- =============================================================================
-- Admin or staff: transitions alert status pending → snoozed.
-- p_duration must be one of '1h', '4h', '24h', '7d' (preset-only per D-13).
-- Raises 22023 for invalid duration or non-pending alert.
-- =============================================================================
create or replace function public.snooze_clinician_alert(
  p_alert_id uuid,
  p_duration text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_caller_uid uuid := auth.uid();
  v_alert      record;
  v_role       public.org_member_role;
  v_interval   interval;
  v_rows_updated int;
  v_user_id_hash text;
begin
  -- Unauthenticated guard
  if v_caller_uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  -- Validate preset duration (D-13: no free-form durations in v1.3)
  v_interval := case p_duration
    when '1h'  then interval '1 hour'
    when '4h'  then interval '4 hours'
    when '24h' then interval '24 hours'
    when '7d'  then interval '7 days'
    else null
  end;

  if v_interval is null then
    raise exception 'duration must be one of: 1h, 4h, 24h, 7d'
      using errcode = '22023';
  end if;

  -- Fetch the alert to get its org_id
  select id, org_id, status
  into v_alert
  from public.clinician_alerts
  where id = p_alert_id;

  if not found then
    raise exception 'alert not found' using errcode = '42704';
  end if;

  -- Pattern S1: DB-level role re-check for alert's org (cross-tenant defense T-30-00-03)
  select role into v_role
  from public.org_members
  where org_id = v_alert.org_id and user_id = v_caller_uid;

  if v_role is null or v_role not in ('admin', 'staff') then
    raise exception 'admin or staff role required for this organization' using errcode = '42501';
  end if;

  -- Transition: pending → snoozed
  update public.clinician_alerts
  set status      = 'snoozed',
      snooze_until = now() + v_interval
  where id = p_alert_id
    and status = 'pending';

  get diagnostics v_rows_updated = row_count;

  if v_rows_updated = 0 then
    raise exception 'alert is not in pending status'
      using errcode = '22023';
  end if;

  -- Audit log
  perform set_config('app.suppress_audit', 'on', true);

  v_user_id_hash := encode(
    extensions.digest(v_caller_uid::text, 'sha256'), 'hex'
  );

  insert into public.audit_logs(
    user_id_hash, table_name, action,
    user_id, actor_user_id, action_name, row_pk, after_data, source
  ) values (
    v_user_id_hash, 'clinician_alerts', 'update',
    v_caller_uid, v_caller_uid,
    'snooze_clinician_alert', p_alert_id::text,
    jsonb_build_object(
      'status', 'snoozed',
      'snooze_until', now() + v_interval,
      'duration', p_duration
    ),
    'rpc'
  );
end;
$$;

revoke all on function public.snooze_clinician_alert(uuid, text) from public;
grant execute on function public.snooze_clinician_alert(uuid, text) to authenticated;

-- =============================================================================
-- AFTER UPDATE trigger for D-06: ranking_weights change broadcast
--
-- RESEARCH §Pattern 1 correction: AFTER UPDATE (not BEFORE) ensures
-- pg_notify fires only after the transaction commits successfully.
-- =============================================================================
create or replace function public._notify_org_settings_weights_changed()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
begin
  -- Only notify when ranking_weights actually changed (not on other column updates)
  if (new.ranking_weights is distinct from old.ranking_weights) then
    perform pg_notify(
      'org_settings_weights_changed',
      json_build_object('org_id', new.org_id)::text
    );
  end if;
  return new;
end;
$$;

-- Drop existing trigger before recreating (idempotent)
drop trigger if exists org_settings_weights_changed_trigger on public.org_settings;

create trigger org_settings_weights_changed_trigger
  after update of ranking_weights
  on public.org_settings
  for each row
  execute function public._notify_org_settings_weights_changed();

commit;
