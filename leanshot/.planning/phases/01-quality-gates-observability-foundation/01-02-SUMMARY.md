---
phase: 1
plan: 2
subsystem: ui-primitives
tags: [dialogs, a11y, hooks, modal]
dependency_graph:
  requires: []
  provides: [useConfirm-hook, ConfirmModal-component]
  affects: [SettingsPage, AIChatPanel, InsightsTab]
tech_stack:
  added: []
  patterns: [promise-based-confirm-hook, modal-composition]
key_files:
  created:
    - src/hooks/useConfirm.ts
    - src/components/ui/Confirm.tsx
    - src/hooks/useConfirm.test.ts
  modified:
    - src/components/dashboard/settings/SettingsPage.tsx
    - src/components/dashboard/ai/AIChatPanel.tsx
    - src/components/dashboard/tabs/InsightsTab.tsx
    - tsconfig.app.json
decisions:
  - "Excluded test files from tsconfig.app.json — test-file deps (vitest, RTL) land in Plan 04"
  - "ConfirmModal adds hideClose=true — confirm dialogs require explicit button choice, no close-X"
  - "InsightsTab CTA removed entirely (not converted) — affiliate feature inactive per D-01"
metrics:
  duration: "3m 42s"
  completed: "2026-05-10T20:46:31Z"
  tasks_completed: 2
  files_count: 7
---

# Phase 1 Plan 2: useConfirm Hook + Native Dialog Migration Summary

Promise-based `useConfirm` hook composing existing Modal primitive, replacing 3 sites of native `confirm()` / `alert()` calls to unblock jsx-a11y ESLint rules.

## What Was Built

### New Files

**`src/hooks/useConfirm.ts`** (69 lines)
Promise-based confirm hook. Calling `confirm("message", opts?)` opens a modal and returns a `Promise<boolean>` that resolves `true` when the user confirms and `false` when they cancel. A second call while a prior is still pending resolves the prior to `false` (cancel semantics) so awaiting callers don't hang. Exports `useConfirm` with the full return type matching the `<ConfirmModal>` prop contract.

**`src/components/ui/Confirm.tsx`** (43 lines)
`ConfirmModal` wrapper composing the existing `Modal` primitive from `src/components/ui/Modal.tsx`. Accepts `open`, `message`, `title`, `confirmLabel`, `cancelLabel`, `destructive`, `onConfirm`, `onCancel`. When `destructive=true` the confirm button uses `variant="destructive"` to match the existing visual convention. Uses `hideClose` on Modal so the user must make an explicit button choice.

**`src/hooks/useConfirm.test.ts`** (51 lines, 4 it() blocks)
Smoke tests for the hook contract covering:
1. `handleConfirm` resolves Promise to `true`
2. `handleCancel` resolves Promise to `false`
3. Second `confirm()` call resolves prior to `false`
4. `destructive` option and label overrides honored

**Note: test file execution requires Plan 04 to wire Vitest + `@testing-library/react`.**

### Modified Files

**`src/components/dashboard/settings/SettingsPage.tsx`**
Replaced double native `confirm()` (lines 78-79) with single async `useConfirm` hook call. The "Reset everything" action now shows a destructive-styled `ConfirmModal` titled "Reset everything" with confirm label "Erase everything". `<ConfirmModal>` rendered once at bottom of returned JSX.

**`src/components/dashboard/ai/AIChatPanel.tsx`**
Replaced inline `if (confirm('Clear conversation history?'))` click handler with async hook invocation. Returns a React fragment to render both `<AnimatePresence>` and `<ConfirmModal>` as siblings. Destructive-styled clear history modal with "Clear" confirm label.

**`src/components/dashboard/tabs/InsightsTab.tsx`**
Removed the "Get the guide →" CTA `<Button>` whose `onClick` called `alert('Connect your payment provider here.')`. Per D-01, the affiliate/payment feature is not active — the card container and marketing copy are preserved; only the placeholder CTA button is removed.

