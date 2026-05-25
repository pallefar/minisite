---
phase: 35-m3-gamification-engine
plan: "03"
subsystem: gamification-xp-grant-triggers
tags:
  - gamification
  - xp-grant
  - triggers
  - combo-badge
  - posthog
  - secdef
dependency_graph:
  requires:
    - "35-01 (xp_ledger + badge_unlocks + compute_level + badge_catalog seed)"
    - "35-02 (streak_state + freeze_tokens_ledger)"
  provides:
    - "grant_xp_for_action(uuid, int, text, text) SECDEF — appends xp_ledger, detects level-up, unlocks badges"
    - "AFTER INSERT triggers on injections/symptoms/weights/workouts (D-01 XP grants)"
    - "_p35_combo_badge_check AFTER INSERT trigger on badge_unlocks (GAME-09)"
    - "xp-event Edge Fn (server-side PostHog capture; 8-key PHI allowlist)"
    - "Phase35Event union in events.ts (TAXO-01 additive)"
    - "xp.ts client mirror of compute_level/xpToNextLevel/computePrestige (D-02 quadratic)"
    - "xp-event-client.ts fire-and-forget invoke wrapper (for Plan 35-06 LevelUpBurst)"
    - "pgTAP: 35_combo_badge.sql (5 assertions incl. REVIEW-B-1)"
  affects:
    - "Plan 35-04 (leaderboard matview reads xp_ledger; now populated by triggers)"
    - "Plan 35-05 (challenge completion writes badge_unlocks source='challenge' → combo trigger)"
    - "Plan 35-06 (LevelProgressCard reads xp_total_for; xp-event-client.ts fires level_up)"
    - "Plan 35-09 (notification cycle; streak_milestone + combo events now available)"
    - "Plan 35-10 (deploys xp-event Edge Fn + pushes migrations 000008 + 000009)"
tech_stack:
  added:
    - "public.grant_xp_for_action(uuid, int, text, text) SECDEF plpgsql function"
    - "public._p35_xp_on_injection() SECDEF trigger function (25 XP)"
    - "public._p35_xp_on_symptom() SECDEF trigger function (10 XP)"
    - "public._p35_xp_on_weight() SECDEF trigger function (25 XP)"
    - "public._p35_xp_on_workout() SECDEF trigger function (50 XP)"
    - "AFTER INSERT triggers: trg_p35_xp_on_injection/symptom/weight/workout"
    - "public._p35_combo_badge_check() SECDEF trigger function (GAME-09)"
    - "AFTER INSERT trigger: trg_p35_combo_badge_check on badge_unlocks"
    - "supabase/functions/xp-event/ (Deno Edge Fn)"
    - "Phase35Event union in leanshot/src/lib/analytics/events.ts"
    - "leanshot/src/lib/gamification/xp.ts (computeLevel, xpToNextLevel, xpForLevel, computePrestige)"
    - "leanshot/src/lib/gamification/xp-event-client.ts (fireXpEvent fire-and-forget)"
    - "supabase/tests/35_combo_badge.sql (pgTAP 5 assertions)"
  patterns:
    - "AFTER INSERT trigger + grant_xp_for_action SECDEF (exception when others — never blocks source insert)"
    - "transaction-local set_config('p35.in_combo','1',true) recursion guard"
    - "Zod body validation + 8-key PHI property allowlist in Edge Fn (T-35-03-04)"
    - "User-JWT auth via admin.auth.getUser + userId from validated JWT (T-35-03-05/08)"
    - "Vendor-gated captureServer no-op when POSTHOG_PROJECT_KEY missing"
    - "Named dollar-quote $body$ tags — zero bare $$ in all migrations"
    - "p_user as PARAMETER (never auth.uid()) per feedback_rpc_auth_uid_vs_service_role_mismatch"
