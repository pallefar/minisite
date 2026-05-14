---
phase: 14-monetization-foundation-stripe-web-clinic-seats
plan: "09"
subsystem: billing
tags: [billing, tier-sync, paywall, zustand, stripe, gap-closure, cr-01, cr-02]
dependency_graph:
  requires:
    - 14-01 (subscriptions table + RLS — the table billing-sync.ts queries)
    - 14-03 (stripe-checkout/session Edge Function — the endpoint PaywallUpsell now calls correctly)
    - 14-05 (billing.ts getActiveTier + store.ts setTier — both consumed by billing-sync.ts)
  provides:
    - leanshot/src/lib/billing-sync.ts — named DB-to-store connector
    - leanshot/src/components/billing/PaywallUpsell.tsx — fixed checkout path
    - leanshot/src/lib/billing.ts (Plan union) — shared checkout plan type
  affects:
    - leanshot/src/App.tsx (SIGNED_IN/INITIAL_SESSION/focus handlers)
    - leanshot/src/components/billing/UpgradeCTA.tsx (imports Plan from billing.ts)
    - All consumers of useStore((s) => s.tier): TierGate, PastDueBanner, ManageSubscriptionLink
tech_stack:
  added: []
  patterns:
    - Dynamic import in auth handlers (Phase 6 D-12 bundle discipline)
    - fire-and-forget billing sync via void import().then()
    - window-focus listener for Customer Portal round-trip detection
key_files:
  created:
    - leanshot/src/lib/billing-sync.ts
    - leanshot/src/lib/billing-sync.test.ts
    - leanshot/src/components/billing/PaywallUpsell.test.tsx
  modified:
    - leanshot/src/App.tsx
    - leanshot/src/lib/billing.ts
    - leanshot/src/components/billing/PaywallUpsell.tsx
    - leanshot/src/components/billing/UpgradeCTA.tsx
decisions:
  - CR-01 closed via single named module (billing-sync.ts) — not inlined into App.tsx
  - Dynamic import pattern used for billing-sync.ts to preserve Phase 6 D-12 bundle discipline
  - Plan union widened with 'clinic' in billing.ts (PaywallUpsell needs it); UpgradeCTA unaffected
metrics:
  duration: "~25 minutes"
  completed: "2026-05-14"
  tasks_completed: 3
  files_created: 3
  files_modified: 4
---

# Phase 14 Plan 09: Gap Closure — CR-01 (billing-sync) + CR-02 (PaywallUpsell) Summary

Closed the two CONFIRMED code BLOCKERs from 14-VERIFICATION.md that made Phase 14's monetization flow non-functional for every real user. Shipped `billing-sync.ts` as the named DB-to-store connector, wired it into `App.tsx`, and fixed `PaywallUpsell` to use the correct `supabase.functions.invoke` pattern.

## What Was Built

### CR-01 Closed: billing-sync.ts — the named DB-to-store connector

`setTier()` existed in the Zustand store since Plan 14-05 with zero non-test call sites. Every real user's `tier` was permanently `'free'` because the DB-to-frontend read half of the billing sync was never built. This plan creates the missing half.

**grep confirming CR-01 is closed (setTier now has a non-test call chain):**

```
src/App.tsx:379: void import('@/lib/billing-sync').then(({ syncBillingTier }) =>
src/App.tsx:380:   syncBillingTier(session.user.id),       ← INITIAL_SESSION
src/App.tsx:398: void import('@/lib/billing-sync').then(({ syncBillingTier }) =>
src/App.tsx:399:   syncBillingTier(session.user.id),       ← SIGNED_IN
src/App.tsx:500: void import('@/lib/billing-sync').then(({ syncBillingTier }) =>
src/App.tsx:501:   syncBillingTier(userId),                ← focus listener
src/lib/billing-sync.ts:40: export async function syncBillingTier(userId: string)
```

`billing-sync.ts` queries `subscriptions` via `maybeSingle()`, collapses via `getActiveTier`, writes via `useStore.getState().setTier()`. No-row path calls `setTier({ tier: 'free', ...nulls })`. Query error logs and returns without writing (stale value is best-available-guess per CONTEXT §6).

