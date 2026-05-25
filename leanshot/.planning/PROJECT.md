# LeanShot

## Vendor Accounts

> Authoritative credential capture table per CONTEXT D-06 naming convention. Updated at Phase 12 Wave 2 (2026-05-13). Each vendor row tracks credential names, storage location, capture status, and capture date. Downstream phases read this table as the source of truth for which credentials are available.

| Vendor | Credential names | Stored in | Status | Captured (date) | Notes |
|--------|------------------|-----------|--------|-----------------|-------|
| Apple Developer Program | `APPLE_TEAM_ID`, `APPLE_BUNDLE_ID` | Vercel env (production) | ⚠️ pending-provisioning | — | $99/yr; suggested bundle `app.leanshot.ios`. Required for Phase 16 Capacitor iOS shell + TestFlight. Enroll at https://developer.apple.com/programs/. Apple enrollment may take 24-48h for identity verification. |
| Google Play Console | `PLAY_PACKAGE_NAME`, `PLAY_SERVICE_ACCOUNT_JSON` | `PLAY_PACKAGE_NAME` → Vercel env; `PLAY_SERVICE_ACCOUNT_JSON` → Supabase Function secrets | ⚠️ pending-provisioning | — | $25 one-time; suggested package `app.leanshot.android`. Service-account JSON captured via `supabase secrets set` (NEVER commits to git — T-CRED-01). Required for Phase 16 Android. |
| Stripe Connect Express | `STRIPE_SECRET_KEY` (`sk_test_*`), `STRIPE_PUBLISHABLE_KEY` (`pk_test_*`), `STRIPE_CONNECT_CLIENT_ID` (`ca_*`) | Vercel env + Supabase Function secrets (`STRIPE_SECRET_KEY` also here for Edge Functions) | ⚠️ pending-provisioning | — | TEST-mode keys at Phase 12 (T-PAY-01); live keys swap in at Phase 14 billing go-live. Connect platform approval 1-2 business days. Enroll at https://dashboard.stripe.com/connect. |
| Resend | `RESEND_API_KEY`, `RESEND_FROM=LeanShot <noreply@app.leanshot.app>` | Supabase Function secrets (both) | ⚠️ pending-dns-verification | — | `RESEND_API_KEY` and `RESEND_FROM` already exist as Supabase Function secrets from Phase 9. Domain `app.leanshot.app` per D-16; from `noreply@app.leanshot.app` per D-17; DMARC `p=quarantine` initially per D-17. Proof at `.planning/phases/12-bootstrap-bundle-foundations/resend-domain-proof.json` (scaffold — populated after DNS propagation + verification). DMARC tightening to `p=reject` is Phase 22 entry condition. |
| AdMob | `ADMOB_APP_ID_IOS`, `ADMOB_APP_ID_ANDROID`, `ADMOB_PUBLISHER_ID` | Vercel env (when ready) | **Phase 20 gate** | — | Account created at https://admob.google.com but publisher approval typically 1-2 weeks after stores list the app. NOT a Phase 12 gate per D-05. Apply early; do NOT wait for approval to close Phase 12. |
| AdSense | `ADSENSE_PUBLISHER_ID` (`ca-pub-...`) | Vercel env (when ready) | **Phase 20 gate** | — | Apply at https://adsense.google.com but approval often needs live deployed app with content (2-4 weeks). NOT a Phase 12 gate per D-05. Circular dependency acknowledged in D-05. |

**Capture verification commands:**
```bash
# Vercel env (build-time + Vite edge functions)
vercel env ls | grep -E '^(APPLE_TEAM_ID|APPLE_BUNDLE_ID|PLAY_PACKAGE_NAME|STRIPE_SECRET_KEY|STRIPE_PUBLISHABLE_KEY|STRIPE_CONNECT_CLIENT_ID)'

# Supabase Function secrets (Deno Edge Functions runtime)
supabase secrets list --project-ref ytnsipxxmzgaebkqmokp | grep -E '^(RESEND_API_KEY|RESEND_FROM|PLAY_SERVICE_ACCOUNT_JSON|STRIPE_SECRET_KEY)'

# Stripe TEST-mode safety check (T-PAY-01)
vercel env pull --environment production /tmp/env-check && grep '^STRIPE_SECRET_KEY=sk_test_' /tmp/env-check && rm /tmp/env-check
```

