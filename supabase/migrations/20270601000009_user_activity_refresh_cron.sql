-- Phase 22 plan 01 — D-04: daily pg_cron refresh of user_activity_daily matview.
-- Analog: supabase/migrations/20270101000009_click_baseline_refresh_cron.sql (exact pattern copy)
-- Pitfalls applied: Pitfall 5 (CONCURRENTLY requires UNIQUE index — provided in File 08).
--
-- Schedule: 02:00 UTC daily — offset from existing crons to spread free-tier compute:
--   01:00 UTC — affiliate-click-baseline-refresh
--   02:00 UTC — user-activity-daily-refresh                   ← THIS
--   03:00 UTC — cleanup-anon-users
--   04:00 UTC — finalize-account-deletions                     (rescheduled in File 01 to 7d)
--   05:00 UTC — cleanup-audit-logs
--   05:00 UTC — feature-flag-overrides-cleanup                (File 16; shares 05:00 with audit cleanup)

create extension if not exists pg_cron;

select cron.schedule(
  'user-activity-daily-refresh',
  '0 2 * * *',
  $$ refresh materialized view concurrently public.user_activity_daily; $$
);

-- Rollback hint (manual): select cron.unschedule('user-activity-daily-refresh');
