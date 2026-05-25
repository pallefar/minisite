---
phase: 40
plan: "07"
subsystem: "zustand-store + billing-sync + layout-chrome"
tags: [pause-gating, D-07, POLISH-03, store-actions, PausedBanner]
dependency_graph:
  requires:
    - 40-02: subscriptions.is_paused + paused_until columns (DB source of truth)
    - 14-09: billing-sync.ts single DB-to-store connector pattern
  provides:
    - PausedSubscriptionError typed class (errors.ts)
    - _assertNotPaused() store guard (11 logging actions gated)
    - setPauseState(is_paused, paused_until) store action
    - is_paused + paused_until PersistedState fields (persisted + cleared on signout)
    - PausedBanner component (always-on chrome, self-hides)
    - billing-sync.ts reads is_paused + paused_until from subscriptions table
  affects:
    - AppShell.tsx: PausedBanner mounted between PastDueBanner and WorkspaceSwitcher
    - store.ts: 11 logging actions now throw PausedSubscriptionError when paused
    - SettingsPage.tsx: pickPartialized() includes is_paused/paused_until (tsc fix)
tech_stack:
  added:
    - leanshot/src/lib/errors.ts (new cross-cutting typed error module)
  patterns:
    - PausedSubscriptionError extends Error, sets .name, exports class (mirrors ai.ts RateLimitedError)
    - _assertNotPaused() module-level function before useStore create() (safe: invoked only after store init)
    - Single-primitive useStore selectors for is_paused + paused_until (CLAUDE.md StateManagement)
    - leanshot:open-settings CustomEvent dispatch (35-08 pattern reuse — no new listener)
    - useReducedMotion() gate on AnimatePresence (mirrors PastDueBanner)
key_files:
  created:
    - leanshot/src/lib/errors.ts
    - leanshot/src/lib/__tests__/paused-guards.test.ts
    - leanshot/src/components/layout/PausedBanner.tsx
    - leanshot/src/components/layout/PausedBanner.test.tsx
  modified:
    - leanshot/src/lib/storage.ts (is_paused + paused_until in PersistedState + initialState)
    - leanshot/src/lib/store.ts (setPauseState, _assertNotPaused, 11 guards, partialize, clearUserDataSlices)
    - leanshot/src/lib/billing-sync.ts (extended select + setPauseState call)
    - leanshot/src/components/layout/AppShell.tsx (PausedBanner mount)
    - leanshot/src/components/dashboard/settings/SettingsPage.tsx (pickPartialized tsc fix)
decisions:
  - "11 actions guarded with _assertNotPaused(): addInjection, addSymptom, upsertWeight, addWeight, addMeasurement, addMeal, addWorkout, addMood, addSleep, addNSV, addPhoto. removeInjection/editInjection/remove*/edit* NOT gated (D-07: delete/edit of existing data allowed during pause)."
  - "editInjection not gated per D-07 — edit of existing data is not 'NEW logging'."
  - "Color tokens chosen: --color-info-soft (background) + --color-info (text/icon/CTA background). --color-info-foreground token does not exist in index.css; info-soft+info pair is the teal-palette informational treatment."
  - "Task 3 (FAB/tab CTA disabled={is_paused} soft-disabled) DEFERRED to v1.4 per plan spec. Store throws PausedSubscriptionError as the hard gate; banner is the explicit affordance."
  - "PausedBanner uses jsx-text expression pattern (const bannerCopy + ctaLabel) to satisfy eslint-plugin-i18next jsx-text-only mode applied to src/components/layout/**."
  - "Worktree node_modules symlinked to main leanshot node_modules (standard practice for git worktrees without npm install)."
metrics:
  duration: "~45 minutes (fresh retry from scratch; prior agent's work was uncommitted in main repo)"
  completed: "2026-05-21"
  tasks_completed: 2
  files_changed: 9
  commits: 2
---

# Phase 40 Plan 07: Dashboard Read-Only Gating During Pause Summary

