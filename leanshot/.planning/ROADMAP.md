# Roadmap: LeanShot

## Current Milestone

**v1.2 — Polished Launch + Full Monetization + Ad Network** (started 2026-05-13)

Take LeanShot from "shipped multi-audience SaaS" to "launch-ready cross-platform product with full monetization, growth loops, and ad-network revenue." Web, mobile, watch — all on the new design system, with Stripe-powered subs/seats/affiliate plus a multi-mode advertising network as primary revenue stream.

**REQ-ID totals:** 104 across 11 workstreams (see `.planning/REQUIREMENTS.md`).
**Granularity:** `fine` · **Mode:** `mvp` · **Phase count:** 12 (numbered 12-23, continuing from v1.1)
**Research confidence:** HIGH (6 disagreements resolved at synthesis time)
**Backend platform:** Supabase (continued) · **Native shell:** Capacitor 8 · **IAP:** RevenueCat (iOS+Android) + Stripe (web/clinic/affiliate)

## Phases

**Phase Numbering:**
- Integer phases (12, 13, ...): Planned milestone work — continues from v1.1's last phase (11)
- Decimal phases (e.g. 14.1): Urgent insertions (marked with INSERTED)

- [ ] **Phase 12: Bootstrap & Bundle Foundations** - Pre-work: fix hash-hyphen bundle-budget bug, set up Two-tunnel firewall ESLint rule, verify Resend domain, provision Apple Dev / Play Console / Stripe Connect Express accounts (AdMob + AdSense deferred to Phase 20 per CONTEXT D-05), lock CSP + clinic-ad-free Playwright gate
- [x] **Phase 13: Design System v2 Rollout** - Geist + Fraunces + Geist Mono fonts, refreshed tokens, refreshed Card/Button/Pill/Sidebar/SiteRotation v2, full illustration set, marketing site visually current — tokens-only FIRST so every later phase ships on new tokens
- [ ] **Phase 14: Monetization Foundation (Stripe web + clinic seats)** - `subscriptions`/`subscription_events`/`stripe_customers` + `stripe-checkout`/`stripe-webhook` Edge Functions + `<TierGate>` + 7-day card-required trial + Customer Portal + clinic per-active-patient metered billing + web dunning — keystone; every downstream gates on `tier` (11/11 plans executed + gap closure; 14-VERIFICATION.md = verified — 5/5 SCs, all 7 code BLOCKERs closed, all 6 vendor/deploy checkpoints verified 6/6 via 14-HUMAN-UAT.md 2026-05-14; `/gsd-secure-phase 14` pending before phase-complete)
- [x] **Phase 15: Page Builder + Landing Pages** - `landing_pages` + `landing_page_revisions` + `page-assets` bucket + dnd-kit admin editor (lazy `admin-bundle`) + 8 semantic blocks + 5 templates + per-page SEO panel + version history + `page-render` Edge Function with Vercel ISR + `/pricing` wired to Stripe Checkout
- [ ] **Phase 16: Capacitor Mobile Shells (iOS + Android)** - `apps/ios/` + `apps/android/` Capacitor 8 shells + native bridge layer (`src/lib/native/`) + RevenueCat IAP (MANDATORY — Apple §3.1.1) + ASO assets + `PrivacyInfo.xcprivacy` + Universal Links / App Links + biometric unlock + WKWebView OOM mitigation (Storage transforms + react-virtuoso) + Sentry Capacitor SDK + native share sheet
- [ ] **Phase 17: Push Notifications** - `push_tokens` + `notification_log` + `push-fanout` Edge Function fans out to APNs + FCM + Web Push + watch piggy-back; per-category settings + quiet hours + snooze on dose reminders + iOS PWA-≥16.4 detection
- [ ] **Phase 18: HealthKit + Health Connect + Two-tunnel Firewall** - `@capgo/capacitor-health` single plugin + `src/lib/native/health.ts` + `health_imports` metadata-only table + weight/steps/sleep auto-fill + HR differentiator (dose-day overlay) + `NSHealthShareUsageDescription` + Health Connect intent filters + Two-tunnel firewall (ESLint `no-restricted-imports` + runtime guard + Privacy Manifest) BEFORE any ad SDK
- [x] **Phase 19: Affiliate Program + Stripe Connect** - `affiliates` + `affiliate_links` + `affiliate_clicks` + `affiliate_conversions` + `payouts` tables + `affiliate-attribute` Edge Function (server-side cookie, defeats Safari ITP) + Stripe Connect Express W-9/W-8BEN/1099-NEC + partner dashboard + fraud detection + co-branded `/r/{code}` landing pages + $10 single-tier flat + unified cross-provider tier (RevenueCat+Stripe) + account-deletion Stripe cascade
- [ ] **Phase 20: Ad Network (AdMob + GAM/AdSense + house ads)** - `ad_placements` + `ad_impressions` + `ad_revenue_daily` + `ad_blocklist` + `house_ads` + `<AdSlot>` (refuses on `/clinic/*` / `/share/*` / paid tier) + AdMob mobile-only + GPT lazy-loaded after consent + AdSense fallback waterfall + rewarded video + default GLP-1 advertiser block-list + `ad-config` + `ad-revenue-ingest` daily ETL + ATT prompt + SKAdNetwork IDs + ads.txt/app-ads.txt
- [ ] **Phase 21: Watch Apps (Apple Watch + WearOS)** - `apps/watch-ios/` (Swift+SwiftUI+WatchConnectivity+SwiftData) + `apps/watch-android/` (Kotlin+Compose for Wear+Wearable Data Layer) + next-dose complication/tile + streak badge + log-injection with haptic + hybrid sync (cloud-primary + WatchConnectivity live) + standalone REST fallback + dose-day HR overlay
- [ ] **Phase 22: Owner/Admin + Lifecycle Email + DSAR + Cookie Consent** - Members table + MRR/ARR/churn + impersonation with red banner + audit-logged refunds + feature-flag overrides + affiliate-payout review queue + cohort retention heatmap + in-app account deletion ≤3 taps + `account-delete` cascade Edge Function (Stripe + Connect + Resend + Storage + RLS) + `dsar-export` Edge Function + vanilla-cookieconsent + Consent Mode v2 + preference center + Resend lifecycle templates on new design tokens (ad-revenue dashboard carved out to Phase 20 per CONTEXT D-01; revamped 7-step onboarding deferred to Phase 22b per CONTEXT D-02)
- [ ] **Phase 23: v1.1 Tech Debt Sweep + Launch Polish** - CLINIC-07 operator drill-in "View activity" wiring + `s.user!` audit (15 occurrences / 14 files) + photo trash flow + 6 deferred tests batch-fix + knip + ts-unused-exports CI gate + final ASO polish

## Phase Details

