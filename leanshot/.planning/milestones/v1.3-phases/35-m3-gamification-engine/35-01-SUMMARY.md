---
phase: 35-m3-gamification-engine
plan: "01"
subsystem: gamification-db-foundation
tags:
  - gamification
  - xp-ledger
  - rls
  - pgtap
  - migrations
  - badge-catalog
dependency_graph:
  requires: []
  provides:
    - xp_ledger (append-only, Phase 35 D-04 source of truth)
    - badge_unlocks (append-only sibling, GAME-09)
    - badge_catalog (17-badge reference seed)
    - compute_level(int) IMMUTABLE pure SQL
    - xp_total_for(uuid) SECDEF STABLE helper
    - compute_prestige(int) IMMUTABLE helper
    - pgTAP: 35_xp_ledger_replay.sql (8 assertions)
    - pgTAP: 35_xp_ledger_rls.sql (4 assertions)
    - Vitest: rls-xp-ledger.test.ts (5 cross-tenant proofs)
  affects:
    - Plan 35-03 (xp-grant triggers call compute_level + xp_total_for)
    - Plan 35-04 (leaderboard matview JOINs xp_ledger rolling-7d)
    - Plan 35-06 (LevelProgressCard reads xp_total_for)
    - Plan 35-07 (OG share-card token references level)
    - Plan 35-09 (notification cycle references streak + level thresholds)
tech_stack:
  added:
    - xp_ledger Postgres table (append-only ledger)
    - badge_unlocks Postgres table (append-only ledger)
    - badge_catalog Postgres table (reference data, 17-badge seed)
    - compute_level() IMMUTABLE SQL function (D-02 quadratic curve)
    - xp_total_for() STABLE SECDEF SQL function
    - compute_prestige() IMMUTABLE SQL function (D-03)
    - pgTAP test files (supabase/tests/)
    - Vitest RLS e2e test (leanshot/e2e/)
  patterns:
    - Negative-space append-only RLS (no INSERT/UPDATE/DELETE for authenticated)
    - Defense-in-depth raise-exception triggers with named $body$ tags
    - SECDEF helper with p_user parameter (not auth.uid()) for cron compatibility
    - File-scoped TEST_SLUG_PREFIX for vitest parallelism safety
key_files:
  created:
    - supabase/migrations/20270708000001_p35_xp_ledger.sql
    - supabase/migrations/20270708000002_p35_compute_level_fn.sql
    - supabase/migrations/20270708000003_p35_badge_catalog_seed.sql
    - supabase/tests/35_xp_ledger_replay.sql
    - supabase/tests/35_xp_ledger_rls.sql
    - leanshot/e2e/rls-xp-ledger.test.ts
  modified: []
decisions:
  - "compute_level is IMMUTABLE (not STABLE) per D-04 + pitfall 1 — allows partial-index use + parallel query plans"
  - "xp_total_for takes p_user uuid param (NOT auth.uid()) per feedback_rpc_auth_uid_vs_service_role_mismatch — callable from cron service-role context"
  - "badge_catalog id field is text PK slug (not uuid) for human-readability and stable FK references in seed data"
  - "ON DELETE SET NULL on user_id FK (not CASCADE) — ledger rows survive account deletion per Phase 7 D-03"
  - "ON DELETE RESTRICT on badge_unlocks.badge_id FK — cannot delete a badge that has been unlocked by any user"
  - "17 badges chosen (5+7+3+1+1) per Research OQ-5; prestige-1 counts as level category badge per plan body"
metrics:
  duration_minutes: 35
  completed: "2026-05-21"
  tasks_completed: 5
  tasks_total: 5
  files_created: 6
  files_modified: 0
---

# Phase 35 Plan 01: XP Ledger + compute_level pure fn + badge_catalog seed + RLS proofs — Summary

