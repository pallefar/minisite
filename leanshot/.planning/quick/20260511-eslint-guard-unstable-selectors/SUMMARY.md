---
quick_id: 20260511-eslint-guard-unstable-selectors
slug: eslint-guard-unstable-selectors
date: 2026-05-11
status: complete
---

# Summary

## Changes

- `eslint.config.js`: added two `no-restricted-syntax` entries that block `useStore(generateInsights|pickFocus)` and `useStore((s) => generateInsights|pickFocus(s)…)`.
- `src/components/dashboard/cards/FocusCard.tsx`: fixed import ordering (`framer-motion` → `lucide-react` → `react`).

## Verification

- `npm run lint` → 0 errors (4 pre-existing warnings untouched per minimal-change rule)
- Synthetic probe with all three bad patterns produced 3 errors, confirming the rule fires
