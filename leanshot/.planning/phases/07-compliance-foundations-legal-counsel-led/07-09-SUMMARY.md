---
phase: 07-compliance-foundations-legal-counsel-led
plan: 09
subsystem: typescript-strict / null-safety / zustand
tags: [refactor, typescript-strict, null-safety, zustand, rules-of-hooks]
requirements: [D-06]
dependency-graph:
  requires:
    - "Phase 6 D-12 nullable-selector pattern (src/components/dashboard/charts/MedLevelChart.tsx)"
  provides:
    - "Codebase-wide elimination of `s.user!` non-null assertions in src/"
    - "Canonical nullable-selector + early-return shape applied to 13 components"
  affects:
    - "Future Phase 7 plans 07-04 (export) and 07-08 (restore-from-backup) — they will add new SettingsPage sections to a clean post-refactor merge base"
tech-stack:
  patterns:
    - "Nullable Zustand selector: `useStore((s) => s.user)` returning `User | null`"
    - "Rules-of-Hooks-safe early-return: `if (!u) return null;` placed AFTER every hook"
    - "useMemo / useEffect closure short-circuit on null `u` (defense in depth)"
key-files:
  modified:
    - "src/components/dashboard/charts/SimpleCharts.tsx (2 occurrences → 0)"
    - "src/components/dashboard/cards/EffectivenessCard.tsx"
    - "src/components/dashboard/cards/GLPCurveCard.tsx"
    - "src/components/dashboard/cards/HeroCard.tsx"
    - "src/components/dashboard/tabs/BodyTab.tsx"
    - "src/components/dashboard/tabs/InsightsTab.tsx"
    - "src/components/dashboard/tabs/NutritionTab.tsx"
    - "src/components/dashboard/modals/DoctorReport.tsx"
    - "src/components/dashboard/modals/PhotoCompareModal.tsx"
    - "src/components/dashboard/share/ShareCardModal.tsx"
    - "src/components/dashboard/ai/AIChatPanel.tsx"
    - "src/components/dashboard/settings/SettingsPage.tsx"
    - "src/components/dashboard/tabs/MedicationTab.test.tsx (doc-comment scrub)"
    - "src/components/dashboard/charts/MedLevelChart.tsx (doc-comment scrub — deviation)"
decisions:
  - "Scrubbed an extra doc-comment in MedLevelChart.tsx not enumerated in the plan inventory so the acceptance grep can return zero (Rule 3 deviation)."
metrics:
  duration: "~10 minutes"
  completed: "2026-05-12"
  commits: 13
  files_touched: 14
  occurrences_removed: 14
---

# Phase 7 Plan 07-09: Eliminate s.user! Non-null Assertions Summary

Codebase-wide sweep retired every `s.user!` non-null assertion on the Zustand user selector in `src/`, migrating 13 components to the verified Phase 6 D-12 nullable-selector + Rules-of-Hooks-safe early-return pattern. One commit per file; 13 atomic commits total; `grep -rn "s\.user!" src/` returns zero matches; typecheck / lint / 434 unit tests all green; bundle delta +160 bytes gz (well under the 200-byte refactor expectation).

## Inventory Delta

| Phase | Source code occurrences | Doc-comment occurrences | Total grep matches |
|-------|------------------------:|------------------------:|-------------------:|
| Before plan (baseline)         | 14 | 2 | 16 |
| Plan inventory (planner count) | 14 | 1 | 15 |
| After plan (final)             | 0  | 0 | 0  |

The plan inventory under-counted by one doc-comment: `MedLevelChart.tsx:14` contained the literal `s.user!` token inside the reference doc-comment that documents the canonical pattern. The acceptance grep is the loose form (`grep -rn "s\.user!"`) and would have failed if that line remained. Scrubbed in the same final commit as the `MedicationTab.test.tsx:25` doc-comment per Rule 3 (auto-fix blocking issue). Both scrubs preserve the historical/explanatory intent — they just stop spelling the literal token.

## Per-File Notes

1. **SimpleCharts.tsx** (`4d94605`) — Both WeightChart and ProteinChart in one commit (same file, plan-mandated). useMemo bodies short-circuit on `!u`; deps changed from `[u.startWeight, ...]` / `[u.proteinTarget, ...]` to `[u, ...]` (otherwise deps would deref null).