**`tsconfig.app.json`**
Added `"exclude": ["src/**/*.test.ts", "src/**/*.test.tsx"]` to prevent `tsc -b --noEmit` from failing on test files that import `vitest` and `@testing-library/react` (not yet installed — Plan 04 installs them). Without this exclusion, `npm run typecheck` fails with TS2307 for missing type declarations.

## Hook Contract

```typescript
// Calling confirm() opens the modal and returns a Promise:
const ok = await confirm('Are you sure?');
// ok === true  → user clicked the confirm button
// ok === false → user clicked cancel, closed modal, or a second confirm() was called

// Options:
confirm('Erase all data?', {
  title: 'Reset everything',        // modal header title
  confirmLabel: 'Erase everything', // confirm button text (default: 'Confirm')
  cancelLabel: 'Keep data',         // cancel button text (default: 'Cancel')
  destructive: true,                // use variant="destructive" on confirm button
});

// Second-call semantics (documented in JSDoc):
// If confirm() is called while a prior Promise is still pending,
// the prior Promise resolves to false before the new dialog opens.
// This prevents "hanging" await sites if a component re-renders mid-confirm.
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `tsconfig.app.json` excluded test files**
- **Found during:** Task 1 typecheck verification
- **Issue:** `npm run typecheck` failed with TS2307 because `useConfirm.test.ts` imports `vitest` and `@testing-library/react`, which Plan 04 installs. The existing `tsconfig.app.json` included all of `src/` without exclusions.
- **Fix:** Added `"exclude": ["src/**/*.test.ts", "src/**/*.test.tsx"]` so the production typecheck config only covers production source files. Test files will be covered by the Vitest tsconfig created in Plan 04.
- **Files modified:** `tsconfig.app.json`
- **Commit:** d9030ac

**2. [Rule 2 - Missing Critical] ConfirmModal uses `hideClose=true`**
- **Found during:** Task 1 implementation review
- **Issue:** The original plan snippet didn't specify `hideClose`. For a destructive-action confirmation dialog, having an X close button creates a confusing UX (users see three exit paths: confirm, cancel, X). The Modal already supports `hideClose` for this purpose.
- **Fix:** Added `hideClose` prop to `<Modal>` in Confirm.tsx so users must make an explicit button choice.
- **Files modified:** `src/components/ui/Confirm.tsx`
- **Commit:** d9030ac

**3. [Rule 3 - Blocking] AIChatPanel needed React fragment wrapper**
- **Found during:** Task 2 AIChatPanel migration
- **Issue:** AIChatPanel's return value was a single `<AnimatePresence>` element. Adding `<ConfirmModal>` as a sibling required a React fragment wrapper `<>...</>`.
- **Fix:** Wrapped the return in `<>...</>` to accommodate both AnimatePresence and ConfirmModal as siblings.
- **Files modified:** `src/components/dashboard/ai/AIChatPanel.tsx`
- **Commit:** 65e8780

## Known Stubs

None. All dialog sites are fully wired to the hook. InsightsTab CTA removal is intentional (not a stub — affiliate feature is actively deactivated per D-01).

## Threat Surface Scan

No new network endpoints, auth paths, file access, or schema changes introduced. The ConfirmModal is a pure UI component — it renders the existing Modal primitive which already has `role="dialog"` and `aria-modal="true"`. All threat model mitigations from the plan's `<threat_model>` are applied:

- T-1-LOC-04 (Tampering / accidental destructive action): `ok` boolean gates `resetAll()` and `clear()` — destructive actions only proceed on explicit confirm.
- T-1-LOC-05 (Repudiation / a11y regression): Modal primitive provides `role="dialog"`, `aria-modal`, Escape key handling, and focus management.
- T-1-LOC-06 (Information Disclosure): "Connect your payment provider here." placeholder string is fully removed from the codebase.

## Self-Check: PASSED

All created files verified on disk. All task commits verified in git log.
