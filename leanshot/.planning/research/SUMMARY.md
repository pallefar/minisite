# Project Research Summary

**Project:** LeanShot v1.2 — Polished Launch + Full Monetization + Ad Network
**Domain:** Cross-platform health-adjacent SaaS (GLP-1/peptide tracker) — web + iOS + Android + Apple Watch + WearOS with subs/seats/affiliate + multi-mode ad network + in-house page builder
**Researched:** 2026-05-13
**Confidence:** HIGH overall — disagreements resolved at synthesis time; only 3 small open questions deferred to plan-phase

---

## Executive Summary

LeanShot v1.2 takes a shipped, mature web SaaS (v1.1: 11 phases / 76 plans / 35+ Supabase migrations / 7 Edge Functions, all live) into cross-platform distribution with full monetization. **The architecture is not a rewrite — it is a wrapping plus a set of new Edge Functions, tables, and components grafted onto the proven v1.1 Zustand-first / Supabase-backed / sync-defer-gated bundle.** The web SPA stays the source of UI truth; iOS and Android are Capacitor 8 shells over the same `dist/`; watchOS and WearOS are native Swift/Kotlin companions that piggyback on the paired phone's APNs/FCM. Monetization is a clear 4-vendor split that is forced by App Store / Play Store rules, not chosen for flexibility: **RevenueCat for iOS+Android in-app subscriptions, Stripe Checkout for web subs, Stripe direct for clinic seat billing, Stripe Connect Express for affiliate payouts** (with hosted W-9/W-8BEN/1099). Ads use **AdMob for native (mobile-only patient surface) + Google Ad Manager/AdSense on web (marketing site + free-tier dashboard)** with a strict architectural firewall keeping Apple HealthKit data away from every ad transport.

The recommended approach is **opinionated, not flexible.** Stripe-first build order (every other monetization workstream gates on the `tier` field). Capacitor wraps the existing SPA — no React Native rewrite. The page builder is **in-house dnd-kit primitives with the existing design-system as the component palette** — Craft.js was rejected at synthesis time because the project's own PROJECT.md says "in-house drag-and-drop builder (NOT SaaS)" and Craft.js' opinionated editor framework would absorb the persistence/render shape we want to own. Monorepo stays **polyrepo+ (single repo, sibling native shells)** — Turborepo's caching wins are not material when all coordinable work is already one TypeScript project, and the migration cost is real. The ad firewall combines static (ESLint `no-restricted-imports`) + runtime (firewall.ts assertion) + manifest (PrivacyInfo.xcprivacy) into one named pattern: **"Two-tunnel firewall."**

The single biggest risk vector is Apple App Review: §5.1.3 (HealthKit → ads) and §3.1.1 (in-app subs via Stripe) are both instant-reject lines, and v1.2 introduces both surfaces simultaneously. The plan mitigates by (a) building the firewall *as code* before any ad SDK is installed, (b) committing in CONTEXT.md to RevenueCat for iOS/Android IAP (no Stripe in-app), (c) account-deletion ≤3 taps with explicit cascade (including affiliate-ledger anonymization for IRS retention), and (d) Privacy Manifest declarations validated at build time. Second-biggest risk: Safari ITP killing 30-day affiliate cookies — addressed by mandatory server-side first-party cookie via the affiliate-attribute Edge Function. Third: bundle ceiling regression — every new SDK MUST route through the v1.1 `sync-defer.ts` pattern; CI bundle gate stays as hard block.

---

## Key Findings

### Recommended Stack

The v1.1 baseline (React 19 + Vite 6 + TS strict + Tailwind v4 + Zustand + Supabase + Vercel + Vitest/Playwright/Deno + PostHog) **stays exactly as-is**. v1.2 adds the cross-platform shell, four monetization vendors, two ad vendors, two health SDKs, and a handful of small libraries.

#### Final Stack Decisions Table (one row per category — disagreements resolved)

