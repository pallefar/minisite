-- Phase 19 Plan 19-09 — payouts materialization + monthly transfer cron + conversion-confirm cron.
--
-- THREE pg_cron jobs registered here. Ordering rationale (BL-11 + W-3 + AFF-06):
--   00:15 UTC daily — `affiliate-conversions-confirm`     (BL-11 — pending → confirmed)
--   00:30 UTC daily — `affiliate-payouts-materialize`     (W-3  — confirmed → payouts pending rows)
--   00:00 UTC 1st-of-month — `affiliate-monthly-payout`   (AFF-06 — Edge Fn fires Stripe transfers.create)
--
-- The confirm job MUST run BEFORE the materialize job, otherwise the
-- materialization (which filters `status = 'confirmed'`) would never find rows
-- and AFF-06's monthly transfer cron would always ship $0.
--
-- BL-7 (Vault): the monthly cron reads `service_role_key` out of
-- `vault.decrypted_secrets` (loaded out-of-band via Dashboard → Project Settings
-- → Vault — see Plan 19-09 Task 0 + migration 20270101000013).
--
-- Idempotency: `cron.schedule` upserts by jobname (re-running this migration
-- replaces the schedule rather than duplicating it).
--
-- STRIDE register:
--   T-19-09-T1 Tampering (duplicate payouts rows): `ON CONFLICT DO NOTHING` +
--     `not exists` clause on materialization keeps the daily refill idempotent.
--   T-19-09-D1 DoS (single tick processing too many rows): the materialize job
--     processes ALL eligible affiliates each night, but the GROUP BY caps
--     output to one row per affiliate-month. Volume bound is the affiliate
--     population, not the conversion count.

create extension if not exists pg_cron;

-- ============================================================================
-- BL-11 — pending → confirmed transition (00:15 UTC daily).
-- ============================================================================
-- Without this job the W-3 materialization would never find rows. Flips
-- status from 'pending' to 'confirmed' once:
--   1. eligibility window has elapsed (eligible_at <= now()), AND
--   2. fraud_signals is null OR an empty jsonb array.
-- A non-empty fraud_signals array means the conversion is held for review
-- (handled by P22 ADMIN-06 surfaces, not this cron).
select cron.schedule(
  'affiliate-conversions-confirm',
  '15 0 * * *',
  $$
    update public.affiliate_conversions
       set status = 'confirmed',
           confirmed_at = now()
     where status = 'pending'
       and (fraud_signals is null or fraud_signals = '[]'::jsonb)
       and eligible_at <= now();
  $$
);

-- ============================================================================
-- W-3 — payouts materialization (00:30 UTC daily).
-- ============================================================================
-- Roll up confirmed conversions into a single pending payouts row per
-- affiliate per month. The `not exists` clause prevents re-materializing
-- when the affiliate has any payout (paid or processing) within the last
-- 60 days — keeps the monthly cadence sticky.
select cron.schedule(
  'affiliate-payouts-materialize',
  '30 0 * * *',
  $$
    insert into public.payouts (affiliate_id, period_start, period_end, amount_cents, status)
    select
      ac.affiliate_id,
      (date_trunc('month', now()) - interval '1 month')::date     as period_start,
      (date_trunc('month', now()) - interval '1 day')::date       as period_end,
      sum(ac.commission_cents)::int                               as amount_cents,
      'pending'                                                   as status
    from public.affiliate_conversions ac
    where ac.status = 'confirmed'
      and ac.eligible_at <= now()
      and not exists (
        select 1 from public.payouts p
         where p.affiliate_id = ac.affiliate_id
           and p.status in ('paid', 'processing')
           and p.created_at > now() - interval '60 days'
      )
    group by ac.affiliate_id
    having sum(ac.commission_cents) > 0
    on conflict do nothing;
  $$
);

-- ============================================================================
-- AFF-06 — monthly transfer cron (1st of month, 00:00 UTC).
-- ============================================================================
-- Fires the affiliate-payout Edge Function which iterates eligible pending
-- payouts and calls stripe.transfers.create with an idempotency key.
-- Auth: reads service_role_key from vault.decrypted_secrets (BL-7). The
-- Vault secret is loaded out-of-band via Dashboard (Plan 19-09 Task 0).
-- Constant-time bearer compare happens inside the Edge Function.
select cron.schedule(
  'affiliate-monthly-payout',
  '0 0 1 * *',
  $$
    select net.http_post(
      url := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/affiliate-payout',
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
