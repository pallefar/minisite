---
phase: 54-push-notifications
plan: 05
subsystem: ui
tags: [react, notifications, push, capacitor, typescript, vitest]

# Dependency graph
requires:
  - phase: 54-01
    provides: helpdesk-reply in Category union + notification_settings config seed
  - phase: 54-03
    provides: registerForPush(accessToken, supabaseUrl) native push registration
provides:
  - NotificationsSubtab with quiet-hours informational section (22:00-08:00, user timezone)
  - helpdesk-reply row in the 6x3 category x channel matrix
  - native soft-prompt branch in handleEnablePush via detectPlatform()
affects: [54-push-notifications, phase-70-uat]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "SNOOZEABLE_MATRIX_CATEGORIES separate from MATRIX_CATEGORIES: snooze/cap controls scoped to original 5; matrix includes helpdesk-reply as 6th row"
    - "detectPlatform() branch in push-enable handler: native (ios|android) -> registerForPush; web -> requestPushPermission"
    - "profiles.timezone fetch with Intl fallback then UTC for quiet-hours display"

key-files:
  created: []
  modified:
    - leanshot/src/components/dashboard/settings/NotificationsSubtab.tsx
    - leanshot/src/components/dashboard/settings/NotificationsSubtab.test.tsx
    - leanshot/src/lib/notifications/types.ts (deviation: brought from 54-01)
    - leanshot/src/lib/native/push.ts (deviation: brought from 54-03)

key-decisions:
  - "SNOOZEABLE_MATRIX_CATEGORIES pins original 5 categories to avoid pulling helpdesk-reply into snooze/frequency-cap UI — analytics notification_snoozed schema limits to 5"
  - "Quiet-hours section is informational only — no toggle: T-54-05-01 invariant: copy explicitly states server enforcement is unconditional, urgent clinic alerts always deliver"
  - "Timezone fetched from profiles.timezone per userId; fallback chain: Intl.DateTimeFormat resolved -> UTC"
  - "UI visual/device native push permission walkthrough deferred to Phase 70 HUMAN-UAT (needs real devices + provisioned certs)"

patterns-established:
  - "detectPlatform() imported from @/lib/native/platform (NOT @capacitor/core directly — firewall maintained)"
  - "registerForPush separation: web path stays in permission.ts; native path in push.ts"

requirements-completed: [PUSH-05, PUSH-06]

# Metrics
duration: 25min
completed: 2026-05-25
---

# Phase 54 Plan 05: NotificationsSubtab Quiet-Hours UI + Helpdesk-Reply Matrix + Native Push Branch Summary

**Quiet-hours informational section (22:00-08:00 + user timezone), helpdesk-reply as 6th matrix row, and detectPlatform()-gated native registerForPush branch in the existing DS-compliant NotificationsSubtab**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-05-25T11:20:00Z
- **Completed:** 2026-05-25T11:49:13Z
- **Tasks:** 2 auto tasks (checkpoint:human-verify deferred per D-08 contract)
- **Files modified:** 4

## Accomplishments
- Added helpdesk-reply to CATEGORY_LABEL, MATRIX_CATEGORIES, and DEFAULT_ENABLED (email:true, web-push:true, in-app:true matching 54-01 config seed) — matrix is now 6x3 = 18 toggles
- Added informational quiet-hours section: fixed 22:00-08:00 window + user timezone read from profiles.timezone (fallback Intl then UTC); copy follows T-54-05-01 invariant (no toggle, urgent clinic alerts always deliver)
- Introduced SNOOZEABLE_MATRIX_CATEGORIES (original 5) so snooze dropdown and frequency caps exclude helpdesk-reply per analytics schema constraint
- Native soft-prompt branch: handleEnablePush branches on detectPlatform(); ios/android calls registerForPush(accessToken, supabaseUrl); web keeps requestPushPermission({fromUserGesture:true}); Pitfall 3 gesture gate preserved
- Extended test suite: 12 existing tests pass + 4 new tests (quiet-hours section, helpdesk-reply row, native push path, web push path)

## Task Commits

1. **Tasks 1+2: helpdesk-reply matrix + quiet-hours section + native push branch** - `c02cd7a6` (feat)

**Plan metadata:** (to follow — see SUMMARY commit)

## Files Created/Modified
- `leanshot/src/components/dashboard/settings/NotificationsSubtab.tsx` — helpdesk-reply in matrix/label/defaults; SNOOZEABLE_MATRIX_CATEGORIES constant; quiet-hours Card section; detectPlatform() native push branch in handleEnablePush; profiles.timezone useEffect
- `leanshot/src/components/dashboard/settings/NotificationsSubtab.test.tsx` — updated switch count (17→20), row-header count (5→6), added 4 new tests; mocks for detectPlatform/registerForPush/profiles query
- `leanshot/src/lib/notifications/types.ts` — deviation: brought from 54-01 (helpdesk-reply in Category union)
- `leanshot/src/lib/native/push.ts` — deviation: brought from 54-03 (registerForPush implementation)

