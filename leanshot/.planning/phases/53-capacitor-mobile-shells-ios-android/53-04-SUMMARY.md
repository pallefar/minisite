---
phase: 53-capacitor-mobile-shells-ios-android
plan: "04"
subsystem: payments
tags: [revenuecat, supabase, deno, edge-function, webhook, subscriptions, iap, mobile]

# Dependency graph
requires:
  - phase: 16-stripe-revenuecat-subscriptions
    provides: "revenuecat-webhook Edge Fn shipping Bearer+HMAC auth and public.subscriptions mirror (MONEY-06)"
  - phase: 14-stripe-billing
    provides: "canonical public.subscriptions table + subscription_events log"
  - phase: 19-rc-subscriptions-provider
    provides: "idx_subscriptions_user_provider_unique partial index + subscription_events.provider column"
provides:
  - "MOBILE-06 webhook half: RC webhook → public.subscriptions mirror formally owned + verified in Phase 53"
  - "SECRETS-RUNBOOK.md: Phase-70-gated provisioning runbook for REVENUECAT_WEBHOOK_AUTH + REVENUECAT_WEBHOOK_SECRET"
  - "14-test green suite proving auth + HMAC + idempotency + D-04 asymmetry + PII safety contracts hold"
affects:
  - "70-revenuecat-live-iap: must provision REVENUECAT_WEBHOOK_AUTH + REVENUECAT_WEBHOOK_SECRET per runbook + run live UAT"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Fail-soft server secret: HMAC verify skipped + console.warn when secret unset; Bearer alone gates until Phase 70 provisioning"
    - "Canonical mirror model: RC writes INTO Stripe-shared public.subscriptions (provider discriminator), never a parallel table"
    - "Immediate-downgrade asymmetry (D-04): CANCELLATION/EXPIRATION set current_period_end=now() matching Apple UX (not Stripe grace period)"

key-files:
  created:
    - supabase/functions/revenuecat-webhook/SECRETS-RUNBOOK.md
  modified: []

key-decisions:
  - "MOBILE-06 webhook half pre-satisfied by Phase 16-06 (MONEY-06); Phase 53 formally owns + verifies without rebuilding"
  - "REVENUECAT_WEBHOOK_AUTH (required Bearer) + REVENUECAT_WEBHOOK_SECRET (optional HMAC) are both server-only; deferred to Phase 70 for real values + HMAC enforcement"
  - "RC mirror lands in canonical public.subscriptions (provider='revenuecat') — no parallel table created or needed"
  - "D-04 immediate-downgrade asymmetry preserved: CANCELLATION + EXPIRATION set current_period_end=now() (deliberate Apple UX match, regression-tested)"

patterns-established:
  - "Verification-only plan pattern: read + grep-gate + test-run without touching implementation files is valid plan scope when prior phase shipped the Fn"
  - "Phase-N-gated runbook: ship the server-secret runbook in the phase that owns the feature requirement; defer real values to the phase that does live UAT"

requirements-completed: [MOBILE-06]

# Metrics
duration: 15min
completed: 2026-05-25
---

# Phase 53 Plan 04: RevenueCat Webhook Mirror Verification Summary

**14-test green Deno suite + SECRETS-RUNBOOK.md prove the Phase 16 revenuecat-webhook Edge Fn mirrors RC events into canonical public.subscriptions (provider='revenuecat') with Bearer+HMAC auth and D-04 immediate-downgrade; Phase-70-gated secret provisioning documented**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-05-25T11:40:00Z
- **Completed:** 2026-05-25T11:55:00Z
- **Tasks:** 3
- **Files modified:** 1 (created SECRETS-RUNBOOK.md)

## Accomplishments

- Verified 14 Deno tests run green file-targeted (14 passed | 0 failed): auth gate, HMAC verify, idempotency, D-04 dispatcher math, body parsing, PII safety
- Confirmed the existing revenuecat-webhook Edge Fn fully satisfies MOBILE-06 webhook+mirror+secret contract without any code changes — pre-satisfied by Phase 16-06 (MONEY-06)
- Verified exactly one canonical `public.subscriptions` table exists across migrations; zero parallel RC-only subscription tables; `provider CHECK ('stripe','revenuecat')` + `idx_subscriptions_user_provider_unique` + `subscription_events.provider` all present
- Shipped `SECRETS-RUNBOOK.md` documenting `REVENUECAT_WEBHOOK_AUTH` (required Bearer) and `REVENUECAT_WEBHOOK_SECRET` (optional HMAC, fail-soft) as server-only Supabase Function Secrets, Phase-70-gated, with provisioning steps, RC dashboard config, and the public.subscriptions mirror target

