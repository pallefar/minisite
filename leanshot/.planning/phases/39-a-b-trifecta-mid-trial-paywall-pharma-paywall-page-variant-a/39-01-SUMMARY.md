---
phase: 39-a-b-trifecta-mid-trial-paywall-pharma-paywall-page-variant-a
plan: 01
subsystem: database
tags: [supabase, postgres, rls, secdef, pgtap, ab-testing, paywall, pharma, cohorts]

# Dependency graph
requires:
  - phase: 27
    provides: cohort_definitions table + cohort_membership_rebuild + cohort_profile_view (extended via seed insert here)
  - phase: 15
    provides: landing_pages table (referenced by page_variants.canonical_page_id FK)
  - phase: 14
    provides: public.subscriptions table (extended with refunded_at column here)
  - phase: 34
    provides: activation_events (PAYWALL fires after activation; not directly read by this plan)
  - phase: 35
    provides: ship-winner-flag Edge Fn pattern (reused by Wave 2/3 ship-winner plans)
provides:
  - user_experiments table (per-user variant assignment, sticky on first qualifying touch)
  - variant_config table (variant catalog with composite_score + 42-day lifecycle cols)
  - utm_variant_map table (utm_source -> variant_id routing, 4 seed rows)
  - pharma_content table (with safety_category column for D-05 carveout)
  - pharma_content_versions table (append-only audit log, no UPDATE/DELETE policies)
  - page_variants table (with canonical_page_id FK + 42-day lifecycle cols)
  - experiment_results matview (composite_score = paid_rate * retention_30d_rate)
  - 5 default cohort seed rows (free-user, past-due-3d, trial-day-3, trial-day-7, post-activation)
  - subscriptions.refunded_at column add (refund-rate kill cron prerequisite)
  - resolve_cohort_for_user(uid uuid) SECDEF RPC (explicit-uid pattern)
affects: [39-02, 39-03, 39-04, 39-05, 39-06, 39-07, 39-08, 39-09, 39-10]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pattern S2 (writes via SECDEF only): every new table ships SELECT policy + NO INSERT/UPDATE/DELETE policies"
    - "Explicit-uid SECDEF RPC pattern (resolves_cohort_for_user takes uid uuid param, no JWT-derived identity reference) — safe from service-role contexts"
    - "Append-only via denial-by-default RLS (pharma_content_versions has SELECT-only policy; writes through SECDEF RPC only)"
    - "42-day variant lifecycle columns (warned_at + archived_at + traffic_to_control) for daily cron consumption"
    - "Multi-step seed migration using CTE/NOT EXISTS for idempotency on tables without natural unique keys"

key-files:
  created:
    - "supabase/migrations/20270714000001_p39_user_experiments.sql"
    - "supabase/migrations/20270714000002_p39_variant_config.sql"
    - "supabase/migrations/20270714000003_p39_utm_variant_map.sql"
    - "supabase/migrations/20270714000004_p39_pharma_content.sql"
    - "supabase/migrations/20270714000005_p39_pharma_content_versions.sql"
    - "supabase/migrations/20270714000006_p39_page_variants.sql"
    - "supabase/migrations/20270714000007_p39_experiment_results_matview.sql"
    - "supabase/migrations/20270714000008_p39_cohort_seed_5_default.sql"
    - "supabase/migrations/20270714000009_p39_utm_variant_map_seed.sql"
    - "supabase/migrations/20270714000013_p39_subscriptions_refunded_at.sql"
    - "supabase/migrations/20270714000014_p39_resolve_cohort_for_user_rpc.sql"
    - "supabase/tests/p39_rls_user_experiments.sql"
    - "supabase/tests/p39_rls_pharma_content_versions.sql"
    - "supabase/tests/p39_seed_counts.sql"
  modified: []

key-decisions:
  - "Mapped 5 cohort seeds onto the EXISTING cohort_definitions schema (name UNIQUE / rule jsonb / compiled_sql text / status enum) rather than the planner's claimed (key/label/filter_rule/leaderboard_enabled) shape — the existing schema from Phase 27 is the source of truth"
  - "trial-day-3 / trial-day-7 / past-due-3d cohorts ship with compiled_sql that references columns not yet wired on cohort_profile_view (days_since_signup, account_state placeholders); populates 0 rows at rebuild until consumer phases wire the columns — matches the documented null-placeholder pattern in the view"
  - "experiment_results matview ships SHAPE only at Wave 1; per-row aggregation bodies (paid_rate / retention_30d_rate / refund_rate_7d / posterior) remain NULL until Wave 2 plans extend the refresh RPC"
  - "resolve_cohort_for_user(uid uuid) uses cohort_membership lookup (joined to cohort_definitions for status=active filter); deterministic ordering by cd.created_at ASC for stable multi-match resolution"
  - "Rejected name 'auth.uid()' kept OUT of all committed file comments (per feedback_negation_grep_defeated_by_comment_string) — header comment rewritten to use 'JWT-derived caller identity' phrasing instead"

