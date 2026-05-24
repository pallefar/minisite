-- Phase 39 Plan 39-03 — pg_cron schedule for pharma NPS+1★ kill scan (D-03).
--
-- Cron name: p39-pharma-nps-kill
-- Schedule:  0 4 * * 0   (weekly Sunday at 04:00 UTC)
-- Body:      select public.p39_pharma_nps_kill_scan();
--
-- D-03: PHARMA either-trigger kill — NPS drop >=5 OR 1-rating rate > 2x baseline.
-- NPS branch reads quarterly_nps_responses; 1★ branch defensively probes
-- review_submissions via to_regclass (table planned by 39-08, may not exist).
-- Idempotent re-runs are no-ops.
--
-- Pattern: supabase/migrations/20270602000013_cohort_matview_refresh_cron.sql
-- Named-tag dollar-quotes per [[reference_postgres_dollar_quote_nesting_in_cron_body]].

create extension if not exists pg_cron;

do $unschedule$
begin
  perform cron.unschedule('p39-pharma-nps-kill');
exception when others then
  null;
end
$unschedule$;

select cron.schedule(
  'p39-pharma-nps-kill',
  '0 4 * * 0',
  $cron$ select public.p39_pharma_nps_kill_scan(); $cron$
);

-- Rollback hint (manual): select cron.unschedule('p39-pharma-nps-kill');
