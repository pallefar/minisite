-- Phase 26 Plan 26-06 — pg_cron schedule for affiliate-lifetime-recurring Edge Fn (AFFTIER-04).
--
-- Schedule: '0 3 1 * *' (day-1 of month, 03:00 UTC).
--
-- Confirmed clear of existing day-1 + 00:xx cron jobs per RESEARCH live cron audit:
--   00:00 UTC 1st        → affiliate-monthly-payout         (v1.2 transfers.create)
--   00:15 UTC daily      → affiliate-conversions-confirm    (BL-11 pending→confirmed)
--   00:30 UTC daily      → affiliate-payouts-materialize    (W-3 confirmed→payouts)
--   ↓ 03:00 UTC 1st       → affiliate-lifetime-recurring     (THIS — accrues lifetime rows)
--   …
--
-- Timing rationale:
--   - 03:00 UTC sits AFTER the 00:30 daily materialize chain (which uses last
--     month's eligibilities) and AFTER the 00:00 day-1 transfer cron.
--   - New conversion rows written by this job have eligible_at = now()+60d,
--     so they will be picked up by the daily confirm chain ~60 days hence and
--     transferred via the existing month N+2 affiliate-monthly-payout cron
--     (single Stripe Connect path — D-08).
--
-- Vault bearer (BL-7): `service_role_key` is loaded out-of-band via Dashboard
-- → Project Settings → Vault. Constant-time bearer compare happens inside the
-- Edge Function (Pattern 5).
--
-- Idempotency: cron.schedule upserts by jobname (re-running this migration
-- replaces the schedule rather than duplicating it).
--
-- STRIDE register entries (mitigated):
--   T-26-24 Spoofing      → vault bearer + constant-time compare
--   T-26-25 Tampering     → UNIQUE idempotency_key + synthetic invoice_id; 23505 swallowed
--   T-26-26 Info Disclosure → handler writes no Stripe metadata (delegates payout)
--   T-26-27 DoS           → one Stripe price retrieve per active lifetime sub per month
--   T-26-28 EoP           → frozen-affiliate skip enforced at JOIN
--   T-26-29 Tampering     → handler filters on RAW Stripe status, not UX-tier collapse

create extension if not exists pg_cron;

select cron.schedule(
  'affiliate-lifetime-recurring',
  '0 3 1 * *',
  $$
    select net.http_post(
      url := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/affiliate-lifetime-recurring',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          select decrypted_secret
            from vault.decrypted_secrets
           where name = 'service_role_key'
           limit 1
        )
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    );
  $$
);
