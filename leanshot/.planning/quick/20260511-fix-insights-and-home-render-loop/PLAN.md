---
quick_id: 20260511-fix-insights-and-home-render-loop
slug: fix-insights-and-home-render-loop
date: 2026-05-11
status: in-progress
---

# Fix InsightsTab / HomeTab render loop

## Description

Same bug class as `20260511-fix-focus-loop-and-console` (FocusCard) — two more components subscribe to Zustand via selectors that build a fresh object/array on every call, so v5's `useSyncExternalStore` snapshot is unstable and React aborts with "Maximum update depth exceeded."

- `src/components/dashboard/tabs/InsightsTab.tsx:26` — `useStore(generateInsights)`
- `src/components/dashboard/tabs/HomeTab.tsx:16` — `useStore((s) => generateInsights(s)[0])`

Fix both by subscribing to the underlying slices `generateInsights` reads (`user`, `weights`, `meals`, `symptoms`, `injections`, `workouts`, `water`, `mood`) and deriving the result inside `useMemo`. Pass a full `PersistedState` to `generateInsights` by spreading `initialState` and overriding the selected slices, matching the pattern used in FocusCard.

## Verification

- `npx tsc -b` clean
- Test suite still green
- Browser: navigate to Home and Insights tabs without "Maximum update depth" / "getSnapshot should be cached" warnings
