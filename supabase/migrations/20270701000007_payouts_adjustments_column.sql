-- Phase 26 Plan 01 — payouts.adjustments jsonb column (D-06).
--
-- RESEARCH correction: the canonical payouts table is public.payouts (the
-- planner draft incorrectly used a different table name). The `adjustments`
-- column DOES NOT exist today; it is required by Plan 26-06
-- (negative claw-back entries on refund) and Plan 26-07 (charge-refunded /
-- charge.dispute.created webhook handlers).
--
-- Shape: jsonb array of AdjustmentEntry objects (see leanshot/src/lib/affiliate/types.ts).
-- The CHECK constraint enforces `jsonb_typeof = 'array'` so a single object
-- (vs. an array of one) cannot land — keeps the claw-back accumulator monotonic.
--
-- Per-entry shape (enforced by client write path in Plan 26-07):
--   { type: 'refund'|'chargeback'|'manual',
--     amount_cents: number,           // negative for claw-back
--     reason: string,
--     related_event_id: string,       // Stripe event.id
--     related_conversion_id?: string,
--     created_at: string }            // ISO timestamp
--
-- Idempotent: ADD COLUMN IF NOT EXISTS handles re-run. The CHECK constraint
-- uses a name + IF NOT EXISTS guard via DO block (Postgres 15 does not support
-- `ADD CONSTRAINT IF NOT EXISTS` directly).

alter table public.payouts
  add column if not exists adjustments jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'payouts_adjustments_is_array'
      and conrelid = 'public.payouts'::regclass
  ) then
    alter table public.payouts
      add constraint payouts_adjustments_is_array
      check (jsonb_typeof(adjustments) = 'array');
  end if;
end $$;
