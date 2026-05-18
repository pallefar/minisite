-- =============================================================================
-- Phase 25 Plan 25-09 — D-12 BAA expiry + subprocessor-diff cron schedules.
-- Closes HIPAA-12 (cron half) + HIPAA-13 (expiry-alert half).
--
-- BL-7 carry-over: bearer reads `service_role_key` from vault.decrypted_secrets
-- (loaded via Dashboard → Project Settings → Vault per Plan 25-01 entry checkpoint).
-- Idempotency: cron.schedule upserts by jobname (safe to re-run).
--
-- Cron slot allocation (no collisions):
--   audit-archive:      0 3 * * *  (Phase 24 Plan 24-01)
--   baa-expiry-check:   0 6 * * *  (THIS migration)
--   subprocessor-diff:  0 7 * * 1  (THIS migration — Monday-only)
--
-- Pattern S6: vault.decrypted_secrets bearer so secret is never embedded as a
-- migration literal. The Vault key `service_role_key` must be present
-- (verified in Plan 25-01 user_setup checkpoint).
--
-- References: Plan 25-09 STRIDE T-25-09-S1 (bearer auth), T-25-09-D1 (timeout).
-- =============================================================================

create extension if not exists pg_cron;

-- ---------------------------------------------------------------------------
-- 1. BAA expiry check — nightly 06:00 UTC
--    Reads vendor_baa_chain WHERE status='signed'; alerts founder + flips
--    status='expired' for past-expiry vendors.
-- ---------------------------------------------------------------------------
select cron.schedule(
  'baa-expiry-check',
  '0 6 * * *',
  $$
    select net.http_post(
      url := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/baa-expiry-check',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key' limit 1
        )
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $$
);

-- ---------------------------------------------------------------------------
-- 2. Subprocessor diff — weekly Monday 07:00 UTC
--    Fetches each vendor's public subprocessor URL; hash-compares to latest
--    subprocessor_snapshots row; alerts on change.
-- ---------------------------------------------------------------------------
select cron.schedule(
  'subprocessor-diff',
  '0 7 * * 1',
  $$
    select net.http_post(
      url := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/subprocessor-diff',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key' limit 1
        )
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $$
);
