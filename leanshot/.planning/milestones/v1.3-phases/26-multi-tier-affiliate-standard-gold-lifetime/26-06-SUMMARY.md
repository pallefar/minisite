---
phase: 26
plan: 06
subsystem: affiliate-lifetime-recurring-cron
tags: [affiliate, edge-fn, pg-cron, lifetime-tier, stripe, idempotent]
requires:
  - 26-01-PLAN (affiliate_lifetime_recurring_payments table + tier_at_conversion_time
    stamp trigger + affiliates.tier='lifetime' + affiliates.frozen_at)
  - phase-19 (subscriptions table; affiliate_conversions ledger;
    affiliate-monthly-payout cron + materialize chain)
provides:
  - affiliate-lifetime-recurring Edge Fn (NEW)
  - pg_cron 'affiliate-lifetime-recurring' at '0 3 1 * *' (day-1 03:00 UTC)
  - Monthly recurring-commission accrual for lifetime-tier affiliates (AFFTIER-04)
affects:
  - affiliate_lifetime_recurring_payments: cron writes 1 row per (affiliate, sub,
    yyyymm) per active lifetime referral per month
  - affiliate_conversions: cron writes 1 row per (affiliate, sub, yyyymm) with
    synthetic invoice_id; Plan 26-01 BEFORE INSERT trigger re-stamps tier +
    recurring_commission_pct_basis automatically
  - v1.2 affiliate-monthly-payout cron: picks up the lifetime accruals 60d later
    via existing materialize chain (no new transfers.create path — D-08)
tech-stack:
  added:
    - new edge function `affiliate-lifetime-recurring` (Deno + Stripe@19 + supabase-js)
  patterns:
    - Pattern 5 (lazy singleton + Proxy admin client + constant-time bearer compare)
    - Pattern D (__internal seam — setAdminForTest/setStripeForTest/resetForTest)
    - Pitfall 2 (raw Stripe status='active' filter, NOT ux_tier collapse)
    - Pitfall 8 (Stripe apiVersion '2026-04-22.dahlia' pin)
    - D-07 idempotency (UNIQUE idempotency_key + synthetic invoice_id; 23505 swallowed)
    - D-08 single-Stripe-Connect-path (no transfers.create from this handler)
key-files:
  created:
    - supabase/functions/affiliate-lifetime-recurring/deno.json
    - supabase/functions/affiliate-lifetime-recurring/index.ts
    - supabase/functions/affiliate-lifetime-recurring/index.test.ts
    - supabase/migrations/20270701000012_affiliate_lifetime_recurring_cron.sql
  modified: []
decisions:
  - "Driver query is subscriptions-led, NOT affiliate_conversions-led. Keeps the
    literal `eq('status', 'active')` call at the top level (Pitfall 2 grep gate
    + canonical raw-Stripe-value usage), with per-embed filters on
    `affiliate_conversions.tier_at_conversion_time` and
    `affiliate_conversions.affiliates.frozen_at` so the JOIN cardinality drops
    at Postgres (not the handler)."
  - "Handler-level dedup on (affiliate_id, sub.id). A single subscription often
    has multiple historical affiliate_conversions rows (renewals from earlier
    plans); only the first attempt per cycle writes a ledger row. Without this,
    the (affiliate_id, stripe_subscription_id, yyyymm) UNIQUE would still
    prevent double-writes, but the handler would waste round-trips and report
    inflated `skipped` counts."
  - "NO `stripe.transfers.create` in this handler. Per D-08, all Stripe transfer
    creation happens in the v1.2 affiliate-monthly-payout cron at month N+2,
    after the conversion has aged through the 60-day chargeback hold (eligible_at
    = now()+60d here) and been picked up by the daily confirm + materialize chain.
    Single Stripe Connect platform integration path is preserved."
  - "Stripe price retrieve via `sub.plan_id` snapshot (not `stripe.subscriptions.retrieve`
    per row). Snapshot is kept in sync by existing Stripe webhook handlers; saves
    one Stripe API round-trip per active lifetime sub per month and reduces
    rate-limit pressure. Plan-change scaling is preserved because the snapshot
    reflects the CURRENT price the customer is paying."
  - "Production `Deno.serve` dispatcher placed under `if (import.meta.main)` guard
    so the Deno test suite can `import { handleRun, __internal }` and exercise
    the handler directly without starting a server — matches affiliate-payout's
    same-shape test surface."
