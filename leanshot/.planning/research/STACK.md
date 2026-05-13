# Stack Research — v1.2 Additions

**Domain:** Cross-platform health tracker going from "shipped web SaaS" to "web + iOS + Android + Apple Watch + WearOS with full monetization (subs/seats/affiliate) + multi-mode ad network + in-house page builder + cookie/DSAR compliance"
**Researched:** 2026-05-13
**Confidence:** HIGH for Capacitor/Stripe/AdMob/Health Connect/RevenueCat/dnd-kit choices; MEDIUM for monorepo recommendation (genuine tradeoff space — Turborepo wins on ops complexity vs Nx winning on multi-language tooling); MEDIUM for the architectural firewall (Apple has not published a §5.1.3 "approved pattern" — recommendation is synthesis of community practice + privacy-manifest declarations).

> **Scope of this document.** This is the v1.2 STACK delta. The existing v1.1 stack — React 19, Vite 6, TypeScript strict, Tailwind v4, Zustand, framer-motion, chart.js, lucide-react, @use-gesture/react, Supabase (Postgres + Auth + RLS + Realtime + Edge Functions + Storage on project `ytnsipxxmzgaebkqmokp`), Anthropic via Edge Function proxy, Resend for transactional, Vercel hosting, Vitest + RTL + Playwright + Deno test, PostHog — **stays as-is**. This document specifies only the *new* surface needed for the eleven v1.2 workstreams. Versions verified via `npm view` against the live registry on 2026-05-13.

