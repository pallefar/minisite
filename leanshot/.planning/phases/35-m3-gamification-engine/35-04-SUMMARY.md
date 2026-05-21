---
phase: 35-m3-gamification-engine
plan: "04"
subsystem: leaderboard
tags:
  - gamification
  - leaderboard
  - matview
  - pg-cron
  - rls
  - cohort
dependency_graph:
  requires:
    - "27-02 (cohort_definitions + cohort_membership table)"
    - "35-01 (xp_ledger — rolling-7d join source)"
  provides:
    - "leaderboard_matview (cohort × user × rolling-7d XP rank)"
    - "set_leaderboard_optin / suggest_leaderboard_handle / get_leaderboard_for_user SECDEF RPCs"
    - "phase35-leaderboard-refresh cron at 12,27,42,57"
    - "handle-validate.ts + leaderboard.ts client wrappers"
  affects:
    - "35-05 (admin module reads leaderboard_enabled column)"
    - "35-06 (LeaderboardCard calls get_leaderboard_for_user)"
    - "35-08 (Settings → Leaderboards subtab calls set_leaderboard_optin + suggest_leaderboard_handle)"
tech_stack:
  added:
    - "leaderboard_matview (Postgres materialized view)"
    - "leaderboard_optin (Postgres table + RLS)"
    - "pg_cron phase35-leaderboard-refresh (12,27,42,57)"
  patterns:
    - "SECDEF RPC with set search_path (mirrors cohort_is_member pattern)"
    - "Matview + UNIQUE INDEX for REFRESH CONCURRENTLY (mirrors affiliate_click_baseline_mv)"
    - "Named-tag dollar-quoting $cron$/$refresh$/$unschedule$ (memory reference_postgres_dollar_quote_nesting_in_cron_body)"
    - "ES256 auth.generateLink + /auth/v1/verify pattern (memory reference_rls_fixture_gotrueclient_flake)"
    - "File-scoped TEST_SLUG_PREFIX (memory feedback_rls_per_file_slug_prefix)"
key_files:
  created:
    - supabase/migrations/20270708000010_p35_cohort_def_leaderboard_enabled.sql
    - supabase/migrations/20270708000011_p35_leaderboard_optin.sql
    - supabase/migrations/20270708000012_p35_leaderboard_matview.sql
    - supabase/migrations/20270708000013_p35_leaderboard_refresh_cron.sql
    - supabase/migrations/20270708000014_p35_leaderboard_rpcs.sql
    - leanshot/src/lib/gamification/handle-validate.ts
    - leanshot/src/lib/gamification/__tests__/handle-validate.test.ts
    - leanshot/src/lib/gamification/leaderboard.ts
    - supabase/tests/35_leaderboard_matview.sql
    - supabase/tests/35_matview_concurrent.sql
    - leanshot/tests/rls/35-leaderboard-cross-tenant.test.ts
    - leanshot/e2e/rls-leaderboard-optin.test.ts
  modified: []
decisions:
  - "cohort_membership is the JOIN table (regular TABLE truncate-rebuild; NOT a true matview per Research A4)"
  - "Refresh at 12,27,42,57 — 5-min offset AFTER cohort_membership_rebuild (7,22,37,52) to ensure cohort data is fresh"
  - "get_leaderboard_for_user uses auth.uid() and is CLIENT-ONLY — Pitfall 8 documented in comments and leaderboard.ts"
  - "Moved cross-tenant test from test/rls/ to tests/rls/ to match vitest include patterns (Rule 1 fix)"
metrics:
  duration_approx: "~35 minutes"
  completed: "2026-05-21"
  tasks_completed: 5
  tasks_total: 5
  files_created: 12
  files_modified: 0
---

# Phase 35 Plan 04: Cohort Leaderboard Matview + Opt-IN Flow + 15-min Cron Refresh + Handle Validation Summary

