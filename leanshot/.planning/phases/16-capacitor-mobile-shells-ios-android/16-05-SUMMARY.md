---
phase: 16-capacitor-mobile-shells-ios-android
plan: "05"
subsystem: native-iap-paywall
tags: [capacitor, revenuecat, iap, paywall, realtime, money-06, d-01, d-03, d-13, d-22, d-24, d-25]
dependency_graph:
  requires:
    - 16-00 (Wave-0 harness — vitest-mobile.config.ts + __mocks__/* manual mocks)
    - 16-01 (Capacitor scaffold + @revenuecat/purchases-capacitor install + capacitor-bridge manualChunks)
    - 16-02 (platform.ts detectPlatform() real implementation)
    - 16-06 (revenuecat-webhook + subscriptions row writes — server half drives the Realtime trigger)
  provides:
    - src/lib/native/iap.ts — REAL configureRC / getOfferings / purchaseSubscription / restorePurchases / checkTrialEligibility (replaces Phase 12 throw-stub)
    - src/components/PricingIOS.tsx — native paywall with clinic-owner gate + trial eligibility + anti-steering grep enforcement
    - src/lib/page-builder/pricing-page-content.ts — appended getPricingComponent(platform) dynamic-import switch (existing exports byte-stable)
    - src/App.tsx — platform-fork of ?upgrade= handler (web→stripe-checkout unchanged; ios/android→RC) + subscriptions:user_id=eq.X postgres_changes listener
    - e2e/mobile/iap-flow.spec.ts — 3 HAS_LIVE-gated cases (web fork stability, simulated ios, Realtime listener)
  affects:
    - Plan 16-06 (RC webhook + subscriptions row writes) — server side that triggers the Realtime broadcast this plan listens for
    - Plan 16-10 (Apple sandbox UAT + Play Console deploy) — uses the real iap.ts surface for end-to-end purchase verification on physical device
tech_stack:
  added:
    - none (RC SDK already installed by 16-01; @capacitor/browser already installed by 16-01)
  patterns:
    - "Single-SDK boundary — iap.ts is the SOLE legitimate importer of @revenuecat/purchases-capacitor in the codebase (PricingIOS + App.tsx route through iap.ts public surface only)"
    - "Module-level idempotency for configureRC — _configured + _currentAppUserID flags; user-switch triggers Purchases.logIn instead of re-configure (mirrors Phase 16-02 BiometricGate _installed pattern)"
    - "Conservative UNKNOWN-as-INELIGIBLE for trial copy (D-22) — never promise a 7-day trial that StoreKit would silently strip at checkout"
    - "Anti-steering grep gate enforced at unit-test level — PricingIOS.test.tsx asserts rendered DOM contains zero /stripe/ or /leanshot.app/pricing/ matches in non-clinic-owner branch (Apple §3.1.1)"
    - "Vendor-gated SDK init via RcConfigError — distinguishes missing env var (vendor not configured yet) from runtime SDK fault (per reference_vendor_gated_send_health_check)"
    - "Platform-fork wraps existing handler additively — write a void-IIFE branch BEFORE the existing stripe-checkout invoke + early return; preserves Phase 15 web byte-stability (git diff -U0 grep gate)"
    - "Realtime layer e2e — drive the trigger via service-role write, instantiate the receiving channel directly in the test file (per reference_realtime_layer_e2e_pattern + Phase 9/10 clinic-realtime)"
key_files:
  created:
    - leanshot/src/lib/native/iap.test.ts (348 lines, 20 vitest-mobile cases)
    - leanshot/src/components/PricingIOS.tsx (~300 lines — paywall + clinic-owner variant)
    - leanshot/src/test/PricingIOS.test.tsx (~250 lines, 10 RTL cases)
    - leanshot/e2e/mobile/iap-flow.spec.ts (~180 lines, 3 HAS_LIVE-gated cases)
  modified:
    - leanshot/src/lib/native/iap.ts (REWRITTEN — 9-line throw-stub → ~280-line production module)
    - leanshot/src/lib/native/__mocks__/revenuecat-purchases-capacitor.ts (extended — added logIn + restorePurchases methods)
    - leanshot/src/App.tsx (+~75 lines — detectPlatform import + platform fork inside ?upgrade= + new Realtime useEffect)
    - leanshot/src/lib/page-builder/pricing-page-content.ts (+27 lines — getPricingComponent export; PRICING_PAGE_BLOCKS + PRICING_PAGE_SEO byte-stable)
decisions:
  - "iap.ts uses module-level _configured / _currentAppUserID flags for idempotency — calling configureRC twice with the same user is a no-op; calling with a different user routes through Purchases.logIn (preserves entitlement attribution without re-configuring the SDK)."
  - "Re-fetch raw Purchases.getOfferings() inside purchaseSubscription rather than caching the raw RC package — the SDK requires the live PurchasesPackage object (with internal fields) for Purchases.purchasePackage({aPackage}), not our simplified Package shape. Net cost: one extra SDK call per purchase, but eliminates the cache-staleness risk."
  - "INTRO_ELIGIBILITY_STATUS imported as the GROUPED object (per real RC v13 SDK shape) not as flat named constants. iap.ts: `INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_ELIGIBLE`. The vitest-mobile mock was extended to match — both the production import path and the mock now ship the same shape (deviation R-01 below)."
  - "PricingIOS reads role from `signedIn?.user?.app_metadata?.role` rather than a slice field. CONTEXT D-24 specified the role discriminator without nailing the path; the app_metadata path is the most direct + matches how PartnerLayout.tsx + admin/affiliate code already read role hints. The grep in store.ts showed no signedIn.role field exists; choosing app_metadata.role avoids inventing a new slice."
  - "Anti-steering grep at unit test level (DOM-walk via container.innerHTML.toLowerCase()) rather than at static-source grep. Rationale: the clinic-owner branch legitimately contains 'Stripe' in the caption 'Opens Stripe billing in your browser' (per D-24); the unit test runs render() with role=undefined to isolate the non-clinic-owner DOM only. A static grep would falsely flag the legit clinic-owner caption."
  - "Realtime listener re-uses existing syncBillingTier(userId) from @/lib/billing-sync rather than directly reading tier_effective. Rationale: existing billing-sync queries the `subscriptions` table by user_id+plan_id+provider+current_period_end via getActiveTier() — same path the focus handler uses. Phase 19 shipped `tier_effective` view ahead of P16 with a different shape than this plan anticipated (see deviation R-02), but the existing client-side path bypasses the view entirely, so no schema drift surfaced in execution."
  - "iap.ts purchaseSubscription on web THROWS rather than returning a no-op result — callers (PricingIOS + App.tsx) gate via detectPlatform() BEFORE calling, so reaching this path is a bug, not a normal flow. Web no-op on configureRC + getOfferings + restorePurchases + checkTrialEligibility (where 'do nothing' is the correct UX); web throw on purchaseSubscription (where silently returning 'success' would mislead the caller)."
  - "App.tsx native-branch is a void-IIFE rather than promoting handleUpgradeParam to async. Rationale: the outer effect's addEventListener('hashchange', handleUpgradeParam) expects a sync `(): void` listener; promoting to async would change semantics for the existing web branch's fire-and-forget invoke (which is itself `void import('@/lib/supabase').then(...)`). The IIFE preserves the existing handler's contract."
  - "e2e/mobile/iap-flow.spec.ts Test B does NOT inject a window.__iap__ stub seam into iap.ts — instead it just route-intercepts stripe-checkout and asserts the route is NOT hit when Capacitor.getPlatform is flipped to 'ios' via addInitScript. Rationale: a debug-only seam in production iap.ts (gated on VITE_E2E) would add surface area; the load-bearing contract (do NOT call stripe on ios) is verifiable via the negative route assertion alone. Real device sandbox purchase moves to Plan 16-10 UAT."
metrics:
  duration: ~85 minutes
  completed: 2026-05-16
  tasks_completed: 3/3 (autonomous, no checkpoints)
  tests_added: 20 (iap.test.ts) + 10 (PricingIOS.test.tsx) + 3 (iap-flow.spec.ts, HAS_LIVE-skipped) = 33
  files_created: 4
  files_modified: 4
  commits: 4 (51c3a62 test/iap, 7adae32 feat/PricingIOS, be2528d feat/App.tsx-fork, 3ae9e4b style/lint-fix)
---

# Phase 16 Plan 05: RevenueCat IAP + Pricing Fork + Tier Realtime — Summary

Wire the **client half of MONEY-06**: a real `@revenuecat/purchases-capacitor`
surface at `src/lib/native/iap.ts`, a native-only `PricingIOS` paywall that
honors Apple §3.1.1 anti-steering + Google Play §3.1.1 + the D-24 clinic-owner
hide-and-portal-redirect, a platform-fork of the Phase 15 `?upgrade=` deep
link (web stripe-checkout preserved byte-for-byte; ios/android route through
`Purchases.purchasePackage`), and a Supabase Realtime listener on
`subscriptions:user_id=eq.${userId}` that propagates RC webhook + Stripe
webhook writes into the running native app within ~5s (D-25).

## What Shipped

### 1. `src/lib/native/iap.ts` — RC SDK bridge (replaces Phase 12 throw-stub)

Five public functions + one error class + four interfaces:

| Function | Web behavior | Native behavior |
|---|---|---|
| `configureRC(appUserID)` | no-op | idempotent `Purchases.configure`; `Purchases.logIn` on user switch |
| `getOfferings()` | returns `null` | parses `Purchases.getOfferings().current` → `{ monthlyPackage, yearlyPackage }` |
| `purchaseSubscription(productId)` | **throws** `'not available on web'` | `Purchases.purchasePackage({aPackage: rawPkg})`; userCancelled → `{cancelled:true}` (NOT thrown); other errors re-throw |
| `restorePurchases()` | no-op | `Purchases.restorePurchases()` |
| `checkTrialEligibility()` | `{false,false}` | maps `Purchases.checkTrialOrIntroductoryPriceEligibility` status → boolean per product; UNKNOWN→false |

Module-level idempotency: `_configured` + `_currentAppUserID` so repeated
`configureRC('u1')` calls are no-ops, `configureRC('u2')` triggers `logIn`.

`RcConfigError` distinguishes "vendor env not set" from "SDK runtime fault"
(vendor-gated send health pattern per `reference_vendor_gated_send_health_check`).

### 2. `src/components/PricingIOS.tsx` — native paywall

- **Web platform** → renders `null` (defense in depth; the lazy
  `getPricingComponent` switch also returns null on web).
- **Clinic-owner (`role === 'clinic_owner'`)** → "Clinic billing" heading +
  body copy + "Go to Billing Portal" secondary CTA that dynamic-imports
  `@capacitor/browser` and calls `Browser.open({url:'https://leanshot.app/clinic/billing'})`.
  ONE Stripe mention allowed (the caption "Opens Stripe billing in your browser"
  for an EXISTING enterprise subscription, per D-24).
- **Non-clinic-owner** → Fraunces-italic "LeanShot *Plus*" headline, sub-headline
  "7-day forecast · AI coach · ad-free", two plan tiles (yearly recommended-ring
  by default), conditional "Start with 7 days free" copy (only when
  `checkTrialEligibility` reports eligible for the selected plan), Subscribe
  button, Restore Purchases link, platform-conditional legal micro-copy
  ("Payment processed by Apple/Google Play").
- **Disabled fallback** → "Purchases temporarily unavailable" caption when
  `getOfferings()` returned null (RC dashboard misconfiguration or vendor
  key missing — graceful degradation, not crash).

### 3. `src/lib/page-builder/pricing-page-content.ts` — additive `getPricingComponent`

```ts
export async function getPricingComponent(platform: Platform): Promise<ComponentType | null> {
  if (platform === 'ios' || platform === 'android') {
    const m = await import('@/components/PricingIOS');
    return m.default;
  }
  return null;
}
```

Existing `PRICING_PAGE_BLOCKS` + `PRICING_PAGE_SEO` exports byte-stable
(`git diff --stat`: +27 / -0 in pure addition).

### 4. `src/App.tsx` — platform fork + Realtime listener

- **New import:** `detectPlatform` from `@/lib/native/platform`.
- **`?upgrade=` handler fork:** inside the Phase 15 Plan 15-10 handler, AFTER
  the verified-user gate and BEFORE the existing `supabase.functions.invoke('stripe-checkout/session')`,
  a void-IIFE branch runs `configureRC + purchaseSubscription` via
  `import('@/lib/native/iap')` when `detectPlatform()` returns `'ios'` or
  `'android'`. Cancelled-result is silent; other errors toast. CRITICAL early
  `return` so the web invoke NEVER runs on native — Apple §3.1.1 hard requirement.
- **New `useEffect` keyed on `[view]`:** installs the Realtime channel
  `subscriptions:user_id=eq.${userId}` with both UPDATE + INSERT
  `postgres_changes` events. On change, dynamic-imports `@/lib/billing-sync`
  and calls `syncBillingTier(userId)` — re-reads the subscriptions row →
  store tier (same path as the focus handler). Cleanup awaits
  `channel.unsubscribe()` so signedIn → signedOut → signedIn cycles don't
  leak channels.

### 5. `e2e/mobile/iap-flow.spec.ts` — HAS_LIVE-gated 3-case suite

| Case | What it asserts |
|---|---|
| A | Web platform `?upgrade=plus_monthly` still hits `stripe-checkout/session` (Phase 15 byte-stability over the wire). |
| B | Simulated-iOS (addInitScript flips `Capacitor.getPlatform`) `?upgrade=plus_monthly` does NOT hit `stripe-checkout/session` (anti-steering invariant). |
| C | Service-role INSERT into `public.subscriptions` triggers a `subscriptions:user_id=eq.X` postgres_changes broadcast within 5s (D-25 Realtime contract). |

File-scoped slug prefix `iap-flow-${Date.now()}` per
`feedback_rls_per_file_slug_prefix`. `afterAll` cleans up via
`admin.auth.admin.deleteUser`. Real StoreKit sandbox purchase deferred to
Plan 16-10 (requires physical device + TestFlight build).

## RC Dashboard ↔ Code Mapping

| RC Dashboard entity | Code reference | Value |
|---|---|---|
| Project | `proj6e995e1b` "leanshot" | (no client reference) |
| iOS app | `appbf446e5887` | bundle `app.leanshot.ios` |
| Android app | `app9b352d0e19` | package `app.leanshot.android` |
| Entitlement | `entl7fd071e88a` | lookup_key `plus` (D-01) |
| Default offering | `ofrngb6444efa64` | lookup_key `default` |
| Monthly product (iOS) | — | `app.leanshot.plus.monthly` (D-03) |
| Yearly product (iOS) | — | `app.leanshot.plus.yearly` (D-03) |
| Monthly product (Android) | — | `app.leanshot.plus:monthly` (colon — Play convention) |
| Yearly product (Android) | — | `app.leanshot.plus:yearly` |
| iOS SDK key | `VITE_RC_API_KEY_IOS` env | **PENDING USER PASTE** (RcConfigError surfaces clean disabled state) |
| Android SDK key | `VITE_RC_API_KEY_ANDROID` env | **PENDING USER PASTE** |

## Bundle Impact

| Chunk | Pre-16-05 (gz) | Post-16-05 (gz) | Ceiling | Delta |
|---|---|---|---|---|
| `index` | 19.71 kB | 19.71 kB | 50 kB (Phase 9 working 24.5 kB) | 0 |
| `capacitor-bridge` | (pre-build w/ RC SDK probe) | 8.81 kB | 15 kB | (within budget) |
| `vendor-supabase` | unchanged | 46.46 kB | n/a | 0 |

`index` chunk is unchanged because:
- `PricingIOS` reaches the web bundle ONLY via `getPricingComponent`'s
  dynamic import — never statically.
- `iap.ts` is imported by `App.tsx` ONLY via `await import('@/lib/native/iap')`
  inside the native-branch IIFE — never statically.
- The RC SDK lives in `capacitor-bridge` (vite manualChunks regex already
  routed `@revenuecat/purchases-capacitor` in 16-01).

## Decisions Implemented (with locked CONTEXT IDs)

- **D-01** — Single `plus` entitlement, two products (monthly + yearly).
- **D-03** — Reverse-DNS product IDs `app.leanshot.plus.{monthly,yearly}`.
- **D-13** — Paywall fork (native vs web) via `getPricingComponent` switch.
- **D-22** — Trial-already-used blocks "Start with 7 days free" copy.
- **D-24** — Clinic-owner hides IAP entirely; portal redirect via
  `@capacitor/browser` Safari View Controller / Chrome Custom Tab.
- **D-25** — Realtime `subscriptions:user_id=eq.X` postgres_changes listener;
  ~5s tier-flip propagation.

## Anti-Steering Compliance

| Surface | Anti-steering policy | Enforcement |
|---|---|---|
| `PricingIOS` non-clinic-owner DOM | Zero `/stripe/i` or `/leanshot\.app\/pricing/i` matches | `PricingIOS.test.tsx` runtime grep gate (10 cases, all green) |
| `PricingIOS` clinic-owner caption | Caption "Opens Stripe billing in your browser" — the ONE allowed Stripe mention | Manually documented in component header comment + decision row above; submission-response template handoff to Plan 16-10 |
| `App.tsx` `?upgrade=` handler | Native branch returns BEFORE the stripe-checkout/session invoke | Code review: `return;` at end of `if (platform === 'ios' || platform === 'android')` block; e2e Case B asserts route NOT hit |
| `iap.ts` source | Zero references to `@/lib/stripe/*` | Grep gate green |

The clinic-owner Stripe caption (D-24 nuance) is the **single deliberate
exception** — the user is managing an EXISTING enterprise subscription that
was provisioned through web Stripe, not being steered to a consumer web
purchase. This nuance is documented in the component header and will be
included in the App Store Review submission-response template prepared
by Plan 16-10.

## Deviations from Plan

### R-01 [Rule 1 — bug] RC SDK exports `INTRO_ELIGIBILITY_STATUS` as a grouped object, not flat constants

**Found during:** Task 1 typecheck pass after first GREEN run.

**Issue:** Plan body suggested flat constants:
`import { Purchases, INTRO_ELIGIBILITY_STATUS_ELIGIBLE } from '@revenuecat/purchases-capacitor'`.
Real `@revenuecat/purchases-capacitor@13.1.1` exports only the grouped object:
`INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_ELIGIBLE`. Typecheck failed
with `TS2724: '"@revenuecat/purchases-capacitor"' has no exported member named 'INTRO_ELIGIBILITY_STATUS_ELIGIBLE'`.

**Fix:** Switched both the iap.ts production import and the
`__mocks__/revenuecat-purchases-capacitor.ts` mock to use the grouped object
shape. Mock previously exposed both the grouped object AND flat constants
"for compatibility" — removed the flat constants so the mock surface matches
the real SDK 1:1. All 20 iap.test.ts cases updated to use the grouped path.

**Files modified:** `src/lib/native/iap.ts`, `src/lib/native/iap.test.ts`,
`src/lib/native/__mocks__/revenuecat-purchases-capacitor.ts`.

**Commit:** `51c3a62` (folded into the Task 1 commit).

### R-02 [No-op] Phase 19 `tier_effective` view shape drift surfaced in prompt but did NOT affect implementation

**Found during:** Pre-execution prompt context (the orchestrator flagged the
P19 view shape mismatch — 5 columns including `has_active`, `winning_provider`,
`effective_period_end` rather than the plan's anticipated `tier`,
`effective_expires_at`, `providers` triple).

**Issue:** Plan body anticipated reading `tier_effective` with a different
column shape than P19 actually shipped.

**Investigation:** Read `src/lib/billing-sync.ts` to confirm the existing
client-side billing tier path:
```ts
.from('subscriptions')
.select('status, current_period_end, plan_id, provider')
```
**Conclusion:** Existing `syncBillingTier()` queries the `subscriptions`
table directly (NOT `tier_effective`) and computes tier via `getActiveTier()`.
The Realtime listener re-uses this exact path. The P19 view shape drift is
irrelevant to this plan — no `tier_effective`-aware code was needed.

**Fix:** None required. Documented here so future plans that DO consume
`tier_effective` know the shape is `{user_id, has_active, effective_period_end,
winning_provider, has_past_due}` (per 16-06-SUMMARY § "Did NOT rewrite the
existing P19 tier_effective view").

**Files modified:** none.

### R-03 [Rule 1 — TypeScript strict] `JSX.Element` namespace missing in tsconfig

**Found during:** Task 2 typecheck pass.

**Issue:** `PricingIOS.tsx` initially typed return as `JSX.Element | null`
but TS error: `TS2503: Cannot find namespace 'JSX'`.

**Fix:** Switched to importing `type ReactElement` from `'react'` and typing
return as `ReactElement | null`. Matches the convention used elsewhere in
this codebase.

**Files modified:** `src/components/PricingIOS.tsx`.

**Commit:** folded into Task 2 commit `7adae32`.

### R-04 [No-op] App.tsx pre-existing import-x/order debt is NOT this plan's responsibility

**Found during:** Lint pass at end of Task 3.

**Issue:** `npm run lint -- src/App.tsx` reports 4 errors after my edits.
Baseline (pre-my-edits) was 5 errors — my edits REDUCED the count by 1.

**Investigation:** Compared lint output before (`git stash`) and after; all 4
remaining errors are pre-existing per `project_lint_debt_import_x_order.md`
user memory ("84 errors, ~67 import-x/order + jsx-a11y across Phase 8-13
files, Phase 23 sweep").

**Fix:** None — applied `eslint --fix` to my own additions (commit `3ae9e4b`
style cleanup); deferred Phase 8-13 import-x/order baseline to Phase 23 sweep
per existing memory.

## Auth Gates / Vendor Pending

| Item | Owner | Blocking? | Workaround in code |
|---|---|---|---|
| `VITE_RC_API_KEY_IOS` env var (RC public iOS SDK key) | User must paste from RC dashboard | Native paywall renders disabled state on missing | `RcConfigError` is caught silently; PricingIOS shows "Purchases temporarily unavailable" |
| `VITE_RC_API_KEY_ANDROID` env var (RC public Android SDK key) | User must paste from RC dashboard | Same as above | Same as above |
| App Store Review submission with anti-steering nuance | Plan 16-10 owner | Future plan responsibility | Documented in `PricingIOS.tsx` header + this SUMMARY § Anti-Steering Compliance |

Per the vendor-gated send health check pattern, the code ships the FULL
production path + gracefully degrades to "disabled state" until the user
pastes RC keys into `.env.local` (dev) or Vercel env (production). No code
change needed at vendor-pass completion — only env vars.

## Deferred Items

| Item | Reason | Resume in |
|---|---|---|
| Real StoreKit/Play Billing sandbox purchase end-to-end test | Requires physical device + TestFlight build — impossible headlessly | Plan 16-10 manual UAT |
| Apple submission-response template documenting the D-24 clinic-owner caption exception | Submission package is a Plan 16-10 deliverable | Plan 16-10 |
| Per-user feature-flag override of the paywall plan ordering | Out of scope; P22-12 owns per-user flag overrides | v1.2 (post-launch) |
| iap.ts test for purchaseSubscription with no matching package id (e.g. legacy productId in URL) | Already covered — test case `purchaseSubscription with no matching package → throws` (line 220 in iap.test.ts) | n/a (shipped) |
| Real anon-client-bound Realtime test (Case C currently uses service-role client both as writer and listener) | service-role-bound channels skip RLS; future test should anon-sign as the seeded user + assert JWT-bound listener delivers payload through RLS | Plan 16-10 (paired with sandbox purchase UAT) |

## Carry-Over Contracts for Plan 16-06

The Realtime tier-flip listener installed by this plan ASSUMES that
**Plan 16-06's `revenuecat-webhook`** (or the Phase 14 `stripe-webhook`)
writes the `public.subscriptions` row that triggers the postgres_changes
broadcast. 16-06 is already shipped (`16-06-SUMMARY.md` confirms the
webhook deployed, with idempotent upserts to `subscriptions` table by
`(user_id, provider)`) — so the broadcast trigger is live on the server side.

The client side (this plan) listens to BOTH `event: 'UPDATE'` and
`event: 'INSERT'` so first-time subscribers (INSERT row) and renewals /
cancellations (UPDATE row) both fire the tier re-derive. Idempotent: the
handler is called once per Postgres row mutation, and `syncBillingTier`
re-reads the row fresh each time — no race between Stripe + RC webhooks
arriving within ~5s of each other.

## Self-Check: PASSED

**Files created:**
- `leanshot/src/lib/native/iap.test.ts` — FOUND
- `leanshot/src/components/PricingIOS.tsx` — FOUND
- `leanshot/src/test/PricingIOS.test.tsx` — FOUND
- `leanshot/e2e/mobile/iap-flow.spec.ts` — FOUND
- `leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-05-SUMMARY.md` — FOUND (this file)

**Commits in `git log --oneline -5`:**
- `51c3a62` test(16-05): add failing iap.ts RC bridge contract (RED) + GREEN impl
- `7adae32` feat(16-05): add PricingIOS paywall + platform-aware getPricingComponent
- `be2528d` feat(16-05): fork ?upgrade= on iOS/Android + install subscriptions Realtime listener
- `3ae9e4b` style(16-05): apply eslint --fix to PricingIOS + pricing-page-content imports
