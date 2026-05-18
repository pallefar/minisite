-- Phase 26 Plan 26-07: widen affiliate_conversions.status check constraint
-- to include 'clawback_pending' (refund / dispute webhook claw-back state, D-06).
--
-- The original Phase 19 (Plan 19-01) check constraint allows:
--   pending, confirmed, flagged, rejected, paid, on_hold
-- Plan 26-07's stripe-webhook handlers (charge-refunded, charge-dispute-created)
-- transition affected conversions to 'clawback_pending'. Without this widening
-- the UPDATE throws 23514 at runtime and the claw-back ledger row never lands.

ALTER TABLE public.affiliate_conversions
  DROP CONSTRAINT IF EXISTS affiliate_conversions_status_check;

ALTER TABLE public.affiliate_conversions
  ADD CONSTRAINT affiliate_conversions_status_check
  CHECK (status = ANY (ARRAY[
    'pending'::text,
    'confirmed'::text,
    'flagged'::text,
    'rejected'::text,
    'paid'::text,
    'on_hold'::text,
    'clawback_pending'::text
  ]));
