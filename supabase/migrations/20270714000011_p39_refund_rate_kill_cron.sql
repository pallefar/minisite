-- Phase 39 Plan 39-03 — pg_cron schedule for refund-rate kill scan (D-02).
--
-- Cron name: p39-refund-rate-kill
-- Schedule:  0 3 * * *   (daily at 03:00 UTC)
-- Body:      select public.p39_refund_rate_kill_scan();
--
-- D-02: PAYWALL refund-rate hard-kill at 2× CONTROL baseline, no cooldown.
-- Reads subscriptions.refunded_at (added in migration 20270714000013).
-- Idempotent re-runs are no-ops (skips already-archived variant_config rows).
--
-- Pattern: supabase/migrations/20270602000013_cohort_matview_refresh_cron.sql
-- Named-tag dollar-quotes per [[reference_postgres_dollar_quote_nesting_in_cron_body]].

create extension if not exists pg_cron;

do $unschedule$
begin
  perform cron.unschedule('p39-refund-rate-kill');
exception when others then
  null;
end
$unschedule$;

select cron.schedule(
  'p39-refund-rate-kill',
  '0 3 * * *',
  $cron$ select public.p39_refund_rate_kill_scan(); $cron$
);

-- Rollback hint (manual): select cron.unschedule('p39-refund-rate-kill');
