-- Phase 27 Plan 27-02 — pg_cron schedule for cohort_membership_rebuild().
--
-- CONTEXT D-07 + D-08: 15-min refresh cadence.
-- RESEARCH correction #2: schedule '7,22,37,52 * * * *' (NOT '*/15') to
-- deliberately stagger off the quarter-hour and avoid pile-up with the
-- anomaly funnel cron (`*/5` from Plan 27-04, fires on 0,5,...,55).
--
-- 7,22,37,52 vs 0,5,10,15,20,25,30,35,40,45,50,55: zero overlap.
--
-- The cron job runs as the postgres superuser via pg_cron (per Supabase
-- platform convention); cohort_membership_rebuild() is SECURITY DEFINER and
-- granted execute to service_role explicitly. pg_cron jobs can call
-- security-definer functions in the public schema without additional grants.

create extension if not exists pg_cron;

-- Idempotent: unschedule any prior version first, then re-schedule.
do $$
begin
  perform cron.unschedule('cohort-membership-refresh');
exception when others then
  -- "could not find valid entry for job" — first install path. Ignore.
  null;
end
$$;

select cron.schedule(
  'cohort-membership-refresh',
  '7,22,37,52 * * * *',
  $$ select public.cohort_membership_rebuild(); $$
);

-- Rollback hint (manual): select cron.unschedule('cohort-membership-refresh');