**One-liner:** Cohort-scoped opt-IN leaderboard via Postgres matview (rolling 7d XP rank, UNIQUE INDEX for CONCURRENTLY refresh), SECDEF RPCs for handle picker + opt-in/out flow, 15-min pg_cron offset from cohort_membership rebuild, client handle validator with 26 unit tests, and 6+3 Vitest cross-tenant impersonation proofs.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | ALTER cohort_definitions + leaderboard_optin table | cd8dc5f | 20270708000010, 20270708000011 |
| 2 | leaderboard_matview + UNIQUE INDEX + 15-min refresh cron | aa96bc3 | 20270708000012, 20270708000013 |
| 3 | leaderboard SECDEF RPCs | e8bf507 | 20270708000014 |
| 4 | Client handle-validate + leaderboard RPC wrappers + unit tests | ebad1af | handle-validate.ts, leaderboard.ts, handle-validate.test.ts |
| 5 | pgTAP matview tests + Vitest cross-tenant impersonation proof | 1ec6a24 | 35_leaderboard_matview.sql, 35_matview_concurrent.sql, 35-leaderboard-cross-tenant.test.ts, rls-leaderboard-optin.test.ts |

## Architecture Notes

### cohort_membership JOIN source (Research A4)
The leaderboard_matview JOINs `public.cohort_membership`, which is a **regular TABLE** truncated and rebuilt by `cohort_membership_rebuild()` at `7,22,37,52 * * * *`. Despite the filename `20270602000011_cohort_membership_matview.sql`, the object is NOT a true Postgres `MATERIALIZED VIEW` — it is a plain table with rebuild semantics. The leaderboard_matview correctly JOINs the table directly.

### Refresh schedule + cron offset rationale (F-2 / D-15 staleness contract)
- `cohort_membership_rebuild` cron: `7,22,37,52 * * * *`
- `phase35-leaderboard-refresh` cron: `12,27,42,57 * * * *` (5-min offset)
- Rationale: leaderboard_matview JOINs cohort_membership; running 5 min AFTER rebuild ensures fresh cohort data. Worst-case D-15 stale window = 15 min after opt-out.

### get_leaderboard_for_user is CLIENT-ONLY (Pitfall 8)
All three SECDEF RPCs use `auth.uid()` to identify the calling user. `auth.uid()` returns NULL in service-role context (cron, fire-and-forget Edge Fns). Therefore:

- `get_leaderboard_for_user` MUST NOT be called from xp-event, xp-grant, admin-grant-freeze-token, or challenge-notify Edge Fns.
- Consumers: Plan 35-05 (admin module), Plan 35-06 (LeaderboardCard widget), Plan 35-08 (Settings → Leaderboards subtab).
- This is documented in comments in 20270708000014_p35_leaderboard_rpcs.sql and in leaderboard.ts.

### UNIQUE INDEX load-bearing for REFRESH CONCURRENTLY (Pitfall 3)
`idx_leaderboard_matview_cohort_user ON leaderboard_matview (cohort_id, user_id)` is required. Without it, `REFRESH MATERIALIZED VIEW CONCURRENTLY` throws `ERROR: cannot refresh materialized view "leaderboard_matview" concurrently`. Proven by pgTAP test `35_matview_concurrent.sql`.

## RLS Design

| Surface | Policy | Rationale |
|---------|--------|-----------|
| leaderboard_optin SELECT | authenticated reads own row | D-12 privacy-default — user can view their own opt-in state |
| leaderboard_optin INSERT/UPDATE/DELETE | No authenticated policy (deny-by-default) | All mutations via set_leaderboard_optin SECDEF RPC (T-35-04-03) |
| leaderboard_optin ALL | service_role with check (true) | Allows SECDEF RPC to write via elevated context |
| leaderboard_matview | No RLS (GRANT SELECT to authenticated, service_role) | Read mediated via get_leaderboard_for_user SECDEF — no direct client access |

## Threat Model Coverage