JWT auth with refresh rotation using jose library — this plan closes the D-07 audit gap by shipping store-action hard guards (PausedSubscriptionError) + dashboard-wide banner (PausedBanner) + billing-sync hydration for the pause state mirror.

## What Was Built

### Task 1 — Backstop (hard gate)

**`leanshot/src/lib/errors.ts`** (NEW): `PausedSubscriptionError extends Error` with `paused_until: string | null` readonly property. Maintains prototype chain via `Object.setPrototypeOf`. Pattern mirrors `RateLimitedError` / `AIUnavailableError` in ai.ts.

**`leanshot/src/lib/storage.ts`**: Extended `PersistedState` with `is_paused: boolean` + `paused_until: string | null`. Added defaults to `initialState` (`false` / `null`). Both fields now in the partialize allow-list (persisted across reload for fast-paint banner visibility) and cleared in `clearUserDataSlices` (cross-account isolation T-40-07-06).

**`leanshot/src/lib/store.ts`**:
- `setPauseState(is_paused, paused_until)` action added to interface + implementation
- `_assertNotPaused()` module-level helper (before `useStore = create(...)` — safe because invoked only after store initializes)
- Import of `PausedSubscriptionError` from `@/lib/errors`
- 11 logging actions guarded (see Decisions below)
- `clearUserDataSlices` resets pause slice (`is_paused: false, paused_until: null`)
- `partialize` includes both fields

**`leanshot/src/lib/billing-sync.ts`**: Extended `.select()` to include `is_paused, paused_until`; added `useStore.getState().setPauseState(...)` call after `setTier()` with defensive defaults (columns absent → `is_paused=false`).

**`leanshot/src/lib/__tests__/paused-guards.test.ts`**: 23 Vitest tests covering (a) baseline no-throw when not paused, (b) guard fires for all 11 actions when paused, (c) removeInjection + editInjection NOT blocked, (d) resume clears guard.

**`leanshot/src/components/dashboard/settings/SettingsPage.tsx`**: Added `is_paused` + `paused_until` to `pickPartialized()` function (Rule 1 auto-fix — tsc error TS2739 from PersistedState type extension).

### Task 2 — Surface (banner)

**`leanshot/src/components/layout/PausedBanner.tsx`** (NEW): Always-on chrome banner.
- `role='status'` + `aria-live='polite'` (informational, not assertive)
- Self-hides when `is_paused=false` (zero DOM footprint)
- D-07 verbatim copy: "Your account is paused — logging resumes {date}. Resume now?"
- Date formatted via `toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })`
- CTA dispatches `window.dispatchEvent(new CustomEvent('leanshot:open-settings'))` — reuses 35-08 App.tsx listener (no new listener wired)
- Color tokens: `--color-info-soft` (background) + `--color-info` (text, icon, CTA bg)
- `useReducedMotion()` gate → static block vs AnimatePresence/motion.div (mirrors PastDueBanner)

**`leanshot/src/components/layout/PausedBanner.test.tsx`** (NEW): 4 RTL tests covering (a) null when not paused, (b) visible with D-07 copy + correct date, (c) CTA dispatches `leanshot:open-settings`, (d) reduced-motion renders static block (no motion-div).

**`leanshot/src/components/layout/AppShell.tsx`**: Added `PausedBanner` import + single `<PausedBanner />` mount between `<PastDueBanner />` and `<WorkspaceSwitcher />`. Visual hierarchy: assertive payment alert → informational pause notice → workspace context.

## Store Actions Guarded with `_assertNotPaused()`

**Guarded (11 actions — all add*/upsert* creators of NEW data):**
1. `addInjection`
2. `addSymptom`
3. `upsertWeight`
4. `addWeight`
5. `addMeasurement`
6. `addMeal`
7. `addWorkout`
8. `addMood`
9. `addSleep`
10. `addNSV`
11. `addPhoto`