---

## Current State

**Shipped:** v1.3 Platform Expansion (2026-05-25). 28 phases (24-51) / 242 plans / 1,430 commits since v1.2 / 329,583 LOC across `leanshot/src/` + `supabase/`. Triple-bet megamilestone landed: paying-clinic HIPAA infra (Phase 25 + 28-31), revenue/A-B engine (Phase 26 + 33 + 39 + 40 + 43), consumer depth (Phase 34-38 + 42), and full M4 Membership/Community Platform (Phase 43-49 in-house on Supabase + Mux). Production live at `https://leanshot.app` + `https://app.leanshot.app`. Supabase `ytnsipxxmzgaebkqmokp`: v1.3 added ~200 migrations + 50+ Edge Fns + extensive RLS policies + ~25 pg_cron jobs across HIPAA / multi-tenant org-scope / community / courses / events / moderation / RAG / traffic.

**Audit:** `tech_debt` — 206/206 v1.3 REQ-IDs functionally satisfied (3-source cross-reference + 7/7 integration flows pass). Deferred to v1.4: Phase 32-06 ES contractor (4 I18N REQs partial), Phase 34 Apple OAuth + 34-08/10 checkpoints (6 ONBOARD REQs partial), Phase 50 Waves 2-4 (RAG MVP + STRETCH), Phase 42 5 device-UAT signals, 33 consolidated HUMAN-UAT operator runbook signals, 7 vendor secrets (Better Stack, Calendly OAuth, Sentry CSP, traffic-recorder env, SHARE_TOKEN, NPS signing key, PostHog Personal API key, Slack webhook). See `.planning/milestones/v1.3-MILESTONE-AUDIT.md` + `v1.3-uat-deferred.md`.

**Previously shipped:** v1.2 (2026-05-17). 7 active phases (12, 13, 14, 15, 19, 22, 23) / 59 plans / 487 commits. Polished launch + full monetization. Archive: `.planning/milestones/v1.2-*.md`. Phases 16/17/18/20/21 + ON-01 (44 REQs) descoped to v1.4.

**v1.1 (2026-05-13):** 11 phases / 76 plans. Multi-audience SaaS — B2C patient cloud sync + doctor read-share + clinic B2B operator surface. Archive: `.planning/milestones/v1.1-*.md`.


## v1.4 Goals

**v1.4 Launch Readiness** — authored 2026-05-25 via `/gsd-new-milestone v1.4`. 19 phases (52-70), 200 REQ-IDs. Single consolidated launch-readiness milestone.

- **Close every carry-over** — v1.2 mobile suite (Capacitor + push + HealthKit + ad network + watch) + v1.3 deferred (Spanish i18n contractor wiring + Apple OAuth + RAG Waves 2-4 + Phase 42 device-UAT + 7 vendor secrets) all land in Phases 52-63.
- **Ship 2 new product features** — Admin Protocol Creator (Phase 61: evidence-cited dosing protocols flowing into clinician dashboard + patient dose-log + KB) and Insights & Research Engine (Phase 62: k-anonymity + differential privacy aggregate research compilation + white-paper publishing + RAG feedback loop).
- **Close 4 launch BLOCKERs + 16 hard-debt items** — surfaced by `research/v1.4-launch-readiness-gaps.md`, folded into Phases 64-68: state-privacy disclosures (CCPA + 4 others), Stripe Tax + payment resilience, consumer MFA + sign-in lockout, operational runbooks + observability, audience landing pages + demo sandbox.
- **Design-system harmonization (Phase 69)** — DS audit across all v1.1/v1.2/v1.3/v1.4 surfaces using established LeanShot DS (Tailwind v4 `@theme` tokens, 4-size typography ceiling 11/13/18/28 px, 2 weights, accent reserved-list, DS primitives `Card`/`Modal`/`Sheet`/`Pill`/`EmptyState`/etc., aria-* baseline, `useReducedMotion` gating).
- **Consolidated UAT launch gate (Phase 70)** — `autonomous: false`. Multi-signal HUMAN-UAT rolls up 33 v1.3 carry + 5 Phase 42 device + new v1.4 per-phase UAT + design polish + full regression sweep across 4 milestones. Per `feedback_milestone_uat_deferral_consolidation` forward-looking variant: every prior v1.4 phase is `autonomous: true` with HUMAN-UAT signals empty in own frontmatter — they all roll up here.

