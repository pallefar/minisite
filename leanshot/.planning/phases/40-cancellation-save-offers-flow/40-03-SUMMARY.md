---
phase: 40
plan: "03"
title: "Edge Fns — cancellation-decide-offer + cancellation-accept-offer"
subsystem: cancellation-save-offers
tags: [edge-fn, stripe, anti-gaming, coupon-stacking, pause, deno]
requirements: [POLISH-01, POLISH-03, POLISH-04]

dependency_graph:
  requires:
    - "40-01 (cancellation_offers_log table + save_offer_rules + coupon seed)"
  provides:
    - "POST /functions/v1/cancellation-decide-offer — offer lookup + anti-gaming"
    - "POST /functions/v1/cancellation-accept-offer — Stripe write dispatch"
  affects:
    - "40-04 (cancellation modal — thin client; calls these two Fns)"
    - "40-06 (ROI dashboard — reads cancellation_offers_log)"

tech_stack:
  added:
    - "Stripe@19 (esm.sh, apiVersion 2026-04-22.dahlia) — pause_collection + discounts[] + trial_end + items mutations"
    - "Deno test (--no-check) — 58+25 tests across both Fns"
  patterns:
    - "2-row append pattern (PATTERNS §6 option (a)) — offered row + accepted row linked by (user_id, rule_id, offered_at)"
    - "JWT-auth user-bearer pattern (helpdesk-ai-assist analog)"
    - "Lazy admin client (makeLazyAdmin) + lazy Stripe client (setStripeForTest seam)"
    - "A5 trial-pause graceful path: PAUSE_FAILED:{code} propagated to client"
    - "D-15 clamp at decide-time; accept-time receives already-clamped coupon_id"

key_files:
  created:
    - supabase/functions/_shared/cancellation-types.ts
    - supabase/functions/cancellation-decide-offer/index.ts
    - supabase/functions/cancellation-decide-offer/anti-gaming.ts
    - supabase/functions/cancellation-decide-offer/resolve-rule.ts
    - supabase/functions/cancellation-decide-offer/anti-gaming.test.ts
    - supabase/functions/cancellation-decide-offer/resolve-rule.test.ts
    - supabase/functions/cancellation-decide-offer/index.test.ts
    - supabase/functions/cancellation-decide-offer/clinic-fork.test.ts
    - supabase/functions/cancellation-decide-offer/log-insert.test.ts
    - supabase/functions/cancellation-decide-offer/deno.json
    - supabase/functions/cancellation-accept-offer/index.ts
    - supabase/functions/cancellation-accept-offer/apply-pause.ts
    - supabase/functions/cancellation-accept-offer/apply-discount.ts
    - supabase/functions/cancellation-accept-offer/extend-pause.ts
    - supabase/functions/cancellation-accept-offer/apply-extended-trial.ts
    - supabase/functions/cancellation-accept-offer/apply-downgrade.ts
    - supabase/functions/cancellation-accept-offer/apply-pause.test.ts
    - supabase/functions/cancellation-accept-offer/apply-discount.test.ts
    - supabase/functions/cancellation-accept-offer/extend-pause-counter.test.ts
    - supabase/functions/cancellation-accept-offer/index.test.ts
    - supabase/functions/cancellation-accept-offer/deno.json
  modified: []

decisions:
  - "D-15 clamp at decide-time (not accept-time): accept-offer receives already-clamped coupon_id from decide-offer; no Stripe discount read at accept-time"
  - "Catalog coupon selection under clamp: when clampSavePct returns a non-catalog percent, decide-offer picks the CLOSEST catalog coupon ≤ finalSavePct (largest-under-clamp). E.g., 27.78% → SAVE-25-{N}MO. Clamp can only reduce, never raise above cap."
  - "2-row append link: NO offered_log_id FK in 40-01 schema. Link is by (user_id, rule_id, offered_at) tuple for admin ROI dashboard — documented in index.ts header."
  - "cohort_membership matview (A6): accessed in resolve-rule.ts via EXISTS subquery on cohort_membership WHERE user_id + cohort_id. Shape assumed: (user_id uuid, cohort_id uuid)."
  - "D-10 extension detection: accept-offer retrieves Stripe subscription to check pause_collection.resumes_at presence. If paused, treat as extension (counter increments). Race condition (pause expired between check + extend) handled: falls back to applyPause."
  - "A5 trial-pause: test files verify PAUSE_FAILED:{code} error propagation; client receives 500 with error code for toast message."

metrics:
  duration: "~35 minutes (Task 1 prior agent: ~30min; Task 2 this agent: ~5min)"
  completed: "2026-05-21"
  tasks_completed: 2
  tasks_total: 2
  files_created: 21
  test_count: 83
---

# Phase 40 Plan 03: Edge Fns — cancellation-decide-offer + cancellation-accept-offer — Summary

