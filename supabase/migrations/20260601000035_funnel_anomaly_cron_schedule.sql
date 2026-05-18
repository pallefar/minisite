-- Phase 27 plan 27-04 — pg_cron schedule for funnel-anomaly-cron Edge Function.
--
-- Decision ref: CONTEXT D-16 (cron every 5 minutes; collision verified).
-- Analog: supabase/migrations/20270601000017_lifecycle_cron_schedules.sql
-- lines 24-45 (HTTP-post cron via net.http_post + Vault bearer).
--
-- Schedule: '*/5 * * * *' — every 5 minutes on the 0/5/10/15/20/25/30/35/40/45/50/55
-- minute marks. SC#5 requires <5 minutes from detection — 5-min tick is the floor.
--
-- Collision verification (D-16 + 27-PATTERNS A8):
--   - audit-archive            (daily 03:00 UTC)              — no collision
--   - BAA expiry alerts        (daily 06:00 UTC)              — no collision
--   - subprocessor-diff        (Mon 07:00 UTC)                — no collision
--   - affiliate-lifetime-recurring (day-1 03:00 UTC)          — no collision
--   - lifecycle-welcome-series (every 4h: 00:00, 04:00, ...)  — collides at 00:00, 04:00, 08:00, 12:00, 16:00, 20:00 → ACCEPTABLE (pg_cron parallelizes across jobnames)
--   - lifecycle-behavior-triggered (every 15 min: 00,15,30,45) — collides at 00, 15, 30, 45 → ACCEPTABLE (parallel)
--   - lifecycle-retention      (daily 06:00 UTC)              — no collision
--   - cohort-membership-refresh (planned 7,22,37,52 — Plan 27-02) — deliberately offset
--
-- VAULT KEY PREREQUISITE:
--   net.http_post reads `service_role_key` from vault.decrypted_secrets. If the
--   key is not yet seeded (initial deploy / dev env), the Edge Function returns
--   401 unauthorized and the cron tick is a harmless no-op. The Edge Function
--   bearer check uses constant-time compare via _shared/lifecycle-utils
--   checkServiceRoleBearer; mismatched bearer → 401 with no side effects.
--   See 27-VALIDATION.md manual-only section for Vault provisioning steps.
--
-- IDEMPOTENCY:
--   cron.schedule upserts by jobname; re-running this migration replaces the
--   schedule rather than duplicating it.

create extension if not exists pg_cron;

select cron.schedule(
  'funnel-anomaly-cron',
  '*/5 * * * *',
  $$
    select net.http_post(
      url := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/funnel-anomaly-cron',
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