**Vendor-setup-first rationale (Phase 52):** Per user direction 2026-05-25, all vendor onboarding (Apple Dev + Play + APNs + FCM + HealthKit entitlement + Mux + Calendly + Better Stack + Sentry CSP + 7 v1.3 carry-over secrets) consolidates into the first phase. Eliminates the per-phase secret-deferral pattern that bit v1.3 (7 unset secrets at milestone close).

**Out of v1.4:** HIPAA covered-entity-tier conversion, direct EHR integration, HIPAA HITRUST certification, subdomain white-label, HealthKit write-back, standalone watch mode, M5b full AI Personalization, App Store / Play in-app review SDK (M3 native rating), Core Web Vitals re-baseline, RTL CSS prep — all deferred to v1.5+ candidates.

## Next Milestone Goals

**v1.4 (deferred + tech-debt absorber):**
- v1.2 carry-over: Phase 16 Capacitor Mobile Shells + Phase 17 Push + Phase 18 HealthKit + Phase 20 Ad Network + Phase 21 Watch Apps (44 REQs)
- v1.3 carry-over: Phase 32-06 ES contractor (I18N-04/05/06/09), Phase 34 Apple OAuth + 34-08/10 checkpoints, Phase 50 Waves 2-4 (RAG MVP + STRETCH), Phase 42 5 device-UAT signals
- 33 HUMAN-UAT operator runbook signals (run at staging before clinic deal close)
- 7 vendor secret provisioning gates
- v1.2/v1.3 tech debt: REQUIREMENTS.md / ROADMAP.md checkbox drift (phase-close hook), VALIDATION.md flag flip post-merge, SUMMARY frontmatter `requirements:` tagging consistency, Phase 41 CR-02 Calendly OAuth signed-handoff redesign

**v1.5 candidates (post-v1.4):**
- M5b full AI Personalization (anomaly detection + churn model + automated win-back) — needs event-data maturity
- M7 continuous items not yet shipped (deeper localization beyond Spanish, advanced cancellation save-offers)
- HIPAA HITRUST certification (only if large clinics demand)
- Hourly ad-revenue ETL (currently daily; revisit at $1k/mo revenue)

<details>
<summary>Archived: v1.3 Platform Expansion — Revenue + Depth + B2B + HIPAA (SHIPPED 2026-05-25)</summary>

**Started:** 2026-05-17 (via `/gsd-new-milestone v1.3`).

**Goal:** Triple-bet release that lands paying clinics under BAA, deepens consumer product on web, and tightens unit economics before v1.4 mobile launch. Foundation layer (modular admin + event taxonomy + PostHog hardening) underpins all three strategic bets. Megamilestone scope per user's 2026-05-17 brief; Path 1 chosen (mobile v1.4 slips a quarter).

**Target features (5 workstreams):**

