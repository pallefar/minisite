-- Phase 26 Plan 01 — Affiliate lifetime recurring payments ledger (D-17).
--
-- NET-NEW table to anchor monthly recurring-commission payouts for lifetime-tier
-- affiliates (Plan 26-06 cron). The (affiliate_id, stripe_subscription_id,
-- billing_period_yyyymm) UNIQUE constraint is the idempotency anchor that lets
-- the cron use INSERT ... ON CONFLICT DO NOTHING and remain retry-safe.
--
-- A separate `idempotency_key` UNIQUE column provides a second-level safety net
-- (string composite: "<affiliate_id>|<subscription_id>|<yyyymm>") so any
-- cron-retry path that constructs the key correctly cannot duplicate-write.
--
-- RLS posture (D-17 + STRIDE T-26-04):
--   - REVOKE all on table from authenticated/anon/public (default-deny).
--   - service_role bypasses RLS — used by the cron Edge Function (Plan 26-06).
--   - Staff SELECT policy via Phase 24 is_admin_at_least('staff') for operator UI.
--
-- FK retention: affiliate_id ON DELETE RESTRICT — IRS 1099 7-yr retention
-- applies per Phase 19 D-33 step 4 (ledger preserved if affiliate is deleted).
--
-- Idempotent.

create table if not exists public.affiliate_lifetime_recurring_payments (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.affiliates(id) on delete restrict,
  stripe_subscription_id text not null,
  billing_period_yyyymm integer not null,
  gross_subscription_cents integer not null check (gross_subscription_cents >= 0),
  commission_cents integer not null check (commission_cents >= 0),
  stripe_payout_id text,
  paid_at timestamptz,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  constraint affiliate_lifetime_recurring_unique
    unique (affiliate_id, stripe_subscription_id, billing_period_yyyymm),
  constraint affiliate_lifetime_recurring_idem_unique
    unique (idempotency_key)
);

alter table public.affiliate_lifetime_recurring_payments enable row level security;

-- Default-deny: REVOKE from public roles. service_role bypasses RLS for cron writes.
revoke all on public.affiliate_lifetime_recurring_payments from authenticated, anon, public;

-- Staff read policy (Phase 24 helper).
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'affiliate_lifetime_recurring_payments'
      and policyname = 'affiliate_lifetime_recurring_select_staff'
  ) then
    create policy "affiliate_lifetime_recurring_select_staff"
      on public.affiliate_lifetime_recurring_payments
      for select using (public.is_admin_at_least('staff'::public.admin_role));
  end if;
end $$;