| Category | Decision | Rationale (terse) |
|---|---|---|
| **Native shell** | Capacitor 8 (`@capacitor/core@8.3.4`) | Wraps existing SPA. RN/Expo would force ~50 component port for zero benefit. |
| **iOS+Android IAP** | RevenueCat (`@revenuecat/purchases-capacitor@13.1.0`) | **Mandatory** — Apple §3.1.1 + Google §3.1.1 forbid Stripe for in-app digital subs. Disagreement #4 resolved. |
| **Web subs + clinic seats + affiliate payouts** | Stripe direct (`stripe@22.1.1` server, `@stripe/stripe-js@9.5.0` browser) | Web Checkout + Customer Portal for B2C/B2B; Connect Express for affiliate W-9/1099. |
| **Ad serving — mobile** | `@capacitor-community/admob@8.0.0` (mobile-only, free-tier patient surface only) | AdMob mediation handles network waterfall; never bundled in web build. |
| **Ad serving — web** | Google Ad Manager / AdSense via GPT `<script>` tag (lazy after consent) | No npm pkg; small `AdSlot` React component reads placement config from Supabase. |
| **Health SDK (iOS + Android)** | `@capgo/capacitor-health@latest` | **Single plugin spans HealthKit + Health Connect.** Reject perfood (iOS-only) + health-connect (Android-only) — both staler, doubled maintenance surface. |
| **Apple Watch** | Native SwiftUI (Xcode 16 + watchOS 11 + SwiftData + WatchConnectivity) | Capacitor doesn't target watchOS. Sibling Xcode target. |
| **WearOS** | Native Kotlin/Compose (Wear Compose 1.4 + Tiles 1.4) | Sibling Gradle module. |
| **Push (dual)** | `web-push@3.6.7` + `@capacitor/push-notifications@8.0.4` + APNs cert + FCM | One Supabase Edge Function `push-fanout` covers all 4 channels. |
| **Page builder primitives** | `@dnd-kit/core@6.3.1` + `@dnd-kit/sortable@^8` + in-house component palette | **Disagreement #2 resolved in favor of dnd-kit + in-house.** PROJECT.md says "in-house (NOT SaaS)" — Craft.js is an opinionated full builder framework that owns persistence shape; dnd-kit gives kinetics primitives, the palette is our `src/components/page-builder/` directory, persistence is our Postgres rows. |
| **Cookie consent** | `vanilla-cookieconsent@3.1.0` | Plain-JS, 6 kB gz, Consent Mode v2 support. Reject SaaS vendors. |
| **DSAR portal** | In-house (Edge Function + React form) | DataGrail/OneTrust overkill at this scale. |
| **Monorepo** | **Polyrepo+ (single repo, sibling native shells; NO Turborepo migration)** | **Disagreement #1 resolved in favor of Architecture's polyrepo+.** All Turbo-coordinable work is already one TS project; native shells use their own toolchains; migration cost (rewrite every `@/*` import, break CI bundle gates) outweighs caching benefit at 6-contributor scale. Revisit in v1.3 if a second TS app emerges. |
| **Forms** | `react-hook-form@7.75.0` + `@hookform/resolvers` + Zod | Justified by Stripe Connect form density (~10 fields) + builder property editors. |
| **PDF (DSAR + affiliate statements)** | `jspdf@3.1.0` via dynamic import | Reuse v1.1 pattern (Phase 7). |

#### Bundle posture (HARD constraint inherited from v1.1)

- Index gz target: **24.5 kB** (v1.1 closed at 21.49 kB; new SDKs land via `sync-defer.ts`).
- 50 kB index gz ceiling is the CI hard block.
- Every new SDK (Stripe.js, AdMob, RevenueCat, GPT, dnd-kit) routes through deferred-init.
- Per-chunk ceilings: stripe-elements, adsense-glue, page-builder-runtime, web-push, capacitor-bridge — each gets its own gz limit.
- **Phase-0 prereq:** Fix the `assert-clinic-bundle-budget.sh` hash-hyphen bug (`reference_bundle_budget_hash_hyphen.md`) before adding new per-chunk ceilings.

### Expected Features

#### Must-have (table stakes for "v1.2 GA")

