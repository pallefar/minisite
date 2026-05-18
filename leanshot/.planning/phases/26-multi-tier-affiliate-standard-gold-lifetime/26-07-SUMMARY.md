---
phase: 26-multi-tier-affiliate-standard-gold-lifetime
plan: 07
subsystem: payments
tags: [stripe, webhooks, affiliate, clawback, fraud-signals, supabase-edge-functions]

requires:
  - phase: 19
    provides: affiliate_conversions schema (invoice_id, status check constraint), payouts table
  - phase: 14
    provides: stripe-webhook dispatcher, subscription_events.event_id UNIQUE idempotency gate
  - phase: 24
    provides: PostHog server-side capture (refund_issued event in dispatcher's existing charge.refunded arm)
  - phase: 26-01
    provides: payouts.adjustments jsonb column, affiliate_fraud_signals table, AdjustmentEntry / FraudSignalChargebackPayload type contracts
  - phase: 26-05
    provides: superadmin Anomaly Review tab (consumes fraud_signals rows written here)

provides:
  - Stripe charge.refunded → affiliate commission claw-back via payouts.adjustments
  - Stripe charge.dispute.created → claw-back + fraud_signals row (no auto-freeze)
  - affiliate_conversions.status='clawback_pending' transition (newly permitted by migration 13)
  - Closes AFFTIER-04 (refund/dispute reversal pipeline)

affects: [phase-26-05 (consumes fraud_signals), phase-26-04 (payout materialize cron reconciles clawback_pending rows)]

tech-stack:
  added: []
  patterns:
    - "Optional charge-resolver injection — handler accepts an injectable resolver that defaults to stripe.charges.retrieve, enabling pure-function deno tests without a live Stripe client"
    - "Dispatcher arm extension over duplication — when a new plan needs behavior on an event type that's already handled, extend the existing case arm rather than introducing a duplicate (which JS allows silently but never executes)"
    - "Migration backfill for missed status enum widening — late-discovered check-constraint blocker handled with single tightly-scoped migration committed in the same plan"

key-files:
  created:
    - supabase/functions/stripe-webhook/events/charge-refunded.ts
    - supabase/functions/stripe-webhook/events/charge-refunded.test.ts
    - supabase/functions/stripe-webhook/events/charge-dispute-created.ts
    - supabase/functions/stripe-webhook/events/charge-dispute-created.test.ts
    - supabase/migrations/20270701000013_affiliate_conversions_clawback_pending_status.sql
  modified:
    - supabase/functions/stripe-webhook/index.ts

key-decisions:
  - "DEVIATION from plan: added migration 20270701000013 to widen affiliate_conversions.status CHECK constraint. Plan 26-07 assumed 'clawback_pending' was already accepted, but Phase 19's original constraint only allowed {pending,confirmed,flagged,rejected,paid,on_hold}. Without the widening, the UPDATE would have thrown 23514 in production."
  - "DEVIATION from plan: existing case 'charge.refunded' arm (Phase 24 D-13 PostHog capture) extended in place rather than replaced. Plan's literal instruction to 'INSERT BEFORE the default: arm' would have created a duplicate case label; instead both behaviors run inside the single arm (PostHog capture first, then claw-back handler)."
  - "Dispute handler uses optional ChargeResolver dependency injection. Production path falls through to stripe.charges.retrieve(); tests inject a stub. Avoids needing a real Stripe API key for unit tests while still supporting the realistic case where dispute.charge arrives as a string ID rather than expanded."
  - "D-04 preserved: charge-dispute-created.ts does NOT touch affiliates.frozen_at. Explicit test gate (regex audit of source file) catches future drift."

patterns-established:
  - "Status-enum widening migration co-shipped with the plan that needs it — caught by live-DB check, not by plan author. Future plans introducing new enum/status values should run `\\dt` / check-constraint inspection at the same time as adding the SQL."

requirements-completed:
  - AFFTIER-04

# Metrics
duration: ~45min
completed: 2026-05-18T20:16:48Z
---

# Phase 26 Plan 26-07: Stripe refund + dispute claw-back

**Stripe charge.refunded and charge.dispute.created webhooks now reverse affiliate commission via payouts.adjustments ledger entries; disputes also emit a fraud_signals row for superadmin review (D-06 + D-04).**

## Performance

- **Duration:** ~45 minutes
- **Started:** 2026-05-18T19:32:00Z (Plan 26-07 task pickup)
- **Completed:** 2026-05-18T20:16:48Z
- **Tasks:** 7 (1 schema deviation + 2 handlers + 1 dispatcher edit + 1 test/commit + 1 deploy + 1 HUMAN-UAT + this summary)
- **Files modified:** 6 (5 new + 1 modified)

## Accomplishments

- AFFTIER-04 closed: refunds and disputes both transition the affected conversion to `clawback_pending` and append a negative-amount AdjustmentEntry to the most-recent payout's `adjustments` jsonb.
- Chargebacks additionally land a structured `affiliate_fraud_signals` row (signal_type='chargeback', PII-safe payload) that surfaces in the Plan 26-05 Anomaly Review tab. No auto-freeze — superadmin decides.
- Idempotency continues to ride on the dispatcher's `subscription_events.event_id UNIQUE` gate (Phase 14 carry-forward); handlers do not re-check.
- 73/73 stripe-webhook deno tests pass after integration — no regression in signature verification, Phase 14 dispatcher fixtures, or Phase 24 PostHog capture.

## Task Commits

1. **Migration: widen affiliate_conversions.status to include 'clawback_pending'** — included in `4c41005`
2. **Handler: charge-refunded.ts + 5 deno tests** — included in `4c41005`
3. **Handler: charge-dispute-created.ts + 7 deno tests** — included in `4c41005`
4. **Dispatcher: lazy import + new 'charge.dispute.created' arm + extended 'charge.refunded' arm** — included in `4c41005`

All ship in a single atomic commit (`4c41005`) since the dispatcher refactor depends on both handlers existing and the constraint widening must land before the handlers can run in production.

## Files Created/Modified

- `supabase/migrations/20270701000013_affiliate_conversions_clawback_pending_status.sql` — DROPs the old Phase 19 status CHECK and ADDs a widened version that includes `clawback_pending`. Pushed --linked before the handlers go live.
- `supabase/functions/stripe-webhook/events/charge-refunded.ts` — resolves charge → affiliate_conversion via existing invoice_id column; sets status='clawback_pending'; appends `{type:'refund', amount_cents: -refunded}` to payouts.adjustments. No-ops when invoice missing or no matching conversion. PHI-clean (grep-audited).
- `supabase/functions/stripe-webhook/events/charge-refunded.test.ts` — 5 cases including PHI-keyword grep, no-invoice no-op, missing-conversion no-op, append path with mock payout, and no-payout deferral.
- `supabase/functions/stripe-webhook/events/charge-dispute-created.ts` — same claw-back path with `{type:'chargeback'}` + INSERTs an `affiliate_fraud_signals` row. Uses injectable `ChargeResolver` to handle Stripe's string-only `dispute.charge` payload. Explicit D-04 audit: no `frozen_at` write.
- `supabase/functions/stripe-webhook/events/charge-dispute-created.test.ts` — 7 cases including resolver-null, missing invoice, missing conversion, full claw-back+fraud path, D-04 frozen_at regex audit, PHI-clean audit.
- `supabase/functions/stripe-webhook/index.ts` — adds 2 lazy imports; extends `case 'charge.refunded'` to run the Phase 24 PostHog capture AND the new claw-back handler; adds new `case 'charge.dispute.created'` arm.

## Verification

| Gate | Status |
|------|--------|
| Schema: 12 Phase 26 columns + 2 tables + 3 cron jobs + 3 triggers + 8 RPCs live | ✅ pre-existed |
| Schema: `status` CHECK constraint includes 'clawback_pending' | ✅ migration 13 applied |
| `case 'charge.refunded'` arm dispatches to new handler | ✅ index.ts:208 + lazy import line ~129 |
| `case 'charge.dispute.created'` arm present | ✅ index.ts:215 |
| `charge-dispute-created.ts` never references `frozen_at` (D-04) | ✅ grep audit + unit test |
| No PHI keywords (patient/medication/diagnosis/dose/lab) in either handler | ✅ regex audit unit tests pass |
| `deno check` clean on all 3 modified files | ✅ |
| Full stripe-webhook deno test suite | ✅ 73/73 pass |
| Edge Fn redeploy: stripe-webhook | ✅ deployed (script size 3.619MB, ytnsipxxmzgaebkqmokp) |
| Edge Fn redeploy: affiliate-attribute | ✅ deployed (script size 710.4kB) |
| Edge Fn redeploy: affiliate-lifetime-recurring | ✅ no-change (already current) |
| Edge Fn redeploy: affiliate-anomaly-sla-reminder | ✅ no-change (already current) |
| HUMAN-UAT: Stripe webhook endpoint subscribed to charge.refunded + charge.dispute.created | ✅ user confirmed 2026-05-18 |

## Outstanding follow-ups

None. Plan 26-07 closes Phase 26 — all 7/7 plans now have SUMMARYs.

Recommended next-cycle smoke (not blocking):
```bash
# After your next live refund or dispute, verify a row landed:
npx supabase db query --linked --output json \
  "select id, status, updated_at from affiliate_conversions where status='clawback_pending' order by updated_at desc limit 5;"
npx supabase db query --linked --output json \
  "select count(*) from affiliate_fraud_signals where signal_type='chargeback';"
```