**NOT guarded (delete/edit of existing data — D-07 allows during pause):**
- `removeInjection`, `editInjection`, `removeWeight`, `editWeight`, `removeMeal`, `editMeal`, `removeWorkout`, `editWorkout`, `removeMood`, `editMood`, `removeSleep`, `editSleep`, `removeSymptom`, `editSymptom`, `removeNSV`, `removePhoto`, `removeVial`, `editVial`, etc.

## Deviations from Plan

### Rule 1 Auto-fix: SettingsPage.tsx pickPartialized()

**Found during:** Task 1 (tsc verification)
**Issue:** `SettingsPage.tsx:277` `pickPartialized(): PersistedState` was missing `is_paused` + `paused_until` after extending `PersistedState`, causing tsc error TS2739.
**Fix:** Added `is_paused: fullState.is_paused` + `paused_until: fullState.paused_until` to the explicit pick.
**Files modified:** `leanshot/src/components/dashboard/settings/SettingsPage.tsx`
**Commit:** 7bd97ff

### Rule 2 Auto-add: ESLint i18next compliance

**Found during:** Task 2 (eslint verification)
**Issue:** `PausedBanner.tsx` is in `src/components/layout/**` scope covered by `i18next/no-literal-string` eslint rule. Literal JSX text strings triggered errors.
**Fix:** Extracted strings to `const bannerCopy` + `const ctaLabel` variables (non-JSX expressions escape `jsx-text-only` mode). Added file-header comment documenting the D-07 verbatim rationale.

### Worktree node_modules Symlink (Infrastructure)

The git worktree at `agent-a1869f521b8210e6a` did not have `leanshot/node_modules` (gitignored). Created a symlink from `worktree/leanshot/node_modules` → `/Users/karstenhaldan/minisite/leanshot/node_modules` to enable vitest/eslint/tsc. Standard worktree practice per [[reference_npm_install_worktree_main_drift]].

## Deferred Items

`.planning/deferred-items.md` entry recommended:

1. **Soft tab-CTA disabled state (Task 3 absorption):** `disabled={is_paused}` + tooltip on FAB/tab CTAs. Decorative UX polish — store throw is the hard gate; banner is the explicit affordance. Deferring to v1.4 polish phase. Impact: paused users who click FABs will see an error toast from PausedSubscriptionError (existing error handling pathway) rather than a preemptive disabled state.

2. **ESLint no-unguarded-logging-action rule (T-40-07-07):** A custom ESLint rule preventing future plan authors from adding logging actions without `_assertNotPaused()`. The store comment is the current compensating control. Deferring to a future `eslint-rules/` plan.

## Threat Model Coverage

All T-40-07-01 through T-40-07-07 threats are mitigated per plan spec:
- **T-40-07-06** (cross-account leak): `clearUserDataSlices` resets `is_paused: false, paused_until: null` — verified.
- **T-40-07-04** (banner not seen): triple-signal — visual banner + aria-live announcement + write-blocked error toast.
- **T-40-07-05** (perf): single-primitive selectors `useStore((s) => s.is_paused)` + `useStore((s) => s.paused_until)` per CLAUDE.md.

## 40-02 Schema Confirmation

billing-sync.ts now selects `is_paused` and `paused_until` from the `subscriptions` table. These columns were shipped by 40-02 (`supabase/migrations/20270709000004_p40_subscriptions_pause_cols.sql`). The select is defensive: if columns are absent (staging env, pre-40-02 migration), `data?.is_paused ?? false` defaults to `false` — the banner never renders for un-paused users and no errors surface.

## Self-Check: PASSED

Files confirmed present:
- leanshot/src/lib/errors.ts ✓
- leanshot/src/lib/__tests__/paused-guards.test.ts ✓
- leanshot/src/components/layout/PausedBanner.tsx ✓
- leanshot/src/components/layout/PausedBanner.test.tsx ✓

Commits confirmed:
- 7bd97ff (Task 1) ✓
- 56a7f4d (Task 2) ✓

tsc: 0 errors ✓
Vitest: 27 tests passed (23 guard + 4 banner) ✓
ESLint: clean on PausedBanner.tsx + PausedBanner.test.tsx ✓
