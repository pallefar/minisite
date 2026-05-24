-- Phase 39 Plan 39-01 — subscriptions.refunded_at column add.
--
-- CONTEXT references (39-CONTEXT.md):
--   D-02 (PAYWALL refund-rate kill-switch — rolling 30-day baseline, hard-kill
--   at 2× the CONTROL variant's trailing refund rate; reads refunded_at to
--   compute the 7-day per-variant rate vs the baseline).
--
-- RESEARCH OQ-1 RESOLUTION (39-RESEARCH.md):
--   Column does NOT exist on the public.subscriptions table on main. The
--   sibling public.lifetime_purchases.refunded_at (P43) is a different table.
--   This plan owns the add on public.subscriptions specifically so the Plan
--   39-03 refund-rate kill cron can read it.
--
-- Note: Same column name on a different table (lifetime_purchases) by design —
-- both code paths use refunded_at semantics (non-null timestamp = refunded at
-- that wall-clock time; null = not refunded).

alter table public.subscriptions
  add column if not exists refunded_at timestamptz;

comment on column public.subscriptions.refunded_at is
  'Phase 39 D-02: timestamp the subscription was refunded (Stripe refund event '
  'webhook updates). NULL = not refunded. Phase 39 Plan 39-03 refund-rate kill '
  'cron reads this to compute the 7-day per-variant rate vs the CONTROL baseline.';

-- Partial index for the kill-cron's WHERE refunded_at IS NOT NULL scan.
-- IS NOT NULL on a column is IMMUTABLE-safe (no time fn, no expression).
create index if not exists subscriptions_refunded_at_idx
  on public.subscriptions (refunded_at)
  where refunded_at is not null;