1. **Foundation (M1-gaps + M5a)** — Modular admin shell routing + bulk actions (CSV/tag/comp/ban/force-reset) + admin 2FA enforcement + per-module Edge Function permission checks; canonical event taxonomy versioned in repo + server-side PostHog capture for adblock-eaten events (signup/payment/activation) + cohort builder + session-replay PII masking. Builds on v1.2 Phase 22 admin foundation (~60% of M1 already shipped).
2. **A — Revenue / Growth** — Multi-tier affiliate (Standard/Gold/Lifetime commission rates, payout schedule, attribution window) + mid-trial paywall A/B test (variant during trial after activation event, PostHog variants, conversion+refund+retention measured) + page-builder A/B (constrained block editor, Vike pre-render, PostHog flag traffic split) + hourly ad ETL (Vercel Cron → Meta/Google/TikTok Ads APIs → Supabase, joined with PostHog for true CAC by source).
3. **B — Product Depth (web)** — Embed-provider blocks (Calendly + YouTube + Tally with per-provider sandboxing, lazy loading, consent gating) + pharmacology paywall test (Pro-gate interactions/dosing/contraindications; reputational-risk line decided up front) + Spanish i18n (`react-i18next` infrastructure + full Spanish localization of UI/transactional emails/KB articles).
4. **C — B2B Clinic + HIPAA** — `organizations` + `org_members` + `org_subscriptions` tables + Stripe Billing for orgs (per-patient metering or seat license) + patient invite flow (clinic → magic link → patient onboards under org) + org admin role + clinic-side dashboard + optional white-label theming + custom rank weights/dose-trend alerts (deferred from v1.2 Out of Scope) + **HIPAA BAA chain** (Supabase Enterprise + BAA, Vercel Enterprise BAA, Resend BAA or switch to Paubox/AWS SES, Sentry Business BAA, OpenAI/Anthropic Zero Data Retention + BAA, audit-log hardening, MFA enforcement, periodic access reviews, employee security training, written policies, annual risk assessment). 4-8 weeks parallel compliance work alongside engineering.
5. **User-facing depth + retention engine (M2 + M3 + M6 core + M5b partial + M7 selective)** — M2 Onboarding Overhaul (value-first preview, magic link + Google + Apple, mobile parity ≥44px tap targets, activation-event definition, admin drag-and-drop step builder, A/B via PostHog) + M3 Gamification engine (XP/levels/freeze tokens/leaderboards/weekly challenges; DS-10 visuals shipped in v1.2) + M3 Review Prompt engine (two-stage: internal NPS → external review or in-app feedback ticket) + M6 Helpdesk core (ticket schema + in-app widget + email-to-ticket via Resend Inbound + AI assist via Claude for draft replies/tagging/routing + CSAT) + M5b partial (recommender via pgvector + weekly Claude summary email) + M7 selective (cancellation flow with save offers, smart notifications, PWA + offline mode, dark mode, accessibility WCAG 2.2 AA, public status page via Better Stack).
6. **M4 Membership / Community Platform (in-house Skool-style on Supabase)** — Membership tiers extension (Lifetime tier + grandfathering + community-gated entitlements) + Community feed (posts + threaded comments + likes + @mentions + image/video embed + Realtime + spaces + member directory + opt-in DMs + community leaderboard) + Courses (modules + lessons + Mux video + completion certificates + lesson resources) + Events (calendar + RSVPs + Zoom/Meet + reminder emails + post-event recording) + Moderation (reports + mute/ban + banned-words + Claude auto-flagging + audit log) + Search + Email digests (Postgres FTS + daily/weekly digest via Resend).

**Out of v1.3 (deferred):**
- M5b full (anomaly detection + churn model) — needs more event-data maturity; v1.5
- M6 App Store / Play review-ingestion — defers to v1.4 (no app in stores yet to monitor)
- Mobile push (web push only in v1.3) — v1.4 with native shells

**Hard constraints:**
- A + C compete for legal/finance attention — accepted; deliberate sequencing (affiliate-tax-forms vs HIPAA-BAA-negotiations)
- C + mobile-same-quarter forbidden per brief — honored (v1.4 slips a quarter)
- HIPAA work starts immediately in parallel (legal/policy/vendor, not engineering bandwidth) so first clinic deal can land mid-v1.3 not end

**Estimated scope:** ~25-27 phases starting at Phase 24, ~9-12 months (revised 2026-05-17 after M4 in-house added). v2.0-scale release under v1.3 label.

**Original v1.4 scoping notes (now superseded by `## Next Milestone Goals` section above):**
- Phase 16 Mobile Shells (MOBILE-01..10 + MONEY-06; 9/11 plans shipped on disk in v1.2)
- Phase 17 Push Notifications + Phase 18 HealthKit + Phase 20 Ad Network + Phase 21 Watch Apps
- v1.3-era tech debt + Vault `service_role_key` Vendor pass + unused-check baseline drift

</details>

<details>
<summary>Archived: v1.2 Milestone (shipped 2026-05-17)</summary>

**Goal:** Take LeanShot from "shipped multi-audience SaaS" to "launch-ready cross-platform product with full monetization, growth loops, and ad-network revenue." Web, mobile, watch — all on the new design system, with Stripe-powered subs/seats/affiliate plus a multi-mode advertising network as primary revenue stream.

**Target features (11 workstreams):**

