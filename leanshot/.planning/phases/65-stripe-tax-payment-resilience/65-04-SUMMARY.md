---
phase: 65-stripe-tax-payment-resilience
plan: 04
subsystem: stripe-webhook
tags: [stripe, dunning, tax, webhook, PAY-07, PAY-03, PAY-01]
type: execute
wave: 2
requirements_completed: [PAY-03, PAY-07]
dependency_graph:
  requires:
    - "65-01: subscriptions.dunning_state column + last_dunning_email_at column"
    - "65-01: tax_collection_log table"
    - "65-01: org_subscriptions.tax_id column"
  provides:
    - "Dunning state machine TS-level transitions on Stripe webhook events"
    - "writeTaxCollectionLog shared helper for audit-log inserts"
    - "B2B clinic tax_id mirror from Stripe → org_subscriptions"
  affects:
    - "65-05 (dunning orchestrator cron — reads dunning_state + last_dunning_email_at)"
    - "65-08 (tax_nexus_state_revenue matview — aggregates tax_collection_log rows)"
tech-stack:
  added: []
  patterns:
    - "TS-level state-machine transitions (NOT Postgres RPC/trigger) for testability"
    - "service_role admin client — no SECDEF RPC, no auth.uid()"
    - "Audit-log writes wrapped in try/catch — never fail the webhook (T-65-04-04)"
    - "PII guard: tax_id value never logged; only tax_id_set:true/false"
key-files:
  created:
    - "supabase/functions/stripe-webhook/events/tax-collection-log.ts"
  modified:
    - "supabase/functions/stripe-webhook/events/invoice-payment-failed.ts"
    - "supabase/functions/stripe-webhook/events/invoice-payment-failed.test.ts"
    - "supabase/functions/stripe-webhook/events/subscription-updated.ts"
    - "supabase/functions/stripe-webhook/events/subscription-updated.test.ts"
    - "supabase/functions/stripe-webhook/events/checkout-session-completed.ts"
    - "supabase/functions/stripe-webhook/events/checkout-session-completed.test.ts"
decisions:
  - "Dunning transitions live in TypeScript (not RPC/trigger) — testable + observable + service-role safe"
  - "cancelled_for_payment is set ONLY in subscription-updated.ts (canceled + prior failed dunning) — never on payment_failed"
  - "tax_id mirror uses .update(tax_id).eq('org_id', clinic_id) — Phase 28 org_subscriptions PK is uuid org_id"
  - "writeTaxCollectionLog does plain INSERT — dedup is upstream subscription_events.event_id PK gate"
  - "Audit-log + tax_id mirror failures NEVER fail the webhook (T-65-04-04 accept disposition)"
metrics:
  duration: "~30 min"
  completed: "2026-05-26"
  tasks_completed: 2
  files_changed: 7
  tests_added: 17
  tests_passing: 47
---

# Phase 65 Plan 04: Stripe Webhook Tax + Dunning Wiring Summary

**One-liner:** Extends `stripe-webhook` event handlers so `invoice.payment_failed` advances the dunning state machine, `customer.subscription.updated` records `cancelled_for_payment` on Stripe-driven cancels, and `checkout.session.completed` mirrors B2B `tax_id` to `org_subscriptions` plus audits every Stripe Tax calculation to `tax_collection_log`.

## What Shipped

### Task 1 — Dunning state machine (PAY-07)

**`invoice-payment-failed.ts`**:
- Added SELECT-then-compute-then-UPDATE flow: read current `dunning_state`, compute next per the transition table, write patch with `ux_tier='past_due'` + `status='past_due'` + (when advancing) `dunning_state=<next>` + `last_dunning_email_at=null`.
- Transition table (CONTEXT.md D-07):
  - `null` / `'none'` → `'first_failed'`
  - `'first_failed'` → `'second_failed'`
  - `'second_failed'` → `'final_warning'`
  - `'final_warning'` → stays (terminal-warning; never skips)
  - `'cancelled_for_payment'` → stays (terminal)
- `last_dunning_email_at=null` signals the orchestrator cron (Plan 65-05) that the next email is owed.
- Cites `[[reference_rpc_auth_uid_vs_service_role_mismatch]]` in header — handler uses service_role; no SECDEF RPCs.

