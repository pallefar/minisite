---
phase: 14-monetization-foundation-stripe-web-clinic-seats
plan: "07"
subsystem: stripe-billing-meters
tags: [stripe, billing-meters, clinic, metered-billing, edge-function, deno, tdd]
dependency_graph:
  requires: ["14-01", "14-03"]
  provides: ["handleInvoiceUpcoming", "invoice.upcoming meter emission"]
  affects: ["supabase/functions/stripe-webhook"]
tech_stack:
  added: []
  patterns:
    - "SHA-256 identifier for Stripe Billing Meter deduplication (Wave-0 A10 pattern)"
    - "35-day rolling-window guard for Stripe timestamp limits (Pitfall 9)"
    - "stripe.billing.meterEvents.create (v1 namespace absent in stripe@19)"
    - "SECURITY DEFINER count_active_patients() via service-role admin.rpc()"
key_files:
  created:
    - supabase/functions/stripe-webhook/events/invoice-upcoming.ts
    - supabase/functions/stripe-webhook/events/invoice-upcoming.test.ts
    - leanshot/.planning/phases/14-monetization-foundation-stripe-web-clinic-seats/14-07-AUDIT.md
  modified: []
decisions:
  - "Trigger source: invoice.upcoming webhook (default per RESEARCH Open Question 1)"
  - "Stripe SDK path: stripe.billing.meterEvents.create (v1 namespace absent in stripe@19 at runtime)"
  - "Dispatcher wiring already present from 14-03; no index.ts modification needed"
metrics:
  duration: "~20 minutes"
  completed: "2026-05-14"
  tasks_completed: 2
  files_created: 3
  files_modified: 0
---

# Phase 14 Plan 07: invoice.upcoming Clinic Metered True-up Summary

Wires the `invoice.upcoming` Stripe webhook handler to emit Billing Meters v1 events for clinic overage above the 10-patient base allowance using SHA-256 idempotency identifiers and a 35-day rolling-window guard.

## Wave-0 Decisions

**Trigger source: invoice.upcoming webhook** (default per RESEARCH Open Question 1)

- `vercel.json` has no `crons` array — no Vercel Cron configured.
- 14-03's dispatcher already routes `invoice.upcoming` events via the existing switch statement.
- No evidence of reliability issues in Stripe test mode.
- Proceeding with handler at `supabase/functions/stripe-webhook/events/invoice-upcoming.ts` as planned.

**SDK path: stripe.billing.meterEvents.create** (Assumption A10 fallback — v1 namespace absent)

- Ran `deno eval` against `https://esm.sh/stripe@19?target=denonext` with `apiVersion: '2026-04-22.dahlia'`.
- `typeof s?.v1?.billing?.meterEvents?.create` → `undefined` (v1 namespace not present)
- `typeof s?.billing?.meterEvents?.create` → `function` (this is the correct path)
- Hardcoded `ctx.stripe.billing.meterEvents.create(...)` — no runtime conditional.

## Files Created / Modified

| File | Action | Notes |
|------|--------|-------|
| `supabase/functions/stripe-webhook/events/invoice-upcoming.ts` | Created | Full handler replacing the 14-03 no-op stub |
| `supabase/functions/stripe-webhook/events/invoice-upcoming.test.ts` | Created | 7 Deno test cases |
| `leanshot/.planning/phases/.../14-07-AUDIT.md` | Created | Wave-0 audit decisions |

## Tasks Completed

### Task 0 (Wave-0 Audit) — No commit (audit only)
- Verified `invoice.upcoming` webhook approach (no Vercel Cron needed)
- Confirmed `stripe.billing.meterEvents.create` as the correct SDK path
- Documented decisions in `14-07-AUDIT.md`

### Task 1 + 2 (Handler + Tests) — Commit `395f232`
- Replaced no-op stub with full `handleInvoiceUpcoming(event, ctx)` implementation
- Wrote 7 Deno tests covering all required behaviors
- All 7 tests pass: `deno test --allow-all --import-map=../import_map.json events/invoice-upcoming.test.ts`

## Tests Added

7 Deno tests in `invoice-upcoming.test.ts`:

| Test | Behavior | Result |
|------|----------|--------|
| Test 1 | Skips meter event when active count <= 10 | PASS |
| Test 2 | Emits meter event with `value='1'` for 11 patients | PASS |
| Test 3 | Emits meter event with `value='15'` for 25 patients | PASS |
| Test 4 | Byte-identical identifier across two invocations (same clinic+period) | PASS |
| Test 5 | Skips + console.warn when period_start > 35 days old | PASS |
| Test 6 | Silent no-op for web-tier customers (no clinic_stripe_customers row) | PASS |
| Test 7 | Silent no-op for unregistered stripe_customer_id | PASS |

