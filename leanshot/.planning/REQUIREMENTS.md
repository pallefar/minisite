# Milestone v1.2 Requirements

**Milestone:** v1.2 — Polished Launch + Full Monetization + Ad Network
**Goal:** Take LeanShot from "shipped multi-audience SaaS" to "launch-ready cross-platform product with full monetization, growth loops, and ad-network revenue." Web, mobile, watch — all on the new design system, with Stripe-powered subs/seats/affiliate **plus** a multi-mode advertising network as primary revenue stream.

**Source documents:**
- `.planning/PROJECT.md` — milestone scope + locked decisions
- `.planning/research/SUMMARY.md` — synthesized research (6 disagreements resolved)
- `.planning/research/STACK.md` / `FEATURES.md` / `ARCHITECTURE.md` / `PITFALLS.md` — dimension detail
- `.planning/design-system/` — staged Claude-Design handoff bundle (38 HTML previews + React recreations + assets + colors_and_type.css)

**REQ-ID totals:** 104 active requirements across 11 workstreams. All user-confirmed in `/gsd-new-milestone` per-category review on 2026-05-13.

---

## v1.2 Requirements

### WS1 — Design System Rollout (12 REQ-IDs)

#### Type + Tokens
- [ ] **DS-01**: User sees Geist + Geist Mono + Fraunces fonts across all surfaces (loaded via `<link>` tags + preconnect, NOT CSS `@import` chain)
- [ ] **DS-02**: User experiences refreshed color / shadow / spacing / radius tokens applied consistently across app + marketing site
- [ ] **DS-03**: Visitor to marketing site sees refreshed Landing page (Landing.tsx) with new tokens + illustrations
- [ ] **DS-04**: User signs in via split-screen login page with hero illustration (form left, illustration right)

#### Components
- [ ] **DS-05**: User sees refreshed Card variants across dashboard (elevated / selected / clickable / tonal / footer)
- [ ] **DS-06**: User interacts with refreshed Button (tonal variant + counter chips + improved focus/disabled/loading states)
- [ ] **DS-07**: User uses refreshed Pill segmented control (+ count badges + icon-only + disabled)
- [ ] **DS-08**: User toggles refreshed Sidebar with instant 72↔232px collapse and 200ms inner-content fade

#### Brand / Illustrations
- [ ] **DS-09**: User sees Site-rotation v2 with zone labels + numbered dots on body diagram
- [ ] **DS-10**: User sees streak badge set (bronze / silver / gold / locked) across StreaksCard, ShareCardModal, and watch complications
- [ ] **DS-11**: User chats with refreshed AI avatar (organic-mesh design) across AIChatPanel, topbar, onboarding
- [x] **DS-12**: User sees full illustration set deployed — all 8 net-new illustrations wired 2026-05-13/14 via Plan 13-07 follow-up (PenInjector + CalendarDose in MedicationTab, AchievementShield in StreaksCard, ActivityRings in ActivityTab, DoctorClipboard in DoctorReport, HeartPulse + EmptyInsights in InsightsTab, EmptyPlate in NutritionTab; HeroOrbital already wired in HeroCard + Landing). P13 BLOCKER closed; VERIFICATION re-verified 2026-05-17.

### WS2 — Mobile Shells (10 REQ-IDs)

#### Core Shells + Bridge
- [ ] **MOBILE-01**: User installs the Capacitor 8 iOS app from the App Store; app wraps existing SPA with native build pipeline (fastlane + TestFlight)
- [ ] **MOBILE-02**: User installs the Capacitor 8 Android app from the Play Store; app wraps existing SPA with native build pipeline (signed AAB + internal testing)
- [ ] **MOBILE-03**: Feature code imports only from `src/lib/native/{health,ads,push,iap,deeplink,platform}.ts` — never `@capacitor/*` directly (enforced by ESLint `no-restricted-imports`)