---

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| **Capacitor** | `@capacitor/core@8.3.4`, `@capacitor/ios@8.3.4`, `@capacitor/android@8.3.4`, `@capacitor/cli@8.3.4` | Native shell wrapping the existing Vite+React SPA for iOS + Android app-store distribution | Ionic's Capacitor 8 is the de-facto wrapper for shipping a web SPA as a native app in 2026. Capacitor 8 (released 2025-Q3) drops Cordova compatibility entirely, ships Xcode 16 + AGP 8.7 baselines, and lets the existing Vite build (`vite build`) feed straight into `npx cap sync`. Crucially: **no React Native rewrite, no second codebase.** The whole web app keeps shipping to `leanshot-app.vercel.app` and the same dist gets wrapped for App Store + Play Store. Plugin ecosystem (push, AdMob, in-app purchases, health, biometrics) is mature on v8. **Reject React Native and Expo:** would require porting ~50 components, the chart.js pharmacology canvas, and the Zustand/persist layer for zero v1.2 benefit. Reject PWA-only: App Store + Play Store distribution is non-negotiable per ROADMAP. |
| **RevenueCat (Capacitor SDK)** | `@revenuecat/purchases-capacitor@13.1.0` + JS SDK `@revenuecat/purchases-js@1.x` for web | Unified subscription billing across iOS (StoreKit 2), Android (Play Billing), and Stripe-on-web | **Required, not optional, for App Store / Play Store compliance.** Apple §3.1.1 mandates in-app purchase for digital subscriptions consumed inside the app — you cannot route iOS paid users through Stripe. RevenueCat absorbs StoreKit + Play Billing + their entitlement / receipt-validation / restore-purchases / cross-platform-entitlement machinery, and exposes a single typed API. Free up to $2.5K MTR, then 1% — cheaper than building receipt validation + dunning + restore flows ourselves. Webhooks land in a Supabase Edge Function and update a single `entitlements` row that powers the ad-free check, the clinic-seat check, and the affiliate-eligible check. |
| **Stripe (Connect + Web Subscriptions + Tax)** | `stripe@22.1.1` (server), `@stripe/stripe-js@9.5.0` + `@stripe/react-stripe-js@4.2.1` (browser) | (a) Web-only subscription checkout for browser-first patient signups, (b) clinic seat-based billing, (c) **Stripe Connect Express for affiliate payouts incl. hosted W-9 / W-8BEN / 1099 onboarding** | Two distinct integrations that share the same Stripe account: **Web Subs path** uses Checkout + Customer Portal (hosted, PCI-out-of-scope, dunning built in) for browser-acquired patients and for clinic-seat invoicing. **Connect Express** is the path for affiliate payouts — Stripe hosts the W-9/W-8BEN collection + 1099 filing flow inside their Express Dashboard, eliminating the entire IRS-form-design-and-file workstream from our scope. Connect Express also supports threshold-based collection (only collect W-9 when payout volume crosses the $600/yr IRS threshold) which is the right UX shape. **Anti-pattern to avoid:** rolling our own tax-form upload UI. |
| **AdMob via Capacitor Community plugin** | `@capacitor-community/admob@8.0.0` | iOS + Android in-app ads (banner, interstitial, rewarded) on the **free-tier patient mobile shell only** | Capacitor Community AdMob is the v8-compatible plugin (community-maintained, MIT, active). Sufficient for v1 ad-network needs. **Mediation:** AdMob's own mediation supports AdMob → Meta Audience Network → AppLovin MAX → others without us writing per-network code; configure in AdMob dashboard, not in app. Defer AppLovin MAX as a primary mediator (no maintained Capacitor plugin — would need a custom native bridge for v1.2). |
| **Google Ad Manager / AdSense (web)** | Loaded via standard `<script>` tag in marketing site + free-tier dashboard | Web banner + display ads on the marketing site and free-tier patient dashboard | No npm package needed for v1 — GPT (Google Publisher Tag) script + ad slots controlled via a small `AdSlot` React component that reads placement config from Supabase. AdSense + GAM 360 share the same publisher account. Lazy-load the GPT script behind cookie consent so it never fires before consent on EU traffic. |
| **Health (HealthKit + Health Connect, unified)** | `@capgo/capacitor-health@latest` | iOS HealthKit + Android Health Connect read-only import of weight / steps / sleep / heart rate | **Single plugin spans both platforms** with one TypeScript API. Capgo Health is actively maintained for Capacitor 8 (last release within last 12 months per registry), unified API, MIT. **Why this and not the alternatives:** `@perfood/capacitor-healthkit` is iOS-only and last released Feb 2025 (drifting toward stale); `capacitor-health-connect` is Android-only and last released Aug 2024 (genuinely stale). Maintaining two single-platform plugins is the wrong path when a unified one exists. Apple removed Google Fit support — Health Connect is the only Android destination. |
| **Apple Watch (SwiftUI)** | Xcode 16 + watchOS 11 SDK + Swift 6 + SwiftData (local cache) + WatchConnectivity (peer phone bridge) | Native watchOS companion app — next-dose, streak, log-injection complication | **Native Swift, not Capacitor.** Capacitor does not target watchOS. The watch app is its own Xcode target inside the iOS Capacitor project (Xcode lets you add a `Watch App` target to the wrapped iOS project). Data path: WatchConnectivity passes `next_dose` / `streak_count` as small JSON payloads from the iOS host. Reject cross-platform watch frameworks (KMP, Flutter watch) — too immature, too much added build complexity for a feature that's 3 screens. |
| **WearOS (Jetpack Compose)** | Android Studio (Iguana/Jellyfish) + Wear Compose 1.4 + Kotlin 2.0 + Tiles 1.4 + Complications Data Source API 1.1 | Native WearOS parity app | Same shape as watchOS — separate Gradle module inside the Android Capacitor project, talks to the host phone via the WearOS Data Layer API. Wear Compose is GA and the Jetpack-recommended toolkit. |
| **Push: dual web + native** | `web-push@3.6.7` (server, Web Push for browser/PWA) + `@capacitor/push-notifications@8.0.4` (FCM on Android, APNs on iOS) + Apple Push Notification Service certificate + Firebase Cloud Messaging | All four push channels: Web Push, APNs (iOS + watchOS), FCM (Android + WearOS) | The Capacitor plugin handles APNs + FCM uniformly through a single JS API; Web Push handles desktop browser + installed-PWA. Server-side: one Supabase Edge Function `push-dispatch` takes `{user_id, payload}` and fans out to whichever endpoints that user has registered. **Reject OneSignal / Pusher Beams** — both are perfectly fine but Supabase + Edge Functions are already the messaging plane and adding a third vendor is unnecessary cost + complexity. |
| **Page builder — dnd-kit** | `@dnd-kit/core@6.3.1`, `@dnd-kit/sortable@latest 8.x`, `@dnd-kit/utilities@latest 3.x` | In-house drag-and-drop landing-page builder (NOT a Puck wrapper) | dnd-kit is the modern drag-and-drop primitive layer — accessible (keyboard + screen reader), zero-dependency, tree-shakeable, React 19 ready. **Reject Puck (@measured/puck):** great product, but Puck is an *opinionated builder* with its own schema model and render path; once adopted, the builder is Puck's, not ours. Per ROADMAP v1.2 explicitly says "in-house drag-and-drop builder (NOT SaaS)" — that signals we want full control of the component palette, the persistence shape (Supabase row, not Puck JSON), and the SEO render path. dnd-kit gives the kinetics primitives, the component palette is our `src/components/page-builder/` directory, and the persisted shape is our Postgres rows. **Reject react-dnd:** no maintained release since the maintainer stepped back; HTML5 backend has known a11y holes. |
| **Cookie consent — vanilla-cookieconsent** | `vanilla-cookieconsent@3.1.0` | EU GDPR cookie banner + per-category consent (necessary / analytics / ads) | Plain-JS, ~6 KB gz, framework-agnostic (works fine inside a React app via a thin wrapper component), full granular categories, supports Google Consent Mode v2 (required for Google Ads + Analytics to keep working in EU), customizable to match design system. **Reject @osano/cookieconsent** — Osano's free SDK is gated behind a sign-up + their SaaS dashboard. **Reject CookieYes / Cookiebot SaaS** — recurring SaaS for a feature we ship once. |
| **DSAR portal — built in-house on Supabase** | (no library — Edge Function + React form) | EU GDPR Data Subject Access Request export + delete portal | DSAR is two paths (export-all-my-data, delete-everything) that already exist as Supabase patterns. Edge Functions `dsar-export` (returns ZIP of every row tagged `user_id = auth.uid()`) + `dsar-delete` (soft-delete with 30-day grace per GDPR Art 17, then hard-delete via scheduled job). **Anti-pattern: pulling in a SaaS DSAR vendor (DataGrail/OneTrust) for this scale.** |
| **Monorepo — Turborepo + pnpm workspaces** | `turbo@2.9.12` + `pnpm@latest` (already in use via package-lock.json migration recommended) | Coordinate web (`apps/web`) + Capacitor iOS shell (`apps/mobile`) + watchOS Xcode (`apps/watchos` — Swift, only referenced by Turbo, not built by Turbo) + WearOS (`apps/wearos` — Gradle, same) + marketing (`apps/marketing`) + shared (`packages/types`, `packages/ui-tokens`, `packages/page-builder-components`) | See "Monorepo recommendation" section below. **Short version:** Turborepo is the right pick because the *coordinable* surface (the parts Turbo actually builds + caches) is all TypeScript — web app, marketing site, page-builder package, types package. The Swift + Kotlin builds stay in their native toolchains and Turbo just sequences them via `task.shell`. Nx wins where multiple JVM/Python/Go languages need first-class graph awareness; we don't have that. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@capacitor/app@8.1.0` | latest 8.x | Lifecycle events (foreground/background, deep-link URLs) | Always — needed to gate ad-init on cold start and to route Stripe Connect deep-link returns. |
| `@capacitor/preferences@8.0.1` | latest 8.x | Native Keychain (iOS) / EncryptedSharedPreferences (Android) — **for non-Health data only** | All non-Health secrets (session refresh tokens, ad-network identifiers). **HealthKit data MUST NOT touch this.** See firewall section. |
| `@capacitor/haptics@8.0.2` | latest 8.x | Native haptics on log-injection success | Nice-to-have polish. Mobile-only. |
| `@capacitor/status-bar@8.0.2` | latest 8.x | Status-bar styling per route | Always on mobile builds. |
| `@capacitor/splash-screen@8.0.1` | latest 8.x | Splash control | Always. Replace with native launch storyboard before App Store review. |
| `@capacitor/share@8.0.1` | latest 8.x | Native share sheet for "share my doctor report" | Wire to existing SharePage flow. |
| `@capacitor/device@8.0.2` | latest 8.x | Device info (model, OS version) for analytics + bug reports | Always. Surface in PostHog `super_properties`. |
| `@capacitor/network@latest 8.x` | latest 8.x | Online/offline state — Zustand sync already handles this on web; mobile needs native detection | Wire into existing offline-queue logic. |
| `@capacitor-firebase/messaging` | `8.2.0` | Optional: richer FCM integration (topics, foreground notification UI) if `@capacitor/push-notifications` proves insufficient | Add only if `@capacitor/push-notifications` blocks on a need (e.g., topic subscriptions for clinic-wide announcements). Otherwise skip — extra Firebase config overhead. |
| `jspdf` | `3.1.0` | Affiliate payout statement + clinic invoice PDF generation (already known-good from research) | Already validated in v1.1 research as bundle-safe via dynamic import. Reuse pattern. |
| `react-hook-form` | `7.75.0` + `@hookform/resolvers` + Zod | Stripe Connect onboarding form, affiliate-program signup, page-builder property editors | Existing forms in v1.1 used controlled state; v1.2's form-density (Stripe Connect alone has ~10 fields) justifies adopting RHF. Tiny (~9 KB gz), works with the existing Zod validators. |
| `@stripe/react-stripe-js` | `4.2.1` | `<Elements>` provider + Stripe-hosted Element components for in-app card collection (if/when we move off Stripe Checkout) | Only if we need embedded card collection. v1 should use Checkout (hosted) and skip Elements entirely until we have a UX reason. |
| `vanilla-cookieconsent` | `3.1.0` | Cookie consent UI (mentioned above) | Always — required for EU launch. |
| `@types/web-push` | latest 3.x | TypeScript types for the `web-push` server library | Always when using `web-push`. |
| `firebase-admin` | latest 12.x | Server-side FCM dispatch from the Supabase `push-dispatch` Edge Function | Always — Apple's APNs and Google's FCM both have HTTP/2 APIs; firebase-admin is the standard Node wrapper for FCM HTTP v1. APNs uses `node-apn` or direct HTTP/2 via `http2` core module. |
| `node-apn` | latest 6.x | Server-side APNs dispatch — alternative to direct HTTP/2 | Use only if direct `http2` calls prove fragile. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| Xcode 16 | iOS + watchOS builds | Required for App Store submission. Apple Developer Program ($99/yr) needed. |
| Android Studio Jellyfish | Android + WearOS builds | Free. Google Play Console ($25 one-time) needed. |
| Fastlane | App Store + Play Store automated submission | Highly recommended — App Store Connect API + Play Console API are both annoying to wrangle manually. Fastlane has battle-tested lanes for both. |
| Capacitor Live Reload | `npx cap run ios -l --external` to hot-reload the wrapped SPA | Indispensable during mobile-shell development. |
| Charles Proxy / Proxyman | Inspect native HTTP from the wrapped SPA + Stripe + AdMob | Useful when AdMob ad requests + RevenueCat receipt validation interleave on cold start. |
| Stripe CLI | Webhook tunneling for local dev (`stripe listen --forward-to localhost:3000/api/stripe/webhook`) | Always when developing the Stripe integration. |
| AdMob Test Ad IDs | Use Google's official test ad unit IDs in dev, never real ones | https://developers.google.com/admob/ios/test-ads — accidentally using prod ad IDs in tests can get the account banned. |
| RevenueCat Sandbox + StoreKit Configuration File | Test in-app purchase flows without real money | Xcode 16 supports StoreKit configuration files; pair with RevenueCat's sandbox project. |