## Task Commits

Tasks 1 and 2 are read-only verification — no file changes, no commits.
Task 3 created the only net-new file:

1. **Task 1: Pre-flight verify webhook mirrors into canonical table** - No commit (read-only verification; 14 Deno tests green, all grep gates passed, no implementation gap found)
2. **Task 2: Canonical-model guards + RC provider discriminator** - No commit (read-only grep verification; all 4 gates passed, no migration needed)
3. **Task 3: RevenueCat webhook secret provisioning runbook** - `12020ba4` (docs)

## Files Created/Modified

- `supabase/functions/revenuecat-webhook/SECRETS-RUNBOOK.md` - Phase-70-gated provisioning runbook for REVENUECAT_WEBHOOK_AUTH (required Bearer) and REVENUECAT_WEBHOOK_SECRET (optional HMAC, fail-soft); includes endpoint URL, RC dashboard config steps, mirror target table, idempotency note

## Decisions Made

- MOBILE-06 webhook half was pre-satisfied by Phase 16-06 (MONEY-06): the Edge Fn already implements Bearer+HMAC auth, canonical mirror, idempotency, D-04 asymmetry, and PII safety. Phase 53 ownership is correct — not scope reduction.
- The `REVENUECAT_WEBHOOK_SECRET` (HMAC) and `REVENUECAT_WEBHOOK_AUTH` (Bearer) are explicitly deferred to Phase 70 for real values + HMAC enforcement + live RC-to-mirror UAT. The webhook is fail-soft: HMAC skipped when unset (console.warn), 401 when Bearer absent. This matches the vendor-secret-deferred stance from Phase 52.
- The canonical mirror table is `public.subscriptions` with `provider='revenuecat'`. No parallel table exists or should be created. RC rows share the Stripe-shared table and are discriminated solely by the `provider` column.
- D-04 immediate-downgrade asymmetry (CANCELLATION/EXPIRATION set `current_period_end = now()`) is deliberate and regression-tested — it must not be normalized to Stripe grace-period behavior.
- `.env.example` was NOT touched (owned by 53-02 for VITE_RC_API_KEY_* keys). Server-only webhook secrets are declared only in SECRETS-RUNBOOK.md to preserve zero file overlap with 53-02 in Wave 1.

## Deviations from Plan

None — plan executed exactly as written. No implementation gap was found in the existing webhook Fn; no in-place fix was needed. All verification gates passed on first run.

## Issues Encountered

None.

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes were introduced. The SECRETS-RUNBOOK.md is a documentation file only. All security-relevant surface was pre-existing and covered by the plan's threat model (T-53-10 through T-53-SC).

The grep gate in Task 3's verification confirmed no `VITE_REVENUECAT` or `VITE_RC_WEBHOOK` variable exists in the runbook — server-secret isolation invariant holds.

## Known Stubs

None. The SECRETS-RUNBOOK.md uses `<your-generated-token>` and `<project-ref>` as explicit placeholder markers — these are intentional runbook placeholders, not code stubs. They are resolved at Phase 70 by the operator following the runbook steps.

## User Setup Required

**Phase-70-gated — no action required now.**

At Phase 70, the operator must:
1. Generate a random token and set `REVENUECAT_WEBHOOK_AUTH` via `supabase secrets set`
2. Configure the RC dashboard webhook endpoint with `Authorization: Bearer <token>`
3. Enable HMAC signing in the RC dashboard, copy the secret, and set `REVENUECAT_WEBHOOK_SECRET`
4. Run live RC-to-mirror UAT to confirm subscription events land in `public.subscriptions`

See `supabase/functions/revenuecat-webhook/SECRETS-RUNBOOK.md` for the complete provisioning recipe.

## Next Phase Readiness

- MOBILE-06 webhook half is fully owned and verified within Phase 53
- 53-02 (RC client SDK stubs) and 53-04 (webhook verification) together cover all of MOBILE-06 for Phase 53
- Phase 70 receives a clean handoff: runbook-guided provisioning + live UAT are the only remaining items
- No blockers or concerns

---
*Phase: 53-capacitor-mobile-shells-ios-android*
*Completed: 2026-05-25*