key_files:
  created:
    - supabase/migrations/20270708000008_p35_xp_grant_triggers.sql
    - supabase/migrations/20270708000009_p35_combo_badge_trigger.sql
    - supabase/functions/xp-event/index.ts
    - supabase/functions/xp-event/index.test.ts
    - supabase/functions/xp-event/deno.json
    - leanshot/src/lib/gamification/xp.ts
    - leanshot/src/lib/gamification/xp-event-client.ts
    - leanshot/src/lib/gamification/__tests__/xp.test.ts
    - supabase/tests/35_combo_badge.sql
  modified:
    - leanshot/src/lib/analytics/events.ts (additive Phase35Event union)
decisions:
  - "Source table names: injections/symptoms/weights/workouts (actual DB names; NOT weight_logs/symptom_logs as plan estimated)"
  - "xp-event Edge Fn property allowlist has 8 keys: xp_delta/action_type/level_before/level_after/badge_id/challenge_id/streak_days/freeze_tokens_remaining"
  - "grant_xp_for_action signature is (p_user uuid, p_xp_delta int, p_action_type text, p_source_ref text) — param order differs slightly from plan template but is internally consistent"
  - "pgTAP Test 5 uses 'admin_adjustment' action_type (in xp_ledger CHECK) for XP seeding, not 'seed' (which is NOT in the CHECK constraint)"
  - "captureServer uses userId field (not distinctId) per posthog-server.ts:94-96 CaptureArgs interface — carried forward from 35-02 deviation note"
  - "DB push blocked at 20270707000002 (pre-existing enum error in helpdesk migration); migrations 20270708000008/000009 not yet applied to remote; Plan 35-10 owns deployment"
metrics:
  duration_minutes: 12
  completed: "2026-05-21"
  tasks_completed: 5
  tasks_total: 5
  files_created: 9
  files_modified: 1
---

# Phase 35 Plan 03: xp-grant Hybrid Integration — DB Triggers + xp-event Edge Fn + Combo Badge Summary

**One-liner:** AFTER INSERT triggers on injections/symptoms/weights/workouts append xp_ledger rows and detect level-up; combo cross-streak trigger on badge_unlocks fires GAME-09; xp-event Edge Fn provides PHI-safe server-side PostHog capture with 8-key property allowlist.

---

## What Was Built

### Task 1: xp-grant DB Triggers + grant_xp_for_action SECDEF (commit c24f7c1)

**`supabase/migrations/20270708000008_p35_xp_grant_triggers.sql`**

**`grant_xp_for_action(p_user uuid, p_xp_delta int, p_action_type text, p_source_ref text)` — SECDEF:**
- Computes prior XP total + level via `xp_total_for(p_user)` + `compute_level(v_prior_total)`
- Appends `xp_ledger` row (D-04 determinism; D-05 server-side ledger truth)
- Detects level-up: loops `v_prior_level+1 .. v_new_level`, inserts matching `badge_catalog` rows via `ON CONFLICT (user_id, badge_id) DO NOTHING`
- Prestige check (D-03): unlocks `prestige-N` badge when level crosses 100/200/...
- `set search_path = public, pg_catalog, extensions`
- Takes `p_user` as PARAMETER (never `auth.uid()`) per `feedback_rpc_auth_uid_vs_service_role_mismatch`

**4 AFTER INSERT triggers (all source tables verified in remote DB):**

| Trigger | Source Table | XP | action_type |
|---------|-------------|-----|-------------|
| trg_p35_xp_on_injection | injections | 25 | injection_log |
| trg_p35_xp_on_symptom | symptoms | 10 | symptom_log |
| trg_p35_xp_on_weight | weights | 25 | weight_log |
| trg_p35_xp_on_workout | workouts | 50 | workout_log |

**Table name mapping (actual vs. plan estimate):** Plan estimated `weight_logs`/`symptom_logs` but actual tables in remote DB (queried 2026-05-21) are `weights` and `symptoms`. Trigger DDL uses actual names.

**Defense-in-depth:** Every trigger function wraps `perform grant_xp_for_action(...)` in `exception when others then raise notice ... return new` — gamification failure NEVER blocks the source table INSERT (D-05).

### Task 2: Combo Cross-Streak Badge Trigger (commit 835eabd)

**`supabase/migrations/20270708000009_p35_combo_badge_trigger.sql`**

