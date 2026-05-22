-- Phase 43 Plan 01 — MEMBER-01 D-02 (lifetime_purchases idempotent on stripe_payment_intent_id).
--
-- Spec references:
--   - 43-CONTEXT.md D-01 (Lifetime added as a NEW row in tier_effective with tier_label='lifetime')
--   - 43-CONTEXT.md D-02 (Lifetime entitlement granted via Stripe Checkout one-time payment +
--                         webhook idempotent upsert into lifetime_purchases table, keyed by
--                         stripe_payment_intent_id)
--   - 43-RESEARCH.md Pattern S2 (denial-by-default RLS — writes only via service-role webhook)
--   - 43-PATTERNS.md "Table + RLS pattern" (analog: 20270602000010_cohort_definitions.sql:33-75)
--
-- Threat mitigations (43-01-PLAN <threat_model>):
--   - T-43-01-01 Tampering (webhook replay)         → UNIQUE constraint on stripe_payment_intent_id.
--   - T-43-01-03 Information Disclosure (cross-user) → pol_lifetime_purchases_self_read with USING (user_id = auth.uid()).
--   - T-43-01-04 Elevation of Privilege (PostgREST writes) → NO insert/update/delete policies (Pattern S2 denial-by-default).
--   - T-43-01-07 Tampering (concurrent race)         → UNIQUE index serializes at the Postgres level.

-- ============================================================================
-- Table: lifetime_purchases — one row per successful Stripe Checkout one-time payment.
-- ============================================================================
create table if not exists public.lifetime_purchases (
  id                        uuid primary key default gen_random_uuid(),
  user_id                   uuid not null references auth.users(id) on delete cascade,
  stripe_payment_intent_id  text not null unique,
  stripe_customer_id        text not null,
  paid_at                   timestamptz not null default now(),
  amount_cents              bigint not null check (amount_cents >= 0),
  refunded_at               timestamptz,
  metadata                  jsonb not null default '{}'::jsonb,
  created_at                timestamptz not null default now()
);

comment on table public.lifetime_purchases is
  'P43 MEMBER-01 D-02: one row per successful Lifetime-tier Stripe Checkout one-time payment. '
  'Idempotency key = stripe_payment_intent_id (UNIQUE). Joined into public.tier_effective '
  'via UNION ALL (lifetime_rows WHERE refunded_at IS NULL) to grant permanent has_active=true + '
  'tier_label=''lifetime'' to the owning user. Writes are service-role only (Pattern S2). '
  'Refunds are operator-managed: setting refunded_at non-null removes the row from tier_effective.';

-- ============================================================================
-- Hot-path index: tier_effective's lifetime_rows CTE filters refunded_at IS NULL by user_id.
-- ============================================================================
create index if not exists lifetime_purchases_user_idx
  on public.lifetime_purchases(user_id)
  where refunded_at is null;

-- ============================================================================
-- RLS: denial-by-default + single self-read policy. Writes are webhook (service-role) only.
-- ============================================================================
alter table public.lifetime_purchases enable row level security;

create policy pol_lifetime_purchases_self_read
  on public.lifetime_purchases
  for select
  to authenticated
  using (user_id = auth.uid());

-- NO insert/update/delete policies — Pattern S2 denial-by-default under RLS.
-- Service-role (stripe-webhook Edge Fn) bypasses RLS and is the sole writer.
-- Refunds are operator-managed via the Supabase dashboard or a future maintenance script.
