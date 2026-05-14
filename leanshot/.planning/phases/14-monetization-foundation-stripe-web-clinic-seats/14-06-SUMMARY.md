---
phase: 14-monetization-foundation-stripe-web-clinic-seats
plan: "06"
subsystem: billing-chrome
tags: [billing, stripe, subscription, settings, banner, tdd]
dependency_graph:
  requires: ["14-04", "14-05"]
  provides: ["MONEY-03", "MONEY-09", "billing-chrome-components"]
  affects: ["AppShell.tsx", "SettingsPage.tsx"]
tech_stack:
  added: []
  patterns:
    - "supabase.functions.invoke for stripe-checkout Edge Function calls"
    - "Plain window.location.href redirect (Hosted Checkout, Pattern G)"
    - "useReducedMotion() gating on AnimatePresence/motion.div (Pattern E)"
    - "role=alert + aria-live=assertive for payment-failure banner"
    - "Tier-conditional settings section rendering via useStore((s) => s.tier)"
key_files:
  created:
    - leanshot/src/components/billing/PastDueBanner.tsx
    - leanshot/src/components/billing/PastDueBanner.test.tsx
    - leanshot/src/components/billing/ManageSubscriptionLink.tsx
    - leanshot/src/components/billing/ManageSubscriptionLink.test.tsx
    - leanshot/src/components/billing/UpgradeCTA.tsx
    - leanshot/src/components/billing/UpgradeCTA.test.tsx
  modified:
    - leanshot/src/components/layout/AppShell.tsx
    - leanshot/src/components/dashboard/settings/SettingsPage.tsx
decisions:
  - "D-08 PastDueBanner as always-on chrome (role=alert, opens portal in new tab)"
  - "D-09 UpgradeCTA two-plan selector: $12.99/mo + $132.49/yr save 15%"
  - "D-12 Hosted Checkout via plain window.location.href (no Stripe.js SDK)"
metrics:
  duration_minutes: 7
  completed_date: "2026-05-14"
  tasks_completed: 4
  files_changed: 8
---

# Phase 14 Plan 06: Dashboard Chrome + Subscription Management Slice Summary

Built three net-new billing components (PastDueBanner, ManageSubscriptionLink, UpgradeCTA) plus surgical edits to AppShell.tsx and SettingsPage.tsx, closing the user-observable monetization loop so free users can start a subscription, paid users can manage it, and past-due users see a persistent orange banner with a recovery CTA.

## What Was Built

### PastDueBanner.tsx

Global chrome strip mounted as the bare first child of `<main>` in AppShell.tsx. Renders only when `tier='past_due'` (returns null for free/paid — zero DOM footprint). Features:
- `role="alert"` + `aria-live="assertive"` (payment failure is assertive per WCAG SC 4.1.3)
- Message: "Your payment failed. Update your card to keep LeanShot Plus active."
- "Update card" button invokes `supabase.functions.invoke('stripe-checkout/portal')` and opens the Stripe Customer Portal in a new tab (`window.open(url, '_blank', 'noopener,noreferrer')`)
- Pattern E: `useReducedMotion()=true` → static `<div>` block; `false` → `<AnimatePresence><motion.div>` slide-in (initial y:-8, animate y:0, exit y:-4, 250ms)
- Loading/error states: `aria-busy`, "Opening Stripe…" label, inline `role="status"` error span
- 5 Vitest tests: null/free, null/paid, alert/past_due, click→invoke+window.open, reduced-motion fallback

### ManageSubscriptionLink.tsx