---

## Installation

```bash
# Capacitor core + iOS + Android
pnpm add @capacitor/core@^8 @capacitor/app@^8 @capacitor/preferences@^8 \
  @capacitor/haptics@^8 @capacitor/status-bar@^8 @capacitor/splash-screen@^8 \
  @capacitor/share@^8 @capacitor/device@^8 @capacitor/network@^8 \
  @capacitor/push-notifications@^8
pnpm add -D @capacitor/cli@^8 @capacitor/ios@^8 @capacitor/android@^8

# AdMob + Health (mobile-only, behind a build flag)
pnpm add @capacitor-community/admob@^8
pnpm add @capgo/capacitor-health@latest

# In-app purchases (subscriptions)
pnpm add @revenuecat/purchases-capacitor@^13

# Stripe (server uses @22, browser uses @9)
pnpm add stripe@^22                                      # Supabase Edge Functions
pnpm add @stripe/stripe-js@^9 @stripe/react-stripe-js@^4 # browser-side

# Web push
pnpm add web-push@^3 firebase-admin@^12   # server (Edge Function)

# Page builder primitives
pnpm add @dnd-kit/core@^6 @dnd-kit/sortable@^8 @dnd-kit/utilities@^3

# Forms (for Stripe Connect + affiliate signup + builder property editors)
pnpm add react-hook-form@^7 @hookform/resolvers@^3

# Cookie consent
pnpm add vanilla-cookieconsent@^3

# Monorepo tooling
pnpm add -Dw turbo@^2

# (jspdf already in v1 stack via dynamic import; keep)
```

---

## Architecture: how it fits with the locked v1.1 stack

```
                                    ┌──────────────────────────────────────────┐
                                    │  Monorepo (Turborepo + pnpm workspaces)  │
                                    └──────────────────────────────────────────┘
                                                       │
   ┌──────────────────┬──────────────────┬─────────────┴──────────────┬────────────────────┐
   ▼                  ▼                  ▼                            ▼                    ▼
apps/marketing    apps/web        apps/mobile (Capacitor 8)     apps/watchos          apps/wearos
(Vercel SPA)   (Vercel SPA —      ├── ios/  (Xcode)             (Xcode native)        (Gradle native)
                existing v1.1)    │     ├── App (wraps web)     SwiftUI + WatchConn   Compose + DataLayer
                                  │     └── WatchApp target ─── ▲                     │
                                  ├── android/ (Gradle)         │                     │
                                  │     ├── app (wraps web)     │                     │
                                  │     └── wear module ───────────────────────────── ▲
                                  └── ad-firewall.config.ts → isolates HealthKit
                                                                  │
                                                                  ▼
   ┌──────────────────────────────────────────────────────────────────────────────────────┐
   │ Supabase project ytnsipxxmzgaebkqmokp — Postgres + RLS + Storage + Realtime + Edge   │
   │                                                                                      │
   │  Existing (v1.1):  ai-chat, share, clinic-invite, clinic-photo, clinic-snapshot,     │
   │                    patient-activity, bulk-csv-export                                 │
   │                                                                                      │
   │  New (v1.2):       stripe-webhook        ← RevenueCat + Stripe webhook fan-out       │
   │                    stripe-checkout       ← create Checkout / Connect / Portal links  │
   │                    push-dispatch         ← fan-out Web Push + APNs + FCM             │
   │                    ad-config             ← serve ad placement config to clients      │
   │                    dsar-export           ← GDPR Art 15 ZIP export                    │
   │                    dsar-delete           ← GDPR Art 17 soft+hard delete              │
   │                    affiliate-attribution ← capture referral codes + attribute        │
   │                    page-render           ← SSR landing pages from builder rows       │
   │                                                                                      │
   │  Tables added:     entitlements, stripe_customers, stripe_connect_accounts,          │
   │                    affiliate_codes, affiliate_attributions, affiliate_payouts,       │
   │                    ad_placements, ad_provider_configs, ad_revenue_daily,             │
   │                    push_subscriptions, push_log,                                     │
   │                    landing_pages (jsonb tree), landing_page_revisions,               │
   │                    consent_records, dsar_requests                                    │
   └──────────────────────────────────────────────────────────────────────────────────────┘
                                                                  │
                                                                  ▼
   ┌──────────────────┬─────────────────────────────────────┬──────────────────────────────┐
   │ Stripe           │ RevenueCat                          │ AdMob / Google Ad Manager    │
   │  Subscriptions   │  iOS StoreKit 2 + Play Billing      │  iOS + Android (in-app)      │
   │  Customer Portal │  Cross-platform entitlements        │  Web (GPT script)            │
   │  Connect Express │  Webhook → stripe-webhook fn        │  ┌─── HealthKit firewall ──┐ │
   │   ├── W-9/W-8    │                                     │  │ no shared identifiers,  │ │
   │   ├── 1099       │ Resend (existing) → lifecycle email │  │ no Health in targeting  │ │
   │   └── Payouts    │   (welcome, dunning, milestone)     │  └─────────────────────────┘ │
   └──────────────────┴─────────────────────────────────────┴──────────────────────────────┘
```

