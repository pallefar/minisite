---
phase: 26
plan: 01
subsystem: affiliate
tags: [tier, ddl, trigger, audit, rls, test-stub]
dependency_graph:
  requires:
    - public.affiliates (Phase 19, 20270101000001)
    - public.affiliate_conversions (Phase 19, 20270101000002)
    - public.payouts (Phase 19, 20270101000002)
    - public.audit_logs (Phase 7, 20260601000001) + Phase 24 columns (20270601000028)
    - public.admin_role enum + public.is_admin_at_least (Phase 24, 20270601000026/27)
    - extensions.digest / pgcrypto (Phase 7)
  provides:
    - affiliates.tier + tier_promoted_at + tier_grantor_user_id + frozen_at + freeze_reason (D-15)
    - affiliate_conversions.tier_at_conversion_time + 5 anomaly columns (D-16)
    - public.stamp_affiliate_conversion_tier() + trg_affiliate_conversion_stamp (D-19)
    - public.promote_standard_to_gold_on_paid() + trg_affiliate_promote_gold (D-02, Pitfall 3)
    - public.affiliate_lifetime_recurring_payments table + RLS (D-17)
    - public.affiliate_fraud_signals table + RLS (D-18)
    - public.payouts.adjustments jsonb column + array CHECK (D-06)
    - audit_logs.action CHECK extended with 'affiliate_tier_auto_promoted' (Rule 1 fix)
    - leanshot/src/lib/affiliate/tier-config.ts (D-01 single source of truth)
    - leanshot/src/lib/affiliate/types.ts (AdjustmentEntry + FraudSignalPayload + TierProgress)
  affects:
    - Plan 26-02 (anomaly detector + matview)
    - Plan 26-03 (PartnerTierProgress + PartnerTierEarningsBreakdown)
    - Plan 26-04 (AdminAffiliatesAnomalyTab + AdminAffiliatesTierTab + admin RPCs)
    - Plan 26-05 (LandingTemplateGold + AffiliateLandingResolver tier branch)
    - Plan 26-06 (affiliate-lifetime-recurring Edge Fn + cron)
    - Plan 26-07 (stripe-webhook charge-refunded + charge.dispute.created + supabase db push)