patterns-established:
  - "Multi-migration FK back-fill: user_experiments ships with NO FK on variant_id/utm_variant_id, then 20270714000002/000003 each ALTER TABLE ADD CONSTRAINT after their target table exists — avoids out-of-order create-table issue"
  - "Surface-discriminator check constraint: surface text check IN ('paywall','page','pharma') applied to both user_experiments and variant_config — single source for the 3-surface enum"

requirements-completed: [PAYWALL-03, PAYWALL-04, PAYWALL-05, PAYWALL-07, PAGEAB-01, PAGEAB-03, PAGEAB-07, PHARMA-04, PHARMA-07]

# Metrics
duration: 35min
completed: 2026-05-24
---

# Phase 39 Plan 01: Wave 1 Foundation Migrations Summary

**Shipped 11 Phase 39 schema migrations + 3 pgTAP RLS proofs: 7 new tables (user_experiments, variant_config, utm_variant_map, pharma_content, pharma_content_versions, page_variants) + experiment_results matview + subscriptions.refunded_at column + resolve_cohort_for_user(uid) SECDEF RPC, all under Pattern S2 (writes via SECDEF only) with explicit-uid pattern for service-role safety.**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-05-24 (worktree spawn time)
- **Completed:** 2026-05-24T14:37:33Z
- **Tasks:** 2 / 2
- **Files modified:** 14 (11 migrations + 3 pgTAP tests)

## Accomplishments

- Shipped 11 strict-14-digit migrations covering ALL Phase 39 schema in one wave (per <verification>); no remote-tail collision (P40 tail 20270709000008; this plan uses 20270714000001..14)
- Resolved RESEARCH OQ-1 in committed form: `public.subscriptions.refunded_at` column add migration shipped (the refund-rate kill cron in Plan 39-03 reads it)
- Resolved RESEARCH OQ-3 in committed form: `public.resolve_cohort_for_user(uuid)` is net-new on main (no prior signature found via grep) — this plan owns the create
- Applied `feedback_negation_grep_defeated_by_comment_string` proactively: rejected name `auth.uid()` does NOT appear anywhere in the committed RPC file
- All net-new tables follow Pattern S2: SELECT policy only (admin or owner+admin), zero write policies — writes flow through SECDEF RPCs in Wave 2/3

## Task Commits

1. **Task 1: Author 8 core schema migrations + 2 seed migrations** — `0c835fac` (feat)
2. **Task 2: subscriptions.refunded_at + resolve_cohort_for_user RPC + 3 pgTAP proofs** — `454f9dc1` (feat)

**Plan metadata:** (this SUMMARY commit, hash assigned at final commit)

## Files Created/Modified

### Migrations (11)
- `supabase/migrations/20270714000001_p39_user_experiments.sql` — Per-user variant assignment table, owner/admin SELECT RLS (T-39-01-01)
- `supabase/migrations/20270714000002_p39_variant_config.sql` — Variant catalog + composite_score + 42-day lifecycle cols; back-fills FK on user_experiments.variant_id
- `supabase/migrations/20270714000003_p39_utm_variant_map.sql` — utm_source → variant_id table; back-fills FK on user_experiments.utm_variant_id
- `supabase/migrations/20270714000004_p39_pharma_content.sql` — Pharma copy table with safety_category text column (D-05 5-value CHECK constraint)
- `supabase/migrations/20270714000005_p39_pharma_content_versions.sql` — Append-only audit log; T-39-01-02 mitigation (NO write policies)
- `supabase/migrations/20270714000006_p39_page_variants.sql` — Page-builder variants + 42-day lifecycle cols + canonical_page_id FK to landing_pages
- `supabase/migrations/20270714000007_p39_experiment_results_matview.sql` — Per-variant aggregation matview SHAPE (Wave 2 populates bodies)
- `supabase/migrations/20270714000008_p39_cohort_seed_5_default.sql` — 5 D-08 cohort seed rows (free-user, past-due-3d, trial-day-3, trial-day-7, post-activation)
- `supabase/migrations/20270714000009_p39_utm_variant_map_seed.sql` — 4 D-09 utm_source seed rows + 4 placeholder paywall variant_config rows
- `supabase/migrations/20270714000013_p39_subscriptions_refunded_at.sql` — Column add + partial index (refunded_at IS NOT NULL)
- `supabase/migrations/20270714000014_p39_resolve_cohort_for_user_rpc.sql` — SECDEF RPC with explicit uid param, EXECUTE granted to service_role + authenticated

### pgTAP proofs (3)
- `supabase/tests/p39_rls_user_experiments.sql` — 4 assertions: exactly 1 SELECT policy, RLS enabled, qual references owner+admin gate, NO write policies
- `supabase/tests/p39_rls_pharma_content_versions.sql` — 4 assertions: exactly 1 admin SELECT policy, RLS enabled, gate on is_admin_at_least, NO write policies (T-39-01-02 append-only)
- `supabase/tests/p39_seed_counts.sql` — 3 assertions: 5 Phase 39 cohorts present, 4 utm_variant_map rows, all 4 utm rows map to paywall-surface variants