`App.tsx` wires `syncBillingTier` via dynamic import from:
- `INITIAL_SESSION` handler (cold load)
- `SIGNED_IN` handler (email-link verify / sign-in)
- `window-focus` listener (Customer Portal round-trip detection for CONTEXT D-09 10-second budget)

Zero new static imports in `App.tsx` import block — billing-sync stays off the entry chunk graph per Phase 6 D-12 discipline.

### CR-02 Closed: PaywallUpsell uses correct checkout invoke pattern

**Broken pattern (before):** bare `fetch('/functions/v1/stripe-checkout', { credentials: 'include' })` — 404 wrong path, 401 no JWT, 400 no plan body.

**Fixed pattern (after):**
```typescript
const { data, error } = await supabase.functions.invoke(
  'stripe-checkout/session',
  { body: { plan } },
);
if (error || !data?.url) { console.error(...); return; }
window.location.href = data.url;
```

Mirrors `UpgradeCTA.tsx:49-56` exactly. New `plan?: Plan` prop (default `'plus_monthly'`) so existing `MedLevelChart` and `AIChatPanel` consumers compile untouched.

**Plan union DRY:** `type Plan = 'plus_monthly' | 'plus_yearly' | 'clinic'` extracted from `UpgradeCTA.tsx` local type to `leanshot/src/lib/billing.ts` as single source of truth (widened with `'clinic'` for PaywallUpsell's clinic-tier upsell). Both `UpgradeCTA.tsx` and `PaywallUpsell.tsx` import it via `import type { Plan } from '@/lib/billing'`.

## Vitest Counts

| Test file | Cases | Result |
|-----------|-------|--------|
| billing-sync.test.ts | 6 | 6/6 pass |
| PaywallUpsell.test.tsx | 4 | 4/4 pass |
| Full suite | 820 | 809 pass / 11 skip / 0 fail |

Full suite 809 pass (no regressions vs 799 baseline — 10 new tests added by this plan).

## Bundle Index gz Size

- Index chunk gz: **14,393 bytes (14.38 kB)** — under Phase 9 working ceiling of 24.5 kB and absolute ceiling of 50 kB.
- `scripts/assert-bundle-budget.sh`: PASS
- `scripts/assert-clinic-bundle-budget.sh`: all chunks PASS

Zero `@stripe/stripe-js` static imports introduced. Zero hex literals introduced.

## Deviations from Plan

None. Plan executed exactly as written. The `credentials:` match in `PaywallUpsell.tsx` grep gate occurs only in the JSDoc documentation comment (line 10) describing the old broken behavior — not in executable code. The plan's comment-strip verify pattern (`grep -v '^\s*[/*#]'`) confirms clean.

The node_modules symlink to the main leanshot checkout was required to run vitest from the worktree (worktrees don't replicate node_modules). This is a one-time setup step, not a deviation.

## Commits

| Hash | Task | Description |
|------|------|-------------|
| 3646936 | Task 1 | feat(14-09): billing-sync.ts — named DB-to-store connector (CR-01 gap closure) |
| f0a5987 | Task 2 | feat(14-09): wire syncBillingTier into App.tsx auth handlers + focus refetch (CR-01) |
| b4102a2 | Task 3 | feat(14-09): extract Plan union to billing.ts + fix PaywallUpsell checkout (CR-02) |

## Hand-off Note for Plan 14-11

The `clinic-metered-billing.spec.ts` e2e (WR-09) and `past-due-banner.spec.ts` now have a real DB-to-store path to assert against. Before this plan, `useStore((s) => s.tier)` was permanently `'free'` for all real users — any e2e that toggled a subscription row in the DB and then checked the UI would have seen a stale `'free'` tier. 14-11's e2e fixes depend on this plan landing.

## Self-Check: PASSED

All created files exist on disk. All 3 task commits verified in git log (3646936, f0a5987, b4102a2). Full test suite 809/820 pass. Bundle index gz 14.38 kB under all ceilings.
