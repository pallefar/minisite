# Architecture Research — LeanShot v1.2

**Domain:** Cross-platform consumer health SaaS (web + iOS + Android + watchOS + WearOS) with monetization (Stripe + ad network + affiliate) bolted onto an existing React 19 + Vite + Supabase + Vercel codebase.
**Researched:** 2026-05-13
**Confidence:** HIGH on existing-stack integration (we own the codebase); MEDIUM on Capacitor / Watch / page-builder shape (industry patterns); HIGH on the ad-firewall pattern (Apple §5.1.3 is a hard rule, not a tradeoff).

> **Read this first.** v1.2 is **not** an architecture rewrite. The existing v1.1 architecture (Zustand-store-as-truth, Supabase backend, Vercel SPA hosting, lazy-loaded tabs, single AI proxy, idle-deferred sync init) **stays**. This document describes (a) the **new components** that bolt onto it, (b) the **modifications** to existing components, and (c) the **integration points** between old and new. Anything not mentioned as "modified" or "new" stays as-is per `.planning/codebase/ARCHITECTURE.md`.

---

## Existing v1.1 Architecture (recap — DO NOT redesign)

```
┌────────────────────────────────────────────────────────────────────────┐
│  Vercel SPAs (static hosts)                                            │
│    • leanshot-app.vercel.app       — the app (Vite SPA)                │
│    • leanshot-marketing.vercel.app — marketing site                    │
└──────────────────────────┬─────────────────────────────────────────────┘
                           │  HTTPS
                           ▼
┌────────────────────────────────────────────────────────────────────────┐
│  Browser SPA (src/main.tsx → src/App.tsx)                              │
│    • state-driven view router (marketing / onboarding / dashboard /    │
│      clinic / doctor-share)                                            │
│    • Zustand store (src/lib/store.ts) — single source of truth         │
│      ├ partialize → localStorage `leanshot_v4` (offline-first)         │
│      └ sync-defer.ts → idle-deferred Supabase init (bundle guard)      │
│    • lazy-loaded tab/modal modules                                     │
└──────────┬───────────────────────────────┬────────────────────────────┘
           │ supabase-js (PostgREST + Realtime + Storage + Edge)
           ▼                               ▼
┌────────────────────────────────┐  ┌──────────────────────────────────┐
│  Supabase ytnsipxxmzgaebkqmokp │  │  Anthropic (proxied)              │
│  Postgres + RLS + Realtime +   │  │    via Edge Function ai-chat      │
│  Storage + 7 Edge Functions    │  │                                    │
│  (ai-chat, share,              │  │  Resend (Phase 9, domain pending) │
│   clinic-invite, clinic-photo, │  │    via Edge Function clinic-invite│
│   clinic-snapshot,             │  │                                    │
│   patient-activity,            │  └──────────────────────────────────┘
│   bulk-csv-export)             │
└────────────────────────────────┘
```

**Hard constraints inherited from v1.1 that drive every v1.2 decision:**
- Local-first: app must work offline; cloud is the sync layer, not the source-of-truth.
- Bundle index ceiling = 50 kB gz (currently 20.25 kB). Per-chunk ceilings via `assert-clinic-bundle-budget.sh`.
- Heavy SDKs MUST route through `src/lib/sync-defer.ts` idle-deferred-init wrapper. Direct static imports in App.tsx/main.tsx/store.ts are CI-blocked regressions.
- RLS isolation: every new table OR Storage bucket gets a live cross-tenant impersonation proof test.
- Realtime e2e assertions: use the receiving operator's `supabase-js channel.subscribe()` directly in the test, don't traverse UI.
- No ads on clinic / doctor-share surfaces (B2B trust). Ever.
- HealthKit data MUST NEVER reach ad targeting (Apple §5.1.3, hard fail review).

---

## v1.2 Target Architecture — Layered View

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Surfaces (NEW + EXISTING)                                                  │
│                                                                             │
│  Web SPA          iOS app           Android app       watchOS      WearOS   │
│  (existing)       (Capacitor)       (Capacitor)       (SwiftUI)    (Kotlin) │
│       │               │                  │                │           │     │
│       └───────────────┴──────────────────┘                │           │     │
│                  │ shared React bundle                    │           │     │
│                  │ + native bridges                       │           │     │
│                  ▼                                        │           │     │
│  ┌──────────────────────────────────────────────┐         │           │     │
│  │  Native bridge layer (NEW)                   │         │           │     │
│  │   src/lib/native/                            │         │           │     │
│  │   ├ health.ts     (HealthKit / Health Conn.) │         │           │     │
│  │   ├ ads.ts        (AdMob, gated)             │         │           │     │
│  │   ├ push.ts       (APNs + FCM)               │         │           │     │
│  │   ├ iap.ts        (App Store + Play Billing) │         │           │     │
│  │   ├ deeplink.ts   (universal links)          │         │           │     │
│  │   └ platform.ts   (capabilities feature flag)│         │           │     │
│  └──────────────────┬───────────────────────────┘         │           │     │
│                     │                                     │           │     │
└─────────────────────┼─────────────────────────────────────┼───────────┼─────┘
                      │                                     │           │
                      ▼                                     ▼           ▼
┌────────────────────────────────────────────────────────────────────────────┐
│  Zustand store (EXISTING, EXTENDED)                                        │
│   src/lib/store.ts                                                         │
│   + new slices: subscription, ads, affiliate, healthImport, designSystem,  │
│                 pageBuilder (operator-only)                                │
│   + partialize STILL excludes ephemeral UI; persisted slices add to        │
│     localStorage `leanshot_v4` (no version bump unless shapes change)      │
└──────────────────────────────┬─────────────────────────────────────────────┘
                               │  supabase-js (existing pattern)
                               ▼
