-- Phase 47 Plan 47-05 — pg_cron schedule for the M4 Events fan-out (D-10 + D-12).
--
-- Jobs registered (1):
--   1. phase47-event-reminders-hourly (0 * * * *) — hourly fan-out of 1d/1h
--      RSVP reminders to per-user timezones. Body invokes the event-reminders-fanout
--      Edge Function (ships in Wave 1 / Plan 47-08). Until that Fn deploys the cron
--      will fire and net.http_post will return 404; the cron job entry itself is
--      still registered correctly (idempotent re-schedule via unschedule + insert).
--
-- Patterns honored (memory references — load-bearing):
--   - [[reference_supabase_pg_cron_vault_service_role_pattern]]: read service_role_key
--     from vault.decrypted_secrets row name='service_role_key' + hardcoded URL
--     `https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/event-reminders-fanout`
--     (NO `current_setting('app.*')` GUC; that does NOT exist on this project).
--   - [[reference_postgres_dollar_quote_nesting_in_cron_body]]: outer `$cron$ ... $cron$`
--     plus UNIQUE inner named tag `$reminders$`. Bare inner `$$` would silently close
--     the outer quote and crash with "syntax error at or near DECLARE" at apply time.
--     `$reminders$` is UNIQUE — does NOT collide with Phase 38's `$digest$/$embed$/
--     $winback$/$cleanup$` tags.
--   - [[reference_supabase_service_role_key_format_divergence]]: vault entry must hold
--     the `sb_secret_*` token (not the legacy HS256 JWT) so the Edge Fn bearer-auth
--     check succeeds.
--
-- Idempotency: the leading DO-block unschedules any pre-existing entry so
-- re-running this migration after a cron-expression change is safe.
--
-- pg_cron + pg_net are already enabled from Phase 19/22/38; the
-- `create extension if not exists` calls are guards.
--
-- Project ref `ytnsipxxmzgaebkqmokp` is the LeanShot Supabase project
-- (memory: reference_supabase_project).

begin;

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ----------------------------------------------------------------------------
-- Pre-flight: unschedule any pre-existing phase47 reminder job so re-running
-- this migration with adjusted cron expressions is safe.
-- ----------------------------------------------------------------------------
do $unschedule$
begin
  perform cron.unschedule('phase47-event-reminders-hourly');
exception when others then
  -- Ignore: cron schema may not be visible to migration role on first apply,
  -- or the job may not yet exist.
  null;
end $unschedule$;

-- ----------------------------------------------------------------------------
-- 1. event-reminders-hourly — hourly fan-out of 1d / 1h RSVP reminders.
--    The Edge Function selects RSVPs whose event_at_utc falls into the
--    [now+23h, now+25h) (1d) and [now, now+2h) (1h) windows per the user's
--    timezone, dedups via UNIQUE event_reminder_sent (event_id, user_id, kind),
--    and routes via PHI flag (Resend vs SES).
-- ----------------------------------------------------------------------------
select cron.schedule(
  'phase47-event-reminders-hourly',
  '0 * * * *',
  $cron$
  do $reminders$
  declare
    fn_url constant text := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/event-reminders-fanout';
    service_key text;
  begin
    select decrypted_secret
      into service_key
      from vault.decrypted_secrets
     where name = 'service_role_key'
     limit 1;

    if service_key is null then
      raise notice 'phase47-event-reminders-hourly: service_role_key vault entry missing — skipping';
      return;
    end if;

    perform net.http_post(
      url := fn_url,
      body := '{}'::jsonb,
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || service_key,
        'Content-Type', 'application/json'
      ),
      timeout_milliseconds := 60000
    );
  end;
  $reminders$;
  $cron$
);

commit;
