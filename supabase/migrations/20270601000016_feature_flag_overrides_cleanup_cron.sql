-- Phase 22 plan 01 — D-08 + A3: daily cleanup of expired feature_flag_overrides rows.
-- Analog: supabase/migrations/20260601000013_finalize_account_deletions_cron.sql (cron pattern)
-- Pitfalls applied: Pitfall 10 (expiry is enforced by the application-side overrides-first check;
--                               this cron is the housekeeping sweep so the table doesn't grow
--                               unbounded). 7-day grace gives audit-trail retention before delete.
--
-- Schedule: 05:00 UTC (alongside existing audit-cleanup cron — both are housekeeping).

create extension if not exists pg_cron;

select cron.schedule(
  'feature-flag-overrides-cleanup',
  '0 5 * * *',
  $$
    delete from public.feature_flag_overrides
     where expires_at < now() - interval '7 days';
  $$
);

-- Rollback hint (manual): select cron.unschedule('feature-flag-overrides-cleanup');
