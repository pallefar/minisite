---
phase: 29-org-subscriptions-per-patient-metered-billing
plan: "04"
subsystem: payments
tags: [edge-function, cron, stripe, billing, metered, pg_cron, deno]

# Dependency graph
requires:
  - phase: 29-01
    provides: count_active_patients v2 SECDEF function (10-table UNION, service-role bypass)
  - phase: 29-03
    provides: _shared/sentry.ts captureException + captureMessage exports
  - phase: 28
    provides: _createServiceRoleClientUnsafe from _shared/supabase-server.ts; vault.decrypted_secrets service_role_key
  - phase: 14
    provides: clinic_stripe_customers table; Stripe SDK (esm.sh/stripe@19) import pattern

provides:
  - "org-metered-billing-cron Edge Function deployed to ytnsipxxmzgaebkqmokp (ACTIVE)"
  - "pg_cron job p29_org_metered_billing_cron at 0 2 * * * (02:00 UTC daily)"
  - "buildMeterEventPayload + runForOrgs exported functions (testable without Deno.serve)"
  - "5 Deno tests proving: value-as-string, identifier format, D-11 PHI lint, per-org isolation, zero-count firing"
  - "ORG-09 SC#2 metered billing pipeline complete (pending Stripe Meter Dashboard setup — Plan 29-07)"

affects:
  - "29-07 HUMAN-CHECKPOINT: Stripe Meter product active_patient_month must be registered before first live run"
  - "29-verify-work: cron.job_run_details will show p29_org_metered_billing_cron success at 02:00 UTC"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Vendor-gated health check: 503 + Sentry warning when STRIPE_SECRET_KEY missing (no crash)"
    - "Exported inner functions (buildMeterEventPayload, runForOrgs) for Deno unit testing without network"
    - "Per-org try/catch loop: one Stripe failure does not abort the batch"
    - "pg_cron idempotent schedule: DO block unschedules existing job before cron.schedule"
    - "net.http_post via vault.decrypted_secrets service_role_key (same pattern as audit-archive cron)"

key-files:
  created:
    - supabase/functions/org-metered-billing-cron/index.ts
    - supabase/functions/org-metered-billing-cron/deno.json
    - supabase/functions/org-metered-billing-cron/org-metered-billing-cron.test.ts
    - supabase/migrations/20270601200006_org_metered_billing_cron.sql
  modified: []

key-decisions:
  - "Sequential per-org loop (not per-invocation) per RESEARCH Pattern 4: <50 orgs in ~10s, no parallelism needed"
  - "Hardcoded Supabase URL in cron migration (vault has service_role_key but not project_url — matches audit-archive precedent)"
  - "D-11 enforced in buildMeterEventPayload: payload.value=String(count) + payload.stripe_customer_id ONLY"
  - "D-03 idempotency key: org_${clinic_id}_${yyyymm} — Stripe deduplicates re-runs within 24h window"
  - "Deno.serve at module level means tests must use --allow-all (not --allow-net=esm.sh only)"
  - "Stripe product must be pre-configured (HUMAN-CHECKPOINT 29-07 deferred — not a blocker for cron registration)"

patterns-established:
  - "Testable Edge Functions: export core logic (buildMeterEventPayload, runForOrgs); Deno.serve calls them"
  - "Cron migration pattern: DO block idempotency + cron.schedule + vault service_role_key"

requirements-completed: [ORG-09]

# Metrics
duration: 45min
completed: 2026-05-17
---

# Phase 29 Plan 04: Org Metered Billing Cron Summary

**Nightly metered-billing cron Edge Function using Stripe Meter Events 2024 API with per-org active-patient count and idempotency-key deduplication**

## Performance

- **Duration:** ~45 min
- **Started:** 2026-05-17T18:00:00Z
- **Completed:** 2026-05-17T18:45:00Z
- **Tasks:** 3 (Task 1 TDD: 2 commits; Task 2: 1 commit)
- **Files modified:** 4

## Accomplishments

- `org-metered-billing-cron` Edge Function shipped and deployed (status ACTIVE, version 1) to project `ytnsipxxmzgaebkqmokp`
- pg_cron job `p29_org_metered_billing_cron` registered at `0 2 * * *` (02:00 UTC daily), active=true, no slot collision
- 5 Deno tests passing: value-as-string (Pitfall 3), identifier YYYYMM format (D-03), D-11 PHI lint, per-org error isolation, zero-count still fires
- TDD gate honored: RED commit `9e7b7cf` (test file alone) → GREEN commit `9287fe5` (implementation)
- `STRIPE_SECRET_KEY` already in Function Secrets — no new secrets needed

## Task Commits

1. **Task 1 RED: Failing deno tests** - `9e7b7cf` (test)
2. **Task 1 GREEN: Edge Function implementation + deno.json** - `9287fe5` (feat)
3. **Task 2: pg_cron migration + push** - `af79f03` (feat)

## Verification Evidence

### Deno Test Run (5 passed, 0 failed)