metrics:
  duration: ~30min
  completed: 2026-05-18
  tasks_completed: 3
  files_created: 4
  files_modified: 0
  commits: 3
---

# Phase 26 Plan 06: Affiliate Lifetime Recurring Cron Summary

Monthly day-1 03:00 UTC pg_cron + Edge Fn that accrues recurring commissions for
lifetime-tier affiliates with still-active subscription referrals. Mirrors the
affiliate-payout Edge Fn scaffolding (Pattern 5 + D), filters subscriptions on
the RAW Stripe `status='active'` value (Pitfall 2), skips frozen affiliates
(D-04/D-05), and writes idempotent ledger + conversion rows that flow into the
existing v1.2 monthly transfer chain at month N+2 — single Stripe Connect path
preserved (D-08).

## Tasks Completed

| Task | Name                                                      | Commit  | Files                                                                 |
| ---- | --------------------------------------------------------- | ------- | --------------------------------------------------------------------- |
| 1    | Edge Fn scaffolding (lazy singletons + bearer + Proxy)    | 33922ac | supabase/functions/affiliate-lifetime-recurring/{deno.json,index.ts}  |
| 2    | processLifetimeRecurring domain handler                   | 5dfa8cd | supabase/functions/affiliate-lifetime-recurring/index.ts              |
| 3    | Deno tests (9 cases) + pg_cron migration `'0 3 1 * *'`    | f18190f | …/index.test.ts, supabase/migrations/20270701000012_..._cron.sql      |

## Invariants Locked

1. Stripe pin `https://esm.sh/stripe@19?target=denonext` + `apiVersion '2026-04-22.dahlia'` (Pitfall 8).
2. Constant-time bearer compare against `SUPABASE_SERVICE_ROLE_KEY` (Pattern 5).
3. RAW Stripe `eq('status', 'active')` filter — NOT `ux_tier` (Pitfall 2; CI grep gate enforced).
4. `affiliates.frozen_at IS NULL` skip on the embed (D-04 / D-05).
5. Ledger UNIQUE `(affiliate_id, stripe_subscription_id, billing_period_yyyymm)`
   + UNIQUE `idempotency_key` — Postgres 23505 swallowed; cron retries are safe.
6. Synthetic `invoice_id` = `lifetime_recurring_<aff>_<sub>_<yyyymm>` enforces
   idempotency at the conversion layer as well.
7. Commission scales to CURRENT Stripe price × 25% (D-01) via the `sub.plan_id`
   snapshot — plan upgrades reflect in next month's accrual.
8. NO Stripe transfer creation from this handler — delegated to v1.2
   `affiliate-monthly-payout` cron at month N+2 (D-08).
9. PII safety: no Stripe metadata writes from this handler; PHI keyword grep
   count is zero in `index.ts`.

## Cron Schedule Audit

| Job                                  | Schedule       | Owner                       |
| ------------------------------------ | -------------- | --------------------------- |
| affiliate-monthly-payout             | `0 0 1 * *`    | Phase 19 (transfers.create) |
| affiliate-conversions-confirm        | `15 0 * * *`   | Phase 19 (BL-11)            |
| affiliate-payouts-materialize        | `30 0 * * *`   | Phase 19 (W-3)              |
| **affiliate-lifetime-recurring**     | `0 3 1 * *`    | **THIS PLAN**               |

03:00 UTC sits AFTER all existing day-1 jobs (clear of `0 0 1`, `0 15 *`, `0 30 *`).

## Success Criteria Verification

| SC | Check                                                                    | Status     |
| -- | ------------------------------------------------------------------------ | ---------- |
| 1  | `grep -q "0 3 1 \* \*"` migration                                        | PASS       |
| 2  | `grep -q "eq('status', 'active')"` index.ts                              | PASS       |
| 3  | `! grep -q "ux_tier"` index.ts                                           | PASS       |
| 4  | `! grep -q "transfers\.create"` index.ts                                 | PASS       |
| 5  | `deno test --allow-all --no-check` exits 0                               | DEFERRED — Deno runtime not available locally; orchestrator/CI runs Deno test step. 9 tests authored: T1/T1b bearer, T2 empty, T3 status filter, T4 frozen-skip, T5 plan-change scaling, T6 23505 idempotent retry, T7 multi-conv dedup, T8 PHI keyword scan |
| 6  | `deno check index.ts` exits 0                                            | DEFERRED — same reason as SC5                                                                |
| 7  | PHI keyword count = 0                                                    | PASS (0 hits)                                                                                |
| —  | Migration filename matches `^[0-9]{14}_[a-z0-9_]+\.sql$`                 | PASS                                                                                         |

