---
phase: 35-m3-gamification-engine
plan: "02"
subsystem: gamification
tags:
  - streak
  - freeze-tokens
  - pg-cron
  - timezone
  - edge-fn
  - rls
  - pgtap

dependency_graph:
  requires:
    - "35-01 (xp_ledger + compute_level functions)"
    - "Phase 38 profiles.timezone column (20270705000009_phase38_profiles_timezone.sql)"
  provides:
    - "streak_state table + evaluate_streak_for_user SECDEF (plan 35-09 reads last_action_at)"
    - "freeze_tokens_ledger append-only table + freeze_tokens_remaining(p_user) SECDEF (plan 35-06 StreakCard reads balance)"
    - "phase35-streak-evaluate-hourly cron (5 * * * *) + phase35-freeze-monthly-grant cron (15 0 1 * *)"
    - "admin-grant-freeze-token Edge Fn (plan 35-05 FreezeTokenGrant.tsx wires to this)"
    - "pgTAP suites: 35_streak_cron_dst.sql + 35_freeze_token_autoapply.sql"
    - "Vitest RLS suite: e2e/rls-freeze-tokens-ledger.test.ts"
  affects:
    - "plan 35-03 (xp-grant Edge Fn reads streak_state.current_streak_days for streak_day2 bonus)"
    - "plan 35-09 (notification wiring uses evaluate_streak_for_user freeze auto-apply hook)"

tech_stack:
  added:
    - "public.streak_state (PostgreSQL table)"
    - "public.freeze_tokens_ledger (PostgreSQL append-only table)"
    - "public.evaluate_streak_for_user(uuid) (SECDEF plpgsql fn)"
    - "public.freeze_tokens_remaining(uuid) (SECDEF sql fn)"
    - "public.grant_monthly_freeze_tokens() (SECDEF plpgsql fn)"
    - "supabase/functions/admin-grant-freeze-token/ (Deno Edge Fn)"
  patterns:
    - "INSERT…ON CONFLICT (user_id) DO UPDATE — streak_state counter (5 occurrences)"
    - "Append-only ledger with BEFORE UPDATE/DELETE raise-exception triggers"
    - "Named dollar-quote tags: $cron$ outer + $streak$/$grant$ inner (never bare $$)"
    - "UNIQUE INDEX on (user_id, reason, source_ref) WHERE reason IN (...) for cron idempotency"
    - "SECDEF functions with set search_path = public, pg_catalog; param-passing (not auth.uid())"
    - "ES256 generateLink + /auth/v1/verify via plain fetch for Vitest fixtures"

key_files:
  created:
    - supabase/migrations/20270708000004_p35_streak_state.sql
    - supabase/migrations/20270708000005_p35_freeze_tokens_ledger.sql
    - supabase/migrations/20270708000006_p35_streak_cron.sql
    - supabase/migrations/20270708000007_p35_freeze_monthly_grant_cron.sql
    - supabase/functions/admin-grant-freeze-token/index.ts
    - supabase/functions/admin-grant-freeze-token/index.test.ts
    - supabase/functions/admin-grant-freeze-token/deno.json
    - supabase/tests/35_streak_cron_dst.sql
    - supabase/tests/35_freeze_token_autoapply.sql
    - leanshot/e2e/rls-freeze-tokens-ledger.test.ts
  modified: []

decisions:
  - "freeze_tokens_remaining clamps at read time (SUM(delta) via GREATEST/LEAST), not at write time — allows audit overflow rows while keeping usable balance ≤ 3"
  - "evaluate_streak_for_user calls freeze_tokens_remaining and inserts into freeze_tokens_ledger in the same function — forward reference resolved at runtime (Postgres deferred resolution)"
  - "Deno test suite extended to 5 tests (plan spec said 4) by adding T5 OPTIONS preflight — standard Edge Fn coverage"
  - "captureServer uses userId field (not distinctId) per CaptureArgs interface in posthog-server.ts — corrected from plan spec which showed distinctId (Rule 1 fix)"

metrics:
  duration: "17m"
  completed_date: "2026-05-21"
  tasks_completed: 5
  tasks_total: 5
  files_created: 10
  files_modified: 0
---

# Phase 35 Plan 02: Streak State + Freeze Tokens Ledger + Timezone Crons + admin-grant-freeze-token Summary

**One-liner:** DST-safe hourly streak cron with 02:00-local gate, append-only freeze_tokens_ledger with SECDEF balance helper clamped to [0,3], monthly grant cron with idempotency UNIQUE index, and admin-only Edge Fn with granted_by_admin_user_id audit column.

## What Was Built

### Task 1: streak_state + freeze_tokens_ledger tables + helpers + RLS (commit 62d4a5e)

`streak_state` table: one row per user, select-own RLS (no write policies for authenticated), `evaluate_streak_for_user(uuid)` SECDEF function.