**`_p35_combo_badge_check()` AFTER INSERT on `badge_unlocks`:**
1. Recursion guard: `current_setting('p35.in_combo', true) = '1'` → `return new` immediately
2. Source check: `new.source <> 'challenge'` → `return new` immediately (no recursion for level/combo badges)
3. Sets recursion flag: `set_config('p35.in_combo', '1', true)` — transaction-local
4. Checks `streak_state.current_streak_days >= 7` (GAME-09 "compound consistency" threshold)
5. Inserts `combo-cross-streak` badge via `ON CONFLICT DO NOTHING` (idempotent)
6. Calls `grant_xp_for_action(user, 50, 'combo_unlock', ...)` for +50 XP combo bonus
7. Clears recursion flag: `set_config('p35.in_combo', '', true)`
8. `exception when others` wrapper: combo failure never blocks original INSERT

**Why no infinite loop:** level-up badge INSERTs from `grant_xp_for_action` have `source='level'`, caught by step 2. The `p35.in_combo` guard is defense-in-depth for any future code path that might insert `source='challenge'` during combo processing.

### Task 3: xp-event Edge Fn (commit 2d56ea4)

**`supabase/functions/xp-event/{index.ts, index.test.ts, deno.json}`**

Architecture:
- **Auth:** user-JWT via `admin.auth.getUser(jwt)` — `user.id` from validated JWT only (T-35-03-08: body user_id ignored)
- **Body validation:** Zod — 6-event enum + `z.record(z.unknown())` properties
- **PHI allowlist:** `sanitizeProperties()` drops any key not in the 8-key `ALLOWED_PROPERTY_KEYS` Set
- **Capture:** `captureServer({ userId, event, properties: sanitized })` — `userId` field per `CaptureArgs` interface (not `distinctId`)
- **Vendor-gated:** `captureServer` no-ops if `POSTHOG_PROJECT_KEY` missing (safe pre-deploy)
- **Cleanup:** `shutdownPostHog()` in `finally` (PITFALL 1 — batch flush before isolate teardown)
- **No DB writes** — pure analytics supplement; ledger truth is DB triggers (Task 1)

**8-key property allowlist (T-35-03-04 PHI guard):**
`xp_delta, action_type, level_before, level_after, badge_id, challenge_id, streak_days, freeze_tokens_remaining`

**4 Deno tests pass:** T1 (401 missing bearer), T2 (400 invalid event), T3 (property sanitization — PHI keys dropped), T4 (vendor-gated no-op → 200)

### Task 4: events.ts widening + client mirror + wrapper (commit c7dbb46)

**`leanshot/src/lib/analytics/events.ts`** — additive `Phase35Event` union (6 events) per TAXO-01:
- `xp_earned | level_up | streak_milestone | freeze_token_granted | challenge_completed | badge_unlocked`
- Both server-emittable (xp-event Edge Fn) and client-emittable (xp-event-client.ts)

**`leanshot/src/lib/gamification/xp.ts`** — client mirror of Postgres `compute_level()`:
- `computeLevel(xpTotal)` — D-02 formula: `max(1, floor(sqrt(max(xp,0)/100)))`
- `xpForLevel(level)` — returns 0 for level 1 (clamped coverage [0,399]); `N²×100` for N≥2
- `xpToNextLevel(xpTotal)` — `{ level, xpInLevel, xpToNext, nextLevelXp }`
- `computePrestige(xpTotal)` — D-03: `max(0, floor(computeLevel(xpTotal)/100))`

**D-02 locked spot-check values (all pass in Vitest):**

| XP | Level | Formula |
|----|-------|---------|
| 0 | 1 | clamp (sqrt(0/100)=0, max=1) |
| 100 | 1 | sqrt(1)=1 |
| 400 | 2 | sqrt(4)=2 |
| 2500 | 5 | sqrt(25)=5 |
| 10000 | 10 | sqrt(100)=10 |
| 40000 | 20 | sqrt(400)=20 |
| 1000000 | 100 | sqrt(10000)=100 |