### Phase 12: Bootstrap & Bundle Foundations
**Goal**: CI is ready to absorb 10 net-new workstreams without regression. The per-chunk bundle gate works correctly (hash-hyphen bug fixed). The Two-tunnel firewall is enforced as a static build failure BEFORE any health or ad code is written. The clinic-ad-free invariant is a Playwright gate. Resend domain `app.leanshot.app` is verified end-to-end. Human-prereq accounts (Apple Dev, Play Console, Stripe Connect Express) are provisioned and credentials live in Vercel + Supabase secrets. **AdMob + AdSense are Phase 20 entry conditions per CONTEXT.md D-05 — NOT Phase 12 gates** (rationale: AdSense publisher review typically requires a live deployed app, creating circular dependency with Phases 13/14).
**Mode:** mvp
**Depends on**: Nothing (entry phase for milestone v1.2)
**Requirements**: (none directly — infrastructure/prereq phase; cross-cutting concerns 2, 3, 5, 6, 7 originate here)
**Research flag**: Low
**Success Criteria** (what must be TRUE):
  1. CI `assert-clinic-bundle-budget.sh` correctly measures per-chunk gz size for filenames containing `-` in Vite content hash (regression fix for `reference_bundle_budget_hash_hyphen.md`); per-chunk ceilings declared for `stripe-elements`, `adsense-glue`, `page-builder-runtime`, `web-push`, `capacitor-bridge` and enforced as PR blocker
  2. ESLint `no-restricted-imports` rule forbids cross-imports between `src/lib/native/health.ts` and `src/lib/native/ads.ts` family files; rule produces a static build failure when violated (verified by a deliberately failing test file in a feature branch that does NOT merge)
  3. Playwright e2e `clinic-ad-free.spec.ts` asserts zero ad-provider script tags on `/clinic/*`, `/share/*`, `/admin/*` routes and zero `<AdSlot>` mounts on the same; runs in CI as a hard gate before any AD-* code lands
  4. User receives a real lifecycle email from `noreply@app.leanshot.app` via Resend (not the sandbox `onboarding@resend.dev`) — domain SPF/DKIM/DMARC verified and pinned in Supabase Function secrets
  5. Apple Developer Program + Google Play Console + Stripe Connect (Express) accounts are all live with API credentials captured in Vercel env + Supabase Function secrets per the naming convention in CONTEXT.md D-06. **AdMob + AdSense are explicitly NOT Phase 12 gates** — they become entry conditions on Phase 20 (Ad Network) per CONTEXT.md D-05.
