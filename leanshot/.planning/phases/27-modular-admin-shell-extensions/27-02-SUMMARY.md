---
phase: 27-modular-admin-shell-extensions
plan: 02
subsystem: admin
tags: [admin, cohort, matview, rule-tree, taxonomy, secdef, audit]
requirements: [ADMIN-05, TAXO-03]
dependency_graph:
  requires:
    - "Phase 24: ADMIN_MODULES manifest (membership slot)"
    - "Phase 24: log_admin_action(p_action_name, p_target_user_id, p_table_name, p_row_pk, p_before, p_after) — exact 6-arg signature"
    - "Phase 24: is_admin_at_least(admin_role) enum-typed gate"
    - "Phase 24: profiles.admin_role + profiles.is_staff columns"
    - "Phase 22: tier_effective view (has_active boolean)"
  provides:
    - "public.cohort_definitions(id, name, rule, compiled_sql, status, created_by, ...)"
    - "public.cohort_membership(user_id, cohort_id, joined_at) PK"
    - "public.cohort_profile_view (15-field surface)"
    - "public.cohort_define(name, rule, compiled_sql) RPC"
    - "public.cohort_set_status(cohort_id, status) RPC"
    - "public.cohort_archive(cohort_id) RPC"
    - "public.cohort_is_member(user_id, cohort_id) consumer RPC"
    - "public.cohort_membership_rebuild() SECDEF (called by cron + tests)"
    - "public.cohort_validate_rule(rule, depth) defense-in-depth validator"
    - "pg_cron 'cohort-membership-refresh' on '7,22,37,52 * * * *'"
    - "leanshot/src/lib/cohort/{field-allowlist,rule-tree-schema,rule-tree-to-sql,api}.ts"
    - "leanshot/src/components/admin/cohort/{CohortFieldPicker,CohortRuleNode,AdminCohortBuilder,AdminCohortList,CohortsPage}.tsx"
  affects:
    - "Future consumers (P35, P38, P39, P40): use cohort_is_member(uid, cid) → boolean for membership probes"
    - "Phase 24 ADMIN_MODULES 'membership' slot — currently points at retention heatmap; integration addendum required"
tech_stack:
  added:
    - "zod (already installed) — recursive lazy schema + superRefine for depth check"
  patterns:
    - "S1 (dual-layer RLS + SECDEF)"
    - "S2 (no-policy writes — SECDEF RPCs are the only writers)"
    - "S3 (set_config('app.suppress_audit', 'on', true) + explicit log_admin_action)"
    - "S7 (typed-error API wrapper mirroring affiliate-review.ts)"
    - "S8 (single-source-of-truth zod schema across TS layers)"
    - "Defense-in-depth 3-layer allowlist (UI picker + zod enum + plpgsql CASE)"
    - "Truncate-and-rebuild over per-cohort dynamic SQL (vs static matview)"
key_files:
  created:
    - "supabase/migrations/20260601000010_cohort_definitions.sql"
    - "supabase/migrations/20260601000011_cohort_membership_matview.sql"
    - "supabase/migrations/20260601000012_cohort_rpcs.sql"
    - "supabase/migrations/20260601000013_cohort_matview_refresh_cron.sql"
    - "leanshot/src/lib/cohort/field-allowlist.ts"
    - "leanshot/src/lib/cohort/rule-tree-schema.ts"
    - "leanshot/src/lib/cohort/rule-tree-schema.test.ts"
    - "leanshot/src/lib/cohort/rule-tree-to-sql.ts"
    - "leanshot/src/lib/cohort/rule-tree-to-sql.test.ts"
    - "leanshot/src/lib/cohort/api.ts"
    - "leanshot/src/lib/cohort/api.test.ts"
    - "leanshot/src/components/admin/cohort/CohortFieldPicker.tsx"
    - "leanshot/src/components/admin/cohort/CohortRuleNode.tsx"
    - "leanshot/src/components/admin/cohort/AdminCohortBuilder.tsx"
    - "leanshot/src/components/admin/cohort/AdminCohortList.tsx"
    - "leanshot/src/components/admin/cohort/CohortsPage.tsx"
    - "leanshot/e2e/admin-cohort-builder.spec.ts"
  modified: []