**One-liner:** Append-only `xp_ledger` + `badge_unlocks` Postgres foundation with negative-space RLS, IMMUTABLE `compute_level(xp_total)` quadratic curve fn, 17-badge `badge_catalog` seed, and pgTAP + Vitest cross-tenant RLS proofs.

---

## What Was Built

### Migration 1: `20270708000001_p35_xp_ledger.sql`

**xp_ledger table:**
- UUID PK, `user_id` FK with `ON DELETE SET NULL`, `action_type` CHECK constraint (10 values: injection_log, weight_log, symptom_log, workout_log, streak_day2, streak_weekly_milestone, challenge_complete, monthly_milestone, admin_adjustment, combo_unlock)
- `xp_delta int NOT NULL CHECK(xp_delta <> 0)` — signed for admin corrections
- `source_ref text` + `cycle_id text` for traceability + D-09 idempotency
- UNIQUE INDEX on `(user_id, action_type, cycle_id) WHERE cycle_id IS NOT NULL` — anti-double-grant
- INDEX on `(user_id, created_at DESC)` — rolling-7d leaderboard JOIN
- INDEX on `(user_id) INCLUDE (xp_delta)` — SUM(xp_delta) total-XP queries

**RLS (negative-space append-only):**
- `xp_ledger_select_own`: authenticated can only read own rows
- `xp_ledger_service_insert`: explicit service_role insert (grep-able intent)
- NO UPDATE / DELETE / INSERT policies for `authenticated`

**Defense-in-depth triggers:** `_p35_xp_ledger_block_update()` + `_p35_xp_ledger_block_delete()` with named `$body$` tags — raise exception even if a future role grant bypasses RLS.

**badge_unlocks table:** same append-only pattern — UNIQUE `(user_id, badge_id)`, select-own + service_role insert, raise-exception triggers.

### Migration 2: `20270708000002_p35_compute_level_fn.sql`

**`compute_level(xp_total int) → int` — IMMUTABLE + PARALLEL SAFE:**
```sql
select greatest(1, floor(sqrt(greatest(xp_total, 0)::float / 100))::int)
```
D-02 quadratic curve — Level N requires N²×100 XP. Pure math, no session state, no row reads.

**D-02 locked spot-check values:**
| Input XP | Level | Formula check |
|----------|-------|---------------|
| 0        | 1     | always ≥ 1   |
| 100      | 1     | level 1 boundary |
| 400      | 2     | 2²×100 = 400 |
| 2500     | 5     | 5²×100 = 2500 |
| 10000    | 10    | 10²×100 = 10000 |
| 40000    | 20    | 20²×100 = 40000 |
| 1000000  | 100   | 100²×100 = 1000000 |

**`xp_total_for(p_user uuid) → int` — STABLE SECDEF:**
`SELECT coalesce(sum(xp_delta), 0)::int FROM xp_ledger WHERE user_id = p_user`
Takes `p_user` as parameter (NOT `auth.uid()`) — callable from service-role cron contexts.

**`compute_prestige(xp_total int) → int` — IMMUTABLE:**
`greatest(0, compute_level(xp_total) / 100)` — D-03 prestige tier.

### Migration 3: `20270708000003_p35_badge_catalog_seed.sql`

**badge_catalog table:** text PK slug, name, description, category CHECK(streak/level/challenge/combo/social), tier CHECK(1-5), icon_slug (lucide-react), xp_reward default 0.

**RLS:** select-all (reference data) + service_role write.

**FK added:** `badge_unlocks.badge_id → badge_catalog.id ON DELETE RESTRICT ON UPDATE CASCADE`

**17-badge seed (idempotent ON CONFLICT DO NOTHING):**

