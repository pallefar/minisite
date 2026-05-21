-- Phase 40 Plan 40-02 — pg_cron registration for pause-reminder-fire Edge Fn.
--
-- Cron: p40-pause-t7-reminder
-- Schedule: 0 * * * * (hourly at minute 0 — unclaimed slot per PATTERNS §7 gotcha)
-- Invokes: pause-reminder-fire?mode=fire (default — T-7d reminder batch)
--
-- Pattern: supabase/migrations/20270708000021_p35_challenge_evaluate_cron.sql (EXACT).
-- Named-tag dollar-quotes throughout: $cron$ outer, $invoke$ inner, $unschedule$ pre-flight.
-- NEVER bare $$ per reference_postgres_dollar_quote_nesting_in_cron_body.
-- service_role_key from vault.decrypted_secrets (NOT current_setting GUC).
-- Hardcoded URL per reference_supabase_pg_cron_vault_service_role_pattern.
--
-- Existing cron minute slots (from P35 headers + other phases):
--   05,07,12,15,22,27,37,42,52,57  — occupied by prior phases
--   00  — clean (this cron)
--   15  — used by p40-pause-autoresume-reconcile (see migration 20270709000006)

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Pre-flight: idempotent unschedule so re-applying the migration is safe.
do $unschedule$
declare
  job_name text;
begin
  for job_name in
    select jobname from cron.job
    where jobname in ('p40-pause-t7-reminder')
  loop
    perform cron.unschedule(job_name);
  end loop;
exception when others then
  null; -- cron schema may not be visible on first apply
end $unschedule$;

select cron.schedule(
  'p40-pause-t7-reminder',
  '0 * * * *',
  $cron$
  do $invoke$
  declare
    v_secret text;
    v_response_id bigint;
  begin
    -- Fetch service_role_key from vault (sb_secret_* format).
    -- Per reference_supabase_pg_cron_vault_service_role_pattern:
    -- vault.decrypted_secrets is the ONLY valid source — no current_setting() GUC.
    select decrypted_secret
      into v_secret
      from vault.decrypted_secrets
     where name = 'service_role_key'
     limit 1;

    if v_secret is null then
      raise notice 'p40-pause-t7-reminder: service_role_key missing from vault — skipping';
      return;
    end if;

    -- Invoke pause-reminder-fire Edge Fn (fire mode = default).
    select net.http_post(
      url := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/pause-reminder-fire',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || v_secret,
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 30000
    ) into v_response_id;

    -- net.http_post is async; pg_cron does not await. Best-effort invocation.
    raise notice 'p40-pause-t7-reminder: dispatched request_id=%', v_response_id;

  exception when others then
    raise notice 'p40-pause-t7-reminder: error % — continuing', sqlerrm;
  end $invoke$;
  $cron$
);

comment on extension pg_cron is
  'p40-pause-t7-reminder registered (POLISH-03 D-09). '
  'Runs hourly at minute 0; invokes pause-reminder-fire Edge Fn (fire mode) '
  'to send T-7d pause reminder emails via vault service_role_key.';
