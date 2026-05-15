---
phase: 16
slug: capacitor-mobile-shells-ios-android
mode: chunked-outline
created: 2026-05-15
plan_count: 10
wave_count: 5
requirements_covered: [MOBILE-01, MOBILE-02, MOBILE-03, MOBILE-04, MOBILE-05, MOBILE-06, MOBILE-07, MOBILE-08, MOBILE-09, MOBILE-10, MONEY-06]
mvp_mode: true_but_infra
walking_skeleton: false
---

# Phase 16 — Plan Outline

**Phase goal (from ROADMAP):** A user installs LeanShot from App Store + Google Play, signs in, uses every web feature, subscribes via RevenueCat (Apple §3.1.1 + Google §3.1.1 compliant), and lands in the app via Universal Links / App Links. All native concerns route through `src/lib/native/*`. No WKWebView OOM on 200-photo scroll. All crashes land in Sentry.

**Anchor:** Researcher recommended 10 plans / 4 waves. This outline keeps 10 plans, expands to 5 waves so vendor checkpoints + final UAT gate are isolated from execution waves (no shared-file conflicts; clean dependency graph).

**Risk register honored:**
- R1 (D-05 iOS-14 → iOS-15.0): Plan 16-01 sets `IPHONEOS_DEPLOYMENT_TARGET = 15.0` in xcconfig.
- R2 (D-04 immediate-vs-grace asymmetry): Plan 16-06 webhook implements immediate downgrade per CONTEXT; deliberate. UAT acknowledges in Plan 16-10.
- R3 (D-13 iOS-safe-mode flag): NOT in P16; deferred to milestone tracker.
- R4 (D-20 4-locale ASO scope expansion): Plan 16-08 ships EN-only first per researcher; DE/ES/FR deferred to v1.2.1 (acknowledged in plan body — NOT a deferred decision; it is a scope split documented in PLAN.md).
- R5 (Capgo Live Updates): Deferred to v1.2.1; capacitor.config.ts in Plan 16-01 ships bundled-only.
- R6 (RC sandbox e2e automation): Plan 16-05 ships unit-mocked + Playwright spec; manual sandbox UAT gated in Plan 16-10.
- R7 (D-24 Apple acceptance of clinic-owner Stripe-Portal link): Plan 16-05 hides IAP for clinic_owner; Plan 16-10 includes submission-response template.
- R8 (SPM support for 14 plugins): Plan 16-01 first task is plugin SPM audit; CocoaPods fallback documented.
- R9 (@sentry/capacitor v4 dual-init signature): Plan 16-04 verifies vs fresh README in W2 first task.

---

## Outline