- Stripe patient B2C subs (free + paid) — `tier='paid'` field unlocks ad-free + LeanShot-provided AI; gates every downstream monetization workstream
- Stripe clinic seat billing — per-active-patient with monthly true-up (recommended over per-operator)
- Capacitor iOS + Android shells wrapping the existing SPA
- Local push notifications: dose reminders + snooze + per-category settings + quiet hours
- HealthKit + Health Connect read-only import: weight + steps + sleep (HR is a differentiator, can wait)
- Lifecycle email via Resend — domain verify is a Phase-0 prereq carry-over from v1.1
- Owner/admin surface MVP (members table, MRR/churn, impersonation with audit-logged banner, refunds, feature flags)
- Ad network MVP — AdMob (mobile) + GAM/AdSense (web) on free-tier dashboard + marketing sidebar, with house-ad waterfall for unfilled inventory. Three placements only
- Affiliate program v1 — single-tier, manual approval, Stripe Connect Express, server-side cookie via Edge Function
- Page builder — 8 core blocks + 3 template starters + SEO panel + version history
- Apple Watch + WearOS — next-dose complication + log-from-watch + streak (Disagreement #5: full parity stays as binding scope)
- Account deletion in-app + cookie consent + DSAR portal (Apple §5.1.1(v) + GDPR launch-essential)
- Design-system v2 rollout

#### Should-have (differentiators)

- Background dose alarm with snooze (local notifications survive killed app — core mobile diff vs web bookmark)
- Watch: dose-day HR overlay + workout-day auto-tag
- Mid-trial paywall on pharmacology projection (test cautiously — could tank free engagement)
- House-ad waterfall keeps fill rate at 100% + drives upgrades
- Rewarded video ad format ($15-30 eCPM vs $5-8 interstitial)
- Adaptive dose-reminder timing (ML-light personalization)
- Affiliate co-branded landing pages (`/r/coachjane`) via the page builder
- Cancellation retention offer ("pause 1 month free")
- Doctor-share-summary email back to patient when doctor opens share link

#### Defer (v1.3+)

- Clinic-sponsored patient billing — wait for clinic demand
- HealthKit write-back — read-only at v1.2
- Multi-language i18n (Spanish first) — US-only launch
- Affiliate tiers (silver/gold/platinum) — wait for partner volume
- Page-builder block-level A/B testing
- Standalone watch mode (no iPhone required)
- Family / shared accounts (explicit PROJECT.md OUT)
- HIPAA BAA paid activation — stays "ready posture, not paid"

### Architecture Approach

#### Resolved Architectural Pattern Names

| Pattern | Name | Components |
|---|---|---|
| **HealthKit ↔ ad-SDK firewall** | **"Two-tunnel firewall"** | (1) Tunnel A: `src/lib/native/health.ts` writes only to existing `weights`/`steps`/`sleep` slices with `source='healthkit'`. (2) Tunnel B: `src/lib/native/ads.ts` is the only file importing AdMob; sees ONLY device locale + tier + platform; no user-id. (3) ESLint `no-restricted-imports` makes cross-import a static build failure. (4) Runtime `src/lib/ads/firewall.ts` asserts before AdMob.initialize() that no HealthKit perm was ever granted. (5) Apple Privacy Manifest declares HealthKit `NSPrivacyCollectedDataTypeLinked=false` + AdMob `NSPrivacyTrackingDomains`. Capacitor process model: WebView+plugins one process on iOS — defense is logical isolation, not OS process isolation. |
| **Page builder** | **"Editor/Renderer split with in-house dnd-kit"** | (a) Editor (admin-only, lazy `admin-bundle` chunk) uses dnd-kit primitives + existing design-system palette. (b) Persistence: one Postgres row per page (`landing_pages { id, slug, title, tree jsonb, published_at }` + append-only `landing_page_revisions`). (c) Renderer is pure recursive component (~3 kB gz), separate Vite bundle entry deployed to marketing host. (d) SEO via Edge Function `page-render` (static HTML + JSON-LD + OG meta at publish). |
| **Monorepo** | **"Polyrepo+ (single repo, sibling native shells)"** | Keep current `leanshot/` Vite project. Add `apps/ios/`, `apps/android/`, `apps/watch-ios/`, `apps/watch-android/` as sibling Capacitor/Xcode/Android Studio projects sharing built `leanshot/dist/`. New `build:mobile` script produces `dist-mobile/`. No Turborepo. |
| **Ad serving** | **"Server-decides config, client-fetches creative + hybrid mediation"** | (a) `ad-config` Edge Function returns per-user placement config keyed only by `{tier, platform, locale, currentSurface}` — NEVER health data. (b) Client `<AdSlot>` reads config + initializes provider (AdMob native / GPT web / house-ad SVG). (c) Frequency caps client-side via localStorage. (d) Surface gate: `<AdSlot>` refuses to mount on `/clinic/*`/`/share/*` (belt-and-suspenders with Edge Function + CSP). |
| **Watch ↔ phone sync** | **"Cloud-primary + WatchConnectivity for live"** | Hybrid: Supabase Realtime source of truth; WatchConnectivity low-latency live channel when phone reachable; watch falls back to direct Supabase REST when phone unreachable. |
| **Push fan-out** | **"Single Edge Function `push-fanout`"** | One entry takes `{user_ids, template_id, vars}` → groups by platform → APNs HTTP/2 + FCM HTTP v1 + VAPID Web Push. Quiet hours + frequency caps once per user, not per channel. Watch piggybacks on phone's APNs/FCM. |
| **Affiliate attribution** | **"Server-side first-party cookie via Edge Function + Stripe `client_reference_id`"** | Defeats Safari ITP. `leanshot.app/r/{code}` Edge Function 302-redirects with `Set-Cookie HttpOnly` (30-day TTL). Stripe Checkout passes `client_reference_id=cookie_value`. iOS fallback: "enter referral code on first launch". |
| **Account-deletion cascade** | **"Single Edge Function `account-delete` with explicit retention exceptions"** | One function: Stripe cancel + customer del + Connect del (queued if open payouts) + Resend audience del + push_tokens revoke + Storage del + RLS cascade + `auth.admin.deleteUser`. Retained per legal: `audit_logs` 7yr PII-redacted; `payouts` rows IRS retention; `affiliate_ledger` anonymized via `ON DELETE SET NULL` + hashed email — NEVER cascade-deleted. |

#### Major Components (NEW + MODIFIED)

| Component | Type | Location |
|---|---|---|
| Capacitor iOS + Android shells | NEW | `apps/ios/`, `apps/android/` |
| Native bridge layer | NEW | `src/lib/native/{health,ads,push,iap,deeplink,platform}.ts` |
| Subscription slice + `<TierGate>` | NEW | `src/lib/store.ts` (extended) + `src/components/billing/` |
| Ad firewall | NEW | `src/lib/ads/`, `eslint.config.js` |
| HealthKit/Health Connect importer | NEW | `src/components/dashboard/import/HealthImportFlow.tsx` |
| Apple Watch + WearOS native apps | NEW | `apps/watch-ios/` (Swift), `apps/watch-android/` (Kotlin) |
| Page builder + Page renderer | NEW | `src/components/admin/PageBuilder/`, `src/components/pages/PageRenderer.tsx` |
| 10 new Edge Functions | NEW | `stripe-webhook`, `stripe-checkout`, `affiliate-attribute`, `affiliate-payout`, `ad-config`, `ad-revenue-ingest`, `push-fanout`, `page-render`, `account-delete`, `dsar-export` |
| 14+ new Postgres tables | NEW | subscriptions, subscription_events, stripe_customers, affiliates, affiliate_clicks, affiliate_conversions, payouts, ad_placements, ad_impressions, ad_revenue_daily, pages, page_versions, push_tokens, notification_log, health_imports (metadata-only), consent_records, dsar_requests |
| Owner/admin console + Affiliate dashboard + Cookie consent + DSAR portal | NEW | `src/components/admin/`, `src/components/affiliate/`, `src/components/legal/` |
| main.tsx, App.tsx, store.ts, sync-defer.ts, vite.config.ts, index.html | MODIFIED | Platform detection, new view branches, new persisted slices, new manualChunks, CSP for Stripe + ad domains |
| Edge Function `ai-chat` | MODIFIED | Free-tier quota meter + tier gate |
| pharmacology.ts, insights.ts, tabs, share-card, existing 7 Edge Functions | UNCHANGED | Clinical math + share + clinic surfaces stay as-is |

### Critical Pitfalls — Top 10 with Phase Ownership

1. **HealthKit data leaks into ad targeting (Apple §5.1.3 — instant App Review reject).** Two-tunnel firewall. **Phases:** Health SDK owns implementation; Ad network owns audit checklist.
2. **Apple IAP commission ambush on iOS in-app subs.** Lock CONTEXT: RevenueCat for iOS+Android IAP, Stripe ONLY on web. **Phases:** Monetization owns policy; Mobile shells owns enforcement.
3. **In-app account deletion missing or routed to web page (Apple §5.1.1(v)).** ≤3-tap in-app flow + cascade Edge Function + typed-text confirm + 7-day soft-delete grace. **Phase:** Launch essentials owns UX; Monetization owns Stripe cascade; Admin owns affiliate-ledger anonymization.
4. **Cookie consent fires PostHog/AdSense/Pixel before opt-in (GDPR fines).** ALL third-party scripts via dynamic `import()` gated by consent category. **Phases:** Launch essentials owns consent; Ad network owns dynamic-load wiring.
5. **Bundle index gz ceiling breach when Stripe + AdSense + dnd-kit + push libs land same wave.** All new SDKs through `sync-defer.ts`; per-chunk ceilings; fix hash-hyphen bug in Phase 0. **Phases:** Phase 0 + Monetization + Ad network + Page builder + Launch essentials.
6. **Safari ITP kills 30-day affiliate cookies.** Server-side first-party cookie via `affiliate-attribute` Edge Function. **Phase:** Affiliate program.
7. **Account-deletion cascade orphans Stripe Connect + violates IRS 1099 retention via naive `ON DELETE CASCADE`.** `ON DELETE SET NULL` + anonymization. **Phases:** Monetization owns Stripe cascade; Affiliate owns ledger retention; Launch essentials owns DSAR composition.
8. **Capacitor WKWebView OOM crash on photo gallery (App Review stability fail).** Supabase Storage transforms + `react-virtuoso` virtualization. **Phase:** Mobile shells launch-gate.
9. **HealthKit / Health Connect silent fail due to missing `Info.plist` strings / intent filters.** Pre-flight checklist + physical-device smoke test. **Phase:** Health SDK + Mobile shells.
10. **PostHog/AdSense/Pixel fire on `/clinic/*`/`/share/*` — B2B trust violation + §5.1.3 risk.** Route-gated injection + CSP report-only + Playwright e2e. **Phases:** Ad network owns route-gated injection; Launch essentials owns CSP; Phase 0 owns Playwright clinic-ad-free gate.

---

## Implications for Roadmap

### Recommended Build Order — 12 Phases (0 through 11)

**Disagreement #3 resolution:** Reject Features' 8-phase paired structure. Use 11 workstream-as-phase phases + Phase 0 bootstrap + Phase 11 tech debt sweep (12 total), with intra-phase parallel plans via `git commit -- <pathspec>` per `feedback_parallel_executor_git_isolation.md`. NOT cross-phase pairings.

#### Phase 0 — Bootstrap & Bundle Foundations
**Rationale:** Fixes `assert-clinic-bundle-budget.sh` hash-hyphen bug; establishes per-chunk ceilings; sets up Two-tunnel firewall ESLint rule BEFORE any ad or health code is written; verifies Resend domain; provisions human-prereq accounts.
**Delivers:** Green CI bundle gate; ESLint cross-import rule active; verified Resend domain; Apple Dev / Play Console / AdMob / Stripe Connect provisioned.
**Addresses pitfalls:** 5, 14, 18, 31.
**Research flag:** Low.

#### Phase 1 — Design System v2 Rollout (PROJECT WS1)
**Rationale:** Tokens-only change FIRST means every later phase ships on new tokens.
**Delivers:** Geist + Fraunces + Geist Mono fonts subset (≤80 kB total); refreshed tokens; refreshed Cards/Button/Pill/Sidebar/SiteRotation; new illustrations bundle; marketing site visually current.
**Addresses pitfalls:** 30.
**Research flag:** Low.

#### Phase 2 — Monetization Foundation (Stripe web + clinic seats) (PROJECT WS6 first half)
**Rationale:** Keystone — every downstream gates on `subscriptions.tier`.
**Delivers:** `subscriptions` + `subscription_events` + `stripe_customers` tables; `stripe-checkout` + `stripe-webhook` Edge Functions; `<SubscribeButton>` + `<ManageSubscriptionButton>` + `<TierGate>`; pricing page; 7-day card-required trial; clinic seat billing (per-active-patient).
**Addresses pitfalls:** 21.
**Research flag:** Marginal (Stripe webhook on Deno signature verification).

#### Phase 3 — Page Builder + Landing Pages (PROJECT WS7)
**Rationale:** Independent of 4-10; needed for marketing pricing page. Sequenced before Capacitor.
**Delivers:** `landing_pages` + `landing_page_revisions` tables; `page-assets` Storage bucket; dnd-kit admin editor (lazy `admin-bundle` chunk); 8 semantic blocks; 3 templates; per-page SEO panel; `page-render` Edge Function with Vercel ISR; lint-at-save.
**Addresses pitfalls:** 11, 23, 29.
**Research flag:** Small (1-day Tailwind v4 + dnd-kit spike).

#### Phase 4 — Capacitor Mobile Shells (PROJECT WS2)
**Rationale:** Unblocks 5/6/9. RevenueCat IAP lands here (NOT Stripe — Apple §3.1.1).
**Delivers:** `apps/ios/` + `apps/android/` Capacitor 8 shells; native bridge stubs; RevenueCat integration; App Store + Play Store listing assets; `PrivacyInfo.xcprivacy`; Universal Links / Android App Links; in-app account deletion UI ≤3 taps; biometric unlock; Sentry Capacitor SDK; photo gallery virtualization; Storage image transforms.
**Addresses pitfalls:** 2, 3, 8, 9, 14, 19, 26.
**Research flag:** **HIGH** — App Store review pitfalls compound; recommend `/gsd-research-phase`.

#### Phase 5 — Push Notifications (PROJECT WS10 push portion)
**Rationale:** Depends on Phase 4 bridge.
**Delivers:** `push_tokens` + `notification_log` tables; `push-fanout` Edge Function; native push + Web Push; per-category settings; quiet hours; snooze; payment-failed dunning push; iOS PWA-install-detection + ≥16.4 gating with native APNs fallback.
**Addresses pitfalls:** 16, 25.
**Research flag:** Low.

#### Phase 6 — HealthKit + Health Connect Import + Firewall enforcement (PROJECT WS4)
**Rationale:** Firewall ships as code BEFORE ad SDK (Phase 8).
**Delivers:** `src/lib/native/health.ts`; `health_imports` metadata-only table; weight + steps + sleep auto-fill with pre-prompts + source-of-truth chooser; HR as InsightsTab context; dose-day HR overlay differentiator; `NSHealthShareUsageDescription`; Health Connect intent filters; physical-device smoke test.
**Addresses pitfalls:** 1, 9.
**Research flag:** Marginal (re-verify Capgo plugin).

#### Phase 7 — Affiliate Program + Stripe Connect (PROJECT WS8 + WS6 second half)
**Rationale:** Depends on Phase 2 + Phase 3 (co-branded landing pages).
**Delivers:** affiliates + affiliate_links + affiliate_clicks + affiliate_conversions + payouts tables; `affiliate-attribute` (server-side cookie defeats Safari ITP) + `affiliate-payout` Edge Functions; Stripe Connect Express + W-9/W-8BEN/1099-NEC; W-9 enforcement threshold ($500/30 days); partner dashboard; self-referral fraud detection; cookie-stuffing detection; 60-90 day chargeback hold; manual-review queue first payout; single-tier $10 flat at v1.2.
**Addresses pitfalls:** 6, 7, 12, 13.
**Research flag:** Small (Stripe Connect 2025-2026 UX walkthrough).

#### Phase 8 — Ad Network (PROJECT WS9)
**Rationale:** Depends on Phase 2 + Phase 6 (firewall) + Phase 10 admin (revenue dashboard).
**Delivers:** ad_placements + ad_impressions + ad_revenue_daily + ad_blocklist tables; `ad-config` + `ad-revenue-ingest` Edge Functions; `<AdSlot>` (refuses on `/clinic/*`/`/share/*`/admin); AdMob mobile-only gated by firewall; GPT lazy-loaded post-consent on web; AdSense fallback waterfall; house-ad system; rewarded video; 3 placements only; default GLP-1 advertiser block-list; ATT prompt before AdMob init; SKAdNetwork IDs; ads.txt + app-ads.txt.
**Addresses pitfalls:** 1, 4, 10, 14, 17, 27, 29.
**Research flag:** **HIGH** — AdMob+GAM+AdSense reporting ETL; recommend `/gsd-research-phase`.

#### Phase 9 — Watch Apps (Apple Watch + WearOS) (PROJECT WS3)
**Rationale:** Depends on 4+5+6; highest-effort/risk; sequenced near end. Per Disagreement #5: full parity per PROJECT.md; complication+log-only is named fallback.
**Delivers:** `apps/watch-ios/` (Swift+SwiftUI+WatchConnectivity+SwiftData); `apps/watch-android/` (Kotlin+Compose for Wear+Wearable Data Layer); next-dose complication/tile; streak indicator; log-injection with haptic; time-to-next-injection countdown; site-rotation suggestion on wrist; hybrid sync; standalone fallback; dose-day HR overlay.
**Addresses pitfalls:** 22.
**Research flag:** **HIGH** — new Swift + Kotlin surface area; recommend `/gsd-research-phase`.

#### Phase 10 — Owner/Admin + Lifecycle Email + DSAR + Cookie Consent (PROJECT WS5 + WS10)
**Rationale:** Depends on every prior phase's data; final cross-cutting "make it shippable" layer.
**Delivers:** `consent_records` + `dsar_requests` tables; `dsar-export` + `account-delete` Edge Functions (full cascade with affiliate-ledger anonymization + Stripe Connect deletion queueing + Resend removal); members table + search/filter; MRR/ARR/churn chart; user impersonation with red banner + audit log; refunds + sub-cancel override; feature flags; affiliate-payout review queue; ad-revenue dashboard (eCPM/RPM/CTR/fill rate); cohort retention heatmap; Resend lifecycle templates (welcome day-0, behavior-triggered onboarding, receipts, password reset re-skin, clinic-invite re-skin, affiliate payout monthly, re-engagement 7d, cancellation win-back +30d, milestone celebrations, doctor-share notification, weekly digest); vanilla-cookieconsent with Consent Mode v2; preference center + unsubscribe; CSP report-only on `/clinic/*` + `/share/*`.
**Addresses pitfalls:** 3, 4, 7, 10, 15, 18, 25, 28, 29.
**Research flag:** Marginal (DSAR contract-test pattern is novel).

#### Phase 11 — v1.1 Tech Debt Sweep + Launch Polish (PROJECT WS11)
**Rationale:** Final phase before launch — pure cleanup.
**Delivers:** CLINIC-07 operator drill-in "View activity" wiring; `s.user!` audit (15 occurrences / 14 files); photo trash flow; 6 deferred tests batch-fix; knip + ts-unused-exports CI gate; ASO assets final polish.
**Addresses pitfalls:** 31.
**Research flag:** Low.

### Phase Ordering Rationale

- Stripe first (Phase 2) — tier-gating universal precondition
- Design system before Capacitor — tokens-only change avoids re-touching components post-wrap
- Page builder before Capacitor — marketing site needs pricing page before App Store review checks marketing parity
- Health firewall before AdMob (Phase 6 before Phase 8) — non-negotiable, ESLint+runtime+manifest isolation must exist before any ad SDK bundles
- Watch last (Phase 9) — highest-effort, depends on phone+push+health stable
- Admin + Lifecycle email + DSAR together (Phase 10) — cross-cutting layer needs every other phase's data

### Research Flags

| Phase | Need research-phase? | Why |
|---|---|---|
| 0 | No | v1.1 infrastructure work |
| 1 | No | Tokens + components |
| 2 | Marginal | Stripe webhook on Deno; lock Checkout-vs-Elements |
| 3 | Yes — small | 1-day Tailwind v4 + dnd-kit spike |
| 4 | **YES — full** | App Store review pitfalls compound |
| 5 | No | Well-documented push patterns |
| 6 | Marginal | Capgo plugin maintenance re-verify |
| 7 | Yes — small | Stripe Connect Express 2025-2026 UI walkthrough |
| 8 | **YES — full** | AdMob+GAM+AdSense+house-ad+revenue ETL |
| 9 | **YES — full** | New Swift + Kotlin surface area |
| 10 | Marginal | DSAR export contract test pattern |
| 11 | No | Cleanup |

## Cross-Cutting Concerns

1. **Affiliate ledger × IRS 1099 retention vs GDPR deletion** — `ON DELETE SET NULL` + anonymization, NEVER `ON DELETE CASCADE`. Phase 7 + Phase 10 jointly own.
2. **No ads on B2B surfaces — TRIPLE-layered:** `<AdSlot>` component check + `ad-config` Edge Function + CSP report-only + Playwright e2e in Phase 0.
3. **Bundle ceiling 24.5 kB gz target, 50 kB hard ceiling.** Every new SDK via `sync-defer.ts`. Per-chunk ceilings in Phase 0.
4. **Two-tunnel firewall is cross-phase contract** between Phase 6 (implementation) and Phase 8 (audit).
5. **App Store Review Submission Checklist** — Phase 4 hard gate, Phase 8 + Phase 9 contribute (Pitfalls 1, 2, 3, 8, 9, 14, 17, 19, 26 + SKAdNetwork IDs).
6. **Resend domain verification is Phase-0 prerequisite** carry-over from v1.1.
7. **Capacitor process model** — WebView+plugins one process on iOS; defense is logical isolation, not OS process isolation. Surface in Phase 4 + Phase 6 + Phase 8 CONTEXT.md.

## Open Questions Deferred to Plan-Phase

1. **Clinic seat metering:** per-active-patient (synthesizer recommendation) vs per-operator-seat — lock at Phase 2 CONTEXT.md.
2. **Pharmacology projection paywall** at v1.2 GA or post-launch test — synthesizer recommends test in v1.2.x patches not GA; lock at Phase 2 CONTEXT.md.
3. **Page builder embed-provider blocks** (Calendly/YouTube/Tally) at v1.2 or separate follow-up — synthesizer recommends separate follow-up; lock at Phase 3 CONTEXT.md.

## Confidence Assessment

| Area | Confidence | Notes |
|---|---|---|
| Stack | HIGH | npm versions verified 2026-05-13; Apple §5.1.3 firewall is synthesis (Apple hasn't published one) — HIGH because synthesis matches observed App Review behavior |
| Features | HIGH | Apple/Google rules + Stripe/HealthKit constraints HIGH; MEDIUM on conversion specifics; LOW on AdMob+GLP-1 wording (block-list insulates) |
| Architecture | HIGH | v1.1 architecture owned/proven; new components follow canonical patterns |
| Pitfalls | HIGH | 31 pitfalls cross-verified vs Apple/Stripe/Google official docs + industry reporting + v1.1 memory |

**Overall confidence: HIGH**

---
*Research completed: 2026-05-13*
*Ready for roadmap: yes*
*Disagreements resolved: 6/6*