**Local-first preservation.** All v1.2 additions sit *outside* the offline-critical write path. Capacitor wraps the existing SPA whose Zustand+localStorage+Supabase-Realtime sync is already proven. Stripe/RevenueCat/AdMob/Health are all online-gated features that gracefully degrade when offline (the patient can still log injections; only "manage subscription" and "import HealthKit weight" need network).

**Bundle posture.** v1.1's `sync-defer.ts` idle-deferred-init pattern is the *required* path for all new heavyweight SDKs. Concretely:
- Stripe.js loads via `loadStripe(pk)` lazily inside Checkout entry handler (~37 KB gz, never loads on home dashboard)
- AdMob plugin is mobile-only; tree-shake from web build via Capacitor's conditional registration
- RevenueCat plugin same — mobile-only
- GPT (ad script) loads only after cookie consent + only on pages with ad slots
- vanilla-cookieconsent loads first (it's the gate)
- dnd-kit only loads on the page-builder admin route — never on patient dashboard

**Existing bundle ceiling (v1.1: index gz 21.49 kB, 50 kB ceiling).** v1.2 must preserve this by gating *all* new web-side SDKs behind dynamic-import. The bundle CI guard from v1.1 stays as a hard gate.

---

## iOS HealthKit ↔ ad-SDK architectural firewall (Apple §5.1.3)

**The rule.** Apple Developer Program §5.1.3 (Health and Health Research) is a hard line: HealthKit data — even derived signals like "this user has read steps from HealthKit" — **must not be used to target ads, sold, or shared with third parties for advertising purposes**. Apple does not bless one specific architecture, but the App Store review team has rejected apps for things as subtle as "the same User Defaults bucket holds HealthKit-derived state and the ad SDK init flag." The firewall below is the most defensible synthesis of the public §5.1.3 guidance + the Apple Privacy Manifest requirements (PrivacyInfo.xcprivacy) + community-observed review patterns.

**Five-layer firewall:**

1. **Storage isolation.** HealthKit-imported data lives only in: (a) memory during the import session, then (b) Supabase Postgres rows tagged `source = 'healthkit'`. **Never** in `@capacitor/preferences`, **never** in `localStorage`, **never** in the Zustand persisted partition. The ad SDK's identifier-for-advertising (IDFA) + AdMob session state goes through `@capacitor/preferences` — a separate Keychain access-group from the rest of the app. **No identifier ever bridges the two storage planes.**
2. **Network identifier isolation.** The Supabase auth `user_id` is NOT sent to AdMob or any ad network. Ad requests use either no user ID (contextual targeting only) or a per-app-install random ID generated on first launch and stored ONLY in the ad-SDK Keychain access-group. RevenueCat gets the auth `user_id` (it needs it for entitlement lookups) but RevenueCat is not an ad network and does not see any Health-tagged row.
3. **Build-flag gating.** Ad SDK init is gated behind `Build.adsEnabled === true` and `entitlements.ad_free === false`. The init call sits in `apps/mobile/src/init/ads-init.ts`, which is the *only* file in the codebase that imports `@capacitor-community/admob`. Any other file that tries to import it fails ESLint via a `no-restricted-imports` rule:
   ```ts
   // eslint.config.js — under apps/mobile
   'no-restricted-imports': ['error', {
     patterns: [{ group: ['@capacitor-community/admob'], message: 'Import only from src/init/ads-init.ts' }]
   }]
   ```
4. **Code-path isolation.** The HealthKit import flow lives in `apps/mobile/src/health/` and imports `@capgo/capacitor-health`. The ESLint mirror rule blocks any cross-import: files under `src/health/**` cannot import from `src/init/ads-init.ts` and vice versa. This makes "did a HealthKit value flow into an ad request" a static-analyzable invariant, not a code-review judgment call.
5. **Privacy Manifest declarations (`PrivacyInfo.xcprivacy`).** The wrapped iOS app declares:
   - `NSPrivacyTracking` = `false` (we do not link user data with third-party data for advertising)
   - `NSPrivacyAccessedAPITypes` declared per API (UserDefaults reason, FileTimestamp reason, etc.)
   - `NSPrivacyCollectedDataTypes`: HealthKit categories declared as `NSPrivacyCollectedDataTypeLinked = false` (not linked to user identity at the ad-network level) and `NSPrivacyCollectedDataTypeTracking = false`
   - AdMob's IDFA usage declared with `NSPrivacyTrackingDomains` listing only the AdMob hosts (`googleads.g.doubleclick.net`, etc.)
   - When App Tracking Transparency permission is declined, AdMob falls back to contextual-only ads (configured in AdMob console, not in app code)

**Capacitor process model — addressing the "separate process" question from the prompt.** Capacitor on iOS runs the WebView and all plugins in the *same* process. You cannot literally fork the ad SDK into a separate process the way some Android approaches do. The defense in depth is therefore *logical* isolation (the 5 layers above) backed by code-search-able invariants (the ESLint rules), not OS-level process isolation. This is the same approach Apple-approved fitness apps with ad revenue use; the App Store reviewer reads code, not memory maps.

**What App Store review will check** (from observed rejections):
- Are HealthKit reads happening behind explicit user authorization? (Capacitor Health plugin handles this.)
- Is the HealthKit permission description in `Info.plist` accurate and user-facing-honest?
- Does the privacy manifest match actual SDK behavior?
- Can a reviewer trace a HealthKit read → ad targeting path? **Our answer: ESLint blocks the import; the path does not exist.** Mention this in the App Review notes field on submission.

---

## Monorepo recommendation: Turborepo + pnpm workspaces

The team needs to coordinate five build surfaces:

| Surface | Language | Build tool | Lives in |
|---------|----------|------------|----------|
| Marketing site | TS/React | Vite | `apps/marketing` |
| Patient web app | TS/React | Vite | `apps/web` |
| iOS Capacitor shell + watchOS | TS (web) + Swift (native) | Vite + Xcode | `apps/mobile/ios/` + `apps/watchos/` (Xcode project) |
| Android Capacitor shell + WearOS | TS (web) + Kotlin (native) | Vite + Gradle | `apps/mobile/android/` + `apps/wearos/` (Gradle module) |
| Shared types + ui tokens + page-builder palette | TS | tsc / Vite library | `packages/*` |

**Why Turborepo wins for *this* shape:**

1. **All Turbo-coordinated work is TypeScript.** The Swift + Kotlin builds are managed by their native toolchains (Xcode, Gradle); Turbo just invokes them via a `task.shell` entry. Turborepo's incremental caching shines on the TS surface, and the native surface doesn't need its graph awareness.
2. **Operational simplicity.** Turborepo is one config file (`turbo.json`), one daemon, one cache. Nx is one config (`nx.json`) + per-project configs + a generators system + executors — meaningful overhead for the value v1.2 actually needs.
3. **Remote caching.** Vercel's free remote cache works out of the box (the project already deploys to Vercel via the `leanshot-app.vercel.app` SPA). Nx remote caching needs Nx Cloud (free tier exists but adds a vendor).
4. **Migration cost.** v1.1's repo is currently a single-package npm project under `/leanshot`. Migrating to pnpm workspaces + Turborepo is a one-day refactor (move `src/` → `apps/web/src/`, hoist shared types into `packages/types`, add `turbo.json`). Migrating to Nx is a multi-day rewrite of the build orchestration.

**Why Nx might be right anyway:**
- If the team adds a Go or Python service (we won't in v1.2 — backend is Supabase Edge Functions, which is TS).
- If the team wants the Nx Plugins ecosystem for Capacitor / React Native / Expo (Nx has a `@nx/capacitor` plugin; Turborepo treats Capacitor as just another shell-task).
- If the team values Nx's affected-graph + visualization more than Turborepo's simpler model.

**Why separate repos is the wrong call:**
- Shared types (`Injection`, `User`, `Entitlement`) would have to be published as npm packages or duplicated. Both are friction.
- The page-builder palette will be consumed by `apps/marketing` (render path) and `apps/web` (admin builder UI) — they must share components, which a single repo makes trivial.
- Cross-cutting changes (e.g., "add an entitlement field that the web UI shows and the mobile shell respects") become 3 PRs across 3 repos instead of 1.

**Single concrete `turbo.json` for v1.2:**
```json
{
  "$schema": "https://turborepo.com/schema.json",
  "tasks": {
    "build":       { "dependsOn": ["^build"], "outputs": ["dist/**", ".vite/**"] },
    "test":        { "dependsOn": ["^build"], "outputs": ["coverage/**"] },
    "lint":        {},
    "typecheck":   { "dependsOn": ["^build"] },
    "cap:sync":    { "dependsOn": ["build"], "cache": false },
    "ios:build":   { "dependsOn": ["cap:sync"], "cache": false },
    "android:build": { "dependsOn": ["cap:sync"], "cache": false }
  }
}
```

---

## Page builder — why dnd-kit + in-house components

**Decision recap from CONTEXT.md / ROADMAP:** v1.2 explicitly says "in-house drag-and-drop builder (NOT SaaS)". This rules out Builder.io, Plasmic, Webflow, Framer-as-SaaS. The remaining question is **which DnD primitive layer**.

| Option | Verdict |
|--------|---------|
| **dnd-kit** | **Pick this.** Primitive layer for kinetics + a11y. Component palette is our code, persistence is our schema, render path is ours. Maximum control + minimum library cost (~10 KB gz). |
| Puck (`@measured/puck`) | Reject. Puck is a *full* builder framework, not a primitive. Adopting Puck means committing to Puck's JSON schema for landing pages, Puck's render pipeline, and Puck's extension model. Excellent product, but the explicit "in-house" requirement is at odds with Puck's value prop. |
| react-dnd | Reject. Last meaningful release 2024-Q4; HTML5 backend has known keyboard-a11y gaps; React 19 compatibility is community-patched not official. |
| react-beautiful-dnd | Reject. Atlassian deprecated this in 2024; React 19 incompatible. |
| Native HTML5 drag-and-drop | Reject. The page builder is the most touch-heavy surface in the app outside the body-photo workflow; HTML5 DnD has no touch support and miserable a11y. |

**Schema shape.** Each landing page is one Postgres row: `landing_pages { id, slug, title, tree jsonb, published_at, ... }`. The `tree` is a JSON tree of `{type, props, children}` nodes; each `type` maps to a React component in `packages/page-builder-components/`. Versioning via append-only `landing_page_revisions`. SEO render path is a Supabase Edge Function (`page-render`) that walks the tree and emits static HTML with the right meta tags + JSON-LD + OG.

---

## Stripe Connect path — Express, not Standard or Custom

| Variant | When | Verdict |
|---------|------|---------|
| **Connect Express** | Affiliates we onboard via our app; Stripe hosts the dashboard + tax forms | **Pick this.** Hosted onboarding (W-9 / W-8BEN), hosted 1099 generation + delivery, hosted payout calendar, hosted dispute flow. We expose a "View affiliate dashboard" deep-link button and Stripe handles the rest. Cost: 0.25% + $0.25 per active connected account per month + payout fees. |
| Connect Standard | Affiliates already have their own Stripe account | Skip for v1.2. Premature flexibility. |
| Connect Custom | We want to white-label the entire dashboard | Skip — this is an order of magnitude more compliance + UI work. |

**1099 path.** Stripe Connect Tax (a paid Connect addon, ~$2 per filed 1099) files the 1099-NEC / 1099-K for every affiliate that crosses the $600 IRS threshold. Forms appear in the affiliate's Express Dashboard by January 31. **We do not handle IRS filing ourselves.**

**RevenueCat vs Stripe for in-app subscriptions — final answer:**
- **iOS in-app purchases (App Store):** RevenueCat (which wraps StoreKit 2). Apple §3.1.1 prohibits Stripe for in-app digital subscriptions on iOS.
- **Android in-app purchases (Play Store):** RevenueCat (wraps Play Billing). Google §3.1.1 same prohibition.
- **Web subscriptions (browser-acquired patients):** Stripe Checkout directly. RevenueCat's web SDK is an option but it's a layer over Stripe for cross-platform entitlement tracking — adds value when you want a unified entitlement model.
- **Recommendation:** Route *all three* through RevenueCat (including web via their `purchases-js`). Single source of truth for `is_paid_user`, single webhook to handle, single restore-purchases flow. The 1% RevenueCat fee on web is the price of one entitlement model.
- **Clinic seat-based billing:** Stripe direct (Subscriptions + Customer Portal). RevenueCat is wrong-shaped for B2B seat billing — it's optimized for single-user consumer subscriptions.
- **Affiliate payouts:** Stripe Connect direct (RevenueCat does not do payouts).

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Capacitor 8 | **React Native (with Expo)** | Greenfield mobile-first project. Not us — we have a working web app that uses chart.js + framer-motion + Tailwind v4 + Zustand that would need a full RN port. Capacitor wraps existing SPA in days; RN would take 2-3 months. |
| Capacitor 8 | **PWA only (no native shell)** | If App Store / Play Store distribution were not required. Roadmap explicitly requires both stores. |
| Capacitor 8 | **Tauri Mobile** | Bleeding edge in 2026; iOS support landed mid-2025 but ecosystem is years behind Capacitor for App Store-critical things (StoreKit, AdMob, push). Pick in 3 years, not now. |
| RevenueCat | **StoreKit 2 + Play Billing direct (no RevenueCat)** | If you have a dedicated mobile engineer who wants to own receipt validation, restore-purchases, and subscription-state machine code. Saves 1% MRR; costs 2-3 weeks of engineering. Not worth it for a 1-engineer team. |
| RevenueCat | **Adapty** | Direct RevenueCat competitor, similar pricing, similar API. RevenueCat is the safer pick (larger ecosystem, more reference customers, better docs). |
| Stripe Connect Express | **PayPal Payouts** | If most affiliates are non-US (PayPal Mass Pay has better international coverage in some corridors). Loses the W-9/W-8/1099 hosted dance. |
| AdMob via Capacitor Community plugin | **AppLovin MAX direct (custom native bridge)** | When eCPM data shows MAX consistently beats AdMob mediation by >20% — only meaningful at scale (>50K DAU). Defer until measurable. |
| @capgo/capacitor-health | **@perfood/capacitor-healthkit + capacitor-health-connect (two plugins)** | If the Capgo plugin develops a blocking bug AND community-maintained alternatives become more current than `perfood` (Feb 2025) and `health-connect` (Aug 2024). Unlikely — those are the staler options. |
| dnd-kit | **Puck (@measured/puck)** | If "in-house" requirement softens. Puck is genuinely excellent. |
| dnd-kit | **Builder.io / Plasmic** | Never for v1.2 — explicitly out of scope per ROADMAP. |
| vanilla-cookieconsent | **CookieYes / Cookiebot** | If legal demands a managed-service vendor with audit logs and EU DPA on file. Costs $10-50/mo. |
| Turborepo + pnpm | **Nx** | If we add a non-TS service (Go / Python / Rust) in v1.2. We won't — backend is Supabase Edge Functions (TS). |
| Turborepo + pnpm | **Bun workspaces + Bun runtime** | Edge: Bun is great for dev speed but Supabase Edge Functions run on Deno, Capacitor's CLI assumes Node, and the React 19 + Vite + Tailwind v4 stack hasn't been pressure-tested on Bun's resolver yet. Adopt Bun in v1.3 after the cross-platform launch is stable. |
| Web Push + `@capacitor/push-notifications` | **OneSignal** | If non-engineers will author campaigns from a UI. OneSignal has the better marketer UX. Costs $9/mo+ at scale. Push is simple enough that we don't need it. |
| Web Push + `@capacitor/push-notifications` | **Knock** | If we need transactional + product workflows + in-app inboxes unified. Overkill for v1.2; revisit when "in-app inbox" becomes a requirement. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| **Stripe for iOS/Android in-app subscriptions** | Apple §3.1.1 + Google §3.1.1 — instant app rejection. Apple has gotten more aggressive in 2025-2026 about external-payment links (Epic ruling not withstanding). | RevenueCat for in-app subs; Stripe for web subs + Connect + clinic seats only. |
| **AdMob with any HealthKit-derived signal in the ad request** | Apple §5.1.3 — instant rejection + potential developer-program action. | Contextual-only ads; ESLint-enforced cross-import rule; ATT prompt declined → contextual fallback. |
| **`@perfood/capacitor-healthkit` (iOS-only) + `capacitor-health-connect` (Android-only)** | Two single-platform plugins, both getting stale (last release Feb 2025 / Aug 2024 respectively), doubled maintenance surface, two slightly different APIs to wrap. | `@capgo/capacitor-health` — one unified plugin. |
| **Capacitor 6.x or earlier (prompt assumed 6.x)** | Capacitor 8 (released 2025) drops Cordova back-compat, requires Xcode 16, requires AGP 8.7. Starting on 6 today means a major migration in 6 months. | Capacitor 8 from day one. |
| **react-dnd** | Maintenance stalled; HTML5 backend has keyboard-a11y gaps; React 19 compat unofficial. | dnd-kit. |
| **`react-beautiful-dnd`** | Atlassian deprecated 2024. Incompatible with React 19. | dnd-kit. |
| **`anthropic-dangerous-direct-browser-access: true` in the wrapped iOS app** | The header name is Anthropic's own warning. v1.1 already moved AI to the Supabase Edge Function proxy — preserve that posture; do not regress when adding the mobile shell. | Keep AI calls routed through `ai-chat` Edge Function. |
| **Bundling AdMob into the marketing site or clinic surfaces** | Roadmap explicitly forbids ads on clinic/doctor-share + marketing site uses display ads via GPT, not AdMob. AdMob is for the *mobile app's free-tier patient surface only*. | Web ads via standard GPT script; AdMob exclusively in `apps/mobile/`. |
| **OneSignal + Firebase + APNs as three parallel push backends** | Redundant. Each is a vendor relationship and another secret to rotate. | One Supabase Edge Function `push-dispatch` fanning out to Web Push + APNs (direct HTTP/2 or `node-apn`) + FCM (`firebase-admin`). |
| **Storing HealthKit-imported values in Zustand `persist`'d localStorage** | localStorage is plaintext; persists across sign-outs; trivially exfiltrated by any future XSS. For health data this is the wrong storage layer. | Postgres row tagged `source = 'healthkit'`, fetched on-demand via Realtime / Query; in-memory only on the client. |
| **Reusing the v1.1 `share` Edge Function for ad-config delivery** | Conflates two trust planes — share tokens are public + ad config is owner-internal. Cross-contamination risk. | New `ad-config` Edge Function with its own RLS and audit. |
| **Letting Stripe webhook events flow into the same `audit_logs` table as user actions without a discriminator** | Phase 7 migration audit-suppression GUC pattern (memory: `reference_supabase_migration_gotchas`) exists for a reason. Don't repeat. | Separate `stripe_webhook_events` table; `audit_logs` stays user-action-scoped. |
| **NPM workspaces (without pnpm or Turbo)** | NPM workspaces are functional but caching + dependency hoisting are weaker than pnpm; native-modules + Capacitor's CLI tends to break in NPM hoisting edge cases. | pnpm workspaces (better hoisting strategy + symlink layout) + Turborepo (caching). |
| **`@stripe/stripe-js@1.x` (transitively pulled by older deps)** | Old API surface; missing Payment Element + Checkout v2. | `@stripe/stripe-js@9` explicit dep. |
| **A SaaS DSAR vendor (OneTrust / DataGrail) for v1.2 launch** | $2K+/mo minimum; designed for hundreds of vendors-to-be-mapped which we don't have. Overkill at our scale. | Two Edge Functions (`dsar-export`, `dsar-delete`) + a React form. ~3 days work. |
| **Per-platform navigation libraries (React Native Navigation, Ionic React Router) in the Capacitor app** | Capacitor wraps the existing SPA; we already have client-side routing via the web router. Adding a second router would conflict. | Keep the existing web router; Capacitor's deep-link handler just opens the right URL inside the WebView. |

---

## Version Compatibility (verified 2026-05-13)

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `@capacitor/core@8.3.4` | `@capacitor/ios@8.3.4` + `@capacitor/android@8.3.4` | Major-version-locked: never mix v7 + v8 plugins. All `@capacitor/*` and `@capacitor-community/*` packages must be on matching majors. |
| `@capacitor/core@8` | Xcode 16 + iOS 14+ deployment target + AGP 8.7+ + minSdk 23 | Capacitor 8 bumped both floors. Lower deployment targets are unsupported. |
| `@capacitor-community/admob@8.0.0` | `@capacitor/core@8` | v8 plugin is the right major. v7 plugin will not register on v8 core. |
| `@revenuecat/purchases-capacitor@13.1.0` | `@capacitor/core@8` + iOS 13+ + Android API 24+ | RC 13 dropped iOS 12 support. |
| `@capgo/capacitor-health@latest` | `@capacitor/core@8` + iOS 15+ (HealthKit unchanged) + Android 14+ (Health Connect requires Android 14 or the standalone Health Connect APK on 13) | Health Connect on Android <14 needs user to install the standalone APK — surface this prompt in onboarding. |
| `stripe@22.1.1` (Node SDK) | Supabase Edge Functions (Deno runtime) | Stripe's Node SDK runs on Deno via `npm:` import or via `import Stripe from "https://esm.sh/stripe@22.1.1?target=deno"`. Test the import path in dev. |
| `@stripe/stripe-js@9.5.0` | React 19 + `@stripe/react-stripe-js@4.2.1` | Both have React 19 peer deps. |
| `@dnd-kit/core@6.3.1` | React 19 | DnD-kit explicitly supports React 19 since 6.2. |
| `vanilla-cookieconsent@3.1.0` | Framework-agnostic | Just a script + minimal wrapper. Tested with React 19. |
| `turbo@2.9.12` | Node ≥18 + pnpm ≥9 | Project's `package-lock.json` is npm-format today — migration to pnpm is required (one `pnpm import` command + commit). |
| `@capacitor/push-notifications@8.0.4` | Firebase iOS SDK (transitively pulled in via Cocoapods) | iOS needs APNs certificate uploaded to Firebase console; Android needs `google-services.json`. Don't commit either secret. |
| `web-push@3.6.7` | VAPID keys generated via `npx web-push generate-vapid-keys` | Keys go in Supabase secrets, not in browser source. |

**Known compatibility traps:**

1. **Vite 6 + Capacitor 8 dev mode.** `npx cap run ios -l --external` requires the Vite dev server to bind to `0.0.0.0` (not `localhost`) — already true in `vite.config.ts` (`host: true`). Verify before the first run on a physical device. iOS Simulator works on `localhost`.
2. **AdMob iOS 14.5+ SKAdNetwork.** Apple's SKAdNetwork attribution requires every ad-network ID to be listed in `Info.plist` under `SKAdNetworkItems` (~50 IDs as of 2026). AdMob publishes the current list; bake into the iOS Xcode project. Missing entries silently reduce fill rate.
3. **Health Connect Android 13 standalone APK.** On Android 14+, Health Connect is OS-bundled. On Android 13, users must install the Health Connect APK from Play Store. The Capgo Health plugin can detect and prompt for install — wire this into onboarding.
4. **WatchConnectivity background latency.** WC delivers messages "when convenient" — can be 5-30s delay when phone is asleep. The watch UI must not block waiting for fresh data; cache last-known `next_dose` in SwiftData and update opportunistically.
5. **Stripe webhook signature verification on Deno.** Stripe's Node SDK uses Node's `crypto` for signature verification; on Deno you must pass `crypto: Stripe.createSubtleCryptoProvider()` to the SDK constructor. Easy to miss; webhook will reject every event silently.
6. **RevenueCat sandbox + StoreKit Configuration File.** Local sandbox testing requires Xcode's StoreKit Configuration file AND a sandbox tester Apple ID. RevenueCat will not show purchases that bypass receipt validation; configure both.
7. **Resend domain still pending verification from v1.1 (memory: `reference_resend_phase9_wiring`).** v1.2 lifecycle email cadence amplifies the cost of an unverified domain — every welcome email could bounce. Domain verification is a Phase 0 prerequisite for v1.2.
8. **pnpm + Capacitor's iOS CocoaPods install.** Capacitor's iOS sync runs `pod install` which is independent of node_modules layout, so the npm → pnpm migration does not affect the iOS native install path. Android Gradle sync is similarly independent. Verified.
9. **Apple Privacy Manifest aggregation.** Every third-party SDK with a privacy manifest contributes to the aggregated app-level manifest. AdMob, RevenueCat, Stripe iOS SDK, Firebase Messaging — each ships their own `PrivacyInfo.xcprivacy`. Verify each is up to date before App Store submission; outdated manifests trigger rejection.

---

## Stack Patterns by Variant

**If we ship Apple Watch native only and defer WearOS to v1.3:**
- Skip the WearOS Gradle module; ship Apple Watch alongside iOS app
- Maintain `apps/wearos/` directory as `.gitkeep` placeholder so the monorepo shape is right
- Reduces v1.2 scope by ~1 platform's worth of native work, but loses parity narrative

**If RevenueCat is rejected on cost grounds:**
- iOS-only: roll StoreKit 2 + an `Entitlement` Edge Function that verifies receipts against Apple's `verifyReceipt` endpoint
- Android-only: roll Play Billing 7 + an `Entitlement` Edge Function that verifies via the Play Developer API
- Web: keep Stripe direct
- Three webhooks instead of one. Three subscription-state machines instead of one. 2-3 weeks more engineering.

**If marketing-only ad strategy (no in-app mobile ads):**
- Skip `@capacitor-community/admob` entirely
- Skip the App Tracking Transparency prompt
- Skip the SKAdNetwork Info.plist setup
- HealthKit ↔ ad firewall becomes moot (no in-app ad SDK to firewall)
- Loses ~$0.50-$2.00 ARPU per mobile DAU but eliminates Apple §5.1.3 risk surface entirely
- Defensible launch posture if the v1.2 mobile MVP wants to ship faster

**If team prefers single-repo (no monorepo) for v1.2:**
- Keep current `leanshot/` as the root
- Add `ios/` + `android/` as Capacitor's native targets (Capacitor adds them by default)
- Marketing site stays in a separate Vercel project (already is)
- Watch + WearOS still go in their own Xcode/Gradle projects but at repo root
- Defer monorepo until cross-cutting shared-package pressure becomes real

---

## Sources

**Live npm registry (HIGH confidence — versions verified 2026-05-13 via `npm view`):**
- `@capacitor/core` `8.3.4`, `@capacitor/ios` `8.3.4`, `@capacitor/android` `8.3.4`, `@capacitor/cli` `8.3.4`
- `@capacitor-community/admob` `8.0.0`
- `@capacitor-firebase/messaging` `8.2.0`
- `@revenuecat/purchases-capacitor` `13.1.0`
- `stripe` `22.1.1`, `@stripe/stripe-js` `9.5.0`, `@stripe/react-stripe-js` `4.2.1`
- `@capgo/capacitor-health` `latest` (actively maintained per registry timestamps)
- `@dnd-kit/core` `6.3.1`
- `vanilla-cookieconsent` `3.1.0`
- `turbo` `2.9.12`
- `web-push` `3.6.7`
- `@capacitor/push-notifications` `8.0.4`
- `react-hook-form` `7.75.0`
- `jspdf` `3.1.0`
- All `@capacitor/{app,preferences,haptics,status-bar,splash-screen,share,device,network}` on `8.x`

**Official docs (HIGH confidence):**
- [Capacitor 8 release notes](https://capacitorjs.com/docs/getting-started) — Xcode 16 / AGP 8.7 baselines
- [Stripe Connect — W-8/W-9 onboarding](https://docs.stripe.com/connect/connect-w8-w9-onboarding) — hosted tax-form collection
- [Stripe Connect — Deliver 1099 tax forms](https://docs.stripe.com/connect/deliver-tax-forms) — hosted 1099 filing
- [Apple — App Store Review Guideline §5.1.3 Health and Health Research](https://developer.apple.com/app-store/review/guidelines/#health-and-health-research)
- [Apple — Privacy Manifest files](https://developer.apple.com/documentation/bundleresources/describing-data-use-in-privacy-manifests)
- [Apple — App Store Review Guideline §3.1.1 In-App Purchase](https://developer.apple.com/app-store/review/guidelines/#in-app-purchase)
- [RevenueCat Capacitor SDK](https://www.revenuecat.com/docs/getting-started/installation/capacitor)
- [AdMob — SKAdNetwork IDs to add](https://developers.google.com/admob/ios/quick-start#update_your_infoplist)
- [Google Consent Mode v2](https://developers.google.com/tag-platform/security/guides/consent)
- [Capgo Health plugin docs](https://capgo.app/docs/plugins/health/) — unified HealthKit + Health Connect API
- [@capacitor-community/admob plugin](https://github.com/capacitor-community/admob)
- [dnd-kit docs](https://docs.dndkit.com/)
- [Turborepo docs](https://turborepo.com/docs)
- [Capacitor Push Notifications plugin](https://capacitorjs.com/docs/apis/push-notifications)
- [Apple watchOS — WatchConnectivity](https://developer.apple.com/documentation/watchconnectivity)
- [Wear OS — Compose for Wear OS](https://developer.android.com/training/wearables/compose)
- [vanilla-cookieconsent docs](https://cookieconsent.orestbida.com/)

**Web research, multi-source verified (MEDIUM confidence):**
- Capacitor 8 vs React Native vs PWA decision survey — multiple 2025-2026 comparison posts cross-checked against official Capacitor migration guide
- HealthKit ↔ ad-SDK firewall pattern synthesized from Apple §5.1.3 wording + Apple Privacy Manifest docs + community-observed App Store rejection threads (Reddit r/iOSProgramming, Apple Developer Forums) — Apple has not published a single "approved firewall architecture", so this is pattern synthesis not citation
- Stripe Connect Express vs Standard vs Custom — official Stripe docs + practitioner blog posts confirming Express is the right shape for affiliate-platform use cases
- Capgo Health plugin maintained status — verified via npm registry timestamps + GitHub repo activity (last commit within 90 days as of research date)

**Cross-checked against v1.1 LeanShot project memory:**
- Existing Supabase project + Edge Functions inventory — confirmed against v1.1 SHIPPED memory
- Bundle ceiling pattern (`sync-defer.ts`, 50 kB index cap) — preserved from v1.1
- Resend domain verification pending — flagged as v1.2 prerequisite per `reference_resend_phase9_wiring`
- Supabase migration gotchas (audit-suppression GUC, IMMUTABLE partial-index expressions, `extensions` in search_path) — apply to all new v1.2 migrations
- macOS BSD `sed` quirk + Vitest `it.fixme` quirks — preserved tooling rules for v1.2 dev

---

*Stack research for: LeanShot v1.2 — cross-platform launch + full monetization + ad network*
*Researched: 2026-05-13*
