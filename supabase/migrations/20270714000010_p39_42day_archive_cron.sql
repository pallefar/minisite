-- Phase 39 Plan 39-03 — pg_cron schedule for 42-day variant archive scan (D-11).
--
-- Cron name: p39-variant-42day-archive
-- Schedule:  0 6 * * *   (daily at 06:00 UTC)
-- Body:      select public.p39_variant_42day_archive_scan();
--
-- D-11: Page-builder variants follow a 42-day lifecycle. Day 35 warns, day 42
-- hard-cuts traffic back to control. Idempotent re-runs are no-ops (the scan
-- function guards on warned_at IS NULL / archived_at IS NULL).
--
-- Pattern: supabase/migrations/20270602000013_cohort_matview_refresh_cron.sql
-- Named-tag dollar-quotes per [[reference_postgres_dollar_quote_nesting_in_cron_body]]:
--   $cron$ outer (cron.schedule body).
-- vault.decrypted_secrets is referenced inside the SCAN FUNCTION (migration 15),
-- NOT here — this migration just schedules the bare scan-function call.

create extension if not exists pg_cron;

-- Idempotent: unschedule any prior version first.
do $unschedule$
begin
  perform cron.unschedule('p39-variant-42day-archive');
exception when others then
  null;
end
$unschedule$;

select cron.schedule(
  'p39-variant-42day-archive',
  '0 6 * * *',
  $cron$ select public.p39_variant_42day_archive_scan(); $cron$
);

-- Rollback hint (manual): select cron.unschedule('p39-variant-42day-archive');
