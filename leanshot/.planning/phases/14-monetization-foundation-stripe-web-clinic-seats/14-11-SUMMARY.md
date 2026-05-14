---
phase: 14-monetization-foundation-stripe-web-clinic-seats
plan: 11
subsystem: billing/testing
tags: [test-hygiene, e2e, stripe-sdk-pin, sql-test, billing-correctness, gap-closure]

dependency_graph:
  requires: [14-09, 14-10]
  provides: [cr-03-closed, wr-09-closed, cr-05-closed, cr-06-closed]
  affects: [leanshot/package.json, leanshot/e2e/clinic-metered-billing.spec.ts, leanshot/tests/sql/count-active-patients.test.sql, supabase/migrations/20260601000019_stripe_subscriptions.sql]

tech_stack:
  added: []
  patterns: [stripe-v19-pin, billing-meter-e2e-assertion, sql-cross-arm-test]

key_files:
  created: []
  modified:
    - leanshot/package.json
    - leanshot/package-lock.json
    - leanshot/scripts/stripe-bootstrap.ts
    - leanshot/e2e/clinic-metered-billing.spec.ts
    - leanshot/tests/sql/count-active-patients.test.sql
    - supabase/migrations/20260601000019_stripe_subscriptions.sql

decisions:
  - id: D-14-11-01
    description: "Keep apiVersion casts (as Stripe.LatestApiVersion) — v19 types pin to 2025-10-29.clover, not the 2026-04-22.dahlia runtime version; cast still required"
  - id: D-14-11-02
    description: "medication value in e2e fixture changed to 'ozempic' to match SQL test known-good value; 'tirzepatide' is valid free text but 'ozempic' avoids any ambiguity about test fixtures"
  - id: D-14-11-03
    description: "weights INSERT for v_p6 uses ts column (bigint) set to extract(epoch from now()) — required non-null column per schema"

metrics:
  duration: "~20 minutes"
  completed: "2026-05-14"
  tasks_completed: 4
  files_changed: 6
---

# Phase 14 Plan 11: Gap-Closure (CR-03 / WR-09 / CR-05 / CR-06) Summary

Closes the four remaining Phase 14 gap-closure defects: a Stripe SDK version split, a hollow e2e test that could not prove SC#3, invalid enum values in SQL/e2e fixtures, and a billing counter function bug that could under-bill clinics.

## Completed Tasks

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Repin stripe devDep to ^19.0.0 (CR-03) | `47d4bc2` | package.json, package-lock.json, stripe-bootstrap.ts |
| 2 | Rewrite metered-billing e2e to assert real meter event (WR-09) | `807f229` | e2e/clinic-metered-billing.spec.ts |
| 3 | Fix invalid InjectionSite enum + column drift (CR-05) | `0f51879` | tests/sql/count-active-patients.test.sql, e2e/clinic-metered-billing.spec.ts |
| 4 | Remove misplaced LIMIT 1 + add cross-arm SQL test (CR-06) | `a15ebbf` | supabase/migrations/20260601000019_stripe_subscriptions.sql, tests/sql/count-active-patients.test.sql |

## Gap Closure Confirmation

### CR-03 — Stripe SDK version split (CLOSED)

`leanshot/package.json` devDependency repinned from `^17.7.0` to `^19.0.0`. `npm install` resolved `stripe@19.3.0`. `npm ls stripe --depth=0` confirms `stripe@19.3.0`.

**apiVersion cast status:** The `as Stripe.LatestApiVersion` casts in `stripe-bootstrap.ts`, `seed-subscription.ts`, `stub-webhook.ts`, and `test-clock.ts` are KEPT — v19 types define `LatestApiVersion = typeof ApiVersion` where `ApiVersion = '2025-10-29.clover'`. The project uses `'2026-04-22.dahlia'` at runtime (a header value); the cast bridges the mismatch. tsc is clean with the casts in place.

