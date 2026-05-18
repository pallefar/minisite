---
phase: 31-white-label-path-based-org-roles-clinic-onboarding-builder
plan: 01
subsystem: auth
tags: [rbac, postgres, secdef, vitest, bundle-ceiling, org-roles, has_permission]

requires:
  - phase: 31-white-label-path-based-org-roles-clinic-onboarding-builder/31-00
    provides: org_member_role enum renamed (owner/clinician/staff); _is_org_owner SECDEF in place

provides:
  - "DB SECDEF public.has_permission(role, perm) — 12-key CASE expression; security floor for all P31 admin RPCs"
  - "DB SECDEF public.get_caller_role(org_id) — resolves auth.uid() role for org; used by all downstream SECDEFs"
  - "TS ROLE_PERMISSIONS const (3 roles × 12 keys per D-03) — UX-hint mirror of DB matrix"
  - "role-matrix-sync.test.ts — 36 (role, perm) pair assertions; guards DB↔TS drift in CI (wave-2-gated)"
  - "CLINIC_CEILING raised 36000→50000 in assert-clinic-bundle-budget.sh"

affects:
  - 31-02 (save_org_branding SECDEF calls has_permission(get_caller_role(org_id), 'branding.edit'))
  - 31-04 (save_org_onboarding_flow + activate_onboarding_flow_version + mark_onboarding_complete SECDEFs)
  - 31-05 (change_member_role SECDEF calls has_permission(get_caller_role(org_id), 'members.role.edit'))
  - All P31 admin-mutation SECDEFs gate on has_permission + get_caller_role as first-line guard

tech-stack:
  added: []
  patterns:
    - "D-02 source-of-truth: DB has_permission() is security floor; TS ROLE_PERMISSIONS is client UX hint"
    - "Role matrix sync test: 36-pair vitest asserts DB CASE == TS Set across all (role, perm) combinations"
    - "Wave-gated tests: committed in Wave 1, skip via env-gate until Wave 2 BLOCKING push activates them"

key-files:
  created:
    - supabase/migrations/20270601310101_p31_01_has_permission_secdef.sql
    - src/lib/__tests__/role-matrix-sync.test.ts
  modified:
    - src/lib/org.ts
    - scripts/assert-clinic-bundle-budget.sh

key-decisions:
  - "has_permission() declared IMMUTABLE (pure CASE over inputs; no relation reads) — allows PostgreSQL to optimize call sites that call it from other IMMUTABLE contexts"
  - "CLINIC_CEILING raised to 50000 (not 48000) — RESEARCH Finding 10 MEDIUM-confidence ±2 kB variance; 50 kB gives ~3.5 kB headroom vs 48 kB's ~1.5 kB; one-line bash revert if needed"
  - "getAdmin() lazy-initialized in beforeAll inside describe block (not at module scope) — prevents SupabaseClient constructor from throwing when env vars are unset in describe.skip context"
  - "anon role NOT granted EXECUTE on has_permission/get_caller_role — no anon client code path needs capability checks; reduces blast radius (T-31-01-04)"

patterns-established:
  - "Wave-gated test pattern: commit test in Wave 1, add SHOULD_RUN env-gate, documents in SUMMARY as wave-2-gated; CI exercises 36 assertions after 31-04 BLOCKING push"
  - "Lazy admin client init pattern: declare `let admin: SupabaseClient` outside tests, init in beforeAll — avoids constructor throw in describe.skip context"

requirements-completed: [ORG-12]

duration: 7min
completed: 2026-05-18
---

# Phase 31 Plan 01: `has_permission` + `get_caller_role` SECDEFs + 12-key ROLE_PERMISSIONS + sync vitest + CLINIC_CEILING raise Summary

**PostgreSQL SECURITY DEFINER `has_permission(role, perm)` + `get_caller_role(org_id)` installed as the security floor for all Phase 31 admin-mutation RPCs, backed by an expanded 12-key `ROLE_PERMISSIONS` TS const mirror and a 36-pair DB↔TS sync vitest, with CLINIC_CEILING pre-raised to 50 kB for Wave 2**

## Performance

