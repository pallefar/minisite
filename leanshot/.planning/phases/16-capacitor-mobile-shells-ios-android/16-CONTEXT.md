# Phase 16: Capacitor Mobile Shells (iOS + Android) - Context

**Gathered:** 2026-05-15
**Status:** Ready for `/gsd-research-phase` (HIGH research flag per ROADMAP)

<domain>
## Phase Boundary

Wrap the existing LeanShot SPA in Capacitor 8 shells for iOS + Android. Fill the 6 native bridge stubs from Phase 12 (`src/lib/native/{platform,health,ads,push,iap,deeplink}.ts`) with real plugin implementations. Integrate RevenueCat for in-app subscriptions (Apple §3.1.1 + Google §3.1.1 mandate — Stripe forbidden for IAP). Ship to App Store + Play Store with full `PrivacyInfo.xcprivacy`, Play data-safety form, Universal Links + App Links, biometric unlock, WKWebView OOM mitigation, Sentry crash reporting, and native share sheet.

**In scope:** MOBILE-01..10 + MONEY-06 (11 REQ-IDs). RevenueCat IAP + Stripe-web tier reconciliation (MONEY-07 spans P16+P19; P16 ships the IAP-write half).

**Out of scope:** Push notification wiring (Phase 17), HealthKit/Health Connect integration (Phase 18), Ad SDK initialization (Phase 20), Watch apps (Phase 21), HomeKit / Siri / shortcuts (out of v1.2 entirely).

</domain>

<decisions>
## Implementation Decisions

### RevenueCat tier model + reconciliation
- **D-01:** RevenueCat shape = **1 entitlement `plus`** + **2 products** (`app.leanshot.plus.monthly` + `app.leanshot.plus.yearly`). Apple product IDs match this naming PERMANENTLY (Apple does not allow rename/reuse post-submission). Maps 1:1 to Phase 15's `checkoutPlan` enum + existing `STRIPE_PRICE_PLUS_MONTHLY` / `STRIPE_PRICE_PLUS_YEARLY` Supabase Function Secrets.
- **D-02:** Tier reconciliation lives at **DB level** via Edge Function writes + a `tier_effective` rule. New `revenuecat-webhook` Edge Function (companion to existing `stripe-webhook`) writes to the existing `subscriptions` table with `provider='revenuecat'`. Effective tier = `MAX(stripe.expires_at, revenuecat.expires_at) > now()`. Single source of truth; clinic operators can query directly.
- **D-03:** Apple StoreKit Product IDs = **reverse-DNS** (`app.leanshot.plus.monthly` + `.yearly`). Matches `app.leanshot.*` bundle ID namespace (D-10). PERMANENT — locked at first App Store submission.
- **D-04:** **Immediate downgrade** on RevenueCat CANCELLATION/EXPIRATION webhook. iOS user cancels via Apple Settings → `revenuecat-webhook` sets `expires_at = now()` → next tier check returns `free`. **Deliberate asymmetry with Stripe (which keeps grace period until period end).** Matches Apple's own subscription UX. Researcher to consider whether to normalize Stripe to immediate too — out of scope for P16.

### Capacitor 8 plugin set + biometric
- **D-05:** **Capacitor 8.x** pinned (matches ROADMAP). iOS 14+ minimum deployment target, AndroidX, plugin auto-registration. v7→v8 upgrade NOT needed.
  - **CORRECTION (RESEARCH override, 2026-05-15):** Capacitor 8 mandates **iOS 15.0** (not 14.0) per capacitorjs.com/docs/updating/8-0, Node 22+, Android minSdk 24 / targetSdk 36, Xcode 26.0+, SPM default. All plans implement iOS 15.0 per R1 in `16-RESEARCH.md` §"Standard Stack" and `16-01-capacitor-scaffold-spm-audit-ios-15-PLAN.md` Task 2. iPhone 12 (OOM-soak target) is iOS-15-capable so this does not narrow the support matrix beyond what was scoped.