1. **Design system rollout** — Geist + Geist Mono + Fraunces type system, refreshed color/shadow/spacing/radius tokens, refreshed components (Cards, Button tonal, Pill segmented, Sidebar collapse, Site-rotation v2), new illustrations (AI avatar, streak badges bronze/silver/gold, pen-injector, achievement-shield, activity-rings, doctor-clipboard, heart-pulse, calendar-dose), refreshed marketing site. Bundle staged at `.planning/design-system/`.
2. **Mobile shells** — Capacitor wrapper for iOS + Android, App Store + Play Store submission (ASO assets, listings, screenshots, app icons, splash screens).
3. **Watch apps** — Apple Watch SwiftUI companion + WearOS (Kotlin/Jetpack Compose) parity. Surface: next-dose, streak, log-injection complication.
4. **Health SDK** — HealthKit + Health Connect read-only import (weight, steps, sleep, HR) with permission UI + auto-fill confirmation. **Architectural firewall:** Health data and ad SDKs are strictly isolated (no shared user IDs, no Health signal in ad targeting), Apple privacy-manifest declarations included.
5. **Owner/admin surface** — Full overview: members, memberships, MRR, churn, billing, affiliate payouts, ad revenue, impersonation, member CRUD, support tooling.
6. **Monetization (Full Stripe)** — Patient B2C subscriptions (free + paid; paid = ad-free), clinic seat-based billing, Stripe Connect for affiliate payouts with W-9 / W-8BEN tax forms, end-user subscription management UI, pricing page, trial logic, dunning.
7. **Page builder + landing pages** — In-house drag-and-drop builder with high-converting templates (long-form sales, lead-magnet opt-in, comparison, FAQ, testimonial-driven), SEO config (metadata, sitemap, JSON-LD, OG tags).
8. **Viral affiliate program** — Custom referral codes, partner dashboard, attribution tracking, payout flow via Stripe Connect, fraud detection, tiered commissions.
9. **Advertising network** — Three coexisting modes: (a) embed-code slots (AdSense / Outbrain / Taboola / direct-sold), (b) ad-platform integrations (AdMob via Capacitor for iOS + Android, Google Ad Manager for web, optional Meta Audience Network), (c) custom/house ads (LeanShot-served creatives for cross-promo, sponsorships, retention). Admin: per-placement config, revenue dashboard (eCPM / RPM / fill rate / CTR), A/B testing across providers, frequency caps, advertiser block-list (default-block competing GLP-1 brands), tier-based gating. Placement: marketing site + free-tier dashboard surfaces; **no ads on clinic/doctor-share** (B2B trust).
10. **Launch essentials** — Push notifications (Web Push + APNs + FCM + watch), in-app account deletion (App Store requirement), cookie consent + GDPR DSAR portal, onboarding revamp + Resend lifecycle email (welcome series, milestone, receipts, reminders, password reset).
11. **v1.1 tech debt sweep** — CLINIC-07 operator-side dead-button, `s.user!` non-null assertion audit (15 occurrences / 14 files), photo trash flow, 6 deferred tests batch-fix, knip / ts-unused-exports in CI.

**Out of v1.2 (deferred):**
- HIPAA BAA paid activation (stays in "ready posture, not paid")
- EHR direct integration
- Group / family accounts
- Custom rank weights / dose-trend alerts (clinic expansion)
- **Ads on clinic / doctor-share surfaces** (never — B2B trust)
- **Ad targeting using HealthKit data** (never — Apple §5.1.3)

**Hard constraints carried in:**
- Apple §5.1.3: HealthKit data must never reach ad targeting
- App Store: user-facing in-app account deletion required
- EU GDPR: cookie consent + DSAR portal required for EU launch

**New paid prerequisites the user will provision:** Apple Developer Program ($99/yr), Google Play Console ($25 one-time), AdMob account (free), Stripe Connect activation, ad-network publisher accounts (AdSense, optionally Meta Audience Network), Resend domain verification (carry-over from v1.1).

</details>

---

## What This Is

LeanShot is a web app that lets people on GLP-1s (and adjacent peptides) track everything that affects their treatment — injections, body metrics, food, activity, mood, symptoms — and turns it into a unified picture they share with their doctor and a coach (rule-based + AI) shares with them. v1 serves three audiences: GLP-1 patients (B2C), doctors viewing a specific patient's data (read-share), and clinics/coaches monitoring multiple patients (B2B).

