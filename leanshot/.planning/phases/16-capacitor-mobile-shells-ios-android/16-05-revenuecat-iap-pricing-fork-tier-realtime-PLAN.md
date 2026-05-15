---
phase: 16-capacitor-mobile-shells-ios-android
plan: 05
type: execute
wave: 2
depends_on: [16-01, 16-02]
files_modified:
  - src/lib/native/iap.ts
  - src/components/PricingIOS.tsx
  - src/App.tsx
  - src/lib/page-builder/pricing-page-content.ts
  - src/lib/native/iap.test.ts
  - src/test/PricingIOS.test.tsx
  - e2e/mobile/iap-flow.spec.ts
  - package.json
  - package-lock.json
autonomous: true
requirements: [MONEY-06]
tags: [capacitor, revenuecat, iap, paywall, realtime]
user_setup: []

must_haves:
  truths:
    - "On iOS/Android, user opening /pricing (or the `?upgrade=` deep link) sees the RC-IAP paywall — never a Stripe checkout button."
    - "On iOS/Android non-clinic-owner user tapping Subscribe invokes `Purchases.purchasePackage()` (StoreKit/Play Billing sheet) — NOT `stripe-checkout/session`."
    - "On iOS/Android user with `role='clinic_owner'` sees the clinic-billing redirect row instead of any IAP button."
    - "On iOS/Android user tapping `Open Billing Portal` (clinic-owner) opens `https://leanshot.app/clinic/billing` in Safari View Controller / Chrome Custom Tab via `@capacitor/browser` — not in-app WKWebView navigation."
    - "On iOS/Android user with `stripe_trial_used=true` does NOT see the `Start with 7 days free` copy on the paywall (D-22 offer eligibility)."
    - "When `revenuecat-webhook` updates `subscriptions` for the signed-in user (or the Stripe webhook in the parallel reconciliation), the iOS/Android app receives a Postgres-changes broadcast on `subscriptions:user_id=eq.{userId}` and re-derives `tier` within ~5s (D-25)."
    - "On web (`detectPlatform() === 'web'`), the existing `?upgrade=` -> `stripe-checkout/session` flow is byte-for-byte preserved (Phase 15 Plan 15-10 invariant)."
    - "The PricingIOS component contains zero literal references to `stripe`, `Stripe`, `leanshot.app/pricing`, or any web pricing URL — anti-steering (Apple §3.1.1) is enforced by unit test grep."
  artifacts:
    - path: "src/lib/native/iap.ts"
      provides: "configureRC, getOfferings, purchaseSubscription, restorePurchases, checkTrialEligibility — real RevenueCat SDK calls behind a single module surface."
      exports: ["configureRC", "getOfferings", "purchaseSubscription", "restorePurchases", "checkTrialEligibility", "type Offering", "type PurchaseResult"]
    - path: "src/components/PricingIOS.tsx"
      provides: "Platform-aware paywall component for ios/android with clinic-owner gate, trial-eligibility-aware copy, and Subscribe / Restore Purchases CTAs wired to iap.ts."
      exports: ["default PricingIOS"]
      min_lines: 120
    - path: "src/App.tsx"
      provides: "Modified `?upgrade=` handler that platform-forks (web -> stripe-checkout/session unchanged; ios/android -> Purchases.purchasePackage) AND installs the `subscriptions:user_id=eq.X` Realtime channel for tier-flip propagation."
      contains: "detectPlatform"
    - path: "src/lib/page-builder/pricing-page-content.ts"
      provides: "Tiny platform-aware render hook export (`getPricingComponent`) used by the published `/pricing` runtime to return PricingIOS on native, the existing block tree on web. No DB change."
      exports: ["getPricingComponent"]
    - path: "src/lib/native/iap.test.ts"
      provides: "Unit suite with mocked @revenuecat/purchases-capacitor + @capacitor/core covering: configureRC idempotency, web no-op, getOfferings parse, purchaseSubscription happy path + UserCancelled error path, checkTrialEligibility intro-ineligible branch."
    - path: "src/test/PricingIOS.test.tsx"
      provides: "Component test asserting: clinic-owner branch renders portal CTA (no Subscribe button); trial-ineligible branch hides 'Start with 7 days free' copy; anti-steering grep (no /stripe/i, no /leanshot\\.app\\/pricing/i in rendered DOM)."
    - path: "e2e/mobile/iap-flow.spec.ts"
      provides: "Playwright spec guarded by HAS_LIVE (SUPABASE_SERVICE_ROLE_KEY + RC_API_KEY_IOS). Skipped when env missing — manual sandbox UAT in Plan 16-10."
  key_links:
    - from: "src/components/PricingIOS.tsx"
      to: "src/lib/native/iap.ts"
      via: "import { purchaseSubscription, restorePurchases, checkTrialEligibility } from '@/lib/native/iap'"
      pattern: "from ['\"]@/lib/native/iap['\"]"
    - from: "src/App.tsx"
      to: "src/lib/native/iap.ts"
      via: "platform-fork in ?upgrade= handler invokes purchaseSubscription on ios/android"
      pattern: "detectPlatform\\(\\)\\s*[!=]==?\\s*['\"](ios|android|web)"
    - from: "src/App.tsx"
      to: "Supabase Realtime"
      via: "channel(`subscriptions:user_id=eq.${userId}`).on('postgres_changes', ...)"
      pattern: "subscriptions:user_id=eq"
    - from: "src/lib/page-builder/pricing-page-content.ts"
      to: "src/components/PricingIOS.tsx"
      via: "dynamic import inside getPricingComponent() to keep web bundle clean"
      pattern: "import\\(.+PricingIOS"
---

<objective>
Wire RevenueCat IAP into the iOS + Android shells (MONEY-06 client half) and fork the pricing paywall so non-web platforms never see Stripe Checkout.

Purpose: Apple §3.1.1 + Google §3.1.1 mandate StoreKit/Play Billing for digital subscriptions; serving the existing Stripe-Checkout button on iOS would fail review. We need a native paywall that uses RevenueCat as the single SDK surface (per Pattern 3 in RESEARCH.md), respects Apple's anti-steering rule (no mention of web pricing), honours D-22 trial-eligibility, hides IAP entirely for clinic-owners (D-24) and routes them to Stripe Portal via Safari View Controller, and propagates RC webhook tier-flips to the running native app via Supabase Realtime (D-25, mirroring Phase 9/10 patterns).

Output:
- Real `src/lib/native/iap.ts` (no more Phase 12 throw-stub).
- New `src/components/PricingIOS.tsx` cloned from `PricingBlock.tsx` layout, anti-steering-clean.
- `src/App.tsx` modifications: platform-aware `?upgrade=` handler + Realtime `subscriptions:user_id=eq.X` install.
- Tiny `getPricingComponent()` export in `pricing-page-content.ts`.
- Unit suite (vitest-mobile) and a HAS_LIVE-gated Playwright e2e spec.

Single-source-of-truth invariant: `src/lib/native/iap.ts` is the ONLY module that imports `@revenuecat/purchases-capacitor`. PricingIOS calls iap.ts; App.tsx calls iap.ts. No direct `Purchases.*` usage outside iap.ts.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/16-capacitor-mobile-shells-ios-android/16-CONTEXT.md
@.planning/phases/16-capacitor-mobile-shells-ios-android/16-RESEARCH.md
@.planning/phases/16-capacitor-mobile-shells-ios-android/16-PATTERNS.md
@.planning/phases/16-capacitor-mobile-shells-ios-android/16-UI-SPEC.md
@.planning/phases/16-capacitor-mobile-shells-ios-android/16-01-SUMMARY.md
@.planning/phases/16-capacitor-mobile-shells-ios-android/16-02-SUMMARY.md
@src/lib/native/iap.ts
@src/lib/native/platform.ts
@src/components/admin/pages/blocks/PricingBlock.tsx
@src/App.tsx
@src/lib/page-builder/pricing-page-content.ts
@src/lib/clinic-realtime.ts
@src/lib/store.ts
@supabase/functions/stripe-checkout/index.ts
@e2e/checkout-trial-flow.spec.ts
@vitest-mobile.config.ts