┌────────────────────────────────────────────────────────────────────────────┐
│  Supabase backend (EXISTING, EXTENDED)                                     │
│                                                                            │
│  NEW tables:                                                               │
│   • subscriptions, subscription_events, stripe_customers                   │
│   • affiliates, affiliate_links, affiliate_conversions, payouts            │
│   • ad_placements, ad_impressions, ad_revenue_daily, ad_blocklist          │
│   • pages, page_versions, page_assets                                      │
│   • push_tokens, notification_log                                          │
│   • health_imports (metadata ONLY — see firewall section)                  │
│                                                                            │
│  NEW Edge Functions (each = one bounded responsibility):                   │
│   • stripe-webhook         — subscription + Connect + tax form events      │
│   • stripe-checkout        — create Checkout sessions + customer portal    │
│   • affiliate-attribute    — referral-code → user mapping at signup        │
│   • affiliate-payout       — Connect transfer trigger (admin-gated)        │
│   • ad-config              — per-placement targeting (NO health data)      │
│   • ad-revenue-ingest      — webhook from AdSense/AdMob → ad_revenue_daily │
│   • push-fanout            — single entry → APNs + FCM + Web Push          │
│   • page-render            — server-render published landing pages (SEO)   │
│   • account-delete         — cascade across Supabase + Stripe + Resend     │
│   • dsar-export            — GDPR data-subject access request bundler      │
│                                                                            │
│  NEW Storage buckets:                                                      │
│   • page-assets (public, RLS by owner_id)                                  │
│   • ad-creatives (admin-only)                                              │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## Component Responsibilities (NEW + MODIFIED)

### NEW components

| Component | Responsibility | Location | Talks to |
|-----------|----------------|----------|----------|
| **Capacitor shell (iOS)** | Native wrapper hosting the existing Vite SPA bundle in WKWebView | `apps/ios/` (new dir) or `ios/` if monorepo not adopted | Bridge layer |
| **Capacitor shell (Android)** | Native wrapper hosting the SPA in WebView | `apps/android/` | Bridge layer |
| **Native bridge layer** | Single TS module per native capability; web-build → no-op stubs, mobile-build → real plugin | `src/lib/native/*.ts` | Capacitor plugins |
| **Subscription slice** | Track tier, status, dunning, IAP/Stripe origin | `src/lib/store.ts` (extended) + `src/lib/subscription.ts` | `subscriptions` table + Edge Functions `stripe-checkout`, `stripe-webhook` |
| **Tier gate** | `requireTier('paid')` hook + component wrapper around premium features and ad blocks | `src/hooks/useTier.ts`, `src/components/billing/TierGate.tsx` | subscription slice |
| **Ad slot component** | Renders ad iff: tier=free AND surface ∈ allowed AND health-firewall passed | `src/components/ads/AdSlot.tsx` | `src/lib/native/ads.ts` OR web Ad Manager script |
| **Ad firewall guard** | Refuses to initialize any ad SDK if HealthKit perms ever requested; runtime + build-time | `src/lib/ads/firewall.ts` | `src/lib/native/health.ts` (read-only — query, never share) |
| **HealthKit/Health Connect importer** | Read-only import of weight/steps/sleep/HR; confirmation UI before write | `src/components/dashboard/import/HealthImportFlow.tsx` + `src/lib/native/health.ts` | Zustand store (existing slices: `weights`, `steps`) |
| **Watch app (Apple Watch)** | Native SwiftUI app — surfaces: next-dose, streak, log-injection complication | `apps/watch-ios/` (Swift) | WatchConnectivity for online sync, Supabase REST as fallback when iPhone unreachable |
| **Watch app (WearOS)** | Native Kotlin/Compose — same surfaces | `apps/watch-android/` | Wearable Data Layer + Supabase REST fallback |
| **Page builder (operator)** | Drag-and-drop editor producing JSON schema; ADMIN-ONLY route | `src/components/admin/PageBuilder/` (lazy, admin-bundle) | `pages` + `page_versions` tables, `page-assets` bucket |
| **Page renderer (public)** | Renders published JSON schema as marketing/landing page | `src/components/pages/PageRenderer.tsx` (separate bundle entry) | reads `pages` via Edge Function `page-render` (cached) |
| **Stripe Checkout entry** | "Subscribe" button → Edge Function → Stripe Checkout redirect | `src/components/billing/SubscribeButton.tsx` | `stripe-checkout` Edge Function |
| **Customer portal entry** | Manage / cancel / update card → Stripe Customer Portal | `src/components/billing/ManageSubscriptionButton.tsx` | `stripe-checkout` Edge Function (portal mode) |
| **Affiliate dashboard** | Partner-facing: link, clicks, conversions, payouts | `src/components/affiliate/AffiliateDashboard.tsx` (lazy) | `affiliates`, `affiliate_conversions`, `payouts` tables |
| **Owner/admin console** | Full overview: members, MRR, churn, ad revenue, impersonation, support | `src/components/admin/OwnerConsole.tsx` (lazy, admin-bundle) | every admin-RLS table + Edge Functions |
| **Push notification handler** | Token registration on app boot; foreground/background routing | `src/lib/native/push.ts` + `src/lib/notifications.ts` | `push_tokens` table, `push-fanout` Edge Function |
| **Account-deletion flow** | In-app deletion (App Store rule); cascade via Edge Function | `src/components/dashboard/settings/DeleteAccountFlow.tsx` | `account-delete` Edge Function |
| **GDPR consent banner** | Cookie consent for EU; gates ad SDK init | `src/components/legal/CookieConsent.tsx` | localStorage flag + ad firewall |
| **Design-system v2 tokens** | Geist/Fraunces/Geist Mono + refreshed colors/shadows | `src/index.css` (modified), `src/components/ui/*` (modified) | n/a — pure CSS variables |

### MODIFIED existing components

