---
phase: 13-design-system-v2-rollout
plan: 07
subsystem: ui-illustrations
tags: [addendum, illustration-wiring, DS-12, SC-4]
dependency-graph:
  requires: [13-03]
  provides: [DS-12-closure]
  affects: [MedicationTab, StreaksCard, ActivityTab, DoctorReport, InsightsTab, NutritionTab]
tech-stack:
  added: []
  patterns: [orphan-consumer-wiring]
key-files:
  created:
    - leanshot/.planning/phases/13-design-system-v2-rollout/13-07-SUMMARY.md
  modified:
    - leanshot/src/components/dashboard/tabs/MedicationTab.tsx
    - leanshot/src/components/dashboard/cards/StreaksCard.tsx
    - leanshot/src/components/dashboard/tabs/ActivityTab.tsx
    - leanshot/src/components/dashboard/modals/DoctorReport.tsx
    - leanshot/src/components/dashboard/tabs/InsightsTab.tsx
    - leanshot/src/components/dashboard/tabs/NutritionTab.tsx
decisions:
  - Substituted streaks.supps for spec-referenced streaks.injection (which does not exist on useStreaks return shape) for the AchievementShield milestone trigger.
  - Applied staticOnly prop on ActivityRings + HeartPulse where they live inside small CardHeader / summary tiles to avoid competing rotation with surrounding motion.
metrics:
  duration: 18m
  completed: 2026-05-13T18:18:44Z
  tasks: 8
  files-touched: 6
  commits: 6
---

# Phase 13 Plan 07: Orphan Illustration Wirings (Addendum) Summary

**One-liner:** Closed the Phase 13 SC #4 / DS-12 verification gap by wiring 8 orphaned `src/illustrations/*` components into their intended consumer surfaces without touching the components themselves — pure additive visual wiring across 6 dashboard files.

## Upstream Signal

The Phase 13 verifier flagged 8 of the Plan 13-03 illustrations as orphans — they shipped to `src/illustrations/` but no application surface consumed them, leaving the design-system rollout's SC #4 / DS-12 acceptance criterion only partially satisfied. This addendum executes the wiring layer that 13-03 stopped short of.

Per the user's "Addendum pattern for mid-execution pivots" convention (memory: `feedback_addendum_pattern_for_mid_execution_pivots`), this lands as a numbered plan **13-07** alongside the prior six Phase 13 plans — no replan, no STATE/ROADMAP mutation.

## Wirings Landed

| # | Illustration       | Consumer                                | Surface                                            | Commit    |
| - | ------------------ | --------------------------------------- | -------------------------------------------------- | --------- |
| 1 | `PenInjector`      | `MedicationTab.tsx`                     | CardHeader `action` slot on "Log new injection"    | `413ba22` |
| 2 | `CalendarDose`     | `MedicationTab.tsx`                     | Left anchor on "Titration schedule" card           | `413ba22` |
| 3 | `AchievementShield`| `StreaksCard.tsx`                       | Conditional milestone tile (any streak ≥ 30 d)     | `a84ce19` |
| 4 | `ActivityRings`    | `ActivityTab.tsx`                       | "Steps & health" summary row + today's step count  | `6c947c9` |
| 5 | `DoctorClipboard`  | `DoctorReport.tsx` (modal)              | Modal header hero next to patient name             | `366a560` |
| 6 | `HeartPulse`       | `InsightsTab.tsx`                       | "Smart insights" CardHeader `action` (staticOnly)  | `7f8eb1d` |
| 7 | `EmptyInsights`    | `InsightsTab.tsx`                       | Empty-state illustration for `insights.length===0` | `7f8eb1d` |
| 8 | `EmptyPlate`       | `NutritionTab.tsx`                      | "Today's meals" empty-state via `EmptyState` shell | `c9d6f8c` |

Post-wiring orphan-consumer count for each illustration: **1 / 1 / 1 / 1 / 1 / 1 / 1 / 1** (all ≥ 1).

## Commits

```
c9d6f8c feat(13-07): wire EmptyPlate into NutritionTab empty state
7f8eb1d feat(13-07): wire HeartPulse + EmptyInsights into InsightsTab
366a560 feat(13-07): wire DoctorClipboard hero into DoctorReport modal
6c947c9 feat(13-07): wire ActivityRings summary tile into ActivityTab
a84ce19 feat(13-07): wire AchievementShield milestone tile into StreaksCard
413ba22 feat(13-07): wire PenInjector + CalendarDose into MedicationTab
```

Each commit was scoped to one consumer file via pathspec (`git commit -- <file>`) per `feedback_parallel_executor_git_isolation`.

## Bundle Delta vs Baseline (`8012c57`)

| Chunk          | Baseline gz | Post gz   | Δ gz      | Note                                            |
| -------------- | ----------- | --------- | --------- | ----------------------------------------------- |
| index          | 13.62 kB    | 13.62 kB  | **0**     | Below 50 kB absolute ceiling. No regression.    |
| MedicationTab  | 4.72 kB     | 5.86 kB   | +1.14 kB  | PenInjector + CalendarDose (lazy-loaded chunk). |
| InsightsTab    | 5.39 kB     | 6.38 kB   | +0.99 kB  | HeartPulse + EmptyInsights (lazy-loaded).       |
| HomeTab        | 8.17 kB     | 8.76 kB   | +0.59 kB  | AchievementShield via StreaksCard (rolled in).  |
| ActivityTab    | (rolled)    | (rolled)  | small     | ActivityRings folded into existing chunk.       |
| DoctorReport   | (rolled)    | (rolled)  | small     | DoctorClipboard folded into existing chunk.     |
| NutritionTab   | (rolled)    | (rolled)  | small     | EmptyPlate folded into existing chunk.          |