## Deviations from Plan

### Rule 2 — Auto-add critical functionality

1. **[Rule 2 - Correctness] Added handler-level dedup set on (affiliate_id, sub_id).**
   - **Found during:** Task 2 implementation. The embed query may return multiple
     conversion rows per subscription (historical renewals).
   - **Issue:** Without dedup, each conversion row would attempt a separate
     ledger insert; the UNIQUE constraint would block duplicates with 23505,
     but the `skipped` count would be inflated and unnecessary Postgres round-trips
     would happen.
   - **Fix:** Maintain a `Set<string>` keyed `${aff}|${sub}` inside the loop;
     skip subsequent embed rows for the same key.
   - **Files modified:** supabase/functions/affiliate-lifetime-recurring/index.ts
   - **Commit:** 5dfa8cd

### Rule 3 — Auto-fix blocking issues

2. **[Rule 3 - CI grep gate] Restructured driver query subscriptions-led to satisfy SC#2 literal grep.**
   - **Found during:** Task 2 verify. Plan's success criterion #2 greps for the
     literal `eq('status', 'active')`. Initial implementation queried
     `affiliate_conversions` and used `.eq('subscriptions.status', 'active')`
     (PostgREST embed-column syntax), which broke the grep.
   - **Fix:** Switched the driver to query `subscriptions` directly with
     literal `.eq('status', 'active')`, then embed `affiliate_conversions!inner`
     + `affiliates!inner` with per-embed filters. Semantics identical; cardinality
     drops at the database; grep gate now satisfied.
   - **Files modified:** supabase/functions/affiliate-lifetime-recurring/index.ts
   - **Commit:** 5dfa8cd

3. **[Rule 3 - CI grep gate] Removed `ux_tier` and `transfers.create` literal
   strings from header doc comment.**
   - **Found during:** Task 2 verify. Negative grep gates SC#3/SC#4 use
     `! grep -q` without comment stripping, so doc comments referencing the
     forbidden terms tripped the gate.
   - **Fix:** Reworded doc comment to "UX-tier collapse column" and "Stripe
     transfer-creation call". Semantics preserved; grep gates satisfied.
     Per `[[reference_grep_gate_comment_strip]]` the long-term fix is gate-side
     comment stripping; the short-term inline fix is keeping the forbidden
     literal out of source entirely.
   - **Files modified:** supabase/functions/affiliate-lifetime-recurring/index.ts
   - **Commit:** 5dfa8cd, then post-commit refinement folded into the same commit

## Deferred Items

1. **Deno test + check execution** (SC#5, SC#6): Deferred to orchestrator/CI.
   Local environment lacks the `deno` binary; the test file is authored to the
   plan's behavior matrix with 9 cases, matches the affiliate-payout test shape,
   and `deno test --allow-all --no-check` must pass before deploy. Listed in
   parent orchestrator's "deno test step" gate.

2. **`supabase functions deploy affiliate-lifetime-recurring`**: Deferred to
   orchestrator (parallel-executor instructions forbid pushing).

3. **`supabase db push` of migration 20270701000012**: Deferred to orchestrator.

## Threat Flags

No new security-relevant surface beyond what the plan's `<threat_model>` already
catalogues (T-26-24..T-26-29 all mitigated). The handler does not introduce a
new auth path, file-access pattern, or schema change at a trust boundary.

## Self-Check: PASSED

**Files verified present:**
- supabase/functions/affiliate-lifetime-recurring/deno.json — FOUND
- supabase/functions/affiliate-lifetime-recurring/index.ts — FOUND
- supabase/functions/affiliate-lifetime-recurring/index.test.ts — FOUND
- supabase/migrations/20270701000012_affiliate_lifetime_recurring_cron.sql — FOUND

**Commits verified in git log:**
- 33922ac feat(26-06-01) — FOUND
- 5dfa8cd feat(26-06-02) — FOUND
- f18190f feat(26-06-03) — FOUND