**One-liner:** JWT-auth decide (lookup-only, D-01..D-04/D-15/D-18/D-19 enforced) + accept (Stripe write dispatch with discounts[] append, D-06/D-10/D-14 implemented, 2-row log) split into two Fns for sub-100ms decide latency.

---

## Task 1: Shared types + cancellation-decide-offer Fn (commit `d32025c`)

**Committed by prior executor session (cherry-picked from worktree-agent-a8cfa2ee3806151bc commit `94369b8`).**

Files created:
- `supabase/functions/_shared/cancellation-types.ts` — Deno-side type contracts (single writer)
- `supabase/functions/cancellation-decide-offer/anti-gaming.ts` — clampSavePct, checkLifetimeCap, checkCooldown, applyTenureGate; STACKING_CAP_EFFECTIVE=0.35
- `supabase/functions/cancellation-decide-offer/resolve-rule.ts` — priority-ordered rule lookup with cohort_membership check
- `supabase/functions/cancellation-decide-offer/index.ts` — decide Fn (512 lines); 1 Stripe retrieve for D-15 stacking check only; NO subscriptions.update
- 5 test files: 58 tests green

D-15 clamp resolution in decide-offer: when `clamped=true`, decide-offer selects the CLOSEST catalog coupon ≤ finalSavePct from the fixed 6-coupon catalog (SAVE-20/25/30 × 2/3MO). E.g., 10% affiliate + 30% offer → effective 37% → clamped to 35% → finalSavePct=27.78% → SAVE-25-{N}MO selected (25% ≤ 27.78%).

---

## Task 2: cancellation-accept-offer Fn (commit `fc57c7d`)

Files created:
- `supabase/functions/cancellation-accept-offer/index.ts` — JWT-auth; ownership gate (user_id + status='offered' filter); D-10 extension detection; A5 trial-pause error path; 2-row append log insert
- `supabase/functions/cancellation-accept-offer/apply-pause.ts` — pause_collection{behavior:'void',resumes_at} per RESEARCH 736-756
- `supabase/functions/cancellation-accept-offer/apply-discount.ts` — discounts[] array APPEND (D-14); A1 dual-shape handling (coupon as string OR Coupon object); NEVER singular coupon-field overwrite (Pitfall 2 / T-40-03-08)
- `supabase/functions/cancellation-accept-offer/extend-pause.ts` — D-10 resumes_at extension; throws SUB_NOT_PAUSED guard
- `supabase/functions/cancellation-accept-offer/apply-extended-trial.ts` — trial_end extension + proration_behavior:none
- `supabase/functions/cancellation-accept-offer/apply-downgrade.ts` — Annual → Monthly item-swap; proration_behavior:none; billing_cycle_anchor:'now'
- 4 test files: 25 tests green

**A5 trial-pause** test fixtures verify: `applyPause` wraps Stripe rejection as `PAUSE_FAILED:{code}`; index.ts catches it, fires Sentry, returns 500 without writing an accepted log row (client retries with discount fallback per 40-04 plan).

---

## Verification Results

| Check | Result |
|-------|--------|
| Task 1: Deno tests (5 files, 58 tests) | Green |
| Task 2: Deno tests (4 files, 25 tests) | Green |
| Singular `discount:` grep gate | 0 matches |
| `discounts: [` array usage in apply-discount.ts | 2 matches |
| Stripe import `esm.sh/stripe@19` | 6 source files |
| `apiVersion: '2026-04-22.dahlia'` | present in index.ts |
| `shutdownPostHog` in finally | present |
| No SUPABASE_SERVICE_ROLE_KEY reads (JWT auth only) | confirmed |
| `subscriptions.update` NOT in decide-offer (lookup-only) | 0 matches |
| `clampSavePct` NOT in accept-offer (clamp is decide-side) | 0 matches |

---

## Deviations from Plan

### Cherry-pick of Task 1

**Found during:** Startup branch verification

**Issue:** This executor was spawned on branch `worktree-agent-afe9c25759ef2fdc2` which did not contain Task 1 commits (those were on `worktree-agent-a8cfa2ee3806151bc`). The expected base commit `94369b8` was accessible in the main repo but not reachable from this worktree branch.

**Fix:** Cherry-picked commit `94369b8` → landed as `d32025c` on this branch. All Task 1 files verified present before Task 2 execution.

**Impact:** None — same code, different commit hash on this branch.

---

## Known Stubs

None — no hardcoded empty values or placeholder data flows to UI rendering. `posthog_variant_id` is stored as NULL in log rows (per plan: "NULL for v1.3 cold-start — 40-06 wires Ship-Winner"). This is documented behavior, not a stub.

---

## Threat Flags

No new trust boundaries introduced beyond what is in the plan's `<threat_model>`. All T-40-03-01..T-40-03-09 mitigations implemented as designed.

---

## Self-Check: PASSED

All 11 key files present. Both task commits verified in git log:
- Task 1: `d32025c` (cherry-picked from `94369b8`)
- Task 2: `fc57c7d`
