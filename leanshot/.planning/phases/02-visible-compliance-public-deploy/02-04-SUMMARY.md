---
phase: 02-visible-compliance-public-deploy
plan: 4
subsystem: onboarding-compliance
tags: [disclaimer, onboarding, compliance, modal, analytics]
requirements: [COMPL-04]
dependency-graph:
  requires: [02-01, 02-02, 02-03]
  provides: [DisclaimerModal, DisclaimerBody, OnboardingFlow.Step0]
  affects: [02-05]
tech-stack:
  added: []
  patterns: [composed-modal, inline-step-block, store-getState-write, analytics-track-on-event]
key-files:
  created:
    - src/components/dashboard/DisclaimerModal.tsx
    - src/components/dashboard/DisclaimerModal.test.tsx
  modified:
    - src/components/onboarding/OnboardingFlow.tsx
    - src/components/onboarding/OnboardingFlow.test.tsx
    - e2e/onboarding.spec.ts
decisions:
  - "Step 0 inline-renders DisclaimerBody (not a Modal portal) — PATTERNS row 1; modal portal is reserved for the dashboard fallback in 02-05"
  - "No illustration banner for Step 0 — the absence reinforces 'this is a gate, not a form'; the empty illustration AnimatePresence container still mounts so the layout chrome is preserved"
  - "Footer condition changed from `step < TOTAL_STEPS` to `step < TOTAL_STEPS - 1` so 'Open dashboard' fires at step 7 (the last content step) rather than at step 8 (which is now beyond the renderable step blocks)"
  - "next() guarded with `if (step === 0) return` — Step 0 advances exclusively through handleAcknowledge so analytics fires `disclaimer_acknowledged` and never `onboarding_step_completed` for the disclaimer step"
metrics:
  duration_minutes: 6
  completed: 2026-05-11
---

# Phase 02 Plan 04: Insert Step 0 Disclaimer into OnboardingFlow Summary

Blocking medical disclaimer wired as Step 0 of the existing OnboardingFlow — TOTAL_STEPS bumped 7→8, initial step set to 0, `acknowledgeDisclaimer('v1')` + `track('disclaimer_acknowledged')` fire on the single forward path.

## What was built

- **`DisclaimerModal.tsx`** — exports two components from one file:
  - `DisclaimerBody({ onAcknowledge })` — standalone copy + primary "I understand" button, no Modal chrome, suitable for inline use inside any step card. Used directly by Step 0 of OnboardingFlow.
  - `DisclaimerModal({ open, onAcknowledge })` — composes `<Modal>` with `dismissible={false}` + `hideClose`, body is `<DisclaimerBody>`. Designed for 02-05's dashboard-render fallback.
- **`DisclaimerModal.test.tsx`** — 5 tests:
  - Renders required copy floor (D-12: "Not medical advice", "Your data stays on this device", "I understand" button).
  - Calls `onAcknowledge` exactly once on click.
  - Does NOT call `onAcknowledge` on Escape (D-09 — no decline).
  - Does NOT render a Close (X) button (D-09).
  - `DisclaimerBody` renders the same copy without Modal chrome.
