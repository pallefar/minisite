-- Phase 19 Plan 01 — Affiliate ledger tables: clicks, conversions, impressions, payouts.
--
-- Spec references:
--   - 19-CONTEXT.md D-21..D-28 (cookie + fraud signals), D-33 (cascade ordering with FK semantics)
--   - 19-CONTEXT-ADDENDUM-research.md D-36 (renewals do not convert),
--     D-38 (affiliate_impressions table — schema NOW, insert path lands in 19-08),
--     D-39 (payouts.status v1.2 reduced set — no 'reversed')
--
-- FK retention contract (CONTEXT D-33 — IRS 7-yr 1099 retention):
--   - affiliate_clicks.affiliate_id   → cascade   (clicks are not IRS records)
--   - affiliate_clicks.user_id        → SET NULL  (D-33 step 3 — ledger preserved post-deletion)
--   - affiliate_conversions.affiliate_id → RESTRICT (block affiliate delete if conversions exist;
--     D-33 step 1 pre-flight semantics)
--   - affiliate_conversions.user_id      → SET NULL  (anonymized in cascade; row retained)
--   - affiliate_impressions.affiliate_id → cascade   (D-38 — impressions are not IRS records)
--   - payouts.affiliate_id            → RESTRICT (D-33 step 4 — payouts retained 7yr)
--   - payouts.user_id                 → SET NULL  (payouts row survives user deletion)
--
-- Landmines:
--   - All partial-index predicates IMMUTABLE-safe (col IN-list, status=literal, date_trunc).
--   - No enum types — text columns with CHECK constraints.

-- =============================================================================
-- 1. affiliate_clicks — every /r/{code} hit (D-21)
-- =============================================================================
create table public.affiliate_clicks (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.affiliates(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  referral_code text not null,
  ip inet,
  user_agent text,
  referer text,
  fingerprint text,
  flagged boolean not null default false,
  flag_reason text,
  created_at timestamptz not null default now()
);

-- Z-score baseline aggregation (Plan 19-07 daily refresh).
-- NOTE: `date_trunc('day', timestamptz)` is STABLE (not IMMUTABLE) in Postgres because the
-- result depends on session TimeZone. We index (affiliate_id, created_at) instead — the
-- Plan 19-07 baseline matview does its own `date_trunc('day', created_at AT TIME ZONE 'UTC')`
-- aggregation against this range index.
create index idx_clicks_affiliate_day on public.affiliate_clicks(affiliate_id, created_at);

-- =============================================================================
-- 2. affiliate_conversions — invoice.paid commission ledger (D-21, D-36 idempotency)
-- =============================================================================
create table public.affiliate_conversions (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.affiliates(id) on delete restrict,
  user_id uuid references auth.users(id) on delete set null,
  subscription_id text,
  invoice_id text not null unique,
  commission_cents integer not null check (commission_cents >= 0),
  status text not null default 'pending' check (status in ('pending','confirmed','flagged','rejected','paid')),
  fraud_signals jsonb not null default '[]'::jsonb,
  eligible_at timestamptz,
  invoice_paid_at timestamptz,
  created_at timestamptz not null default now()
);

-- Operator queue: which affiliates have pending/flagged conversions?
create index idx_conversions_affiliate_status on public.affiliate_conversions(affiliate_id, status) where status in ('pending','flagged');

-- =============================================================================
-- 3. affiliate_impressions — landing-page view events (D-38, BL-8)
-- =============================================================================
-- NOTE: insert path lives in Plan 19-08 (server-side via /r/{code}/landing render).
-- This table ships here so v1.3 ratio-detector can compute baselines from accumulated history
-- (30-90 day window) without losing data.
create table public.affiliate_impressions (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.affiliates(id) on delete cascade,
  ip_24 inet,
  ua_hash text,
  referer text,
  created_at timestamptz not null default now()
);

-- Daily aggregation index for future ratio-detector baseline (v1.3). See the note on
-- idx_clicks_affiliate_day above for why we index `created_at` directly instead of
-- `date_trunc('day', created_at)` (latter is STABLE, not IMMUTABLE).
create index idx_aff_impressions_affiliate_day on public.affiliate_impressions(affiliate_id, created_at);

-- =============================================================================
-- 4. payouts — monthly transfer ledger (D-29..D-32, D-39)
-- =============================================================================
-- D-39 / W-4: v1.2 enum is the reduced set — `'reversed'` is EXCLUDED.
-- Chargeback handling on transfers (transfer.reversed webhook) deferred to v1.3.
create table public.payouts (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.affiliates(id) on delete restrict,
  user_id uuid references auth.users(id) on delete set null,
  period_start date not null,
  period_end date not null,
  amount_cents integer not null check (amount_cents >= 0),
  status text not null default 'pending' check (status in ('pending','processing','paid','failed','blocked_onboarding')),
  stripe_transfer_id text unique,
  retry_count integer not null default 0,
  paid_at timestamptz,
  failed_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Cron-fire filter (Plan 19-09): pending payouts retrieved in chronological order.
-- Eligibility for payment is computed by JOINing against affiliate_conversions.eligible_at
-- (D-30: invoice.paid + 60 days), so the payouts row itself does not need its own
-- eligible_at column — the cron filters `status='pending'` and joins for eligibility.
create index idx_payouts_eligible on public.payouts(created_at) where status = 'pending';
-- Per-affiliate payout-history hot path.
create index idx_payouts_affiliate on public.payouts(affiliate_id);

-- =============================================================================
-- 5. updated_at trigger on payouts (mirror affiliates pattern)
-- =============================================================================
create or replace function public.set_payouts_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_payouts_set_updated_at
  before update on public.payouts
  for each row execute function public.set_payouts_updated_at();

-- =============================================================================
-- 6. Enable RLS — policies defined in 20270101000005_affiliate_rls.sql
-- =============================================================================
alter table public.affiliate_clicks enable row level security;
alter table public.affiliate_conversions enable row level security;
alter table public.affiliate_impressions enable row level security;
alter table public.payouts enable row level security;
