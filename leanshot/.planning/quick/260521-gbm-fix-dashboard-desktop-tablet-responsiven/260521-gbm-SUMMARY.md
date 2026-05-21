---
quick_id: 260521-gbm
status: complete
date: 2026-05-21
---

# Quick Task 260521-gbm — Summary

## What changed

1. **`src/index.css`** — moved `* { margin: 0 }` into `@layer base`. Root cause:
   the unlayered reset beat Tailwind v4's `@layer utilities`, killing every margin
   utility app-wide.
2. **`src/components/layout/AppShell.tsx`** — split dashboard `<main>` into
   outer-offset (`md:ms-[…]`) + inner-centering wrapper (`max-w-[1280px] mx-auto` +
   padding), removing a `margin-inline` shorthand/longhand conflict.

## Verification (live browser, dev server)

| Viewport | margin-inline-start | content overlaps sidebar | horizontal scroll |
|----------|--------------------|--------------------------|-------------------|
| 1440 (desktop) | 232px ✓ | no ✓ | no ✓ |
| 834 (tablet)   | 232px ✓ | no ✓ | no ✓ |
| 390 (mobile)   | 0px (sidebar hidden, bottom nav present) ✓ | n/a ✓ | no ✓ |

- Before fix: 1440px → `margin-inline-start:0`, content `left:0`, overlap=true.
- Probe confirmed ALL margin utilities (`ms-`, `ml-`, `mx-auto`) were computing `0`
  before the fix; resolve correctly after.
- `npx tsc -p tsconfig.app.json --noEmit` → clean (exit 0).

## Notes / follow-ups

- The bug affected the whole app's margin utilities, not just the dashboard. Other
  surfaces that rely on margin utilities at desktop breakpoints (admin, marketing
  desktop nav spacing) likely also improved — worth a broad desktop eyeball pass.
- 4–5 console errors seen in local dev are pre-existing (no Supabase backend/env
  locally); unrelated to this CSS change.
- Visual verification used numerical layout measurement (computed margins +
  bounding boxes) rather than screenshots — the MCP screenshot files saved to a
  sandbox path not readable from the workspace.
