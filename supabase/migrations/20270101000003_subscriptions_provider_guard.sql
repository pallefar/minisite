-- Phase 19 Plan 01 — subscriptions.provider idempotent defensive guard (D-01).
--
-- D-01 — provider column already exists at 20260601000019_stripe_subscriptions.sql:53.
-- This migration is an idempotent defensive guard so Phase 19 can be re-run safely and acts
-- as the contract anchor for Phase 16 Plan 16-06 (which becomes a no-op for this column when
-- it resumes; only the RevenueCat webhook handler remains in 16-06).
--
-- Cross-phase contract (D-04):
--   When P16-06 lands, it adds the RC-side webhook + writes rows to public.subscriptions with
--   provider='revenuecat'. The tier_effective view (next migration) automatically returns the
--   MAX(current_period_end) across both providers — zero schema change required in P16-06.

-- Idempotent column-add: no-op against the existing schema where the column already exists.
alter table public.subscriptions
  add column if not exists provider text not null default 'stripe'
  check (provider in ('stripe','revenuecat'));

-- Idempotent partial index — IMMUTABLE-safe (col IS NOT NULL predicate).
-- Indexes user_id+provider for the tier_effective view's GROUP BY + winner selection.
create index if not exists idx_subscriptions_user_provider
  on public.subscriptions(user_id, provider)
  where user_id is not null;
