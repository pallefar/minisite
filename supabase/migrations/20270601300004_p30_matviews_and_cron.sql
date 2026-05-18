-- Phase 30 Plan 00 — Task 2 (migration 4/5)
-- 2 materialized views + UNIQUE indexes + matview RLS + 4 pg_cron jobs.
-- Per CONTEXT D-15, D-16, D-17 + RESEARCH §D-17 RESOLVED schedule map.
--
-- Matviews:
--   mv_clinic_alert_metrics     — rolling 7-day alert counts + ack_rate + avg ack time
--   mv_clinic_dose_trend_population — per-org medication dose-range population distribution
--
-- CRITICAL: matviews do NOT inherit source-table RLS.
--   Both matviews get explicit RLS: enable + force + SELECT policy via org_members JOIN.
--   (Plan-checker BLOCKER#1 fix)
--
-- UNIQUE indexes MUST be created BEFORE first CONCURRENTLY refresh (Pitfall 2).
--
-- Pitfall 1: no now()/current_* inside matview SELECT (snapshot frozen at creation time).
--   Freshness tracked via clinic_matview_refresh_log (separate table, updated by cron).
--
-- Cron schedules (RESEARCH §D-17 RESOLVED):
--   p30_clinician_alert_detect     : '30 3 * * *'      03:30 UTC — clean slot (03:00 taken, 03:15 taken)
--   p30_clinician_alert_deliver    : '*/20 * * * *'    every 20min — Edge Fn for Resend + Realtime
--   p30_clinician_alert_auto_resolve: '15 4 * * *'     04:15 UTC — pure SQL UPDATE
--   p30_clinic_matview_refresh     : '2,17,32,47 * * * *' staggered from lifecycle-behavior-triggered :00/:15/:30/:45
--
-- vials.name (not vials.medication_name) — verified from 20260514000007_vials.sql.
--
-- Role check: 'admin' and 'staff' (NOT 'clinician').
-- Uses pg_catalog.cron schema references for pg_cron.

begin;

-- =============================================================================
-- 1. mv_clinic_alert_metrics — rolling 7-day alert summary per org + alert_type
-- =============================================================================
-- No period_start/period_end columns (Pitfall 1 — now() is frozen at matview creation).
-- Freshness tracked externally via clinic_matview_refresh_log.
create materialized view if not exists public.mv_clinic_alert_metrics as
select
  org_id,
  alert_type,
  count(*) filter (where status = 'pending')      as pending_count,
  count(*) filter (where status = 'acknowledged') as acknowledged_count,
  count(*) as total_count,
  round(
    100.0 * count(*) filter (where status = 'acknowledged') /
    nullif(count(*), 0), 2
  ) as ack_rate_pct,
  round(
    avg(
      extract(epoch from (ack_at - created_at)) / 60.0
    ) filter (where ack_at is not null), 2
  ) as avg_time_to_ack_minutes
from public.clinician_alerts
where created_at > now() - interval '7 days'
group by org_id, alert_type;

-- UNIQUE index — REQUIRED for REFRESH MATERIALIZED VIEW CONCURRENTLY (Pitfall 2).
-- Must be created before any CONCURRENTLY refresh attempt.
create unique index if not exists mv_clinic_alert_metrics_uq
  on public.mv_clinic_alert_metrics (org_id, alert_type);

-- =============================================================================
-- MATVIEW RLS — mv_clinic_alert_metrics (Plan-checker BLOCKER#1 fix)
-- Matviews do NOT inherit source-table RLS. Explicit policies required.
-- Without these, any authenticated user can SELECT all orgs' aggregated rows.
-- =============================================================================
alter materialized view public.mv_clinic_alert_metrics enable row level security;
alter materialized view public.mv_clinic_alert_metrics force row level security;

create policy "mv_clinic_alert_metrics_select"
  on public.mv_clinic_alert_metrics
  for select
  to authenticated
  using (
    exists (
      select 1 from public.org_members om
      where om.org_id = mv_clinic_alert_metrics.org_id
        and om.user_id = auth.uid()
        and om.role in ('admin', 'staff')
    )
  );

-- =============================================================================
-- 2. mv_clinic_dose_trend_population — per-org medication dose-range distribution
-- =============================================================================
-- Uses vials.name (NOT vials.medication_name — verified: column is 'name' per
-- supabase/migrations/20260514000007_vials.sql line 23).
-- Deviation from RESEARCH which referenced medication_name: using 'name' is correct.
create materialized view if not exists public.mv_clinic_dose_trend_population as
select
  opl.org_id,
  coalesce(
    (
      select v.name
      from public.vials v
      where v.user_id = opl.patient_user_id
      order by v.created_at desc
      limit 1
    ),
    'Unknown'
  ) as medication_name,
  case
    when ca.alert_type = 'dose_adherence' then 'below'
    else 'within'
  end as dosing_range_status,
  count(distinct opl.patient_user_id) as patient_count
from public.org_patient_links opl
left join public.clinician_alerts ca
  on ca.patient_user_id = opl.patient_user_id
  and ca.org_id = opl.org_id
  and ca.created_at > now() - interval '7 days'
  and ca.status <> 'auto_resolved'
where opl.unlinked_at is null
group by
  opl.org_id,
  coalesce(
    (
      select v.name
      from public.vials v
      where v.user_id = opl.patient_user_id
      order by v.created_at desc
      limit 1
    ),
    'Unknown'
  ),
  case
    when ca.alert_type = 'dose_adherence' then 'below'
    else 'within'
  end;

-- UNIQUE index — REQUIRED for REFRESH MATERIALIZED VIEW CONCURRENTLY (Pitfall 2).
create unique index if not exists mv_clinic_dose_trend_population_uq
  on public.mv_clinic_dose_trend_population (org_id, medication_name, dosing_range_status);

-- =============================================================================
-- MATVIEW RLS — mv_clinic_dose_trend_population (Plan-checker BLOCKER#1 fix)
-- =============================================================================
alter materialized view public.mv_clinic_dose_trend_population enable row level security;
alter materialized view public.mv_clinic_dose_trend_population force row level security;

create policy "mv_clinic_dose_trend_population_select"
  on public.mv_clinic_dose_trend_population
  for select
  to authenticated
  using (
    exists (
      select 1 from public.org_members om
      where om.org_id = mv_clinic_dose_trend_population.org_id
        and om.user_id = auth.uid()
        and om.role in ('admin', 'staff')
    )
  );

-- =============================================================================
-- 3. Initial populate (non-CONCURRENTLY — first run; CONCURRENTLY needs existing data)
-- =============================================================================
refresh materialized view public.mv_clinic_alert_metrics;
refresh materialized view public.mv_clinic_dose_trend_population;

-- =============================================================================
-- 4. pg_cron jobs — idempotent (unschedule existing before scheduling)
--    Per RESEARCH §D-17 RESOLVED schedule map.
-- =============================================================================

-- Unschedule any existing P30 jobs (idempotent re-run)
select cron.unschedule('p30_clinician_alert_detect')   where exists (select 1 from cron.job where jobname = 'p30_clinician_alert_detect');
select cron.unschedule('p30_clinician_alert_deliver')  where exists (select 1 from cron.job where jobname = 'p30_clinician_alert_deliver');
select cron.unschedule('p30_clinician_alert_auto_resolve') where exists (select 1 from cron.job where jobname = 'p30_clinician_alert_auto_resolve');
select cron.unschedule('p30_clinic_matview_refresh')   where exists (select 1 from cron.job where jobname = 'p30_clinic_matview_refresh');

-- =============================================================================
-- Job 1: p30_clinician_alert_detect — 03:30 UTC daily (pure SQL)
-- Detects adherence and variance breaches; INSERTs clinician_alerts with debounce.
-- RESEARCH §D-17: 03:30 UTC is a clean slot (03:00=audit-archive, 03:15=photos-trash-purge).
-- Adherence rule: patient has < N distinct injection days in past M days.
-- Note: no prescribed_cadence_days column found; rule simplified to missed injection days.
-- =============================================================================
select cron.schedule(
  'p30_clinician_alert_detect',
  '30 3 * * *',
  $$
  -- Adherence rule: detect patients missing >= N injection days in past M days
  WITH effective_thresholds AS (
    SELECT
      opl.org_id,
      opl.patient_user_id,
      COALESCE(
        opt.thresholds,
        os.dose_trend_thresholds,
        '{"missed_doses_n":2,"window_days_m":14,"variance_pct_x":25}'::jsonb
      ) AS thresholds
    FROM public.org_patient_links opl
    JOIN public.org_settings os ON os.org_id = opl.org_id
    LEFT JOIN public.org_patient_thresholds opt
      ON opt.org_id = opl.org_id
      AND opt.patient_user_id = opl.patient_user_id
    WHERE opl.unlinked_at IS NULL
  ),
  adherence_check AS (
    SELECT
      et.org_id,
      et.patient_user_id,
      'dose_adherence' AS alert_type,
      (et.thresholds->>'missed_doses_n')::int AS threshold_n,
      (et.thresholds->>'window_days_m')::int AS window_m,
      et.thresholds AS threshold_snapshot,
      COUNT(DISTINCT date_trunc('day', i.created_at)) AS injection_days
    FROM effective_thresholds et
    LEFT JOIN public.injections i
      ON i.user_id = et.patient_user_id
      AND i.created_at > NOW() - (et.thresholds->>'window_days_m')::int * INTERVAL '1 day'
    GROUP BY et.org_id, et.patient_user_id, et.thresholds
    HAVING (et.thresholds->>'window_days_m')::int - COUNT(DISTINCT date_trunc('day', i.created_at)) >= (et.thresholds->>'missed_doses_n')::int
  ),
  variance_check AS (
    SELECT
      et.org_id,
      et.patient_user_id,
      'dose_variance' AS alert_type,
      et.thresholds AS threshold_snapshot,
      (et.thresholds->>'variance_pct_x')::numeric AS threshold_x
    FROM effective_thresholds et
    JOIN (
      SELECT
        user_id,
        STDDEV_POP(interval_days) AS interval_stddev,
        AVG(interval_days) AS interval_avg
      FROM (
        SELECT
          user_id,
          EXTRACT(EPOCH FROM (created_at - LAG(created_at) OVER (PARTITION BY user_id ORDER BY created_at))) / 86400.0 AS interval_days
        FROM public.injections
        WHERE created_at > NOW() - INTERVAL '90 days'
      ) intervals
      WHERE interval_days IS NOT NULL
      GROUP BY user_id
      HAVING COUNT(*) >= 2
    ) var ON var.user_id = et.patient_user_id
    WHERE (var.interval_stddev / NULLIF(var.interval_avg, 0)) * 100 > (et.thresholds->>'variance_pct_x')::numeric
  ),
  all_detections AS (
    SELECT org_id, patient_user_id, alert_type, threshold_snapshot FROM adherence_check
    UNION ALL
    SELECT org_id, patient_user_id, alert_type, threshold_snapshot FROM variance_check
  )
  INSERT INTO public.clinician_alerts(
    org_id, patient_user_id, alert_type, severity, threshold_snapshot, debounce_key
  )
  SELECT
    d.org_id,
    d.patient_user_id,
    d.alert_type,
    1 AS severity,
    d.threshold_snapshot,
    format('%s:%s:%s', d.alert_type, d.patient_user_id, TO_CHAR(CURRENT_DATE, 'YYYY-MM-DD')) AS debounce_key
  FROM all_detections d
  ON CONFLICT (org_id, debounce_key) DO NOTHING;
  $$
);

-- =============================================================================
-- Job 2: p30_clinician_alert_deliver — every 20 minutes (Edge Fn via HTTP)
-- Edge Function (Plan 30-01) handles Resend email + Realtime broadcast.
-- =============================================================================
select cron.schedule(
  'p30_clinician_alert_deliver',
  '*/20 * * * *',
  format(
    $$
    SELECT net.http_post(
      url := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/clinician-alert-deliver-cron',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 300000
    );
    $$
  )
);

-- =============================================================================
-- Job 3: p30_clinician_alert_auto_resolve — 04:15 UTC daily (pure SQL)
-- Two transitions:
--   (a) pending → auto_resolved: pending alerts > 7d with snooze_until IS NULL
--   (b) snoozed → pending: snoozed alerts where snooze_until has elapsed
-- RESEARCH §D-17: 04:15 UTC; finalize-account-deletions + org_invites_expiry at 04:00 — 15min gap fine.
-- =============================================================================
select cron.schedule(
  'p30_clinician_alert_auto_resolve',
  '15 4 * * *',
  $$
  -- (a) pending → auto_resolved: alerts older than 7 days with no active snooze
  UPDATE public.clinician_alerts
  SET status = 'auto_resolved',
      auto_resolved_at = NOW()
  WHERE status = 'pending'
    AND snooze_until IS NULL
    AND created_at < NOW() - INTERVAL '7 days';

  -- (b) snoozed → pending: resume snoozed alerts whose snooze_until has elapsed
  UPDATE public.clinician_alerts
  SET status = 'pending',
      snooze_until = NULL
  WHERE status = 'snoozed'
    AND snooze_until < NOW();
  $$
);

-- =============================================================================
-- Job 4: p30_clinic_matview_refresh — staggered 15-min intervals (pure SQL)
-- RESEARCH §D-17: 2,17,32,47 * * * * — staggered from lifecycle-behavior-triggered :00/:15/:30/:45.
-- CONCURRENTLY refresh requires the UNIQUE indexes created above.
-- =============================================================================
select cron.schedule(
  'p30_clinic_matview_refresh',
  '2,17,32,47 * * * *',
  $$
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_clinic_alert_metrics;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_clinic_dose_trend_population;
  INSERT INTO public.clinic_matview_refresh_log(view_name, refreshed_at)
  VALUES
    ('mv_clinic_alert_metrics', NOW()),
    ('mv_clinic_dose_trend_population', NOW())
  ON CONFLICT (view_name) DO UPDATE
    SET refreshed_at = EXCLUDED.refreshed_at;
  $$
);

commit;
