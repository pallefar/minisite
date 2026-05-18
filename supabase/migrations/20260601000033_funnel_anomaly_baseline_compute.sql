-- Phase 27 plan 27-04 — TAXO-05 hybrid baseline statistics function.
--
-- Decision ref: CONTEXT D-15 (hybrid same-DOW + same-HOD weighted blend
-- 0.6/0.4); D-23 (events_mirror data source — NOT public.events; that table
-- does not exist in v1.3).
--
-- Computes 4 numbers per call:
--   observed_count  — events of this name in the last 24h
--   expected_mean   — 0.4 × HOD-7d mean   + 0.6 × DOW-4w mean
--   expected_stddev — 0.4 × HOD-7d stddev + 0.6 × DOW-4w stddev
--   z_score         — (observed_count - expected_mean) / expected_stddev
--                     with explicit div-by-zero guard returning 0.
--
-- HOD-7d window: same hour-of-day across last 7 full days (excluding the
--   live 24h window). 7 data points → enough for stddev_samp.
-- DOW-4w window: same day-of-week across last 4 weeks. 4 data points.
--
-- Weights 0.4 HOD + 0.6 DOW favor weekly seasonality (e.g., signups dip on
-- Sundays) over hourly micro-noise. Tunable; lives here ONLY (no TS mirror).
--
-- SECURITY DEFINER + table-owner — bypasses RLS on events_mirror (the table
-- has NO policies; only service_role + this function read it). Pattern S2.
--
-- search_path = extensions, public, pg_temp per [[reference_supabase_migration_gotchas]]
-- Pitfall 2 (SECDEF requires explicit search_path to defend against
-- search_path injection).
--
-- Source: 27-RESEARCH.md §Pattern 5 lines 499-549, with `public.events`
-- replaced by `public.events_mirror` per D-23 / Task 1.

create or replace function public.funnel_anomaly_baseline_compute(p_event_name text)
returns table (
  observed_count int,
  expected_mean numeric,
  expected_stddev numeric,
  z_score numeric
)
language sql
security definer
stable
set search_path = extensions, public, pg_temp
as $$
  with last_24h as (
    select count(*)::int as cnt
    from public.events_mirror
    where event_name = p_event_name
      and created_at >= now() - interval '24 hours'
  ),
  same_hod_7d as (
    -- Same hour-of-day across last 7 days (excluding the live 24h window).
    select date_trunc('day', created_at) as d, count(*)::int as cnt
    from public.events_mirror
    where event_name = p_event_name
      and created_at between now() - interval '8 days' and now() - interval '1 day'
      and extract(hour from created_at) = extract(hour from now())
    group by 1
  ),
  same_dow_4w as (
    -- Same day-of-week across last 4 weeks.
    select date_trunc('day', created_at) as d, count(*)::int as cnt
    from public.events_mirror
    where event_name = p_event_name
      and created_at between now() - interval '29 days' and now() - interval '1 day'
      and extract(dow from created_at) = extract(dow from now())
    group by 1
  ),
  hod_stats as (
    select
      coalesce(avg(cnt), 0)::numeric as m,
      coalesce(stddev_samp(cnt), 0)::numeric as s
    from same_hod_7d
  ),
  dow_stats as (
    select
      coalesce(avg(cnt), 0)::numeric as m,
      coalesce(stddev_samp(cnt), 0)::numeric as s
    from same_dow_4w
  )
  select
    (select cnt from last_24h)                                              as observed_count,
    (0.4 * (select m from hod_stats) + 0.6 * (select m from dow_stats))    as expected_mean,
    (0.4 * (select s from hod_stats) + 0.6 * (select s from dow_stats))    as expected_stddev,
    case
      when (0.4 * (select s from hod_stats) + 0.6 * (select s from dow_stats)) = 0 then 0
      else ((select cnt from last_24h) - (0.4 * (select m from hod_stats) + 0.6 * (select m from dow_stats)))
        / (0.4 * (select s from hod_stats) + 0.6 * (select s from dow_stats))
    end                                                                     as z_score;
$$;

-- Lock down: only the service_role cron context calls this. Authenticated
-- never needs it directly (alerts are surfaced via the funnel_anomaly_alerts
-- table + Realtime broadcast).
revoke all on function public.funnel_anomaly_baseline_compute(text) from public;
grant execute on function public.funnel_anomaly_baseline_compute(text) to service_role;

comment on function public.funnel_anomaly_baseline_compute(text) is
  'Phase 27 plan 27-04 (D-15): hybrid 0.4 HOD-7d + 0.6 DOW-4w baseline + z-score. Reads events_mirror. SECDEF; service_role only.';