- **Duration:** 7 min
- **Started:** 2026-05-18T07:55:16Z
- **Completed:** 2026-05-18T08:01:55Z
- **Tasks:** 4 completed
- **Files modified:** 4

## Accomplishments

- Deployed `has_permission(org_member_role, text) returns boolean` SECDEF — IMMUTABLE CASE expression encoding all 36 (role, perm) pairs per D-03; downstream 31-02/04/05 SECDEFs can call it without forward-reference
- Deployed `get_caller_role(uuid) returns org_member_role` SECDEF — resolves `auth.uid()`'s role for an org; returns null when not a member; no p_user_id param prevents impersonation (T-31-01-03)
- Expanded `ROLE_PERMISSIONS` const from 6-key Phase 28 skeleton to full 12-key D-03 matrix (owner=12, clinician=4, staff=2) — `surfaceCheck()` gains new keys automatically
- Created `role-matrix-sync.test.ts` with 38 vitest assertions (36 pairs + 2 sanity); SKIPs cleanly without SUPABASE env (38 skipped); exercises live DB after 31-04's BLOCKING push
- Raised `CLINIC_CEILING` 36000→50000 as standalone atomic commit with full history comment block

## Task Commits

1. **Task 1: Raise CLINIC_CEILING 36000→50000** - `d9c205f` (chore)
2. **Task 2: Postgres migration — has_permission() + get_caller_role() SECDEFs** - `d581b49` (feat)
3. **Task 3: Expand ROLE_PERMISSIONS to 12 keys per D-03** - `bdb1d4b` (feat)
4. **Task 4: Create role-matrix-sync vitest** - `7202f13` (test)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `/Users/karstenhaldan/minisite/supabase/migrations/20270601310101_p31_01_has_permission_secdef.sql` — 2 new SECDEFs (has_permission IMMUTABLE + get_caller_role STABLE), both SECURITY DEFINER with explicit search_path; REVOKE ALL from public + GRANT to authenticated + service_role only; migration held on branch (NOT pushed — 31-04 BLOCKING task owns push)
- `/Users/karstenhaldan/minisite/leanshot/src/lib/org.ts` — ROLE_PERMISSIONS const expanded from 6 to 12 keys; owner Set gains members.role.edit/onboarding.edit/roster.view/roster.thresholds.edit/alerts.ack/alerts.snooze/billing.view; clinician gains roster.view/alerts.ack/alerts.snooze; staff gains roster.view; removes legacy patients.link; JSDoc updated to reference Phase 31 D-03
- `/Users/karstenhaldan/minisite/leanshot/src/lib/__tests__/role-matrix-sync.test.ts` — NEW: 38-assertion vitest (36 (role, perm) DB↔TS equality checks + 2 sanity); lazy admin client init in beforeAll; describeIfLive pattern; SKIPs without SUPABASE env
- `/Users/karstenhaldan/minisite/leanshot/scripts/assert-clinic-bundle-budget.sh` — CLINIC_CEILING raised to 50000; 14-line history comment block added; PHASE_31_REF constant added

## Decisions Made

- **IMMUTABLE vs STABLE for has_permission**: Declared IMMUTABLE since the function body is a pure CASE expression over its two arguments — no relation reads. This allows PostgreSQL query planner to optimize calls.
- **CLINIC_CEILING 50000 vs 48000**: RESEARCH Finding 10 is MEDIUM-confidence with ±2 kB variance. 50 kB gives ~3.5 kB headroom over the projected ~46.5 kB post-Phase-31 measurement. Reverting to 48 kB is a one-line bash change if 31-05's actual measurement comes in under 47 kB.
- **Lazy admin client init**: The original test had `const admin = getAdmin()` at describe-body scope. When `describeIfLive` is `describe.skip`, the describe body still executes synchronously during setup — and `createClient` with an empty URL throws. Fixed by declaring `let admin: SupabaseClient` and initializing in `beforeAll` (which is only called when tests actually run, not in describe.skip).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Lazy-init admin client to prevent SupabaseClient constructor throw in describe.skip**
- **Found during:** Task 4 (Create role-matrix-sync vitest)
- **Issue:** Plan's code sketch had `const admin = getAdmin()` inside the describe block. When `SHOULD_RUN === false`, `describeIfLive` is `describe.skip` but the describe body still executes synchronously — causing `createClient(SUPABASE_URL='', ...)` to throw `Error: supabaseUrl is required`.
- **Fix:** Declared `let admin: SupabaseClient` outside tests and moved `admin = getAdmin()` into `beforeAll()`. `beforeAll` callbacks only execute when the describe block is not skipped.
- **Files modified:** `src/lib/__tests__/role-matrix-sync.test.ts`
- **Verification:** `SUPABASE_URL= SUPABASE_SERVICE_ROLE_KEY= SUPABASE_ANON_KEY= npx vitest run src/lib/__tests__/role-matrix-sync.test.ts` exits 0 with 38 skipped
- **Committed in:** `7202f13` (Task 4 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug)
**Impact on plan:** Single fix necessary for the skip-without-env contract. No scope creep.

