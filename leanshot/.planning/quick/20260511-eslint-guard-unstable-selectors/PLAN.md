---
quick_id: 20260511-eslint-guard-unstable-selectors
slug: eslint-guard-unstable-selectors
date: 2026-05-11
status: in-progress
---

# ESLint guard for unstable Zustand selectors

## Description

Three sibling fixes today (FocusCard, InsightsTab, HomeTab) addressed the same bug class: passing `pickFocus` / `generateInsights` to `useStore` produces a fresh object/array per call, which makes Zustand v5's `useSyncExternalStore` snapshot unstable and triggers React's "Maximum update depth exceeded" abort.

Add a `no-restricted-syntax` rule in `eslint.config.js` that blocks both shapes:

- `useStore(generateInsights)` / `useStore(pickFocus)` (direct ref)
- `useStore((s) => generateInsights(s)…)` / `useStore((s) => pickFocus(s)…)` (wrapped call)

Also fix the import-order regression in `FocusCard.tsx` that the earlier patch introduced (`react` imported before `lucide-react`).