**`subscription-updated.ts`**:
- Extended the existing prev-row SELECT to also fetch `dunning_state`.
- When `subscription.status === 'canceled'` AND prior `dunning_state IN ('first_failed','second_failed','final_warning')` → write `dunning_state='cancelled_for_payment'`.
- User-initiated cancels (prior `null`/`'none'`) do NOT touch `dunning_state` — Phase 40 save-offer flow owns that path.
- Dunning UPDATE is its own statement, separate from the pause-mirror UPDATE — non-fatal on error (Stripe retries would amplify).

**Tests added (12 new):**
- `invoice-payment-failed.test.ts`: 65-T1, 65-T1b, 65-T2, 65-T3, 65-T4, 65-T5, 65-T6 (advance, terminal-warning hold, cancelled-terminal no-op, last_dunning_email_at=null on advance, plus pre-existing 2.16/2.17/2.17b)
- `subscription-updated.test.ts`: 65-T7, 65-T8, 65-T9 (canceled + final_warning → cancelled_for_payment; canceled + null → untouched; canceled + first_failed → cancelled_for_payment)
- Extended mock admin builders to support `.select().eq().maybeSingle()` chain.

### Task 2 — tax_id mirror + tax_collection_log audit (PAY-03 + PAY-01)

**New file `tax-collection-log.ts`**:
- Exports `writeTaxCollectionLog(admin, session): Promise<void>`.
- Gates on `session.automatic_tax?.status` — silent no-op otherwise (legacy / payment-mode flows).
- Resolves `subscription_id` (text, from `session.subscription`) for web/lifetime OR `org_subscription_id` (uuid, from `subscription_data.metadata.clinic_id`) for clinic.
- Computes `tax_rate_percent` = `(amount_tax / amount_subtotal) * 100` rounded to 3 decimals; NULL when subtotal=0.
- Normalizes `automatic_tax.status` to schema enum (`complete | requires_location_inputs | failed`); unknowns → `failed`.
- Plain INSERT — dedup is the upstream `subscription_events.event_id` PK gate documented in handler header.
- PII-safe error logs (`session_id`, `status`, `state_set`, `error_message`, `error_code`) — never raw amounts; Stripe is canonical.

**`checkout-session-completed.ts`**:
- Added `import { writeTaxCollectionLog } from './tax-collection-log.ts'`.
- After the existing tier-dispatch (web/clinic/lifetime/throw), runs two NEW best-effort blocks:
  1. **tax_id mirror (clinic only)**: when `customer_tax_ids` has length ≥ 1 AND `clinic_id` resolvable, write `org_subscriptions.tax_id = customer_tax_ids[0].value` keyed by `org_id` (uuid, matches `clinic_id`). Only logs `{clinic_id, tax_id_set: true, tax_id_type}` — VALUE never logged (T-65-04-02).
  2. **tax_collection_log audit**: unconditional `writeTaxCollectionLog(admin, session)` call (helper self-gates).
- Both blocks wrapped in try/catch — failures logged but never re-thrown (T-65-04-04 accept disposition).

**Tests added (8 new on checkout-session-completed.test.ts):**
- 65-T10: clinic + `customer_tax_ids` → `org_subscriptions.tax_id` update keyed by `org_id`
- 65-T11: consumer/web → no `org_subscriptions` touch
- 65-T12: clinic + empty `customer_tax_ids` → no `org_subscriptions` touch
- 65-T13: `automatic_tax.status='complete'` → `tax_collection_log` insert with full breakdown
- 65-T14: `automatic_tax.status='requires_location_inputs'` → still inserts (visibility)
- 65-T15: no `automatic_tax` field → no `tax_collection_log` row
- 65-T16: T-65-04-02 PII guard — captures all `console.log/error/warn`, asserts raw `tax_id` value NEVER appears
- 65-T17: `writeTaxCollectionLog` helper exists and works as standalone unit

## Commits

| Hash | Type | Description |
|------|------|-------------|
| 4122afb5 | test | Add failing tests for dunning state machine (RED) |
| 735d475f | feat | Implement PAY-07 dunning state machine (GREEN) |
| 875604a1 | test | Add failing tests for tax_id mirror + audit log (RED) |
| 5a95644b | feat | Implement PAY-03 tax_id mirror + PAY-01 tax_collection_log audit (GREEN) |

## Verification

