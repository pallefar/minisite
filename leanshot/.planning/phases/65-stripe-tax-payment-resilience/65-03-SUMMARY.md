---
phase: 65-stripe-tax-payment-resilience
plan: 03
subsystem: payments
tags: [stripe, tax, b2b, checkout, pay-01, pay-02, pay-03]
requires:
  - 65-01 (org_subscriptions.tax_id column migration — depends_on)
provides:
  - automatic_tax + customer_update on every Stripe Checkout session
  - tax_id_collection on clinic (B2B) Checkout sessions
  - test coverage for tax-related Checkout session params (web/lifetime/clinic)
affects:
  - supabase/functions/stripe-checkout/index.ts (handleSession)
  - supabase/functions/stripe-checkout/index.test.ts
tech-stack:
  added: []
  patterns:
    - Stripe Checkout `automatic_tax` flag (Stripe SDK v19)
    - Stripe Checkout `customer_update` for address-on-file → invoice tax calc
    - Stripe Checkout `tax_id_collection` (Stripe-hosted tax-ID UI for B2B)
    - Phase 14 invariant preserved: `payment_method_collection: 'always'`, `trial_period_days: 7`
key-files:
  created: []
  modified:
    - supabase/functions/stripe-checkout/index.ts
    - supabase/functions/stripe-checkout/index.test.ts
decisions:
  - "Clinic gate uses explicit `plan === 'clinic'` not the lifetime/else fork — defensive against future plan-enum additions"
  - "customer_update safe on mode='payment' (lifetime) because ensureWebCustomer creates the Stripe customer BEFORE checkout.sessions.create"
  - "Tax-ID mirror to org_subscriptions.tax_id deferred to Plan 65-04 webhook handler — kept out of this Edge Fn"
  - "Affiliate-payout flow explicitly noted OUT OF SCOPE (Stripe Connect Express payouts, not Checkout sessions; Phase 26 owns)"
metrics:
  duration: ~12min
  completed: 2026-05-26
  tasks_completed: 1
  files_modified: 2
  tests_added: 5
  tests_passed: 21
---

# Phase 65 Plan 03: Stripe Tax + B2B tax_id_collection Summary

**One-liner:** Stripe Checkout sessions now request automatic tax calculation + customer address auto-update on every flow, plus tax-ID collection on B2B clinic flows, satisfying PAY-01/02/03 code-side requirements ahead of Stripe Dashboard "Enable Tax" operator action in Plan 65-10.

## Tasks Completed

| Task | Name                                                                                    | Commits                                  | Files                                                                                                  |
| ---- | --------------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 1    | Add automatic_tax + customer_update to ALL sessions; tax_id_collection on clinic only   | `19131afd` (RED) + `f70b9938` (GREEN)    | `supabase/functions/stripe-checkout/index.ts`, `supabase/functions/stripe-checkout/index.test.ts`      |

## What Was Built

### Code changes (`supabase/functions/stripe-checkout/index.ts`)

In `handleSession`, the base `sessionParams` object (constructed just before the lifetime/subscription mode branch) now carries two new top-level fields on every session:

```ts
automatic_tax: { enabled: true },
customer_update: { address: 'auto', name: 'auto' },
```

A third field is added conditionally on the clinic branch only, via an explicit `if (plan === 'clinic')` guard that runs after the base params are built and before the mode-specific assignment:

```ts
if (plan === 'clinic') {
  sessionParams['tax_id_collection'] = { enabled: true };
}
```

A header comment block above the assignment documents:

- The PAY-01/02/03 requirement IDs and CONTEXT.md decisions D-01/D-02/D-03.
- The operator-gate requirement that Stripe Tax must be enabled in the Stripe Dashboard before deploy — owned by Plan 65-10 close-out (via `stripe.tax.calculations.create()` smoke test).
- Safety note that `customer_update` works on `mode='payment'` (lifetime) because `ensureWebCustomer` runs first.
- Explicit OUT-OF-SCOPE note for the affiliate-payout flow (Stripe Connect Express payouts, Phase 26 territory).
- Cross-reference to Plan 65-04 for the `checkout.session.completed` webhook mirror to `org_subscriptions.tax_id`.

No existing fields were rearranged or removed. Phase 14/43 invariants (`payment_method_collection: 'always'`, `trial_period_days: 7`, `subscription_data.metadata`, `payment_intent_data.metadata`, `discounts` clamp) are all preserved.

### Tests added (`supabase/functions/stripe-checkout/index.test.ts`)

Five new Deno tests under the "Phase 65 Plan 03" banner, all wired through the existing `__setStripeForTest` / `__setAdminForTest` seams and reusing `makeFakeAdmin`, `makeQueueAdmin`, and `makeP43Admin` helpers:

1. **Test 1 — web subscription `automatic_tax.enabled === true`** — drives `plan='plus_monthly'`, asserts presence + value of `automatic_tax` on captured `sessionParams`.
2. **Test 2 — web subscription `customer_update.{address,name} === 'auto'`** — asserts both fields on the web flow.
3. **Test 3 — web subscription has NO `tax_id_collection`** — negative assertion that locks the consumer-flow invariant (passed even before the implementation because the field had never been set; the assertion locks the invariant going forward).
4. **Test 4 — clinic subscription carries all three** — drives `plan='clinic'` with a valid `clinic_id`, asserts `tax_id_collection.enabled === true` AND `automatic_tax.enabled === true` AND `customer_update.address === 'auto'`.
5. **Test 5 — lifetime (mode=payment) carries `automatic_tax` + `customer_update`, NOT `tax_id_collection`** — also asserts `mode === 'payment'` to ratify the new fields don't break the Phase 43 lifetime branch.

## Verification

- `cd /Users/karstenhaldan/minisite/.claude/worktrees/agent-a82986b550cf5a617 && $HOME/.deno/bin/deno test --no-check --allow-env --allow-net --allow-read supabase/functions/stripe-checkout/index.test.ts` → **21 passed | 0 failed** (16 pre-existing + 5 new).
- `grep -c "automatic_tax" supabase/functions/stripe-checkout/index.ts` → **2** (≥ 2 required; header comment + `sessionParams` field).
- `grep -c "tax_id_collection" supabase/functions/stripe-checkout/index.ts` → **3** (≥ 1 required; header comment + clinic gate + assignment).
- `grep -c "customer_update" supabase/functions/stripe-checkout/index.ts` → **3** (header comment + `sessionParams` field + comment annotation).
- Phase 14 / Phase 19 / Phase 43 regression tests all green (existing JWT auth, web/clinic happy-path, affiliate-code propagation, lifetime branch, 70%-cap clamp, vendor-unconfigured 503, clinic regression guard).

## Decisions Made

1. **Explicit `plan === 'clinic'` gate for `tax_id_collection`.** The lifetime/else fork could not host the gate safely because the `else` covers BOTH web and clinic. Using an explicit `if (plan === 'clinic')` block (executed after the base params, before the mode branch) is defensive against future plan-enum additions and reads more cleanly than nesting the clinic detection inside the subscription branch.

2. **`customer_update` applied unconditionally including on `mode='payment'`.** Initially flagged as a possible issue (Stripe historically required a pre-existing customer for `customer_update` on `mode='payment'`), but `ensureWebCustomer` is already called BEFORE `sessions.create` for the lifetime branch (Phase 43 invariant) — the customer always exists when checkout creates the session. No special-casing needed.

3. **Tax-ID mirror deferred to Plan 65-04.** Plan 65-03 only sends the request flag (`tax_id_collection.enabled = true`); the `checkout.session.completed` webhook handler will own the read-back and mirror to `org_subscriptions.tax_id`. Keeping this responsibility split prevents Plan 65-03 from sprawling into webhook-handler territory and matches the depends_on graph (65-04 already exists in the plan list).

4. **Affiliate-payout explicitly out-of-scope.** PAY-01's wording mentions "consumer + clinic + affiliate-payout where applicable" — but affiliate payouts go through Stripe Connect Express, not Checkout sessions, and Phase 26 owns that surface. Documented in the header comment so future readers don't search for the affiliate edit that never happens.

## Deviations from Plan

None — plan executed exactly as written. No Rule 1/2/3 auto-fixes; no Rule 4 architectural decisions surfaced.

## Authentication Gates

None — implementation work was entirely in-tree (Edge Fn code + Deno tests). No vendor logins, no secrets to set, no operator UI work.

## Known Stubs

None — all surfaces are wired to real (or stubbed-via-DI in tests) Stripe SDK calls. No placeholder strings.

## Threat Flags

None new. The plan's `<threat_model>` lists T-65-03-01 (tax_id transit — mitigated by Stripe-hosted UI; we only receive the validated value on the webhook), T-65-03-02 (automatic_tax bypass if Dashboard toggle is OFF — accepted, surfaces at Plan 65-10 deploy smoke test), and T-65-03-03 (tax-calc audit deferred to Plan 65-04) — all addressed by design.

## Self-Check: PASSED

- File created: `leanshot/.planning/phases/65-stripe-tax-payment-resilience/65-03-SUMMARY.md` → FOUND (this file)
- Commit `19131afd` (test RED) → FOUND in `git log --oneline`
- Commit `f70b9938` (feat GREEN) → FOUND in `git log --oneline`
- Files modified per frontmatter:
  - `supabase/functions/stripe-checkout/index.ts` → FOUND (35 insertions in feat commit)
  - `supabase/functions/stripe-checkout/index.test.ts` → FOUND (191 insertions in test commit)
- Success criteria:
  - automatic_tax on every session → VERIFIED (5 tests)
  - customer_update on every session → VERIFIED (5 tests)
  - tax_id_collection on clinic only → VERIFIED (test 3 negative + test 4 positive + test 5 negative)
  - No STATE.md / ROADMAP.md modifications → VERIFIED (`git status` clean after commits)

## TDD Gate Compliance

- RED commit (`test(65-03): ...`) → present at `19131afd`
- GREEN commit (`feat(65-03): ...`) → present at `f70b9938`
- REFACTOR commit → not required (implementation is minimal + well-commented; no cleanup needed)
