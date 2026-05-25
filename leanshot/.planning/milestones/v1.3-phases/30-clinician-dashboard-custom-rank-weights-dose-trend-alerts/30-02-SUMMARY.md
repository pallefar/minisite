---
phase: 30-clinician-dashboard-custom-rank-weights-dose-trend-alerts
plan: "02"
subsystem: ui
tags: [react, supabase, realtime, clinic, settings, forms, postgres]

requires:
  - phase: 30-00
    provides: org_settings ranking_weights/dose_trend_thresholds columns + update_org_ranking_weights SECDEF + pg_notify trigger
  - phase: 28
    provides: channelNameFor HMAC helper in org-realtime.ts

provides:
  - ClinicRankingWeightsForm (4-input weights form, auto-normalize, SECDEF save)
  - ClinicDoseTrendThresholdsForm (3-input thresholds form, placeholder defaults)
  - use-org-settings-realtime hook (HMAC channel subscription for D-06)
  - Clinical tab in ClinicSettingsPage (admin-only)
  - RosterTable wired to hook (SC#1 1-second reorder)
  - update_org_dose_trend_thresholds SECDEF (migration 20270601300006)
  - RosterRow data-testid="roster-row" + data-patient-id (Plan 30-05 e2e)

affects: [30-03, 30-04, 30-05]

tech-stack:
  added: []
  patterns:
    - "Settings forms: auto-normalize-on-blur for sum-to-100 validation (proportional rounding with largest-value error distribution)"
    - "Realtime hook: async channelNameFor inside useEffect with cancellation guard; onWeightsChanged excluded from deps (callers memoize)"
    - "Admin tab gating: useStore((s) => s.currentOrgRole) === 'admin' pattern in ClinicSettingsPage permMap"

key-files:
  created:
    - supabase/migrations/20270601300006_p30_dose_thresholds_rpc.sql
    - leanshot/src/components/clinic/settings/ClinicRankingWeightsForm.tsx
    - leanshot/src/components/clinic/settings/ClinicRankingWeightsForm.test.tsx
    - leanshot/src/components/clinic/settings/ClinicDoseTrendThresholdsForm.tsx
    - leanshot/src/components/clinic/settings/ClinicDoseTrendThresholdsForm.test.tsx
    - leanshot/src/components/clinic/roster/use-org-settings-realtime.ts
    - leanshot/src/components/clinic/roster/use-org-settings-realtime.test.ts
  modified:
    - leanshot/src/components/clinic/settings/ClinicSettingsPage.tsx
    - leanshot/src/components/clinic/roster/RosterTable.tsx
    - leanshot/src/components/clinic/roster/RosterRow.tsx

key-decisions:
  - "update_org_dose_trend_thresholds SECDEF confirmed NOT in Plan 30-00 (Plan 30-00 ships 4 SECDEFs); shipped in this plan as migration 20270601300006 (B3 fix)"
  - "Admin tab visibility via currentOrgRole from Zustand store (consistent with RouteOrgGuard pattern) rather than a separate useHasPermission call"
  - "Dose-trend thresholds inputs use uncontrolled typing (no per-keystroke clamp) with clamp-on-blur to prevent premature rejection of in-progress values"
  - "node_modules symlinked from main checkout to worktree to enable vitest run (worktree lacks its own node_modules)"

requirements-completed: [CLIN-01, CLIN-02]

duration: 10min
completed: 2026-05-18
---

# Phase 30 Plan 02: Settings Forms + Realtime Hook Summary

**Ranking weights form (auto-normalize), dose-trend thresholds form, use-org-settings-realtime HMAC hook, and RosterTable SC#1 wiring — all 16 tests green, SECDEF live in Supabase**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-05-18T07:17:27Z
- **Completed:** 2026-05-18T07:29:00Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments

- `update_org_dose_trend_thresholds(uuid, jsonb)` SECDEF shipped and verified live in Supabase (`to_regprocedure` probe returns `true`)
- Two settings forms ship per 30-UI-SPEC copy/a11y contract: 4 number inputs with auto-normalize, 3 number inputs with placeholder defaults
- `ClinicSettingsPage` gains 'Clinical' tab (admin-only via `currentOrgRole`) housing both forms
- `useOrgSettingsRealtime` hook subscribes to HMAC settings channel, fires `onWeightsChanged` only for matching `org_id`, survives `CHANNEL_ERROR` with console.warn
- `RosterTable` wires hook with `useCallback`-wrapped `refresh()` — satisfies SC#1 1-second roster reorder; 30s polling failsafe preserved
- `RosterRow.tsx` gains `data-testid="roster-row"` + `data-patient-id={row.user_id}` on root `<tr>` (Plan 30-05 Playwright e2e support — B5 fix)

## SECDEF Live-Verification

```
select to_regprocedure('public.update_org_dose_trend_thresholds(uuid,jsonb)') is not null as exists
→ true
```

Migration: `20270601300006_p30_dose_thresholds_rpc.sql` — pushed via `supabase db push --linked`.

## Vitest Test Pass Counts

| File | Tests |
|------|-------|
| ClinicRankingWeightsForm.test.tsx | 7 passed |
| ClinicDoseTrendThresholdsForm.test.tsx | 4 passed |
| use-org-settings-realtime.test.ts | 5 passed |
| **Total** | **16 passed** |

## RosterRow data-testid confirmation

`RosterRow.tsx` root `<tr>` element now has:
- `data-testid="roster-row"` (was `data-testid="roster-row-{user_id}"` — changed to constant per Plan 30-05 requirement)
- `data-patient-id={row.user_id}` (new attribute — patient ID for row-order capture)

## Task Commits

1. **Migration 20270601300006** - `c071153` (feat)
2. **Settings forms + Clinical tab** - `af7e86f` (feat)
3. **Hook + RosterTable + RosterRow wiring** - `88c9329` (feat)
4. **Import order fix** - `673a040` (style)

## Files Created/Modified

- `supabase/migrations/20270601300006_p30_dose_thresholds_rpc.sql` - update_org_dose_trend_thresholds SECDEF (mirrors update_org_ranking_weights from 30-00)
- `leanshot/src/components/clinic/settings/ClinicRankingWeightsForm.tsx` - 4 number inputs, auto-normalize on blur, live sum counter, Save + Reset
- `leanshot/src/components/clinic/settings/ClinicRankingWeightsForm.test.tsx` - 7 RTL tests
- `leanshot/src/components/clinic/settings/ClinicDoseTrendThresholdsForm.tsx` - 3 number inputs (N/M/X), placeholder defaults, Save
- `leanshot/src/components/clinic/settings/ClinicDoseTrendThresholdsForm.test.tsx` - 4 RTL tests
- `leanshot/src/components/clinic/settings/ClinicSettingsPage.tsx` - added 'Clinical' tab with admin gate + Stethoscope icon
- `leanshot/src/components/clinic/roster/use-org-settings-realtime.ts` - HMAC channel subscription hook
- `leanshot/src/components/clinic/roster/use-org-settings-realtime.test.ts` - 5 hook tests
- `leanshot/src/components/clinic/roster/RosterTable.tsx` - wired useOrgSettingsRealtime with handleWeightsChanged
- `leanshot/src/components/clinic/roster/RosterRow.tsx` - data-testid + data-patient-id attributes

## Decisions Made

- `update_org_dose_trend_thresholds` SECDEF was confirmed missing from Plan 30-00 and shipped unconditionally in this plan (B3 plan-checker fix) via migration 20270601300006
- Admin gating uses `useStore((s) => s.currentOrgRole)` from Zustand rather than `useHasPermission` to stay consistent with existing RouteOrgGuard pattern
- Thresholds form uses uncontrolled typing with clamp-on-blur (not per-keystroke) — prevents premature clamping when user is mid-typing a 2-digit value
- `node_modules` symlinked from main checkout to worktree to run vitest (worktree shares git history but not build artifacts)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed import-x/order violation in ClinicSettingsPage**
- **Found during:** Lint check after Task 1
- **Issue:** `@/lib/store` import placed after `@/lib/supabase` (alphabetical order violation)
- **Fix:** Moved `import { useStore } from '@/lib/store'` before `import { supabase } from '@/lib/supabase'`
- **Files modified:** `leanshot/src/components/clinic/settings/ClinicSettingsPage.tsx`
- **Verification:** `npx eslint src/components/clinic/settings/ClinicSettingsPage.tsx` exits 0
- **Committed in:** `673a040`

**2. [Rule 1 - Bug] Fixed vi.mock hoisting issue in test files**
- **Found during:** Test RED phase
- **Issue:** `vi.mock` factories referenced module-level `const mockRpc = vi.fn()` — hoisting causes "Cannot access before initialization"
- **Fix:** Switched to `vi.hoisted()` pattern to create mocks before hoisting
- **Files modified:** All 3 test files
- **Verification:** All 16 tests pass

---

**Total deviations:** 2 auto-fixed (1 lint, 1 test infrastructure)
**Impact on plan:** Both auto-fixes necessary for CI cleanliness and test correctness. No scope creep.

## Issues Encountered

- `node_modules` symlink in worktree shows as untracked in `git status` — added to gitignore or will be cleaned by orchestrator. Not committed.
- Pre-existing `jsx-a11y/click-events-have-key-events` and `jsx-a11y/no-static-element-interactions` lint errors in `RosterRow.tsx` line 184 (`div onClick={(e) => e.stopPropagation()}`) — pre-existing before this plan, scope-boundary rule prevents fixing. Deferred per policy.

## Known Stubs

None — both forms make live RPC calls to SECDEF (not mocked at runtime). Hook subscribes to live Realtime channel.

## Threat Flags

None — all new surfaces operate within the threat model in the plan (client→SECDEF trust boundary, HMAC realtime channel).

## Next Phase Readiness

- Plan 30-03 (ClinicianAlertsPanel + AlertSnoozePopover) can proceed — uses same org-realtime pattern established here
- Plan 30-05 (SC#1 Playwright e2e) has its dependency met: `RosterRow` now has `data-testid="roster-row"` + `data-patient-id`
- SC#1 infrastructure complete: weights save → SECDEF → pg_notify trigger → Realtime broadcast → useOrgSettingsRealtime callback → refresh()

---

*Phase: 30-clinician-dashboard-custom-rank-weights-dose-trend-alerts*
*Completed: 2026-05-18*