<interfaces>
<!-- Contracts the executor needs. Extracted from codebase + Phase 16 prior plans. -->
<!-- Do NOT explore for these — they are the authoritative shapes for this plan. -->

Existing Phase 12 stub being replaced — keep the named export and type, broaden:
  export type IapProvider = 'apple' | 'google';
  export function purchaseSubscription(productId: string): Promise<PurchaseResult>;

NEW iap.ts public surface (replaces stub):
  export type IapProvider = 'apple' | 'google';
  export interface Offering {
    identifier: string;          // 'default' (RC dashboard offering ID)
    monthlyPackage: Package | null;
    yearlyPackage: Package | null;
  }
  export interface Package {
    identifier: string;          // RC package id (e.g. '$rc_monthly')
    productIdentifier: string;   // 'app.leanshot.plus.monthly' | 'app.leanshot.plus.yearly' (D-03)
    priceString: string;         // localized — RC supplies '$12.99' / '€11,99'
  }
  export interface PurchaseResult {
    customerInfo: { entitlements: { active: Record<string, unknown> } };
    cancelled: boolean;
  }
  export interface TrialEligibility {
    monthlyEligible: boolean;
    yearlyEligible: boolean;
  }
  export async function configureRC(appUserID: string): Promise<void>;       // idempotent; no-op on web
  export async function getOfferings(): Promise<Offering | null>;            // null on web
  export async function purchaseSubscription(productId: string): Promise<PurchaseResult>;
  export async function restorePurchases(): Promise<void>;                   // RC.restorePurchases()
  export async function checkTrialEligibility(): Promise<TrialEligibility>;  // D-22

Existing platform module (from 16-02, do not modify here):
  // src/lib/native/platform.ts
  export type Platform = 'web' | 'ios' | 'android' | 'capacitor-web';
  export function detectPlatform(): Platform;

Existing Realtime pattern (mirror in App.tsx) — from src/lib/clinic-realtime.ts:
  const channel = supabase.channel(topic, { config: { private: true } })
    .on('broadcast', { event: 'INSERT' }, onChange)
    .on('broadcast', { event: 'UPDATE' }, onChange);
  await channel.subscribe();
  // For postgres_changes (this plan), use:
  //   .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'subscriptions', filter: `user_id=eq.${userId}` }, payload => ...)

Existing pricing block (FORK SOURCE — clone the layout, NOT the data model):
  // src/components/admin/pages/blocks/PricingBlock.tsx
  // 112 lines, two-tile vertical layout, recommended-ring pattern,
  // imports Check from lucide-react + backgroundToneClass/paddingForDensity helpers.
  // We are NOT reusing the BlockNode prop shape — PricingIOS takes plain props.

Existing App.tsx ?upgrade= handler (Phase 15 Plan 15-10, lines 551-676) — preserve byte-for-byte
on the web branch; add an ios/android branch BEFORE the stripe-checkout invoke.

Store role shape (D-24):
  // src/lib/store.ts — useStore((s) => s.signedIn?.user?.app_metadata?.role) OR
  //                    useStore((s) => s.signedIn?.role) — verify in code before writing.
  // The clinic-owner discriminator is `role === 'clinic_owner'`.

Edge Function envs (D-01 product IDs are RC dashboard config, NOT in client):
  // Client-side env vars (Vite import.meta.env, NOT Deno.env):
  //   VITE_RC_API_KEY_IOS         — RevenueCat public iOS SDK key
  //   VITE_RC_API_KEY_ANDROID     — RevenueCat public Android SDK key
  // These MUST be present in .env.local for native dev builds.
  // For unit tests, vi.mock @revenuecat/purchases-capacitor — env reads are bypassed.

UI-SPEC iter-2 copy contract (all CTAs verb+noun, exactly 4 type sizes, no banned generics):
  Subscribe CTA           : "Subscribe"
  Restore Purchases link  : "Restore Purchases"
  Trial copy (eligible)   : "Start with 7 days free"
  Trial copy (ineligible) : OMITTED (no text, no empty space)
  Legal micro-copy (iOS)  : "Payment processed by Apple. Subscription renews automatically. Cancel anytime in Settings."
  Legal micro-copy (Andr.): "Payment processed by Google Play. Subscription renews automatically. Cancel anytime in Settings."
  Clinic-owner heading    : "Clinic billing"
  Clinic-owner body       : "Your subscription is managed at leanshot.app. Use the billing portal to update your plan or payment method."
  Clinic-owner CTA        : "Go to Billing Portal"
  Paywall headline        : "LeanShot Plus"  (Fraunces italic on "Plus")
  Paywall sub-headline    : "7-day forecast · AI coach · ad-free"

UI-SPEC type scale (strict — only these 4 sizes):
  --text-sm  : 13px  (label / legal / badge)
  --text-base: 16px  (body)
  --text-xl  : 22px  (section heading)
  --text-2xl : 26px  (paywall headline)

Bundle chunk routing (do NOT regress Phase 12 ceilings):
  // vite.config.ts manualChunks already routes @capacitor/* via 'capacitor-bridge' (Plan 16-01).
  // @revenuecat/purchases-capacitor MUST be added to the same 'capacitor-bridge' chunk.
  // If 'capacitor-bridge' already matches /\@capacitor/ — extend regex to also match /\@revenuecat\/purchases-capacitor/.
  // Per CONTEXT D-12 chunk caps: capacitor-bridge ≤15 kB gz on web. PricingIOS itself is web-shipped
  // only via dynamic import from getPricingComponent — confirm zero impact on the web index.
</interfaces>

<gotchas>
1. RC SDK is mobile-only. `@revenuecat/purchases-capacitor` MUST NOT execute on web — guard every public call in `iap.ts` with `detectPlatform()` and early-return a typed no-op result. Failure mode if not guarded: web build still imports the package, Vite bundles it, web users get a runtime crash on /pricing.

2. ANTI-STEERING (Apple §3.1.1 / §3.1.1(a)): The `PricingIOS` source MUST NOT contain the strings 'stripe', 'Stripe', 'leanshot.app/pricing', or any web upgrade URL. Add a vitest assertion that greps the rendered HTML for `/stripe/i` and fails. This rule is global, not US-only. The clinic-owner branch's `leanshot.app/clinic/billing` link is allowed because it is for managing an EXISTING enterprise subscription, NOT steering a consumer to web purchase (D-24 nuance documented in 16-10 submission-response template).

3. The existing Phase 15 Plan 15-10 `?upgrade=` handler is ~125 lines and has subtle invariants (validation of the two-value enum, sessionStorage stash for post-auth restoration, history.replaceState to strip param). Wrap the platform-fork around the EXISTING handler — do NOT rewrite. Pattern:
     const plan = ...validated...;
     const platform = detectPlatform();
     if (platform === 'ios' || platform === 'android') {
       // RC branch: configureRC + purchaseSubscription
     } else {
       // EXISTING stripe-checkout/session invoke — byte-for-byte preserved
     }

4. `App.tsx` is shared-file territory. 16-04 was scoped to `src/main.tsx` per the outline; this plan owns `src/App.tsx` exclusively for Wave 2. Commit with `git commit -- src/App.tsx ...` per `feedback_parallel_executor_git_isolation.md` so the parallel executors do not sweep each other.

5. `package.json` / `package-lock.json` are touched by 16-04 + 16-05 + (potentially 16-06). Use `git commit -- package.json package-lock.json` pathspec to avoid index pollution. The RC dep was already added in 16-01 per the outline; verify it is present before assuming you must `npm install` — only `npm install` if `node_modules/@revenuecat/purchases-capacitor` is missing.

6. Realtime channel cleanup: subscribe inside a `useEffect` keyed on `userId`. The cleanup function MUST `await channel.unsubscribe()` (cast to void for the cleanup signature). Forgetting this leaks channels on every signedIn -> signedOut -> signedIn cycle.