One stale `eslint-disable-next-line @typescript-eslint/no-explicit-any` directive in `stripe-bootstrap.ts` was removed (the original `as any` was already cleaned up in a prior plan; the disable comment was orphaned). The comment was updated to reference v19.

No v19 SDK signature drift was surfaced by `tsc` — the `stripe.billing.meters.create`, `stripe.billing.meterEvents`, and `stripe.billing.meterEventSummaries.list` calls all type-check cleanly against v19.

### WR-09 — Hollow clinic-metered-billing e2e (CLOSED)

The assertion block (~lines 255-343) was completely replaced:

- `STRIPE_METER_ACTIVE_PATIENTS` env var is now read at the top of the file, separate from `HAS_LIVE`.
- A `test.skip(true, 'STRIPE_METER_ACTIVE_PATIENTS not set — cannot assert overage meter event')` is placed INSIDE the test body, AFTER the webhook fires (adjacent to the `!STRIPE_METER_ACTIVE_PATIENTS` conditional, not at describe-level).
- `expect([200, 202]).toContain(webhookResp.status)` — webhook non-2xx is now a hard failure.
- `stripe.billing.meterEventSummaries.list(STRIPE_METER_ACTIVE_PATIENTS, { customer, start_time, end_time })` asserts `aggregated_value === 1` (11 active − 10 included = 1 overage).
- If the Stripe call throws (meter not configured on account), the test skip-not-passes.
- `'mtr_test_placeholder'` — gone. `webhookResp.status === 200` escape hatch — gone. `retrieveUpcoming` fallback — gone.

SC#3 (MONEY-05: "11 active patients → overage=1") is now actually provable when run with live env.

### CR-05 — Invalid InjectionSite enum + injections column drift (CLOSED)

**SQL test (`count-active-patients.test.sql`):** The single `v_p3` row at line 77 had `site = 'abdomen'` (invalid — no bare `'abdomen'` in the `InjectionSite` union). Fixed to `'abdomen-ul'`. The `v_p5` row at line 81 (`'thigh-l'`) was NOT touched — already valid.

**E2e fixture (`clinic-metered-billing.spec.ts` `beforeAll`):** The injection insert was reconciled to the live `injections` schema:
- Added `log_id: crypto.randomUUID()` (PK is `(user_id, log_id)`)
- `dose_unit` → `unit` (the live column name)
- `date: recentDate.slice(0, 10)` → `logged_at: recentDate` (full ISO timestamptz)
- `site: 'abdomen'` → `'thigh-l'` (valid InjectionSite)
- `medication: 'tirzepatide'` → `'ozempic'` (to match SQL test known-good value; `tirzepatide` is valid free text but consistency with the SQL test reduces fixture drift)
- `dose: 2.5` → `'0.5'` (column is text)
- Added `notes: ''`

SQL test verified by inspection (no DB access in worktree; zero bare `'abdomen'` literals confirmed via grep; every site value confirmed against the `InjectionSite` union).

### CR-06 — Misplaced LIMIT 1 in count_active_patients() (CLOSED)

**Migration fix:** Deleted the single `limit 1` line from the 5-arm `UNION ALL` EXISTS subquery inside `count_active_patients()`. The `LIMIT 1` was binding only to the last arm (`symptoms`), not the whole `EXISTS (...)` — making the query intent dishonest and a latent footgun. A comment was added documenting the removal (CR-06).

All 5 `UNION ALL` arms still use `created_at > now() - interval '30 days'` — no column names changed. The Owner-role auth gate, `SECURITY DEFINER`, `set search_path = public, extensions`, `stable`, and `count(distinct m.user_id)::integer` are unchanged.

This migration is UNPUSHED. No `supabase db push` was run. Pushing remains a deferred human verification item.

