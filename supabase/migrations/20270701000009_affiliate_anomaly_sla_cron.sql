-- Phase 26 Plan 26-02 — Daily SLA-reminder cron for affiliate anomaly review.
--
-- AFFTIER-05 / D-09: operationalizes the 7-day admin-review SLA. Fires daily
-- at 09:00 UTC; the Edge Fn looks for unreviewed flagged conversions older
-- than 5 days and sends one batched email to ADMIN_REVIEW_EMAIL_TO (giving
-- admins a 2-day head-room before SLA breach).
--
-- Cron timing — `0 9 * * *` chosen to be clear of:
--   - `0 0 * * *` (midnight UTC daily jobs)
--   - `0 1 * * *` (affiliate_click_baseline refresh)
--   - `5 * * * *` (affiliate_ratio_baseline refresh — every hour)
--   - `0 3 * * *` (other daily jobs)
--
-- Vault-based service_role_key extraction (Pattern 5):
--   `vault.decrypted_secrets` is the Supabase pattern for storing the
--   service_role_key inside the project's pgsodium-backed vault. The
--   secret name `service_role_key` is loaded by 20270101000014_service_role_key_vault_load.sql
--   (v1.2 phase 19 setup). If the secret is absent at runtime, net.http_post
--   sends an empty Authorization header and the Edge Fn rejects with 401 —
--   the cron will continue retrying daily.
--
-- pg_cron + net are enabled on Supabase by default; the `if not exists`
-- prepends are safety nets.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'affiliate-anomaly-sla-reminder',
  '0 9 * * *',  -- daily 09:00 UTC
  $$
    select net.http_post(
      url := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/affiliate-anomaly-sla-reminder',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || coalesce(
          (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key' limit 1),
          ''
        )
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $$
);

-- Rollback hint (manual): select cron.unschedule('affiliate-anomaly-sla-reminder');