- **D-06:** Biometric plugin = **`@capgo/capacitor-native-biometric`** (matches the @capgo plugin family already chosen for Phase 18 `@capgo/capacitor-health` — consistent maintenance posture). FaceID + TouchID + Android Biometric in one plugin. ~10k weekly downloads, v8-ready.
- **D-07:** **Full plugin set committed (14 plugins).** Every entry triggers a `PrivacyInfo.xcprivacy` declaration (D-18):
  - Core (11): `@capacitor/core`, `/cli`, `/ios`, `/android`, `/app`, `/preferences`, `/share` (MOBILE-10), `/splash-screen`, `/status-bar`, `/haptics`, `/browser`
  - QoL (2): `@capacitor/keyboard`, `@capacitor/network`
  - Future-ready (2): `@capacitor/filesystem` (offline export, deferred to v1.3 but plugin installed), `@capacitor/clipboard` (upgrade over `navigator.clipboard`)
  - IAP (1): `@revenuecat/purchases-capacitor` (MONEY-06)
  - Biometric (1): `@capgo/capacitor-native-biometric` (MOBILE-07)
- **D-08:** Photo gallery OOM mitigation stack = **react-virtuoso + Supabase Storage transforms**. **REQUIRES upgrading Supabase project `ytnsipxxmzgaebkqmokp` from Free → Pro tier (~$25/mo) BEFORE iOS submission** (per `reference_phase15_research_findings`, Storage transforms are Pro-only). Without transforms, raw PNGs OOM at 50+ photos on iPhone 12 (4GB RAM).

### Universal Links + bundle ID strategy
- **D-09:** AASA + assetlinks.json published on **BOTH `leanshot.app` AND `app.leanshot.app`** hosts. Max coverage; Universal Links resolve from either origin. PRECONDITION: `leanshot.app` DNS must be live + `.well-known/apple-app-site-association` accessible BEFORE App Store submission (Phase 12 vendor carry-over).
- **D-10:** Bundle IDs **split per-platform**: `app.leanshot.ios` + `app.leanshot.android`. Allows independent submission cycles, separate per-store analytics, per-platform Privacy Manifest. RevenueCat dashboard + Sentry projects require distinct IDs cross-platform anyway. PERMANENT.
- **D-11:** Deep-link route map = **all 4 categories open in-app when installed**: auth (`/signin|/signup|/reset-password|/verify-email`), share (`/share/{token}`), clinic (`/clinic/{slug}|/clinic-invite/{token}`), marketing (`/pricing|/|/faq|...`). Marketing in-app is intentional for UX continuity from email links.
- **D-12:** Web asset source = **Hybrid bundled fallback + Capacitor Live Updates (Capgo OTA)**. Initial app launches load bundled SPA. On non-monetization paths, Capgo Live Updates (~$15-30/mo) pushes JS/CSS OTA without re-submission. Monetization paths (auth, IAP, pricing) ALWAYS use bundled assets (Apple §4.7 + §3.1.1).
- **D-13:** **Risk mitigation for D-11 + D-12** (Apple §3.1.1 + §4.7 review risk): Plan-phase MUST add (a) platform-aware `/pricing` rendering — iOS app shows RevenueCat IAP button NOT the Stripe `<a href="/#/settings?upgrade=...">` deep-link from Phase 15; (b) Capgo Live Updates SDK scoped via a path allowlist that excludes auth + pricing + IAP routes; (c) submission-response template ready if Apple flags either.

### Build pipeline + release cadence
- **D-14:** Build CI = **fastlane + GitHub Actions**. `fastlane match` for code-signing sync. `fastlane gym` (iOS) + `fastlane gradle` (Android). macOS runner for iOS builds (~$0.24/min × 10 min). Reproducible across machines.
- **D-15:** Soak period = **7-day TestFlight + 3-day Play Internal** before public store promotion. Apple TestFlight catches ~80% of native crashes in 7-day window per Apple's own retention data. Regulator-audience requires conservative cadence for first submission.
- **D-16:** Signing-key custody = **`fastlane match` private GitHub repo (`leanshot-fastlane-match`) + 1Password Vault backup** of FASTLANE_PASSWORD + distribution cert. Lost-key recovery path documented. STANDARD industry pattern.
- **D-17:** Sentry coverage = **Capacitor SDK + native Sentry Cocoa + native Sentry Android** (max coverage). dSYM upload via Sentry CLI in fastlane. ~~Reuses existing Sentry project from Phase 1 with separate releases tagged `ios@<version>` / `android@<version>`.~~ ⚠️ **SUPERSEDED 2026-05-16 — see `16-CONTEXT-ADDENDUM-sentry-per-platform-projects.md`** — three separate projects under org `optimizenet` on `de.sentry.io`: `leanshot-web` / `leanshot-ios` / `leanshot-android`. Per-platform release tags still apply inside each project. Phase-1 leanshot project never existed (premise of D-17 was wrong).