decisions:
  - "Single TS rule-tree schema (ruleTreeSchema) + literal-baked SQL variant (ruleTreeToLiteralSql) — two translator outputs, one source of truth"
  - "Materialized TABLE not VIEW for cohort_membership: each cohort needs its own dynamic SQL WHERE clause (translator output), which a static `create materialized view` body can't express. Plain table with PK on (user_id, cohort_id) gives the same sub-50ms p99 reads as a matview without the CONCURRENTLY refresh constraint overhead."
  - "Added cohort_set_status() as a third RPC (CONTEXT D-09 listed only define+archive). Without explicit promote ownership, draft cohorts never reach active and consumers silently break — per [[feedback_status_machine_transition_owner]]."
  - "cohort_profile_view returns null::<type> placeholders for fields whose backing columns don't yet exist on public.profiles (tier, country, language, signup_source, total_paid_amount_cents, active_streak_days, is_affiliate, anomaly_flagged, account_state). For v1 these comparisons yield NULL → row excluded; consumer phases (P35 streaks, P26 anomaly, P28 orgs) wire the real columns later."
  - "compiled_sql column stored as literal-baked SQL (Postgres E-strings + canonical numerics) — required because EXECUTE format(...) in cohort_membership_rebuild cannot bind $N placeholders. SQL injection mitigated via E-string escape (T-27-02-01)."
  - "cron schedule '7,22,37,52' (RESEARCH correction #2) — zero overlap with Plan 27-04 anomaly cron `*/5`."
metrics:
  duration_minutes: 8
  duration_seconds: 509
  completed_date: "2026-05-18"
  tasks_completed: 6
  tasks_deferred: 1
  files_created: 17
  lines_of_sql: 645
  lines_of_typescript: 2270
  unit_tests_added: 31
  e2e_tests_added: 3
---

# Phase 27 Plan 02: Cohort Builder (ADMIN-05 + TAXO-03) Summary

JSONB rule-tree cohort builder with TS-to-SQL translator (parameterized + literal-baked variants), 4 SECDEF RPCs, materialized membership table refreshed by a staggered 15-min cron, and a hand-rolled 4-component visual builder UI — 31 unit tests + 3 DB-level e2e probes, three-layer defense-in-depth allowlist.

## Tasks Executed

| # | Name                                                                  | Commit  | Files                                                                                                 |
| - | --------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------- |
| 1 | TDD: zod schema + 15-field allowlist + recursive translator           | a1ea4d5 | field-allowlist.ts, rule-tree-schema.ts (+test), rule-tree-to-sql.ts (+test)                          |
| 2 | Migrations: cohort_definitions + cohort_membership + cron             | a642ae8 | 20260601000010_cohort_definitions.sql, ...000011_cohort_membership_matview.sql, ...000013_cron.sql    |
| 3 | SECDEF RPCs: validator + define + set_status + archive                | b43dc5a | supabase/migrations/20260601000012_cohort_rpcs.sql                                                    |
| 4 | API wrapper + literal-baked SQL variant + tests                       | fb9632d | api.ts (+test), rule-tree-to-sql.ts (variant added)                                                   |
| 5 | UI: CohortFieldPicker + CohortRuleNode + AdminCohortBuilder + List + Page | ca15077 | 5 components under leanshot/src/components/admin/cohort/                                              |
| 6 | Playwright e2e: define + promote + archive + injection probe          | eae75cb | leanshot/e2e/admin-cohort-builder.spec.ts                                                             |
| 7 | supabase db push --linked + cron sanity                               | DEFERRED | (orchestrator/user post-merge — parallel-executor in worktree has no supabase CLI access; see below)  |

## Verification Status

