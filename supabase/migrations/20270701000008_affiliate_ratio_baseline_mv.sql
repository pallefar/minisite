-- Phase 26 Plan 26-02 — AFFTIER-05 ratio Z-score anomaly baseline.
--
-- Adds a NEW materialized view `affiliate_ratio_baseline` that aggregates the
-- 7-day daily ratio (clicks / impressions) per affiliate. Refreshed hourly
-- with CONCURRENTLY (UNIQUE index on affiliate_id is the load-bearing line).
--
-- D-10 — this layer EXTENDS the v1.2 AFF-08 raw-count Z-score detector;
-- it does NOT replace it. Both detectors stay live; either flag = flagged.
--
-- Pitfall 4 (PATTERNS.md) — `nullif(impression_count, 0)` is the cold-start
-- divide-by-zero guard for days where an affiliate had clicks recorded but
-- no impression events (e.g. mobile-app deep-link path). AVG / STDDEV_SAMP
-- skip nulls, so cold-start days are excluded from the baseline.
--
-- Pitfall 5 — REFRESH MATERIALIZED VIEW CONCURRENTLY requires a UNIQUE index
-- on the view (see reference_supabase_migration_gotchas.md). The
-- `idx_ratio_baseline_affiliate` index below is mandatory.
--
-- Cron timing — `5 * * * *` (5 min past every hour). Chosen to be clear of:
--   - `0 1 * * *` (affiliate_click_baseline refresh, 20270101000009)
--   - `0 0 * * *` / `0 3 * * *` (other daily jobs)
-- No two cron entries fire at the same minute under hourly cadence.

create materialized view if not exists public.affiliate_ratio_baseline as
with daily_pairs as (
  select
    coalesce(c.affiliate_id, i.affiliate_id) as affiliate_id,
    date_trunc('day', coalesce(c.created_at, i.created_at))::date as d,
    count(distinct c.id) as click_count,
    count(distinct i.id) as impression_count
  from public.affiliate_clicks c
  full outer join public.affiliate_impressions i
    on c.affiliate_id = i.affiliate_id
    and date_trunc('day', c.created_at) = date_trunc('day', i.created_at)
  where coalesce(c.created_at, i.created_at) > now() - interval '7 days'
  group by coalesce(c.affiliate_id, i.affiliate_id),
           date_trunc('day', coalesce(c.created_at, i.created_at))
)
select
  affiliate_id,
  avg(click_count::numeric / nullif(impression_count, 0))::numeric(10,4) as mean_ratio,
  stddev_samp(click_count::numeric / nullif(impression_count, 0))::numeric(10,4) as stddev_ratio,
  count(*) filter (where impression_count > 0) as days_observed
from daily_pairs
group by affiliate_id;

-- Pitfall 5: UNIQUE index required for REFRESH MATERIALIZED VIEW CONCURRENTLY.
create unique index if not exists idx_ratio_baseline_affiliate
  on public.affiliate_ratio_baseline(affiliate_id);

comment on materialized view public.affiliate_ratio_baseline is
  'AFFTIER-05 (D-10): 7-day rolling click/impression ratio baseline per affiliate. '
  'Refreshed CONCURRENTLY hourly via pg_cron. Ratio Z-score check lives in '
  'affiliate-attribute Edge Fn (Plan 26-02). EXTENDS v1.2 AFF-08 raw-count detector — '
  'does not replace it.';

grant select on public.affiliate_ratio_baseline to authenticated, service_role;

-- Helper SECDEF function — called by Edge Fn ratio detector. Returns z-score
-- or NULL on cold-start (days_observed < 7) or zero-stddev.
--
-- STABLE (not IMMUTABLE) — reads matview state, which is per-snapshot stable
-- but not deterministic across refreshes. SECDEF + search_path locked per
-- reference_supabase_migration_gotchas.md.
create or replace function public.compute_affiliate_ratio_z_score(
  p_affiliate_id uuid,
  p_observation numeric
) returns numeric
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select case
    when days_observed < 7 then null
    when stddev_ratio is null or stddev_ratio = 0 then null
    else ((p_observation - mean_ratio) / stddev_ratio)::numeric(10,4)
  end
  from public.affiliate_ratio_baseline
  where affiliate_id = p_affiliate_id;
$$;

revoke all on function public.compute_affiliate_ratio_z_score(uuid, numeric) from public;
grant execute on function public.compute_affiliate_ratio_z_score(uuid, numeric) to service_role, authenticated;

comment on function public.compute_affiliate_ratio_z_score(uuid, numeric) is
  'AFFTIER-05 (D-10): compute z-score for a fresh ratio observation against the '
  'affiliate''s own 7-day baseline. Returns NULL on cold-start. Called from '
  'supabase/functions/affiliate-attribute/index.ts.';

-- Cron refresh — 5 min past every hour. CONCURRENTLY needs the UNIQUE index above.
select cron.schedule(
  'affiliate-ratio-baseline-refresh',
  '5 * * * *',
  $$ refresh materialized view concurrently public.affiliate_ratio_baseline; $$
);
