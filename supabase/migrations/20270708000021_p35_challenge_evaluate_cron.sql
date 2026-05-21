-- Phase 35 plan 35-09 — pg_cron registration for challenge-evaluate-cron Edge Fn.
-- Runs hourly at minute 22 (chosen to avoid pile-up with other crons):
--   05  — phase35-streak-evaluate-hourly
--   07,22,37,52 — cohort membership rebuild
--   12,27,42,57 — leaderboard refresh
--   15  — freeze-monthly-grant
--   22  — THIS JOB (22 is clean; avoids all above)
--
-- Invokes challenge-evaluate-cron Edge Fn via vault.decrypted_secrets bootstrap.
-- Pattern: supabase/migrations/20270707000007_helpdesk_pg_cron.sql (helpdesk_pg_cron).
-- Named-tag dollar-quotes throughout: $cron$ outer, $invoke$ inner, $unschedule$ pre-flight.
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
    where jobname in ('phase35-challenge-evaluate-hourly')
  loop
    perform cron.unschedule(job_name);
  end loop;
exception when others then
  null; -- cron schema may not be visible on first apply
end $unschedule$;

select cron.schedule(
  'phase35-challenge-evaluate-hourly',
  '22 * * * *',
  $cron$
  do $invoke$
  declare
    v_secret text;
    v_response_id bigint;
  begin
    -- Fetch service_role_key from vault (sb_secret_* format per reference_supabase_service_role_key_format_divergence).
    select decrypted_secret
      into v_secret
      from vault.decrypted_secrets
     where name = 'service_role_key'
     limit 1;

    if v_secret is null then
      raise notice 'phase35-challenge-evaluate-hourly: service_role_key missing from vault — skipping';
      return;
    end if;

    -- Invoke challenge-evaluate-cron Edge Fn via net.http_post (async fire-and-forget).
    select net.http_post(
      url := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/challenge-evaluate-cron',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || v_secret,
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 30000
    ) into v_response_id;

    -- net.http_post is async; pg_cron does not await. Best-effort invocation.
    raise notice 'phase35-challenge-evaluate-hourly: dispatched request_id=%', v_response_id;

  exception when others then
    raise notice 'phase35-challenge-evaluate-hourly: error % — continuing', sqlerrm;
  end $invoke$;
  $cron$
);

comment on extension pg_cron is
  'phase35-challenge-evaluate-hourly registered (D-21 challenge progress + nudge). '
  'Runs at minute 22 hourly; invokes challenge-evaluate-cron Edge Fn via vault service_role_key.';