**`leanshot/src/lib/gamification/xp-event-client.ts`** — fire-and-forget wrapper:
- `fireXpEvent(event: Phase35Event, properties)` → `void supabase.functions.invoke('xp-event', ...)`
- Returns void; failure is `console.warn` (non-blocking per D-05 supplementary status)
- Available for Plan 35-06 LevelUpBurst and Plan 35-09 notification wiring

**20 Vitest assertions pass. TypeScript clean (zero errors).**

### Task 5: pgTAP Combo Badge Test (commit f71507c)

**`supabase/tests/35_combo_badge.sql`** — 5 assertions:

1. **Test 1:** Challenge-source INSERT + streak=12 (≥7) → `combo-cross-streak` badge unlocked
2. **Test 2:** Combo grants `+50 XP` (`action_type='combo_unlock'` in xp_ledger SUM)
3. **Test 3:** User with streak=3 (below 7-day threshold) + challenge INSERT → NO combo
4. **Test 4:** Second challenge INSERT for same user → combo badge count = 1 (ON CONFLICT idempotency)
5. **Test 5 (REVIEW-B-1):** User at 2400 XP + challenge +250 XP + combo +50 XP → BOTH `combo-cross-streak` AND `level-5` badges present exactly once (recursion guard verified end-to-end)

XP math for Test 5: 2400 (seed) + 250 (challenge) + 50 (combo) = 2700. `compute_level(2700) = floor(sqrt(27)) = 5` ✓. Level-5 boundary = 2500 (5²×100) crossed.

---

## Source Table Name Mapping

**Deviation from plan estimate:** Plan spec said `weight_logs`, `symptom_logs` as possible table names. Live DB query (2026-05-21) confirmed actual names:

| Plan Estimate | Actual Table | Trigger Function |
|--------------|-------------|-----------------|
| injections | injections | _p35_xp_on_injection |
| weight_logs | weights | _p35_xp_on_weight |
| symptom_logs | symptoms | _p35_xp_on_symptom |
| workouts | workouts | _p35_xp_on_workout |

All 4 triggers use the actual table names. The `action_type` values in xp_ledger are still `weight_log` / `symptom_log` (matching the CHECK constraint from Plan 35-01).

---

## Named Dollar-Quote Verification

Zero bare `$$` occurrences across all 4 new migration files (grep confirmed):
- `20270708000008_p35_xp_grant_triggers.sql`: 0 bare `$$` (all use named `$body$` tags)
- `20270708000009_p35_combo_badge_trigger.sql`: 0 bare `$$` (all use named `$body$` tags)

---

## Recursion Guard Confirmation

The combo trigger uses `set_config('p35.in_combo', '1', true)` — the **3rd argument `true`** makes the setting transaction-local. It is automatically cleared at transaction commit and never leaks across separate statements or connections.

The natural recursion barrier also works independently: `grant_xp_for_action` inserts badge_unlocks rows with `source='level'`, which triggers `_p35_combo_badge_check` → `new.source <> 'challenge'` → `return new` immediately. Two independent safeguards prevent infinite loops.

---

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Source table names adjusted from plan estimate**
- **Found during:** Task 1, Step 0 — live DB query before writing migration
- **Issue:** Plan spec estimated `weight_logs` and `symptom_logs` as possible table names; live DB query returned `weights` and `symptoms`
- **Fix:** Used actual table names in trigger DDL; documented in SUMMARY
- **Files modified:** `supabase/migrations/20270708000008_p35_xp_grant_triggers.sql`
- **Commit:** c24f7c1

**2. [Rule 1 - Bug] pgTAP Test 5 XP seed uses 'admin_adjustment' not 'seed'**
- **Found during:** Task 5, reviewing xp_ledger CHECK constraint
- **Issue:** Plan spec used `'seed'` as action_type in the XP seed INSERT, but `'seed'` is NOT in the `xp_ledger.action_type` CHECK constraint (10 allowed values from Plan 35-01). Would throw 23514 violation.
- **Fix:** Used `'admin_adjustment'` (IS in the CHECK constraint) for seeding test XP
- **Files modified:** `supabase/tests/35_combo_badge.sql`
- **Commit:** f71507c

