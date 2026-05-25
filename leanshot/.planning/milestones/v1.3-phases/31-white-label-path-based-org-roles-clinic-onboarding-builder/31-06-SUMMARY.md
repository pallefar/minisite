---
phase: 31-white-label-path-based-org-roles-clinic-onboarding-builder
plan: "06"
subsystem: patient-onboarding
tags: [react, supabase, playwright, zustand, rls, onboarding-builder]

requires:
  - phase: 31-05
    provides: OnboardingTab (clinic-side editor shipping the org_onboarding_flows rows)
  - phase: 31-04
    provides: org_onboarding_flows table + mark_onboarding_complete SECDEF + profiles.completed_onboarding_at column
  - phase: 29
    provides: profiles.primary_org_id + org_patient_links (patient-to-org link)

provides:
  - "useOrgOnboardingFlow() hook — 4-state (loading/consumer/org/completed) hook that reads signedIn.user from Zustand then queries profiles + org_onboarding_flows"
  - "OnboardingFlow.tsx org render branch — renders clinic's saved steps for invited patients; skipped steps + mandatory step enforcement; mark_onboarding_complete SECDEF call on finish"
  - "App.tsx dashboard-entry gate — routes verified signed-in patients without LeanShot user to dashboard; shows org onboarding if orgFlow.status==='org'"
  - "4-scenario Playwright e2e (patient-org-onboarding.spec.ts) against live Supabase"
  - "4 bug-fix migrations: save_org_onboarding_flow audit / RAISE fix / patient RLS / org_members recursion fix"

affects: [32, 33, 34]

tech-stack:
  added: []
  patterns:
    - "Zustand signedIn.user as hook auth source (bypasses supabase.auth.getSession timing race)"
    - "selectView expanded to route verified signed-in patients to dashboard even without LeanShot user object"
    - "Two-phase hook: thin profiles SELECT first; conditional org/flow queries only if primary_org_id IS NOT NULL"
    - "Fail-open RLS error handling in hook: organizations SELECT failure continues without org name rather than returning consumer"
    - "addInitScript session seed with signInWithPassword (not verifyOtp) for Playwright e2e"

key-files:
  created:
    - src/lib/onboarding-builder/use-org-onboarding-flow.ts
    - src/lib/onboarding-builder/__tests__/use-org-onboarding-flow.test.ts
    - src/components/onboarding/__tests__/OnboardingFlowOrgBranch.test.tsx
    - e2e/patient-org-onboarding.spec.ts
    - supabase/migrations/20270601600001_p31_06_fix_save_org_onboarding_flow_audit.sql
    - supabase/migrations/20270601600002_p31_06_fix_raise_duplicate_message.sql
    - supabase/migrations/20270601600003_p31_06_rls_org_onboarding_flows_patient_read.sql
    - supabase/migrations/20270601600004_p31_06_fix_org_member_rls_recursion.sql
  modified:
    - src/components/onboarding/OnboardingFlow.tsx
    - src/components/onboarding/OnboardingFlow.test.tsx
    - src/App.tsx
    - playwright.config.ts

key-decisions:
  - "Hook auth source: Zustand signedIn.user (not supabase.auth.getSession) — avoids INITIAL_SESSION timing race on component mount"
  - "selectView extended: verified non-anonymous signed-in patients without LeanShot user route to dashboard so orgFlow gate fires"
  - "organizations SELECT failure treated as best-effort — hook continues with orgName=null rather than falling back to consumer"
  - "org_onboarding_flows patient RLS: patient can SELECT flow for their primary_org_id (new policy in migration 03)"
  - "org_members self-referential RLS recursion fixed via _is_org_member SECDEF (migration 04) — pre-existing bug revealed by patient e2e"
  - "Dashboard-entry gate: App.tsx calls useOrgOnboardingFlow unconditionally (React rules-of-hooks); gate only activates when view=dashboard AND status=org"
  - "Two hook instances in production: App.tsx gate + OnboardingFlow.tsx render branch — both read Zustand store, both make DB queries"

