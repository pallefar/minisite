-- Phase 35 Plan 35-04 — pg_cron refresh schedule for leaderboard_matview.
--
-- Cron offset rationale (F-2 staleness contract / D-15):
--   cohort_membership_rebuild cron runs at  7,22,37,52 * * * *
--   leaderboard_matview refresh  runs at   12,27,42,57 * * * *
--   Offset: 5 min AFTER cohort_membership_rebuild so cohort data is fresh
--   before the leaderboard reads it. Worst-case D-15 stale window = 15 min.
--
-- Dollar-quote naming (per memory reference_postgres_dollar_quote_nesting_in_cron_body):
--   $cron$  → outer delimiter passed to cron.schedule()
--   $refresh$ → inner DO block delimiter
--   $unschedule$ → pre-flight unschedule block delimiter
-- Named tags prevent the outer quote from silently closing on the first inner $$.
--
-- Patterns mirrored:
--   - 20270101000009_click_baseline_refresh_cron.sql (affiliate baseline cron)
--   - 20270707000007_helpdesk_pg_cron.sql (unschedule pre-flight pattern)

create extension if not exists pg_cron;

-- Pre-flight: unschedule any existing job with this name (idempotent re-run).
do $unschedule$
declare
  job_name text;
begin
  for job_name in
    select jobname from cron.job where jobname = 'phase35-leaderboard-refresh'
  loop
    perform cron.unschedule(job_name);
  end loop;
exception when others then null;
end $unschedule$;

select cron.schedule(
  'phase35-leaderboard-refresh',
  '12,27,42,57 * * * *',
  $cron$
  do $refresh$ begin
    refresh materialized view concurrently public.leaderboard_matview;
  exception when others then
    raise notice 'phase35-leaderboard-refresh: error % — continuing', sqlerrm;
  end $refresh$;
  $cron$
);

-- Rollback hint (manual): select cron.unschedule('phase35-leaderboard-refresh');