| Component | What changes | Why |
|-----------|--------------|-----|
| `src/main.tsx` | Add Capacitor detection + platform-specific bootstrap branches; add cookie-consent gate before any analytics/ads import | Multi-platform startup |
| `src/App.tsx` | Add `pageBuilder` / `pages/:slug` / `subscribe` / `affiliate` / `admin` view branches (still state-driven — no router) | New surfaces |
| `src/lib/store.ts` | Add `subscription`, `ads`, `affiliate`, `healthImport`, `pushTokens` slices; new actions; **DO NOT** add page-builder draft state (operator-only, lives in its own store module) | Domain extension |
| `src/lib/storage.ts` | New persisted keys (only those that should survive offline); STILL no `apiKey` in plaintext if we migrate AI to proxy-only | Persistence extension |
| `src/lib/sync-defer.ts` | Add new deferred modules: ads SDK, Stripe.js (web), affiliate tracker | Bundle ceilings — index stays ≤ 24.5 kB gz target |
| `vite.config.ts` | Add `manualChunks` entries for: `vendor-stripe`, `vendor-ads`, `admin-bundle`, `page-renderer` | CI bundle gate |
| Edge Function `ai-chat` | NEW: refuse if subscription tier ≠ paid AND free-tier AI quota exceeded; meter quota in subscription_events | Monetization gate |
| Supabase migrations | Add ~12 new migrations (subscriptions, ads, affiliate, pages, push, health_imports) | Schema additions |
| `index.html` | Capacitor meta tags, App Store icons, splash screen refs (kept in mobile build only); CSP updated for Stripe + ad domains | Native + monetization |
| Marketing site (`leanshot-marketing.vercel.app`) | Mounts the same `PageRenderer` to serve operator-authored landing pages; pricing page lives here | Page builder + Stripe entry |

### COMPONENTS THAT DO NOT CHANGE

