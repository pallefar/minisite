-- Phase 19 Plan 19-07 — Click-fraud baseline materialized view (D-26 Z-score).
--
-- Spec references:
--   - 19-CONTEXT.md D-26: Z-score-based per-affiliate fraud; flag clicks ≥ 3σ above
--     the affiliate's own 7-day rolling daily-count baseline.
--   - 19-CONTEXT.md D-27: cold-start (affiliate < 7 days old) — Z-score check
--     skipped; cold-start cap (500/day) from Plan 19-02 handles it.
--   - 19-CONTEXT-ADDENDUM-research.md D-38: AFF-08 v1.2 ships ONLY raw-count Z-score.
--     Impression-to-click RATIO detector is DEFERRED to v1.3.
--   - 19-RESEARCH.md §"Pattern 4: Z-score materialized view" lines 519-546.
--
-- Landmines (reference_supabase_migration_gotchas):
--   - Pitfall 5: REFRESH MATERIALIZED VIEW CONCURRENTLY requires a UNIQUE index on
--     the view, OR the refresh fails with `ERROR: cannot refresh materialized view
--     "..." concurrently`. The `idx_click_baseline_affiliate` index below is the
--     load-bearing line.
--   - Pitfall 1 (analog): `date_trunc('day', timestamptz)` is STABLE not IMMUTABLE
--     because it depends on session TimeZone. This is acceptable here because we
--     compute the bucketed value INSIDE the SELECT (not as an index predicate).
--     Affiliate_clicks indexes (affiliate_id, created_at) directly per Plan 19-01
--     (see comment lines 41-44 of 20270101000002_affiliate_clicks_conversions_payouts.sql).
--
-- FK retention contract: matview re-aggregates on every refresh; no FK to
-- affiliate_clicks. Click rows deleted via ON DELETE CASCADE (affiliate delete)
-- disappear on next refresh — acceptable for fraud-baseline (not an IRS record).

create materialized view public.affiliate_click_baseline as
select
  affiliate_id,
  avg(daily_count)::numeric(10,2) as mean_clicks,
  stddev_samp(daily_count)::numeric(10,2) as stddev_clicks,
  max(d)::date as latest_baseline_date,
  count(*) as days_observed
from (
  select
    affiliate_id,
    date_trunc('day', created_at)::date as d,
    count(*) as daily_count
  from public.affiliate_clicks
  where created_at > now() - interval '7 days'
  group by affiliate_id, date_trunc('day', created_at)::date
) daily
group by affiliate_id;

-- Pitfall 5 load-bearing UNIQUE index for `REFRESH MATERIALIZED VIEW CONCURRENTLY`.
create unique index idx_click_baseline_affiliate
  on public.affiliate_click_baseline(affiliate_id);

comment on materialized view public.affiliate_click_baseline is
  'AFF-08 (D-26): 7-day rolling daily-click baseline per affiliate. Refreshed CONCURRENTLY at 01:00 UTC by pg_cron (see 20270101000008_click_baseline_refresh_cron.sql). Z-score check lives in affiliate-attribute Edge Function (Plan 19-02 extension, Plan 19-07 Task 2).';

grant select on public.affiliate_click_baseline to authenticated, service_role;