7. `tier_effective` view is built in 16-06 (parallel Wave 2). For this plan, the Realtime listener recomputes tier client-side from `payload.new.expires_at > now()`. Cross-platform `MAX(stripe.expires_at, revenuecat.expires_at)` reconciliation is the WEBHOOK's job — the client just trusts the row state for its provider. If both providers update within ~5s, two postgres_changes events fire; the handler is idempotent (computes the same boolean from the same row).

8. Trial eligibility (D-22): RC's `checkTrialOrIntroductoryPriceEligibility` returns one of INTRO_ELIGIBILITY_STATUS_{UNKNOWN, INELIGIBLE, ELIGIBLE, NO_INTRO_OFFER}. ONLY render the "Start with 7 days free" copy when status === ELIGIBLE. UNKNOWN should be treated as INELIGIBLE (be conservative — better to undersell trial than promise it and fail).

9. UserCancelled is NOT an error. RC throws with `userCancelled: true` on the error object. Catch it, dismiss the loading spinner, do NOT toast an error. Other errors (network, configuration) DO toast.

10. PricingIOS imports `Check` from `lucide-react` (matches `PricingBlock.tsx`). Do NOT import any block-schema helpers (`backgroundToneClass`, `paddingForDensity`) — they belong to the page-builder block system and would needlessly couple PricingIOS to the page-builder runtime.

11. `getPricingComponent()` MUST use dynamic `import()` for `PricingIOS` so the web bundle does not statically pull it. The runtime branch:
       export async function getPricingComponent(platform: Platform) {
         if (platform === 'ios' || platform === 'android') {
           const m = await import('@/components/PricingIOS');
           return m.default;
         }
         return null; // caller falls back to existing block-tree render path
       }

12. Anti-steering grep test pattern:
       const html = container.innerHTML.toLowerCase();
       expect(html).not.toMatch(/stripe/i);
       expect(html).not.toMatch(/leanshot\.app\/pricing/i);
    Make sure your link `https://leanshot.app/clinic/billing` does NOT match `leanshot.app/pricing` — it does not, the regex is path-specific.
