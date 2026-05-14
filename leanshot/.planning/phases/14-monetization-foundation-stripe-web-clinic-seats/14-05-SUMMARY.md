---
phase: 14-monetization-foundation-stripe-web-clinic-seats
plan: "05"
subsystem: billing-frontend
tags: [billing, tier-gate, paywall, zustand, stripe, react]
dependency_graph:
  requires: [14-03]
  provides: [tier-state-zustand, tier-gate-component, pharma-forecast-gate, ai-model-selector-gate]
  affects: [MedLevelChart, AIChatPanel, store, types]
tech_stack:
  added: []
  patterns: [tier-gate-blur-upsell, reduced-motion-fallback, registry-orphan-guard, dynamic-import-signout]
key_files:
  created:
    - leanshot/src/lib/billing.ts
    - leanshot/src/lib/billing.test.ts
    - leanshot/src/components/billing/TierGate.tsx
    - leanshot/src/components/billing/PaywallUpsell.tsx
    - leanshot/src/components/billing/TierGate.test.tsx
  modified:
    - leanshot/src/types/index.ts
    - leanshot/src/lib/store.ts
    - leanshot/src/lib/storage.ts
    - leanshot/src/components/dashboard/charts/MedLevelChart.tsx
    - leanshot/src/components/dashboard/ai/AIChatPanel.tsx
    - leanshot/src/components/dashboard/settings/SettingsPage.tsx
decisions:
  - "ad-free registry key documented as Phase 20 consumer (intentional orphan)"
  - "MedLevelChart wraps only BaseChart (not full card) in TierGate to keep card header/legend readable"
  - "Past confidence bands (Upper/Lower bound Past) gated with Projected — plan action explicitly covers all showBand entries"
metrics:
  duration: "~46 minutes"
  completed: "2026-05-14"
  tasks_completed: 3
  tests_added: 24
  files_modified: 6
  files_created: 5
---

# Phase 14 Plan 05: Frontend Gating Slice Summary

JWT auth-aligned billing tier state + TierGate primitive + surgical paywall wraps on MedLevelChart and AIChatPanel delivering the first end-to-end SUBSCRIBE → UNLOCK gate of Phase 14.

## What Was Built

**Task 1 — Billing types + Zustand slice + billing.ts library**

- Added `Tier`, `SubscriptionProvider`, `BillingState` to `src/types/index.ts`
- Extended `PersistedState` / `initialState` in `storage.ts` with 4 billing fields (`tier`, `current_period_end`, `plan_id`, `provider`)
- Added `setTier` action, partialize entries, and `clearUserDataSlices` reset to `store.ts`
- Wired `clearTierCache()` dynamic import into `signOut` (same pattern as Phase 9's `clearPermissionCache`)
- Created `billing.ts`: `getActiveTier()` collapse (8 Stripe statuses → 3 UX tiers), `TIER_GATE_REGISTRY`, `clearTierCache()`
- 16 Vitest cases in `billing.test.ts` — all green

**Task 2 — TierGate + PaywallUpsell components**

- `TierGate.tsx`: 3 modes (blur-upsell / hard-block-no-ui / hard-block-cta), reduced-motion fallback, past_due passthrough
- `PaywallUpsell.tsx`: overlay + cta variants, plain `window.location.href` redirect (zero @stripe/stripe-js)
- 8 Vitest cases in `TierGate.test.tsx` — all green

**Task 3 — MedLevelChart + AIChatPanel surgical edits**

- `MedLevelChart`: `userTier` selector added pre-early-return; Projected dataset + all 4 confidence bands gated by `userTier === 'paid'`; chart canvas wrapped in `<TierGate tier="paid" mode="blur-upsell" feature="pharma-forecast">`
- `AIChatPanel`: new Sonnet/Opus `<select>` model selector wrapped in `<TierGate tier="paid" mode="hard-block-cta" feature="advanced-ai">`; `chatModel` useState local (model wiring deferred to Phase 14 follow-up per plan)
- Registry orphan grep gate: `pharma-forecast` (1 non-test consumer), `advanced-ai` (1 non-test consumer), `ad-free` (intentional Phase 20 orphan, skipped from gate)

## Bundle Metrics

| Metric | Value |
|--------|-------|
| Index chunk gz | 13.67 kB (was 13.62 kB — delta: +0.05 kB) |
| Index ceiling | 50 kB |
| @stripe/stripe-js in index | No (zero static imports) |
| Build status | Clean |

The billing.ts + TierGate + PaywallUpsell components land in their own lazy chunks via React.lazy separation; the new billing.ts is dynamically imported in the signOut path only.

## Test Results

| Suite | Tests | Result |
|-------|-------|--------|
| `billing.test.ts` | 16 | All pass |
| `TierGate.test.tsx` | 8 | All pass |
| Full suite | 785 pass / 11 skip | No regressions |

## Registry Orphan Gate

| Key | Consumers | Status |
|-----|-----------|--------|
| `pharma-forecast` | MedLevelChart.tsx (1) | OK |
| `advanced-ai` | AIChatPanel.tsx (1) | OK |
| `ad-free` | 0 (intentional) | Phase 20 consumer — documented in billing.ts JSDoc |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] SettingsPage.tsx pickPartialized() missing billing fields**
- **Found during:** Task 1 (tsc -b --noEmit)
- **Issue:** `pickPartialized()` in `SettingsPage.tsx` constructs a `PersistedState` object literal for JSON export. Adding 4 required fields to `PersistedState` made the function incomplete, causing a TS2739 type error.
- **Fix:** Added `tier`, `current_period_end`, `plan_id`, `provider` fields from `fullState` to the `pickPartialized()` return object.
- **Files modified:** `leanshot/src/components/dashboard/settings/SettingsPage.tsx`
- **Commit:** 59e3ff8

