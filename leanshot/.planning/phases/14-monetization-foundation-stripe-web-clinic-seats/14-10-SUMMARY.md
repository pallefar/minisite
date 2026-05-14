---
phase: 14-monetization-foundation-stripe-web-clinic-seats
plan: 10
subsystem: payments
tags: [stripe-webhook, dunning, edge-function, deno, gap-closure, invoice]

requires:
  - phase: 14-monetization-foundation-stripe-web-clinic-seats
    plan: 3
    provides: "stripe-webhook Edge Function with signature verification + invoice handler scaffolding"

provides:
  - "invoice-payment-failed.ts: writes ux_tier='past_due' + status='past_due' directly — CR-04 dunning inversion fixed"
  - "invoice-paid.ts: writes ux_tier='paid' + status='active' directly — CR-04 dead code removed"
  - "6 Deno tests (3 per handler) asserting corrected behavior"

affects: [14-08, sc-4, dunning, past_due_banner]

tech-stack:
  added: []
  patterns:
    - "Invoice handler semantics: event type is sufficient — invoice.payment_failed always means past_due; invoice.paid always means paid. No subscription status field read needed or possible."
    - "mapStripeStatusToUxTier is only for customer.subscription.updated — not for invoice events"

key-files:
  created:
    - "supabase/functions/stripe-webhook/events/invoice-payment-failed.test.ts (rewritten)"
    - "supabase/functions/stripe-webhook/events/invoice-paid.test.ts (rewritten)"
  modified:
    - "supabase/functions/stripe-webhook/events/invoice-payment-failed.ts"
    - "supabase/functions/stripe-webhook/events/invoice-paid.ts"

key-decisions:
  - "CR-04 fix: do not derive ux_tier from non-existent invoice.subscription_status — write directly from event type semantics"
  - "invoice.payment_failed is always unconditional dunning start — no retry-window no-op logic"
  - "invoice-paid.ts dead code (invoiceObj + void invoiceObj) removed as part of CR-04 surgical fix"
  - "index.test.ts TS type error is pre-existing and out of scope — deferred, not introduced by this plan"

patterns-established:
  - "Invoice event handlers: write tier + status directly from event semantics, not from a missing field cast"

requirements-completed: [MONEY-09, MONEY-01]

duration: 12min
completed: 2026-05-14
---

# Phase 14 Plan 10: Gap Closure CR-04 Summary

**Fixed inverted dunning trigger: invoice-payment-failed now writes ux_tier='past_due' directly; invoice-paid writes ux_tier='paid' directly — both drop the non-existent invoice.subscription_status read that caused CR-04**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-05-14T07:03:00Z
- **Completed:** 2026-05-14T07:15:31Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Removed the `as unknown as { subscription_status?: string }` cast from both invoice handlers — the field does not exist on the Stripe Invoice object and was always `undefined` at runtime
- `invoice-payment-failed.ts` now writes `ux_tier='past_due'` + `status='past_due'` unconditionally on every `invoice.payment_failed` event (the dunning trigger is no longer inverted)
- `invoice-paid.ts` now writes `ux_tier='paid'` + `status='active'` unconditionally, preserving the real `invoice.period_end` → `current_period_end` derivation; dead `invoiceObj` const + `void invoiceObj` suppression removed
- Old test 2.17 (which encoded the inverted-trigger bug by expecting `ux_tier='paid'` on a payment_failed event) replaced with a corrected idempotent-direction test; both test files now have 3 tests each (6 total); all pass

## CR-04 Closure Evidence

```
$ ! grep -rnE "subscription_status" events/invoice-payment-failed.ts events/invoice-paid.ts
# (zero matches — PASS)

$ ! grep -rnE "as unknown as" events/invoice-payment-failed.ts events/invoice-paid.ts
# (zero matches — PASS)
```

Corrected write payloads:
- **invoice-payment-failed.ts**: `admin.from('subscriptions').update({ ux_tier: 'past_due', status: 'past_due' }).eq('id', subId)`
- **invoice-paid.ts**: `admin.from('subscriptions').update({ ux_tier: 'paid', status: 'active', current_period_end: periodEnd }).eq('id', subId)`

