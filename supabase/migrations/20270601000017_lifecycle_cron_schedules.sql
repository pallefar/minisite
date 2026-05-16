-- Phase 22 plan 22-02 — D-03: pg_cron schedules for lifecycle Edge Functions (ON-02).
-- Analog: supabase/migrations/20270101000012_payouts_materialization_and_cron.sql (cron.schedule + Vault bearer)
--
-- Three schedules registered (HTTP-only fns lifecycle-transactional + lifecycle-preference-update
-- have NO cron — they are invoked by app callers).
--
--   lifecycle-welcome-series      every 4 hours      → welcome cadence (0h / 24h / 72h / 7d buckets)
--   lifecycle-behavior-triggered  every 15 minutes   → first-injection / 7-day streak / missed-dose-day-3
--   lifecycle-retention           daily 06:00 UTC    → reengagement-7d / winback-30d / weekly digest (Monday)
--
-- BL-7 (Vault): every cron POST reads `service_role_key` out of
-- `vault.decrypted_secrets` (loaded out-of-band via Dashboard → Project Settings → Vault per
-- migration 20270101000014). The lifecycle Edge Functions perform a constant-time bearer compare
-- against SUPABASE_SERVICE_ROLE_KEY before doing any work.
--
-- D-03 gated-send: every lifecycle fn calls `resendDomainHealthCheck()` at startup. Until the
-- `app.leanshot.app` Resend domain is verified, every cron tick is a 200 + `{skipped:true}` no-op
-- with a `resend_domain_unverified_skips` counter increment. Cutover at vendor verify: zero code
-- changes; the health check passes on next invocation. (See `reference_vendor_gated_send_health_check.md`.)
--
-- Idempotency: `cron.schedule` upserts by jobname; re-running this migration replaces the schedule
-- rather than duplicating it.

create extension if not exists pg_cron;

-- ============================================================================
-- Welcome series — every 4 hours.
-- ============================================================================
select cron.schedule(
  'lifecycle-welcome-series',
  '0 */4 * * *',
  $$
    select net.http_post(
      url := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/lifecycle-welcome-series',
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

-- ============================================================================
-- Behavior-triggered — every 15 minutes.
-- ============================================================================
select cron.schedule(
  'lifecycle-behavior-triggered',
  '*/15 * * * *',
  $$
    select net.http_post(
      url := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/lifecycle-behavior-triggered',
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

-- ============================================================================
-- Retention — daily 06:00 UTC.
-- ============================================================================
select cron.schedule(
  'lifecycle-retention',
  '0 6 * * *',
  $$
    select net.http_post(
      url := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/lifecycle-retention',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key' limit 1
        )
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    );
  $$
);