#### Store Submission
- [ ] **MOBILE-04**: User finds LeanShot in App Store + Play Store with full ASO assets (icons, screenshots at 6.7" / 6.5" / 5.5" / iPad + Phone/Tablet/Wear, 30s preview video, store listing copy in EN)
- [ ] **MOBILE-05**: App Store + Play Console accept submission with complete `PrivacyInfo.xcprivacy` manifest + Play data-safety form (Pitfall: Apple rejects without this)
- [ ] **MOBILE-06**: User taps `leanshot.app/*` link on phone and lands in the installed app (Universal Links iOS + App Links Android via apple-app-site-association + assetlinks.json)

#### UX + Reliability
- [ ] **MOBILE-07**: User can enable biometric unlock (FaceID / TouchID / Android Biometric) for app open
- [ ] **MOBILE-08**: User scrolls long photo gallery on iPhone without WKWebView OOM crash (react-virtuoso virtualization + Supabase Storage image transforms)
- [ ] **MOBILE-09**: All crashes + errors on iOS + Android land in Sentry (Capacitor SDK + native Sentry Cocoa + Sentry Android)
- [ ] **MOBILE-10**: User shares dose-log / share-card / doctor-report via native share sheet (`@capacitor/share`)

### WS3 — Watch Apps (Apple Watch + WearOS) (8 REQ-IDs)

#### Native Apps + Core Surface
- [ ] **WATCH-01**: User installs Apple Watch native SwiftUI app via bundled iOS companion submission (`apps/watch-ios/`)
- [ ] **WATCH-02**: User installs WearOS native Kotlin/Compose app via bundled Android companion submission (`apps/watch-android/`)
- [ ] **WATCH-03**: User sees next-dose complication (watchOS) + tile (WearOS) showing countdown + suggested injection site at-a-glance
- [ ] **WATCH-04**: User logs an injection from watch (tap complication/tile → confirm site → haptic + "logged" → syncs to phone)

#### Sync + Extras
- [ ] **WATCH-05**: User sees streak badge (from DS-10) on watch face complication
- [ ] **WATCH-06**: Watch data syncs via hybrid model: Supabase cloud-primary + WatchConnectivity (iOS) / Wearable Data Layer (WearOS) live channel when phone reachable
- [ ] **WATCH-07**: User logs dose from watch when phone is unreachable (direct Supabase REST fallback with eventual reconciliation when phone returns)
- [ ] **WATCH-08**: User sees dose-day HR overlay on watch (differentiator — depends on WS4 HEALTH-05 firewall-isolated HR read)

### WS4 — Health SDK + Two-tunnel Firewall (8 REQ-IDs)

#### Metric Imports
- [ ] **HEALTH-01**: HealthKit (iOS) + Health Connect (Android) read-only access wired via `@capgo/capacitor-health` single plugin
- [ ] **HEALTH-02**: User opts in to weight auto-fill from Health (per-metric pre-prompt + source-of-truth chooser if manual + Health both present)
- [ ] **HEALTH-03**: User opts in to daily steps auto-fill from Health → ActivityTab
- [ ] **HEALTH-04**: User opts in to sleep duration + stages auto-fill from Health → SleepTab

#### Differentiator + Firewall + Infra
- [ ] **HEALTH-05**: User sees HR (read-only, not auto-logged) as InsightsTab context + dose-day HR overlay on watch
- [ ] **HEALTH-06**: Native build includes `NSHealthShareUsageDescription` (iOS) + Health Connect intent filters (Android) — silent-fail prevention (Pitfall 9)
- [ ] **HEALTH-07**: HealthKit data is structurally isolated from ad SDKs via Two-tunnel firewall: ESLint `no-restricted-imports` + runtime `firewall.ts` guard + `PrivacyInfo.xcprivacy` declarations
- [ ] **HEALTH-08**: `health_imports` table records metadata only (count, last-sync) — never raw Health values; physical-device smoke-test gate runs before App Store / Play Store submission

### WS5 — Owner/Admin Surface (8 REQ-IDs)

#### Members + Financials
- [ ] **ADMIN-01**: Owner views members table with search/filter (tier, signup, last-active, clinic, country, billing status) + per-row quick actions (impersonate, refund, cancel, deactivate)
- [ ] **ADMIN-02**: Owner sees MRR / ARR / churn chart with free-vs-paid breakdown + clinic-seat utilization
- [ ] **ADMIN-03**: Owner impersonates any user from admin; impersonation shows red banner + creates `audit_logs` entry + auto-expires session after 30 min
- [ ] **ADMIN-04**: Owner issues refunds (full / partial), force-cancels subs, retries failed charges, and comps months — all audit-logged

#### Ops Surfaces
- [ ] **ADMIN-05**: Owner views + overrides PostHog feature flags per-user / per-cohort from admin UI
- [ ] **ADMIN-06**: Owner approves / holds / pays out affiliate commissions from review queue (fraud signals from AFF-07/08 surfaced inline)
- [ ] **ADMIN-07**: Owner views ad-revenue dashboard (eCPM / RPM / CTR / fill rate per placement per provider) + edits advertiser block-list (default-blocks GLP-1 brands)
- [ ] **ADMIN-08**: Owner views cohort retention heatmap (acquisition cohort × retention curve day-0 through day-90)

### WS6 — Monetization (Stripe web + RevenueCat IAP + clinic seats) (10 REQ-IDs)

#### Web Stripe Foundation
- [ ] **MONEY-01**: `subscriptions` + `subscription_events` + `stripe_customers` tables exist; `stripe-webhook` Edge Function with signature verification syncs Stripe state → DB
- [ ] **MONEY-02**: Web user subscribes via Stripe Checkout (hosted) with 7-day card-required trial; auto-converts unless cancelled
- [ ] **MONEY-03**: Web user manages payment method / cancels / changes plan via Stripe-hosted Customer Portal
- [ ] **MONEY-04**: `<TierGate>` component + `tier` slice in Zustand store gate premium features (ad-free, advanced AI, optional pharma-projection)

#### Mobile IAP + Cross-platform
- [ ] **MONEY-05**: Clinic owner is billed per-active-patient with monthly true-up (Stripe metered billing)
- [ ] **MONEY-06**: iOS + Android user subscribes via RevenueCat in-app purchase (MANDATORY — Apple §3.1.1 + Google §3.1.1 forbid Stripe for in-app digital subs)
- [ ] **MONEY-07**: User who subscribes on web AND on iOS sees a unified `tier` field (RevenueCat + Stripe webhooks both write `subscriptions` with provider field; take whichever expires later)

#### Ops + UX
- [ ] **MONEY-08**: Visitor sees pricing page + paywall surfaces + comparison table (built via WS7 page builder with pricing template)
- [ ] **MONEY-09**: User whose card fails receives Stripe Smart Retries + dunning email + push notification (retries 1/3/5); tier displays "past_due" banner
- [ ] **MONEY-10**: Account deletion (WS10 DEL-02) cascades to Stripe (customer del + Connect del queued if open payouts + payment intent void) while preserving IRS-retained payouts records

### WS7 — Page Builder + Landing Pages (9 REQ-IDs)

#### Infrastructure + Editor
- [ ] **PAGE-01**: `landing_pages` + `landing_page_revisions` tables exist + `page-assets` Storage bucket with CDN-served images
- [ ] **PAGE-02**: Admin builds pages via drag-and-drop editor using dnd-kit primitives + design-system component palette (lazy `admin-bundle` chunk — public visitors never download editor)
- [ ] **PAGE-03**: Admin uses 8 semantic block components (Hero, CTA, FAQ, Pricing, Testimonial, Feature grid, Image+text, Footer) each with property editor in right-rail
- [ ] **PAGE-04**: Admin picks one of 5 high-converting templates as a starter (long-form sales, lead-magnet opt-in, comparison, FAQ, testimonial-driven)

#### SEO + Render
- [ ] **PAGE-05**: Admin sets per-page SEO (title, description, OG tags, canonical, JSON-LD with template-suggested schema.org type)
- [ ] **PAGE-06**: Visitor receives static HTML for published pages via `page-render` Edge Function + Vercel ISR (no React bundle download; Lighthouse-clean)
- [ ] **PAGE-07**: Admin views version history + restores any prior revision (`landing_page_revisions` append-only on every save)
- [ ] **PAGE-08**: Search engines find auto-generated `sitemap.xml` + `robots.txt` + global SEO defaults (favicon, social card, default OG image) applied unless per-page overrides

#### Monetization Link
- [ ] **PAGE-09**: `/pricing` page uses Pricing-page template wired to Stripe Checkout via live price IDs + Checkout-button block (MONEY-08 consumer)

### WS8 — Viral Affiliate Program (10 REQ-IDs)

#### Infra + Attribution
- [ ] **AFF-01**: `affiliates` + `affiliate_links` + `affiliate_clicks` + `affiliate_conversions` + `payouts` tables exist with RLS isolating each affiliate's data; admin sees all
- [ ] **AFF-02**: Affiliate referral URL `leanshot.app/r/{code}` → `affiliate-attribute` Edge Function sets server-side HttpOnly first-party cookie (30-day TTL, defeats Safari ITP) + iOS App Store fallback "enter referral code on first launch"
- [ ] **AFF-03**: Affiliate completes Stripe Connect Express onboarding with hosted W-9 / W-8BEN / 1099-NEC tax form collection (we never build tax-form UI)
- [ ] **AFF-04**: Affiliate views partner dashboard (clicks, conversions, commissions, payout history, downloadable marketing assets, referral link)

#### Signup + Payout Flow
- [ ] **AFF-05**: Affiliate applies via public form → admin manual-approval via ADMIN-06 queue → single-tier $10 flat commission per paid conversion (multi-tier deferred to v1.3)
- [ ] **AFF-06**: `affiliate-payout` Edge Function runs monthly batch (60-90 day chargeback hold, $500/30d W-9 enforcement threshold)
- [ ] **AFF-09**: Each affiliate has a co-branded landing page at `/r/{code}` (template-based via WS7) with their name + photo + Calendly link + auto-attribution on visit
- [ ] **AFF-10**: User account deletion anonymizes affiliate ledger via `ON DELETE SET NULL` + email hashing (IRS 1099 retention preserved 7yr; Pitfall 7 mitigation)

#### Fraud Detection
- [ ] **AFF-07**: Conversions flagged when converter shares IP / device fingerprint / email domain with referring affiliate; admin reviews in ADMIN-06 queue
- [ ] **AFF-08**: Clicks rejected when Referer mismatched/missing OR raw-count Z-score ≥3σ above the affiliate's 7-day rolling baseline (D-26). Admin reviews flagged rows in the P22 queue (D-25). **v1.2 scope-amendment (2026-05-15):** ships impression tracking (`affiliate_impressions` table + insert on `/r/{code}` render) so v1.3 has historical baseline; the impression/click ratio anomaly *detector* itself is deferred to v1.3.

### WS9 — Advertising Network (12 REQ-IDs)

#### Infra + Serving
- [ ] **AD-01**: `ad_placements` + `ad_impressions` + `ad_revenue_daily` + `ad_blocklist` + `house_ads` tables exist with admin-only writes + public-readable for impression beacons
- [ ] **AD-02**: `ad-config` Edge Function returns per-user placement config keyed ONLY on `{tier, platform, locale, currentSurface}` — NEVER health data (Two-tunnel firewall partner)
- [ ] **AD-03**: `<AdSlot>` component refuses to mount on `/clinic/*`, `/share/*`, `/admin/*` + refuses on `tier='paid'` (CSP report-only header is belt-and-suspenders)
- [ ] **AD-11**: Frequency caps enforced per-user per-placement via localStorage + admin-configurable per placement + per-user override

#### Three Provider Modes
- [ ] **AD-04**: AdMob (mobile-only) initialized via Two-tunnel firewall + ATT prompt before init + SKAdNetwork IDs in Info.plist + app-ads.txt published to leanshot.app
- [ ] **AD-05**: Google Ad Manager / AdSense on web via GPT `<script>` lazy-loaded AFTER cookie consent (marketing category) + ads.txt published
- [ ] **AD-06**: Admin pastes third-party embed code (Outbrain / Taboola / direct-sold scripts) per placement with sandboxed CSP allowed-sources
- [ ] **AD-07**: Admin uploads custom/house ads (creative + copy + CTA + URL + targeting {tier, platform, locale, surface} + frequency cap); served as waterfall fallback when AdMob/AdSense return no fill

#### Monetization Optimizations
- [ ] **AD-08**: User on free tier can watch rewarded video ad to unlock something (premium insight for the day, extra AI prompts, dose-history PDF) — eCPM 3-4x interstitial
- [ ] **AD-09**: Default GLP-1 advertiser block-list active (brand names + compound pharmacies + DTC telehealth); auto-updates from FTC NAD rulings
- [ ] **AD-10**: `ad-revenue-ingest` Edge Function runs daily cron pulling AdMob / Ad Manager / AdSense Reporting APIs into `ad_revenue_daily` (daily granularity sufficient for v1.2; hourly revisit at $1k/mo)
- [ ] **AD-12**: Admin assigns providers to placements with weights (AdMob 50% / AdSense 50% / house 0%) and tunes based on observed eCPM (A/B testing)

### WS10 — Launch Essentials (12 REQ-IDs)

#### Push Notifications
- [ ] **PUSH-01**: `push_tokens` + `notification_log` tables exist (tokens per-device per-platform; notifications logged for admin audit + idempotency)
- [ ] **PUSH-02**: `push-fanout` Edge Function routes a single payload to APNs + FCM + Web Push + watch piggy-back (quiet hours + frequency caps applied once per user, not per channel)
- [ ] **PUSH-03**: User configures per-category notification preferences (dose reminders / AI insights / clinic alerts / billing / marketing) + quiet hours + snooze on dose reminders
- [ ] **PUSH-05**: iOS user receives Web Push if PWA installed + iOS ≥16.4 detected; native APNs fallback used on installed Capacitor app

#### Account Deletion (App Store hard requirement)
- [ ] **DEL-01**: User deletes account in ≤3 taps from in-app settings with typed-text confirm + 7-day soft-delete grace period (Apple §5.1.1(v) compliance)
- [ ] **DEL-02**: `account-delete` Edge Function cascades: Stripe customer/sub/Connect + Resend audience + Storage + RLS + auth.admin.deleteUser; retains `payouts` (IRS 7yr) + `audit_logs` anonymized + `affiliate_ledger` anonymized via `ON DELETE SET NULL` (Pitfall 7)

#### GDPR
- [ ] **GDPR-01**: Visitor sees cookie consent banner (vanilla-cookieconsent + Consent Mode v2) with granular Essential / Analytics / Marketing / Personalization toggles; EU default off, US default analytics-on (CCPA)
- [ ] **GDPR-02**: `consent_records` table stores per-user consent state server-side for audit; PostHog / AdSense / Pixel / Meta scripts load via dynamic `import()` ONLY after matching consent category granted (Pitfall 4)
- [ ] **GDPR-03**: User exports own data via DSAR portal + `dsar_requests` table + `dsar-export` Edge Function (JSON + PDF bundle including Storage + Stripe + PostHog + affiliate ledger anonymized for others; 30-day SLA)

#### Onboarding + Lifecycle Email
- [ ] **ON-01**: User goes through revamped 7-step onboarding on new design tokens + watch-pairing (skippable) + Health-permission (skippable) + push-permission + affiliate-attribution capture (auto-prefilled from cookie if present)
- [ ] **ON-02**: User receives Resend lifecycle email templates: welcome series (day 0/1/3/7), behavior-triggered (first injection, 7-day streak, missed dose), transactional (receipt, password reset re-skin, clinic-invite re-skin), retention (re-engagement 7d, cancellation win-back +30d, milestone celebrations, doctor-share notification, weekly digest, affiliate payout monthly) — all on new design tokens
- [ ] **ON-03**: User manages email preferences via self-serve preference center (per-category unsubscribe); Resend domain `app.leanshot.app` verified in Phase 0 (carry-over from v1.1)

### WS11 — v1.1 Tech Debt Sweep (5 REQ-IDs)

#### Carry-over Fixes
- [ ] **DEBT-01**: Clinic operator drill-in "View activity" button navigates to per-patient activity view (CLINIC-07 partial fix from v1.1 audit; `ClinicDrillInPage.tsx:287-292`)
- [x] **DEBT-02**: Audit verified 0 `s.user!` non-null assertions in production code; ESLint `no-restricted-syntax` rule prevents regression (Phase 23 Plan 23-01 closeout 2026-05-16)
- [ ] **DEBT-03**: User soft-deletes photo → 30-day restore window in Trash UI → permanent delete on day-31 with Storage retention policy

#### Tooling
- [x] **DEBT-04**: All 28 deferred test markers (audited 2026-05-16, see `.planning/deferred-tests.md`) registered with fix-plan; CI lint enforces registry entry for every new defer (9 deferred-with-fix-plan + 19 env-gated entries; `scripts/audit-deferred-tests.mjs` in lint job, Phase 23 Plan 23-01 closeout 2026-05-16)
- [ ] **DEBT-05**: knip + ts-unused-exports run in CI (warn-not-fail initially, escalate to fail after triage) — catches the Plan 10-06 WORKSPACE_LOADED-style unused-export defects (anti-pattern #6)

---

## Future Requirements (v1.3+)

Items the synthesizer flagged as differentiators that didn't make v1.2 GA. Track separately; promote into v1.3 milestone when scoped.

- **Clinic-sponsored patient billing** — clinic pays for patient subs; wait for clinic demand signal
- **HealthKit write-back** — write our injection events + body metrics back to HealthKit (read-only at v1.2)
- **Multi-language i18n** — Spanish first; US-only at v1.2 GA
- **Multi-tier affiliate program** — silver / gold / platinum tiers; wait for partner volume
- **Page-builder block-level A/B testing** — A/B test individual blocks per landing page
- **Standalone watch mode (no iPhone required)** — watch as a primary device
- **Mid-trial pharmacology projection paywall** — synthesizer recommended test in v1.2.x patches, NOT GA; locked at Phase 2 CONTEXT.md
- **Page-builder embed-provider blocks** (Calendly / YouTube / Tally) — separate follow-up after v1.2 builder foundation
- **Hourly ad-revenue ETL** — revisit when ad revenue crosses $1k/mo (daily sufficient now)

---

## Out of Scope (explicit exclusions)

Items explicitly excluded from v1.2 with reasoning. Re-evaluate at milestone boundaries.

- **HIPAA BAA paid activation** — Supabase Team tier ($599/mo) + BAA chain only activates when a clinic prospect requires it. v1.2 maintains "sensitive data, not HIPAA" stance with disclaimers + minimization. The single non-aggressive pick during scoping; pragmatic financial decision.
- **EHR direct integration** (HL7, FHIR, Epic) — significant compliance + integration story; gates faster shipping. Stays in original PROJECT.md Out of Scope.
- **Group / family accounts** — multi-user accounts under one billing; deferred. Explicit PROJECT.md Out of Scope.
- **Custom rank weights / dose-trend alerts** — clinic-expansion features deferred to v1.3.
- **Ads on clinic / doctor-share surfaces** — NEVER. B2B trust constraint. Triple-layered enforcement (AD-03 component gate + AD-02 Edge Function + CSP report-only header + Playwright e2e in Phase 0).
- **Ad targeting using HealthKit data** — NEVER. Apple §5.1.3. Two-tunnel firewall (HEALTH-07) enforces structurally.
- **Native iOS/Android apps as full rewrite** — Capacitor wraps the existing SPA. React Native rewrite explicitly rejected per Stack research (would force ~50 component port for zero benefit).
- **Stripe for iOS/Android in-app subscriptions** — Apple §3.1.1 + Google §3.1.1 forbid. RevenueCat is the only path (MONEY-06). Stripe is web-only + clinic seats + affiliate payouts.
- **Cross-platform watch via Capacitor / Flutter** — Capacitor doesn't support watchOS; Flutter immature on watchOS. Watch is native (Swift + Kotlin), period.
- **AppLovin MAX mediation** — defer until production eCPM data justifies it (no maintained Capacitor 8 plugin → custom native bridge cost).
- **Turborepo monorepo migration** — polyrepo+ stays per ARCHITECTURE.md (all Turbo-coordinable work is one TS project; migration cost > caching benefit).
- **Craft.js page builder framework** — rejected; dnd-kit primitives + in-house components per PROJECT.md "in-house (NOT SaaS)" constraint.

---

## Cross-cutting Concerns

These cut across multiple workstreams. Each future phase's CONTEXT.md must address its share.

1. **Affiliate ledger × IRS 1099 retention vs GDPR deletion** — `ON DELETE SET NULL` + anonymization, NEVER `ON DELETE CASCADE`. **Owners:** AFF-10 + DEL-02 jointly.
2. **No ads on B2B surfaces — TRIPLE-layered:** AD-03 component check + AD-02 Edge Function + CSP report-only + Playwright e2e in Phase 0.
3. **Bundle ceiling: 24.5 kB gz target, 50 kB hard ceiling.** Every new SDK via `sync-defer.ts`. Per-chunk ceilings added in Phase 0 (fixes `assert-clinic-bundle-budget.sh` hash-hyphen bug first per `reference_bundle_budget_hash_hyphen.md`).
4. **Two-tunnel firewall is cross-phase contract** between Phase 6 (HEALTH-07 implementation) and Phase 8 (AD-04 audit).
5. **App Store Review Submission Checklist** — Phase 4 hard gate; Phase 8 + Phase 9 contribute (Pitfalls 1, 2, 3, 8, 9, 14, 17, 19, 26 + SKAdNetwork IDs).
6. **Resend domain verification is Phase-0 prerequisite** — carry-over from v1.1.
7. **Capacitor process model** — WebView + plugins one process on iOS; defense is logical isolation, not OS process isolation. Surface in Phase 4 + Phase 6 + Phase 8 CONTEXT.md.

---

## Open Questions (locked at plan-phase, not milestone scope)

1. **Clinic seat metering:** per-active-patient (synthesizer recommendation, locked in v1.2 baseline) — lock final at Phase 2 CONTEXT.md.
2. **Pharmacology projection paywall at GA or post-launch test?** — synthesizer recommends test in v1.2.x patches not GA. Lock at Phase 2 CONTEXT.md.
3. **Page builder embed-provider blocks (Calendly / YouTube / Tally) at v1.2 or v1.3?** — synthesizer recommends v1.3 follow-up. Lock at Phase 3 CONTEXT.md.


---

## Traceability

REQ-ID → Phase mapping completed by `gsd-roadmapper` 2026-05-13 (104 REQ-IDs → 12 phases).

| REQ-ID | Phase | Status |
|--------|-------|--------|
| DS-01 | Phase 13 | Pending |
| DS-02 | Phase 13 | Pending |
| DS-03 | Phase 13 | Pending |
| DS-04 | Phase 13 | Pending |
| DS-05 | Phase 13 | Pending |
| DS-06 | Phase 13 | Pending |
| DS-07 | Phase 13 | Pending |
| DS-08 | Phase 13 | Pending |
| DS-09 | Phase 13 | Pending |
| DS-10 | Phase 13 | Pending |
| DS-11 | Phase 13 | Pending |
| DS-12 | Phase 13 | Complete (Plan 13-07 follow-up, re-verified 2026-05-17) |
| MOBILE-01 | Phase 16 | Pending |
| MOBILE-02 | Phase 16 | Pending |
| MOBILE-03 | Phase 16 | Pending |
| MOBILE-04 | Phase 16 | Pending |
| MOBILE-05 | Phase 16 | Pending |
| MOBILE-06 | Phase 16 | Pending |
| MOBILE-07 | Phase 16 | Pending |
| MOBILE-08 | Phase 16 | Pending |
| MOBILE-09 | Phase 16 | Pending |
| MOBILE-10 | Phase 16 | Pending |
| WATCH-01 | Phase 21 | Deferred to v1.4 (descoped 2026-05-17) |
| WATCH-02 | Phase 21 | Deferred to v1.4 (descoped 2026-05-17) |
| WATCH-03 | Phase 21 | Deferred to v1.4 (descoped 2026-05-17) |
| WATCH-04 | Phase 21 | Deferred to v1.4 (descoped 2026-05-17) |
| WATCH-05 | Phase 21 | Deferred to v1.4 (descoped 2026-05-17) |
| WATCH-06 | Phase 21 | Deferred to v1.4 (descoped 2026-05-17) |
| WATCH-07 | Phase 21 | Deferred to v1.4 (descoped 2026-05-17) |
| WATCH-08 | Phase 21 | Deferred to v1.4 (descoped 2026-05-17) |
| HEALTH-01 | Phase 18 | Deferred to v1.4 (descoped 2026-05-17) |
| HEALTH-02 | Phase 18 | Deferred to v1.4 (descoped 2026-05-17) |
| HEALTH-03 | Phase 18 | Deferred to v1.4 (descoped 2026-05-17) |
| HEALTH-04 | Phase 18 | Deferred to v1.4 (descoped 2026-05-17) |
| HEALTH-05 | Phase 18 | Deferred to v1.4 (descoped 2026-05-17) |
| HEALTH-06 | Phase 18 | Deferred to v1.4 (descoped 2026-05-17) |
| HEALTH-07 | Phase 18 | Deferred to v1.4 (descoped 2026-05-17) |
| HEALTH-08 | Phase 18 | Deferred to v1.4 (descoped 2026-05-17) |
| ADMIN-01 | Phase 22 | Pending |
| ADMIN-02 | Phase 22 | Pending |
| ADMIN-03 | Phase 22 | Pending |
| ADMIN-04 | Phase 22 | Pending |
| ADMIN-05 | Phase 22 | Pending |
| ADMIN-06 | Phase 22 | Pending |
| ADMIN-07 | Phase 22 | Pending |
| ADMIN-08 | Phase 22 | Pending |
| MONEY-01 | Phase 14 | Pending |
| MONEY-02 | Phase 14 | Pending |
| MONEY-03 | Phase 14 | Pending |
| MONEY-04 | Phase 14 | Pending |
| MONEY-05 | Phase 14 | Pending |
| MONEY-06 | Phase 16 | Pending |
| MONEY-07 | Phase 19 | Pending |
| MONEY-08 | Phase 14 | Pending |
| MONEY-09 | Phase 14 | Pending |
| MONEY-10 | Phase 19 | Pending |
| PAGE-01 | Phase 15 | Pending |
| PAGE-02 | Phase 15 | Pending |
| PAGE-03 | Phase 15 | Pending |
| PAGE-04 | Phase 15 | Pending |
| PAGE-05 | Phase 15 | Pending |
| PAGE-06 | Phase 15 | Pending |
| PAGE-07 | Phase 15 | Pending |
| PAGE-08 | Phase 15 | Pending |
| PAGE-09 | Phase 15 | Pending |
| AFF-01 | Phase 19 | Pending |
| AFF-02 | Phase 19 | Pending |
| AFF-03 | Phase 19 | Pending |
| AFF-04 | Phase 19 | Pending |
| AFF-05 | Phase 19 | Pending |
| AFF-06 | Phase 19 | Pending |
| AFF-07 | Phase 19 | Pending |
| AFF-08 | Phase 19 | Pending |
| AFF-09 | Phase 19 | Pending |
| AFF-10 | Phase 19 | Pending |
| AD-01 | Phase 20 | Deferred to v1.4 (descoped 2026-05-17) |
| AD-02 | Phase 20 | Deferred to v1.4 (descoped 2026-05-17) |
| AD-03 | Phase 20 | Deferred to v1.4 (descoped 2026-05-17) |
| AD-04 | Phase 20 | Deferred to v1.4 (descoped 2026-05-17) |
| AD-05 | Phase 20 | Deferred to v1.4 (descoped 2026-05-17) |
| AD-06 | Phase 20 | Deferred to v1.4 (descoped 2026-05-17) |
| AD-07 | Phase 20 | Deferred to v1.4 (descoped 2026-05-17) |
| AD-08 | Phase 20 | Deferred to v1.4 (descoped 2026-05-17) |
| AD-09 | Phase 20 | Deferred to v1.4 (descoped 2026-05-17) |
| AD-10 | Phase 20 | Deferred to v1.4 (descoped 2026-05-17) |
| AD-11 | Phase 20 | Deferred to v1.4 (descoped 2026-05-17) |
| AD-12 | Phase 20 | Deferred to v1.4 (descoped 2026-05-17) |
| PUSH-01 | Phase 17 | Deferred to v1.4 (descoped 2026-05-17) |
| PUSH-02 | Phase 17 | Deferred to v1.4 (descoped 2026-05-17) |
| PUSH-03 | Phase 17 | Deferred to v1.4 (descoped 2026-05-17) |
| PUSH-05 | Phase 17 | Deferred to v1.4 (descoped 2026-05-17) |
| DEL-01 | Phase 22 | Pending |
| DEL-02 | Phase 22 | Pending |
| GDPR-01 | Phase 22 | Pending |
| GDPR-02 | Phase 22 | Pending |
| GDPR-03 | Phase 22 | Pending |
| ON-01 | Phase 22 | Deferred to v1.4 (descoped 2026-05-17) |
| ON-02 | Phase 22 | Pending |
| ON-03 | Phase 22 | Pending |
| DEBT-01 | Phase 23 | Pending |
| DEBT-02 | Phase 23 | Complete (Plan 23-01) |
| DEBT-03 | Phase 23 | Pending |
| DEBT-04 | Phase 23 | Complete (Plan 23-01) |
| DEBT-05 | Phase 23 | Pending |

### Coverage Summary

| Phase | REQ-IDs | Count |
|-------|---------|-------|
| Phase 12 | (none — bootstrap/prereq; owns cross-cutting concerns 2/3/5/6/7) | 0 |
| Phase 13 | DS-01..12 | 12 |
| Phase 14 | MONEY-01, 02, 03, 04, 05, 08, 09 | 7 |
| Phase 15 | PAGE-01..09 | 9 |
| Phase 16 | MOBILE-01..10, MONEY-06 | 11 |
| ~~Phase 17~~ | ~~PUSH-01, 02, 03, 05~~ — **deferred to v1.4 (2026-05-17)** | ~~4~~ |
| ~~Phase 18~~ | ~~HEALTH-01..08~~ — **deferred to v1.4 (2026-05-17)** | ~~8~~ |
| Phase 19 | AFF-01..10, MONEY-07, MONEY-10 | 12 |
| ~~Phase 20~~ | ~~AD-01..12~~ — **deferred to v1.4 (2026-05-17)** | ~~12~~ |
| ~~Phase 21~~ | ~~WATCH-01..08~~ — **deferred to v1.4 (2026-05-17)** | ~~8~~ |
| Phase 22 | ADMIN-01..08, DEL-01, 02, GDPR-01..03, ON-02..03 (ON-01 deferred to v1.4 via P22b) | 15 |
| Phase 23 | DEBT-01..05 | 5 |
| **v1.2 active total** | | **71** |
| **v1.4 deferred carry-over** | PUSH + HEALTH + AD + WATCH + ON-01 | **33** |
| **Original v1.2 scope** | | 104 |

**v1.2 coverage (after 2026-05-17 descope):** 71 active REQ-IDs across 8 shipped/in-flight phases (12/13/14/15/16/19/22/23). 33 REQ-IDs deferred to v1.4 milestone (Phases 17/18/20/21 + ON-01). User direction 2026-05-17: **"first I will verify and close 1.2 and then focus on additional features for 1.4. milstone 1.4 needs to forcus and close averything deffred and all tech debt"** — v1.4 absorbs the deferred phases + all v1.2-era tech debt + new features.

---

*REQUIREMENTS.md created 2026-05-13 from `/gsd-new-milestone` per-category review. 104 active REQ-IDs across 11 workstreams. Traceability mapping completed by `gsd-roadmapper` 2026-05-13.*