| ID | Threat | Mitigation | Test |
|----|--------|------------|------|
| T-35-04-01 | User A reads cohort B leaderboard | get_leaderboard_for_user verifies cohort_membership | Vitest test 1 |
| T-35-04-02 | Real name leak via handle | DB CHECK constraint + SECDEF regex | Vitest test 4 |
| T-35-04-03 | Direct INSERT/UPDATE bypasses validation | RLS denies authenticated writes | Vitest tests 5-6 |
| T-35-04-04 | User claims another user's handle | Partial UNIQUE INDEX (cohort_id, handle) WHERE active=true | Vitest test 8 |
| T-35-04-05 | Admin-disabled cohort shows leaderboard | Matview WHERE cd.leaderboard_enabled=true; pgTAP test 3 | pgTAP test 3 |
| T-35-04-07 | REFRESH CONCURRENTLY fails → stale leaderboard | UNIQUE INDEX + pgTAP proof | pgTAP test 35_matview_concurrent.sql |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed it.each destructuring in handle-validate.test.ts**
- **Found during:** Task 4 test run
- **Issue:** `it.each([['PeptidePioneer-7841']])('...', ([h]) => ...)` — Vitest receives the inner array as argument; destructuring `[h]` produced first character `'P'` not the full string.
- **Fix:** Changed to flat array `it.each(['PeptidePioneer-7841', ...])` with direct `(h)` parameter.
- **Files modified:** `leanshot/src/lib/gamification/__tests__/handle-validate.test.ts`
- **Commit:** ebad1af (included in Task 4 commit)

**2. [Rule 1 - Bug] Moved cross-tenant test file to correct path**
- **Found during:** Task 5 test discovery check
- **Issue:** Plan specified `leanshot/test/rls/35-leaderboard-cross-tenant.test.ts` but vitest default config includes `tests/**/*.test.ts` (plural) and `e2e/rls-*.test.ts` — `test/rls/` (singular) is not covered.
- **Fix:** Moved file to `leanshot/tests/rls/35-leaderboard-cross-tenant.test.ts` which is covered by `tests/**/*.test.ts` in the default vitest include.
- **Files modified:** moved from `test/rls/` to `tests/rls/`
- **Commit:** 1ec6a24

## Known Stubs

None — no placeholder data, empty collections, or TODO values were introduced in this plan. All migrations are complete; RPC logic is fully implemented; client wrappers have proper error codes. The Vitest live-DB tests self-skip when env vars are absent (by design, not a stub).

## Self-Check: PASSED

Files exist:
- supabase/migrations/20270708000010_p35_cohort_def_leaderboard_enabled.sql: FOUND
- supabase/migrations/20270708000011_p35_leaderboard_optin.sql: FOUND
- supabase/migrations/20270708000012_p35_leaderboard_matview.sql: FOUND
- supabase/migrations/20270708000013_p35_leaderboard_refresh_cron.sql: FOUND
- supabase/migrations/20270708000014_p35_leaderboard_rpcs.sql: FOUND
- leanshot/src/lib/gamification/handle-validate.ts: FOUND
- leanshot/src/lib/gamification/__tests__/handle-validate.test.ts: FOUND
- leanshot/src/lib/gamification/leaderboard.ts: FOUND
- supabase/tests/35_leaderboard_matview.sql: FOUND
- supabase/tests/35_matview_concurrent.sql: FOUND
- leanshot/tests/rls/35-leaderboard-cross-tenant.test.ts: FOUND
- leanshot/e2e/rls-leaderboard-optin.test.ts: FOUND

Commits verified:
- cd8dc5f: feat(35-04): ALTER cohort_definitions + leaderboard_optin table
- aa96bc3: feat(35-04): leaderboard_matview + UNIQUE INDEX + 15-min refresh cron
- e8bf507: feat(35-04): leaderboard SECDEF RPCs
- ebad1af: feat(35-04): handle-validate client mirror + leaderboard RPC wrappers + 26 unit tests
- 1ec6a24: feat(35-04): pgTAP matview tests + Vitest cross-tenant + opt-in lifecycle proofs