tech-stack:
  added: [] # no new client deps; supabase-js + vitest already present
  patterns:
    - CHECK-constraint enums (text NOT NULL + check) — never CREATE TYPE AS ENUM (Pitfall 3)
    - BEFORE INSERT trigger for atomic per-row stamping (D-19 / AFFTIER-02 SC#1)
    - Race-safe ratchet via WHERE tier='standard' + FOUND-gated audit (Pitfall 3)
    - SECURITY DEFINER + locked search_path (memory reference_supabase_migration_gotchas)
    - jsonb CHECK enforcing array typing (D-06 / payouts.adjustments)
    - REVOKE-from-public + staff-select policy via is_admin_at_least (Phase 24 helper)
    - Phase 7 + Phase 24 dual-column audit_logs INSERT (legacy action+user_id_hash AND new Phase-24 columns)
    - Per-file slug prefix on vitest live-DB specs (feedback_rls_per_file_slug_prefix)
    - Vitest e2e specs with .spec.ts extension routed via vitest-e2e.config include + playwright testIgnore
key-files:
  created:
    - supabase/migrations/20270701000001_affiliate_tier_schema.sql
    - supabase/migrations/20270701000002_affiliate_conversions_tier_columns.sql
    - supabase/migrations/20270701000003_affiliate_tier_stamp_trigger.sql
    - supabase/migrations/20270701000004_affiliate_promotion_trigger.sql
    - supabase/migrations/20270701000005_affiliate_lifetime_recurring_table.sql
    - supabase/migrations/20270701000006_affiliate_fraud_signals_table.sql
    - supabase/migrations/20270701000007_payouts_adjustments_column.sql
    - leanshot/src/lib/affiliate/tier-config.ts
    - leanshot/src/lib/affiliate/types.ts
    - leanshot/src/lib/affiliate/__tests__/tier-ratchet.test.ts
    - leanshot/e2e/affiliate-tier-stamping.spec.ts
    - leanshot/e2e/affiliate-tier-promotion.spec.ts
  modified:
    - leanshot/vitest-e2e.config.ts (added P26 e2e .spec.ts entries to include)
    - leanshot/playwright.config.ts (added P26 .spec.ts entries to chromium testIgnore)
decisions:
  - D-01 commission-rate table — TIER_COMMISSION_PCT (0.20 / 0.30 / 0.25) committed as TypeScript source-of-truth
  - D-02 N=10 paid+confirmed promotion threshold committed as TIER_VOLUME_THRESHOLD + Migration 04 trigger
  - D-15 affiliates.tier as text+CHECK (not enum) per Pitfall 3
  - D-19 BEFORE INSERT trigger as the SINGLE writer of tier_at_conversion_time (AFFTIER-02 SC#1)
  - Pitfall 3 race-safe ratchet via WHERE tier='standard' + FOUND-gated audit
  - D-06 payouts.adjustments jsonb array (RESEARCH correction: table is payouts not affiliate_payouts; column net-new)
  - Rule 1 deviation: Migration 04 audit_logs INSERT populates BOTH legacy Phase-7 columns AND extends audit_logs_action_check (plan body would have failed at runtime)
metrics:
  duration_minutes: ~5
  completed_date: 2026-05-18
  tasks_completed: 3
  files_created: 12
  files_modified: 2
  commits: 3
---

# Phase 26 Plan 01: Multi-Tier Affiliate Schema Foundation — Summary

Atomic tier classification (Standard / Gold / Lifetime) for the v1.2 affiliate system, enforced at the Postgres layer via a BEFORE INSERT trigger that physically prevents application-layer drift.

## What Was Built

7 idempotent migrations + 3 client modules + 2 Wave-0 vitest live-DB stubs that lock in the affiliate tier foundation for Phase 26 plans 02–07 to build on. All artifacts written but NOT pushed to live DB — `supabase db push --linked` is gated to Plan 26-07 Task 4 per plan instructions.

### DDL slab (migrations 01/02/05/06/07 — Task 1)

| File | Purpose | Decision |
|------|---------|----------|
| `20270701000001_affiliate_tier_schema.sql` | ALTER affiliates +5 columns + partial index `idx_affiliates_lifetime` | D-15 |
| `20270701000002_affiliate_conversions_tier_columns.sql` | ALTER affiliate_conversions +tier_at_conversion_time (single-ALTER default 'standard' backfills history) + 5 anomaly columns + pending-review partial index | D-16 |
| `20270701000005_affiliate_lifetime_recurring_table.sql` | NEW table + (affiliate_id, subscription_id, billing_period_yyyymm) UNIQUE + idempotency_key UNIQUE + staff-only RLS | D-17 |
| `20270701000006_affiliate_fraud_signals_table.sql` | NEW table (signal_type CHECK: chargeback/anomaly_z_score/manual) + staff-only RLS + pending-review partial index | D-18 |
| `20270701000007_payouts_adjustments_column.sql` | ALTER public.payouts ADD adjustments jsonb (default `[]`) + jsonb-typeof CHECK | D-06 |

All filenames pass the 14-digit regex (`reference_supabase_migration_filename_regex`); all partial-index predicates are IMMUTABLE per Pitfall 1; all CHECK-constraint enums use `text + check` per Pitfall 3.

### Triggers (migrations 03/04 — Task 2)

| File | Purpose |
|------|---------|
| `20270701000003_affiliate_tier_stamp_trigger.sql` | `BEFORE INSERT` on `affiliate_conversions` — copies `affiliates.tier` into `NEW.tier_at_conversion_time` and sets `recurring_commission_pct_basis = 25.00` for lifetime tier. Locked `search_path = public, pg_catalog`. AFFTIER-02 SC#1: app-layer code physically cannot bypass historical-immutability invariant. |
| `20270701000004_affiliate_promotion_trigger.sql` | `AFTER INSERT OR UPDATE OF status` — at N≥10 paid+confirmed conversions, ratchets affiliate `tier` from `'standard'` to `'gold'` via race-safe `WHERE tier='standard'` clause. FOUND-gated audit emission to `audit_logs` (one row per real promotion). Extends `audit_logs_action_check` with `'affiliate_tier_auto_promoted'` (Rule 1 deviation — see below). |

### Client modules + Wave-0 tests (Task 3)

| File | Purpose |
|------|---------|
| `leanshot/src/lib/affiliate/tier-config.ts` | `TIER_COMMISSION_PCT` (standard 0.20 / gold 0.30 / lifetime 0.25), `TIER_VOLUME_THRESHOLD = 10`, `canDowngrade` pure-type NO. D-01/02/03. |
| `leanshot/src/lib/affiliate/types.ts` | `AdjustmentEntry` (payouts.adjustments shape), `FraudSignalPayload` discriminated union, `TierProgress` + `TierEarningsBreakdown` for Plan 26-03. |
| `leanshot/src/lib/affiliate/__tests__/tier-ratchet.test.ts` | 5 pure-unit tests: 3 ratchet refusals + TIER_COMMISSION_PCT shape + TIER_VOLUME_THRESHOLD value. **5/5 passed locally.** |
| `leanshot/e2e/affiliate-tier-stamping.spec.ts` | Vitest live-DB Wave-0 stub for AFFTIER-02 SC#1 (5 std + tier flip + 5 gold → first 5 still 'standard'). Skipped without service-role key; RED until Plan 26-07 push. |
| `leanshot/e2e/affiliate-tier-promotion.spec.ts` | Vitest live-DB Wave-0 stub for AFFTIER-01 (10 paid conversions → tier='gold' + exactly one audit row). Skipped without service-role key; RED until Plan 26-07 push. |

## Verification Results

- **SC#1** `find supabase/migrations -name '2027070100000[1-7]_*.sql' | wc -l` → **7** ✅
- **SC#2** `grep -L 'set search_path' supabase/migrations/2027070100000{3,4}_*.sql` → **empty** (both triggers have locked search_path) ✅
- **SC#3** `grep -c 'affiliate_payouts' supabase/migrations/2027070100000[1-7]_*.sql` → **0** ✅
- **SC#4** `grep -c 'create type.*enum'` (comment-stripped per `reference_grep_gate_comment_strip`) → **0** ✅
- **SC#5** `cd leanshot && npx vitest run src/lib/affiliate/__tests__/tier-ratchet.test.ts` → **5/5 passed, exit 0** ✅
- **SC#6** `grep -c 'audit_logs_action_check'` → **4** (4 occurrences in Migration 04: drop + add + comment + value) — **deliberately violated under Rule 1**. See Deviations below for why. ⚠️

## Deviations from Plan

### Auto-fixed Issues

#### 1. [Rule 1 — Bug] Migration 04 audit_logs INSERT would have failed at runtime
- **Found during:** Task 2
- **Issue:** Plan body Migration 04 INSERTs only Phase-24 columns (`actor_user_id`, `target_user_id`, `action_name`, `source`, etc.), but `public.audit_logs` was created in Phase 7 with `action text NOT NULL CHECK (action in (...))` and `user_id_hash text NOT NULL`. The plan-body INSERT would have raised `null value in column "user_id_hash" violates not-null constraint` AND/OR `audit_logs_action_check` violation at the very first promotion. The plan's interface comment claimed `audit_logs.action_name` is "FREE TEXT under Phase 24 (NOT CHECK-constrained as Phase 22 was) — so the action-extend migration is OBSOLETE under Phase 24 schema" — that's true for `action_name` (new column, no CHECK) but DOES NOT remove the legacy `action` + `user_id_hash` constraints, which are still in force.
- **Fix:**
  1. Migration 04 INSERT now populates BOTH legacy Phase-7 columns (`action='affiliate_tier_auto_promoted'`, `user_id_hash=encode(digest('system','sha256'),'hex')`) and Phase-24 columns (`action_name`, `source='trigger'`, `before_data`, `after_data`).
  2. Migration 04 begins with a `drop constraint if exists` + `add constraint audit_logs_action_check` that preserves every prior value from `20270601000019_admin_affiliate_review_rpcs.sql` verbatim plus adds `'affiliate_tier_auto_promoted'`.
- **Pattern lifted from:** `supabase/migrations/20270601000019_admin_affiliate_review_rpcs.sql:178-202` (Phase 22 admin RPC audit emission shape) + the existing drop+re-add CHECK idiom (Pattern E in 26-PATTERNS.md).
- **Files modified:** `supabase/migrations/20270701000004_affiliate_promotion_trigger.sql`
- **Commit:** `7cd22a7`
- **SC#6 impact:** SC#6 says `audit_logs_action_check` count should be 0; it's now 4 in Migration 04 by design. This is a SUMMARY-level documented deviation, not a real BLOCKER.

#### 2. [Rule 3 — Blocking issue] Vitest .spec.ts files would crash Playwright default run
- **Found during:** Task 3
- **Issue:** The plan mandated `affiliate-tier-stamping.spec.ts` + `affiliate-tier-promotion.spec.ts` filenames (in frontmatter `files_modified` and in the `<files>` block) but supplied vitest-style content (`describe`, `beforeAll`, `createClient` from supabase-js, etc.). The repo's existing convention for vitest live-DB tests under `e2e/` is `.test.ts` (matched by `vitest-e2e.config.ts include: ['e2e/rls-*.test.ts', ...]`), and Playwright's chromium project has `testMatch: /.*\.spec\.ts$/` — so without intervention, `npm run test` (which runs `vitest run && playwright test`) would crash on the new files because Playwright can't load vitest globals.
- **Fix:**
  1. Added the 2 new `.spec.ts` filenames to `vitest-e2e.config.ts` `include` so they route to vitest only.
  2. Added the same 2 entries to `playwright.config.ts` chromium project's `testIgnore` so Playwright skips them in the default run.
- **Files modified:** `leanshot/vitest-e2e.config.ts`, `leanshot/playwright.config.ts`
- **Commit:** `44d4a95`

#### 3. [Rule 3 — Blocking issue] Postgres 15 does not support `ADD CONSTRAINT IF NOT EXISTS`
- **Found during:** Task 1 (Migration 07)
- **Issue:** Plan body Migration 07 used `alter table public.payouts add constraint if not exists payouts_adjustments_is_array check (...)` — but `ADD CONSTRAINT IF NOT EXISTS` is not valid Postgres syntax (the `IF NOT EXISTS` clause is only supported on a handful of statements; CHECK constraints are not in that list). This would have failed `supabase db push` with a parse error.
- **Fix:** Wrapped the `ADD CONSTRAINT` in a `DO $$ ... END $$` block that checks `pg_constraint` for the conname before adding — the standard idempotent pattern used elsewhere in the codebase (e.g., the `pg_policies` lookup pattern in Phase 24 migrations).
- **Files modified:** `supabase/migrations/20270701000007_payouts_adjustments_column.sql`
- **Commit:** `fbf986a`

### No Architectural Changes Required

No Rule 4 escalations. All deviations were tactical fixes (correctness, runtime-blocking, build-config) that did not change the plan's intent or scope.

## Authentication Gates

None. All work was offline against the worktree filesystem; no Supabase CLI calls, no Stripe calls, no vendor authentication required at this stage. Live DB push is deferred to Plan 26-07 Task 4 per plan instructions.

## Known Stubs

The two Wave-0 e2e specs (`affiliate-tier-stamping.spec.ts` + `affiliate-tier-promotion.spec.ts`) are intentional stubs. They are RED today (skipped without `SUPABASE_SERVICE_ROLE_KEY` env, would fail if env present because migrations 01-07 are not pushed live yet). They WILL pass once Plan 26-07 Task 4 pushes the migrations and CI is supplied with the service-role key. The plan explicitly documents this in the `<done>` clause: "two e2e spec files compile (will RED until Plan 26-07 Task 4 pushes migrations)".

## Threat Surface Coverage

All 6 STRIDE entries from the plan's `<threat_model>` are mitigated by the artifacts shipped here:

| Threat ID | Mitigation |
|-----------|-----------|
| T-26-01 (tier direct UPDATE) | RLS on `affiliates` from Phase 19 still denies authenticated UPDATE; no new policy added in this plan. |
| T-26-02 (historical row mutation) | BEFORE INSERT trigger stamps once; no UPDATE policy on `tier_at_conversion_time`. |
| T-26-03 (N=10 boundary race) | Race-safe `WHERE tier='standard'` + FOUND-gated audit in Migration 04. |
| T-26-04 (cross-tenant read of new tables) | REVOKE all on new tables; staff-only SELECT policies via `is_admin_at_least`. |
| T-26-05 (promotion without audit) | FOUND-gated INSERT into `audit_logs` writes one row per real promotion. |
| T-26-06 (jsonb adjustments drift) | jsonb-typeof CHECK + canonical `AdjustmentEntry` type in `types.ts`. |

No `threat_flag` introductions — all surfaces are already covered in the plan's threat model.

## Commits

| Task | Hash | Message |
|------|------|---------|
| 1 | `fbf986a` | feat(26-01-01): affiliate tier schema migrations 01/02/05/06/07 |
| 2 | `7cd22a7` | feat(26-01-02): atomic tier-stamp + race-safe Standard→Gold promotion triggers |
| 3 | `44d4a95` | feat(26-01-03): TIER_COMMISSION_PCT source-of-truth + Wave-0 AFFTIER tests |

## Self-Check: PASSED

All 13 file paths exist on disk; all 3 task commits exist in `git log`. Self-check timestamp: 2026-05-18.
