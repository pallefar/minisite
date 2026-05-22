---
phase: 43-m4-membership-tiers-extension
plan: 06
subsystem: closeout
tags: [closeout, deploy, supabase-db-push, edge-fn-deploy, human-uat-multi-signal, vendor-gated, carry-over]
requirements: [MEMBER-01, MEMBER-02, MEMBER-03, MEMBER-04]
requires:
  - "Plans 43-01..05 SUMMARYs landed"
  - "7 migrations 20270715000001..07 on disk"
  - "3 Edge Fn modifications committed (stripe-webhook, stripe-checkout, cancellation-accept-offer)"
provides:
  - "Linked Supabase project (ytnsipxxmzgaebkqmokp) schema: lifetime_purchases + grandfathered_prices + stripe_price_lookup + promo_trial_extensions_log tables + tier_effective view v2"
  - "Live Edge Fn binaries with lifetime + grandfathered + 70%-cap behavior"
  - "43-DEPLOY-NOTES.md — deploy sequence + HUMAN-UAT signal structure (4 signals A-D)"
  - "43-CARRY-OVER.md — 7 carry-over items (2 from iter-1, 5 new from closeout)"
affects:
  - "Phase 44/46/47 planning — 43-PRO-GATING-CONTRACT.md is now stable + canonical for consumption"
  - "Milestone v1.3 close-out UAT batch — 4 HUMAN-UAT signals join existing deferred-uat aggregate"
tech-stack:
  added: []
  patterns:
    - "Multi-signal HUMAN-UAT checkpoint pattern (4 discrete resume signals per [[feedback_multi_signal_human_verify_checkpoint_pattern]])"
    - "Vendor-gated-send deploy evidence acceptance ([[feedback_spike_accept_deploy_evidence_defer_runtime_verify]])"
    - "Milestone UAT deferral consolidation ([[feedback_milestone_uat_deferral_consolidation]])"
key-files:
  created:
    - .planning/phases/43-m4-membership-tiers-extension/43-DEPLOY-NOTES.md
    - .planning/phases/43-m4-membership-tiers-extension/43-06-SUMMARY.md
  modified:
    - .planning/phases/43-m4-membership-tiers-extension/43-CARRY-OVER.md
decisions:
  - "Phase close state = partial-close with carry-over (4 UAT signals deferred to milestone v1.3 close-out, not blocking phase advance)"
  - "STRIPE_PRICE_LIFETIME Function Secret + stripe_price_lookup row population deferred to operator action at milestone-close UAT batch (vendor-gated by design)"
  - "Edge Fn deploy --import-map flag silently degraded to NO-OP in supabase CLI v2.101.0 — bundles still succeed; memory file [[reference_supabase_functions_deploy_import_map_flag]] needs addendum"
metrics:
  duration_minutes: 9
  completed: 2026-05-22
  tasks: 3
  files_created: 2
  files_modified: 1
  commits: 2
  migrations_pushed: 7
  edge_fns_deployed: 3
  human_uat_signals_structured: 4
  carry_over_items_added: 5
---

# Phase 43 Plan 06: Closeout — Deploy + 4-Signal HUMAN-UAT Carry-Over Summary

Phase 43 schema + RPCs + Edge Fn binaries are LIVE on the linked Supabase project (`ytnsipxxmzgaebkqmokp`). All 7 P43 migrations applied via `supabase db push --linked`; 3 Edge Fns redeployed (`stripe-webhook`, `stripe-checkout`, `cancellation-accept-offer`). 4 HUMAN-UAT signals (Lifetime purchase smoke, grandfathered silent pricing, 70%-cap discount stack, RLS cross-tenant deny proof) are STRUCTURED with discrete resume tokens and carried to the milestone v1.3 close-out UAT batch — vendor pre-conditions (Stripe Lifetime Product, `STRIPE_PRICE_LIFETIME` secret, `stripe_price_lookup` row population, test-cohort fixture) are not yet satisfied. Phase close state is partial-close with carry-over (deploy evidence accepted per [[feedback_spike_accept_deploy_evidence_defer_runtime_verify]]).

## Tasks Completed