Settings section row for paid and past_due users. Opens Stripe Customer Portal in the **same tab** (returns via Stripe's return_url → `/settings?from=portal`). Features:
- `CreditCard` icon + "Manage subscription" title + helper text + "Open Stripe" Button
- Same-tab redirect: `window.location.href = data.url`
- Loading (aria-busy) + inline error (role="status") states
- 3 Vitest tests: portal invoke + redirect, aria-busy loading state, reduced-motion no-crash

### UpgradeCTA.tsx

Settings section CTA for free users only (returns null for paid/past_due). Features:
- Two-plan selector per D-09: `$12.99/mo` (plus_monthly) + `$132.49/yr — save 15%` (plus_yearly)
- Invokes `supabase.functions.invoke('stripe-checkout/session', { body: { plan } })` → `window.location.href = url`
- Per-plan loading state: only the clicked button shows aria-busy; both disabled during flight
- Inline error (role="status") on failure
- 6 Vitest tests: null/paid, null/past_due, 2 plan buttons/free, monthly invoke+redirect, yearly invoke+redirect, reduced-motion no-crash

### AppShell.tsx (surgical edit)

Added `<PastDueBanner />` as the bare first child of `<main>` before `<WorkspaceSwitcher>`. No wrapper div — component owns its own padding. Zero DOM footprint for non-past_due users.

### SettingsPage.tsx (surgical edit)

Replaced the stub "Free forever. Pro adds polish." section with a tier-conditional Subscription section:
- Status pill: `role="status"` badge (Free / Active / Past due — update card) in correct token colors
- Free tier: pill + `<UpgradeCTA />`
- Paid tier: pill + `<ManageSubscriptionLink />`
- Past_due tier: pill + `<ManageSubscriptionLink />`
- Deferred: trial-day countdown (subscriptions.trial_end) — "Active" pill covers both trial-active and post-conversion until Phase 14 close candidate wires the countdown (NOT a locked decision)

## Decision Traceability

| Decision | Artifact |
|---|---|
| D-08: past_due always-on chrome (warm-orange, assertive, new-tab portal) | PastDueBanner.tsx + AppShell.tsx wiring |
| D-09: web tier $12.99/mo + $132.49/yr 15% off | UpgradeCTA.tsx 2-plan selector |
| D-12: Hosted Checkout via plain window.location.href (no Stripe.js) | UpgradeCTA.tsx + ManageSubscriptionLink.tsx |

## Patterns Enforced

| Pattern | Evidence |
|---|---|
| D (token consumption) | Zero hex literals in all 3 new components; all colors via `var(--color-*)` |
| E (reduced-motion) | PastDueBanner gates AnimatePresence on useReducedMotion(); test case 5 verifies |
| F (pathspec discipline) | All commits used explicit file paths; no `git add .` — Wave 4 parallel with 14-07 |
| G (bundle isolation) | Zero `@stripe/stripe-js` imports; `grep -rnE "from '@stripe/stripe-js'" src/` → empty |
| I (TierGate orphan check) | This plan's components are chrome (D-08), not TierGate consumers; `grep -rn "feature=" src/components/billing/` returns only TierGate.tsx itself (from 14-05) |

## Verification Evidence

### Vitest

```
Test Files  4 passed (4)
Tests  22 passed (22)
  - TierGate (8 from 14-05, unchanged)
  - PastDueBanner (5)
  - ManageSubscriptionLink (3)
  - UpgradeCTA (6)
```

### Bundle

```
dist/assets/index-BBfVIykQ.js   47.43 kB │ gzip: 14.16 kB
```

Baseline (pre-plan 14-06): ~13.67 kB gz
Delta: +0.49 kB gz — within the ≤0.5 kB gz spec
50 kB gz ceiling: preserved (14.16 kB gz)

`bash scripts/assert-bundle-budget.sh` → `jspdf bundle topology OK: 2 chunk(s), total gz 137302 bytes (floor 20000); index chunk free of jsPDF identifier` — exit 0

### Grep Gates

```
Hex literals in billing components: 0 matches — PASS
@stripe/stripe-js static imports:   0 matches — PASS
TierGate feature= in new components: 0 matches — PASS
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Style] Import order violations in billing components and tests**
- **Found during:** Task 4 ESLint gate
- **Issue:** ESLint `import-x/order` required lucide-react/framer-motion before react; `@/hooks` before `@/lib` in components
- **Fix:** `npx eslint --fix` auto-corrected ordering in PastDueBanner.tsx, ManageSubscriptionLink.tsx; manual fix in test files
- **Files modified:** PastDueBanner.tsx, ManageSubscriptionLink.tsx, ManageSubscriptionLink.test.tsx, UpgradeCTA.test.tsx
- **Commit:** 64f314d

**2. [Rule 2 - Infrastructure] node_modules symlink needed in worktree**
- **Found during:** Task 1 vitest RED phase
- **Issue:** Worktree leanshot/ has no node_modules; vitest config couldn't resolve dependencies
- **Fix:** Created `leanshot/node_modules` symlink pointing to main repo's `leanshot/node_modules`
- **Impact:** Tests run from worktree; symlink is not committed (root .gitignore has `leanshot/node_modules/`)

## Known Follow-ups

1. **Trial-day countdown in Settings** — `subscriptions.trial_end` is available in 14-01 schema but fetching+deriving it in the Settings drawer needs a dedicated query. "Active" pill covers both trial-active and post-conversion paid states. Scheduled as Phase 14 close candidate (NOT a locked D-XX decision).

2. **PastDueBanner bundle note** — The PastDueBanner imports `framer-motion` (already in the main chunk via AppShell). No additional bundle impact since framer-motion is in the vendor-motion chunk. Confirmed via bundle output.

## Commits

| Hash | Description |
|---|---|
| 0c66285 | feat(14-06): PastDueBanner global chrome |
| 5db0455 | feat(14-06): ManageSubscriptionLink + UpgradeCTA billing settings components |
| ef60ad0 | feat(14-06): wire PastDueBanner into AppShell + Subscription section in SettingsPage |
| 64f314d | style(14-06): fix import-x/order violations in billing components + tests |

## Self-Check: PASSED