**Critical: index chunk delta = 0.** All illustration growth lives in lazy-loaded route chunks. The 50 kB index ceiling and the per-chunk ceilings asserted by `assert-bundle-budget.sh` + `assert-clinic-bundle-budget.sh` both pass at exit 0.

## Verification Gates

| Gate                                      | Status | Detail                                                            |
| ----------------------------------------- | ------ | ----------------------------------------------------------------- |
| `npx tsc -b`                              | PASS   | After every file edit; final pass clean.                          |
| `npm run lint`                            | PASS   | 0 errors in touched files. 105 pre-existing problems unchanged from baseline `8012c57` (verified by re-running lint on a `git worktree add` of the baseline commit — same 105 problems). All pre-existing errors live in `SharePage.tsx`, `shared/sections/*`, etc. — out of Plan 13-07 scope. |
| `npm run build`                           | PASS   | Built in 4.24s. All chunks emit cleanly.                          |
| `bash scripts/assert-bundle-budget.sh`    | PASS   | exit 0 — jspdf topology OK, index chunk jsPDF-free.               |
| `bash scripts/assert-clinic-bundle-budget.sh` | PASS | exit 0 — all clinic per-chunk ceilings + index ceiling green.   |
| All 8 illustrations have ≥1 consumer      | PASS   | `grep -rl "from '@/illustrations/$X'" src/` → 1 each.             |

## Deviations from Plan

### Rule 1 — Bug: Spec referenced non-existent `streaks.injection` key

- **Found during:** Wiring 2 (AchievementShield → StreaksCard)
- **Issue:** Spec literal said `streaks.injection >= 30` as one of the four milestone-trigger predicates, but `useStreaks()` (`src/hooks/useStreaks.ts:10-15`) returns `{ weight, protein, supps, movement }` — there is no `injection` key.
- **Fix:** Substituted `streaks.supps` (the semantically equivalent fourth streak the hook actually tracks). The trigger logic (`any streak ≥ 30 days`) is preserved.
- **Files modified:** `src/components/dashboard/cards/StreaksCard.tsx`
- **Commit:** `a84ce19`
- **Note:** Spec block in the prompt anticipated this drift ("if the `streaks` keys are different… adapt the comparison while preserving the ≥30 trigger logic.")

### Auto-applied — `staticOnly` on ActivityRings + HeartPulse

- **Why:** Both components export a `staticOnly` prop intended for embedding inside small UI surfaces where surrounding motion already exists. Applied at the wiring sites (small summary tile / CardHeader action) to avoid two competing animation loops in the same visual area.
- **No spec deviation:** Spec explicitly noted "use `staticOnly` prop if `ActivityRings` exports it" / "with `staticOnly` if the prop exists".

### No other deviations

No new components introduced. No `src/illustrations/*` modifications. No hex literals (only `var(--color-*)` tokens). No STATE.md or ROADMAP.md touched. No behavioral changes — pure visual wiring.

## Threat Flags

None. This addendum is pure additive visual wiring across already-authored components — no new network surface, no auth path, no schema, no trust boundary.

## Self-Check: PASSED

**File existence checks:**
- `leanshot/src/components/dashboard/tabs/MedicationTab.tsx` — FOUND (modified)
- `leanshot/src/components/dashboard/cards/StreaksCard.tsx` — FOUND (modified)
- `leanshot/src/components/dashboard/tabs/ActivityTab.tsx` — FOUND (modified)
- `leanshot/src/components/dashboard/modals/DoctorReport.tsx` — FOUND (modified)
- `leanshot/src/components/dashboard/tabs/InsightsTab.tsx` — FOUND (modified)
- `leanshot/src/components/dashboard/tabs/NutritionTab.tsx` — FOUND (modified)
- `leanshot/.planning/phases/13-design-system-v2-rollout/13-07-SUMMARY.md` — FOUND (this file)

**Commit existence checks (in `git log --oneline 8012c57..HEAD`):**
- `413ba22` (MedicationTab) — FOUND
- `a84ce19` (StreaksCard) — FOUND
- `6c947c9` (ActivityTab) — FOUND
- `366a560` (DoctorReport) — FOUND
- `7f8eb1d` (InsightsTab) — FOUND
- `c9d6f8c` (NutritionTab) — FOUND

**Illustration consumer count:**
- PenInjector / AchievementShield / ActivityRings / DoctorClipboard / HeartPulse / CalendarDose / EmptyPlate / EmptyInsights — each = 1 consumer.

**Success criteria:**
- [x] All 8 illustration components have ≥1 consumer in `src/`
- [x] `npx tsc -b` + `npm run lint` (no new errors) + `npm run build` all pass
- [x] `bash scripts/assert-bundle-budget.sh` passes (exit 0)
- [x] `bash scripts/assert-clinic-bundle-budget.sh` passes (exit 0)
- [x] No modifications to STATE.md or ROADMAP.md
- [x] 13-07-SUMMARY.md committed