| id | name | category | tier |
|----|------|----------|------|
| streak-3 | Spark | streak | 1 |
| streak-7 | Week-One Warrior | streak | 2 |
| streak-30 | Month of Momentum | streak | 3 |
| streak-90 | Quarter Champion | streak | 4 |
| streak-365 | Year of Discipline | streak | 5 |
| level-1 | First Step | level | 1 |
| level-5 | Steady Climber | level | 2 |
| level-10 | Established | level | 3 |
| level-25 | Veteran | level | 3 |
| level-50 | Master | level | 4 |
| level-100 | Legend | level | 5 |
| prestige-1 | Prestige I | level | 5 |
| challenge-log-count | Logging Streak Done | challenge | 2 |
| challenge-streak-days | Streak Goal Hit | challenge | 2 |
| challenge-specific-action | Mission Accomplished | challenge | 2 |
| combo-cross-streak | Compound Consistency | combo | 4 |
| social-leaderboard-first | First on the Board | social | 2 |

**Total: 17** (5 streak + 7 level + 3 challenge-category + 1 combo + 1 social-proof)

### pgTAP Test: `35_xp_ledger_replay.sql` (8 assertions)

- **Test 1 (D-04):** Inserts same 25-row sequence in forward + reverse order for two synthetic users; asserts `compute_level(xp_total_for(uid_a)) = compute_level(xp_total_for(uid_b))` — replay yields identical level regardless of insert order.
- **Tests 2-8:** D-02 locked spot-check assertions for compute_level and compute_prestige.
- `begin/rollback` — leaves no residue.

### pgTAP Test: `35_xp_ledger_rls.sql` (4 assertions)

- `policies_are`: exactly `xp_ledger_select_own` + `xp_ledger_service_insert` — no UPDATE/DELETE policies
- `throws_ok` UPDATE: defense-in-depth trigger blocks row update
- `throws_ok` DELETE: defense-in-depth trigger blocks row delete
- `provolatile = 'i'`: compute_level is IMMUTABLE (D-04 marker)

### Vitest Suite: `rls-xp-ledger.test.ts` (5 cross-tenant tests)

- T1: user B reads ZERO of user A rows; admin confirms 3 exist (guards false-pass)
- T2: user B INSERT fails 42501 (no INSERT policy for authenticated)
- T3: user A UPDATE own row blocked (trigger + RLS, defense-in-depth)
- T4: user A DELETE own row blocked (trigger + RLS, defense-in-depth)
- T5: service_role badge_unlocks insert succeeds; user A direct INSERT fails 42501
- `describeIfLive` guard: skips when env vars absent (CI safe)
- File-scoped `TEST_SLUG_PREFIX = phase35-xp-rls-${Date.now()}-`

---

## Deviations from Plan

None — plan executed exactly as written.

All dollar-quote tags are named (`$body$`, `$sql$`). No bare `$$` used anywhere.

---

## Known Stubs

None. All tables, functions, tests, and seed data are complete and functional. No placeholder values or TODO markers.

---

## Threat Flags

No new security-relevant surface introduced beyond what the plan's `<threat_model>` documented (T-35-01-01 through T-35-01-08 all addressed).

---

## Self-Check: PASSED

| Check | Result |
|-------|--------|
| `supabase/migrations/20270708000001_p35_xp_ledger.sql` | FOUND |
| `supabase/migrations/20270708000002_p35_compute_level_fn.sql` | FOUND |
| `supabase/migrations/20270708000003_p35_badge_catalog_seed.sql` | FOUND |
| `supabase/tests/35_xp_ledger_replay.sql` | FOUND |
| `supabase/tests/35_xp_ledger_rls.sql` | FOUND |
| `leanshot/e2e/rls-xp-ledger.test.ts` | FOUND |
| Commit c237a6c (Task 1) | VERIFIED |
| Commit de6cbc8 (Task 2) | VERIFIED |
| Commit 2f2d9b8 (Task 3) | VERIFIED |
| Commit 0a3382a (Task 4) | VERIFIED |
| Commit ed92f9e (Task 5) | VERIFIED |
| Migration filenames match `^\d{14}_p35_[a-z_]+\.sql` | PASSED |
| 17 badges in seed | VERIFIED (5+7+3+1+1) |
| No bare `$$` dollar-quote tags | PASSED |