## RESEARCH OQ Resolutions

- **OQ-1 (subscriptions.refunded_at presence):** RESOLVED — grep + read of `20260601000019_stripe_subscriptions.sql` confirms column absent from main; sibling `public.lifetime_purchases.refunded_at` (Phase 43) is a different table. This plan owns the add on `public.subscriptions` per D-02 requirement.
- **OQ-3 (resolve_cohort_for_user prior signature):** RESOLVED — `grep -rE "resolve_cohort" supabase/migrations/` returned zero matches. Net-new RPC created here.

## Schema Reconciliation Note (Important for downstream plans)

The planner's `<context>` block claimed `cohort_definitions` has columns `(key, label, filter_rule, leaderboard_enabled)`. The ACTUAL schema (from `20270602000010_cohort_definitions.sql`) is `(name UNIQUE, rule jsonb, compiled_sql text, status text enum)`. The seed migration adapts: each Phase 39 cohort uses `name` as the unique key, `rule` as the descriptive jsonb, and `compiled_sql` as the WHERE fragment evaluated by `cohort_membership_rebuild()`. **Downstream plans should query cohort_definitions by `name` not by `key`.**

## Deviations from Plan

### Adaptations (NOT deviations — driven by ACTUAL on-disk schema)

**1. cohort seed adapted to ACTUAL cohort_definitions schema**
- **Found during:** Task 1 pre-flight (read of 20270602000010_cohort_definitions.sql)
- **Issue:** Planner's `<context>` block described a (key, label, filter_rule, leaderboard_enabled) shape that does not exist on main
- **Adaptation:** Wrote seed against the real schema (name UNIQUE, rule jsonb, compiled_sql text, status enum); cohort `name` values preserved verbatim per D-08
- **Files:** `supabase/migrations/20270714000008_p39_cohort_seed_5_default.sql`
- **Commit:** `0c835fac`

### Rule-Applied Auto-fixes

**1. [Rule 1 - Bug] Removed `auth.uid()` from committed comment strings in resolve_cohort_for_user RPC**
- **Found during:** Task 2 verification grep
- **Issue:** Function header comment + COMMENT-ON-FUNCTION string both contained the rejected name `auth.uid()` (as a "does NOT reference" statement). This defeats the `<verify>` negation grep (`! grep -q 'auth.uid()'`) per `feedback_negation_grep_defeated_by_comment_string`.
- **Fix:** Reworded both comment locations to use "JWT-derived caller identity" / "resolves identity from the parameter only" phrasing
- **Files modified:** `supabase/migrations/20270714000014_p39_resolve_cohort_for_user_rpc.sql`
- **Commit:** `454f9dc1` (folded into the Task 2 commit before push)

### Auth gates / checkpoints
None — fully autonomous (autonomous=true, no checkpoints in plan).

## Threat Mitigation Status (from <threat_model>)

| Threat ID | Component | Status | Evidence |
|-----------|-----------|--------|----------|
| T-39-01-01 | user_experiments cross-tenant SELECT | MITIGATED | `pol_user_experiments_self_or_admin_select` policy uses `user_id = auth.uid() OR is_admin_at_least('admin')`; pgTAP test p39_rls_user_experiments.sql TEST 3 asserts qual |
| T-39-01-02 | pharma_content_versions audit-log tampering | MITIGATED | NO INSERT/UPDATE/DELETE policies; only admin SELECT; pgTAP test p39_rls_pharma_content_versions.sql TEST 4 asserts policy count = 0 for write cmds |
| T-39-01-03 | resolve_cohort_for_user RPC service-role mismatch | MITIGATED | Function body has zero `auth.uid()` references (verified by grep gate); takes explicit uid uuid parameter; safe to call from service-role |
| T-39-01-04 | variant assignment repudiation | MITIGATED | user_experiments.created_at + cohort_id + utm_variant_id audit deciding inputs at INSERT time |
| T-39-01-05 | back-dated migration blocks db push | MITIGATED | All 11 migrations use 20270714000001..14 timestamps, strictly > 20270709000008 (P40 tail); zero collisions with future-phase timestamps (P45=20270727, P46=20270725, P47=20270801, P48=20270901, P49=20271001) |
| T-39-01-06 | safety_category ignored by future Paywall | DEFERRED to Plan 39-02 | safety_category column shipped with CHECK constraint enforcing the 5 D-05 categories; phaCheck() helper + ESLint + CI grep gate are Plan 39-02 deliverables |

## Self-Check: PASSED

All 14 deliverable files exist on disk (11 migrations + 3 pgTAP proofs + this SUMMARY). Both task commits (`0c835fac`, `454f9dc1`) found in `git log --all`. Zero missing artifacts.