## Deviations from Plan

### [Rule 3 - Auto-fix] Dispatcher already wired by 14-03

**Found during:** Task 2 planning

**Issue:** The plan called for a separate commit to add `'invoice.upcoming': handleInvoiceUpcoming` to the HANDLERS map in `index.ts`. However, 14-03's executor (Wave 2) already wired the dispatcher using a `switch` statement with `import { handle: handleInvoiceUpcoming }`. The `invoice.upcoming` case was already in place at `index.ts:103,122-124`.

**Fix:** No `index.ts` modification needed — the dispatcher is already connected. The separate dispatcher commit was skipped.

**Effect:** No behavior change. The handler is live in the dispatcher as soon as `invoice-upcoming.ts` exports `handle`.

### [Rule 3 - Auto-fix] Added `handle` shim for dispatcher compatibility

**Found during:** Task 1 implementation

**Issue:** The plan specified `export async function handleInvoiceUpcoming(event, ctx: HandlerCtx)` where `ctx` includes both `admin` and `stripe`. However, the existing dispatcher in `index.ts` calls `handle(event, admin)` (no Stripe client in ctx). The plan's `<interfaces>` block documents the newer ctx-pattern but the live code uses the older 2-arg pattern.

**Fix:** Exported both:
- `handleInvoiceUpcoming(event, ctx)` — the testable core function with ctx injection
- `handle(event, admin)` — the dispatcher-compatible shim that creates a Stripe instance from env and delegates to `handleInvoiceUpcoming`

**Files modified:** `supabase/functions/stripe-webhook/events/invoice-upcoming.ts`

### [Rule 3 - Auto-fix] deno check requires --import-map flag

**Found during:** Task 1 verification

**Issue:** The plan's verify command `deno check events/invoice-upcoming.ts` fails without `--import-map=../import_map.json` (the `"stripe"` bare specifier resolves via the shared import map). This affects all `events/*.ts` files equally — confirmed by checking `checkout-session-completed.ts` which also fails without the flag.

**Fix:** Used `deno check --import-map=../import_map.json events/invoice-upcoming.ts` for verification. File passes cleanly with the flag.

**Note:** Not a bug in this plan's code — a pre-existing deno check convention for this function.

## Verification Results

```
deno check --import-map=../import_map.json events/invoice-upcoming.ts → PASS (clean)
deno test --allow-all --import-map=../import_map.json events/invoice-upcoming.test.ts → 7/7 PASS
repo-wide legacy-API grep → 0 matches (OK: zero legacy-API references)
dispatcher grep → index.ts:103,122-124 confirms invoice.upcoming wired
```

## User Action Required (Phase Close)

**Stripe Dashboard step:** Webhooks → {webhook endpoint} → Add events → `invoice.upcoming`

This enables Stripe to POST `invoice.upcoming` events to the `stripe-webhook` Edge Function endpoint. Without this, the handler never fires in production even though the code is deployed.

Resume signal: `webhook-events-confirmed`

## Deploy Command (Not Executed — Phase Close)

```bash
cd /Users/karstenhaldan/minisite && supabase functions deploy stripe-webhook --linked
```

Re-deploys the `stripe-webhook` Edge Function with the new `invoice-upcoming.ts` handler bundled.

## Followups for 14-08

Plan 14-08's `e2e/clinic-metered-billing.spec.ts` consumes this handler via Stripe test clock:
- Advances clock to trigger `invoice.upcoming`
- Calls `stripe.invoices.retrieveUpcoming({ customer: clinicCustomerId })`
- Asserts the upcoming invoice has an overage line item of `$9` (1 patient × $9)

That's the user-observable proof of SC #3 (clinic owner adds 11th patient → invoice reflects per-active-patient charge).

## Deferred Items

- **Vercel Cron path:** Only needed if `invoice.upcoming` becomes unreliable post-launch. Audit at Phase 22.
- **Push notification on clinic overage threshold:** Deferred to Phase 17.
- **App-side audit log for meter events:** Stripe Dashboard logs are sufficient for v1.2. App-side logging deferred to Phase 22 admin dashboard.

## Known Stubs

None — the handler is fully implemented. The 14-03 stub (`console.log + return`) has been replaced.

## Self-Check: PASSED

| Check | Result |
|-------|--------|
| `invoice-upcoming.ts` exists | FOUND |
| `invoice-upcoming.test.ts` exists | FOUND |
| `14-07-AUDIT.md` exists | FOUND |
| Commit `395f232` exists | FOUND |
| `handleInvoiceUpcoming` exported | FOUND (1 export) |
| `billing.meterEvents.create` present | FOUND |
| No legacy `usage_records` in production code | OK (0 matches) |
| 7/7 Deno tests pass | PASS |