## Decisions Made
- SNOOZEABLE_MATRIX_CATEGORIES is a separate constant from MATRIX_CATEGORIES because the analytics `notification_snoozed` event schema only accepts the original 5 categories. helpdesk-reply appears in the matrix but is not snoozeable or cap-overridable.
- Quiet-hours section is read-only (informational). No UI toggle exists because no backing column exists — server enforcement is unconditional in push-dispatch. This prevents T-54-05-01 spoofing (misleading toggle implying the user can disable server quiet-hours).
- timezone fetch fires once per userId via useEffect; Intl fallback prevents blank timezone in the UI for unauthenticated or profile-lacking users.
- Human-verify checkpoint (UI visual + on-device native permission UX) is deferred to Phase 70 HUMAN-UAT per D-08 milestone contract.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Dependency files from 54-01 and 54-03 not in worktree base**
- **Found during:** Task 1 (tsc check in worktree)
- **Issue:** Worktree base (`da582b0c`) predates Phase 54; `leanshot/src/lib/notifications/types.ts` lacked `helpdesk-reply` in the Category union (54-01 work), and `leanshot/src/lib/native/push.ts` was still the Phase 12 zero-arg stub (54-03 not yet merged). Both caused compile errors in the new NotificationsSubtab code.
- **Fix:** Copied current `types.ts` (with helpdesk-reply) and `push.ts` (registerForPush implementation) from main checkout where 54-01 and 54-03 had already landed.
- **Files modified:** `leanshot/src/lib/notifications/types.ts`, `leanshot/src/lib/native/push.ts`
- **Verification:** `tsc -p tsconfig.app.json --noEmit` exits 0 in worktree; 16 vitest tests pass.
- **Committed in:** `c02cd7a6` (combined task commit)

---

**Total deviations:** 1 auto-fixed (Rule 3 - blocking dependency files)
**Impact on plan:** Required for compilation. Files belong to sibling plans (54-01, 54-03) that will also be merged; no scope creep on business logic.

## Issues Encountered
- Worktree was created from `da582b0c` before Phase 54 work landed; 54-01 and 54-03 dependency files had to be forward-ported manually. This is expected for wave-3 plans in a multi-wave phase.

## Human-Verify Checkpoint: DEFERRED to Phase 70 (D-08)

Per the autonomous:false plan frontmatter and the orchestrator's D-08 contract:

The checkpoint:human-verify task (UI visual + on-device native push permission walkthrough) is recorded here as a Phase 70 deferred signal.

**What to verify at Phase 70:**
1. `cd leanshot && npm run dev`, sign in, open Settings -> Notifications.
2. Confirm "Quiet hours" section shows 22:00-08:00 and your timezone, with copy that urgent clinic alerts always deliver.
3. Confirm "Helpdesk replies" appears as a new row in the category x channel matrix.
4. Confirm layout matches existing DS styling (no broken spacing / off-palette colors).
5. On native device (iOS/Android with provisioned certs): tap "Enable push notifications" — confirm soft-prompt fires (OS permission dialog), not a hard failure.

Automated checks (tsc clean, 16 vitest tests) are PASSED. On-device native permission + actual delivery verification requires real devices + provisioned certs.

## Known Stubs

None — the quiet-hours timezone reads from profiles.timezone via supabase (real fetch, falls back gracefully). The section is correctly informational (no toggle) matching the server-side unconditional enforcement.

## Threat Flags

No new network endpoints or auth paths introduced. detectPlatform() branch is client-side read-only. T-54-05-01 (misleading toggle) and T-54-05-02 (gesture gate) mitigations both applied.

## Next Phase Readiness
- NotificationsSubtab UI complete for Phase 54 scope
- On-device native push permission UX deferred to Phase 70 HUMAN-UAT
- No blockers for subsequent Phase 54 plans

## Self-Check: PASSED

- File `leanshot/src/components/dashboard/settings/NotificationsSubtab.tsx` — modified in commit `c02cd7a6` ✓
- File `leanshot/src/components/dashboard/settings/NotificationsSubtab.test.tsx` — modified in commit `c02cd7a6` ✓
- tsc clean ✓
- 16 vitest tests pass ✓
- helpdesk-reply in matrix ✓
- Quiet hours section present ✓
- registerForPush + detectPlatform imported ✓

---
*Phase: 54-push-notifications*
*Completed: 2026-05-25*