2. **EffectivenessCard.tsx** (`bcfed9f`) — Simplest case: no useMemo/useEffect. Early-return immediately after the five useStore hooks.

3. **GLPCurveCard.tsx** (`917642e`) — Restructured: the outer `halfLife` derivation moved INTO the useMemo body (it derefs `u.medication`), and the memo now returns `{ halfLife, path, area, dotMarkers, axisLabels }` so the post-guard render block can use halfLife without re-deriving. `currentLevel`/`peakOrTrough`/`nextHours` moved BELOW the early-return.

4. **HeroCard.tsx** (`cc7eadd`) — 9 hooks (useStore×4 + useReducedMotion + useCountUp×4) all kept unconditional. `lost`/`goalLoss`/`goalPct` defensively compute 0 when u is null so the useCountUp hooks receive stable numeric inputs in the transient frame before the early-return.

5. **BodyTab.tsx** (`b5ed5d1`) — 8 useStore + useToast + 3 useState. Early-return after the useState calls; render-path derefs (u.units, u.startWeight, u.medication) all below the guard.

6. **InsightsTab.tsx** (`d6ec12b`) — useMemo body short-circuits: returns `[]` when u is null (rather than calling generateInsights with a null user). Deps still include u.

7. **NutritionTab.tsx** (`9ae8a30`) — Simple early-return after useStore×8 + useToast + useState×2. submit() and aiEstimate() handlers don't deref u, so no inner-closure narrowing concerns.

8. **DoctorReport.tsx** (`166a7d3`) — Trivial: 4 useStore calls, early-return, render below.

9. **PhotoCompareModal.tsx** (`b6ffe15`) — Trivial: useStore×2 + useState, then early-return.

10. **ShareCardModal.tsx** (`0ff6e67`) — `data` ShareData object now conditionally constructed: `u ? {...} : null`. useEffect body short-circuits with `if (!open || !data) return;` so the canvas-draw closure can't touch a null user. Pre-existing exhaustive-deps warning shifted location but total count unchanged (5 warnings before → 5 warnings after).

11. **AIChatPanel.tsx** (`71348a5`) — Densest hook stack in the sweep (useStore×7 + useConfirm + useState×2 + useRef + useEffect). useEffect body only references open/history/busy/messagesEndRef (no u deref). Early-return placed after the useEffect; the giant `ctx` string and `send` async closure are all below the guard.

12. **SettingsPage.tsx** (`505dd43`) — Diff intentionally minimal per plan note (07-04 and 07-08 land later). The `draft` useState switched to a lazy initializer with a typed empty fallback `{ ...(u ?? ({} as NonNullable<typeof u>)) }` so hook order is preserved when u is null on first mount; the early-return guarantees that placeholder draft never reaches render.

13. **Doc-comment scrubs** (`46cb654`) — Final cleanup: MedicationTab.test.tsx:25 + MedLevelChart.tsx:14 (the latter not in the plan inventory; see Deviations).

## Test Updates