### Privacy Manifest + ASO assets
- **D-18:** PrivacyInfo.xcprivacy = **Hand-crafted from the 14-plugin inventory in D-07**. Each plugin's GitHub README's privacy-manifest section is the source of truth. Apple maintains the canonical required-reason API list. ~2-3 hours one-time work; auditable; re-verified at every plugin upgrade.
- **D-19:** Store screenshots = **Playwright-captured device-viewport screens + designer overlay** in Figma/Pencil. Viewports: iPhone 15 Pro Max 6.7", iPhone 14 6.1", iPad Pro 12.9", Pixel Phone, Pixel Tablet, Wear OS. ~6-8 hours setup + ~2 hours per refresh. Reproducible on UI changes.
- **D-20:** v1.2 store listing locales = **EN + ES + DE + FR** (top 4 GLP-1 markets). Adds ~25-30 hours store-copy translation + screenshot localization to Phase 16 scope. **SCOPE EXPANSION — flag for plan-phase + research-phase estimate.**
- **D-21:** App Store preview video = **hand-recorded screen capture on real iPhone via QuickTime + iMovie cut to 30s + caption overlays**. ~3-4 hours. Per-locale audio is optional (silent video with caption overlays works for all 4 locales — saves localization cost).

### Cross-platform tier sync edge cases
- **D-22:** Trial-already-used policy = **Block 2nd trial**. If user has `stripe_trial_used=true`, RevenueCat shows ONLY paid product (no 7-day intro). Uses RevenueCat's "offer eligibility" API. Honest; prevents trial-stacking.
- **D-23:** iOS app `tier` display = **honest unified `MAX(...)` view**. iOS user with active Stripe-yearly + cancelled iOS sees `tier='paid'` in the iOS app (sourced from web sub). Apple Settings shows them as no-longer-subscribed — explanatory copy may help.
- **D-24:** Clinic-owner IAP visibility = **Hidden** on iOS. If `user.role` includes `clinic_owner`, iOS IAP UI is replaced with `'Clinic billing is managed at leanshot.app/clinic/billing'` link. Apple §3.1.1 nuance: this is "subscription managed elsewhere for a service the app uses" — needs careful review-response messaging.
- **D-25:** Tier-flip propagation = **Realtime via Supabase Realtime channel** (`subscriptions:user_id=eq.X`). Web session subscribes; RevenueCat webhook write fires the row update → web app flips `tier` in ~2-5 seconds. Matches Phase 9/10 Realtime patterns.

### Claude's Discretion
- WatchKit handoff hooks within iOS app shell — defer to Phase 21 planning; do not pre-stub watch bridges in Phase 16.
- Per-locale store-copy translation vendor — researcher/planner decides between DeepL API, ChatGPT-assisted, or hired translator based on quote estimates.
- React-virtuoso `Virtuoso` vs `VirtuosoGrid` choice for photo gallery — planner decides based on existing Photo tab UI.
- Capgo Live Updates rollout strategy (% rollout, version pinning, rollback triggers) — planner decides.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 12 (Two-tunnel firewall + native bridge stubs)
- `leanshot/.planning/phases/12-bootstrap-bundle-foundations/12-CONTEXT.md` — D-01 (native bridge dir convention), D-02 (firewall zones), D-05 (AdMob+AdSense deferred to Phase 20 entry condition)
- `leanshot/eslint.config.js` — current `import-x/no-restricted-paths` zones for `src/lib/native/{ads,health,...}`
- `leanshot/src/lib/native/{platform,health,ads,push,iap,deeplink}.ts` — 6 throw-stubs Phase 16 fills

### Phase 13 (Design tokens)
- `leanshot/.planning/phases/13-design-system-v2-rollout/13-CONTEXT.md` — DS-NN token map (already shipped; native app reuses unchanged)
- `leanshot/src/index.css` — `@theme` tokens (Geist + Fraunces + Geist Mono fonts; will need Capacitor preload)