- **`OnboardingFlow.tsx`** — Step 0 inserted before the existing `step === 1` block:
  - `const TOTAL_STEPS = 8;`
  - `useState(0)` for the initial step.
  - `back()` clamps to `Math.max(0, s - 1)` (Step 0 has no Back button so this is purely a safety clamp).
  - `next()` guarded with `if (step === 0) return;` — the only path off Step 0 is `handleAcknowledge`.
  - `handleAcknowledge`: `useStore.getState().acknowledgeDisclaimer('v1')` → `track('disclaimer_acknowledged', { version: 'v1' })` → `setStep(1)`.
  - Step 0 body: heading "Before you start" + `<DisclaimerBody onAcknowledge={handleAcknowledge} />`.
  - Footer button row branches on `step === 0` to render `null` — `DisclaimerBody` owns its own button (D-09: no Back, no Cancel on Step 0).
  - Footer Continue/Open-dashboard branch updated from `step < TOTAL_STEPS` to `step < TOTAL_STEPS - 1` so "Open dashboard" still fires at the Ready step (step 7) — without that change, "Open dashboard" would be unreachable because step 8 has no body block.
  - No illustration banner for Step 0 (the per-step illustration registry doesn't include `step === 0`, so the AnimatePresence simply renders an empty motion.div for that step).
- **`OnboardingFlow.test.tsx`** — Test renamed to "completes the 8-step happy path (Step 0 disclaimer + 1-7 onboarding)…". Step 0 ack click prepended before the existing flow. `beforeEach` now resets `acknowledgedDisclaimer: undefined`. Final assertion added: `expect(useStore.getState().acknowledgedDisclaimer).toBe('v1')`.
- **`e2e/onboarding.spec.ts`** — Test renamed to "marketing → 8 steps (Step 0 + 1-7) → HomeTab dashboard". After the marketing CTA click, prepended a `getByText(/not medical advice/i)` visibility assertion + `getByRole('button', { name: /i understand/i }).click()`.

## Final state machine values

| Field | Old (Phase 1) | New (this plan) |
|---|---|---|
| `TOTAL_STEPS` | 7 | **8** |
| Initial step | `useState(1)` | **`useState(0)`** |
| `back()` clamp | `Math.max(1, s - 1)` | **`Math.max(0, s - 1)`** |
| Footer-button branch | `step < TOTAL_STEPS ? Continue : Open` | **`step < TOTAL_STEPS - 1 ? Continue : Open`** |
| `next()` guard | (none) | **`if (step === 0) return;`** |

## Step 0 illustration

**No illustration was added for Step 0** (planner discretion option A from the plan). The illustration AnimatePresence still mounts on step change but nothing matches `step === 0`, so it renders an empty motion.div. The absence reinforces "this is a gate, not a form" and matches D-08's intent of putting the disclaimer in front of the user before any data-entry vibe begins.

## `next()` guard

An explicit `if (step === 0) return;` guard was added at the top of `next()` even though `next()` is only invoked from the Continue button (which is hidden for Step 0). The guard is defensive — it ensures that if a future change mounts a `next()` call from a keyboard handler or programmatic flow, the analytics event `onboarding_step_completed` will not fire for the disclaimer step. The disclaimer's analytics signal is the dedicated `disclaimer_acknowledged` event, not a generic step-completion.

## Verification results

- `npm run typecheck` — exits 0.
- `npm run test:unit` — **81 tests pass** across 10 files (5 new + 76 pre-existing).
- `npm run test:e2e -- e2e/onboarding.spec.ts` — **1 test passes (4.3s)**.

## Deviations from Plan

**1. [Rule 1 - Bug] Footer button-row condition needed adjustment**

- **Found during:** Task 2 first GREEN run.
- **Issue:** With TOTAL_STEPS=8 but only 7 content step blocks (1-7), the existing `step < TOTAL_STEPS` Continue/Open-dashboard branch made "Open dashboard" only fire at `step === 8`, which has no body content — the user would see an empty card at the end. The RTL test failed at "Step 7: Ready" because the Continue button was still rendered instead of "Open dashboard".
- **Fix:** Changed the branch to `step < TOTAL_STEPS - 1`, so "Open dashboard" fires at `step === 7` (Ready). The `complete()` handler still fires `track('onboarding_completed', { totalSteps: TOTAL_STEPS })` reporting 8 (correct: the user did walk 8 screens including the disclaimer).
- **Files modified:** `src/components/onboarding/OnboardingFlow.tsx`.
- **Commit:** cd0ecad.

**2. [Rule 2 - Critical] Reset `acknowledgedDisclaimer` in test `beforeEach`**

- **Found during:** Task 2 RED phase.
- **Issue:** The Phase 1 test reset only `user: null` in `beforeEach`. With persist middleware sharing state across tests, a previously-acknowledged `'v1'` value would leak into subsequent renders if the suite grows.
- **Fix:** Reset `acknowledgedDisclaimer: undefined` alongside `user: null` so every test starts at the disclaimer gate.
- **Commit:** 8b095bb.

No Rule 4 (architectural) deviations. No authentication gates.

## Auto-approval / acknowledgment trace

- Step 0 'I understand' click: `useStore.getState().acknowledgeDisclaimer('v1')` writes `acknowledgedDisclaimer: 'v1'` into the persisted store (D-10). Verified by the new RTL assertion `expect(useStore.getState().acknowledgedDisclaimer).toBe('v1')`.
- `track('disclaimer_acknowledged', { version: 'v1' })` fires synchronously in the same handler before `setStep(1)`. The analytics call is a no-op when `VITE_ANALYTICS_ENABLED !== 'true'` (per 02-03's wiring), so tests do not need to mock PostHog.

## Threat Flags

None. Step 0 introduces no new network surface, no new file access, and no new auth path. The acknowledgment write goes through the existing Zustand store action `acknowledgeDisclaimer` (added in 02-01), which is already covered by the Phase 2 threat model.

## Self-Check: PASSED

- `src/components/dashboard/DisclaimerModal.tsx` — exists.
- `src/components/dashboard/DisclaimerModal.test.tsx` — exists.
- Commit `cfecaa9` (test RED) — found in `git log --oneline --all`.
- Commit `3d0ee7f` (feat GREEN DisclaimerModal) — found.
- Commit `8b095bb` (test RED Step 0) — found.
- Commit `cd0ecad` (feat GREEN Step 0) — found.
- `git grep -c "TOTAL_STEPS = 8" src/components/onboarding/OnboardingFlow.tsx` — 1.
- `git grep -c "useState(0)" src/components/onboarding/OnboardingFlow.tsx` — 1.
- `git grep -c "acknowledgeDisclaimer" src/components/onboarding/OnboardingFlow.tsx` — 1.
- `i understand` appears in both updated test files — 2 files.
- All 81 unit tests + 1 e2e test pass; typecheck clean.
