---
slug: add-dist-marketing-to-eslint-ignores
date: 2026-05-11
quick_id: 260511-khr
status: complete
---

# Summary: Add `dist-marketing/**` to ESLint ignores

## Changes

- `eslint.config.js:13` — added `'dist-marketing/**'` to the global `ignores` array (positioned next to existing `'dist/**'` for symmetry with the two build outputs).

## Verification

| Command | Before | After |
|---|---|---|
| `npx eslint .` | 1382 problems (1378 errors, 4 warnings) | 4 problems (0 errors, 4 warnings) |
| `npm run lint` | 4 problems (0 errors, 4 warnings) | 4 problems (0 errors, 4 warnings) — unchanged |

The 4 remaining warnings are pre-existing `react-hooks/exhaustive-deps` + `react-refresh/only-export-components` items in `BaseChart.tsx`, `ShareCardModal.tsx`, and `GuidedTour.tsx`. Out of scope.

## Why

Surfaced by the Phase 3 code review as a follow-up. The marketing pipeline emits `dist-marketing/` (gitignored) alongside the main `dist/`, but only `dist/**` was in the ESLint ignore list, so any invocation that didn't scope to `src` (editor integrations, `npx eslint .`) saw ~1378 errors from the built minified bundle.
