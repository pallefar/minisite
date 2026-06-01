---
status: complete
slug: desktop-dashboard-layout-contrast
date: 2026-05-31
branch: fix/desktop-dashboard-layout-contrast
pr: 19
---

# Quick task — desktop dashboard "broken layout + color contrast"

**Request:** "please review the layout, as desktop dashboard seems broken with both layout and color contrast"

## Diagnosis (evidence-based, against a local `vite preview` at 1440px)

Reproduced the onboarded desktop dashboard via the VR `seedOnboarded` helper + a
local `CI=1` Playwright run (the same preview build CI uses). Findings:

1. **Layout is structurally correct.** Measured `sidebar width = 232px` and
   `<main> margin-inline-start = 232px` (`mainLeft = 232`) — a perfect match, no
   underlap/gap. The only layout offset bug is the `LegalFooter`, already fixed in
   the open PR #16.

2. **Root cause of "broken" — app-wide TRANSPARENT buttons.** A computed-style
   probe found **all 18 default-background buttons** (`bg-[var(--color-*)]`)
   rendering `rgba(0,0,0,0)`: the "Log dose" CTA, the sidebar logo pill, "Account
   menu", etc. Cause: `src/index.css` had an **unlayered** `button { background:
   none }` reset (and `color: inherit`) sitting just below the already-`@layer
   base`-wrapped `* { margin: 0 }`. Unlayered styles beat Tailwind's `utilities`
   layer, so `bg-[var(--color-*)]` / `text-[var(--color-*)]` lost on every button.
   Same trap (and fix) the margin-reset comment right above it describes.

## Fix

Wrapped the form-control resets (`button/input/select/textarea` font+color, and
`button` background/border/cursor) in `@layer base` so the `utilities` layer wins.
**One file: `src/index.css` (+21/-11).**

## Proof

- Default-background buttons transparent **18 → 0** (hover-only `bg` variants stay
  correctly transparent at rest); before/after screenshots show the Log dose CTA,
  logo pill, and cards regain their fills.
- `npm run build` clean; CSS-logical gate 0 violations.

## Flagged (NOT changed — separate, pre-existing, design decision)

- `--color-text-tertiary` (#8d958f ≈ **2.75:1**) fails WCAG AA on small card labels
  (~29 contrast failures across the home tab); the orange "trough" + green "success"
  accent chips are ~2.5:1. Darkening the token is a one-line change but shifts the
  muted palette — left for a design call.
- The Medication tab rendered sparse only because the seed's last dose is ~237 days
  old (drug fully cleared → no curve to plot); not a layout bug.
