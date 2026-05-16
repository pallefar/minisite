-- Phase 23 Plan 23-04 (DEBT-03) — daily cron schedule for photos-trash-purge Edge Function.
--
-- Per D-08: this cron is the SOURCE OF TRUTH for permanent deletion of trashed photos.
-- Storage bucket lifecycle rules (if configured) are defense-in-depth only.
--
-- Schedule: 03:15 UTC daily, offset from existing crons:
--   03:00 UTC — cleanup-anon-users          (Phase 4)
--   03:15 UTC — photos-trash-purge          (this migration) ←
--   04:00 UTC — finalize-account-deletions  (Phase 7)
--   05:00 UTC — cleanup-audit-logs          (Phase 7)
--
-- The cron pulls the service_role_key from Vault (vault.decrypted_secrets).
-- If the Vault entry is absent, the cron will fail with 401 on its first run
-- (the Edge Function health-check returns 500 when SUPABASE_SERVICE_ROLE_KEY
-- is not set). This is intentional per [[reference-vendor-gated-send-health-check]]:
-- the Vault 'service_role_key' entry is a known-pending dependency documented in
-- the 23-04-SUMMARY.md. Once loaded, the cron becomes fully operational with no
-- code changes required.
--
-- Extensions pg_cron and pg_net are already enabled (Phase 19 / Phase 22).

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'photos-trash-purge',
  '15 3 * * *',
  $$
    select net.http_post(
      url := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/photos-trash-purge',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'service_role_key'
          limit 1
        ),
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $$
);