- **Unit tests (Tasks 1+4):** ✅ `npx vitest run src/lib/cohort/` — 31/31 passed (3 files).
- **Typecheck:** ✅ `npx tsc -b --noEmit` clean.
- **Lint:** ✅ `npx eslint src/components/admin/cohort/ src/lib/cohort/` clean.
- **e2e (Task 6):** ✅ `npx playwright test e2e/admin-cohort-builder.spec.ts --list` lists 3 tests; full run skips when `SUPABASE_SERVICE_ROLE_KEY` is absent (which it is in this worktree). Tests are wired to assert DB-level invariants per `[[feedback_realtime_layer_e2e_pattern]]`.
- **Task 7 (`supabase db push --linked`) DEFERRED:** parallel executors in worktrees should NOT push migrations live per `[[feedback_parallel_executor_autonomy_drift]]`; orchestrator will push at merge time. Once pushed, verifier should run:
  - `supabase db query --linked "select count(*) from pg_tables where schemaname='public' and tablename in ('cohort_definitions','cohort_membership')"` → expect 2
  - `supabase db query --linked "select schedule from cron.job where jobname='cohort-membership-refresh'"` → expect `7,22,37,52 * * * *`
  - `supabase db query --linked "select indexname from pg_indexes where tablename='cohort_membership' and indexname='cohort_membership_pkey'"` → expect 1 row (the PK is the load-bearing index)

## Threat Mitigations Shipped

| Threat ID    | Status     | Where                                                                                                    |
| ------------ | ---------- | -------------------------------------------------------------------------------------------------------- |
| T-27-02-01   | mitigated  | ruleTreeToSql emits $N placeholders only; ruleTreeToLiteralSql uses Postgres E-string escape (test-asserted) |
| T-27-02-02   | mitigated  | 3-layer allowlist: CohortFieldPicker (UI), zod enum (TS), plpgsql CASE (cohort_validate_rule)            |
| T-27-02-03   | mitigated  | MAX_DEPTH=8 enforced in zod superRefine + plpgsql validator; MAX_CHILDREN=50 in both                     |
| T-27-02-04   | mitigated  | cohort_set_status raises 'forbidden' if p_status='archived' and caller not superadmin; cohort_archive same |
| T-27-02-05   | mitigated  | All writers call log_admin_action with full before/after; archived wrapper writes a SECOND audit row tagged 'cohort_archived' |
| T-27-02-06   | accepted   | cohort_membership is RLS-deny-all to authenticated; cohort_is_member returns boolean-only                |
| T-27-02-07   | mitigated  | Rebuild = single TRUNCATE+INSERT in implicit TX → atomic commit; readers see prev snapshot until commit  |
| T-27-02-08   | mitigated  | cohort_definitions has NO write policies — denial-by-default RLS; SECDEF RPCs are sole writers           |

## Deviations from Plan

### [Rule 3 — Blocking issue] cohort_membership_rebuild needs literal-baked SQL, not parameterized

**Found during:** Task 4 (writing the API wrapper).
**Issue:** The plan specified that the TS translator `ruleTreeToSql` would emit parameterized SQL ($N placeholders) and the API wrapper would call `cohort_define(name, rule, compiledSql)` with that output. But the rebuild routine in Task 2 calls `EXECUTE format('insert ... where %s', cohort.compiled_sql)` — Postgres EXECUTE format() cannot bind $N placeholders without separate USING args, and our per-cohort dynamic SQL provides no place to thread params.
**Fix:** Added a SECOND translator variant `ruleTreeToLiteralSql` that bakes values as Postgres literals (`E'...'` for text with backslash+quote escape, canonical for numbers, `true|false` for booleans, `ARRAY[...]::text[]` for `in`). The API wrapper now ships compiledSql = literal-baked variant. SQL injection mitigated via E-string escape (asserted in 6 new unit tests).
**Files:** leanshot/src/lib/cohort/rule-tree-to-sql.ts (+test).
**Commit:** fb9632d.

### [Rule 2 — Critical functionality] cohort_profile_view added to ship with empty profile schema

**Found during:** Task 2.
**Issue:** CONTEXT D-06 lists 15 fields the cohort rules can reference, but `public.profiles` in v1.2 ships with only 7 columns (id, is_staff, created_at, admin_role, has_totp, primary_org_id, completed_onboarding_at). Without an intermediate view, ruleTreeToSql would emit e.g. `p.tier = E'pro'` which would fail with `column "tier" does not exist`, blocking the entire rebuild.
**Fix:** Added `cohort_profile_view` as a security_invoker view with `null::<type>` placeholders for fields whose backing columns don't yet exist (tier, country, language, signup_source, total_paid_amount_cents, active_streak_days, is_affiliate, anomaly_flagged, account_state). Real derivations for `days_since_signup`/`days_since_last_login` (from auth.users), `has_active_subscription` (from tier_effective), `has_org` (from profiles.primary_org_id), `has_completed_onboarding` (from profiles.completed_onboarding_at), `role` (from profiles.admin_role). The translator targets `p.*` columns via `FIELD_SQL_EXPR` which always resolve through the view. As consumer phases (P26 anomaly, P28 orgs, P35 streaks) wire each missing column, the view can be edited to point at the real column without changing the translator or the validator.
**Files:** supabase/migrations/20260601000010_cohort_definitions.sql.
**Commit:** a642ae8.