</gotchas>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Replace src/lib/native/iap.ts stub with real RevenueCat SDK surface (mobile-only, web no-op)</name>
  <files>src/lib/native/iap.ts, src/lib/native/iap.test.ts</files>
  <read_first>
    - src/lib/native/iap.ts (current 8-line stub — must replace, keep `purchaseSubscription` named export so existing imports compile)
    - src/lib/native/platform.ts (the existing `detectPlatform()` function from 16-02)
    - 16-RESEARCH.md §"Pattern 3: RevenueCat SDK" + §"MONEY-06"
    - 16-PATTERNS.md §"src/lib/native/iap.ts" (lazy-init pattern, eligibility shape)
    - 16-CONTEXT.md D-01 (1 entitlement 'plus' + 2 products), D-03 (product IDs `app.leanshot.plus.monthly` + `.yearly`), D-22 (trial-blocking via offer eligibility)
    - vitest-mobile.config.ts (test runner — Plan 16-00 scaffold; includes glob covers `src/lib/native/**/*.test.ts`)
    - @revenuecat/purchases-capacitor README via Context7 if syntax doubt (the v8 API uses `Purchases.configure({ apiKey, appUserID })`, `Purchases.getOfferings()`, `Purchases.purchasePackage({ aPackage })`, `Purchases.checkTrialOrIntroductoryPriceEligibility({ productIdentifiers })`, `Purchases.restorePurchases()`)
  </read_first>
  <behavior>
    - configureRC('user-id'): on web, returns immediately (no SDK call). On ios/android, calls `Purchases.configure({ apiKey: import.meta.env.VITE_RC_API_KEY_{IOS|ANDROID}, appUserID })` exactly once even when invoked multiple times (module-level `_configured` flag). Re-invocation with a different appUserID calls `Purchases.logIn({ appUserID })` to switch user context.
    - getOfferings(): on web returns `null`. On native, calls `Purchases.getOfferings()`, picks `current` offering, maps `monthly` / `annual` packages to the public `Offering` shape. Returns `null` if RC has no current offering (e.g. dashboard misconfiguration).
    - purchaseSubscription(productId): on web throws `Error('purchaseSubscription is not available on web')` (no caller should reach this — App.tsx gates by platform). On native, looks up the matching Package from the current offering (compares `productIdentifier`), calls `Purchases.purchasePackage({ aPackage: pkg })`, returns `{ customerInfo, cancelled: false }`. On `userCancelled === true` error, returns `{ customerInfo: {entitlements:{active:{}}}, cancelled: true }` — NOT thrown. On other errors, re-throws.
    - restorePurchases(): on web no-op. On native, awaits `Purchases.restorePurchases()`. Re-throws non-cancellation errors.
    - checkTrialEligibility(): on web returns `{ monthlyEligible: false, yearlyEligible: false }` (conservative — web does not show RC trial copy). On native, calls `Purchases.checkTrialOrIntroductoryPriceEligibility({ productIdentifiers: ['app.leanshot.plus.monthly', 'app.leanshot.plus.yearly'] })`, maps each product's `status` to a boolean (`status === INTRO_ELIGIBILITY_STATUS_ELIGIBLE`). UNKNOWN maps to false.

    Test cases (iap.test.ts under vitest-mobile, env: node, vi.mock for @capacitor/core + @revenuecat/purchases-capacitor):
    - configureRC('u1') on web → returns; Purchases.configure NEVER called.
    - configureRC('u1') on ios → Purchases.configure called once with { apiKey: 'iostest', appUserID: 'u1' }.
    - configureRC('u1') then configureRC('u1') on ios → Purchases.configure called exactly once (idempotency).
    - configureRC('u1') then configureRC('u2') on ios → Purchases.configure called once + Purchases.logIn called once with { appUserID: 'u2' }.
    - getOfferings() on web → returns null.
    - getOfferings() on ios with mocked current offering containing monthly + annual → returns { identifier: 'default', monthlyPackage: {...}, yearlyPackage: {...} } with correct productIdentifier strings.
    - getOfferings() on ios with null current → returns null.
    - purchaseSubscription('app.leanshot.plus.monthly') on ios → resolves to { cancelled: false, customerInfo: {...} }, Purchases.purchasePackage called with correct aPackage.
    - purchaseSubscription on ios when SDK throws userCancelled error → resolves to { cancelled: true } (no throw).
    - purchaseSubscription on ios when SDK throws non-cancel error → re-throws.
    - purchaseSubscription on web → throws Error('not available on web').
    - restorePurchases() on web → no-op (Purchases.restorePurchases NEVER called).
    - restorePurchases() on ios → calls Purchases.restorePurchases.
    - checkTrialEligibility() on web → { monthlyEligible: false, yearlyEligible: false }.
    - checkTrialEligibility() on ios with both ELIGIBLE → { monthlyEligible: true, yearlyEligible: true }.
    - checkTrialEligibility() on ios with monthly INELIGIBLE + yearly ELIGIBLE → { monthlyEligible: false, yearlyEligible: true }.
    - checkTrialEligibility() on ios with UNKNOWN status → maps to false (conservative).
  </behavior>
  <action>
    Replace `src/lib/native/iap.ts` (currently the 8-line Phase 12 throw-stub) with the production module per the interfaces block above, implementing the RevenueCat SDK calls per D-01/D-03/D-22 and the lazy-init pattern from `16-PATTERNS.md §"src/lib/native/iap.ts"`. Preserve the existing named export `purchaseSubscription` (signature broadens from `(productId: string): never` to `(productId: string): Promise<PurchaseResult>` — verify the only existing callers are in src/lib/native/iap.ts itself and any new PricingIOS code in this plan; if any other file imports it, that file must be updated in the same commit).

    Use module-level state for idempotency:
      let _configured = false;
      let _currentAppUserID: string | null = null;

    Read API keys via Vite env (`import.meta.env.VITE_RC_API_KEY_IOS` / `..._ANDROID`). Throw a typed error `RcConfigError` if the platform-appropriate key is missing on native (test must cover this; web no-op path skips the read).

    Create the test file `src/lib/native/iap.test.ts` covering all behavior cases above. Use `vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: vi.fn(), isNativePlatform: vi.fn() } }))` and `vi.mock('@revenuecat/purchases-capacitor', () => ({ Purchases: { configure: vi.fn(), getOfferings: vi.fn(), purchasePackage: vi.fn(), restorePurchases: vi.fn(), logIn: vi.fn(), checkTrialOrIntroductoryPriceEligibility: vi.fn() }, INTRO_ELIGIBILITY_STATUS_ELIGIBLE: 'ELIGIBLE', INTRO_ELIGIBILITY_STATUS_INELIGIBLE: 'INELIGIBLE', INTRO_ELIGIBILITY_STATUS_UNKNOWN: 'UNKNOWN' }))`. Set `import.meta.env.VITE_RC_API_KEY_IOS = 'iostest'` and `..._ANDROID = 'androidtest'` via `vi.stubEnv`.

    Pattern reference (16-PATTERNS.md):
    ```
    let _rcConfigured = false;
    export async function configureRC(appUserID: string): Promise<void> {
      if (_rcConfigured) return;
      const platform = detectPlatform();
      if (platform !== 'ios' && platform !== 'android') return;
      const apiKey = platform === 'ios'
        ? import.meta.env.VITE_RC_API_KEY_IOS
        : import.meta.env.VITE_RC_API_KEY_ANDROID;
      await Purchases.configure({ apiKey, appUserID });
      _rcConfigured = true;
    }
    ```
    Extend this pattern per the behavior block above (idempotent re-config + logIn for user switch).

    Per D-22 (block 2nd trial): expose `checkTrialEligibility()` so PricingIOS can decide whether to show the "Start with 7 days free" copy.

    Per D-04 immediate-downgrade context: NOTE the client does NOT process cancellation locally — the RC webhook (Plan 16-06) sets `expires_at = now()` and the Realtime listener in App.tsx (Task 3 below) propagates the tier flip. The iap.ts module does not need a cancellation API.

    Use `// eslint-disable-next-line` only if absolutely required — Phase 12 firewall does NOT restrict @revenuecat imports inside src/lib/native/ (per 16-PATTERNS.md §"ESLint Firewall — Adding New Native Files").

    Run the suite under vitest-mobile config:
      npm run test:mobile -- src/lib/native/iap.test.ts
    or the equivalent script created in 16-00. If the script name differs, fall back to:
      npx vitest run --config vitest-mobile.config.ts src/lib/native/iap.test.ts
  </action>
  <verify>
    <automated>npx vitest run --config vitest-mobile.config.ts src/lib/native/iap.test.ts</automated>
    <secondary>grep -E "Purchases\\.(configure|getOfferings|purchasePackage|restorePurchases|checkTrialOrIntroductoryPriceEligibility|logIn)" src/lib/native/iap.ts | grep -v '^#' | wc -l   # expect >=5</secondary>
    <secondary>grep -E "detectPlatform\\(\\)" src/lib/native/iap.ts | grep -v '^#' | wc -l   # expect >=4 (one per public function early-return guard)</secondary>
  </verify>
  <done>
    - vitest-mobile suite for iap.test.ts passes all behavior cases (no test marked .skip / .fixme).
    - `src/lib/native/iap.ts` exports configureRC, getOfferings, purchaseSubscription, restorePurchases, checkTrialEligibility plus the Offering / Package / PurchaseResult / TrialEligibility types.
    - The file imports `@revenuecat/purchases-capacitor` (verified by grep) AND guards every public function with `detectPlatform()` for the web no-op branch (verified by grep).
    - `npm run typecheck` (or `tsc -b`) is green for the project — the broader signature change of `purchaseSubscription` does not break any existing caller.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Create src/components/PricingIOS.tsx (clinic-owner gate + trial eligibility + anti-steering)</name>
  <files>src/components/PricingIOS.tsx, src/test/PricingIOS.test.tsx, src/lib/page-builder/pricing-page-content.ts</files>
  <read_first>
    - src/components/admin/pages/blocks/PricingBlock.tsx (FORK SOURCE — 112 lines, two-tile vertical layout, recommended-ring + savings-badge pattern)
    - src/lib/native/iap.ts (Task 1 output — provides purchaseSubscription, restorePurchases, checkTrialEligibility, getOfferings)
    - src/lib/native/platform.ts (detectPlatform)
    - src/lib/store.ts (grep for `role` to find the clinic_owner discriminator location — `useStore((s) => s.signedIn?.user?.app_metadata?.role)` OR `useStore((s) => s.signedIn?.role)`, verify before writing)
    - src/lib/page-builder/pricing-page-content.ts (existing PRICING_PAGE_BLOCKS / PRICING_PAGE_SEO exports — we are APPENDING `getPricingComponent`, not modifying existing exports)
    - 16-UI-SPEC.md Surface 1 (full Pricing iOS contract — layout, copy table, 4-size type scale, anti-steering rule, clinic-owner variant)
    - 16-CONTEXT.md D-13 (paywall fork), D-22 (trial-blocking), D-24 (clinic-owner hide)
    - 16-PATTERNS.md §"src/components/PricingIOS.tsx" (imports table + planClass DS token strings)
    - @capacitor/browser plugin docs (Browser.open + Browser.close) for the clinic-owner "Go to Billing Portal" CTA — Context7 if syntax doubt
  </read_first>
  <behavior>
    Component contract for `<PricingIOS />`:
    - Reads platform + role + tier-trial-used hint via store selectors (each as a separate primitive selector to avoid re-renders — see CONVENTIONS.md hook rules).
    - On mount: if platform is ios/android, call `configureRC(userId)` then `getOfferings()` and `checkTrialEligibility()` in parallel, store in component state. On web, render nothing (or null — caller decides; for safety the component itself returns null on web).
    - If `role === 'clinic_owner'`: render the clinic-owner variant per UI-SPEC Surface 1 — Building2 icon, body copy, secondary "Go to Billing Portal" button. Button onClick: dynamic `import('@capacitor/browser')` then `Browser.open({ url: 'https://leanshot.app/clinic/billing', toolbarColor: '#1b4842' })`. NO Subscribe button, NO plan tiles.
    - Otherwise: render the two plan tiles (Monthly + Yearly) with the recommended-ring on Yearly (the "save 15%" variant). Display the localized priceString from the RC Offering. Initial selection: Yearly.
    - Trial copy: if `monthlyEligible` is true AND user selected Monthly → show "Start with 7 days free" above Subscribe; if `yearlyEligible` is true AND user selected Yearly → same. If neither selected plan is eligible → omit the copy entirely.
    - Subscribe button: calls `purchaseSubscription(selectedProductId)`. While in flight, button shows `aria-busy` spinner (do not change label text). On `{ cancelled: true }`: dismiss spinner, no toast. On thrown error: dismiss spinner, surface "Couldn't complete purchase. Try again." via the same `useStore.getState().showToast(...)` pattern App.tsx uses.
    - Restore Purchases link: 44px touch target, calls `restorePurchases()`. On success: toast "Purchases restored." (or "No purchases to restore" if no entitlement became active — read the customerInfo via a subsequent `Purchases.getCustomerInfo()` call OR the resolved result if iap.ts is extended).
    - Legal micro-copy: platform-conditional (Apple vs Google Play) at the bottom of the paywall, `--text-sm` 13px weight 400.
    - Anti-steering: NO references to Stripe / web pricing — enforced by Task 2 test.

    Test cases (PricingIOS.test.tsx under @testing-library/react + vitest, the existing project test setup — NOT vitest-mobile, because component tests need jsdom):
    - Renders null on web platform (mock detectPlatform → 'web').
    - Clinic-owner branch: when role === 'clinic_owner' → renders "Clinic billing" heading + "Go to Billing Portal" button; does NOT render any element with text matching /^Subscribe$/.
    - Non-clinic-owner + trial ELIGIBLE: renders "Start with 7 days free" copy AND a "Subscribe" button.
    - Non-clinic-owner + trial INELIGIBLE: does NOT render "Start with 7 days free" copy; "Subscribe" button still present.
    - Anti-steering grep: render the component (non-clinic-owner branch on ios), `expect(container.innerHTML.toLowerCase()).not.toMatch(/stripe/)` AND `expect(container.innerHTML).not.toMatch(/leanshot\\.app\\/pricing/i)`.
    - Subscribe click invokes mocked `purchaseSubscription` with the selected productId ('app.leanshot.plus.yearly' by default).
    - Subscribe userCancelled returns `{ cancelled: true }` → no toast fired.
    - Subscribe error throw → showToast called with error variant.
    - Restore Purchases click invokes mocked restorePurchases.

    getPricingComponent contract:
    - `export async function getPricingComponent(platform: Platform): Promise<React.ComponentType | null>`
    - On 'ios' | 'android': `const m = await import('@/components/PricingIOS'); return m.default;`
    - On 'web' | 'capacitor-web': returns `null`.
  </behavior>
  <action>
    Create `src/components/PricingIOS.tsx` per UI-SPEC Surface 1 (no shadcn — reuse existing `<Button>` from `src/components/ui/Button.tsx` and standard cards). Clone the visual rhythm from `PricingBlock.tsx` (recommended ring class, savings badge structure) but DO NOT import `backgroundToneClass` / `paddingForDensity` — those belong to the page-builder block runtime and would couple this component to BlockNode props.

    Tile className strings (per 16-PATTERNS.md):
    ```
    const planClass = recommended
      ? 'bg-[var(--color-surface-elevated)] border-2 border-[var(--color-primary)] shadow-[0_0_0_4px_var(--color-primary-soft)] rounded-xl p-6 flex flex-col text-left'
      : 'bg-[var(--color-surface)] border border-[var(--color-border)] shadow-[var(--shadow-xs)] rounded-xl p-6 flex flex-col text-left';
    ```

    Imports (anti-steering — DO NOT import anything from @/lib/stripe/* or anything containing 'stripe' in the path):
    ```
    import { useEffect, useState } from 'react';
    import { Building2, Check, ExternalLink, ScanFace /* if Surface 2 reused */ } from 'lucide-react';
    import { Button } from '@/components/ui/Button';
    import { detectPlatform } from '@/lib/native/platform';
    import { configureRC, getOfferings, purchaseSubscription, restorePurchases, checkTrialEligibility } from '@/lib/native/iap';
    import { useStore } from '@/lib/store';
    ```

    State shape:
    ```
    const [offering, setOffering] = useState<Offering | null>(null);
    const [eligibility, setEligibility] = useState<TrialEligibility>({ monthlyEligible: false, yearlyEligible: false });
    const [selected, setSelected] = useState<'monthly' | 'yearly'>('yearly');
    const [purchasing, setPurchasing] = useState(false);
    ```

    Role selector — verify the source-of-truth path in src/lib/store.ts BEFORE writing. The two candidates (from CONTEXT D-24) are `signedIn?.user?.app_metadata?.role` or `signedIn?.role`. Grep `src/lib/store.ts` for `role` and pick the existing path; do not invent a new field.

    Clinic-owner branch (D-24): single column, Building2 icon (size-5, --color-text-secondary), heading "Clinic billing", body copy from UI-SPEC, secondary `<Button variant="secondary">Go to Billing Portal</Button>` that dynamic-imports @capacitor/browser and calls `Browser.open({ url: 'https://leanshot.app/clinic/billing', toolbarColor: '#1b4842' })`. Below the button render the caption "Opens Stripe billing in your browser" with `<ExternalLink class="size-3 inline-block mr-1" aria-hidden />` per UI-SPEC Surface 5. (NOTE: 'Stripe' DOES appear in the clinic-owner caption per UI-SPEC; this is the ONE allowed mention. The anti-steering test must scope its grep to the NON-clinic-owner render path only — see test pattern below.)

    Non-clinic-owner branch: paywall with the Fraunces italic headline ("LeanShot *Plus*"), sub-headline ("7-day forecast · AI coach · ad-free"), two tiles, Subscribe button, Restore Purchases link, legal micro-copy. Use 4-size type strictly (--text-sm / --text-base / --text-xl / --text-2xl per UI-SPEC iter-2 fix 2).

    Subscribe handler:
    ```
    async function handleSubscribe() {
      const productId = selected === 'monthly' ? 'app.leanshot.plus.monthly' : 'app.leanshot.plus.yearly';
      setPurchasing(true);
      try {
        const result = await purchaseSubscription(productId);
        if (result.cancelled) return; // silent
        // success: Realtime channel in App.tsx will flip tier within ~5s; no local mutation needed
      } catch (err) {
        useStore.getState().showToast("Couldn't complete purchase. Try again.", 'error');
      } finally {
        setPurchasing(false);
      }
    }
    ```

    Then append `export async function getPricingComponent(platform: Platform): Promise<React.ComponentType | null> { ... }` to `src/lib/page-builder/pricing-page-content.ts`. This export is a thin platform branch:
    ```
    import type { Platform } from '@/lib/native/platform';
    import type { ComponentType } from 'react';

    export async function getPricingComponent(platform: Platform): Promise<ComponentType | null> {
      if (platform === 'ios' || platform === 'android') {
        const m = await import('@/components/PricingIOS');
        return m.default;
      }
      return null;
    }
    ```
    DO NOT modify the existing PRICING_PAGE_BLOCKS / PRICING_PAGE_SEO exports — they are the web render path and must remain byte-stable.

    Test file `src/test/PricingIOS.test.tsx`:
    - Use the existing project test runner (vitest with jsdom — see other `src/test/*.test.tsx` files for the config — likely `vitest.config.ts` or default).
    - Mock @/lib/native/platform → `detectPlatform: vi.fn(() => 'ios')`.
    - Mock @/lib/native/iap → vi.fn for each export. Default `getOfferings` returns a valid offering; default `checkTrialEligibility` returns `{ monthlyEligible: true, yearlyEligible: true }`.
    - Mock @/lib/store via the existing project pattern (likely vi.mock or a real store with seed).
    - Anti-steering grep — IMPORTANT scoping:
      ```
      it('non-clinic-owner render contains no Stripe / web-pricing references', () => {
        // Render WITH role !== 'clinic_owner' so the clinic-owner caption (which legitimately mentions Stripe billing) is excluded.
        const { container } = render(<PricingIOS />);
        const html = container.innerHTML.toLowerCase();
        expect(html).not.toMatch(/stripe/i);
        expect(html).not.toMatch(/leanshot\.app\/pricing/i);
      });
      ```
    - For the clinic-owner test, verify "Go to Billing Portal" button exists AND no "Subscribe" button.

    Confirm `npm run typecheck` passes after both files are written.
  </action>
  <verify>
    <automated>npx vitest run src/test/PricingIOS.test.tsx</automated>
    <secondary>grep -niE "from ['\"]@/lib/stripe" src/components/PricingIOS.tsx | grep -v '^#' | wc -l   # expect 0 — anti-steering import gate</secondary>
    <secondary>grep -niE "(stripe-checkout|/pricing)" src/components/PricingIOS.tsx | grep -v "clinic/billing" | grep -v "^#" | wc -l   # expect 0</secondary>
    <secondary>grep -E "(configureRC|getOfferings|purchaseSubscription|restorePurchases|checkTrialEligibility)" src/components/PricingIOS.tsx | grep -v '^#' | wc -l   # expect >=4</secondary>
    <secondary>grep -E "getPricingComponent" src/lib/page-builder/pricing-page-content.ts | grep -v '^#' | wc -l   # expect >=1 (the export)</secondary>
  </verify>
  <done>
    - PricingIOS.test.tsx passes all behavior cases.
    - PricingIOS renders null on web (typed-safe early return), the clinic-owner variant when role === 'clinic_owner', and the full paywall otherwise.
    - Anti-steering grep gate is green (no 'stripe' or 'leanshot.app/pricing' in the non-clinic-owner DOM).
    - `getPricingComponent(platform)` exported from pricing-page-content.ts; existing PRICING_PAGE_BLOCKS / PRICING_PAGE_SEO byte-stable (verify via `git diff --stat`).
    - `npm run typecheck` green.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Fork ?upgrade= handler + install Supabase Realtime tier-flip listener in src/App.tsx</name>
  <files>src/App.tsx, e2e/mobile/iap-flow.spec.ts</files>
  <read_first>
    - src/App.tsx (existing handler at lines 551-676 — preserve byte-for-byte on web branch; add platform fork BEFORE the stripe-checkout invoke)
    - src/lib/native/platform.ts (detectPlatform — already imported elsewhere in App.tsx? grep to confirm import is added once)
    - src/lib/native/iap.ts (Task 1 output — provides configureRC + purchaseSubscription)
    - src/lib/clinic-realtime.ts (channel subscribe + cleanup pattern; mirror for postgres_changes)
    - src/lib/store.ts (find the tier setter; likely `useStore.getState().setTier(...)` or partial-state set on signedIn — grep before writing)
    - e2e/checkout-trial-flow.spec.ts (HAS_LIVE pattern, addInitScript pattern, service-role admin client, pollUntil helper)
    - 16-CONTEXT.md D-04 (immediate downgrade), D-25 (Realtime tier flip)
    - 16-PATTERNS.md §"Realtime Tier-Flip Subscription (D-25)"
    - reference_realtime_layer_e2e_pattern.md from memory (drive trigger via Playwright but instantiate receiving channel directly in test file)
  </read_first>
  <behavior>
    `?upgrade=` handler fork (preserve Phase 15 Plan 15-10 invariants on web):
    - Enum validation, sessionStorage stash, history.replaceState strip, gating on verified non-anon signed-in user — UNCHANGED.
    - After validation + URL strip + gating, BEFORE the existing stripe-checkout/session dynamic-import invoke, add:
      ```
      const platform = detectPlatform();
      if (platform === 'ios' || platform === 'android') {
        const productId = plan === 'plus_monthly' ? 'app.leanshot.plus.monthly' : 'app.leanshot.plus.yearly';
        try {
          const { configureRC, purchaseSubscription } = await import('@/lib/native/iap');
          await configureRC(userId);
          const result = await purchaseSubscription(productId);
          if (result.cancelled) return; // silent
          // success path: Realtime channel flips tier in ~5s; nothing more to do here
        } catch {
          try { useStore.getState().showToast("Couldn't complete purchase. Try again.", 'error'); } catch { /* noop */ }
        }
        return; // CRITICAL: do not fall through to the stripe-checkout invoke
      }
      // ↓ existing web branch (unchanged) ↓
      ```
    - The web branch (stripe-checkout/session invoke) MUST remain byte-for-byte preserved — Phase 15 ship invariant.

    Realtime tier-flip listener (NEW useEffect in App.tsx):
    - Keyed on `[userId, view]` so it (re)installs when the user signs in / out and when the dashboard mounts.
    - Skip install when `view !== 'dashboard'` (no Realtime needed on marketing / onboarding).
    - Skip when `!userId || isAnon || !isVerified` (same gate as the existing focus billing-sync effect at lines 540-549).
    - Channel topic: `subscriptions:user_id=eq.${userId}` — exactly matches the filter for portability between debug grep and CI grep.
    - postgres_changes listener: event 'UPDATE' AND 'INSERT', schema 'public', table 'subscriptions', filter `user_id=eq.${userId}`. Handler recomputes tier from `payload.new.current_period_end > now()` (or whatever column the existing subscriptions table uses — grep the existing Stripe webhook handler at supabase/functions/stripe-webhook/index.ts to confirm the column name; CONTEXT D-02 calls it `current_period_end`).
    - On change: call the existing store mutation that flips tier — find it via grep (likely a `setTier` action or a partial set in `signedIn`). If it does not exist, dispatch a `void import('@/lib/billing-sync').then(({ syncBillingTier }) => syncBillingTier(userId))` reuse the existing focus-handler path which is the safe pattern (re-reads tier via tier_effective once Plan 16-06 ships).
    - Cleanup: return a function that `void channel.unsubscribe()`.

    Per the CONVENTIONS file, dynamic-import `@/lib/supabase` to keep it off App.tsx's static graph (mirrors lines 543-545, 643-645).

    e2e/mobile/iap-flow.spec.ts (HAS_LIVE-gated):
    - At top: HAS_LIVE gate per checkout-trial-flow.spec.ts pattern, gated on `SUPABASE_SERVICE_ROLE_KEY` + `SUPABASE_URL` + `SUPABASE_ANON_KEY` + `RC_API_KEY_IOS`. `test.skip(!HAS_LIVE, '...')`.
    - File-scoped slug prefix per `feedback_rls_per_file_slug_prefix.md`: `const IAP_TEST_PREFIX = 'iap-flow-${Date.now()}'`.
    - Per `feedback_verify_debug_findings_by_running.md` + `reference_realtime_layer_e2e_pattern.md`: do NOT drive a full sandbox StoreKit purchase via Playwright (impossible in headless). Instead:
      * test-case A: web-platform spec — visit `/#/settings?upgrade=plus_monthly` (Playwright default user-agent = web), assert the stripe-checkout/session invoke fires (mock the function via supabase.functions.invoke spy on the page). This proves the platform-fork's WEB BRANCH is byte-stable.
      * test-case B: simulated-ios spec — addInitScript that monkey-patches `Capacitor.getPlatform = () => 'ios'` AND `vi.mock`-style stub of `@/lib/native/iap` (page-level — inject a window.__iap_stub__ that the iap.ts module checks before calling RC) — wire a debug-only seam ONLY behind `VITE_E2E === 'true'` so it never ships to production.
      * test-case C: Realtime listener — sign in a service-role-minted user, instantiate a service-role supabase client in the test file, INSERT a subscription row, listen on `subscriptions:user_id=eq.${userId}` from a SECOND client subscribed in the test, and assert the channel receives the event within 5s. This validates the listener pattern WITHOUT needing the production app to be on a real device.
    - test-cases A + B + C are all guarded `test.skip(!HAS_LIVE, ...)`. The real device sandbox purchase happens in 16-10 UAT.
    - Use `page.addInitScript` for state seeding per `reference_playwright_state_seeding.md` — never goto+evaluate+reload.
    - afterAll: cleanup the test user via `admin.auth.admin.deleteUser(userId)`.
  </behavior>
  <action>
    Modify `src/App.tsx`:

    1. Add the `detectPlatform` import near the existing imports (verify it is not already imported via 16-02; if so, do not duplicate).

    2. Inside the existing `useEffect` block for the `?upgrade=` handler (line 573 onwards), AFTER the URL strip + verified-user gate but BEFORE the `void import('@/lib/supabase')` invoke at line 643, insert the platform-fork branch per the behavior block. The fork uses an early `return` so the web branch path remains untouched.

    3. Add a NEW useEffect AFTER the existing focus-handler effect (around line 549) for the Realtime tier-flip listener. Pattern:
    ```
    useEffect(() => {
      if (view !== 'dashboard') return;
      const signedIn = useStore.getState().signedIn;
      const userId = signedIn?.user?.id;
      const isAnon = signedIn?.user?.is_anonymous;
      const isVerified = signedIn?.verified;
      if (!userId || isAnon || !isVerified) return;
      let channel: ReturnType<typeof supabase.channel> | null = null;
      void (async () => {
        const { supabase } = await import('@/lib/supabase');
        channel = supabase
          .channel(`subscriptions:user_id=eq.${userId}`)
          .on('postgres_changes', {
            event: 'UPDATE',
            schema: 'public',
            table: 'subscriptions',
            filter: `user_id=eq.${userId}`,
          }, () => {
            void import('@/lib/billing-sync').then(({ syncBillingTier }) => syncBillingTier(userId));
          })
          .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'subscriptions',
            filter: `user_id=eq.${userId}`,
          }, () => {
            void import('@/lib/billing-sync').then(({ syncBillingTier }) => syncBillingTier(userId));
          });
        await channel.subscribe();
      })();
      return () => {
        if (channel) {
          void channel.unsubscribe();
        }
      };
    }, [view]);
    ```
    (Re-read userId from store at install time; the `view` dep is enough since the dashboard mount triggers it.)

    Per CONTEXT D-25: this exactly mirrors the Phase 9/10 Realtime patterns. The filter string MUST be `user_id=eq.${userId}` (NOT `eq=${userId}`) — exact pgrst syntax verified against `clinic-realtime.ts`.

    4. Create `e2e/mobile/iap-flow.spec.ts` per the behavior block. Service-role admin client + addInitScript for state seeding + Realtime listener instantiated DIRECTLY in the test file (not via the app UI). HAS_LIVE gate. File-scoped prefix.

    Use `git commit -- src/App.tsx e2e/mobile/iap-flow.spec.ts` per the parallel-executor isolation rule.

    Per `reference_supabase_auth_traps.md`: do NOT use signInWithPassword in the e2e spec — use service-role `admin.auth.admin.createUser({ email, password, email_confirm: true })` then mint a session JWT via `admin.auth.admin.generateLink` if a real session is needed.

    Run:
      npx vitest run --config vitest-mobile.config.ts src/lib/native/iap.test.ts   # regression
      npm run typecheck
      npm run lint -- src/App.tsx src/components/PricingIOS.tsx src/lib/native/iap.ts src/lib/page-builder/pricing-page-content.ts
  </action>
  <verify>
    <automated>npm run typecheck</automated>
    <secondary>grep -nE "subscriptions:user_id=eq" src/App.tsx | grep -v '^#' | wc -l   # expect >=1</secondary>
    <secondary>grep -nE "detectPlatform\\(\\)\\s*===?\\s*['\"](ios|android)" src/App.tsx | grep -v '^#' | wc -l   # expect >=1 (the ?upgrade= fork)</secondary>
    <secondary>grep -nE "stripe-checkout/session" src/App.tsx | grep -v '^#' | wc -l   # expect >=1 (web branch byte-stable)</secondary>
    <secondary>grep -nE "from ['\"]@/lib/native/iap['\"]" src/App.tsx | grep -v '^#' | wc -l   # expect 0 — App.tsx uses dynamic import, NEVER static</secondary>
    <secondary>grep -nE "channel\\.unsubscribe" src/App.tsx | grep -v '^#' | wc -l   # expect >=1 (cleanup)</secondary>
    <secondary>HAS_LIVE=false npx playwright test --config playwright.config.ts e2e/mobile/iap-flow.spec.ts  # expects all tests skipped, exit 0</secondary>
  </verify>
  <done>
    - `src/App.tsx` ?upgrade= handler forks on platform: ios/android → RC purchaseSubscription via dynamic import; web → existing stripe-checkout/session invoke (byte-stable diff on lines 643+).
    - New useEffect installs `subscriptions:user_id=eq.${userId}` postgres_changes listener on dashboard mount; cleanup awaits unsubscribe.
    - e2e/mobile/iap-flow.spec.ts exists, all three test cases gated `test.skip(!HAS_LIVE, ...)`, file-scoped prefix declared.
    - `npm run typecheck` green.
    - `npm run lint -- src/App.tsx src/components/PricingIOS.tsx src/lib/native/iap.ts src/lib/page-builder/pricing-page-content.ts` green (no NEW lint errors; pre-existing repo lint debt per `project_lint_debt_import_x_order.md` is not this plan's responsibility).
    - Bundle ceiling check: `npm run build && bash scripts/assert-bundle-budget.sh` green (capacitor-bridge ≤15 kB gz with @revenuecat added; index gz unchanged because PricingIOS is dynamic-imported via getPricingComponent — verify in the dist analysis).
    - Phase 12 ESLint firewall green: `npm run lint -- src/lib/native/` returns zero firewall violations.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| client (native shell) → RevenueCat | API key is a PUBLIC SDK key embedded in the bundle; RC validates entitlements server-side at receipt-verification time. Compromise of the public key cannot grant entitlement — only StoreKit/Play Billing receipts can. |
| RevenueCat → revenuecat-webhook (Edge Function) | HMAC-SHA256 verification (Plan 16-06 owns this — out of scope here, but the client trust model depends on it). |
| Supabase Realtime → client | The `subscriptions:user_id=eq.${userId}` postgres_changes channel is private-RLS-gated by the existing subscriptions table RLS policies (Phase 14). User can only subscribe to their own user_id row per RLS — no cross-tenant leak. |
| client → Supabase Edge Function `stripe-checkout/session` | Existing Phase 14/15 trust boundary — unchanged on web branch. Native path does NOT cross this boundary (RC SDK handles native purchases). |
| iOS Safari View Controller (@capacitor/browser) | Opens `leanshot.app/clinic/billing` in an OS chrome separate from WKWebView — cookies + localStorage are isolated from the app. User must re-auth in the SVC if they want to manage subscription. This is BY DESIGN (Stripe Portal needs Stripe session, not Supabase session). |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-16-05-01 | Spoofing | Client invocation of stripe-checkout on iOS (anti-steering bypass attempt) | mitigate | Anti-steering grep gate in PricingIOS.test.tsx + platform-fork in App.tsx returns BEFORE the stripe-checkout invoke. A crafted `?upgrade=` URL on iOS routes through the RC branch — no path to stripe-checkout exists from the native shell. |
| T-16-05-02 | Tampering | Local mutation of `tier` field to grant Plus access | mitigate | Tier is derived from the `subscriptions` row authoritatively; the Realtime listener triggers `syncBillingTier(userId)` which re-reads from the DB. Client-side state mutation gets overwritten on the next sync. NO client-side write path for tier exists (verified by greppling `setTier` in store.ts). |
| T-16-05-03 | Repudiation | User claims they did not purchase | accept | Receipt verification is RevenueCat's authoritative log; client does not need a local audit. RC dashboard maintains the receipt timeline. |
| T-16-05-04 | Information Disclosure | RC API key leak | accept | Public SDK key by design (per RC docs); cannot grant entitlement without a valid StoreKit receipt. Rotation playbook: regenerate in RC dashboard + bump VITE_RC_API_KEY_* env + rebuild. |
| T-16-05-05 | Information Disclosure | Realtime channel cross-tenant leak | mitigate | Channel filter `user_id=eq.${userId}` is RLS-enforced by Postgres at broadcast time. Validated by Phase 9/10 same-pattern e2e (clinic-realtime test suite). Plan 16-06 migration confirms RLS policy covers `provider='revenuecat'` rows identically to `provider='stripe'`. |
| T-16-05-06 | Denial of Service | Repeated `configureRC` calls slow paywall mount | mitigate | iap.ts uses module-level `_configured` flag — idempotent. Validated by Task 1 test case `configureRC called twice → Purchases.configure called once`. |
| T-16-05-07 | Elevation of Privilege | clinic_owner role bypass to access consumer IAP | mitigate | Role check is client-side gate for UI; the AUTHORITATIVE check is RLS + the subscriptions table provider=stripe row that clinic-owners already have. Even if a clinic_owner crafted the IAP flow client-side, RC's purchase would write a NEW subscriptions row with provider='revenuecat' — the tier_effective view (Plan 16-06) computes MAX(stripe.expires_at, revenuecat.expires_at) so they'd just stack subscriptions, NOT escalate. Apple §3.1.1 review risk is the bigger concern, mitigated by hiding the IAP UI entirely (D-24). |
| T-16-05-08 | Anti-steering (Apple §3.1.1) | App rejected for mentioning web pricing | mitigate | Anti-steering grep gate in PricingIOS.test.tsx fails the test if 'stripe' or 'leanshot.app/pricing' appears in the non-clinic-owner rendered DOM. Clinic-owner caption "Opens Stripe billing in your browser" is allowed (the ONE exception — subscription managed elsewhere for an enterprise service per D-24). Submission-response template in 16-10 documents this. |
| T-16-05-09 | Information Disclosure | iap.ts import.meta.env leaked into web bundle | accept | VITE_RC_API_KEY_IOS and VITE_RC_API_KEY_ANDROID are public SDK keys (see T-16-05-04). The web branch never reads them (web no-op early return). They are included in the web bundle as inert strings — no privilege grant. |
</threat_model>

<verification>
Run the full plan-local verification gauntlet:

```
# 1. Unit tests (vitest-mobile for iap.ts; project vitest for PricingIOS.tsx)
npx vitest run --config vitest-mobile.config.ts src/lib/native/iap.test.ts
npx vitest run src/test/PricingIOS.test.tsx

# 2. Typecheck
npm run typecheck

# 3. Lint (zero-new — pre-existing repo debt per project_lint_debt_import_x_order memory)
npm run lint -- src/App.tsx src/components/PricingIOS.tsx src/lib/native/iap.ts src/lib/page-builder/pricing-page-content.ts

# 4. Phase 12 firewall (no regressions)
npm run lint -- src/lib/native/

# 5. Anti-steering grep gate (non-clinic-owner code path)
! grep -niE "(stripe|leanshot\.app/pricing)" src/components/PricingIOS.tsx | grep -v "clinic/billing" | grep -v "Opens Stripe billing"

# 6. Web branch byte-stability of ?upgrade= handler
git diff --unified=0 src/App.tsx | grep -E "^-.*stripe-checkout/session" && echo "FAIL: web branch invoke was modified" || echo "PASS: stripe-checkout/session line not removed"

# 7. Build + bundle ceilings (capacitor-bridge ≤15 kB gz; index gz unchanged)
npm run build
bash scripts/assert-bundle-budget.sh

# 8. Playwright spec compiles + skips when HAS_LIVE absent
HAS_LIVE=false npx playwright test --config playwright.config.ts e2e/mobile/iap-flow.spec.ts

# 9. Pricing block invariant — Phase 15 page-content NOT regressed
git diff src/lib/page-builder/pricing-page-content.ts | grep -E "^-(export const PRICING_PAGE_BLOCKS|export const PRICING_PAGE_SEO)" && echo "FAIL: existing exports modified" || echo "PASS: existing pricing exports byte-stable"
```
</verification>

<success_criteria>
- Phase 12 stub `src/lib/native/iap.ts` replaced with the production module exporting `configureRC`, `getOfferings`, `purchaseSubscription`, `restorePurchases`, `checkTrialEligibility` plus public types.
- `src/components/PricingIOS.tsx` created, ≥120 lines, ≥4 calls into iap.ts, clinic-owner variant + non-clinic-owner paywall + Restore Purchases link + trial-eligibility-aware copy + platform-conditional legal micro-copy.
- `src/lib/page-builder/pricing-page-content.ts` appends `getPricingComponent` export; existing PRICING_PAGE_BLOCKS + PRICING_PAGE_SEO byte-stable.
- `src/App.tsx` modified to: platform-fork `?upgrade=` (ios/android → RC, web → existing stripe-checkout/session UNCHANGED), install Realtime `subscriptions:user_id=eq.${userId}` postgres_changes listener with cleanup.
- `src/lib/native/iap.test.ts` covers configureRC idempotency, web no-op, getOfferings parse, purchase happy / cancelled / error paths, trial eligibility branches. All green.
- `src/test/PricingIOS.test.tsx` covers clinic-owner branch, trial eligibility branch, anti-steering grep, Subscribe click, Restore click. All green.
- `e2e/mobile/iap-flow.spec.ts` exists with HAS_LIVE gate, file-scoped prefix, three test cases (web fork stability, ios simulated fork, Realtime listener) — all skipped when env vars absent.
- All four authoritative grep gates green (anti-steering imports, no static iap.ts import in App.tsx, channel filter present, cleanup present).
- `npm run typecheck` + `npm run build` green; bundle ceilings respected (capacitor-bridge ≤15 kB gz; index gz unchanged because PricingIOS reaches the web bundle only via dynamic import — never statically).
</success_criteria>

<output>
After completion, create `.planning/phases/16-capacitor-mobile-shells-ios-android/16-05-SUMMARY.md` per `$HOME/.claude/get-shit-done/templates/summary.md`. Include:
- Which RC SDK functions are wired (configureRC, getOfferings, purchasePackage, restorePurchases, checkTrialOrIntroductoryPriceEligibility, logIn).
- The exact list of decision IDs implemented (D-01, D-03, D-13, D-22, D-24, D-25).
- The anti-steering rule + the ONE allowed Stripe mention (clinic-owner caption per D-24) + the submission-response template handoff to 16-10.
- The bundle delta: capacitor-bridge before vs after; index gz before vs after.
- Any deferred items (e.g., real sandbox purchase UAT → 16-10; tier_effective view consumer wiring → 16-06).
- Carry-overs for Plan 16-06 (this plan ASSUMES the Realtime listener's broadcast trigger is implemented by the RC webhook + subscriptions row update — make explicit that 16-06 owns the server half).

Commit message:
`feat(16-05): wire RevenueCat IAP + fork pricing paywall for iOS/Android + Realtime tier-flip`
</output>

---

## PLAN COMPLETE

**Plan ID:** `16-05-revenuecat-iap-pricing-fork-tier-realtime`

- **Wires the RevenueCat client surface (MONEY-06 client half):** Replaces the Phase 12 throw-stub at `src/lib/native/iap.ts` with `configureRC` + `getOfferings` + `purchaseSubscription` + `restorePurchases` + `checkTrialEligibility`, implementing D-01 / D-03 / D-22 (offer-eligibility trial-blocking); single SDK ownership boundary (no other file imports `@revenuecat/purchases-capacitor`); each public function early-returns a typed no-op on web so the package never executes in the SPA bundle.
- **Forks the paywall + `?upgrade=` handler with strict anti-steering (D-13, D-24):** New `src/components/PricingIOS.tsx` cloned from `PricingBlock.tsx`'s recommended-ring layout, exclusively native-rendered via a new `getPricingComponent()` export on `pricing-page-content.ts` (dynamic import keeps it off the web bundle); `src/App.tsx` `?upgrade=` handler gains an `ios|android` branch BEFORE the existing `stripe-checkout/session` invoke (byte-for-byte preserved on web); clinic-owner role hides IAP and routes to Stripe Portal via `@capacitor/browser` Safari View Controller; vitest grep gate fails the test if `/stripe/i` or `/leanshot\.app\/pricing/i` appears in the non-clinic-owner DOM.
- **Installs tier-flip Realtime propagation (D-25) + e2e:** New `useEffect` in `src/App.tsx` subscribes to `subscriptions:user_id=eq.${userId}` postgres_changes (mirrors Phase 9/10 `clinic-realtime.ts` pattern); handler triggers existing `syncBillingTier(userId)` from `@/lib/billing-sync` so the running native app re-derives tier within ~5s of any RC or Stripe webhook write; `e2e/mobile/iap-flow.spec.ts` carries three HAS_LIVE-gated tests (web fork stability, simulated-ios fork, direct Realtime listener verification per `reference_realtime_layer_e2e_pattern.md`) — real sandbox purchase UAT deferred to Plan 16-10.

**File path:** `/Users/karstenhaldan/minisite/leanshot/.planning/phases/16-capacitor-mobile-shells-ios-android/16-05-revenuecat-iap-pricing-fork-tier-realtime-PLAN.md`