Key invariants:
- DST double-fire safe: idempotency keyed on `last_eval_date` — if already evaluated today (user-local), function returns immediately without modifying state.
- D-06 cross-action streak: ANY qualifying XP action (`injection_log`, `weight_log`, `symptom_log`, `workout_log`) yesterday keeps the streak.
- D-08 auto-apply: if missed yesterday AND current_streak_days > 0, checks `freeze_tokens_remaining(p_user) >= 1`; if so, inserts a -1 row into `freeze_tokens_ledger` with `ON CONFLICT DO NOTHING` (idempotent).
- Uses `INSERT … ON CONFLICT (user_id) DO UPDATE` throughout — 5 occurrences; never bare UPDATE.

`freeze_tokens_ledger` table: append-only, `delta int NOT NULL CHECK (delta != 0)`, `reason text CHECK (reason IN ('monthly_grant','auto_apply','admin_grant','challenge_reward','manual_consume'))`, `granted_by_admin_user_id uuid` for D-10 audit.

UNIQUE INDEX on `(user_id, reason, source_ref) WHERE reason IN ('monthly_grant','auto_apply','challenge_reward')` — prevents double-grant on cron retry.

`freeze_tokens_remaining(uuid)` SECDEF: `GREATEST(0, LEAST(3, COALESCE(SUM(delta), 0)))` — callable by both `authenticated` (StreakCard display) and `service_role` (cron auto-apply). Takes `p_user` param, not `auth.uid()`, per `feedback_rpc_auth_uid_vs_service_role_mismatch`.

Defense-in-depth append-only triggers on `freeze_tokens_ledger`: BEFORE UPDATE and BEFORE DELETE raise exceptions with `/append-only/` message.

### Task 2: Cron migrations (commit b1bce69)

**`phase35-streak-evaluate-hourly`** (`5 * * * *`):
- Iterates profiles WHERE `EXTRACT(HOUR FROM (now() AT TIME ZONE p.timezone)) = 2` — fires per-user at 02:00 local.
- Per-user `BEGIN/EXCEPTION` block prevents one user error from aborting the entire batch.
- Outer + inner named dollar-quote: `$cron$ … $cron$` outer, `$streak$ … $streak$` inner. Zero bare `$$`.

**`phase35-freeze-monthly-grant`** (`15 0 1 * *`):
- `grant_monthly_freeze_tokens()` SECDEF: inserts +1 `monthly_grant` row for every profile using `v_month_key = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM')` as `source_ref`.
- `ON CONFLICT DO NOTHING` on UNIQUE INDEX prevents double-grant on cron retry.
- `raise notice` when user SUM > 3 (audit-trail overflow rows inserted but clamped at read time).
- Named dollar-quote: `$cron$ … $cron$` outer, `$grant$ … $grant$` inner.

Both crons use idempotent unschedule-then-schedule pattern (mirrored from `20270706000005_p34_anon_session_ttl_cron.sql`).

### Task 3: admin-grant-freeze-token Edge Fn (commit 132ee56)

User-JWT auth → server-side `profiles.admin_role` check (not just client `surfaceCheck`) → Zod body validation (`delta: z.number().int().min(1).max(2)`, `reason_note: z.string().min(1).max(200)`) → insert with `granted_by_admin_user_id` audit → `captureServer({ userId, event: 'freeze_token_granted' })` → `shutdownPostHog()` in finally.

5 Deno tests pass (T1: 401 missing-bearer, T2: 403 non-admin, T3: 400 invalid-delta, T4: 200 happy-path with audit verification, T5: 204 OPTIONS).

### Task 4: pgTAP suites (commit 69d71d3)

`35_streak_cron_dst.sql` (5 assertions):
1. First evaluation with qualifying action yesterday → streak = 1
2. Re-evaluation same day is no-op (DST double-fire safe)
3. Missed day without freeze tokens → streak breaks to 0
4. `longest_streak_days` preserved (12) across break
5. Null timezone falls back to UTC without erroring

`35_freeze_token_autoapply.sql` (5 assertions):
1. Empty ledger → 0
2. One monthly_grant → 1
3. SUM=5 clamped to max stockpile = 3 (D-08)
4. 3 grants minus 1 auto_apply consume → 2
5. Duplicate monthly_grant blocked by UNIQUE INDEX (23505)

### Task 5: Vitest RLS suite (commit 88bb279)

`leanshot/e2e/rls-freeze-tokens-ledger.test.ts` — 6 tests:
1. User B reads ZERO of user A freeze_tokens_ledger rows
2. User A cannot INSERT directly (no INSERT policy for authenticated)
3. User A cannot UPDATE own row (RLS or append-only trigger blocks)
4. User A cannot DELETE own row (RLS or append-only trigger blocks)
5. streak_state select-own; user B isolation; direct UPDATE denied
6. `freeze_tokens_remaining(p_user)` RPC returns correct balance; T-35-02-06 accept documented inline