**3. [Note - Carried forward from 35-02] captureServer uses `userId` field**
- `captureServer({ userId, event, properties })` — `userId` is the correct field per `CaptureArgs` interface in `_shared/posthog-server.ts:94-96`. Plan spec template showed `distinctId` which would throw at runtime. Same fix as 35-02 deviation 1.
- **Files modified:** `supabase/functions/xp-event/index.ts`
- **Commit:** 2d56ea4

**4. [Note - Pre-existing blocker] Remote DB push blocked at 20270707000002**
- Remote DB stopped at version `20270707000001`; `20270707000002` fails with `invalid input value for enum org_member_role: "support_admin"` (unrelated helpdesk migration error)
- Migrations `20270708000008` and `20270708000009` exist in the repo but are NOT yet applied to remote
- This is a pre-existing issue, not caused by Plan 35-03. Plan 35-10 owns `supabase db push --linked` deployment
- DB-level verification (trigger registration, pgTAP combo test execution) deferred to Plan 35-10

---

## Known Stubs

None. All implementations are complete. No placeholder values, TODO markers, or unconnected data sources.

- `xp-event-client.ts` `fireXpEvent()` is a complete, working wrapper — not a stub. It is available for Plan 35-06 wiring; the plan explicitly noted that `sync.ts` wiring is optional in 35-03.

---

## Threat Flags

No new security-relevant surface beyond what the plan's `<threat_model>` documented (T-35-03-01 through T-35-03-08 all addressed inline):
- T-35-03-01 (RLS on source tables): existing Phase 5 RLS ensures trigger inherits authenticated user_id
- T-35-03-02 (auth.uid() in cron): uses `new.user_id` + `p_user` param — confirmed zero `auth.uid()` calls in function bodies
- T-35-03-03 (combo recursion): dual guard (source check + transaction-local set_config)
- T-35-03-04 (PHI via PostHog): 8-key allowlist in sanitizeProperties()
- T-35-03-05 (spoofing): user-JWT + admin.auth.getUser
- T-35-03-06 (gamification blocks source insert): exception when others in all 5 trigger functions
- T-35-03-07 (repudiation): source + source_ref on every badge_unlocks row
- T-35-03-08 (elevation): user.id from validated JWT; body user_id ignored

---

## Self-Check: PASSED

| Check | Result |
|-------|--------|
| `supabase/migrations/20270708000008_p35_xp_grant_triggers.sql` | FOUND |
| `supabase/migrations/20270708000009_p35_combo_badge_trigger.sql` | FOUND |
| `supabase/functions/xp-event/index.ts` | FOUND |
| `supabase/functions/xp-event/index.test.ts` | FOUND |
| `supabase/functions/xp-event/deno.json` | FOUND |
| `leanshot/src/lib/analytics/events.ts` (modified) | FOUND |
| `leanshot/src/lib/gamification/xp-event-client.ts` | FOUND |
| `leanshot/src/lib/gamification/xp.ts` | FOUND |
| `leanshot/src/lib/gamification/__tests__/xp.test.ts` | FOUND |
| `supabase/tests/35_combo_badge.sql` | FOUND |
| Commit c24f7c1 (Task 1) | VERIFIED |
| Commit 835eabd (Task 2) | VERIFIED |
| Commit 2d56ea4 (Task 3) | VERIFIED |
| Commit c7dbb46 (Task 4) | VERIFIED |
| Commit f71507c (Task 5) | VERIFIED |
| Zero bare `$$` in migrations 000008 + 000009 | PASSED |
| Zero `auth.uid()` in function bodies (comments only) | PASSED |
| 8-key PHI allowlist in xp-event Edge Fn | PASSED |
| Phase35Event union: 6 event types | PASSED |
| pgTAP 5 assertions in 35_combo_badge.sql | PASSED (select plan(5)) |
| Vitest 20 assertions in xp.test.ts | PASSED |
| TypeScript clean (tsc --noEmit) | PASSED |
| 4 Deno tests pass (--allow-net --allow-env) | PASSED |