None — no test file had its assertion shape migrated. Every co-located test continues to assert the existing render behavior. The 434 unit tests pass unchanged after each commit. (The only test-file edit is the doc-comment scrub in MedicationTab.test.tsx, which doesn't touch test code.)

## Acceptance Evidence

### The acceptance grep (D-06 contract)

```
$ grep -rn "s\.user!" src/
$ echo "exit=$?"
exit=1   # grep exit-1 = no matches found
```

Zero matches across `src/`. The D-06 acceptance is met.

### The three-way AND gate

```
$ npm run typecheck
> tsc -b --noEmit
(no output, exit 0)

$ npm run lint
✖ 5 problems (0 errors, 5 warnings)
(All 5 warnings are pre-existing; total count unchanged from baseline.)

$ npm run test:unit
 Test Files  27 passed (27)
      Tests  434 passed (434)
```

### Build + bundle size

```
$ npm run build
✓ built in 2.75s
dist/assets/index-DUPPDQHo.js              74.79 kB │ gzip: 21.65 kB
```

Index gzipped bundle: **21.65 kB** (baseline 21.49 kB before plan → delta **+0.16 kB / +160 bytes**). Well under the planner's < 200 byte expectation and the 50 kB CI ceiling.

### Commit-count check

```
$ git log --oneline | grep -c "07-09"
13
```

13 commits exactly: 12 source-file refactors + 1 doc-comment scrub = 13. SimpleCharts.tsx counts as 1 commit (2 occurrences in same file, plan-mandated).

### E2E spot

```
$ npm run test:e2e
1 passed (onboarding.spec.ts)
10 skipped (deferred by Phase 7 Plan 07-01 — running in parallel)
```

The 10 skipped specs are out of scope per the orchestrator instruction ("07-01 is sweeping e2e specs in parallel — DO NOT touch any leanshot/e2e/* files in this plan").

## Deviations from Plan

### [Rule 3 - Blocking issue] Scrubbed MedLevelChart.tsx:14 reference doc-comment

- **Found during:** Task 1 inventory grep
- **Issue:** The plan inventory listed 14 source occurrences + 1 doc-comment in MedicationTab.test.tsx (15 lines total). The loose-form acceptance grep `grep -rn "s\.user!" src/` actually matched 16 lines because MedLevelChart.tsx's reference doc-comment also contained the literal `s.user!` token (used to explain the prior crashing pattern). Without scrubbing it, the acceptance gate could not pass.
- **Fix:** Rewrote the MedLevelChart.tsx:11-21 doc-comment to preserve the full historical/explanatory intent (now cross-references both Phase 6 D-12 and Phase 7 D-06 / Plan 07-09) without using the literal `s.user!` token. Scrubbed in the same final commit as the MedicationTab.test.tsx:25 scrub (`46cb654`).
- **Why it's a Rule 3 deviation, not a scope expansion:** The acceptance contract is grep-based; the doc-comment matched the grep; the only way to satisfy the acceptance was to scrub it. No code semantics change, no behavior change, no test affected.
- **Files modified:** `src/components/dashboard/charts/MedLevelChart.tsx`
- **Commit:** `46cb654`

No other deviations. No `as User` substitutions, no `?? DEFAULT_USER` fallbacks, no early-returns before hooks, no `// eslint-disable rules-of-hooks` directives, no `--no-verify` commits. All 13 commits passed the per-file typecheck + lint + test:unit gate cleanly the first time.

## CI Guard Follow-up Recommendation (T-07-09-04 from threat model)

The locked decision in 07-CONTEXT.md / D-06 implies a CI guard to prevent future regressions. Recommended addition to `.github/workflows/ci.yml`:

```yaml
- name: Forbid s.user! non-null assertions
  run: |
    if grep -rn "s\.user!" leanshot/src/; then
      echo "::error::s.user! reintroduced — see plan 07-09 and Phase 6 D-12"
      exit 1
    fi
```

Out of scope for this refactor plan but flagged as a recommended Phase 7 follow-up. The 5-line ripgrep step costs negligible CI time and prevents the entire class of regression.

## Bundle Size Delta

| Asset | Before plan (Phase 6 ship) | After plan | Delta |
|-------|---------------------------:|-----------:|------:|
| `dist/assets/index-*.js` (gz) | 21.49 kB | 21.65 kB | +0.16 kB (+160 bytes) |

Refactor-only as expected; +160 bytes is attributable to the small added defensive narrowing (`if (!u) return null` × 13 files + a handful of conditional ternaries in HeroCard / ShareCardModal). Well under the planner's < 200 byte flag threshold and 0.3% of the 50 kB ceiling.

## Known Stubs

None — this plan is a pure refactor. No new UI surface, no hardcoded empty placeholders, no "coming soon" text. The `if (!u) return null` early-returns are not stubs; they're the sanctioned shape for a transient null-user frame, identical to the Phase 6 D-12 reference pattern in MedLevelChart.tsx.

## Threat Flags

None — pure refactor; no new attack surface introduced. All five STRIDE threats enumerated in the plan's threat model are mitigated by the per-file gate cadence + the final 3-way AND acceptance, which all passed.

## Self-Check: PASSED

All 14 modified files exist on disk. All 13 commits exist in `git log --oneline`. Acceptance grep returns zero. Typecheck / lint (0 errors) / 434 unit tests / build all green. Index bundle 21.65 kB gz under the 50 kB ceiling. D-06 contract met.