**Plans:** 5 plans across 2 waves
  - Wave 1 (parallel):
    - [ ] 12-01-PLAN.md — Per-chunk bundle ceilings (5 v1.2 chunks) + hash-hyphen regression test (SC-1, CCC-3)
    - [ ] 12-02-PLAN.md — Two-tunnel firewall ESLint rule (full-spectrum D-02) + 6 native/* stubs + firewall-test-violation branch (SC-2, CCC-4)
    - [ ] 12-03-PLAN.md — clinic-ad-free Playwright e2e gate on /clinic/*, /share/*, /admin/* + CI wiring (SC-3, CCC-2)
    - [ ] 12-04-PLAN.md — CSP snapshot test (Vitest) + tests/csp/csp-snapshot.txt + vite.config.ts test.include extension (SC-4, CCC-5)
  - Wave 2 (serial, DNS-dependent):
    - [ ] 12-05-PLAN.md — Resend domain verification (app.leanshot.app) + Apple Dev + Play Console + Stripe Connect Express provisioning + PROJECT.md vendor-accounts checklist (SC-4 part 2, SC-5, CCC-6, CCC-7)

### Phase 13: Design System v2 Rollout
**Goal**: Every surface (app + marketing + emails + onboarding + auth pages) renders on the v2 token palette and the new component shapes. New illustrations replace the v1 hero/state art. Fonts load via `<link>` tags (NOT CSS `@import` chain) so no FCP regression. Tokens-only change FIRST means every subsequent phase ships components in new shapes without re-touching.
**Mode:** mvp
**Depends on**: Phase 12
**Requirements**: DS-01, DS-02, DS-03, DS-04, DS-05, DS-06, DS-07, DS-08, DS-09, DS-10, DS-11, DS-12
**Research flag**: Low
**Success Criteria** (what must be TRUE):
  1. User loads any page (marketing landing, login, dashboard home, any tab) and sees Geist (body) + Geist Mono (numeric/code) + Fraunces (display) rendered consistently; FCP on cold load is within 5% of pre-Phase-13 baseline (no font-loading regression)
  2. User navigates from marketing site → login → dashboard and observes consistent color / shadow / spacing / radius tokens — verified by a visual regression snapshot diff on at least 6 surface screens
  3. User interacts with refreshed Card (5 variants), Button (tonal + counter chips + loading), Pill (segmented + count badges + icon-only), and Sidebar (instant 72↔232px collapse + 200ms inner fade) without layout shift or focus-ring regressions
  4. User sees the new illustration set on every surface that previously had v1 art: AI avatar (organic-mesh), streak badges (bronze/silver/gold/locked), site-rotation v2 with zone labels + numbered dots, pen-injector, achievement-shield, activity-rings, doctor-clipboard, heart-pulse, calendar-dose, 4 empty states, hero-orbital
  5. User signs in via the new split-screen login page (form left, hero illustration right) — verified responsive at ≥768px breakpoint and gracefully stacking below
**Plans:** 12 plans across 4 waves
  - Wave 0 (foundation — schema + scaffolds + BLOCKING db push):
    - [ ] 22-01-PLAN.md — 16 migrations + 35 test scaffolds + A1 Postman probe + supabase db push --linked [BLOCKING]
  - Wave 1 (parallel — backend Edge Functions; depends on 22-01):
    - [ ] 22-02-PLAN.md — _shared/resend-domain-health-check + 5 lifecycle Edge Functions + 12 templates (ON-02)
    - [ ] 22-03-PLAN.md — admin-impersonate + admin-stripe-action Edge Functions (ADMIN-03, ADMIN-04)
    - [ ] 22-04-PLAN.md — dsar-export Edge Function + pdf-render + dsar_request RPCs (GDPR-03)
  - Wave 2 (parallel — UI + cross-cutting; depends on 22-01 + Wave-1 outputs):
    - [ ] 22-05-PLAN.md — DEL-01 modal sweep (30d→7d) + SoftDeleteCountdownBanner + cancel-link route (DEL-01, DEL-02)
    - [ ] 22-06-PLAN.md — AdminLayout + Members table + Member drill-in (6 tabs) + feature-flag overrides wrapper (ADMIN-01, ADMIN-05)
    - [ ] 22-07-PLAN.md — RefundModal + CancelSubModal + CompSubModal + AdminAffiliatesReviewQueue (ADMIN-04, ADMIN-06 closes Phase 19 BL-11 status-graph gap)
    - [ ] 22-08-PLAN.md — AdminMetricsPage + CohortHeatmap CSS-grid (ADMIN-02, ADMIN-08)
    - [ ] 22-09-PLAN.md — ImpersonationBanner + useImpersonation + useImpersonationReadOnly hooks (ADMIN-03)
    - [ ] 22-10-PLAN.md — vanilla-cookieconsent + Consent Mode v2 + consent_records audit (GDPR-01, GDPR-02)
    - [ ] 22-11-PLAN.md — DsarPortalPage + EmailPreferencesPage + SettingsPage sub-page links (GDPR-03 UI, ON-03)
  - Wave 3 (closeout — integration + RLS proofs + VALIDATION):
    - [ ] 22-12-PLAN.md — App.tsx wiring (3 banners + 4 lazy routes + loadOverrides) + 12 e2e/RLS proofs + VALIDATION.md per-task rows
**UI hint**: yes (UI-SPEC shipped 2026-05-16, ui-checker 6/6 PASS first iteration)

### Phase 14: Monetization Foundation (Stripe web + clinic seats)
**Goal**: A web user can subscribe to a paid plan via Stripe Checkout (7-day card-required trial), manage their subscription via Stripe Customer Portal, and downstream features gate cleanly on the `tier` field. A clinic owner is billed per-active-patient (synthesizer recommendation) with monthly true-up via Stripe metered billing. Webhook state from Stripe is the source of truth — the DB never drifts. Card-failure dunning surfaces a `past_due` banner and a retry-card flow.
**Mode:** mvp
**Depends on**: Phase 13
**Requirements**: MONEY-01, MONEY-02, MONEY-03, MONEY-04, MONEY-05, MONEY-08, MONEY-09
**Research flag**: Marginal (Stripe webhook signature verification on Deno + Checkout-vs-Elements lock)
**Success Criteria** (what must be TRUE):
  1. User on the web app clicks "Upgrade" → lands on Stripe Checkout → enters card → starts a 7-day trial → returns to the app → sees `tier='paid'` reflected in UI (ad-free, advanced AI, optional pharma-projection); on day 8 Stripe auto-charges, `subscriptions` row stays current
  2. User opens "Manage subscription" → opens Stripe-hosted Customer Portal in a new tab → changes payment method / cancels / changes plan → returns to the app → `subscription_events` webhook landed and `tier` reflects the change within 10 seconds
  3. Clinic owner adds their 11th patient → Stripe metered billing line item is incremented for the current period → end-of-month invoice reflects the per-active-patient charge for all 11
  4. User's card fails mid-cycle → Stripe Smart Retries kick in (retries 1/3/5) → user sees `past_due` banner in UI + receives Stripe-driven dunning email; banner clears on successful retry
  5. Visitor sees a pricing page (built via Phase 15 PAGE-09 wire-up later) with a comparison table; clicking "Subscribe" lands them on live Stripe Checkout with the correct price ID; `<TierGate>` correctly blocks premium features for `tier='free'` users
**Plans:** 12 plans across 4 waves
  - Wave 0 (foundation — schema + scaffolds + BLOCKING db push):
    - [ ] 22-01-PLAN.md — 16 migrations + 35 test scaffolds + A1 Postman probe + supabase db push --linked [BLOCKING]
  - Wave 1 (parallel — backend Edge Functions; depends on 22-01):
    - [ ] 22-02-PLAN.md — _shared/resend-domain-health-check + 5 lifecycle Edge Functions + 12 templates (ON-02)
    - [ ] 22-03-PLAN.md — admin-impersonate + admin-stripe-action Edge Functions (ADMIN-03, ADMIN-04)
    - [ ] 22-04-PLAN.md — dsar-export Edge Function + pdf-render + dsar_request RPCs (GDPR-03)
  - Wave 2 (parallel — UI + cross-cutting; depends on 22-01 + Wave-1 outputs):
    - [ ] 22-05-PLAN.md — DEL-01 modal sweep (30d→7d) + SoftDeleteCountdownBanner + cancel-link route (DEL-01, DEL-02)
    - [ ] 22-06-PLAN.md — AdminLayout + Members table + Member drill-in (6 tabs) + feature-flag overrides wrapper (ADMIN-01, ADMIN-05)
    - [ ] 22-07-PLAN.md — RefundModal + CancelSubModal + CompSubModal + AdminAffiliatesReviewQueue (ADMIN-04, ADMIN-06 closes Phase 19 BL-11 status-graph gap)
    - [ ] 22-08-PLAN.md — AdminMetricsPage + CohortHeatmap CSS-grid (ADMIN-02, ADMIN-08)
    - [ ] 22-09-PLAN.md — ImpersonationBanner + useImpersonation + useImpersonationReadOnly hooks (ADMIN-03)
    - [ ] 22-10-PLAN.md — vanilla-cookieconsent + Consent Mode v2 + consent_records audit (GDPR-01, GDPR-02)
    - [ ] 22-11-PLAN.md — DsarPortalPage + EmailPreferencesPage + SettingsPage sub-page links (GDPR-03 UI, ON-03)
  - Wave 3 (closeout — integration + RLS proofs + VALIDATION):
    - [ ] 22-12-PLAN.md — App.tsx wiring (3 banners + 4 lazy routes + loadOverrides) + 12 e2e/RLS proofs + VALIDATION.md per-task rows
**UI hint**: yes (UI-SPEC shipped 2026-05-16, ui-checker 6/6 PASS first iteration)
**Open questions locked at CONTEXT.md**: (1) Clinic seat metering: per-active-patient vs per-operator. (2) Pharmacology projection paywall at GA or v1.2.x test.

### Phase 15: Page Builder + Landing Pages
**Goal**: Admin can build, preview, version, publish, and SEO-tune landing pages via an in-house drag-and-drop editor that lives in a lazy `admin-bundle` chunk (public visitors never download the editor). The renderer is a tiny recursive component that ships in a separate Vite entry deployed to the marketing host. The pricing page is the first real customer of the builder, wired to Stripe Checkout live price IDs.
**Mode:** mvp
**Depends on**: Phase 13 (design tokens are the component palette), Phase 14 (pricing page wires to Stripe)
**Requirements**: PAGE-01, PAGE-02, PAGE-03, PAGE-04, PAGE-05, PAGE-06, PAGE-07, PAGE-08, PAGE-09
**Research flag**: Small (1-day Tailwind v4 + dnd-kit spike)
**Success Criteria** (what must be TRUE):
  1. Admin opens `/admin/pages/new` → picks a template (long-form sales / lead-magnet opt-in / comparison / FAQ / testimonial-driven) → drags 8 semantic blocks (Hero/CTA/FAQ/Pricing/Testimonial/Feature grid/Image+text/Footer) into a tree → edits properties in right-rail → publishes → visitor loads the slug and sees the published page rendered with no layout shift
  2. Admin saves a page → `landing_page_revisions` gains an append-only row → admin opens version history → restores a prior revision → live URL reflects the restore within ISR window
  3. Published landing page is served as static HTML via `page-render` Edge Function + Vercel ISR — visitor's browser does NOT download the editor React bundle (verified by Network tab) and Lighthouse score on the page is ≥ 90 Performance + ≥ 95 Accessibility
  4. Per-page SEO panel writes title / description / OG tags / canonical / JSON-LD into rendered HTML; `sitemap.xml` + `robots.txt` auto-include all published pages; search-engine crawler simulator (Lighthouse SEO + manual `curl` of OG meta) confirms tags present
  5. `/pricing` page uses the Pricing template + Checkout-button block wired to live Stripe price IDs (MONEY-08 consumer); clicking the button takes the visitor straight to Stripe Checkout
**Plans:** 12 plans across 4 waves
  - Wave 0 (foundation — schema + scaffolds + BLOCKING db push):
    - [ ] 22-01-PLAN.md — 16 migrations + 35 test scaffolds + A1 Postman probe + supabase db push --linked [BLOCKING]
  - Wave 1 (parallel — backend Edge Functions; depends on 22-01):
    - [ ] 22-02-PLAN.md — _shared/resend-domain-health-check + 5 lifecycle Edge Functions + 12 templates (ON-02)
    - [ ] 22-03-PLAN.md — admin-impersonate + admin-stripe-action Edge Functions (ADMIN-03, ADMIN-04)
    - [ ] 22-04-PLAN.md — dsar-export Edge Function + pdf-render + dsar_request RPCs (GDPR-03)
  - Wave 2 (parallel — UI + cross-cutting; depends on 22-01 + Wave-1 outputs):
    - [ ] 22-05-PLAN.md — DEL-01 modal sweep (30d→7d) + SoftDeleteCountdownBanner + cancel-link route (DEL-01, DEL-02)
    - [ ] 22-06-PLAN.md — AdminLayout + Members table + Member drill-in (6 tabs) + feature-flag overrides wrapper (ADMIN-01, ADMIN-05)
    - [ ] 22-07-PLAN.md — RefundModal + CancelSubModal + CompSubModal + AdminAffiliatesReviewQueue (ADMIN-04, ADMIN-06 closes Phase 19 BL-11 status-graph gap)
    - [ ] 22-08-PLAN.md — AdminMetricsPage + CohortHeatmap CSS-grid (ADMIN-02, ADMIN-08)
    - [ ] 22-09-PLAN.md — ImpersonationBanner + useImpersonation + useImpersonationReadOnly hooks (ADMIN-03)
    - [ ] 22-10-PLAN.md — vanilla-cookieconsent + Consent Mode v2 + consent_records audit (GDPR-01, GDPR-02)
    - [ ] 22-11-PLAN.md — DsarPortalPage + EmailPreferencesPage + SettingsPage sub-page links (GDPR-03 UI, ON-03)
  - Wave 3 (closeout — integration + RLS proofs + VALIDATION):
    - [ ] 22-12-PLAN.md — App.tsx wiring (3 banners + 4 lazy routes + loadOverrides) + 12 e2e/RLS proofs + VALIDATION.md per-task rows
**UI hint**: yes (UI-SPEC shipped 2026-05-16, ui-checker 6/6 PASS first iteration)
**Open questions locked at CONTEXT.md**: (3) Page-builder embed-provider blocks (Calendly / YouTube / Tally) at v1.2 or v1.3.

### Phase 17: Push Notifications
**Goal**: A user receives the right notification on the right device at the right time — dose reminder (with snooze), AI insight, clinic alert, billing dunning, or marketing — via a single `push-fanout` Edge Function that routes to APNs / FCM / Web Push / watch piggy-back. Quiet hours + frequency caps apply once per user (not per channel). iOS PWA users on ≥16.4 get Web Push if the PWA is installed; otherwise the native Capacitor app gets APNs.
**Mode:** mvp
**Depends on**: Phase 16 (Capacitor bridge for native push)
**Requirements**: PUSH-01, PUSH-02, PUSH-03, PUSH-05
**Research flag**: Low
**Success Criteria** (what must be TRUE):
  1. User opens Settings → notification preferences → toggles per-category (dose reminders / AI insights / clinic alerts / billing / marketing) + sets quiet hours (e.g. 22:00-07:00) + sets snooze duration → preferences persist server-side and dose reminders never fire during quiet hours
  2. User receives a single dose-reminder notification (not duplicated across web + iOS + watch) — `push-fanout` deduplicates per user with a 5-minute idempotency key
  3. iOS user with PWA installed on iOS ≥16.4 receives Web Push when not running the native app; same user with native Capacitor app installed receives APNs (Web Push fallback used only when native unavailable)
  4. User taps "Snooze 10 min" on a dose-reminder push → a new push fires exactly 10 minutes later (delivered via the same fan-out)
  5. User whose card fails (Phase 14 MONEY-09) receives a billing push within 60 seconds of Stripe Smart Retry escalation — verified by an automated test that injects a `invoice.payment_failed` webhook
**Plans**: TBD

### Phase 18: HealthKit + Health Connect + Firewall enforcement
**Goal**: A user grants per-metric Health permission (weight + steps + sleep + HR) and the corresponding tabs auto-fill from HealthKit (iOS) / Health Connect (Android) via the single `@capgo/capacitor-health` plugin. The Two-tunnel firewall is enforced as code, runtime, and manifest — HealthKit data structurally cannot reach the ad SDK. `health_imports` records metadata only (count, last-sync) — NEVER raw Health values. Physical-device smoke test on iOS + Android passes before App Store / Play Store submission.
**Mode:** mvp
**Depends on**: Phase 16 (Capacitor bridge)
**Requirements**: HEALTH-01, HEALTH-02, HEALTH-03, HEALTH-04, HEALTH-05, HEALTH-06, HEALTH-07, HEALTH-08
**Research flag**: Marginal (re-verify Capgo plugin maintenance state)
**Success Criteria** (what must be TRUE):
  1. User taps "Auto-fill from Health" in BodyTab → sees a per-metric pre-prompt explaining what data is read and why → grants weight access → today's weight auto-fills; the same flow works for steps (→ ActivityTab) and sleep duration + stages (→ SleepTab)
  2. User opens InsightsTab → sees HR-derived context (e.g. "your resting HR was 5 bpm higher on dose-day") without HR being auto-logged as a manual entry; watch user sees the dose-day HR overlay on the watch face (Phase 21 WATCH-08 consumer)
  3. Static build fails (ESLint + TypeScript) if any file in `src/lib/native/ads*.ts` imports from `src/lib/native/health*.ts` (or vice versa) — verified by a deliberately failing fixture branch
  4. Runtime `src/lib/ads/firewall.ts` aborts AdMob.initialize() if it detects a HealthKit permission was ever granted on this device — verified by a Playwright integration test on a Capacitor build
  5. App Store + Play Console accept the submission with `NSHealthShareUsageDescription` (iOS Info.plist), Health Connect intent filters (Android manifest), and `PrivacyInfo.xcprivacy` declaring HealthKit `NSPrivacyCollectedDataTypeLinked=false`; physical-device smoke test on iPhone + Android phone confirms no silent-fail (Pitfall 9)
**Plans**: TBD

### Phase 19: Affiliate Program + Stripe Connect
**Goal**: An affiliate applies, gets manually approved, completes Stripe Connect Express onboarding (with hosted W-9 / W-8BEN / 1099-NEC), gets a referral URL `leanshot.app/r/{code}`, and views a partner dashboard with clicks / conversions / commissions / payouts / downloadable marketing assets. The referral cookie is set server-side via Edge Function with `HttpOnly` first-party cookie (30-day TTL, defeats Safari ITP). Co-branded landing pages live at `/r/{code}` (template-based via Phase 15 builder). Single-tier $10 flat per paid conversion at v1.2. Fraud detection flags suspicious conversions for manual review. Account deletion anonymizes the affiliate ledger via `ON DELETE SET NULL` (NEVER cascade — IRS 1099 7-year retention requirement). The unified `tier` field reconciles across RevenueCat + Stripe. The full account-deletion Stripe cascade is owned here.
**Mode:** mvp
**Depends on**: Phase 14 (Stripe foundation), Phase 15 (co-branded landing pages)
**Requirements**: AFF-01, AFF-02, AFF-03, AFF-04, AFF-05, AFF-06, AFF-07, AFF-08, AFF-09, AFF-10, MONEY-07, MONEY-10
**Research flag**: Small (Stripe Connect Express 2025-2026 UI walkthrough)
**Success Criteria** (what must be TRUE):
  1. Visitor clicks `leanshot.app/r/coachjane` → server-side cookie (`HttpOnly`, 30-day TTL) is set via `affiliate-attribute` Edge Function → visitor lands on co-branded landing page with coach Jane's name/photo/Calendly link → signs up → subscribes via Stripe Checkout (web) OR RevenueCat (iOS/Android) → Jane's `affiliate_conversions` row gains an entry → her partner dashboard reflects the conversion within 10 minutes
  2. Affiliate completes Stripe Connect Express onboarding (hosted by Stripe — we never build tax-form UI) → W-9 or W-8BEN filed → on day 60-90 (chargeback hold) the `affiliate-payout` Edge Function batches payouts for the month → affiliate receives the $10 commission via Stripe; 1099-NEC is auto-generated by Stripe at year-end for affiliates over the $500/30d enforcement threshold
  3. Suspicious conversion (converter shares IP / device fingerprint / email domain with referring affiliate) is flagged → appears in admin review queue (Phase 22 ADMIN-06) with fraud signals → admin approves or rejects → state propagates to affiliate dashboard
  4. User who has two overlapping Stripe subscriptions (e.g. personal `paid` tier + clinic seat) sees a single `tier=paid` field reflecting MAX(`current_period_end`) — verified by a test that inserts two `subscriptions` rows with `provider=stripe` and overlapping windows. **Forward-compatibility test:** inserting a third row with `provider=revenuecat` keeps the view returning MAX (zero-change RC integration when P16-06 resumes). _Reformulated from original cross-provider phrasing per CONTEXT D-02 / P16 deferral._
  5. User deletes their account (Phase 22 DEL-01 surface) → `account-delete` Edge Function cascades: Stripe customer deleted + Connect account deleted (queued if open payouts) + payment intents voided + Resend audience deleted + Storage deleted + `auth.admin.deleteUser` called; `payouts` rows are RETAINED (IRS 7yr) + `affiliate_ledger` is anonymized via `ON DELETE SET NULL` + email hashed — verified by a CI cascade test (Pitfall 7 mitigation)
**Plans:** 9 plans across 3 waves
  - Wave 1 (parallel — Wave-0 smokes embedded as Task 1 of plans 19-02 + 19-03):
    - [x] 19-01-schema-rls-tier-effective-PLAN.md — affiliates + clicks + conversions + payouts tables + RLS + tier_effective view (AFF-01, AFF-10, MONEY-07)
    - [x] 19-02-affiliate-attribute-edge-fn-PLAN.md — public /r/{code} Edge Function with dual-cookie (D-21) + Vercel rewrite smoke D-37 #1 (AFF-02)
    - [x] 19-03-stripe-connect-onboard-PLAN.md — stripe-connect-onboard + partner-account-status Edge Functions + transfers-capability smoke D-37 #2 (AFF-03)
  - Wave 2 (parallel — depends on Wave 1; uses pathspec commits for stripe-checkout + stripe-webhook shared files):
    - [x] 19-04-stripe-webhook-affiliate-conversion-PLAN.md — invoice.paid + account.updated extensions + stripe-checkout ?aff= plumbing + D-36 renewal filter (AFF-02, AFF-03)
    - [x] 19-05-affiliate-apply-form-admin-scaffold-PLAN.md — affiliate-apply Edge Function + AffiliateApplyForm + AdminAffiliatesScaffold + InitialsAvatar primitive + Resend templates (AFF-05)
    - [x] 19-06-partner-dashboard-tree-PLAN.md — /partner/dashboard + links + payouts + assets + StripeConnectOnboardingCard (AFF-04, AFF-08)
    - [x] 19-07-fraud-signals-PLAN.md — fraud trigger + Z-score matview + ThumbmarkJS lazy fingerprint (AFF-07, AFF-08)
    - [x] 19-08-landing-page-templates-PLAN.md — 3 landing-page templates (coach/story/method) + marketing-assets bucket seed (AFF-09, AFF-04)
  - Wave 3 (closes phase — [BLOCKING] schema push):
    - [x] 19-09-payout-cron-account-delete-cascade-PLAN.md — monthly payout cron + transfers.create + account-delete Edge Function + e2e cascade + [BLOCKING] supabase db push (AFF-06, AFF-10, MONEY-10)
**Open questions locked at CONTEXT.md**: D-31 amendment ($500 W-9 is platform-set policy not Stripe default); D-36 (renewals do NOT count as conversions); D-37 (Wave-0 smoke verifications)

### Phase 20: Ad Network (AdMob + GAM/AdSense + house ads)
> **DEFERRED 2026-05-16** — Phase 20 deferred until P16 (Capacitor shells) + P18 (HealthKit + runtime firewall) ship. P20's mobile AdMob bridge depends on both; without P16+P18 the ATT prompt + SKAdNetwork + Privacy Manifest paths can't be verified. The Phase 22 ad-revenue dashboard piece carves out into a P20 deliverable when P20 resumes. ROADMAP order becomes: 19 ✓ → (P20 ⏸) → 22 → 23 → 16 → 17 → 18 → 20 → 21. /gsd-discuss-phase 20 was invoked 2026-05-16; user picked "Defer all of P20 until P16+P18 ship" rather than ship-web-only or stub-mobile.

**Goal**: Free-tier patients see ads on web (Google Ad Manager / AdSense) + mobile (AdMob) + a house-ad waterfall fallback when third-party fill is empty. Paid-tier patients see zero ads. Clinic + doctor-share surfaces see zero ads (TRIPLE-layered: `<AdSlot>` component refuses + `ad-config` Edge Function refuses + CSP report-only header + Playwright e2e from Phase 12). The Two-tunnel firewall enforces that NO HealthKit data ever reaches AdMob (Apple §5.1.3). ATT prompt fires before AdMob init on iOS; SKAdNetwork IDs in Info.plist; ads.txt + app-ads.txt published. Three placements only (marketing sidebar / free-tier dashboard banner / interstitial). Default GLP-1 advertiser block-list active. Rewarded video unlocks premium-for-the-day (~3-4x interstitial eCPM).
**Mode:** mvp
**Depends on**: Phase 14 (`tier` field), Phase 18 (firewall enforcement), Phase 22 (admin revenue dashboard cross-ref — but ad-revenue tables ship here; admin UI consumes)
**Requirements**: AD-01, AD-02, AD-03, AD-04, AD-05, AD-06, AD-07, AD-08, AD-09, AD-10, AD-11, AD-12
**Research flag**: **HIGH** — AdMob + GAM + AdSense Reporting ETL; recommend `/gsd-research-phase`
**Success Criteria** (what must be TRUE):
  1. Free-tier user opens the web dashboard → sees an ad in the designated free-tier slot (served by GPT after cookie consent granted) → upgrades to paid → ads disappear immediately on next route navigation (verified by a Playwright test that flips tier)
  2. Clinic operator opens `/clinic/{slug}` on any platform → ZERO ad-provider script tags load on the page (verified by Phase 12 Playwright `clinic-ad-free.spec.ts`); doctor opening `/share/{token}` sees the same — TRIPLE-layered enforcement holds under hostile mock states
  3. iOS user on free tier sees the ATT prompt on first launch BEFORE AdMob.initialize() fires (verified by Capacitor build behavior); SKAdNetwork IDs are in `Info.plist`; `app-ads.txt` is published at `https://leanshot.app/app-ads.txt`
  4. Free-tier user watches a rewarded video → gets the configured reward (premium insight for the day, extra AI prompts, or dose-history PDF) → `ad_impressions` records the rewarded view with `reward_granted=true`; admin sees the impression in revenue dashboard
  5. Daily 02:00 UTC `ad-revenue-ingest` cron pulls revenue from AdMob / Ad Manager / AdSense Reporting APIs into `ad_revenue_daily` → admin opens revenue dashboard → sees eCPM / RPM / fill rate / CTR per placement per provider for yesterday; advertiser block-list (default-blocks all GLP-1 brand names + compound pharmacies + DTC telehealth) is editable from admin UI
**Plans**: TBD

### Phase 21: Watch Apps (Apple Watch + WearOS)
**Goal**: A user installs the Apple Watch app (bundled with the iOS companion submission) and the WearOS app (bundled with the Android companion submission). The watch shows next-dose countdown + suggested site as a complication (watchOS) / tile (WearOS) and streak badge. The user logs an injection from the watch (tap → confirm → haptic → "logged"). Hybrid sync: Supabase Realtime is source of truth, WatchConnectivity (iOS) / Wearable Data Layer (WearOS) carries live channel when phone is reachable. Standalone fallback: direct Supabase REST when phone unreachable.
**Mode:** mvp
**Depends on**: Phase 16 (Capacitor + native bridge), Phase 17 (push fan-out — watch piggy-back), Phase 18 (HEALTH-05 firewall-isolated HR read for WATCH-08)
**Requirements**: WATCH-01, WATCH-02, WATCH-03, WATCH-04, WATCH-05, WATCH-06, WATCH-07, WATCH-08
**Research flag**: **HIGH** — new Swift + Kotlin surface area; recommend `/gsd-research-phase`
**Success Criteria** (what must be TRUE):
  1. User installs the Apple Watch app (bundled with iOS App Store submission) → adds the next-dose complication to a watch face → sees a countdown ("3h 12m") + suggested site ("Right thigh") at a glance, refreshing within 1 minute of state changes
  2. WearOS user installs the watch app (bundled with Play Store submission) → adds the next-dose tile → sees the same countdown + site suggestion on their Pixel Watch / Galaxy Watch
  3. User taps the complication / tile → confirms site → feels a haptic confirmation → sees "logged" on watch face → injection appears on phone within 5 seconds via WatchConnectivity (iOS) / Wearable Data Layer (WearOS); same flow works when phone is unreachable (standalone REST fallback queues, reconciles on phone-return)
  4. User sees the streak badge (from Phase 13 DS-10) on the watch face complication, updating in real time as the streak increments past 7/14/30/etc.
  5. User on dose-day sees the HR overlay on the watch (depends on Phase 18 HEALTH-05 firewall-isolated HR read — HR never reaches AdMob)
**Plans**: TBD

### Phase 22: Owner/Admin + Lifecycle Email + DSAR + Cookie Consent
**Goal**: The owner / admin can see everything material to running LeanShot: members table with search/filter, financial metrics (MRR / ARR / churn / clinic seat utilization), impersonation with red-banner audit trail, refunds / sub-cancels / comps with full audit, feature-flag overrides, affiliate-payout review queue (consumes Phase 19 fraud signals), ad-revenue dashboard (consumes Phase 20 daily ETL), and cohort retention heatmap. Patients can delete their account in ≤3 taps from in-app settings (App Store §5.1.1(v) compliance) with the full cascade running through `account-delete` Edge Function (Stripe + Connect + Resend + Storage + RLS + retention exceptions). EU visitors see cookie consent with granular Essential / Analytics / Marketing / Personalization toggles (Consent Mode v2). DSAR portal lets users export their data in JSON + PDF (30-day SLA). Lifecycle email templates (welcome / behavior-triggered / transactional / retention) all ship on new design tokens. Revamped 7-step onboarding incorporates watch pairing + Health permission + push permission + affiliate-attribution capture.
**Mode:** mvp
**Depends on**: Every prior phase's data (final cross-cutting layer)
**Requirements**: ADMIN-01, ADMIN-02, ADMIN-03, ADMIN-04, ADMIN-05, ADMIN-06, ADMIN-08, DEL-01, DEL-02, GDPR-01, GDPR-02, GDPR-03, ON-02, ON-03 (ADMIN-07 carved out to Phase 20 per CONTEXT D-01; ON-01 deferred to Phase 22b per CONTEXT D-02)
**Research flag**: Marginal (DSAR contract-test pattern is novel)
**Success Criteria** (what must be TRUE):
  1. Owner opens admin → sees members table sortable by tier / signup / last-active / clinic / country / billing status → impersonates a user → sees red banner ("Impersonating user@example.com — 30 min remaining") → operates as the user → returns to admin → `audit_logs` carries the impersonation entry visible to both owner and impersonated user
  2. User opens Settings → "Delete my account" → confirms via typed-text "DELETE" → enters 7-day soft-delete grace period (cancellable from a confirmation email link) → on day 8 the `account-delete` Edge Function cascades: Stripe customer + sub + Connect deleted; Resend audience deleted; Storage emptied; RLS rows deleted; `auth.admin.deleteUser` called; `payouts` retained (IRS 7yr) + `audit_logs` anonymized + `affiliate_ledger` anonymized via `ON DELETE SET NULL` — verified by a CI cascade-completeness test
  3. EU visitor lands on marketing site → sees cookie consent banner (vanilla-cookieconsent + Consent Mode v2) with granular Essential / Analytics / Marketing / Personalization toggles defaulted off → grants Analytics → PostHog loads via dynamic `import()` AFTER consent; same visitor in US sees Analytics default on (CCPA); `consent_records` row stores the consent state server-side for audit
  4. User opens DSAR portal → requests data export → receives email link → downloads a JSON + PDF bundle including data from Postgres + Storage photos + Stripe payment history + PostHog event log + affiliate ledger (anonymized for others' rows) within the 30-day SLA
  5. New user goes through revamped 7-step onboarding on new design tokens → watch-pairing step (skippable) → Health-permission step (skippable) → push-permission step → affiliate-attribution auto-captures from cookie if present → 24 hours after signup receives welcome email day-0 from `noreply@app.leanshot.app` on new design tokens (Resend domain verified in Phase 12)
**Plans:** 12 plans across 4 waves
  - Wave 0 (foundation — schema + scaffolds + BLOCKING db push):
    - [ ] 22-01-PLAN.md — 16 migrations + 35 test scaffolds + A1 Postman probe + supabase db push --linked [BLOCKING]
  - Wave 1 (parallel — backend Edge Functions; depends on 22-01):
    - [ ] 22-02-PLAN.md — _shared/resend-domain-health-check + 5 lifecycle Edge Functions + 12 templates (ON-02)
    - [ ] 22-03-PLAN.md — admin-impersonate + admin-stripe-action Edge Functions (ADMIN-03, ADMIN-04)
    - [ ] 22-04-PLAN.md — dsar-export Edge Function + pdf-render + dsar_request RPCs (GDPR-03)
  - Wave 2 (parallel — UI + cross-cutting; depends on 22-01 + Wave-1 outputs):
    - [ ] 22-05-PLAN.md — DEL-01 modal sweep (30d→7d) + SoftDeleteCountdownBanner + cancel-link route (DEL-01, DEL-02)
    - [ ] 22-06-PLAN.md — AdminLayout + Members table + Member drill-in (6 tabs) + feature-flag overrides wrapper (ADMIN-01, ADMIN-05)
    - [ ] 22-07-PLAN.md — RefundModal + CancelSubModal + CompSubModal + AdminAffiliatesReviewQueue (ADMIN-04, ADMIN-06 closes Phase 19 BL-11 status-graph gap)
    - [ ] 22-08-PLAN.md — AdminMetricsPage + CohortHeatmap CSS-grid (ADMIN-02, ADMIN-08)
    - [ ] 22-09-PLAN.md — ImpersonationBanner + useImpersonation + useImpersonationReadOnly hooks (ADMIN-03)
    - [ ] 22-10-PLAN.md — vanilla-cookieconsent + Consent Mode v2 + consent_records audit (GDPR-01, GDPR-02)
    - [ ] 22-11-PLAN.md — DsarPortalPage + EmailPreferencesPage + SettingsPage sub-page links (GDPR-03 UI, ON-03)
  - Wave 3 (closeout — integration + RLS proofs + VALIDATION):
    - [ ] 22-12-PLAN.md — App.tsx wiring (3 banners + 4 lazy routes + loadOverrides) + 12 e2e/RLS proofs + VALIDATION.md per-task rows
**UI hint**: yes (UI-SPEC shipped 2026-05-16, ui-checker 6/6 PASS first iteration)

### Phase 23: v1.1 Tech Debt Sweep + Launch Polish
**Goal**: Close out the carry-over items from v1.1 that have been waiting since the milestone audit. Final pre-launch polish on ASO assets. CI gains knip + ts-unused-exports to prevent the Plan 10-06 WORKSPACE_LOADED-style unused-export defects from recurring (anti-pattern #6 tooling).
**Mode:** mvp
**Depends on**: Phase 22 (final cross-cutting layer must be done before tech-debt sweep)
**Requirements**: DEBT-01, DEBT-02, DEBT-03, DEBT-04, DEBT-05
**Research flag**: Low
**Success Criteria** (what must be TRUE):
  1. Operator opens `ClinicDrillInPage` → clicks "View activity" → navigates to the per-patient activity view (no more `console.warn` stub at `ClinicDrillInPage.tsx:287-292`); behavior verified by a Playwright test that survives the v1.1 audit-tab workaround removal
  2. CI grep test confirms zero `s.user!` non-null assertions remain across the 14 files / 15 occurrences flagged in v1.1 close — each replaced with a typed guard / early return / Auth-required boundary
  3. User soft-deletes a photo → photo appears in a Trash UI for 30 days → user restores the photo OR lets it permanently delete on day 31 → Storage retention policy enforces the day-31 hard delete (verified by a Storage policy unit test)
  4. The 6 deferred tests listed in `.planning/deferred-tests.md` are all re-enabled and green in CI (batch-fix per `feedback_defer_then_batch_fix_pattern.md`); tracker frontmatter set to `status: closed`
  5. `knip` + `ts-unused-exports` run in CI on every PR (warn-not-fail initially; escalate to fail after triage); a deliberately-unused export in a test branch triggers the warn → catches the Plan 10-06 WORKSPACE_LOADED-style class of defect before merge
**Plans**: TBD

### Phase 16: Capacitor Mobile Shells (iOS + Android)
> **REORDERED to milestone tail 2026-05-15** — original slot was between Phase 15 and Phase 17. Moved to end of v1.2 because user needs to register a new primary domain first (gates AASA, assetlinks, Associated Domains, store-listing domain verification, push topic naming). Phases 17/18/21 transitively depend on this phase's native shells — they remain at their numeric slots but will block on Phase 16 readiness when their planner runs. Phase 16 planning artifacts (CONTEXT/RESEARCH/UI-SPEC/VALIDATION/PATTERNS/11 PLAN.md + 16-00 SUMMARY) are preserved on `main`; Wave-0 harness (vitest-mobile, Capacitor mocks, audit scripts) already merged and reusable when P16 resumes.
**Goal**: A user installs LeanShot from the App Store and Google Play, signs in, and uses every feature the web app offers (modulo phase-feature dependencies). All native concerns route through `src/lib/native/{health,ads,push,iap,deeplink,platform}.ts` — feature code never touches `@capacitor/*` directly (ESLint enforced). RevenueCat handles iOS+Android in-app subscriptions (MANDATORY — Apple §3.1.1 + Google §3.1.1 forbid Stripe for digital subs). App Store + Play Console accept the submission with a complete `PrivacyInfo.xcprivacy` and Play data-safety form. Universal Links + App Links open the installed app on link tap. The known WKWebView OOM crash on photo gallery is mitigated by Supabase Storage transforms + `react-virtuoso` virtualization. All native crashes land in Sentry.
**Mode:** mvp
**Depends on**: Phase 12 (firewall ESLint rule), Phase 13 (new tokens), Phase 14 (Stripe foundation — for cross-platform tier reconciliation prep), Phase 15 (marketing pricing page parity for store review), **NEW: domain registration (user gate, 2026-05-15)**
**Requirements**: MOBILE-01, MOBILE-02, MOBILE-03, MOBILE-04, MOBILE-05, MOBILE-06, MOBILE-07, MOBILE-08, MOBILE-09, MOBILE-10, MONEY-06
**Research flag**: **HIGH** — App Store review pitfalls compound; planning artifacts already produced
**Success Criteria** (what must be TRUE):
  1. User installs LeanShot from the iOS App Store and the Google Play Store, opens the app, signs in with an existing account, and reaches the dashboard within 10 seconds of first launch — same dashboard the web app shows, same data
  2. iOS + Android user subscribes via RevenueCat in-app purchase flow (Apple paywall on iOS, Google Play Billing on Android), returns to the app, sees `tier='paid'` reflected; the same user opens the web app and also sees `tier='paid'` (cross-provider tier reconciled — see Phase 19 MONEY-07 for the unification)
  3. User taps a `leanshot.app/r/...` or `leanshot.app/share/...` link in Mail / Messages on iOS or Android → installed app opens directly to the right route (Universal Links + App Links via `apple-app-site-association` + `assetlinks.json` published from the marketing host)
  4. User enables biometric unlock (FaceID / TouchID / Android Biometric), closes app, reopens — biometric prompt gates app open; failed biometric falls back to password
  5. User scrolls 200+ body photos on iPhone 12 (4 GB RAM, lower-end target) without WKWebView OOM crash; Sentry Capacitor SDK reports zero crashes in a 30-minute soak test; native share sheet (`@capacitor/share`) shares dose-log / share-card / doctor-report
**Plans**: 11 PLAN.md files committed; Wave-0 harness merged (`eedced3` + `5986ccf`). Resume via fresh `/gsd-execute-phase 16 leanshot` after domain is live.
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order with Phase 16 moved to milestone tail: 12 → 13 → 14 → 15 → 17 → 18 → 19 → 20 → 21 → 22 → 23 → **16** (gated on new-domain registration)
> Note: P17/18/21 depend on P16's native shells; they will block at plan-phase or execute-phase until P16 ships. Web-only phases 19/20/22/23 are unblocked and can run in P16's absence.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 12. Bootstrap & Bundle Foundations | 0/TBD | Not started | - |
| 13. Design System v2 Rollout | 0/TBD | Not started | - |
| 14. Monetization Foundation (Stripe web + clinic seats) | 11/11 | Complete   | 2026-05-14 |
| 15. Page Builder + Landing Pages | 0/TBD | Not started | - |
| 17. Push Notifications | 0/TBD | Not started (blocks on P16) | - |
| 18. HealthKit + Health Connect + Firewall | 0/TBD | Not started (blocks on P16) | - |
| 19. Affiliate Program + Stripe Connect | 0/TBD | Not started | - |
| 20. Ad Network | 0/TBD | Not started | - |
| 21. Watch Apps (Apple Watch + WearOS) | 0/TBD | Not started (blocks on P16) | - |
| 22. Owner/Admin + Lifecycle Email + DSAR + Cookie Consent | 0/TBD | Not started | - |
| 23. v1.1 Tech Debt Sweep + Launch Polish | 0/TBD | Not started | - |
| 16. Capacitor Mobile Shells (iOS + Android) | 1/11 (Wave 0 harness) | Deferred (domain gate)  | - |

---

*Roadmap created: 2026-05-13*
*Granularity: fine | Mode: mvp | Phase count: 12 (numbered 12-23, continuing from v1.1)*
*Backend platform: Supabase (continued) | Native shell: Capacitor 8 | IAP: RevenueCat (iOS+Android) + Stripe (web/clinic/affiliate)*

## Archived Milestones

- **v1.1** (2026-05-10 → 2026-05-13) — Multi-audience SaaS on Supabase: B2C patient cloud sync + doctor read-share + clinic B2B operator surface. 11 phases / 76 plans. Production live at `https://leanshot-app.vercel.app`. Audit `tech_debt` (48/49 REQ-IDs satisfied; 1 partial). → [`.planning/milestones/v1.1-ROADMAP.md`](milestones/v1.1-ROADMAP.md)

## Next Milestone (v1.3 — to be scoped post v1.2)

Items the synthesizer flagged as differentiators that didn't make v1.2 GA (will be re-evaluated at v1.2 close):
- Clinic-sponsored patient billing — wait for clinic demand signal
- HealthKit write-back — write our injection events + body metrics back to HealthKit (read-only at v1.2)
- Multi-language i18n — Spanish first; US-only at v1.2 GA
- Multi-tier affiliate program — silver / gold / platinum tiers; wait for partner volume
- Page-builder block-level A/B testing
- Standalone watch mode (no iPhone required)
- Mid-trial pharmacology projection paywall (synthesizer recommended test in v1.2.x patches)
- Page-builder embed-provider blocks (Calendly / YouTube / Tally)
- Hourly ad-revenue ETL (revisit at $1k/mo)
- HIPAA BAA paid activation (Supabase Team tier when a clinic prospect requires it)

Run `/gsd-new-milestone` post-v1.2 to draft fresh REQUIREMENTS.md + ROADMAP phases.
