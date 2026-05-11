---
quick_id: 20260511-fix-insights-and-home-render-loop
slug: fix-insights-and-home-render-loop
date: 2026-05-11
status: complete
---

# Summary

Fixed two more "Maximum update depth exceeded" sites — same bug class as `20260511-fix-focus-loop-and-console`. `generateInsights` returns a fresh array each call, so `useStore(generateInsights)` and `useStore((s) => generateInsights(s)[0])` produced unstable Zustand snapshots.

## Changes

- `src/components/dashboard/tabs/InsightsTab.tsx`: replaced `useStore(generateInsights)` with per-slice selectors (`user`, `weights`, `meals`, `symptoms`, `injections`, `workouts`, `water`, `mood`) + `useMemo`.
- `src/components/dashboard/tabs/HomeTab.tsx`: same fix for `useStore((s) => generateInsights(s)[0])`.

## Verification

- `npx tsc -b` → clean
- `npx vitest run` → 63/63 passed