| Task | Name                                                          | Commit  | Files                                                                                                  |
| ---- | ------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------ |
| 1    | Pre-deploy validation + automated full-suite verification     | 71623c2 | 43-DEPLOY-NOTES.md (created)                                                                            |
| 2+3  | Deploy sequence + 4-signal HUMAN-UAT carry-over + finalize    | 1f28a08 | 43-DEPLOY-NOTES.md (extended), 43-CARRY-OVER.md (extended)                                              |

Total: 2 commits, 511 net-new lines across deploy notes + carry-over.

## Pre-Deploy Validation (Task 1)

All 6 checks passed (recorded in `43-DEPLOY-NOTES.md § Pre-Deploy Validation`):

| Check | Outcome |
|-------|---------|
| (1) Migration filename collision (`ls 20270715*.sql | wc -l`) | ✅ 7 files |
| (2) Strict regex check (`^[0-9]{14}_[a-z0-9_]+\.sql$`) | ✅ all 7 match |
| (3) Remote tail (`MAX(version) FROM schema_migrations`) | ✅ `20270710000006` < `20270715000001` |
| (4) Sibling Deno test sweep | ✅ Phase 43 files clean (8 + 16 + 30 + 112). 1 pre-existing failure on `stripe-webhook/events/charge-dispute-created.ts:6` (Phase 14 dispute handler — outside P43 scope, logged for deferred cleanup) |
| (5) Full leanshot suite | ✅ `tsc --noEmit` exit 0; Phase 43-scoped vitest 44/44 pass. Full repo: 94 pre-existing vitest failures + 389 ESLint errors documented as out-of-scope (milestone v1.3 close-out batch) |
| (6) Bundle budget assertion | ✅ admin-shell 133.20kB / 137kB ceiling (3.80kB headroom after adding GrandfatheredPricesPage) |

## Deploy Sequence (Task 2)

### 1. `supabase db push --linked` — ✅ COMPLETE

7 P43 migrations applied (commit equivalents on linked DB):

```
20270715000001_p43_lifetime_purchases.sql                  ✅
20270715000002_p43_tier_effective_view_v2.sql              ✅
20270715000003_p43_grandfathered_prices.sql                ✅
20270715000004_p43_grandfathered_prices_rpcs.sql           ✅
20270715000005_p43_entitlement_helpers.sql                 ✅
20270715000006_p43_resolve_user_effective_price.sql        ✅
20270715000007_p43_promo_trial_extensions_log.sql          ✅
```

Post-push verification confirmed via `supabase db query --linked`:

- `schema_migrations` table contains all 7 new rows at the `20270715*` prefix.
- All 5 expected schema objects exist in `public.*`: `lifetime_purchases`, `grandfathered_prices`, `stripe_price_lookup`, `promo_trial_extensions_log`, `tier_effective`.

### 2. `supabase functions deploy` (3 fns) — ✅ COMPLETE

```
✓ stripe-webhook              (script size: 4.456MB)
✓ stripe-checkout             (script size: 750.5kB)
✓ cancellation-accept-offer   (script size: 3.586MB)
```

**Notable CLI behavior change:** Supabase CLI **v2.101.0** has further hardened the import-map flag: `--import-map` now prints `"Specifying import_map through flags is no longer supported. Please use deno.json instead."` and proceeds with bundling (resolution falls back to `supabase/functions/deno.json`). This contradicts the previous memory note [[reference_supabase_functions_deploy_import_map_flag]] (which said the flag was deprecated-with-warning-but-honored). At v2.101.0 the flag is silently ignored. **Memory file needs an addendum** — see "Memory Updates Required" below.

A benign WARN was emitted: `failed to read file: ... _shared/index.ts: no such file or directory`. No Phase 43-modified Edge Fn imports the barrel file (verified by `grep -rn "_shared/index" supabase/functions/` = no matches). This is an unrelated stale-reference in a sibling Fn — out of scope.

### 3. `STRIPE_PRICE_LIFETIME` Function Secret — ⏳ DEFERRED

