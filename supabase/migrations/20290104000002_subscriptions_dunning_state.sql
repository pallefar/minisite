-- Phase 65-01 — Stripe Tax + Payment Resilience (PAY-07)
-- =============================================================================
--
-- Adds dunning state machine columns to public.subscriptions. The dunning
-- orchestrator (Plan 65-05) reads these to decide which subs need the next
-- failure-stage email; the Stripe webhook (Plan 65-04 / existing) flips the
-- state on `invoice.payment_failed` + `customer.subscription.updated`.
--
-- State transitions:
--   none / null       → first_failed              (first invoice.payment_failed)
--   first_failed      → second_failed             (next retry fail)
--   second_failed     → final_warning             (last retry, cancellation imminent)
--   final_warning     → cancelled_for_payment     (Stripe gives up)
--
-- NULL is treated as 'none' (legacy rows have no dunning history). The CHECK
-- constraint allows NULL explicitly so existing rows pass without backfill.
--
-- IMPORTANT: ALTER TABLE on a production table → ADD COLUMN IF NOT EXISTS guard
-- ([[reference_rag_sources_source_type_drift]]). No CREATE POLICY IF NOT EXISTS
-- ([[feedback_phase_close_out_supabase_gotchas]]).
--
-- Per [[reference_supabase_back_dated_migration_blocks_push]] — timestamp 20290104+
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Columns: subscriptions.dunning_state + last_dunning_email_at
-- ---------------------------------------------------------------------------

alter table public.subscriptions
  add column if not exists dunning_state text;

alter table public.subscriptions
  add column if not exists last_dunning_email_at timestamptz;

-- ---------------------------------------------------------------------------
-- 2. CHECK constraint — enum-restricted dunning_state.
--    Use DO block to ADD CONSTRAINT IF NOT EXISTS (Postgres lacks native syntax).
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'subscriptions_dunning_state_check'
      and conrelid = 'public.subscriptions'::regclass
  ) then
    alter table public.subscriptions
      add constraint subscriptions_dunning_state_check
      check (
        dunning_state is null
        or dunning_state in (
          'none',
          'first_failed',
          'second_failed',
          'final_warning',
          'cancelled_for_payment'
        )
      );
  end if;
end$$;

-- ---------------------------------------------------------------------------
-- 3. Partial index — orchestrator cron scans only active-failure rows.
--    Excludes 'cancelled_for_payment' (terminal) + NULL/'none' (no failure).
-- ---------------------------------------------------------------------------

create index if not exists idx_subscriptions_dunning_state
  on public.subscriptions(dunning_state, last_dunning_email_at)
  where dunning_state is not null
    and dunning_state <> 'none'
    and dunning_state <> 'cancelled_for_payment';

-- RLS unchanged — subscriptions already has RLS enabled.

commit;
