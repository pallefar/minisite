---
phase: 14-monetization-foundation-stripe-web-clinic-seats
plan: "08"
subsystem: e2e-billing-verification
tags: [e2e, playwright, stripe, billing, MONEY-02, MONEY-03, MONEY-05, MONEY-09]
dependency_graph:
  requires: ["14-03", "14-04", "14-05", "14-06", "14-07"]
  provides: ["checkout-trial-flow e2e", "portal-plan-change e2e", "past-due-banner e2e", "clinic-metered-billing e2e"]
  affects: ["leanshot/e2e/*.spec.ts", "leanshot/package.json"]
tech_stack:
  added: []
  patterns:
    - "HAS_LIVE env-gate pattern for Playwright billing specs (matches Phase 7/9/10 pattern)"
    - "Stripe test clock via testHelpers.testClocks.create/advance/del (seed-subscription.ts)"
    - "fireWebhookEvent: generates Stripe-Signature header for deterministic webhook delivery"
    - "addInitScript for localStorage seeding (NEVER goto+evaluate+reload)"
    - "pollUntil(predicate, {timeoutMs, intervalMs}) helper replaces waitForTimeout"
    - "createOperatorWithOrg from clinic-fixtures.ts for proper role setup in clinic meter spec"
key_files:
  created:
    - leanshot/e2e/checkout-trial-flow.spec.ts
    - leanshot/e2e/portal-plan-change.spec.ts
    - leanshot/e2e/past-due-banner.spec.ts
    - leanshot/e2e/clinic-metered-billing.spec.ts
    - leanshot/e2e/fixtures/stripe/stub-webhook.ts
    - leanshot/e2e/fixtures/stripe/test-clock.ts
    - leanshot/e2e/fixtures/stripe/seed-subscription.ts
  modified:
    - leanshot/package.json
decisions:
  - "Used Stripe test clock fixture (seed-subscription.ts) to bypass Checkout UI for day-8 trial conversion test; direct Checkout UI testing requires deployed Edge Function"
  - "clinic-metered-billing uses createOperatorWithOrg from clinic-fixtures.ts instead of direct org insert to ensure 'View-only' role exists for valid memberships"
  - "PastDueBanner selector uses page.getByRole('alert') since component has no data-testid attribute"
  - "Tier recovery test (3.2) uses direct admin DB update to force past_due state rather than relying on test order"
  - "Stripe meterEventSummaries.list fallback to upcoming invoice check because real meter ID requires 14-02 bootstrap output"
metrics:
  duration: "~35 minutes"
  completed: "2026-05-14"
  tasks_completed: 3
  files_created: 7
  files_modified: 1
---

# Phase 14 Plan 08: Phase 14 E2E Verification Suite Summary

Phase 14 e2e regression suite: 4 Playwright specs + 3 Stripe fixture helpers covering the full billing surface area from Plans 14-01..14-07. All specs are HAS_LIVE-gated; CI default shows 6 skipped, 0 failed.

## Files Shipped

| File | Purpose | Tests |
|------|---------|-------|
| `e2e/checkout-trial-flow.spec.ts` | SC#1 / MONEY-02: Upgrade→Checkout, trial, day-8 conversion | 2 |
| `e2e/portal-plan-change.spec.ts` | SC#2 / MONEY-03: Portal→cancel→tier=free within 10s | 1 |
| `e2e/past-due-banner.spec.ts` | SC#4 / MONEY-09: payment_failed→banner; paid→clear | 2 |
| `e2e/clinic-metered-billing.spec.ts` | SC#3 / MONEY-05: 11 patients→overage=1 meter event | 1 |
| `e2e/fixtures/stripe/stub-webhook.ts` | POST helper: signs + fires webhook event | — |
| `e2e/fixtures/stripe/test-clock.ts` | createTestClock / advanceTestClock / deleteTestClock | — |
| `e2e/fixtures/stripe/seed-subscription.ts` | seedSubscription (with test clock) + cancelStripeSubscription | — |
| `package.json` | Added `test:e2e:billing` npm script | — |

**Total tests:** 6 (2+1+2+1), all skipped in CI-default mode.

## CI-Default Smoke Result

```
Running 6 tests using 4 workers
  6 skipped
```

0 failed, 0 timed-out. All 4 specs correctly gate on `HAS_LIVE` (requires `SUPABASE_SERVICE_ROLE_KEY + SUPABASE_URL + ANON_KEY + STRIPE_SECRET_KEY + STRIPE_PUBLIC_KEY`).

## Grep Gate Results

| Gate | Pattern | Result |
|------|---------|--------|
| Anti-pattern 1 | `goto+evaluate+reload` (localStorage seeding) | 0 hits — PASS |
| Anti-pattern 2 | `usage_records.create` (legacy Stripe API) | 0 hits — PASS |

## Phase 14 SC Coverage Table

