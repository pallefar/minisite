---
quick_id: 20260511-fix-focus-loop-and-console
slug: fix-focus-loop-and-console
date: 2026-05-11
status: complete
---

# Summary

Three browser-console issues resolved.

## Changes

- `src/components/dashboard/cards/FocusCard.tsx`: replaced `useStore((s) => pickFocus(s))` with per-slice selectors + `useMemo`. `pickFocus` returned a fresh object each call, which made Zustand v5's `useSyncExternalStore` snapshot unstable and triggered React's "Maximum update depth exceeded" abort.
- `src/lib/analytics.ts`: `initAnalytics()` now early-returns when `VITE_POSTHOG_KEY` is unset. Previously `posthog.init('__placeholder__', …)` always fired `/array/__placeholder__/config` (404) and `/flags` (401) before `loaded:` could opt-out.
- `index.html`: added `<meta name="mobile-web-app-capable" content="yes">` next to the existing Apple-prefixed meta (deprecated in Chrome).

## Verification

- `npx tsc -b` → clean
- `npx vitest run src/lib/analytics.test.ts` → 7/7 passed
