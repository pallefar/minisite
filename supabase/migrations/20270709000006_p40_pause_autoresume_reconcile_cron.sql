-- Phase 40 Plan 40-02 — pg_cron registration for auto-resume reconcile sweep.
--
-- Cron: p40-pause-autoresume-reconcile
-- Schedule: 15 */4 * * * (every 4 hours at minute 15)
-- Invokes: pause-reminder-fire?mode=reconcile (A3 fail-safe sweep)
--
-- PURPOSE: Assumption A3 mitigation. When Stripe fails to deliver the
-- `customer.subscription.updated` webhook at auto-resume time, local
-- `is_paused` stays true even though Stripe billing has resumed.
-- This cron detects rows where paused_until < now() AND is_paused=true,
-- calls Stripe to verify actual state, and reconciles if Stripe shows
-- pause_collection=null (auto-resumed). Also fires T-0 email.
--
-- LIMIT 100 per invocation per T-40-02-06 (Stripe API quota guard).
-- Runs every 4 hours — acceptable latency for a fail-safe sweep.
-- T-40-02-07: Idempotency — reconcile finds is_paused=true predicate;
--             webhook already set is_paused=false → second invocation no-ops.
--
-- Pattern: supabase/migrations/20270709000005_p40_pause_reminder_cron.sql
-- Named-tag dollar-quotes: $cron$ outer, $invoke$ inner, $unschedule$ pre-flight.
-- NEVER bare $$ per reference_postgres_dollar_quote_nesting_in_cron_body.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Pre-flight: idempotent unschedule so re-applying the migration is safe.
do $unschedule$
declare
  job_name text;
begin
  for job_name in
    select jobname from cron.job
    where jobname in ('p40-pause-autoresume-reconcile')
  loop
    perform cron.unschedule(job_name);
  end loop;
exception when others then
  null; -- cron schema may not be visible on first apply
end $unschedule$;

select cron.schedule(
  'p40-pause-autoresume-reconcile',
  '15 */4 * * *',
  $cron$
  do $invoke$
  declare
    v_secret text;
    v_response_id bigint;
  begin
    -- Fetch service_role_key from vault (sb_secret_* format).
    -- Per reference_supabase_pg_cron_vault_service_role_pattern:
    -- vault.decrypted_secrets is the ONLY valid source.
    select decrypted_secret
      into v_secret
      from vault.decrypted_secrets
     where name = 'service_role_key'
     limit 1;

    if v_secret is null then
      raise notice 'p40-pause-autoresume-reconcile: service_role_key missing from vault — skipping';
      return;
    end if;

    -- Invoke pause-reminder-fire Edge Fn in reconcile mode.
    -- mode=reconcile: finds paused_until < now() AND is_paused=true,
    --   calls Stripe.subscriptions.retrieve, mirrors state if auto-resumed.
    select net.http_post(
      url := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/pause-reminder-fire?mode=reconcile',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || v_secret,
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 30000
    ) into v_response_id;

    raise notice 'p40-pause-autoresume-reconcile: dispatched request_id=%', v_response_id;

  exception when others then
    raise notice 'p40-pause-autoresume-reconcile: error % — continuing', sqlerrm;
  end $invoke$;
  $cron$
);

comment on extension pg_cron is
  'p40-pause-autoresume-reconcile registered (POLISH-03 A3 mitigation). '
  'Runs every 4h at minute 15; invokes pause-reminder-fire?mode=reconcile '
  'to detect and mirror any missed Stripe auto-resume webhooks.';