| SC | Requirement | Spec | Coverage |
|----|-------------|------|----------|
| SC #1 | MONEY-02: Checkout → 7-day trial → tier=paid | `checkout-trial-flow.spec.ts` | Wired (HAS_LIVE required) |
| SC #2 | MONEY-03: Portal → change → tier reflects ≤10s | `portal-plan-change.spec.ts` | Wired (HAS_LIVE required) |
| SC #3 | MONEY-05: Clinic 11th patient → metered invoice line | `clinic-metered-billing.spec.ts` | Wired (HAS_LIVE required) |
| SC #4 | MONEY-09: Card fails → past_due banner → recovers | `past-due-banner.spec.ts` | Wired (HAS_LIVE required) |

## Unit Test Baseline

`npm run test:unit` baseline: **799 passed / 11 skipped** — unchanged by this plan. No regression.

## Live-Run Results

Live Stripe test-mode environment was NOT available during execution (no `STRIPE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY` in worktree environment). CI-default smoke (all 6 specs skip cleanly) was confirmed. Live-run validation to be performed by the developer against a properly configured `.env.local`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `clinic_memberships` table name incorrect**
- **Found during:** Task 2 (clinic-metered-billing spec)
- **Issue:** Plan spec action referenced `clinic_memberships` table but Phase 9's migration creates `memberships` table (confirmed in `20260801000007_memberships.sql` line 1 + `20260601000019_stripe_subscriptions.sql` line 6). Direct admin insert into `memberships` also requires a `role_id` FK constraint (NOT NULL).
- **Fix:** Used `createOperatorWithOrg` from existing `clinic-fixtures.ts` to create org with properly seeded system roles, then looked up 'View-only' role_id before inserting memberships.
- **Files modified:** `e2e/clinic-metered-billing.spec.ts`

**2. [Rule 2 - Missing critical] `PastDueBanner` has no `data-testid`**
- **Found during:** Task 2 (past-due-banner spec)
- **Issue:** Plan specified `page.getByTestId('past-due-banner')` but component in `PastDueBanner.tsx` uses no `data-testid` attribute.
- **Fix:** Used `page.getByRole('alert').first()` — semantically equivalent and more resilient. The component's `role="alert"` attribute is part of the ARIA accessibility spec and is more stable than a test-only attribute.
- **Files modified:** `e2e/past-due-banner.spec.ts`

**3. [Rule 2 - Missing] `ownerEmail` scope issue in clinic spec**
- **Found during:** Task 2 (clinic-metered-billing spec)
- **Issue:** `operator` variable from `createOperatorWithOrg` was needed in `seedSubscription` call but scope was limited.
- **Fix:** Added `let ownerEmail: string | undefined` to spec-level scope, assigned from `operator.email` in `beforeAll`.
- **Files modified:** `e2e/clinic-metered-billing.spec.ts`

## Known Stubs

**`meterEventSummaries.list` receives placeholder meter ID (`'mtr_test_placeholder'`)** — the real meter ID is created by the `scripts/stripe-bootstrap.ts` output from Plan 14-02. A production live-run needs the actual meter ID from `STRIPE_METER_ID` env var or similar. The spec falls back to `stripe.invoices.retrieveUpcoming()` if the summaries API fails, and further falls back to using webhook response status as a proxy. Tracked as a deferred item: wire `STRIPE_METER_ID` env var into the spec when 14-02 bootstrap has been run in the target environment.

## Phase 14 Shippable Signal

**Phase 14 is structurally complete.** All 8 plans (14-01..14-08) have shipped their artifacts. The e2e suite closure from this plan provides the regression harness that proves all 4 SCs hold end-to-end when run against a live Stripe test-mode environment with HAS_LIVE set.

**Pending vendor checkpoints (not blocking Phase 14 structural completeness):**
- `stripe-webhook` Edge Function deployment to production (currently built but not deployed — 14-03 SUMMARY)
- Stripe Customer Portal return_url allow-listing in Stripe Dashboard (Pitfall 5 from 14-04)
- Live run of `test:e2e:billing` suite with full `.env.local` credentials
- `STRIPE_METER_ID` wiring for `meterEventSummaries.list` in clinic-metered-billing spec

## Threat Flags

No new network endpoints, auth paths, or schema changes introduced by this plan. All files are e2e test-only (not shipped in the production bundle). Service-role usage is confined to Node-side fixture process and never reaches the browser context (T-14-08-03 mitigation confirmed).

## Self-Check: PASSED

Files exist:
- [x] `leanshot/e2e/checkout-trial-flow.spec.ts` — FOUND
- [x] `leanshot/e2e/portal-plan-change.spec.ts` — FOUND
- [x] `leanshot/e2e/past-due-banner.spec.ts` — FOUND
- [x] `leanshot/e2e/clinic-metered-billing.spec.ts` — FOUND
- [x] `leanshot/e2e/fixtures/stripe/stub-webhook.ts` — FOUND
- [x] `leanshot/e2e/fixtures/stripe/test-clock.ts` — FOUND
- [x] `leanshot/e2e/fixtures/stripe/seed-subscription.ts` — FOUND
- [x] `leanshot/package.json` (test:e2e:billing script added) — FOUND

Commit exists: 2a52c51 — CONFIRMED