## Core Value

**Drug-level projection + injection-site rotation** are the headline. The pharmacology curve (28 days past + 7 days projected) and site-rotation tracking are the centerpiece — every other tab feeds context into that picture or interprets it for the user. If the curve is wrong or the rotation logic confuses users, the product fails regardless of what else works.

## Requirements

### Validated

<!-- Inferred from the v2 codebase on branch claude/upgrade-leanshot-design-mjjJl. "Validated" here means "present and working in the v2 baseline" — the v2 build itself has not yet shipped to production. -->

- ✓ **TRACK-01**: User can log injections (drug, dose, site, date) — `src/components/dashboard/tabs/MedicationTab.tsx` — v2 baseline
- ✓ **TRACK-02**: User sees their drug-level curve (28-day past + 7-day projection) using real PK math — `src/lib/pharmacology.ts`, `src/components/dashboard/charts/MedLevelChart.tsx` — v2 baseline
- ✓ **TRACK-03**: User sees site rotation history with a recommended next-site nudge — `SiteRotationCard.tsx` — v2 baseline
- ✓ **TRACK-04**: User can log weight, photos, and compare progress over time — `BodyTab.tsx`, `PhotoCompareModal.tsx` — v2 baseline
- ✓ **TRACK-05**: User can log nutrition (incl. protein), activity, supplements, mood, sleep, symptoms — corresponding tabs in `src/components/dashboard/tabs/` — v2 baseline
- ✓ **TRACK-06**: User gets rule-based daily focus and insights derived from their state — `src/lib/insights.ts` — v2 baseline
- ✓ **TRACK-07**: User can chat with an AI coach that has context on their data — `AIChatPanel.tsx`, `src/lib/ai.ts` (Anthropic, BYO key) — v2 baseline
- ✓ **TRACK-08**: User can generate a printable doctor-facing report — `DoctorReport.tsx` — v2 baseline
- ✓ **TRACK-09**: User onboards via a 7-step wizard with a guided first-run tour — `OnboardingFlow.tsx`, `GuidedTour.tsx` — v2 baseline
- ✓ **TRACK-10**: User maintains streaks and can render shareable summary cards — `StreaksCard.tsx`, `ShareCardModal.tsx`, `src/lib/share-card/` — v2 baseline
- ✓ **TRACK-11**: All user data persists locally across sessions with v3→v4 migration — `src/lib/storage.ts` — v2 baseline

### Active

<!-- v1 launch milestone: take v2 from "runs locally" to "shipped multi-audience SaaS". Hypotheses until shipped and proved valuable. -->

**Production readiness (existing app)**

- [ ] **PROD-01**: App is publicly accessible at a real domain over HTTPS
- [ ] **PROD-02**: Real-user errors are captured and triaged via an error-tracking service
- [ ] **PROD-03**: Privacy-respectful product analytics measure feature usage and onboarding drop-off
- [ ] **PROD-04**: Pharmacology engine (`calcMedLevel`, `HALF_LIVES`, `TITRATION`) and insights rule engines (`generateInsights`, `pickFocus`) are covered by automated tests so clinical math regressions are caught before merge
- [ ] **PROD-05**: Anthropic API key handling is hardened (proxy via serverless function OR explicit BYO-key disclosure flow with disclaimers) — keys not silently exposed in plaintext localStorage
- [ ] **PROD-06**: App displays appropriate medical disclaimer ("Not medical advice, talk to your doctor") and a clear data-storage explanation users see before logging anything

**Cloud sync + accounts (net new)**

- [ ] **AUTH-01**: User can create an account and log in across devices
- [ ] **SYNC-01**: User's tracked data syncs across their devices via the cloud, while still working offline (local-first)
- [ ] **SYNC-02**: Existing local-only users can migrate their `leanshot_v4` localStorage data into their account on first sign-in without loss

**Doctor read-share (net new)**

- [ ] **SHARE-01**: Patient can generate a read-only share link or invite that grants their doctor in-browser access to their tracked data (no doctor account required, OR a lightweight doctor sign-up — TBD in planning)
- [ ] **SHARE-02**: Doctor view is read-only, contains the same data as the printable report plus the live curves, and has clear scoping (which patient, which window, when revoked)