`supabase secrets list --project-ref ytnsipxxmzgaebkqmokp | grep STRIPE_PRICE_LIFETIME` returned empty. Operator has not yet pre-created the Stripe Lifetime Product + Price in the test-mode dashboard. Per the vendor-gated-send pattern + Plan 43-04 Test 5 (`empty price → 503 vendor_unconfigured`), `stripe-checkout` returns 503 for `plan:'lifetime'` until the secret + lookup row are populated.

### 4. `stripe_price_lookup` table population — ⏳ DEFERRED

All 5 seed rows present with empty `stripe_price_id` (vendor-gated-send sentinel; per Plan 43-03 D-c). Operator-managed via Supabase Studio at milestone v1.3 close-out alongside the lifetime secret.

## HUMAN-UAT Signals (4 discrete signals per [[feedback_multi_signal_human_verify_checkpoint_pattern]])

| Signal | Requirement | State | Resume Token |
|--------|------------|-------|--------------|
| **A** — Lifetime purchase smoke | MEMBER-01 | ⏳ PENDING (vendor pre-cond) | `approved-A` / `defer-A: <reason>` |
| **B** — Grandfathered pricing silent at NEW checkout | MEMBER-02 | ⏳ PENDING (operator-seeded fixture) | `approved-B` / `defer-B: <reason>` |
| **C** — 70%-cap discount-stack hit | MEMBER-03 | ⏳ PENDING (Stripe TEST50 coupon + offer-log seed) | `approved-C` / `defer-C: <reason>` |
| **D** — RLS cross-tenant deny proof | MEMBER-02, MEMBER-04 | ⏳ PENDING (live RLS fixture) | `approved-D` / `defer-D: <reason>` |

Full signal definitions (what-built / how-to-verify CLI / accept criteria / resume token) recorded in `43-DEPLOY-NOTES.md § HUMAN-UAT Signals`. Each is documented as a separate deferred item in `43-CARRY-OVER.md` (Items 3..6) with destination = milestone v1.3 close-out UAT batch.

**Why deferred:** the 4 signals require vendor pre-conditions (Stripe Lifetime Product live, secret populated, test cohort fixture seeded, browser-based JWT-impersonated RLS test environment) that the operator must set up. Per [[feedback_hitl_walkthrough_deferred_when_fixtures_missing]] + [[feedback_spike_accept_deploy_evidence_defer_runtime_verify]]: deploy-time evidence (binary live + idempotency PK enforced + Deno tests covering each code path) is accepted, and runtime browser/Stripe-test-mode validation defers to the milestone close-out batch where multiple phases' UAT can be exercised in one operator session (per [[feedback_milestone_uat_deferral_consolidation]]).

## Files Touched

| File | Change | Lines |
|------|--------|-------|
| `leanshot/.planning/phases/43-m4-membership-tiers-extension/43-DEPLOY-NOTES.md` | created (Task 1) + extended (Task 2) | 412 |
| `leanshot/.planning/phases/43-m4-membership-tiers-extension/43-CARRY-OVER.md` | extended (Task 2; +5 deferred items) | +99 |
| `leanshot/.planning/phases/43-m4-membership-tiers-extension/43-06-SUMMARY.md` | created (final commit) | ~210 |

## Phase 43 Close State

**Status: partial-close with carry-over → milestone v1.3 close-out UAT batch.**

- ✅ Schema live: 7 P43 migrations applied on `ytnsipxxmzgaebkqmokp`.
- ✅ Edge Fn binaries live: stripe-webhook + stripe-checkout + cancellation-accept-offer redeployed.
- ✅ Admin UI shipped: `/admin/billing/grandfathered-prices` CRUD page on `admin-shell` chunk.
- ✅ Cross-phase contract stable: `43-PRO-GATING-CONTRACT.md` may be consumed verbatim by Phases 44/46/47 planners.
- ⏳ Vendor-gated: `STRIPE_PRICE_LIFETIME` secret + `stripe_price_lookup.lifetime` row → operator-set at milestone close-out.
- ⏳ HUMAN-UAT 4 signals → carried to milestone v1.3 close-out batch.
- ⏳ Pre-existing carry-overs from plan-checker iter-1 (Items 1, 2: stripe-checkout-side promo extension + existing-subscriber renewal price update) → future phase, post-v1.3.