**2. [Rule 3 - Worktree environment] node_modules symlink required for vitest**
- **Found during:** Task 1 verification
- **Issue:** Worktree has no local `node_modules`; `vitest run` failed with `ERR_MODULE_NOT_FOUND: Cannot find package 'vitest'`. Root minisite node_modules also lacks vitest (only leanshot/node_modules has it).
- **Fix:** Created symlink `leanshot/node_modules → /Users/karstenhaldan/minisite/leanshot/node_modules`. This is a worktree-only artifact (the symlink appears in `git status` as `?? leanshot/node_modules` but is not staged).
- **Commit:** n/a (environment fix, not staged)

## Pattern Compliance

| Pattern | Status |
|---------|--------|
| Pattern D (no hex literals in billing/* + billing.ts) | PASS — all design tokens used |
| Pattern G (no @stripe/stripe-js static imports) | PASS — zero imports in all plan-owned files |
| Pattern I (registry orphan grep gate) | PASS — pharma-forecast + advanced-ai each have 1 non-test consumer; ad-free documented Phase 20 |
| CLAUDE.md selector convention (one primitive per selector) | PASS — all useStore calls use single-field selectors |
| Rules of Hooks (selectors before conditional return) | PASS — userTier added before if (!config) return null |

## End-to-End Happy Path Confirmation

The first observable SUBSCRIBE → UNLOCK gate of Phase 14 is functional. A browser console call of:

```js
useStore.getState().setTier({ tier: 'paid', current_period_end: '2026-07-01T00:00:00Z', plan_id: 'price_test', provider: 'stripe' })
```

will:
- Un-blur the 7-day pharmacology forecast curve in MedLevelChart (Projected dataset + bands become visible)
- Reveal the Sonnet/Opus model selector dropdown in the AI Chat panel header

Both gates reset to free state on sign-out via the `clearTierCache()` + `clearUserDataSlices()` chain.

## Follow-on Work for Plan 14-06

Plan 14-06 (PastDueBanner + ManageSubscriptionLink + AppShell wiring) will consume the `tier='past_due'` state this plan persists. Specifically:

- `PastDueBanner` will read `useStore((s) => s.tier)` and `useStore((s) => s.current_period_end)` to show the always-on dunning chrome for past_due users
- `ManageSubscriptionLink` will POST to a new `stripe-portal` Edge Function
- `fetchCheckoutUrl()` in `PaywallUpsell.tsx` will be refactored into a shared `useUpgradeRedirect()` hook

Additionally, the `chatModel` state in `AIChatPanel.tsx` needs to be wired into the `callAIChat()` payload (currently local UI state only — TODO comment in file at the `chatModel` state declaration).

## Known Stubs

- `AIChatPanel.tsx`: `chatModel` useState is local UI only. The `<select>` is visible to paid users but the selected value (`sonnet` vs `opus`) is not passed to `callAIChat()`. This is by plan design (Phase 14 ships the gate; model switching is Phase 14 follow-up). TODO comment in file.
- `PaywallUpsell.tsx`: `fetchCheckoutUrl()` is a thin local function. Will be refactored to `useUpgradeRedirect()` in Plan 14-06.

## Self-Check: PASSED

All files created/modified exist and all commits verified:

- `leanshot/src/lib/billing.ts` — exists
- `leanshot/src/lib/billing.test.ts` — exists
- `leanshot/src/components/billing/TierGate.tsx` — exists
- `leanshot/src/components/billing/PaywallUpsell.tsx` — exists
- `leanshot/src/components/billing/TierGate.test.tsx` — exists
- Commit 59e3ff8 — Task 1
- Commit 21cd7dc — Task 2
- Commit 8d5b063 — Task 3