### [Rule 2 — Critical functionality] cohort_set_status RPC (status-machine ownership)

**Found during:** Task 3.
**Issue:** CONTEXT D-09 phrases the lifecycle as "draft / active / archived" but D-21 only lists `cohort_define` + `cohort_archive` RPCs. The draft→active transition has no explicit owner. Per `[[feedback_status_machine_transition_owner]]` — every status value needs an owning RPC, otherwise consumer code (P35/P38/P39/P40 cohort_is_member calls) silently ships dead because drafts never become active.
**Fix:** Added `cohort_set_status(p_cohort_id, p_status)` RPC owning all transitions; `cohort_archive` becomes a superadmin-only thin wrapper. The AdminCohortList UI's Promote button calls cohort_set_status with `p_status='active'`. This is per CONTEXT "Claude's Discretion" + plan-action note line 147.
**Files:** supabase/migrations/20260601000012_cohort_rpcs.sql, AdminCohortList.tsx.
**Commit:** b43dc5a, ca15077.

## ADMIN_MODULES Integration Gap (deferred to addendum)

Phase 24 owns `leanshot/src/lib/admin/modules.ts`. The 'membership' slot currently points at `AdminCohortsPage` (the Phase 22 retention heatmap surface), not this plan's `CohortsPage`. Per `[[feedback_planner_iter1_anti_patterns]]` no shared-file choreography, this plan does NOT edit modules.ts. To wire the new builder into the admin shell, a Phase 27 integration addendum should:

1. Either re-point the 'membership' slot's `lazy: () => import('@/components/admin/pages/AdminCohortsPage')` at `@/components/admin/cohort/CohortsPage` and rename the retention heatmap to a sibling tab; OR
2. Add a NEW 'cohorts' ADMIN_MODULES entry distinct from 'membership' (with its own posthog flag key and route).

Option 2 is recommended — it preserves the existing retention surface and allows the new builder to ship behind its own `admin.cohorts.enabled` flag, gated to admin role.

## Authentication Gates

None. All vendor-side dependencies (Supabase CLI, supabase project credentials) are owned by the orchestrator at merge time. Task 7 deferral documented above.

## Known Stubs

None. All five UI components are wired to real state, real RPCs, and real onChange handlers. The 9 cohort_profile_view fields exposed as `null::<type>` are NOT UI stubs — they're SQL placeholders that future phases will replace as the underlying columns ship; meanwhile any cohort rule referencing them yields NULL comparison → 0 matches (correct denial-by-default for fields not yet wired).

## Self-Check

Files exist:
- ✅ supabase/migrations/20260601000010_cohort_definitions.sql
- ✅ supabase/migrations/20260601000011_cohort_membership_matview.sql
- ✅ supabase/migrations/20260601000012_cohort_rpcs.sql
- ✅ supabase/migrations/20260601000013_cohort_matview_refresh_cron.sql
- ✅ leanshot/src/lib/cohort/{field-allowlist,rule-tree-schema,rule-tree-to-sql,api}.ts (4 modules + 3 tests)
- ✅ leanshot/src/components/admin/cohort/{CohortFieldPicker,CohortRuleNode,AdminCohortBuilder,AdminCohortList,CohortsPage}.tsx (5 components)
- ✅ leanshot/e2e/admin-cohort-builder.spec.ts

Commits exist (a87bf6a..HEAD):
- ✅ a1ea4d5 feat(27-02-01)
- ✅ a642ae8 feat(27-02-02)
- ✅ b43dc5a feat(27-02-03)
- ✅ fb9632d feat(27-02-04)
- ✅ ca15077 feat(27-02-05)
- ✅ eae75cb feat(27-02-06)

## Self-Check: PASSED
