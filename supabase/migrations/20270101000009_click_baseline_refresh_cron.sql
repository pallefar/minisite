-- Phase 19 Plan 19-07 — Daily pg_cron refresh for affiliate_click_baseline matview.
--
-- Spec references:
--   - 19-CONTEXT.md D-26: stored in materialized view refreshed daily.
--   - 19-RESEARCH.md §"Pattern 4" lines 540-545: 01:00 UTC daily.
--   - Pitfall 5: REFRESH CONCURRENTLY requires the UNIQUE index defined in
--     20270101000006_affiliate_click_baseline_mv.sql (idx_click_baseline_affiliate).
--
-- Pattern source: 20260512000002_anon_cleanup_pg_cron.sql (existing pg_cron analog).
-- pg_cron is enabled by default on Supabase projects since 2024; the
-- `create extension if not exists` prepend is a no-op safety net.

create extension if not exists pg_cron;

select cron.schedule(
  'affiliate-click-baseline-refresh',
  '0 1 * * *',
  $$ refresh materialized view concurrently public.affiliate_click_baseline; $$
);

-- Rollback hint (manual): select cron.unschedule('affiliate-click-baseline-refresh');