## Deno Test Results

```
invoice-payment-failed.test.ts: 3 passed | 0 failed
  2.16: payment_failed with valid subId → ux_tier=past_due + status=past_due   ok
  2.17: payment_failed is unconditional — second failure still writes past_due  ok
  2.17b: payment_failed with no subscription_id → no-op (zero update calls)    ok

invoice-paid.test.ts: 3 passed | 0 failed
  2.14: invoice.paid flips ux_tier to paid, status to active, updates period_end  ok
  2.15: invoice.paid on already-paid sub → idempotent (still writes paid)         ok
  2.14b: invoice.paid with no subscription_id → no-op (skips)                     ok

All 6 invoice handler tests: PASS
All 27 event handler tests (excluding pre-existing index.test.ts TS error): PASS
```

## Task Commits

Each task was committed atomically with explicit pathspec discipline (parallel with 14-09):

1. **Task 1: Fix invoice-payment-failed.ts + test** - `ce6e5f6` (fix)
2. **Task 2: Fix invoice-paid.ts + test** - `6520198` (fix)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `supabase/functions/stripe-webhook/events/invoice-payment-failed.ts` - Removed `subscription_status` read + `as unknown as` cast + `mapStripeStatusToUxTier` import; writes `past_due` directly
- `supabase/functions/stripe-webhook/events/invoice-payment-failed.test.ts` - Replaced test 2.17 (encoded bug); added null-subId test 2.17b
- `supabase/functions/stripe-webhook/events/invoice-paid.ts` - Removed `subscription_status` read + `as unknown as` cast + `mapStripeStatusToUxTier` import + dead `invoiceObj` code; writes `paid` directly
- `supabase/functions/stripe-webhook/events/invoice-paid.test.ts` - Dropped dead `subscriptionStatus` arg from builder; added CR-04 explanation comment

## Decisions Made

- Write ux_tier directly from event type semantics — `invoice.payment_failed` is always `past_due`; `invoice.paid` is always `paid`. No subscription status field read is needed or possible on Invoice objects.
- Test 2.17 replacement rationale: the old test asserted `ux_tier='paid'` on a payment_failed event because it was testing the buggy behavior (reading `subscription_status='active'` via the broken cast → mapping 'active' to 'paid'). The replacement tests the corrected unconditional `past_due` direction.

## Deviations from Plan

None — plan executed exactly as written. The `subscription_status` string removal from the JSDoc comment in `invoice-paid.ts` was a minor adjustment to satisfy the `grep` acceptance criteria (the comment referenced the field name; removed it to keep the handler clean per the zero-match rule).

## Issues Encountered

**Pre-existing `index.test.ts` TypeScript error (out of scope):** Running the full Deno suite (`deno test --allow-all`) triggers a TS2769 error in `supabase/functions/stripe-webhook/index.test.ts` on a `crypto.subtle.importKey` call using `Uint8Array<ArrayBufferLike>` vs `ArrayBuffer`. This is a pre-existing issue not introduced by this plan — the 27 event handler tests (all 6 invoice tests + 21 sibling tests) run clean when the invoice handler test files are run individually or grouped without `index.test.ts`.

## User Setup Required

**Deferred deploy checkpoint:** The corrected Edge Function still requires `supabase functions deploy stripe-webhook` (on the live project `ytnsipxxmzgaebkqmokp`) before SC#4 is provable end-to-end against live Stripe. This was explicitly out of scope for plan 14-10 per the `<invariants>` block — deploy + Stripe Dashboard registration are HUMAN VERIFICATION items handled separately.

## Next Phase Readiness

- CR-04 is closed in code — dunning trigger is no longer inverted
- Both invoice handlers are structurally clean: no unsafe casts, no dead code, no non-existent field reads
- Deno tests assert the corrected behavior for both handlers
- SC#4 server-side logic is now correct; end-to-end proof still requires deploy + live Stripe test

---
*Phase: 14-monetization-foundation-stripe-web-clinic-seats*
*Completed: 2026-05-14*