```
running 5 tests from ./supabase/functions/org-metered-billing-cron/org-metered-billing-cron.test.ts
value is a string (Pitfall 3) ... ok (0ms)
identifier format = org_${uuid}_YYYYMM ... ok (0ms)
payload contains ONLY value + stripe_customer_id (D-11 PHI lint) ... ok (0ms)
per-org error isolation: one failure does not stop the loop ... ok (0ms)
zero count still fires meter event (back-out prorate) ... ok (0ms)

ok | 5 passed | 0 failed (4ms)
```

### Edge Function Deploy

```
Deployed Functions on project ytnsipxxmzgaebkqmokp: org-metered-billing-cron
Status: ACTIVE | Version: 1 | Updated: 2026-05-17 18:05:55
```

### Cron Job Registration (cron.job probe)

```json
{
  "jobname": "p29_org_metered_billing_cron",
  "schedule": "0 2 * * *",
  "active": true
}
```

Full cron schedule (no collision at 02:00):
- `0 0 1 * *` — affiliate-monthly-payout
- `0 1 * * *` — affiliate-click-baseline-refresh
- `0 2 * * *` — **p29_org_metered_billing_cron** ← (this)
- `0 3 * * *` — audit-archive-nightly
- `0 4 * * *` — p28_org_invites_expiry_purge

## Files Created/Modified

- `supabase/functions/org-metered-billing-cron/index.ts` — Edge Function: loops clinic_stripe_customers, calls count_active_patients RPC, POSTs Stripe Meter Events; exports buildMeterEventPayload + runForOrgs for testing
- `supabase/functions/org-metered-billing-cron/deno.json` — deno task runner config (test: --allow-all)
- `supabase/functions/org-metered-billing-cron/org-metered-billing-cron.test.ts` — 5 Deno tests per plan behavior spec
- `supabase/migrations/20270601200006_org_metered_billing_cron.sql` — idempotent cron.schedule at 02:00 UTC via net.http_post + vault service_role_key

## Decisions Made

- Sequential per-org loop (vs per-invocation pg_cron): 50 orgs × ~200ms = ~10s, well within Edge Function timeout (300s). Simpler to debug, single Sentry span. Upgrade path via per-org pg_cron jobs if scale exceeds 500 orgs (RESEARCH Pattern 4).
- Hardcoded `ytnsipxxmzgaebkqmokp.supabase.co` URL in migration (vault has `service_role_key` but not `project_url` — matches audit-archive precedent at 20270601000032).
- Used `--allow-all` for deno tests (not `--allow-net=esm.sh,jsr.io`) because `Deno.serve` at module level requires local port access even when not being exercised by the test.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Deno test --allow-net flag insufficient**
- **Found during:** Task 1 (GREEN phase first run)
- **Issue:** Plan spec said `--allow-net=esm.sh,jsr.io` but `Deno.serve` at module level requires `--allow-net=0.0.0.0:8000`; tests failed with `NotCapable: Requires net access to "0.0.0.0:8000"`
- **Fix:** Changed deno.json `tasks.test` to use `--allow-all` (same pattern as audit-archive.test.ts)
- **Files modified:** `supabase/functions/org-metered-billing-cron/deno.json`
- **Verification:** All 5 tests pass with `--allow-all`
- **Committed in:** `9287fe5` (Task 1 GREEN commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug)
**Impact on plan:** Minimal — only the test runner flag changed; no behavior change.

## Issues Encountered

None beyond the --allow-net deviation above.

## Known Stubs

None — all values are dynamic (count from DB, clinic_id and stripe_customer_id from DB query, yyyymm from current UTC date).

## Carry-Forward

- **Plan 29-07 HUMAN-CHECKPOINT:** Stripe Dashboard must have a Billing Meter product registered with `event_name: 'active_patient_month'` before the first cron run at 02:00 UTC. Until this is done, cron runs will fail per Stripe with "No such meter" (Assumption A5).
- **Plan 29-verify-work:** Check `cron.job_run_details` for `p29_org_metered_billing_cron` — first live invocation will be at 02:00 UTC next day.

## Risks / Notes

- **A5 Assumption:** Stripe Meter product registration is a prerequisite. The cron and Edge Function are fully deployed; the first successful run depends on the Stripe Dashboard HUMAN-CHECKPOINT (Plan 29-07).
- **T-29-04-03 DoS accepted:** Stripe rate limit (100 RPS) vs sequential <50 orgs: no risk at v1.3 scale. If org count exceeds 500, migrate to per-org pg_cron scheduling (RESEARCH Pattern 4).

## TDD Gate Compliance

- RED gate: `9e7b7cf` — `test(29-04): add failing deno tests for org-metered-billing-cron (RED)` — confirmed failing (Cannot find module index.ts)
- GREEN gate: `9287fe5` — `feat(29-04): org-metered-billing-cron Edge Function implementation (GREEN)` — all 5 tests pass

## Next Phase Readiness

- ORG-09 SC#2 metered billing pipeline complete
- Plan 29-05 (clinic-patient-invite Edge Function) can proceed in parallel — no dependency on 29-04
- Plan 29-07 HUMAN-CHECKPOINT gates first live meter event

---
*Phase: 29-org-subscriptions-per-patient-metered-billing*
*Completed: 2026-05-17*
