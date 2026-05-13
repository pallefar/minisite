---
phase: 10-clinic-operator-surface
plan: "06"
subsystem: roster-ui
tags: [react, vitest, playwright, supabase-realtime, posthog, accessibility, typescript]

dependency_graph:
  requires:
    - 10-01 (RankRosterRow type, ScoreBucket, scoreBucket helper in snapshot.ts)
    - 10-02 (rank_org_patients RPC + RLS proof)
    - 10-03 (broadcast_patient_signal_change trigger; topic format org:{orgId})
  provides:
    - RosterTable composition root with sort + pagination + Realtime patch + threshold toast
    - useRankRoster hook calling rank_org_patients RPC
    - useRosterRealtime hook subscribing to org:{orgId} channel
    - ScoreChip with permission-gated ScoreBreakdownPopover
    - RosterMobileCard stack for <768px
    - clinic-events.ts: CLINIC_EVENTS constants + scoreBucket re-export
    - ClinicWorkspace updated to render RosterTable (replaces Phase 9 empty shell)
    - seedRosterPatients fixture exported from clinic-roster-sort.spec.ts for Plan 10-11
  affects:
    - 10-07 (ClinicDrillInPage uses drill-in route /clinic/{slug}/patient/{user_id})
    - 10-10 (BulkExport adds to RosterTable's existing selection prop stub)
    - 10-11 (roster-perf.spec.ts can import seedRosterPatients from 10-06's spec)

tech-stack:
  added: []
  patterns:
    - "useRankRoster: supabase.rpc('rank_org_patients') with sort/pagination/30s passive refetch"
    - "useRosterRealtime: supabase.channel('org:{orgId}').on('broadcast', ...) with any-typed handler to satisfy TS overload"
    - "Threshold-crossing: prevScoreMapRef.current compared against fresh RPC result on each refetch"
    - "PHI-safe PostHog: scoreBucket() wrapper makes raw score leakage impossible by signature"
    - "vi.mock hoisting guard: all mock functions declared inside factory closure, not as outer variables"
    - "Row flash: 200ms accent-tint CSS class + aria-live announcement co-located inside first <td> to keep HTML valid"

key-files:
  created:
    - src/lib/clinic-events.ts
    - src/components/clinic/roster/use-rank-roster.ts
    - src/components/clinic/roster/use-roster-realtime.ts
    - src/components/clinic/roster/ScoreChip.tsx
    - src/components/clinic/roster/ScoreBreakdownPopover.tsx
    - src/components/clinic/roster/RosterPagination.tsx
    - src/components/clinic/roster/RosterRow.tsx
    - src/components/clinic/roster/RosterMobileCard.tsx
    - src/components/clinic/roster/RosterTable.tsx
    - src/components/clinic/roster/RosterTable.test.tsx
    - e2e/clinic-roster-sort.spec.ts
  modified:
    - src/components/clinic/ClinicWorkspace.tsx (Phase 9 empty-shell replaced with RosterTable)
    - src/components/clinic/ClinicWorkspace.test.tsx (updated to Phase 10 behavior; added channel mock)

decisions:
  - "use-roster-realtime: .on() callback typed as 'any' to satisfy supabase-js v2.105.4 overload — inner payload extracted with runtime guard; same pattern as MembersTab.tsx"
  - "Row flash aria-live span placed inside first <td> cell (not direct <tr> child) — HTML spec requires <td>/<th> as direct <tr> children"
  - "OWNER_PERMISSION_MAP all-true default in ClinicWorkspace — Plan 10-07's clinic-snapshot response will provide real role-specific permission_map when drill-in page is wired"
  - "seedRosterPatients exported from e2e spec for Plan 10-11 roster-perf.spec.ts reuse"
  - "vi.mock hoisting: all mock functions declared inside factory, not as outer variables, to avoid ReferenceError on hoisted execution"

metrics:
  duration: "~90 min"
  completed: "2026-05-13"
  tasks_completed: 1
  files_created: 11
  files_modified: 2
---

# Phase 10 Plan 06: Roster UI Summary

Server-sorted RosterTable consuming rank_org_patients RPC + Realtime broadcasts; ScoreChip with permission-gated breakdown popover; threshold-cross toast; PHI-safe PostHog events; mobile card-stack; ClinicWorkspace integration.

## Performance

- **Duration:** ~90 min
- **Tasks:** 1 (multi-batch: lib + hooks, UI components, ClinicWorkspace integration, tests)
- **Files created:** 11
- **Files modified:** 2

## Accomplishments

### 11-File Inventory

| File | Description |
|------|-------------|
| `src/lib/clinic-events.ts` | CLINIC_EVENTS constants (10 event names per D-24/D-25) + scoreBucket re-export. PHI contract enforced at type level. |
| `src/components/clinic/roster/use-rank-roster.ts` | Calls `rank_org_patients(p_org_id, p_sort_column, p_sort_direction, p_offset, p_limit)` RPC. Tracks `lastFetchedAt`. Passive 30s refetch in RosterTable. |
| `src/components/clinic/roster/use-roster-realtime.ts` | Subscribes to `org:{orgId}` channel (colon format matching Phase 9 RLS). Callback typed as `any` + runtime guard to satisfy supabase-js overload. |
| `src/components/clinic/roster/ScoreChip.tsx` | Score pill with sage/neutral/warning bucket colors. canViewBreakdown=false → read-only span; true → button with aria-haspopup + popover. |
| `src/components/clinic/roster/ScoreBreakdownPopover.tsx` | Role=dialog + aria-modal + focus trap + Escape close. Per-signal weights from breakdown jsonb. |
| `src/components/clinic/roster/RosterPagination.tsx` | Previous/Next with descriptive aria-labels for disabled state. |
| `src/components/clinic/roster/RosterRow.tsx` | Desktop `<tr>` with 7 cells. Drill-in click fires PHI-safe PostHog event (org_id + score_bucket only). Row flash respects prefers-reduced-motion. |
| `src/components/clinic/roster/RosterMobileCard.tsx` | `<article>` with 2×2 signal grid. Same drill-in + PostHog handlers as RosterRow. |
| `src/components/clinic/roster/RosterTable.tsx` | Composition root. Sort state (3-click cycle: DESC → ASC → revert). Realtime patch via Map diff. Threshold-crossing detection on every RPC refetch. Dual desktop table + mobile card stack. |
| `src/components/clinic/roster/RosterTable.test.tsx` | 8 Vitest assertions. |
| `e2e/clinic-roster-sort.spec.ts` | Live-DB Playwright spec. Exports `seedRosterPatients` helper for Plan 10-11. |

### ClinicWorkspace Integration

`ClinicWorkspace.tsx` updated: Phase 9 `EmptyState` empty-roster shell replaced with `<RosterTable orgId={org.id} slug={org.slug} permissionMap={OWNER_PERMISSION_MAP} />`. Phase 9 test updated to match new behavior.

## Task Commits

| Batch | Commit | Description |
|-------|--------|-------------|
| 1 — lib + hooks | `d843a99` | clinic-events.ts + use-rank-roster.ts + use-roster-realtime.ts |
| 2 — UI components | `5a95551` | RosterTable + RosterRow + RosterMobileCard + ScoreChip + ScoreBreakdownPopover + RosterPagination |
| 3 — ClinicWorkspace | `f3b7039` | ClinicWorkspace integration (empty shell → RosterTable) |
| 4 — Tests | `6af9a7c` | RosterTable.test.tsx + ClinicWorkspace.test.tsx update + clinic-roster-sort.spec.ts |

## Verification Results

- `npm run typecheck`: PASSED
- `npm run test:unit -- --run`: 686 passed / 5 skipped / 0 failed across 52 test files
  - RosterTable.test.tsx: 8/8 assertions pass
  - ClinicWorkspace.test.tsx: 9/9 assertions pass (updated for Phase 10)
- PostHog PHI grep: `! grep -rE "(patient_user_id|score: [0-9])" src/components/clinic/roster/ ... | grep posthog` → zero matches
- 11 required files: all FOUND
- ClinicWorkspace.tsx: 4 references to RosterTable (import + type import + usage)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] supabase-js .on('broadcast') TypeScript overload mismatch**
- **Found during:** Task 1 — typecheck
- **Issue:** `use-roster-realtime.ts` typed the broadcast callback with `(broadcastPayload: { payload?: PatientSignalChangePayload }) => void` — this doesn't match the supabase-js v2.105.4 broadcast overload signature which requires `[key: string]: any` index signature on the payload type.
- **Fix:** Typed the callback as `(broadcastPayload: any) => void` with a runtime guard extracting and validating `broadcastPayload.payload`. Identical pattern used by existing `MembersTab.tsx`.
- **Files modified:** `use-roster-realtime.ts`
- **Commit:** d843a99

**2. [Rule 1 - Bug] <span> as direct child of <tr> — invalid HTML**
- **Found during:** Task 1 — Vitest React hydration warning
- **Issue:** `RosterRow.tsx` rendered the aria-live announcement `<span>` as a direct child of `<tr>`, which HTML spec forbids. React printed a hydration warning.
- **Fix:** Moved the aria-live span inside the first `<td>` cell (the score chip cell), keeping the ScoreChip as a sibling. Cells remain semantically correct; `<span>` is a valid descendant of `<td>`.
- **Files modified:** `RosterRow.tsx`
- **Commit:** 5a95551

**3. [Rule 1 - Bug] vi.mock hoisting caused ReferenceError in RosterTable.test.tsx**
- **Found during:** Task 1 — Vitest run
- **Issue:** Mock functions (`mockRpcFn`, `mockChannelFn`, etc.) declared as outer variables were accessed inside the `vi.mock()` factory, but hoisting executes the factory before the outer declarations are initialized.
- **Fix:** Rewrote the test to declare all vi.fn() instances inside the factory closure. Outer accessors use `supabase.rpc as ReturnType<typeof vi.fn>` cast after import.
- **Files modified:** `RosterTable.test.tsx`
- **Commit:** 6af9a7c

**4. [Rule 1 - Bug] ClinicWorkspace.test.tsx failures due to RosterTable integration**
- **Found during:** Task 1 — Vitest run after ClinicWorkspace update
- **Issue:** Existing Phase 9 `ClinicWorkspace.test.tsx` asserted the empty-roster shell (Phase 9 `EmptyState` copy + "Customize workspace" link). After integrating RosterTable, the test expected components that no longer exist at that level AND the supabase mock was missing the `channel` method needed by `useRosterRealtime`.
- **Fix:** Updated test to add `channel: vi.fn()` + `removeChannel: vi.fn()` to the supabase mock; updated the "empty-roster shell" assertion to match Phase 10 behavior (RosterTable renders EmptyState when RPC returns []); removed "Customize workspace" link assertion (moved to settings route); updated "Invite patient" assertion timing.
- **Files modified:** `ClinicWorkspace.test.tsx`
- **Commit:** 6af9a7c

**5. [Rule 2 - Missing Critical] Worker/Worktree path isolation — files written to main repo**
- **Found during:** Initial file creation
- **Issue:** The working directory at execution time was `/Users/karstenhaldan/minisite/leanshot` (the main repo's leanshot subdirectory) instead of the worktree path. All files were created in the wrong location.
- **Fix:** Detected the mismatch via `git stash` revealing changes in main repo; copied all files to the correct worktree path at `…/.claude/worktrees/agent-ac1a1e21f694a26a8/leanshot/`; restored the main repo to clean state; created a node_modules symlink in the worktree to enable typecheck.
- **Impact:** No user-visible impact; all commits are on the correct worktree branch `worktree-agent-ac1a1e21f694a26a8`.

## Bundle-Size Delta

Per UI-SPEC bundle contract:
- `clinic` chunk: +6 net-new TSX files (RosterTable, RosterRow, RosterMobileCard, ScoreChip, ScoreBreakdownPopover, RosterPagination) + 2 hooks + updated ClinicWorkspace. Estimated +6-8 kB gz delta. Plan 10-06 ceiling: ≤20 kB total.
- Index chunk: unchanged (no new top-level imports added to App.tsx or lazy boundaries).
- jsPDF: NOT imported (bulk PDF export is Plan 10-10 — dynamic import only).

Full CI bundle assertion is gated by the existing `assert-clinic-bundle-budget.sh` script (Plan 10-05 sibling plan owns that script).

## Realtime Broadcast Latency

Per Plan 10-03 SUMMARY, actual broadcast latency on the live DB was ~800ms for injections, ~600ms for weights, ~800ms for symptoms. The row flash (200ms CSS transition) fires client-side the moment the broadcast arrives — operator sees the update well under 1s.

Score is NOT recomputed per event (D-16: signal columns only). Score recompute occurs on next 30s passive refetch or manual refresh.

## PostHog PHI Safety Grep Result

```
$ ! grep -rE "(patient_user_id|score: [0-9])" src/components/clinic/roster/ src/lib/clinic-events.ts | grep -v 'test\|comment\|FORBIDDEN\|NEVER\|PHI' | grep posthog
→ zero matches
```

All matches in the source were inside JSDoc comments listing FORBIDDEN properties — no executable PostHog capture calls include patient_user_id, patient_name, or raw score values.

## Known Stubs

1. **`OWNER_PERMISSION_MAP` in ClinicWorkspace.tsx** — All-true permission map used as default for the workspace owner. Plan 10-07's `clinic-snapshot` Edge Function response includes a real `permission_map` derived from the operator's role; Plan 10-07 will wire this when drill-in is implemented. The stub is intentional and documented.

2. **`onSelectionChange` prop in RosterTable** — Prop stub for Plan 10-10's bulk selection wiring. `_onSelectionChange` is unused in this plan; Plan 10-10 will implement the checkbox state and bulk action bar.

These stubs do NOT prevent the plan's goal (functional roster with sort, Realtime patch, and drill-in click); they are forward-compatibility hooks for downstream plans.

## Threat Flags

None — no new RLS surfaces beyond those in the plan's threat model. All data flows through existing Plan 10-02 RPC (server-side RLS) and Plan 10-03 broadcast triggers (server-side consent_scope filter). PostHog events are PHI-safe per scoreBucket() type signature enforcement.

## Self-Check: PASSED

- `src/components/clinic/roster/RosterTable.tsx` FOUND
- `src/components/clinic/roster/RosterRow.tsx` FOUND
- `src/components/clinic/roster/RosterMobileCard.tsx` FOUND
- `src/components/clinic/roster/ScoreChip.tsx` FOUND
- `src/components/clinic/roster/ScoreBreakdownPopover.tsx` FOUND
- `src/components/clinic/roster/RosterPagination.tsx` FOUND
- `src/components/clinic/roster/use-rank-roster.ts` FOUND
- `src/components/clinic/roster/use-roster-realtime.ts` FOUND
- `src/lib/clinic-events.ts` FOUND
- `src/components/clinic/roster/RosterTable.test.tsx` FOUND
- `e2e/clinic-roster-sort.spec.ts` FOUND
- Commit `d843a99` FOUND in git log (lib + hooks)
- Commit `5a95551` FOUND in git log (UI components)
- Commit `f3b7039` FOUND in git log (ClinicWorkspace integration)
- Commit `6af9a7c` FOUND in git log (tests)
- No file deletions in any commit

---

*Phase: 10-clinic-operator-surface*
*Completed: 2026-05-13*