**Clinic / coach B2B (net new)**

- [ ] **CLINIC-01**: A clinic or coach can sign up as an organization and invite multiple patients into their workspace
- [ ] **CLINIC-02**: Clinic operator sees a roster view across their patients with at-a-glance status (active streak, recent symptoms, missed doses) so they can prioritize who to reach out to
- [ ] **CLINIC-03**: Clinic operator can drill into any one of their patients and see the same data the patient sees (or a clinical-flavored version of it)

### Out of Scope

- **Native iOS/Android apps** — Web is the only surface for v1; install via PWA. Native costs disproportionately for a launch where we're still discovering audience fit.
- **Peptides outside the GLP-1 family** — v1 supports semaglutide / tirzepatide / liraglutide / etc. only. Other peptide classes (BPC-157, growth hormone, etc.) are deferred until the GLP-1 funnel is validated.
- **Direct EHR / clinical-system integration (HL7, FHIR, Epic, etc.)** — Doctor surface is the LeanShot UI. EHR integration is a much bigger compliance + integration story that gates faster shipping.
- **Payments / paid plans / pricing tiers** — v1 is free across all audiences. Monetization is a separate later milestone informed by usage data.

## Context

- **Stack already chosen**: React 19, Vite 6, TypeScript (strict), Tailwind v4 (beta), Zustand, framer-motion, chart.js, lucide-react. Decided on `claude/upgrade-leanshot-design-mjjJl` (PR #1).
- **State of the codebase**: Brownfield. v2 is a full design upgrade with ~50 components, custom design system primitives, custom pharmacology engine, custom insights rule engine, AI panel, doctor report, share cards, onboarding, guided tour. Codebase map at `.planning/codebase/` (1766 lines, written 2026-05-10).
- **Persistence today**: 100% client-side (`localStorage`, key `leanshot_v4`, with v3→v4 migration) — implies an earlier shipped or in-flight version existed. v1 milestone introduces accounts + cloud sync for the first time.
- **AI coach**: BYO Anthropic key, currently stored unencrypted in localStorage and called direct from the browser. Security review must decide whether to keep BYO with disclosure or proxy through a serverless function.
- **Tests**: Zero. There is no test runner configured and no test files exist as of v2 baseline. Pharmacology and insights are the load-bearing math and run in a medical context — adding tests is a v1 must-have.
- **Domain sensitivity**: Tracking GLP-1 use is health-adjacent data. Even without HIPAA covered-entity status, the project should treat the data as sensitive (encryption in transit + at rest, minimal collection, clear disclosures, deletion on demand).
- **Prior exploration**: Started in a web claude.ai sandbox session and continued in local Claude Code on this branch. Sandbox plan files do not travel with the repo — git is the source of truth.

## Constraints

- **Tech stack**: React 19 + Vite + TS strict + Tailwind v4 beta + Zustand. Locked for v1 — net-new backend should pick a stack that complements (e.g., a small Node/TS or edge-runtime backend) rather than fighting it.
- **Architecture**: Local-first must continue to work even after cloud sync is added. Users without an account, or offline, must still be able to log and view their data. This rules out a pure cloud-first rewrite.
- **Compliance posture**: Not yet a HIPAA covered entity. Avoid features that would push us into that bucket prematurely (e.g., direct EHR integration). Keep the disclaimer + data minimization stance from day one.
- **AI dependency**: AI coach calls Anthropic directly. Outage on Anthropic = degraded coach UX, not full-app outage — keep the rest of the app functional even when AI is unavailable.
- **Bundle size**: chart.js + framer-motion + lucide-react together are heavy. A static SPA on a real domain has to load fast for a non-technical audience — code-split aggressively (App.tsx already lazy-loads tabs/modals; preserve that).
- **Performance / accessibility**: Audience includes patients with chronic conditions. Keyboard navigation, screen-reader labels, color contrast, and reduced-motion behavior must work end-to-end.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| GSD `.planning/` lives inside `/leanshot`, not at repo root `/minisite` | leanshot is the actual project; the repo root is just a wrapper. `gsd-sdk` auto-detected leanshot as `project_root`. | — Pending |
| v1 ambition = full SaaS launch (B2C + doctor share + B2B clinic) — not just polish | User explicitly confirmed when asked to narrow vs commit. Multi-audience is the strategic shape. | — Pending |
| Local-first + cloud sync (not local-only, not cloud-first) | Preserves the existing offline UX and the v2 codebase, while making cross-device + account-based features possible. | — Pending |
| Pharmacology + insights engines are required-to-test before launch | They are the load-bearing clinical math; mistakes look bad in a medical context. | — Pending |
| Native mobile, EHR integration, non-GLP-1 peptides, and payments are explicitly out of v1 | Each adds significant scope and gates a faster public launch. Park them in Out of Scope to prevent drift. | — Pending |
| AI coach key handling decision deferred to planning phase | Two viable paths (BYO with disclosure vs. serverless proxy); pick during the AUTH/PROD planning phase. | — Pending |
| Backend platform = **Supabase** (not Cloudflare Workers + Better Auth + Neon) | User chose Supabase post-research because most v1 needs (Postgres + Auth + Realtime + Storage + Edge Functions + RLS) come bundled in one product. Trades the cleaner per-component stack the synthesizer chose for shipping speed and operational simplicity. HIPAA BAA available on Team tier ($599/mo) when needed; not blocking v1. | — Pending |
| Photos move from base64-in-store to Supabase Storage in v1 (was deferred to v2 in synthesizer's plan) | Once Supabase is in for auth + sync, Storage is "free" to use and the existing Zustand-base64 approach is the largest current contributor to localStorage size. | — Pending |
| Vertical MVP phase mode (each phase = end-to-end user-visible slice) | User picked it intentionally for a multi-audience SaaS where shipping value to one persona at a time beats finishing tech tiers in lockstep. | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-25 — v1.3 Platform Expansion SHIPPED (28 phases / 242 plans / 206 REQ-IDs functionally satisfied; audit `tech_debt`). v1.4 absorbs v1.2 mobile carry-over + v1.3 deferred (ES contractor + Apple OAuth + RAG Waves 2-4 + 5 device-UAT signals) + v1.2/v1.3 tech debt.*

## Vendor Accounts (Phase 16 Wave 0)

These accounts were provisioned during Phase 16 Wave 0. Secret values are stored in GitHub Actions Secrets (gh secret list) and, where Edge Functions need server-side access, also in Supabase Function Secrets (supabase secrets list). Do NOT commit secret values to the repo.

| Vendor | Account ID/Slug | Status | Secret Names | Provisioned Plan |
|--------|-----------------|--------|--------------|-----------------|
| Apple Developer | Team ID `<TEAM_ID — set via apple-done checkpoint>` | PENDING — complete via Task 3 checkpoint | `APPLE_TEAM_ID`, `FASTLANE_APPLE_APPLICATION_SPECIFIC_PASSWORD` | 16-00 (Task 3) |
| Google Play Console | Package `app.leanshot.android` | PENDING — complete via Task 4 checkpoint | `PLAY_JSON_KEY` (base64) | 16-00 (Task 4) |
| RevenueCat | Project "LeanShot" | PENDING — 1 entitlement `plus` + 2 products (`app.leanshot.plus.monthly`, `app.leanshot.plus.yearly`) | `RC_API_KEY_IOS`, `RC_API_KEY_ANDROID`, `RC_SECRET_API_KEY`, `REVENUECAT_WEBHOOK_SECRET` | 16-00 (Task 5) |
| Supabase Pro | Project `ytnsipxxmzgaebkqmokp` | PENDING — upgrade Free → Pro ($25/mo) via Task 6 checkpoint | (uses existing `SUPABASE_*` secrets) | 16-00 (Task 6) |
| GitHub fastlane-match | `pallefar/leanshot-fastlane-match` | PENDING — create empty private repo via Task 7 checkpoint | `MATCH_GIT_BASIC_AUTHORIZATION` (set in Plan 16-09) | 16-00 (Task 7) |
| DNS leanshot.app | A/CNAME → Vercel | PENDING — verify `.well-known/` reachable via Task 7 checkpoint | n/a | 16-00 (Task 7) |