### Phase 14 (Monetization foundation — Stripe web)
- `leanshot/.planning/phases/14-monetization-foundation-stripe-web-clinic-seats/14-CONTEXT.md` — `subscriptions` table shape, `provider` enum, `tier` field semantics
- `supabase/migrations/2026031*_subscriptions*.sql` — schema Phase 16's RevenueCat webhook writes to
- `supabase/functions/stripe-webhook/index.ts` — pattern Phase 16's `revenuecat-webhook` mirrors
- `supabase/functions/stripe-checkout/index.ts` — Phase 16's IAP UI must NOT call this on iOS (D-13)

### Phase 15 (Page builder + /pricing)
- `leanshot/src/lib/page-builder/pricing-page-content.ts` — `PRICING_PAGE_BLOCKS` + `PRICING_PAGE_SEO`; the IAP-platform-fork in D-13 lives here OR adjacent
- `leanshot/src/App.tsx` — `selectViewLogged` + `?upgrade=` handler (Phase 16 platform-aware fork lands here)

### v1.2 milestone-level
- `leanshot/.planning/REQUIREMENTS.md` — MOBILE-01..10 + MONEY-06 + MONEY-07 (cross-platform tier)
- `leanshot/.planning/ROADMAP.md` §"Phase 16" — goal + 5 Success Criteria + dependencies
- `leanshot/.planning/PROJECT.md` — Tech-stack constraints (React 19 + Vite 6 + Tailwind v4 + Zustand)
- `leanshot/.planning/research/SUMMARY.md` — v1.2 cross-phase synthesis (HIGH flag on Phase 16 App Store review pitfalls)

### Project memory (must-read before planning)
- `feedback_aggressive_foundations.md` — user prefers max-coverage on foundation phases (confirmed by 21/25 max-coverage picks)
- `feedback_regulator_vs_user_audience_pattern.md` — Apple+Google reviewers = regulator-audience (trim where it touches them); end-users = max-coverage
- `feedback_vendor_account_circular_dependency.md` — Phase 12 carry-overs (Apple Dev, Play Console) must be ready BEFORE plan-phase
- `reference_supabase_edge_function_deploy.md` §3 — gateway Content-Type/CSP override (RevenueCat webhook should return JSON only; HTML responses break)
- `project_phase15_shipped.md` — F1 carry-over (Edge gateway MIME override) + F2 (Resend domain — may also affect IAP receipt emails)