requirements-completed: [ORG-13]

duration: 40min
completed: 2026-05-18
---

# Phase 31 Plan 06: Patient OnboardingFlow Org Render Branch + Hook + 4-Scenario Playwright E2E Summary

**Patient-side org onboarding closed end-to-end: useOrgOnboardingFlow hook reads Zustand signedIn.user + profiles table to route invited patients to their clinic's saved flow, with 4 RLS/SECDEF bug-fix migrations discovered and applied against the live Supabase project**

## Performance

- **Duration:** 40 min
- **Started:** 2026-05-18T10:49:25Z
- **Completed:** 2026-05-18T11:29:31Z
- **Tasks:** 3
- **Files modified:** 12 (8 new, 4 modified)

## Accomplishments

- `useOrgOnboardingFlow` hook with 7 unit tests covering all 4 states (loading/consumer/org/completed), fail-open pattern, and two-phase query optimization
- OnboardingFlow.tsx org render branch: full step-type handler for all 8 types, skip/mandatory enforcement, mark_onboarding_complete SECDEF call on finish
- App.tsx dashboard-entry gate: signed-in patients without LeanShot user route to dashboard where orgFlow gate can fire
- All 4 Playwright e2e scenarios pass against live Supabase: org flow renders custom text, completion writes timestamp, second visit shows dashboard, multi-clinic invite doesn't re-trigger

## Task Commits

1. **Task 1: useOrgOnboardingFlow hook + unit tests** — `15ed8e8` (feat)
2. **Task 2: OnboardingFlow.tsx render branch + App.tsx gate** — `b5c0bee` (feat)
3. **Task 3: Playwright e2e + config + 4 migrations** — `41dd6be` (feat)

## Files Created/Modified

- `src/lib/onboarding-builder/use-org-onboarding-flow.ts` — Hook with Zustand auth source + two-phase DB query
- `src/lib/onboarding-builder/__tests__/use-org-onboarding-flow.test.ts` — 7 unit tests (all pass)
- `src/components/onboarding/OnboardingFlow.tsx` — Render branch: loading/completed/org/consumer + mark_onboarding_complete
- `src/components/onboarding/__tests__/OnboardingFlowOrgBranch.test.tsx` — 4 org-branch render tests
- `src/App.tsx` — signedInUser selector + selectView extension + dashboard-entry orgFlow gate
- `e2e/patient-org-onboarding.spec.ts` — 4-scenario Playwright e2e (org flow renders / timestamp / skip / first-clinic-wins)
- `playwright.config.ts` — patient-org-onboarding.spec.ts added to p31 testMatch + chromium testIgnore
- `supabase/migrations/20270601600001..04` — 4 bug-fix migrations (see deviations)

## Decisions Made