```text
$ $HOME/.deno/bin/deno test --no-check --allow-env --allow-net \
    supabase/functions/stripe-webhook/events/invoice-payment-failed.test.ts \
    supabase/functions/stripe-webhook/events/subscription-updated.test.ts \
    supabase/functions/stripe-webhook/events/checkout-session-completed.test.ts
ok | 47 passed | 0 failed (391ms)
```

Grep gates from PLAN.md `<verification>`:
- `grep -c "dunning_state" invoice-payment-failed.ts` = **5** (≥ 3 required)
- `grep -c "cancelled_for_payment" subscription-updated.ts` = **8** (≥ 1 required)
- `grep -c "writeTaxCollectionLog\|tax_id" checkout-session-completed.ts` = **20** (≥ 2 required)
- New file `tax-collection-log.ts` exists; exports `writeTaxCollectionLog` at line 49
- PII leak grep clean — no raw `tax_id` value reaches `console.log`

## Deviations from Plan

**None for Task 1.**

**Task 2 minor adjustments:**

1. **`org_subscriptions` PK is `org_id` (uuid), not text.**
   The `known_lessons` note in the executor prompt said "org_subscriptions PK = org_id (text)" — but the actual migration `20270601100008_org_subscriptions_table.sql` defines `org_id uuid not null primary key references organizations(id)`. The 65-01 migration (`20290104000006_tax_collection_log.sql`) correctly declares `org_subscription_id uuid references org_subscriptions(org_id)`. The `clinic_id` in subscription metadata is a uuid string that matches `org_id`. Handler uses `.eq('org_id', clinic_id)` — works as-is since Postgres parses the string. Recorded here for future-plan reference; no code-level deviation needed.

2. **Test mock buildExtendedMockAdmin (new builder)** — the existing `buildMockAdmin` in checkout-session-completed.test.ts did not differentiate `update` from `upsert`. Added a parallel `buildExtendedMockAdmin` returning typed `AdminCall[]` with explicit `op: 'upsert'|'update'|'insert'`. This is additive — pre-existing tests still use the old builder unchanged.

## Threat Surface — Mitigations Applied

| Threat | Status | Mitigation |
|--------|--------|------------|
| T-65-04-01 (Tampering on dunning advance) | mitigate | SELECT-then-compute-then-UPDATE in one handler invocation; concurrent invocations protected by upstream subscription_events.event_id PK (validated by Plan 65-02 burst test) |
| T-65-04-02 (Info Disclosure: tax_id in logs) | mitigate | Test 65-T16 actively captures all console output and asserts raw tax_id never appears. Handler logs only `tax_id_set: true/false` + `tax_id_type` |
| T-65-04-03 (Repudiation: tax calc audit gap) | mitigate | writeTaxCollectionLog called unconditionally after subscription mapping; covers `complete` AND `requires_location_inputs` for visibility |
| T-65-04-04 (DoS: audit-log failure) | accept | Both new write paths wrapped in try/catch; never re-thrown; subscription mapping unaffected; webhook returns 200 |

## Known Stubs

None.

## Threat Flags

None — all writes go to tables already covered by 65-01 threat model.

## Notes for Downstream Plans

- **65-05 (dunning orchestrator cron)**: reads `subscriptions WHERE dunning_state IS NOT NULL AND dunning_state NOT IN ('none','cancelled_for_payment') AND last_dunning_email_at IS NULL` (the partial index `idx_subscriptions_dunning_state` from 65-01 covers this exact predicate). The `last_dunning_email_at=null` write on every transition is the orchestrator's pick-up signal.
- **65-08 (tax nexus matview)**: aggregates `tax_collection_log` rows by `customer_state`. The `idx_tax_collection_log_state_created_at` partial index from 65-01 supports this rollup. Every checkout with Stripe Tax engaged now produces a row.
- **No new env vars** required by this plan; relies on existing `STRIPE_PRICE_CLINIC_BASE` only via metadata path (no env read added).

## Self-Check: PASSED

- `supabase/functions/stripe-webhook/events/tax-collection-log.ts` — FOUND
- `supabase/functions/stripe-webhook/events/invoice-payment-failed.ts` — modified, FOUND
- `supabase/functions/stripe-webhook/events/subscription-updated.ts` — modified, FOUND
- `supabase/functions/stripe-webhook/events/checkout-session-completed.ts` — modified, FOUND
- Commits 4122afb5, 735d475f, 875604a1, 5a95644b — all FOUND in `git log`
- 47/47 tests passing via deno
