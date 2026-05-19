-- Phase 42 Plan 42-07 (POLISH-12) — pg_cron schedule for quarterly NPS enqueue.
--
-- D-22: first-of-quarter UTC midnight (Jan 1 / Apr 1 / Jul 1 / Oct 1).
--
-- Critical patterns honored:
--   - [[reference_supabase_pg_cron_vault_service_role_pattern]]:
--       Service-role key comes from `vault.decrypted_secrets WHERE name='service_role_key'`.
--       The `current_setting('app.service_role_key')` GUC does NOT exist on this project.
--       The Edge Fn URL is HARDCODED (no `app.supabase_url` GUC available).
--
--   - [[reference_postgres_dollar_quote_nesting_in_cron_body]]:
--       The cron body uses a named tag `$cron$` (NOT default `$$`) so that any
--       future inner `$$ DO … $$` block CANNOT silently close the outer quote.
--       Today the body has no nested DO block, but the named tag is mandatory
--       defense against later edits.
--
--   - T-42-07-05 (Tampering — cron-body dollar-quote collision): named tag
--     prevents a malicious-looking-but-syntactically-valid edit from breaking
--     the schedule silently.

-- pg_cron is enabled at the project level (preceding migrations rely on it).
-- The schedule name `quarterly-nps-enqueue` is checked by the Task 4 human-verify
-- step and by the integration test's `SELECT … FROM cron.job` query.

-- Idempotency: unschedule first (if exists), then re-schedule. The
-- `cron.unschedule` raises if the job doesn't exist, so we wrap it in an
-- IF EXISTS guard. (We use a DO block with a NAMED dollar-quote tag
-- `$unschedule$` so it does NOT collide with the outer `$cron$` body below.)

DO $unschedule$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'quarterly-nps-enqueue') THEN
    PERFORM cron.unschedule('quarterly-nps-enqueue');
  END IF;
END
$unschedule$;

-- Schedule: '0 0 1 1,4,7,10 *' = minute 0, hour 0, day-of-month 1, months 1,4,7,10,
-- any day-of-week. UTC. Per D-22.
SELECT cron.schedule(
  'quarterly-nps-enqueue',
  '0 0 1 1,4,7,10 *',
  $cron$
    SELECT net.http_post(
      url := 'https://ytnsipxxmzgaebkqmokp.functions.supabase.co/nps-quarterly-enqueue',
      headers := jsonb_build_object(
        'Authorization',
        'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'),
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    );
  $cron$
);

COMMENT ON EXTENSION pg_cron IS
  'Required by Phase 42 quarterly-nps-enqueue (D-22). Schedule + vault.decrypted_secrets pattern per project rules.';
