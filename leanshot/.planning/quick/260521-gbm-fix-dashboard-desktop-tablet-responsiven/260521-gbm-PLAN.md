---
quick_id: 260521-gbm
title: Fix dashboard desktop/tablet responsiveness — margin utilities globally dead
date: 2026-05-21
mode: quick (inline — diagnosis required live browser)
---

# Quick Task 260521-gbm: Fix dashboard desktop/tablet responsiveness

## Problem (as reported)

"Responsiveness issue. Mobile works well, but desktop and tablet don't work well."
Clarified with user: the **logged-in dashboard**; symptoms = content squished /
off-center / overlapping the sidebar + content too narrow / not using the width.

## Root cause (diagnosed live in browser)

`src/index.css` had `* { margin: 0 }` written **outside any `@layer`**. With
Tailwind v4 (`@import 'tailwindcss'`), every utility lives in `@layer utilities`,
and **unlayered CSS always wins over layered CSS** in the cascade. So the reset
silently overrode *every* margin utility app-wide (`m-*`, `mx-*`, `ms-*`, …).

- Mobile (<768px) layout uses padding/gap and a fixed bottom nav — no margin
  utilities load-bearing → looked fine.
- Desktop/tablet (≥768px) rely on `<main>`'s `md:ms-[232px]` margin to clear the
  fixed 232px sidebar. That margin was dead → `margin-inline-start` computed `0px`,
  content rendered at `left:0` underneath the sidebar, with dead space on the right.

Live evidence (1440px viewport, before fix): `main.marginInlineStart = 0px`,
content `left:0`, `overlap:true`. A probe proved *all* margin utilities
(`ms-[232px]`, `ml-[232px]`, `mx-auto`) computed to `0`.

Secondary issue found + fixed: `<main>` combined `mx-auto` (Tailwind v4 emits the
`margin-inline` shorthand) with `md:ms-[232px]` (`margin-inline-start` longhand) on
the same element — a conflict that would re-break the offset even after the reset
fix. Split into outer-offset + inner-centering wrapper.

## Tasks

1. **`src/index.css`** — wrap `* { margin: 0 }` in `@layer base` so Tailwind's
   `utilities` layer can override it. Reset still applies to elements without a
   margin utility; explicit margin utilities now win.
   - verify: in browser at ≥768px, `getComputedStyle(main).marginInlineStart === '232px'`
   - done: margin utilities resolve to their declared values app-wide.

2. **`src/components/layout/AppShell.tsx`** — split the dashboard `<main>` so the
   outer element owns only the sidebar offset (`md:ms-[72px]`/`md:ms-[232px]`) and
   an inner wrapper owns `max-w-[1280px] mx-auto` + padding. Removes the
   shorthand/longhand `margin-inline` conflict.
   - verify: content sits beside the sidebar (no overlap) at 1440 + 834; centered
     within remaining space on wide screens.
   - done: no overlap, no horizontal scroll, mobile unchanged.

## must_haves

- truths: margin utilities are overridable by Tailwind (reset is layered); dashboard
  content never overlaps the fixed sidebar at ≥768px; mobile layout unchanged.
- artifacts: `src/index.css`, `src/components/layout/AppShell.tsx`.
- key_links: `src/index.css:327` (reset), `src/components/layout/AppShell.tsx:46` (main).