**SQL test cross-arm coverage:**
- Added `v_p6 uuid` declaration with comment "active + ONLY a weights row → counted (proves cross-arm, CR-06)".
- Added `v_p6` to the active membership VALUES list (alongside P1–P4).
- Added a `public.weights` INSERT for `v_p6` using the live schema columns: `user_id`, `weight_id` (gen_random_uuid()), `date` (to_char(now(), 'YYYY-MM-DD')), `weight` (82.5), `ts` (extract(epoch from now())::bigint). `created_at` defaults to `now()` → recent.
- Expected count bumped 3 → 4: `IF v_count <> 4`, RAISE EXCEPTION message, RAISE NOTICE message.
- Header comment updated: 6 patient memberships, expected = 4.

## Verification Results

- `grep '"stripe":\s*"\^19\.0\.0"' package.json` — MATCHES
- `npm ls stripe --depth=0` — `stripe@19.3.0`
- `npx tsc -b --noEmit` — CLEAN (no errors)
- `! grep "mtr_test_placeholder"` — PASSES
- `! grep "webhookResp.status === 200"` — PASSES
- `grep -c "STRIPE_METER_ACTIVE_PATIENTS"` — 4 occurrences
- `grep -c "aggregated_value"` — 2 occurrences
- `! grep "'abdomen'" count-active-patients.test.sql` — PASSES
- `grep -c "logged_at: recentDate" e2e spec` — 1 (PASSES)
- `! grep "limit 1" 20260601000019_stripe_subscriptions.sql` — PASSES
- `grep -cE "created_at > now() - interval '30 days'" migration` — 5 (all arms)
- `grep -c "public.weights" count-active-patients.test.sql` — 1
- `grep -c "v_count <> 4"` — 1; `! grep "v_count <> 3"` — PASSES
- `npx vitest run` — 809 passed / 11 skipped (matching pre-plan baseline, no regressions)
- `npx playwright test e2e/clinic-metered-billing.spec.ts --list` — 1 test listed, no parse error

## Deviations from Plan

None — plan executed exactly as written.

Note: The `prefer-const` ESLint error on `patientUserIds` (line 76 of the spec) is a pre-existing error that predates this plan — confirmed by checking the file before any changes. It is out-of-scope per the SCOPE BOUNDARY deviation rule. The `npm run lint` script (the plan's lint gate) only lints `src/`, not `e2e/`, so this pre-existing error does not affect the plan's acceptance gates.

## Phase 14 Gap Closure Status

All 6 code gaps are now closed:
- 14-09: CR-01 (subscription store actions missing dispatch) + CR-02 (ux_tier store not updated on webhook)
- 14-10: CR-04 (invoice.upcoming handler missing dunning guard / wrong event name)
- 14-11: CR-03 (Stripe SDK version split) + WR-09 (hollow e2e) + CR-05 (invalid enum + column drift) + CR-06 (misplaced LIMIT 1 — billing correctness)

**Remaining Phase 14 work (human verification checkpoints only):**
- Edge Function deploy (`supabase functions deploy stripe-webhook`)
- Stripe Dashboard webhook registration + invoice.upcoming event subscription
- Bootstrap script live run (`npx tsx scripts/stripe-bootstrap.ts`)
- Portal return-URL allowlist configuration
- **Push migration 20260601000019 — now carries the CR-06 LIMIT 1 fix**

## Self-Check: PASSED

Files created/modified exist:
- `leanshot/package.json` — FOUND (stripe: ^19.0.0)
- `leanshot/e2e/clinic-metered-billing.spec.ts` — FOUND (aggregated_value assertion)
- `leanshot/tests/sql/count-active-patients.test.sql` — FOUND (v_count <> 4)
- `supabase/migrations/20260601000019_stripe_subscriptions.sql` — FOUND (no limit 1)

Commits exist:
- `47d4bc2` — chore(14-11): repin stripe devDependency to ^19.0.0 (CR-03)
- `807f229` — fix(14-11): rewrite clinic-metered-billing spec to assert real overage meter event (WR-09)
- `0f51879` — fix(14-11): fix invalid InjectionSite enum + injections column drift (CR-05)
- `a15ebbf` — fix(14-11): remove misplaced LIMIT 1 from count_active_patients() + add cross-arm SQL test (CR-06)