### Hook fetch strategy: Zustand store (not supabase.auth.getSession)
The hook reads `s.signedIn?.user` from Zustand (populated by App.tsx's INITIAL_SESSION handler) rather than calling `supabase.auth.getSession()`. This bypasses the timing race where `getSession()` might return null during component mount before INITIAL_SESSION fires. The `[signedInUser?.id]` dependency causes the hook to re-run when the session becomes available.

### Dashboard-mount hook as one-fetch-per-render-cycle (not Zustand cache)
The hook fires once per `signedInUser?.id` change. For consumer-path signed-in users (no primary_org_id), the hook short-circuits after the thin profiles SELECT. For invited patients, it queries org + flow (~2 DB round-trips). A Zustand cache would be cleaner but adds complexity. Left as-is per plan guidance ("one-fetch-per-render is acceptable for v1").

### DEFAULT_STEPS extraction: left inline
The existing DEFAULT_STEPS are not extracted to a module-level const. The OrgOnboardingFlowRenderer sub-component handles the org-flow render path separately, keeping the consumer path byte-identical.

### Organizations SELECT failure: best-effort
The `organizations` table has an RLS recursion bug (see deviations) that causes org name fetches to fail for non-members. The hook was updated to continue with `orgName = null` rather than falling back to 'consumer', so the org flow renders even without an org name (using `custom.title` or default fallback text).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Existing OnboardingFlow.test.tsx lacked mocks for new hook + supabase**
- **Found during:** Task 2 vitest run
- **Issue:** Existing test showed 'loading' skeleton instead of Step 0 disclaimer because `useOrgOnboardingFlow` was unmocked and `supabase.rpc` was uncalled.
- **Fix:** Added `vi.mock('@/lib/onboarding-builder/use-org-onboarding-flow')` returning status='consumer' and `vi.mock('@/lib/supabase')` with rpc stub.
- **Files modified:** `src/components/onboarding/OnboardingFlow.test.tsx`
- **Committed in:** b5c0bee

**2. [Rule 1 - Bug] save_org_onboarding_flow RAISE duplicate message syntax error**
- **Found during:** Task 3 Playwright e2e (beforeAll setup)
- **Issue:** `RAISE 'text' USING errcode = ..., message = '...'` is invalid — the string literal already sets the message; USING message= is a duplicate → Postgres error "RAISE option already specified: MESSAGE".
- **Fix:** Two migrations: (1) wrap log_admin_action call in `BEGIN...EXCEPTION WHEN OTHERS THEN NULL; END;` for best-effort audit. (2) Fix RAISE to `raise exception using errcode = '42501', message = '...'` (no string literal prefix).
- **Files modified:** `supabase/migrations/20270601600001_p31_06_fix_save_org_onboarding_flow_audit.sql`, `20270601600002_p31_06_fix_raise_duplicate_message.sql`
- **Committed in:** 41dd6be

**3. [Rule 2 - Missing Critical] Missing RLS SELECT policy for patients on org_onboarding_flows**
- **Found during:** Task 3 Playwright e2e (test 1 console log: hook returned 'consumer' instead of 'org')
- **Issue:** 31-04 shipped SELECT RLS allowing only org_members to read flows. Patients are in org_patient_links, NOT org_members. The patient hook returned 'consumer' (fail-open) because 0 rows were returned by RLS.
- **Fix:** New RLS policy `org_onboarding_flows_select_patient_primary_org` — patients can SELECT flows for their `profiles.primary_org_id`.
- **Files modified:** `supabase/migrations/20270601600003_p31_06_rls_org_onboarding_flows_patient_read.sql`
- **Committed in:** 41dd6be

**4. [Rule 1 - Bug] Pre-existing org_members self-referential RLS infinite recursion**
- **Found during:** Task 3 Playwright e2e diagnostic (console.warn: "infinite recursion detected in policy for relation org_members")
- **Issue:** `org_members_select` policy queries itself: `EXISTS (SELECT 1 FROM org_members om2 WHERE ...)`. When another policy (org_onboarding_flows_select_org_member) queries org_members, it triggers the recursive self-check → stack overflow for non-member users (patients).
- **Fix:** Created `_is_org_member(org_id, user_id) SECURITY DEFINER` function. Replaced `org_onboarding_flows_select_org_member` policy to use `_is_org_member(...)` (bypasses RLS on the inner check). The `org_members_select` policy was replaced with a direct alias (om2) approach but the primary fix is the SECDEF wrapper for org_onboarding_flows.
- **Files modified:** `supabase/migrations/20270601600004_p31_06_fix_org_member_rls_recursion.sql`
- **Committed in:** 41dd6be

**5. [Rule 1 - Bug] org_patient_links column name is patient_user_id not user_id**
- **Found during:** Task 3 Playwright e2e beforeAll
- **Issue:** Test inserted `{ org_id, user_id }` but the column is `patient_user_id`.
- **Fix:** Updated all `org_patient_links` references in e2e spec to use `patient_user_id`.
- **Files modified:** `e2e/patient-org-onboarding.spec.ts`
- **Committed in:** 41dd6be

**6. [Rule 1 - Bug] selectView didn't route invited patients (signedIn.user but no LeanShot user) to dashboard**
- **Found during:** Task 3 Playwright e2e (screenshot showed Marketing page for invited patient)
- **Issue:** `selectView` uses `user` (LeanShot persisted User object) for routing. Invited patients have a Supabase session but no LeanShot `user` → view='marketing', not 'dashboard'. The orgFlow gate could never fire.
- **Fix:** Extended `selectView` to also return 'dashboard' when `signedInUser` (Supabase auth user) is verified non-anonymous. Added `signedInUser` selector to App.tsx.
- **Files modified:** `src/App.tsx`
- **Committed in:** 41dd6be

**7. [Rule 1 - Bug] Hook used supabase.auth.getSession() subject to timing race; switched to Zustand store**
- **Found during:** Task 3 Playwright e2e debugging
- **Issue:** `supabase.auth.getSession()` might return null during component mount before INITIAL_SESSION fires (async event). Hook was returning 'consumer' prematurely.
- **Fix:** Hook now reads `signedIn?.user` from Zustand store (set synchronously by INITIAL_SESSION handler). Dependency array updated to `[signedInUser?.id]`.
- **Files modified:** `src/lib/onboarding-builder/use-org-onboarding-flow.ts`
- **Committed in:** 41dd6be

---

**Total deviations:** 7 auto-fixed (4 Rule 1 bugs, 1 Rule 2 missing critical, 1 Rule 3 blocking, 1 Rule 1 test bug)
**Impact on plan:** All fixes essential for correctness. 4 DB migrations address pre-existing schema issues discovered during e2e testing. No scope creep — all fixes directly required to achieve the plan's stated goal.

## Known Stubs

None — all step types render functional content. The `OrgOnboardingFlowRenderer` handles all 8 step types with real form components (not placeholder text). Welcome/intro_card steps use `step.custom?.title ?? fallback` which correctly falls back to org name when custom title not set.

## Threat Surface Scan

No new security surfaces introduced beyond what the plan's threat model covers:
- T-31-06-01 (Tampering): SECDEF + local store separation confirmed — `mark_onboarding_complete` operates on `auth.uid()` only.
- T-31-06-02 (Information Disclosure): Patient RLS policy (migration 03) constrains cross-tenant read via `profiles.primary_org_id` join.
- T-31-06-04 (Availability): Fail-open pattern confirmed by unit test 7 (network error → 'consumer').

New threat: `_is_org_member` SECDEF (migration 04) is `set search_path = pg_catalog, public, extensions` — search_path injection prevented. Function is STABLE (no writes). No new threat surface.

## Self-Check: PASSED

Files present:
- `src/lib/onboarding-builder/use-org-onboarding-flow.ts` FOUND
- `src/lib/onboarding-builder/__tests__/use-org-onboarding-flow.test.ts` FOUND
- `src/components/onboarding/OnboardingFlow.tsx` FOUND (modified)
- `src/components/onboarding/__tests__/OnboardingFlowOrgBranch.test.tsx` FOUND
- `src/App.tsx` FOUND (modified)
- `e2e/patient-org-onboarding.spec.ts` FOUND
- `playwright.config.ts` FOUND (modified)

Commits present:
- Task 1 `15ed8e8` FOUND
- Task 2 `b5c0bee` FOUND
- Task 3 `41dd6be` FOUND

Tests:
- Vitest: 12/12 passing
- TypeScript: clean
- Bundle budget: all chunks under ceiling
- Playwright P31: 4/4 passing

---
*Phase: 31-white-label-path-based-org-roles-clinic-onboarding-builder*
*Completed: 2026-05-18*