## Known Stubs

None — this plan ships infrastructure (SECDEFs + TS const + sync test + ceiling raise), no UI rendering paths.

## Threat Flags

No new threat surface beyond what the plan's `<threat_model>` already covers.

## Sync Test Gating (Wave-2-Gated)

The `role-matrix-sync.test.ts` test is **wave-2-gated**: it SKIPs in CI (via `SHOULD_RUN` env-gate) until Plan 31-04's BLOCKING `supabase db push --linked` lands the `20270601310101_p31_01_has_permission_secdef.sql` migration on the live DB. This is intentional — the test is committed in Wave 1 so it cannot be "forgotten" before 31-04 push. Once the migration is live, the test exercises all 36 `(role, perm)` assertions against the real `has_permission()` SECDEF.

Do NOT treat the SKIP status between Wave 1 and Wave 2 as a broken test.

## Bundle Ceiling History

`12 → 16 → 17 → 17 → 25 → 22 → 28 → 30 → 35 → 36 → 50 kB`

Measured clinic chunk at plan completion: **35,453 bytes gz** (well under new 50 kB ceiling, confirming ~14.5 kB headroom for Wave 2 additions). Wave 2 plan 31-05 should tighten back toward `measured + ~1 kB headroom` per D-08 discipline at phase close.

## No Live DB Changes From This Plan

Migration `20270601310101_p31_01_has_permission_secdef.sql` sits as a pending file on the branch. Live DB state is unchanged from Plan 31-00's push. Plan 31-04 BLOCKING task owns `supabase db push --linked` for all Wave 1+2 P31 migrations.

## Open Items Handed to 31-04

- Push migration `20270601310101_p31_01_has_permission_secdef.sql` as part of its BLOCKING `supabase db push --linked` step
- After push: run `SUPABASE_URL=... npx vitest run src/lib/__tests__/role-matrix-sync.test.ts` to verify all 36 pair assertions pass against the live DB

## Issues Encountered

None beyond the admin-client lazy-init deviation documented above.

## Next Phase Readiness

- Plan 31-02 (save_org_branding SECDEF) can now reference `has_permission(get_caller_role(p_org_id), 'branding.edit')` as its first-line guard
- Plan 31-04 and 31-05 similarly unblocked for their respective permission keys
- Wave 1 is complete; Wave 2 plans (31-02 through 31-05) are unblocked

## Self-Check

Verified before finalizing:
- `d9c205f` exists in git log ✓
- `d581b49` exists in git log ✓
- `bdb1d4b` exists in git log ✓
- `7202f13` exists in git log ✓
- `/Users/karstenhaldan/minisite/supabase/migrations/20270601310101_p31_01_has_permission_secdef.sql` exists ✓
- `/Users/karstenhaldan/minisite/leanshot/src/lib/__tests__/role-matrix-sync.test.ts` exists ✓
- CLINIC_CEILING=50000 verified via grep ✓
- tsc --noEmit passes ✓
- vitest skip-without-env exits 0, 38 skipped ✓
- npm run build + bash scripts/assert-clinic-bundle-budget.sh exits 0 ✓

## Self-Check: PASSED

---
*Phase: 31-white-label-path-based-org-roles-clinic-onboarding-builder*
*Completed: 2026-05-18*
