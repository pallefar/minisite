-- Phase 26 Plan 01 — Affiliate fraud signals stream (D-18).
--
-- NET-NEW table that records fraud-related signals (anomaly Z-scores, Stripe
-- chargebacks, manual operator reports). Consumed by Plan 26-02 (baseline +
-- anomaly detector) and Plan 26-07 (charge-refunded/charge.dispute webhook
-- handlers), reviewed via Plan 26-04 operator UI.
--
-- Signal types:
--   anomaly_z_score  — daily baseline detector flagged an outlier conversion/click ratio
--   chargeback       — Stripe charge.dispute.created event handler write
--   manual           — operator-initiated fraud flag from admin UI
--
-- Review workflow:
--   decision IS NULL → pending review (hot path; partial index)
--   decision = 'clear' or 'fraud_confirmed' → reviewed
--
-- RLS posture (D-18 + STRIDE T-26-04):
--   - REVOKE all on table from authenticated/anon/public (default-deny).
--   - service_role bypasses RLS for trigger/cron writes.
--   - Staff SELECT policy via Phase 24 is_admin_at_least('staff') for operator UI.
--
-- FK retention: affiliate_id ON DELETE RESTRICT — keeps fraud history if affiliate
-- record is targeted for deletion (account-delete cascade hits this RESTRICT and
-- must explicitly resolve the rows before the cascade can complete).
-- conversion_id ON DELETE SET NULL — signals survive conversion row deletion.
--
-- Idempotent.

create table if not exists public.affiliate_fraud_signals (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.affiliates(id) on delete restrict,
  conversion_id uuid references public.affiliate_conversions(id) on delete set null,
  signal_type text not null check (signal_type in ('chargeback','anomaly_z_score','manual')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  decision text check (decision in ('clear','fraud_confirmed')),
  reviewer_user_id uuid references auth.users(id)
);

alter table public.affiliate_fraud_signals enable row level security;

-- Default-deny: REVOKE from public roles. service_role bypasses RLS for writes.
revoke all on public.affiliate_fraud_signals from authenticated, anon, public;

-- Staff read policy (Phase 24 helper).
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'affiliate_fraud_signals'
      and policyname = 'affiliate_fraud_signals_select_staff'
  ) then
    create policy "affiliate_fraud_signals_select_staff"
      on public.affiliate_fraud_signals
      for select using (public.is_admin_at_least('staff'::public.admin_role));
  end if;
end $$;

-- Operator review queue: pending signals per affiliate, newest first.
-- IMMUTABLE-safe per Pitfall 1: IS NULL only.
create index if not exists idx_affiliate_fraud_signals_pending
  on public.affiliate_fraud_signals(affiliate_id, created_at desc)
  where decision is null;