- `src/lib/pharmacology.ts` — clinical math is stable.
- `src/lib/insights.ts` — rule engine stable.
- `src/components/dashboard/tabs/*.tsx` — core tracking tabs are content-stable (design tokens update; logic doesn't).
- `src/lib/share-card/*` — share-card templates already shipped.
- Existing Edge Functions `share`, `clinic-invite`, `clinic-photo`, `clinic-snapshot`, `patient-activity`, `bulk-csv-export` — leave alone.

---

## Critical Architectural Decisions

### 1. iOS HealthKit + Ad SDK Firewall (HARD REQUIREMENT)

**The rule:** Apple §5.1.3 forbids using HealthKit-derived data for advertising. Violation = guaranteed App Review rejection or post-ship pull.

**The pattern: Build-time SDK gating + runtime user-ID scoping + zero shared transport.** Named: **"Two-tunnel firewall."**

```
                       ┌────────────────────────────────────────┐
                       │  React app (single bundle, both modes) │
                       └──────┬──────────────────────┬──────────┘
                              │                      │
                              ▼                      ▼
   ┌──────────────────────────────────┐   ┌──────────────────────────────────┐
   │ Tunnel A — Health tunnel         │   │ Tunnel B — Ads tunnel            │
   │ src/lib/native/health.ts         │   │ src/lib/native/ads.ts            │
   │                                  │   │                                  │
   │ • imports only when feature flag │   │ • imports only when subs.tier=   │
   │   userOptedInToHealth = true     │   │   'free' AND consent given        │
   │ • writes to Zustand `weights`,   │   │ • initializes AdMob with          │
   │   `steps`, `sleep` (existing     │   │   tagForChildDirected=false,      │
   │   slices) — NEVER to a new       │   │   npa=1 (non-personalized) UNTIL  │
   │   `health` slice                 │   │   explicit consent flow runs      │
   │ • marks each value source=       │   │ • SDK receives ONLY:              │
   │   'healthkit' for audit          │   │     - device locale               │
   │ • health_imports table is        │   │     - NO user ID                  │
   │   metadata-only (count, last     │   │     - NO health value             │
   │   sync) — values stored in main  │   │     - NO injection data           │
   │   per-domain tables under RLS    │   │ • ad_config Edge Function targets │
   │                                  │   │   ONLY by: tier, platform, locale │
   └──────────────┬───────────────────┘   └────────────┬─────────────────────┘
                  │                                    │
                  └─────────── NEVER MEETS ─────────────┘
                              (firewall.ts asserts at init time)
```

**`src/lib/ads/firewall.ts` implementation contract:**

```typescript
// Single import-time guard. If any code path in src/lib/native/ads.ts
// imports from src/lib/native/health.ts (or vice-versa), an ESLint
// no-restricted-imports rule fails the build.
//
// Runtime guard: before AdMob.initialize(), assert that no HealthKit
// permission was ever granted on this device (read-only check, does NOT
// request permission). If granted, refuse init and log to Sentry.
//
// The audit pattern: every ad request includes a "non-health-data-only"
// assertion hash that ad-config Edge Function verifies before responding.
```

**ESLint rule (enforced):**
```js
// eslint.config.js
'no-restricted-imports': ['error', {
  patterns: [
    { group: ['**/native/health*'], message: 'Ads code MUST NOT import health.' },
    { group: ['**/native/ads*'],    message: 'Health code MUST NOT import ads.' },
  ],
  // applied only to files matching src/lib/native/ads/** + src/lib/native/health/**
}]
```

**Apple privacy manifest declarations:**
- `NSHealthShareUsageDescription` — health read-only.
- `PrivacyAccessedAPIType` declarations in `PrivacyInfo.xcprivacy` per Apple's May 2024 requirement.
- AdMob's manifest declares advertising tracking; LeanShot's manifest explicitly does NOT cross-link.

**Why not "Health Mode" toggle (option d):** Brittle; user can toggle mid-session and we'd have to tear down ad SDKs. Worse, the bundle still ships both, so an Apple reviewer's static analysis flags the shared transport.

**Why not separate WebViews (option a):** Capacitor v6 doesn't cleanly host two WebViews with shared Zustand; complexity not worth it when build-time + ESLint + runtime triple-guard is sufficient.

**Why not just runtime user-ID scoping (option c alone):** Doesn't satisfy Apple's static review; they want SDK-level isolation.

**Confidence: HIGH** (this is the canonical pattern other GLP-1 / fitness apps use; Apple reviewers look for SDK-import-graph isolation).

### 2. Watch ↔ Phone Sync — Hybrid (cloud-primary, WatchConnectivity for live)

**The pattern: Cloud-primary via Supabase + WatchConnectivity for low-latency live-context handoff.**

```
   Apple Watch (SwiftUI)              iPhone (Capacitor)             Supabase
   ┌─────────────────────┐            ┌──────────────────┐          ┌──────────┐
   │ next-dose card      │ ◀────────▶ │ Zustand store    │ ◀──────▶ │ injections│
   │ streak complication │  WC.session│ + sync-defer     │  realtime│ profiles  │
   │ log-injection action│  (live)    │                  │  (delta) │           │
   └─────┬───────────────┘            └──────────────────┘          └────┬─────┘
         │                                                                │
         │  Standalone fallback — Watch app has its own URLSession to     │
         │  Supabase REST endpoints (read-only) when iPhone unreachable.  │
         └────────────────────────────────────────────────────────────────┘
```

**Decision matrix:**

| Approach | Pro | Con | Picked? |
|----------|-----|-----|---------|
| Cloud-only (Supabase from watch) | Simplest; same RLS; works without phone | Battery cost; latency on cellular watches; complication updates slow | **Fallback only** |
| Phone-paired only (WatchConnectivity / Wearable Data Layer) | Lowest latency; live state stays in sync | Doesn't work standalone; watchOS-only; Apple is pushing standalone apps | **Live channel only** |
| **Hybrid (chosen)** | Live updates when paired; standalone when not; same RLS | Two code paths to maintain | ✅ |

**Sync ownership:**
- **Source of truth:** Supabase `injections`, `profiles`, derived `streaks` views.
- **Watch local cache:** Core Data on watchOS / Room on WearOS — read-cache + offline-log-queue.
- **Write path:** Watch tap "Log injection" → if iPhone reachable, send via WatchConnectivity to Capacitor app → Capacitor calls Zustand action → Supabase persist; if iPhone NOT reachable, watch directly hits Supabase REST with its own session token (refreshed via WC when last paired).
- **Read path:** Watch subscribes to a Supabase Realtime "user_id summary" channel via push (only the summary fields needed for complication, NOT raw data).

**Confidence: MEDIUM** — depends on watchOS authentication UX; alternative is "watch app is read-only + log-actions deferred to phone." That's the safer v1.2 floor if time-boxed.

### 3. Page Builder — Editor/Renderer Split

**The pattern: JSON-schema persistence, separate editor + renderer bundles, server-rendered for SEO.**

```
   Admin (page builder)                  Public visitor
   ┌──────────────────────┐              ┌──────────────────────────────┐
   │ Craft.js-based       │              │ leanshot-marketing.vercel.app│
   │ editor (admin only;  │              │ • visit /lp/{slug}           │
   │ lazy-loaded;         │              │ • Edge `page-render` fetches │
   │ admin-bundle chunk)  │              │   pages WHERE slug=$ AND     │
   │                      │              │   published=true             │
   │ Save → JSON schema   │              │ • Vercel ISR caches HTML 1h  │
   │ → POST /api/pages    │              │ • Hydrate <PageRenderer>     │
   │ → page_versions      │              │   for interactivity          │
   └─────────┬────────────┘              └──────────────────────────────┘
             │
             ▼
   ┌──────────────────────────────────────┐
   │ Supabase                              │
   │ pages         (slug, current_ver,     │
   │                published, owner_id)   │
   │ page_versions (page_id, version,      │
   │                schema_json, ts)       │
   │ page_assets   (Storage bucket)        │
   └───────────────────────────────────────┘
```

**Library choice: Craft.js (recommended)** — Apache-2 React-native framework that produces serializable JSON-schema state and is built for "build your own editor." GrapesJS is HTML/CSS-model-heavy and doesn't compose with React component palettes; the existing design system would not survive a GrapesJS DOM rewrite.

**Component palette = the existing design-system primitives** (`<Card>`, `<Button>`, `<HeroOrbital>`, `<Pill>`, etc.) wrapped in Craft.js's `useNode` HOC. This keeps editor output indistinguishable from a hand-coded LeanShot page.

**The renderer is NOT Craft.js.** Craft.js ships with editor weight; the public renderer is a pure recursive component that takes a JSON schema (`{type: 'HeroOrbital', props: {…}, children: […]}`) and renders the primitives directly. ~3 kB gz.

**Editor + renderer live in separate Vite bundles** via `manualChunks` (`admin-bundle` vs `page-renderer`). Public visitors never download Craft.js.

**Confidence: MEDIUM** — Craft.js community is healthy but smaller than GrapesJS. Acceptable bet because we own the UI layer.

### 4. Ad Serving — Hybrid (server-decides config, client-fetches creative)

**The pattern:**

```
   App boot                        Per ad slot render
   ┌──────────────────────┐       ┌──────────────────────────────────────┐
   │ ad-config Edge Func  │       │ <AdSlot placement="dashboard-rail"/> │
   │ returns:             │       │   ↓ reads ad config from store       │
   │ {                    │       │   ↓ if mode=admob → init plugin      │
   │   placements: {      │       │   ↓ if mode=adsense → inject script  │
   │     "dashboard-rail":│       │   ↓ if mode=house → render local SVG │
   │       { mode, network│       │ Reports impression to                │
   │         unit_id, freq│       │ ad_impressions table via debounced   │
   │         capped, ...} │       │ batch flush                          │
   │   },                 │       └──────────────────────────────────────┘
   │   user: { tier, blk }│
   │ }                    │
   └──────────────────────┘
```

**Why hybrid:**
- **Client-side direct (AdMob)** is unavoidable for native iOS/Android — Apple requires SDK-direct calls for in-app ads, IDFA prompts, etc.
- **Server-decides config** lets us A/B test networks, swap providers, apply frequency caps, enforce blocklist (no competing GLP-1 brands) without client redeploy.
- **Mediation** is at the config level, not the SDK level — we don't pay AdMob's mediation fees; our Edge Function does the routing logic.

**No ad on clinic / doctor-share surfaces:** `ad-config` Edge Function returns `{ placements: {} }` if user's active context is clinic/share. Belt-and-suspenders: `<AdSlot>` itself checks `currentSurface` before mounting.

**Confidence: HIGH** on the architectural shape; **MEDIUM** on exact AdMob/Google Ad Manager wiring (validate during execution).

### 5. Affiliate Attribution — Multi-source funnel

**The flow:**

```
   1. Visitor clicks https://leanshot-marketing.vercel.app/?ref=ALICE123
                ↓
   2. Edge middleware writes first-party cookie `leanshot_ref=ALICE123`
      (domain-scoped, 30-day, SameSite=Lax) AND localStorage key
                ↓
   3. Visitor clicks "Sign up" → leanshot-app.vercel.app
      → cookie domain mismatch! → relay via URL param on the redirect
      → app sets its own localStorage `leanshot_ref` on landing
                ↓
   4. Onboarding completes → Edge `affiliate-attribute`
      → looks up affiliate_links WHERE code=ALICE123
      → inserts affiliate_conversions row (user_id, affiliate_id, ts, status=pending)
                ↓
   5. User upgrades → Stripe Checkout
      → SubscribeButton passes referral via client_reference_id=ALICE123
        AND session metadata { referral_code, affiliate_id }
                ↓
   6. stripe-webhook on `customer.subscription.created`
      → updates affiliate_conversions.status=confirmed + stripe_subscription_id
      → schedules first commission ledger entry
                ↓
   7. Admin triggers affiliate-payout
      → Stripe Connect transfer to affiliate.connect_account_id
      → payouts table records payout_id + status

   MOBILE FALLBACK (iOS — install referrer is unreliable on iOS):
   - Share link is universal link → opens app if installed, else App Store
   - If App Store install: track via custom-product-page (CPP) campaign codes
     OR fall back to "enter referral code on first launch" UX
   - WearOS / Android Play Store: standard install_referrer broadcast
```

**Decision: Self-hosted attribution (Stripe metadata + our DB) NOT a third-party affiliate SaaS** (Rewardful / Tapfiliate / etc.). Reasons: (1) we already have user IDs in Supabase, (2) Stripe Connect for payouts is independent, (3) ad-network attribution (LeanShot is also an advertiser) flows through the same `affiliate_conversions` table with `source='paid'`.

**Confidence: HIGH** on web flow; **MEDIUM** on iOS install-referrer reliability (industry consensus: iOS attribution is unreliable, accept the loss for v1.2).

### 6. Repo + Build Structure — Stay Polyrepo+ (don't introduce Turborepo)

**Recommendation: KEEP the current single `leanshot/` Vite project. Add `apps/ios/`, `apps/android/`, `apps/watch-ios/`, `apps/watch-android/` as sibling Capacitor/Xcode/Android Studio projects sharing the built `leanshot/dist/` output.**

**Why not Turborepo / pnpm workspaces:**
- v1.1 architecture has one TS project with `@/*` alias. Refactoring to workspaces forces a rewrite of every import, breaks the existing CI bundle gates, and adds tooling that doesn't pay back for ~6 internal contributors.
- The "shared code" is ONE bundle that all 4 mobile shells embed. There's no second app sharing source.
- Watch apps are native (Swift/Kotlin) — they don't share TS code with the React bundle anyway.

**What CHANGES in the build:**
- New npm script `build:mobile` runs `tsc -b && vite build --mode mobile` which produces a `dist-mobile/` with Capacitor-friendly paths + sourcemaps inlined.
- `npx cap sync ios` + `npx cap sync android` from the `apps/ios/` + `apps/android/` shells point to that output.
- Vercel build still targets `leanshot/dist/` (web SPA).

**Confidence: HIGH** — Capacitor's standard pattern is exactly this (single web build, multiple shells).

### 7. Push Notification Routing — Single Edge Function fan-out

**Pattern:**

```
   Anywhere (server-side trigger)
   • cron job → "users with missed-dose"
   • patient action → "clinic operator follow-up"
   • Stripe webhook → "payment failed" dunning
                  │
                  ▼
   ┌──────────────────────────────────────┐
   │ Edge Function: push-fanout            │
   │ Input: { user_ids, template_id, vars }│
   │                                       │
   │ For each user_id:                     │
   │   SELECT * FROM push_tokens           │
   │   WHERE user_id=$ AND revoked=false   │
   │                                       │
   │   Group by platform:                  │
   │   • apns_token → APNs HTTP/2          │
   │   • fcm_token  → FCM HTTP v1          │
   │   • web_push   → VAPID push service   │
   │   • watch      → routed via phone     │
   │                                       │
   │   Log to notification_log table       │
   └──────────────────────────────────────┘
```

**Why one function, not four:**
- Templates live in one place.
- Quiet hours / frequency caps applied once per user, not per channel.
- Failover: if APNs fails but Web Push works, deliver via Web Push.
- Cost: Supabase Edge Function pricing is per-invocation, so one fan-out beats four.

**Watch as channel:** Apple Watch + WearOS notifications **piggyback on the phone's APNs/FCM token** (the OS automatically forwards). Direct watch tokens are only for standalone watch apps (deferred until WatchConnectivity-based shipping proves out).

**Confidence: HIGH.**

### 8. Account Deletion — Cascade Edge Function (App Store requirement)

**Pattern: One Edge Function (`account-delete`) owns the full cascade; user sees a single irreversible confirm UI.**

```
   User clicks "Delete account" in Settings
                ↓
   Type-to-confirm modal ("Type leanshot-delete-{lastfour}")
                ↓
   POST /functions/v1/account-delete
                ↓
   ┌──────────────────────────────────────────────────────────┐
   │ account-delete (SECURITY DEFINER on storage.objects)     │
   │                                                          │
   │ 1. Verify auth.uid() === payload.user_id                 │
   │ 2. SET app.suppress_audit = 'true'  (per migration rule) │
   │ 3. Cancel Stripe subscription (immediate)                │
   │ 4. DELETE FROM stripe_customers WHERE user_id=$          │
   │ 5. Cancel affiliate ledger (status='deleted')            │
   │ 6. DELETE Storage objects: photos/, page-assets/         │
   │ 7. Revoke Resend audience entries                        │
   │ 8. Revoke push_tokens                                    │
   │ 9. DELETE from app tables (RLS cascade handles tenant)   │
   │ 10. supabase.auth.admin.deleteUser(user_id)              │
   │ 11. Return { deleted_at, items_deleted: [...] }          │
   └──────────────────────────────────────────────────────────┘
                ↓
   Client clears localStorage, redirects to marketing site
```

**What is NOT deleted (legal/audit retention):**
- `audit_logs` rows (immutable per Phase 9 rule) — kept 7 yr with PII redacted to `user_id` only.
- Tax-relevant `payouts` rows — kept per 1099-K / Stripe Connect retention rules.
- Aggregate `ad_revenue_daily` rollups (no PII).

The deletion UI surfaces these retention exceptions transparently per GDPR.

**Confidence: HIGH** — this is well-trodden ground; the only risk is forgetting an integration (audit checklist in PITFALLS).

---

## Data Flow Diagrams

### Subscribe → Paid Tier (Web)

```
   <SubscribeButton tier="paid">
        ↓ click
   stripe-checkout Edge Function (creates Stripe Checkout session)
        ↓ returns session URL
   window.location → checkout.stripe.com/c/pay/cs_test_...
        ↓ user completes
   Stripe redirects → /return?session_id=...
        ↓
   stripe-webhook (async, parallel) receives customer.subscription.created
        ↓
   UPSERT subscriptions { user_id, tier, status, stripe_sub_id }
        ↓
   Realtime broadcast (existing pattern) → user's tab gets new subscription row
        ↓
   Zustand `subscription` slice updates → <TierGate> re-evaluates → premium UI unlocks
        ↓ (parallel)
   If client_reference_id present → INSERT affiliate_conversions
```

### Subscribe → Paid Tier (iOS)

```
   <SubscribeButton tier="paid">
        ↓ click
   Capacitor IAP plugin → StoreKit2 purchase flow
        ↓ Apple receipt
   Edge Function stripe-webhook-equivalent verifies receipt via App Store Server API
        ↓
   UPSERT subscriptions { user_id, tier, status, origin='ios_iap', apple_tx_id }
        ↓ (same as web from here)
```

Note: External-purchase link via Stripe is *permitted* per the May 2025 App Store ruling but requires Apple's external-purchase entitlement application. **v1.2 ships with App Store IAP as primary on iOS** (lower friction, no entitlement wait), Stripe web checkout for non-iOS, AND Stripe web checkout as opt-in for iOS users who go to web. Anti-pattern: don't try to do both inside the iOS app's UI — that's the line Apple still enforces.

### Health Import Flow

```
   User taps "Sync from Apple Health" in Settings
        ↓
   src/lib/native/health.ts requests HealthKit read perms (date range)
        ↓
   Capacitor plugin returns: { weights: [...], steps: [...], sleep: [...] }
        ↓
   Confirmation modal: "We found 42 weights, 30 days of steps. Import?"
        ↓ confirm
   Zustand `upsertWeight()` × N, `bulkSetSteps()` × M  (EXISTING actions)
        ↓ each marked source='healthkit'
   Supabase sync (existing supabase-js mirror) writes to weights/steps tables
        ↓
   health_imports inserts metadata row: { user_id, source, count, last_sync_at }
        ↓
   AD FIREWALL: ads.ts firewall guard now sees healthkit-source data exists
        → AdSlot mounts return null in any context that ever loaded health data
```

### Realtime — Watch Live Update

```
   iPhone Capacitor app: user logs injection
        ↓
   Zustand addInjection() → supabase.from('injections').insert()
        ↓
   Supabase Realtime broadcasts to channel `user:${user_id}`
        ↓ (web tab also receives, as today)
   Watch app (paired): iPhone forwards via WCSession.updateApplicationContext
        ↓
   Watch core data writes new "last dose" → complication refreshes
   
   If watch standalone (no iPhone): watch's own supabase-js channel.subscribe()
        directly receives the same broadcast and updates complication.
```

---

## Suggested Build Order (architectural-dependency-driven)

**The non-negotiable dependencies:**
- **Stripe** must ship before **paid-tier gating** which must ship before **ad firewall** which must ship before **AdMob init**.
- **Capacitor shell** must ship before **native push** which must ship before **watch apps** (watch needs paired-phone push fan-out).
- **Page builder data model** must ship before **page renderer** which must ship before **marketing redesign uses it**.
- **Health firewall + ESLint rule** must ship before **HealthKit importer** which must ship before **Health-Connect (Android) importer**.
- **Design system v2** is non-blocking parallel work (tokens-only changes).

**Recommended phase order:**

| Phase | Workstream | Why this order |
|-------|-----------|----------------|
| **A** | Design system v2 + v1.1 tech debt sweep | Cosmetic + cleanup; non-blocking; gives next phases a clean baseline |
| **B** | Monetization foundation (Stripe Checkout + subscriptions table + TierGate + Customer Portal) | Everything downstream gates on tier; cheapest to ship first |
| **C** | Page builder + landing pages + pricing page | Pricing page needs Stripe entry; marketing rebrand wants the new pages |
| **D** | Capacitor shells (iOS + Android, no native features yet — just wrap the web app) | Smoke-test the WebView; submit blank shells to TestFlight + Internal Track |
| **E** | Push notifications + account deletion + cookie consent + GDPR DSAR | Required for App Store submission AND for paid-tier dunning |
| **F** | Health firewall (ESLint + runtime guards + ads.ts stub) + HealthKit + Health Connect import | Firewall ships FIRST as code; importer ships SECOND |
| **G** | Ad network (AdSense web + AdMob native, both gated by firewall) | Now safe to init — firewall in place + tier gating in place |
| **H** | Affiliate program (Connect onboarding + dashboard + attribution + payouts) | Needs Stripe Connect activation; depends on subscriptions |
| **I** | Watch apps (Apple Watch + WearOS) + Health Connect parity | Depends on push fan-out + Capacitor IPC patterns |
| **J** | Owner/admin console | Depends on every other phase's data being present to surface |
| **K** | Onboarding revamp + Resend lifecycle emails + launch polish | Last — pulls together the new flows |

**Why design-system FIRST not LAST:** It's a tokens-only change (CSS variables in `index.css` + a few component tweaks). Doing it last means every other phase ships pre-rebrand UI and re-touches files. Doing it first means one merge, then all subsequent work is on the new tokens.

**Why monetization BEFORE Capacitor:** Stripe Checkout is web-only initially; gating logic is web-only initially. By the time Capacitor wraps the web app, the gating is already there to wrap. iOS IAP gets bolted on later as a parallel origin.

**Why ad firewall as code BEFORE AdMob plugin install:** The ESLint `no-restricted-imports` rule + the `firewall.ts` stubs + the `<AdSlot>` skeleton ship first (no SDK init). Phase G then drops in real AdMob/AdSense with the firewall already validating. Apple reviewers see import-graph isolation from day one.

---

## Anti-Patterns (v1.2-specific)

### Adding a router
**What:** Reaching for React Router because we now have "many surfaces."
**Why wrong:** The state-driven view router in `App.tsx` already works for v1.1's marketing/onboarding/dashboard/clinic split. Adding React Router forces every existing tab + modal to be re-keyed by URL, breaks the lazy-loading already in place, and burns ~15 kB gz on a feature we don't need.
**Do instead:** Keep state-driven routing for app surfaces. Marketing pages on `leanshot-marketing.vercel.app` use Vercel filesystem routing (separate site). The page builder's published pages are also on the marketing site under `/lp/[slug]`. The app SPA gets *one* new view branch: `pageBuilder` (admin).

### Putting builder draft state in Zustand
**What:** Treating the page-builder's editor state as another slice in the main store.
**Why wrong:** Editor state is large, transient, and admin-only. Putting it in the main store balloons localStorage, leaks admin-only data into non-admin builds, and trips the bundle gate (Craft.js pulled into the main bundle).
**Do instead:** Page builder has its own store (`src/components/admin/PageBuilder/store.ts`) using Zustand `create` without `persist`. Mount only when the admin lazy-route opens.

### Sharing Zustand actions across web + iOS + Android via native bridges
**What:** Designing native plugins to "call Zustand from native code."
**Why wrong:** Capacitor's bridge is JS-only — there's no Swift/Kotlin handle to Zustand. Trying to invert this introduces a slow round-trip and forces serialization that breaks references.
**Do instead:** Native code emits events (Capacitor Events API). JS layer (existing Zustand actions) listens. State flows native → event → JS action → store → React → render. One direction.

### Putting ads on B2B surfaces "just for testing"
**What:** A dev enables an ad slot on the clinic dashboard in a feature branch.
**Why wrong:** A single screenshot leaking to a clinic prospect kills the B2B trust story.
**Do instead:** `<AdSlot>` reads `currentSurface` from the store and returns `null` for clinic/doctor-share/admin. The check is in the component, the Edge Function, AND a CI test. Three layers, no exceptions.

### Trying to attribute iOS installs precisely
**What:** Investing weeks in iOS install referrer accuracy.
**Why wrong:** iOS install attribution is fundamentally broken (no install referrer broadcast; Apple's SKAdNetwork is delayed/aggregated). Industry accepts ~30% loss.
**Do instead:** Default to "enter your referral code on first launch" UX for iOS users; accept the leak. Don't over-engineer.

### Storing HealthKit-sourced values in a separate "health" slice
**What:** A new `healthData` slice mirroring HealthKit shape.
**Why wrong:** The whole point of the import is to land values in the existing `weights`/`steps`/`sleep` slices that the rest of the app already reads. A parallel slice means double-render-paths and divergence bugs.
**Do instead:** HealthKit import calls existing actions (`upsertWeight`, `bulkSetSteps`) and marks `source: 'healthkit'` on each row. Audit-only.

### Eager-loading native plugins
**What:** `import { AdMob } from '@capacitor-community/admob'` at the top of `App.tsx`.
**Why wrong:** Bundle gate fails on web build (and the SDK doesn't work in browsers anyway).
**Do instead:** All native plugins imported inside `src/lib/native/*.ts` which is itself dynamically imported only when `Capacitor.isNativePlatform() === true`. The web build tree-shakes these branches entirely.

### Skipping the ESLint firewall rule
**What:** "We'll just be careful not to import health into ads."
**Why wrong:** Code rot guarantees a leak within months.
**Do instead:** ESLint `no-restricted-imports` rule fails the build. Apple reviewers grep the bundle for these symbols — if they find both, you're rejected.

---

## Integration Points (Old ↔ New)

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Zustand store ↔ Subscription slice | Direct selectors (existing pattern) | New slice persists; gates on `s.subscription.tier === 'paid'` |
| App.tsx ↔ Capacitor shell | `Capacitor.isNativePlatform()` check at boot | Branches feature flags in `src/lib/native/platform.ts` |
| Edge Function ai-chat ↔ Subscription | New: query `subscriptions` before allowing call | Free tier gets N msgs/day, paid unlimited |
| Existing `share` Edge Function ↔ Ads | No change | Doctor-share never sees ads — guaranteed by surface check |
| `sync-defer.ts` ↔ New SDKs (Stripe.js, ads, IAP) | Add to deferred-init registry | Keeps bundle ceilings green |
| Zustand `upsertWeight` ↔ HealthKit importer | HealthKit plugin → confirmation UI → existing action | No new action; just a new caller |
| Realtime channels ↔ Watch apps | Watch subscribes to `user:${user_id}` channel (paired or standalone) | Same broadcast pattern as clinic operator surfaces |
| Stripe webhook ↔ Affiliate conversions | Edge Function `stripe-webhook` reads `client_reference_id` | Single linkage point — don't recompute |
| Page renderer ↔ Marketing site | Renderer is a separate Vite bundle entry deployed to marketing host | NOT loaded in app build |
| `account-delete` Edge ↔ everything | Cascade is centralized in ONE function | Every new integration adds a step to it (audit checklist) |

### External Services (NEW)

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Stripe | Edge Function (webhook + checkout); web Stripe.js for elements | API key in Supabase secrets; webhook secret rotation on Day 1 |
| Stripe Connect | Edge Function `affiliate-payout` triggers transfers | Tax-form collection via Stripe Connect-hosted onboarding |
| AdMob | Capacitor plugin (native only); never on web | Initialized lazily via firewall.ts; `npa=1` until consent |
| AdSense / Google Ad Manager | `<script>` tag injection via `AdSlot` (web only) | Domain verification via Search Console (admin task) |
| Apple HealthKit | Capacitor plugin `@perfood/capacitor-healthkit` (or `Cap-go/capacitor-health`) | Read-only; privacy manifest required |
| Health Connect (Android) | Capacitor plugin (same lib supports both) | Permission flow differs; same JS API |
| APNs | `push-fanout` Edge calls Apple Push HTTP/2 | Keys in Supabase secrets |
| FCM | `push-fanout` Edge calls FCM HTTP v1 | Service-account JSON in Supabase secrets |
| Web Push (VAPID) | Browser registers service worker → token to `push_tokens` | NEW: we need a Service Worker for the first time — bundle impact ~3 kB gz |
| Resend (existing) | Edge `clinic-invite` (existing) + new transactional templates | Domain verify still pending from Phase 9 — blocker |
| Sentry (or alternative) | `src/lib/observability.ts` (NEW) | PROD-02 carry-over; recommend Sentry web + native SDKs unified |

---

## Scaling Considerations

| Scale | Architecture adjustments |
|-------|--------------------------|
| **0-10k MAU** | Current Supabase free → Pro ($25/mo) sufficient. Vercel hobby → Pro for build minutes. AdMob/AdSense scale freely (their problem). Edge Function quotas comfortable. |
| **10k-100k MAU** | Move Edge Functions to dedicated regional deploy. Add Supabase read-replicas for clinic-snapshot and patient-activity. CDN caching on `page-render` (already plan). Consider Stripe webhook → SQS-like buffer (Supabase has no native equivalent; use a `webhook_queue` table + cron). |
| **100k+ MAU** | Split `audit_logs` to its own database (write-heavy). Move ad-impressions to a time-series store (Postgres TimescaleDB extension OR external). Push fan-out becomes the bottleneck — pre-aggregate into batched per-platform queues. |

**First bottleneck likely:** Realtime fan-out cost on clinic-snapshot tables when a clinic with 500 patients all log a dose in a 60s window. Phase 9 already mitigated this — keep an eye via the existing `roster-perf` CI gate.

**Second bottleneck:** Bundle size. Every new SDK (Stripe.js ~30 kB gz, ad SDK ~50 kB gz, IAP ~10 kB gz native-bridge-only) pressures the 50 kB index ceiling. `sync-defer` keeps index small but per-chunk ceilings will need bumps; budget that explicitly in Phase B and Phase G.

---

## Sources

- Existing v1.1 architecture: `.planning/codebase/ARCHITECTURE.md`, `.planning/codebase/STRUCTURE.md`, `.planning/codebase/INTEGRATIONS.md`
- LeanShot `CLAUDE.md` + memory notes (defer-then-batch-fix pattern, bundle-budget hash-hyphen bug, planner anti-patterns, Realtime e2e pattern, parallel executor isolation)
- [Capacitor Privacy Manifest documentation](https://capacitorjs.com/docs/v5/ios/privacy-manifest)
- [Apple — Adding a privacy manifest](https://developer.apple.com/documentation/bundleresources/adding-a-privacy-manifest-to-your-app-or-third-party-sdk)
- [Cap-go/capacitor-health](https://github.com/Cap-go/capacitor-health) — multi-platform HealthKit + Health Connect plugin
- [perfood/capacitor-healthkit](https://github.com/perfood/capacitor-healthkit) — iOS-only HealthKit plugin
- [Capacitor — Ads guide](https://capacitorjs.com/docs/guides/ads)
- [@capacitor-community/admob](https://github.com/capacitor-community/admob) — AdMob plugin and initialization flags (`tagForChildDirectedTreatment`, `npa`)
- [WatchConnectivity framework reference](https://developer.apple.com/documentation/watchconnectivity)
- [WWDC21 — There and back again: Data transfer on Apple Watch](https://developer.apple.com/videos/play/wwdc2021/10003/)
- [Craft.js — React drag-and-drop page editor framework](https://craft.js.org/)
- [Stripe documentation — Accept in-app purchases on iOS and Android](https://docs.stripe.com/mobile/digital-goods)
- [RevenueCat — App-to-web purchase guidelines after Epic v. Apple](https://www.revenuecat.com/blog/engineering/app-to-web-purchase-guidelines/)
- [Adapty — New U.S. ruling on external iOS payments (May 2025)](https://adapty.io/blog/new-us-ruling-on-external-ios-payments/)
- [Stripe affiliate attribution — client_reference_id + metadata pattern](https://www.promotekit.com/blog/stripe-affiliate-tracking-guide)
- [Branch — How mobile app install attribution works](https://www.branch.io/resources/blog/how-mobile-app-install-attribution-works-for-ios-and-android/)
- [Supabase — Use Supabase with iOS and SwiftUI](https://supabase.com/docs/guides/getting-started/quickstarts/ios-swiftui)

---

*Architecture research for: LeanShot v1.2 (Polished Launch + Full Monetization + Ad Network)*
*Researched: 2026-05-13*
