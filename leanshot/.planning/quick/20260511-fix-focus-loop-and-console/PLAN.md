---
quick_id: 20260511-fix-focus-loop-and-console
slug: fix-focus-loop-and-console
date: 2026-05-11
status: in-progress
---

# Fix browser-console errors

## Description

Three browser-console issues surfaced during dev:

1. **FocusCard infinite render loop.** `useStore((s) => pickFocus(s))` returns a fresh object literal each call, so Zustand v5's `useSyncExternalStore` snapshot keeps changing → React aborts with "Maximum update depth exceeded." Fix by selecting the underlying slices and computing `pickFocus` inside `useMemo`.

2. **PostHog `__placeholder__` token.** `posthog.init('__placeholder__', …)` always fires `/array/__placeholder__/config` (404) and `/flags` (401) when `VITE_POSTHOG_KEY` is unset, because the request goes out before `loaded:` runs `opt_out_capturing()`. Fix by early-returning from `initAnalytics()` when no real key is present.

3. **Deprecated `apple-mobile-web-app-capable` meta.** Chrome warns to add `<meta name="mobile-web-app-capable" content="yes">` alongside (Apple still needs the `apple-` form, so we keep both).

## Files

- `leanshot/src/components/dashboard/cards/FocusCard.tsx`
- `leanshot/src/lib/analytics.ts`
- `leanshot/index.html`

## Verification

- `npx tsc -b` clean
- `npm test -- analytics` passes
- Browser console: no "Maximum update depth" / "getSnapshot should be cached" / `__placeholder__` 404 / `mobile-web-app-capable` deprecation