### Vendor docs (researcher will fetch via WebFetch/Context7)
- RevenueCat: https://www.revenuecat.com/docs/getting-started/installation/capacitor
- Capacitor 8 migration: https://capacitorjs.com/docs/updating/8-0
- Apple App Review Guidelines §3.1.1: https://developer.apple.com/app-store/review/guidelines/#in-app-purchase
- Apple App Review Guidelines §4.7 (third-party software): https://developer.apple.com/app-store/review/guidelines/#design
- PrivacyInfo.xcprivacy required-reason APIs: https://developer.apple.com/documentation/bundleresources/privacy_manifest_files

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/native/{platform,health,ads,push,iap,deeplink}.ts` — 6 throw-stubs from Phase 12 ready to be filled with Capacitor implementations
- `src/lib/page-builder/pricing-page-content.ts` (Phase 15) — pricing-block source for the iOS platform-aware fork (D-13)
- `src/App.tsx` `?upgrade=` handler — already routes to Stripe Checkout on web; Phase 16 adds RevenueCat branch when `detectPlatform() !== 'web'`
- `supabase/functions/stripe-webhook/index.ts` — pattern + Edge Function gateway quirks (no JSON-Content-Type-override needed for webhook responses) for new `revenuecat-webhook`
- `src/lib/store.ts` Zustand store + Supabase Realtime patterns from Phase 9/10 — `subscriptions:user_id=eq.X` channel subscription for D-25
- Existing Sentry DSN + project from Phase 1 — reused with separate `ios@X.X.X` / `android@X.X.X` releases (D-17)

### Established Patterns
- ESLint `import-x/no-restricted-paths` firewall (Phase 12 D-02) — Phase 16 plugin implementations stay isolated per zone
- Service-role JWT for fixture test users (Phase 15 deferred RLS-fixture rewrite) — Playwright e2e for IAP flow uses this pattern instead of `signInWithPassword`
- Capacitor build outputs ship as Vite `dist/` bundle copied into `apps/ios/` + `apps/android/` — capacitor.config.ts `webDir: 'leanshot/dist'`
- Reverse-DNS bundle ID + product ID convention (D-03, D-10) — consistent with `app.leanshot.app` SPA URL

### Integration Points
- New file `src/lib/native/biometric.ts` (Phase 16 adds; firewall zone TBD by planner — likely Zone 0 "shared shell")
- New file `supabase/functions/revenuecat-webhook/index.ts` (mirrors stripe-webhook)
- New file `capacitor.config.ts` at repo root (defines `webDir`, `appId`, `appName`, `server` config)
- New dirs `apps/ios/` + `apps/android/` (Capacitor native projects)
- `vercel.json` may need NEW header for `.well-known/apple-app-site-association` (correct MIME: `application/json`) and `.well-known/assetlinks.json` if AASA lives on the marketing host (D-09)
- Sentry release wiring inside `fastlane gym` / `fastlane gradle` — `@sentry/cli` upload-dsym after each build

</code_context>

<specifics>
## Specific Ideas

- **D-04 asymmetry** between Stripe grace-period vs RevenueCat immediate-downgrade — researcher should flag whether normalizing Stripe to immediate (matching iOS) would meaningfully change Phase 14 UAT, OR document as a permanent platform-shape difference.
- **D-08 Pro tier upgrade timing** — must land BEFORE App Store submission, not after. Coordinate with the Stripe-Customer-Portal-for-LeanShot-account setup (separate Stripe sub for LeanShot ↔ Supabase).
- **D-13 iOS-only `/pricing`** — likely needs a platform-conditional component (`PricingIOS` vs `PricingWeb`) OR a runtime check inside the existing pricing render branch. Planner decides shape.
- **D-20 4-locale ASO** — adds ~25-30 hours; consider folding the 3 non-EN locales as a v1.2 stretch goal so first App Store submission isn't blocked on translation cycle.

</specifics>

<deferred>
## Deferred Ideas

- **Watch app handoff hooks** — Phase 21 owns; do NOT pre-stub
- **HealthKit data flow** — Phase 18 owns; Phase 16 leaves `src/lib/native/health.ts` as throw-stub
- **AdMob initialization** — Phase 20 owns (per Phase 12 D-05 entry condition); Phase 16 leaves `src/lib/native/ads.ts` as throw-stub
- **Push notification wiring** — Phase 17 owns; Phase 16 leaves `src/lib/native/push.ts` as throw-stub
- **Offline export via @capacitor/filesystem** — plugin installed in D-07 but feature deferred to v1.3
- **Capgo Live Updates rollback playbook** — planner-phase concern, not context
- **HomeKit / Siri / shortcuts** — out of v1.2 entirely
- **iOS Shortcuts integration for one-tap dose log** — v1.3+ idea, captured here for future roadmap
- **Resend domain verification** — Phase 12 vendor carry-over still pending (project_phase12_execute_complete memory). Doesn't block Phase 16 itself but blocks transactional emails (IAP receipt confirmations) — likely surfaces during Phase 16 UAT
- **Photo gallery `@capacitor/camera` + on-device thumbnails** — D-08 alternate path; defer to v1.3 if Pro-tier transforms prove insufficient

</deferred>

## New vendor checkpoints (added during this discussion)

These are **net-new** prerequisites beyond Phase 12 carry-overs:

1. **Supabase project → Pro tier upgrade** (~$25/mo) — D-08 requires it BEFORE App Store submission
2. **Capgo Live Updates account + project** (~$15-30/mo) — D-12 requires it (defer if you want to ship bundled-only first)
3. **`leanshot.app` DNS + `.well-known/` accessibility** — D-09 requires AASA + assetlinks.json publishable on this host (Phase 12 vendor carry-over; promote to Phase 16 blocker)
4. **RevenueCat account + 2 products configured** — D-01 + D-03 (NET-NEW per Phase 12 CONTEXT)
5. **`leanshot-fastlane-match` private GitHub repo** — D-16 (NET-NEW; ~5min to create)

---

*Phase: 16-Capacitor-Mobile-Shells-iOS-Android*
*Context gathered: 2026-05-15*
