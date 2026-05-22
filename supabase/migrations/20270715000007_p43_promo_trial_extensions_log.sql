-- Phase 43 Plan 04 — MEMBER-03 D-08 idempotency log for promo-code-driven trial
-- extensions (cancellation-flow surface; stripe-checkout-side extension deferred
-- per 43-CARRY-OVER.md).
--
-- CONTEXT references:
--   - MEMBER-03 / D-08: PK (subscription_id, promo_code_id) prevents
--     double-extension on retry. Service-role-only writes from
--     `cancellation-accept-offer` where subscription_id IS known.
--   - Pattern: idempotency log keyed on the natural-uniqueness tuple of the
--     idempotent Stripe write. Mirrors P40 `pause_extension_log` shape.
--
-- v1.3 scope: cancellation-flow only. The stripe-checkout-side promo-driven
-- trial extension at new-subscription creation requires a holding-key column
-- (e.g. `holding_key text` + partial unique index) + a `subscription.created`
-- webhook reconciliation Fn — both deferred per 43-CARRY-OVER.md item #1.

-- ============================================================================
-- 1. promo_trial_extensions_log
-- ============================================================================
create table if not exists public.promo_trial_extensions_log (
  subscription_id text        not null,
  promo_code_id   text        not null,
  extension_days  integer     not null check (extension_days > 0),
  applied_at      timestamptz not null default now(),
  primary key (subscription_id, promo_code_id)
);

comment on table public.promo_trial_extensions_log is
  'P43 MEMBER-03 D-08: idempotency log. PK (subscription_id, promo_code_id) '
  'prevents double-extension on retry. Written by cancellation-accept-offer '
  'where subscription_id is known. Service-role only.';

comment on column public.promo_trial_extensions_log.subscription_id is
  'Stripe subscription ID (sub_*). Component of the idempotency PK.';

comment on column public.promo_trial_extensions_log.promo_code_id is
  'Stripe coupon/promo code ID. Component of the idempotency PK. Retry with '
  'the same (sub, promo) pair is a no-op via ON CONFLICT DO NOTHING.';

comment on column public.promo_trial_extensions_log.extension_days is
  'Number of days the trial was extended (typically 7). CHECK (> 0) prevents '
  'no-op rows.';

comment on column public.promo_trial_extensions_log.applied_at is
  'Wall-clock timestamp of first successful INSERT for this (sub, promo) pair.';

-- ============================================================================
-- 2. RLS — service-role only (no policies declared)
-- ============================================================================
-- Enable RLS but declare NO policies. The Postgres default DENY semantics
-- ensure that only the service_role (which bypasses RLS) can read/write this
-- table. Edge Fn `cancellation-accept-offer` performs INSERT via service-role
-- admin client. Future admin SELECT (for audit) is added in a separate
-- migration when the admin UI lands.
alter table public.promo_trial_extensions_log enable row level security;
