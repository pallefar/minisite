# A11y Baseline Audit (DS-05)

Generated: 2026-05-27T07:12:18.030Z

Report-only heuristic audit. False positives expected — operator filters
during fix pass (Phase 69.5). Script exits 0 regardless of findings.

A real a11y audit requires axe-core runtime against rendered components — this script catches the cheap-grep cases only.

Total findings: **10**

## Summary

| Check | Findings |
| --- | --- |
| Icon-only `<button>` missing `aria-label` | 0 |
| `role="dialog"` missing `aria-modal="true"` | 0 |
| `<input>` without matching `<label htmlFor=...>` | 1 |
| framer-motion import without `useReducedMotion` | 9 |
| Sortable `<th>` missing `aria-sort` | 0 |

## Icon-only `<button>` missing `aria-label` — 0 findings

_None detected._

## `role="dialog"` missing `aria-modal="true"` — 0 findings

_None detected._

## `<input>` without matching `<label htmlFor=...>` — 1 findings

- `leanshot/src/components/dashboard/tabs/BodyTab.tsx:358` — <input id="photo-up"> has no matching <label htmlFor="photo-up"> in this file
  ```
  <input type="file" accept="image/*" id="photo-up" hidden onChange={onPhoto} />
  ```

## framer-motion import without `useReducedMotion` — 9 findings

- `leanshot/src/components/dashboard/ai/AIChatPanel.tsx:1` — imports `framer-motion` without `useReducedMotion` — animation may ignore reduced-motion users
  ```
  import { motion, AnimatePresence } from 'framer-motion';
  ```
- `leanshot/src/components/dashboard/cards/FocusCard.tsx:2` — imports `framer-motion` without `useReducedMotion` — animation may ignore reduced-motion users
  ```
  import { motion } from 'framer-motion';
  ```
- `leanshot/src/components/dashboard/tour/GuidedTour.tsx:1` — imports `framer-motion` without `useReducedMotion` — animation may ignore reduced-motion users
  ```
  import { motion, AnimatePresence } from 'framer-motion';
  ```
- `leanshot/src/components/layout/MobileNav.tsx:1` — imports `framer-motion` without `useReducedMotion` — animation may ignore reduced-motion users
  ```
  import { motion } from 'framer-motion';
  ```
- `leanshot/src/components/onboarding/OnboardingFlow.tsx:1` — imports `framer-motion` without `useReducedMotion` — animation may ignore reduced-motion users
  ```
  import { AnimatePresence, motion } from 'framer-motion';
  ```
- `leanshot/src/components/onboarding/UnitToggle.tsx:1` — imports `framer-motion` without `useReducedMotion` — animation may ignore reduced-motion users
  ```
  import { motion } from 'framer-motion';
  ```
- `leanshot/src/components/ui/Modal.tsx:1` — imports `framer-motion` without `useReducedMotion` — animation may ignore reduced-motion users
  ```
  import { motion, AnimatePresence } from 'framer-motion';
  ```
- `leanshot/src/components/ui/Sheet.tsx:1` — imports `framer-motion` without `useReducedMotion` — animation may ignore reduced-motion users
  ```
  import { motion, AnimatePresence, useDragControls } from 'framer-motion';
  ```
- `leanshot/src/components/ui/Toast.tsx:1` — imports `framer-motion` without `useReducedMotion` — animation may ignore reduced-motion users
  ```
  import { motion, AnimatePresence } from 'framer-motion';
  ```

## Sortable `<th>` missing `aria-sort` — 0 findings

_None detected._