| Plan ID | Objective | Wave | Depends On | Requirements | Files Modified (summary) |
|---------|-----------|------|------------|--------------|--------------------------|
| `16-00-vendor-checkpoints-wave-0-harness` | Verify 5 vendor accounts (Apple Dev, Play Console, RevenueCat, Supabase Pro upgrade, fastlane-match private repo) + `leanshot.app` DNS+AASA reachability; stand up Wave-0 test infrastructure (`vitest-mobile.config.ts`, `src/lib/native/__mocks__/`, `scripts/audit-privacy-manifest.mjs`, `scripts/sentry-test-crash.mjs`, `e2e/mobile/` Playwright project, 200-photo Storage seed fixture). Non-autonomous (5 vendor checkpoints). | 0 | — | (all — prereq) | `vitest-mobile.config.ts`, `src/lib/native/__mocks__/*.ts`, `scripts/audit-privacy-manifest.mjs`, `scripts/sentry-test-crash.mjs`, `playwright.config.ts` (mobile project), `package.json` (test scripts), `PROJECT.md` (vendor-accounts table append) |
| `16-01-capacitor-scaffold-spm-audit-ios-15` | `npx cap init` + `npx cap add ios` + `npx cap add android`; install 14-plugin set (D-07) + `@capgo/capacitor-native-biometric` + `@revenuecat/purchases-capacitor` + `react-virtuoso` + `@sentry/capacitor`; SPM compatibility audit of all 14 (CocoaPods fallback if any missing); pin `IPHONEOS_DEPLOYMENT_TARGET = 15.0` (R1 correction over CONTEXT D-05); bundle IDs `app.leanshot.ios` + `app.leanshot.android` (D-10); `capacitor-bridge` chunk in `vite.config.ts` manualChunks (≤15 kB gz per Phase 12). | 1 | 16-00 | MOBILE-01, MOBILE-02, MOBILE-08 (react-virtuoso install) | `capacitor.config.ts`, `apps/ios/**`, `apps/android/**`, `package.json`, `package-lock.json`, `vite.config.ts`, `.gitignore`, `leanshot/.planning/phases/16-.../16-01-SPM-AUDIT.md` (audit notes) |
| `16-02-native-bridge-fills-platform-deeplink-biometric-share` | Replace 4 throw-stubs with real Capacitor implementations: `platform.ts` (Capacitor.getPlatform), `deeplink.ts` (App.addListener('appUrlOpen') with PATHNAME + HASH dispatcher per RESEARCH Pattern 2), `biometric.ts` (NEW — `@capgo/capacitor-native-biometric`), `share.ts` (NEW — `@capacitor/share`); add `<BiometricGate>` UI component for app-open lock (D-06); preserve ESLint firewall (Phase 12 zones unchanged; per-file unit tests with mocked Capacitor in `vitest-mobile`). | 1 | 16-01 | MOBILE-03, MOBILE-06 (deeplink half), MOBILE-07, MOBILE-10 | `src/lib/native/platform.ts`, `src/lib/native/deeplink.ts`, `src/lib/native/biometric.ts` (new), `src/lib/native/share.ts` (new), `src/components/BiometricGate.tsx` (new), `src/App.tsx` (install deeplink + biometric gate on boot), `src/lib/native/*.test.ts` |
| `16-03-aasa-assetlinks-vercel-headers` | Publish `public/.well-known/apple-app-site-association` (NO `.json` extension) + `public/.well-known/assetlinks.json` for both `leanshot.app` AND `app.leanshot.app` (D-09 max-coverage); append two Content-Type override entries to `vercel.json` headers (one per AASA + assetlinks source — NOT under wildcard per RESEARCH gotcha #4); CI curl-check that both files return `application/json` from prod. AASA paths match D-11 4 deep-link categories. | 1 | 16-00 (DNS verified) | MOBILE-06 (server-side half) | `public/.well-known/apple-app-site-association` (new, no extension), `public/.well-known/assetlinks.json` (new), `vercel.json`, `.github/workflows/ci.yml` (add aasa-reachability curl step) |
| `16-04-sentry-capacitor-dual-init` | Wire `@sentry/capacitor` v4 dual-init (web Sentry SDK + native Sentry Cocoa/Android via plugin auto-link); reuse existing Phase 1 Sentry DSN + project with separate releases tagged `ios@<ver>` / `android@<ver>` (D-17); verify v4 dual-init signature against fresh README (R9); add Sentry init to `src/main.tsx` BEFORE first render. Native dSYM upload deferred to fastlane in 16-09. | 2 | 16-01 | MOBILE-09 (init half — release tagging in 16-09) | `src/lib/sentry.ts` (new or update), `src/main.tsx`, `apps/ios/App/Podfile` (Sentry Cocoa), `apps/android/app/build.gradle` (Sentry Android), `package.json` |
| `16-05-revenuecat-iap-pricing-fork-tier-realtime` | Fill `src/lib/native/iap.ts` with `@revenuecat/purchases-capacitor` (configure + getOfferings + purchasePackage + checkTrialEligibility per D-22); fork pricing UI: new `src/components/PricingIOS.tsx` (clone `PricingBlock.tsx` layout, CTA invokes `purchaseSubscription` NOT stripe-checkout — D-13); modify `src/App.tsx` `?upgrade=` handler to platform-switch (web → Stripe Checkout, ios/android → RC); hide IAP entirely for `role='clinic_owner'` and surface explanatory link to `leanshot.app/clinic/billing` (D-24); subscribe to Supabase Realtime `subscriptions:user_id=eq.X` channel for tier-flip propagation (D-25, mirrors Phase 9/10 patterns). Unit tests with mocked `Purchases`; Playwright IAP spec marked `test.skip(!HAS_LIVE)`. | 2 | 16-01, 16-02 | MONEY-06 (client half) | `src/lib/native/iap.ts`, `src/components/PricingIOS.tsx` (new), `src/App.tsx` (?upgrade= platform fork + Realtime channel install), `src/lib/page-builder/pricing-page-content.ts` (platform-aware render hook), `src/lib/native/iap.test.ts`, `e2e/mobile/iap-flow.spec.ts` |
| `16-06-revenuecat-webhook-migration-tier-effective` | New Edge Function `supabase/functions/revenuecat-webhook/index.ts` mirroring `stripe-webhook` pattern (raw-body HMAC-SHA256 verify, idempotency via `subscription_events.event_id` PK with `provider='revenuecat'`, JSON-only responses); migration adds `provider` column (idempotent `ADD COLUMN IF NOT EXISTS` with `'stripe'` default to preserve existing rows) + `tier_effective` view computing `MAX(current_period_end) > now()` per user (D-02); RC event dispatcher handles INITIAL_PURCHASE / RENEWAL / PRODUCT_CHANGE / CANCELLATION (immediate `expires_at = now()` per D-04) / EXPIRATION / BILLING_ISSUE; deploy via Supabase CLI; deno test for HMAC verify + dispatcher. Migration safety: enum-add-in-same-tx avoided (text column, not enum). | 2 | 16-00 (Supabase Pro upgrade) | MONEY-06 (server half) | `supabase/functions/revenuecat-webhook/index.ts` (new), `supabase/functions/revenuecat-webhook/index.test.ts` (deno), `supabase/migrations/202605xx_rc_subscriptions_provider.sql` (new), `supabase/migrations/202605xx_tier_effective_view.sql` (new) |
| `16-07-privacy-manifest-data-safety-audit` | Hand-craft `apps/ios/App/App/PrivacyInfo.xcprivacy` from 14-plugin inventory (D-18); fill Google Play Data Safety form fields and capture answers in `apps/android/data-safety.md`; implement `scripts/audit-privacy-manifest.mjs` (validates declared APIs against Apple's canonical required-reason list + cross-checks against plugin GitHub README privacy-manifest sections); wire script into `.github/workflows/mobile.yml`; add `NSHealthShareUsageDescription` as STUB only (Phase 18 fills) + biometric usage strings + Universal Links Associated Domains entitlement; declare HealthKit `NSPrivacyCollectedDataTypeLinked=false` per CONTEXT D-18. | 3 | 16-01, 16-02, 16-04 | MOBILE-05 | `apps/ios/App/App/PrivacyInfo.xcprivacy` (new), `apps/ios/App/App/Info.plist`, `apps/ios/App/App/App.entitlements`, `apps/android/data-safety.md` (new), `scripts/audit-privacy-manifest.mjs` (FILL Wave-0 stub), `.github/workflows/mobile.yml` (audit job wiring) |
| `16-08-aso-playwright-capture-en-only` | Implement `e2e/aso/aso-capture.spec.ts` (Playwright multi-viewport screen capture per RESEARCH Pattern + D-19 viewport list: iPhone 15 Pro Max 6.7", iPhone 14 6.1", iPad Pro 12.9", Pixel Phone, Pixel Tablet, Wear OS); generate EN store-listing copy (title, subtitle, description, keywords, promo text) per ASO best-practice template; capture 30s App Store Preview video via QuickTime manual recording checkpoint (D-21 ~3-4 hr) committed to `apps/ios/marketing/preview.mov`; output goes to `apps/ios/marketing/screenshots/en-US/` + `apps/android/marketing/screenshots/en-US/`. **DE/ES/FR translations explicitly DEFERRED to v1.2.1 per R4** (researcher recommendation; saves 25-30hr; first submission unblocked). | 3 | 16-01 (built app) | MOBILE-04 | `e2e/aso/aso-capture.spec.ts` (new), `apps/ios/marketing/**` (new), `apps/android/marketing/**` (new), `apps/ios/store-listing-en.md` (new), `apps/android/store-listing-en.md` (new) |
| `16-09-fastlane-ci-mobile-pipeline` | Scaffold `fastlane/Fastfile` + `Matchfile` + `Appfile` per D-14; configure `fastlane match` against private GitHub repo `leanshot-fastlane-match` (D-16); add `fastlane gym` (iOS) + `fastlane gradle` (Android) lanes for build + TestFlight upload + Play Internal upload; integrate `@sentry/cli` dSYM upload step per build (completes MOBILE-09); create `.github/workflows/mobile.yml` (macOS runner; needs: lint+typecheck from ci.yml or self-contained); secrets table documented for Vercel + Supabase + Apple ASP + Play JSON key + Sentry auth token; add Sentry release tagging `ios@<ver>` / `android@<ver>` to lanes. | 3 | 16-04, 16-07 | MOBILE-01 (TestFlight half), MOBILE-02 (Play half), MOBILE-09 (release tagging half) | `fastlane/Fastfile` (new), `fastlane/Matchfile` (new), `fastlane/Appfile` (new), `fastlane/Gemfile` (new), `.github/workflows/mobile.yml` (new), `apps/ios/App/fastlane/` (per-platform Lane overrides if split), `apps/android/fastlane/` |
| `16-10-oom-soak-uat-gates-launch` | Implement `e2e/mobile/photo-soak.spec.ts` (200-photo seed via service-role admin client + 30-min soak + Sentry crash assertion per RESEARCH §"MOBILE-08 OOM Soak Protocol"); kick off 7-day TestFlight soak (D-15 manual UAT gate) + 3-day Play Internal soak (D-15 manual UAT gate); manual Apple Sandbox purchase UAT (RC sandbox tester); prepare Apple §3.1.1 + §4.7 submission-response template (R7 D-24 mitigation; D-13 page-builder runtime risk); cold-start p95 ≤10s telemetry check via Sentry `app.start` transaction. **Phase-gate task: do not promote to App Store / Play Store production until all UAT signals green.** | 4 | 16-05, 16-06, 16-07, 16-08, 16-09 (everything) | MOBILE-01 (UAT install), MOBILE-02 (UAT install), MOBILE-08 (soak), MOBILE-09 (crash telemetry), MONEY-06 (sandbox UAT) | `e2e/mobile/photo-soak.spec.ts` (new), `apps/ios/submission-response-templates.md` (new), `leanshot/.planning/phases/16-.../16-UAT.md` (manual soak log), `leanshot/.planning/phases/16-.../16-LAUNCH-CHECKLIST.md` (gate checklist) |

---

## Wave Structure

| Wave | Plans | Files Conflict Check | Notes |
|------|-------|----------------------|-------|
| 0 | 16-00 | none — solo | Vendor + Wave-0 test infra prereq. Non-autonomous (5 human checkpoints). |
| 1 | 16-01, 16-02, 16-03 | 16-01 owns `capacitor.config.ts` + `apps/*`; 16-02 owns `src/lib/native/*` + `src/App.tsx`; 16-03 owns `public/.well-known/*` + `vercel.json`. **NO overlap.** | All parallel. 16-02 depends on 16-01 packages-installed → must run after 16-01 commit but Wave 1 is fine as parallel-after-Wave-0; if executor pool serializes within wave, runs 16-01 first then 16-02 in same wave. |
| 2 | 16-04, 16-05, 16-06 | 16-04 owns `src/lib/sentry.ts` + Podfile/Gradle (Sentry-only edits); 16-05 owns `src/lib/native/iap.ts` + `src/components/Pricing*` + `src/App.tsx` (?upgrade= block); 16-06 owns `supabase/functions/revenuecat-webhook/*` + new migrations. **Risk:** 16-04 and 16-05 both touch `src/App.tsx`. **Resolution:** 16-04 confines its edits to `src/main.tsx`; 16-05 owns `src/App.tsx` exclusively. Both update `package.json` — `git commit -- <pathspec>` per `feedback_parallel_executor_git_isolation.md`. | All parallel. |
| 3 | 16-07, 16-08, 16-09 | 16-07 owns `apps/ios/App/App/PrivacyInfo.xcprivacy` + `Info.plist` + entitlements + `apps/android/data-safety.md`; 16-08 owns `apps/ios/marketing/**` + `apps/android/marketing/**` + ASO copy files; 16-09 owns `fastlane/**` + `apps/ios/App/fastlane/` + `apps/android/fastlane/` + `.github/workflows/mobile.yml`. **NO overlap.** | All parallel. 16-09 needs 16-07's PrivacyInfo file present for `audit-privacy-manifest.mjs` CI step → must run after 16-07 commit. Same-wave OK with per-task ordering; executor pool handles. |
| 4 | 16-10 | solo | Gates all manual UAT (7-day TestFlight, 3-day Play Internal, Sandbox purchase). Non-autonomous (4 manual checkpoints). |

---

## Requirements Coverage Audit

Every MOBILE-01..10 + MONEY-06 covered by ≥1 plan:

| REQ-ID | Plans |
|--------|-------|
| MOBILE-01 (iOS install + dashboard ≤10s) | 16-01 (scaffold), 16-09 (TestFlight upload lane), 16-10 (UAT install + cold-start telemetry) |
| MOBILE-02 (Android install) | 16-01 (scaffold), 16-09 (Play Internal upload lane), 16-10 (UAT install) |
| MOBILE-03 (feature code → src/lib/native/* only) | 16-02 (native fills; ESLint firewall preserved from Phase 12) |
| MOBILE-04 (ASO assets) | 16-08 (Playwright capture EN; DE/ES/FR deferred to v1.2.1) |
| MOBILE-05 (PrivacyInfo + Data Safety) | 16-07 |
| MOBILE-06 (Universal Links + App Links) | 16-02 (deeplink.ts client half), 16-03 (AASA + assetlinks server half) |
| MOBILE-07 (Biometric unlock) | 16-02 (biometric.ts + BiometricGate.tsx) |
| MOBILE-08 (No WKWebView OOM on 200 photos) | 16-01 (react-virtuoso install + Pro tier image transforms via 16-00 Supabase upgrade), 16-10 (30-min soak spec) |
| MOBILE-09 (Sentry crash capture) | 16-04 (dual-init), 16-09 (dSYM upload + release tagging), 16-10 (crash telemetry UAT) |
| MOBILE-10 (Native share sheet) | 16-02 (share.ts) |
| MONEY-06 (RevenueCat IAP + cross-platform tier) | 16-05 (RC SDK + paywall fork + tier-flip Realtime), 16-06 (webhook + migration + tier_effective view), 16-10 (Sandbox purchase UAT) |

**Coverage:** 11/11 REQ-IDs covered. No orphans. No silent omissions.

---

## Source Audit Summary

- **GOAL:** Phase 16 ROADMAP goal sentence — fully decomposed across 16-01..16-10.
- **REQ:** 11/11 phase_req_ids covered (see audit table above).
- **RESEARCH:** All 9 RESEARCH patterns mapped to plans (Pattern 1 → 16-02; Pattern 2 → 16-02; Pattern 3 → 16-05; Pattern 4 → 16-06; Pattern 5 → 16-02; Pattern 6 → 16-04; Pattern 7 → 16-03; Pattern 8 → 16-03; Pattern 9 (Capgo) → DEFERRED to v1.2.1 per R5). All 10 Pitfalls addressed in the plan body that owns the risk surface.
- **CONTEXT:** All 25 D-NN decisions traced: D-01..D-04 → 16-05 + 16-06; D-05 → 16-01 (with R1 iOS-15 correction); D-06 → 16-02; D-07 → 16-01; D-08 → 16-00 (Pro upgrade) + 16-01 (react-virtuoso) + 16-10 (soak); D-09 → 16-03; D-10 → 16-01; D-11 → 16-02 + 16-03; D-12 → 16-01 (bundled-only; Capgo deferred per R5); D-13 → 16-05 (fork) + 16-10 (submission-response template); D-14..D-17 → 16-09; D-18 → 16-07; D-19 → 16-08; D-20 → 16-08 (EN-only first; R4 explicit scope split — NOT silently omitted); D-21 → 16-08 (manual QuickTime checkpoint); D-22 → 16-05 (offer-eligibility); D-23 → 16-05 (UI display logic); D-24 → 16-05 (clinic-owner hide) + 16-10 (submission-response template); D-25 → 16-05 (Realtime channel).

**No silent omissions. No "v1 / static for now / future enhancement" scope reductions. R4 4-locale split is an explicit, documented scope reduction with researcher recommendation; D-20 itself is honored — full ASO copy and screenshots ship in EN at Phase 16; remaining 3 locales become a v1.2.1 follow-up (NOT P16-deferred).**

---

## Open Questions for Planner to Resolve in PLAN.md Bodies

1. (Claude's Discretion in CONTEXT) react-virtuoso `Virtuoso` vs `VirtuosoGrid` — 16-01 planner picks based on existing Photo tab UI grep.
2. (Claude's Discretion in CONTEXT) Per-locale store-copy vendor — N/A at P16 (EN-only per R4); revisit at v1.2.1.
3. (Claude's Discretion in CONTEXT) Capgo rollout strategy — N/A at P16 (deferred per R5).
4. R8 (SPM availability of 14 plugins) — 16-01 first task is the audit; CocoaPods fallback path documented in-plan.

---

*Outline created 2026-05-15 by gsd-planner in chunked-mode outline-only pass. PLAN.md files NOT written in this pass — orchestrator will spawn per-plan writers.*