ES256 auth pattern: `admin.generateLink + /auth/v1/verify` via plain fetch (not `signInWithPassword`). File-scoped prefix `phase35-freeze-rls-${Date.now()}-`. Self-skipping when `SUPABASE_SERVICE_ROLE_KEY` absent.

## Named Dollar-Quote Confirmation

`grep -c '\$\$' supabase/migrations/20270708000004*.sql supabase/migrations/20270708000005*.sql supabase/migrations/20270708000006*.sql supabase/migrations/20270708000007*.sql` returns **0 occurrences of bare `$$` in non-comment lines** across all 4 migration files. All dollar-quote uses named tags: `$body$`, `$cron$`, `$streak$`, `$grant$`, `$unschedule$`, `$setup$`, etc.

## Cron Jobnames for Plan 35-10 Deploy Verification

| Jobname | Schedule | Purpose |
|---------|----------|---------|
| `phase35-streak-evaluate-hourly` | `5 * * * *` | Per-user streak eval at 02:00 local |
| `phase35-freeze-monthly-grant` | `15 0 1 * *` | Monthly +1 freeze token grant |

Verify after `supabase db push --linked`:
```sql
select jobname, schedule from cron.job where jobname like 'phase35-%';
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed `captureServer` field name: `distinctId` → `userId`**
- **Found during:** Task 3, T4 test execution
- **Issue:** Plan spec showed `captureServer({ distinctId: callerId, ... })` but `CaptureArgs` interface in `_shared/posthog-server.ts:94-96` uses `userId` not `distinctId`. Calling with `distinctId` causes captureServer to throw "userId required" error.
- **Fix:** Changed `distinctId: callerId` to `userId: callerId` in `admin-grant-freeze-token/index.ts`.
- **Files modified:** `supabase/functions/admin-grant-freeze-token/index.ts`
- **Commit:** 132ee56

**2. [Rule 1 - Bug] Deno.serve guard added to prevent port-bind during test import**
- **Found during:** Task 3, first Deno test run
- **Issue:** `Deno.serve(handler)` at module top-level attempts to bind port 8000 when the test file imports `index.ts`, failing with `NotCapable: Requires net access to "0.0.0.0:8000"`.
- **Fix:** Replaced bare `Deno.serve(handler)` with `if (_denoGlobal?.serve) { _denoGlobal.serve(handler); }` guard (mirrors `record-activation/index.ts` pattern). Added `__internal` export exposing `handler` + test seams so tests can call the handler directly without going through Deno.serve.
- **Files modified:** `supabase/functions/admin-grant-freeze-token/index.ts`, `index.test.ts`
- **Commit:** 132ee56

**3. [Rule 2 - Enhancement] Test suite extended to 5 tests (plan spec said 4)**
- Added T5 OPTIONS preflight → 204 test as standard Edge Fn coverage pattern. Not in plan spec but matches sibling Fn test suites.
- **Commit:** 132ee56

**4. [Note] pgTAP Test 4 data setup adjusted from plan spec**
- Plan spec's auto-apply test used the accumulated user from Test 3 (SUM=5, clamped to 3). After consuming 1, SUM=4 → clamp=3 (not 2 as plan said). Resolution: used a fresh user in Test 4 with exactly 3 grants then 1 consume → SUM=2, remaining=2. The plan's stated result (remaining=2) is preserved with correct data.

## Known Stubs

None. All functions are fully implemented. `evaluate_streak_for_user` contains a comment pointing to Plan 35-09 for the user-facing "freeze auto-applied" notification INSERT — this is intentional pending wiring in 35-09, not a stub.

## Self-Check: PASSED

Files exist:
- `supabase/migrations/20270708000004_p35_streak_state.sql` — FOUND
- `supabase/migrations/20270708000005_p35_freeze_tokens_ledger.sql` — FOUND
- `supabase/migrations/20270708000006_p35_streak_cron.sql` — FOUND
- `supabase/migrations/20270708000007_p35_freeze_monthly_grant_cron.sql` — FOUND
- `supabase/functions/admin-grant-freeze-token/index.ts` — FOUND
- `supabase/functions/admin-grant-freeze-token/index.test.ts` — FOUND
- `supabase/functions/admin-grant-freeze-token/deno.json` — FOUND
- `supabase/tests/35_streak_cron_dst.sql` — FOUND
- `supabase/tests/35_freeze_token_autoapply.sql` — FOUND
- `leanshot/e2e/rls-freeze-tokens-ledger.test.ts` — FOUND

Commits exist:
- `62d4a5e` feat(35-02): streak_state + freeze_tokens_ledger — FOUND
- `b1bce69` feat(35-02): streak cron + monthly freeze grant cron — FOUND
- `132ee56` feat(35-02): admin-grant-freeze-token Edge Fn — FOUND
- `69d71d3` test(35-02): pgTAP suites — FOUND
- `88bb279` test(35-02): Vitest RLS suite — FOUND