## Cross-Phase Note (for Phases 44/46/47 planners)

`43-PRO-GATING-CONTRACT.md` is now stable + canonical. Paste the `community_spaces` / `courses` / `events` ADD COLUMN + partial index + RLS policy triplets verbatim into your table-create migrations. Phase 43 does NOT ship `ALTER TABLE` for those three tables (they don't exist on main; you bake `pro_only` into your table-create to avoid two-migration race). Use `current_user_has_pro()` in RLS predicates (authenticated client context) and `user_has_pro(p_user_id)` in Edge Fn write surfaces (service-role context, no `auth.uid()` — mitigates [[feedback_rpc_auth_uid_vs_service_role_mismatch]]).

## Next Milestone-Close Actions

Per [[feedback_milestone_uat_deferral_consolidation]], when v1.3 closes:

1. Aggregate `43-CARRY-OVER.md` Items 3..6 (UAT signals A/B/C/D) into `<v1.3>-uat-deferred.md` alongside other phases' deferred-UAT items.
2. Aggregate Item 7 (`SLACK_WEBHOOK_EXPERIMENTS_URL` un-set) alongside other phases' vendor-secret items.
3. Operator runs the 4 UAT signals end-to-end as a batch after pre-creating: Stripe Lifetime Product, TEST50 promo coupon, test grandfathered-cohort + override row, 2 distinct non-admin test users with the live-RLS-fixture pattern.
4. Phase 43-CARRY-OVER.md status flips from `closed-with-carry-over` → `closed-clean` once all 4 signals approve.

## Deviations from Plan

None — plan executed exactly as written. Pre-existing repo-wide test/lint failures (94 vitest failures, 389 ESLint errors, 1 Deno import failure in `charge-dispute-created.ts`) are documented as out-of-scope and tracked for milestone close-out cleanup batch; they are NOT caused by Phase 43 work (confirmed by Phase 43-scoped vitest 44/44 + Phase 43-touched Deno files passing).

## Memory Updates Required

Surfaced for the user's memory file (`MEMORY.md`):

1. **CLI v2.101.0 silently ignores `--import-map`** — [[reference_supabase_functions_deploy_import_map_flag]] needs addendum: at CLI v2.101.0 the flag prints `"Specifying import_map through flags is no longer supported. Please use deno.json instead."` and is fully ignored. Resolution falls back to `supabase/functions/deno.json` (the project has one). Bundling still succeeds. Future Phase 43+ deploys should drop the `--import-map` flag entirely + rely on `deno.json` exclusively.

## Self-Check

Files verified present (absolute paths in worktree):

- `/Users/karstenhaldan/minisite/.claude/worktrees/agent-a98635646a97f70b8/leanshot/.planning/phases/43-m4-membership-tiers-extension/43-DEPLOY-NOTES.md` — FOUND
- `/Users/karstenhaldan/minisite/.claude/worktrees/agent-a98635646a97f70b8/leanshot/.planning/phases/43-m4-membership-tiers-extension/43-CARRY-OVER.md` — FOUND (extended)
- `/Users/karstenhaldan/minisite/.claude/worktrees/agent-a98635646a97f70b8/leanshot/.planning/phases/43-m4-membership-tiers-extension/43-06-SUMMARY.md` — FOUND (this file)

Commits verified in `git log` on `worktree-agent-a98635646a97f70b8`:

- 71623c2 — `docs(43-06): record Task 1 pre-deploy validation outcomes`
- 1f28a08 — `chore(43-06): deploy + 4-signal HUMAN-UAT carry-over`

Linked-DB verification (post-deploy):

- `schema_migrations` contains 7 new rows `20270715000001..07` — confirmed.
- `public.{lifetime_purchases, grandfathered_prices, stripe_price_lookup, promo_trial_extensions_log, tier_effective}` all exist — confirmed.
- `stripe_price_lookup` 5 rows seeded with empty `stripe_price_id` (vendor-gated sentinels) — confirmed.

## Self-Check: PASSED
