---
milestone: v1.4
milestone_name: Launch Readiness — Carry-over + Gaps + Polish + UAT
status: in_progress
authored: 2026-05-25
source: MILESTONE-CONTEXT.md + research/v1.4-launch-readiness-gaps.md
v1_3_archive: .planning/milestones/v1.3-REQUIREMENTS.md
---

# Milestone v1.4 Requirements

**Milestone:** v1.4 — Launch Readiness
**Goal:** Close every carry-over from v1.2 + v1.3, ship the 4 launch-readiness blockers + 16 hard-debt items surfaced by research, harmonize the design system across all surfaces, and consolidate every outstanding UAT signal into one rigorous launch gate.

**Source documents:**
- `.planning/PROJECT.md` — milestone goals + locked decisions
- `.planning/MILESTONE-CONTEXT.md` — user-stated direction, phase enumeration (52-70), scope contracts
- `.planning/research/v1.4-launch-readiness-gaps.md` — 4 blockers + 16 hard-debt items folded into Phases 64-68
- `.planning/milestones/v1.3-REQUIREMENTS.md` — archived v1.3 REQ-IDs (continuation source)
- `.planning/milestones/v1.3-uat-deferred.md` — 33 v1.3 consolidated HUMAN-UAT signals (roll up to Phase 70)

**REQ-ID totals:** 200 active requirements across 19 phases (52-70). Mix of v1.2/v1.3 carry-over REQ-IDs (re-used from archive — they were deferred, not invalidated) and NEW families introduced by v1.4 scope: VENDOR-*, PROTOCOL-*, INSIGHTS-*, LEGAL-*, PAY-*, OPS-*, LAND-*, DS-*, UAT-*, DEBT-*.

**Path picked:** Single consolidated launch-readiness milestone — carry-over first, launch gaps next, design polish + consolidated UAT last. Per `feedback_milestone_uat_deferral_consolidation` forward-looking variant: every phase ships `autonomous: true`; ALL HUMAN-UAT signals roll up to Phase 70.

---

## v1.4 Requirements

### WS1 — Vendor Setup Foundation (VENDOR, 12 REQ-IDs)

> Phase 52 — consolidated vendor onboarding upfront so every downstream phase has live integrations. Per `feedback_vendor_secret_preflight_surface`.

- [ ] **VENDOR-01**: Apple Developer Program enrolled ($99/yr); Team ID + Bundle ID `app.leanshot.ios` captured; APNs push certificate provisioned; Sign-in-with-Apple service ID configured
- [ ] **VENDOR-02**: Google Play Console enrolled ($25 one-time); Package `app.leanshot.android`; FCM service-account JSON captured to `PLAY_SERVICE_ACCOUNT_JSON` + `FCM_SERVER_KEY` Supabase Function Secret
- [ ] **VENDOR-03**: HealthKit entitlement requested via App Store Connect; entitlement plist + Apple-side approval captured
- [ ] **VENDOR-04**: Mux video API onboarded for community (Phase 44) + KB (Phase 60); `MUX_TOKEN_ID` + `MUX_TOKEN_SECRET` + `MUX_WEBHOOK_SIGNING_SECRET` set on Supabase + Vercel
- [ ] **VENDOR-05**: Calendly OAuth app registered + 5 secrets set (`CALENDLY_CLIENT_ID`, `CALENDLY_CLIENT_SECRET`, `CALENDLY_WEBHOOK_SIGNING_KEY`, `CALENDLY_OAUTH_REDIRECT_URI`, `CALENDLY_API_KEY`)
- [ ] **VENDOR-06**: Better Stack status page ($12/mo) onboarded; `BETTER_STACK_API_KEY` + `BETTER_STACK_PAGE_ID` set; status.leanshot.app DNS pointed
- [ ] **VENDOR-07**: Sentry CSP `report-uri` configured; `SENTRY_DSN` verified live for Edge Functions specifically (closes research Gap 1.5); CI guard added to prevent silent drift
- [ ] **VENDOR-08**: Anthropic clinical-vs-consumer credential split verified live; both `ANTHROPIC_API_KEY_CONSUMER` + `ANTHROPIC_API_KEY_CLINICAL` resolve via ai-chat branch logic on `org_id IS NOT NULL`
- [ ] **VENDOR-09**: Remaining v1.3-deferred secrets set: `SHARE_TOKEN_SECRET`, `QUARTERLY_NPS_SIGNING_KEY`, `POSTHOG_PERSONAL_API_KEY`, `POSTHOG_PROJECT_ID`, `SLACK_WEBHOOK_EXPERIMENTS_URL`
- [ ] **VENDOR-10**: Vendor BAA chain re-verified for v1.4 additions (Mux BAA y/n decision, Apple Dev BAA n/a, Google Play BAA n/a); `vendor_baa_chain` row added per new vendor; subprocessor-diff cron picks them up
- [ ] **VENDOR-11**: Per-vendor smoke test Edge Fn pings each live API on a 6-hour cron; failures logged to admin dashboard `vendor_smoke_log` table; failing smoke gates downstream phase dispatch
- [ ] **VENDOR-12**: `.planning/runbooks/vendor-secrets.md` documents every secret name, owner vendor, scope, rotation cadence, blast-radius; superset of research Gap 1.3 hard-debt item

### WS2 — Capacitor Mobile Shells (MOBILE, 10 REQ-IDs — carry-over from v1.2 Phase 16)

> Phase 53 — bundle iOS + Android wrappers; CI per-platform builds; signing certs.

- [ ] **MOBILE-01**: Capacitor 6 wrapper integrated into `leanshot/` workspace; `ios/` + `android/` platform dirs scaffolded under `leanshot/`
- [ ] **MOBILE-02**: iOS bundle builds via GitHub Actions on macOS runner; Fastlane match repo `pallefar/leanshot-fastlane-match` wired; `MATCH_GIT_BASIC_AUTHORIZATION` + provisioning profiles capture in CI
- [ ] **MOBILE-03**: Android bundle builds via GitHub Actions; signed AAB output; `PLAY_SERVICE_ACCOUNT_JSON` used for Play Store API uploads via Fastlane supply
- [ ] **MOBILE-04**: Capacitor plugins approved: `@capacitor/app`, `@capacitor/preferences`, `@capacitor/network`, `@capacitor/status-bar`, `@capacitor/splash-screen`, `@capacitor/keyboard`
- [ ] **MOBILE-05**: Deep linking via Universal Links (iOS) + App Links (Android) for `https://app.leanshot.app/*` routes; AASA + `assetlinks.json` deployed to Vercel root
- [ ] **MOBILE-06**: RevenueCat iOS + Android SDKs wired; `RC_API_KEY_IOS` + `RC_API_KEY_ANDROID` + `REVENUECAT_WEBHOOK_SECRET` integrated; webhook → Supabase row mirror (subscription stays canonical in Stripe + RC reflects)
- [ ] **MOBILE-07**: App Store + Play Store metadata + screenshots + privacy labels filled; submission package generated
- [ ] **MOBILE-08**: In-app account deletion screen reachable from mobile shell (Apple §5.1.1(v) + Play §13.7); shares `/settings/delete-account` web flow
- [ ] **MOBILE-09**: TestFlight + Play internal-testing track receives first build; smoke test verifies cold-launch + login + dose-log on real device
- [ ] **MOBILE-10**: Per-store privacy nutrition labels filled accurately (Apple App Privacy + Google Data Safety) — HealthKit-firewalled from ad-targeting per Apple §5.1.3

### WS3 — Push Notifications (PUSH, 8 REQ-IDs — carry-over from v1.2 Phase 17 + Phase 42 web-push foundation)

> Phase 54 — web push (Phase 42 foundation) + native iOS APNs + Android FCM; permission UX.

- [ ] **PUSH-01**: Web Push via vite-plugin-pwa injectManifest path (per `reference_vite_plugin_pwa_strategy_choice`) — VAPID keypair generated via `npx web-push gen`; private in Supabase Function Secret; `VITE_VAPID_PUBLIC_KEY` in Vercel env
- [ ] **PUSH-02**: Native iOS push via APNs cert from VENDOR-01; Capacitor `@capacitor/push-notifications` plugin integrated; deviceToken registered on `device_push_tokens` table
- [ ] **PUSH-03**: Native Android push via FCM service account (VENDOR-02); same plugin; deviceToken registered to same table with `platform='android'`
- [ ] **PUSH-04**: Edge Fn `push-dispatch` accepts (user_id, payload) → fans out to all user's tokens across platforms (web + iOS + Android); falls back to in-app + email if all tokens fail
- [ ] **PUSH-05**: Permission UX shows soft-prompt (in-app explainer) BEFORE OS prompt; per platform-specific guidance (iOS 16.4+ supports web push); telemetry on accept/decline rate
- [ ] **PUSH-06**: Dose-reminder + clinician-alert + community-mention + helpdesk-reply notification categories wire through `notification_settings` (POLISH-05/06 extension)
- [ ] **PUSH-07**: Frequency capping + quiet hours (per-user 22:00-08:00 user-tz) enforced server-side in `push-dispatch`
- [ ] **PUSH-08**: Per-platform delivery telemetry to PostHog (`push_sent`, `push_delivered`, `push_opened`, `push_failed`); failing tokens auto-pruned after 3 consecutive failures

### WS4 — HealthKit + Two-Tunnel Firewall (HEALTH, 8 REQ-IDs — carry-over from v1.2 Phase 18)

> Phase 55 — Apple Health PHI ingestion path; iOS-only; OPT-IN per HIPAA.

- [ ] **HEALTH-01**: HealthKit entitlement (VENDOR-03) declared in iOS app; Capacitor plugin (e.g., `cordova-plugin-health` shim or custom Swift bridge) imports `HKHealthStore`
- [ ] **HEALTH-02**: OPT-IN consent screen: explicit user choice with full disclosure of data types read, retention, and HIPAA-aware path; no silent default-on
- [ ] **HEALTH-03**: Read-only import of: bodyMass, height, stepCount, sleepAnalysis, heartRate, activeEnergyBurned, dietaryProtein; mapped to existing `weights`, `meals`, `workouts`, `sleep_logs` tables
- [ ] **HEALTH-04**: Two-tunnel firewall: HealthKit reads route via SEPARATE Edge Fn `health-import` that NEVER touches ad-tracking surfaces (closes Apple §5.1.3); compile-time enforcement via lint rule (no import of ad SDK in `health-*` Fns)
- [ ] **HEALTH-05**: Apple privacy manifest declares health data usage; `PrivacyInfo.xcprivacy` lists every read type
- [ ] **HEALTH-06**: Background sync (admin-configurable interval 1h/6h/24h) uses BGAppRefreshTask; battery-aware (skip if low battery)
- [ ] **HEALTH-07**: User can revoke HealthKit access from in-app Settings → HealthKit tunnel disables + future syncs blocked + historical imported data flagged for optional purge
- [ ] **HEALTH-08**: Two-tunnel architectural test: CI grep + ESLint AST rule + runtime assertion proves no cross-import between `health-*` and ad/marketing Fns (3-layer enforcement per `feedback_3_layer_must_never_invariant_pattern`)

### WS5 — Ad Network (AD, 12 REQ-IDs — carry-over from v1.2 Phase 20)

> Phase 56 — in-app placements / sponsorship integrations.

- [ ] **AD-01**: AdMob iOS + Android SDKs wired via Capacitor plugin; `ADMOB_APP_ID_IOS` + `ADMOB_APP_ID_ANDROID` + `ADMOB_PUBLISHER_ID` set in Vercel env
- [ ] **AD-02**: AdSense for web (`ADSENSE_PUBLISHER_ID`) embedded on free-tier marketing pages only; lazy-loaded after consent
- [ ] **AD-03**: Ad placements ENFORCED off on clinic / doctor-share / admin / `/dose-log/*` / `/share/*` / `/patient/*` surfaces — runtime guard + CI grep test (3-layer per `feedback_3_layer_must_never_invariant_pattern`)
- [ ] **AD-04**: Three coexisting modes — (a) embed-code slots (AdSense/Outbrain/Taboola), (b) ad-platform integrations (AdMob), (c) custom/house ads (LeanShot-served cross-promo)
- [ ] **AD-05**: Per-placement admin config (size, network, frequency cap, cohort gate, A/B variant) in `ad_placements` table
- [ ] **AD-06**: Revenue dashboard in admin (eCPM / RPM / fill rate / CTR by placement + network) — extends Phase 33 ad-spend ETL with the revenue-side join
- [ ] **AD-07**: A/B testing across providers per placement (admin sets traffic split; PostHog flag-controlled)
- [ ] **AD-08**: Frequency capping per user per session per placement (cookie + server-side counter)
- [ ] **AD-09**: Advertiser block-list default-blocks competing GLP-1 brands (admin-editable hostname list); CSP allowlist generated from this list
- [ ] **AD-10**: Tier-based gating: Pro / Lifetime tiers see ZERO ads; Free tier sees full placements (entitlement check on every placement render)
- [ ] **AD-11**: HealthKit data structurally cannot reach ad-targeting (closes Apple §5.1.3 + HEALTH-04 firewall); enforced via shared CI grep
- [ ] **AD-12**: Per-network revenue ETL — daily Edge Fn pulls AdMob + AdSense reports into `ad_revenue_facts`; joined with Phase 33 `ad_spend_facts` view for true unit economics

### WS6 — Watch Apps (WATCH, 8 REQ-IDs — carry-over from v1.2 Phase 21)

> Phase 57 — Apple Watch + Wear OS companion; quick dose log + reminder; depends on MOBILE shell.

- [ ] **WATCH-01**: Apple Watch SwiftUI companion target added to iOS project (VENDOR-01 dev cert); shares App Group + UserDefaults bridge with main app
- [ ] **WATCH-02**: Wear OS (Kotlin/Jetpack Compose) companion module added to Android project; Data Layer API bridges to main app
- [ ] **WATCH-03**: Quick dose log complication: tap watch face → "Logged" → row enters `injections` via shared backend on phone
- [ ] **WATCH-04**: Dose reminder notification fires on watch via push (PUSH-02/03) when phone is locked / not in hand
- [ ] **WATCH-05**: Next-dose + current-streak rendered on watch face complication; refreshes every 15min via background task
- [ ] **WATCH-06**: Site-rotation next-recommended-site surface on watch (mini-card view)
- [ ] **WATCH-07**: Offline tolerant: dose logged on watch queues locally + syncs to phone backend on next connect
- [ ] **WATCH-08**: HealthKit / Health Services connectivity scoped per HEALTH-04 firewall (watch reads heart rate + activity but routes via same Edge Fn — no ad-surface cross-import)

### WS7 — Spanish i18n Wiring (I18N, 5 REQ-IDs — carry-over from v1.3 Phase 32-06)

> Phase 58 — TMX import + glossary integration + RTL verification + smoke; contractor already engaged. Continues v1.3 I18N-01..10 from archive.

- [ ] **I18N-11**: Contractor-delivered TMX (Translation Memory eXchange) file imported into `/locales/es/*.json` namespaces via `scripts/import-tmx.ts`
- [ ] **I18N-12**: Clinical glossary (drug names, dosing terms, symptom names) integrated as ICU message-format constants; clinical-advisor-reviewed signoff captured
- [ ] **I18N-13**: TRANSLATOR-WORKFLOW.md runbook documents contractor handoff loop: extract source → contractor edits → TMX returned → import → CI lint validates ICU + missing-key coverage
- [ ] **I18N-14**: ES KB articles imported (parallel `{slug}.es.md` files); locale picker on every KB article surface; tsvector ES dictionary verified
- [ ] **I18N-15**: ES Spanish smoke test across critical user paths: signup → onboarding → first dose log → AI chat → cancellation flow → KB search; documented as Playwright spec under `tests/i18n/es-smoke.spec.ts`

### WS8 — Apple OAuth + Onboarding Completion (AUTH, 5 REQ-IDs — carry-over from v1.3 Phase 34-08/10)

> Phase 59 — iOS App Store requirement; Supabase Auth provider config + UI. Continues v1.3 AUTH-01..06 from archive.

- [ ] **AUTH-07**: Apple OAuth provider configured in Supabase Auth Dashboard using VENDOR-01 Sign-in-with-Apple service ID; redirect URLs whitelisted
- [ ] **AUTH-08**: "Sign in with Apple" button added to login + signup + onboarding surfaces alongside existing magic-link + Google; ≥44px tap target; native Apple branding compliance
- [ ] **AUTH-09**: Apple-signin-only flow handles private-relay email correctly (`@privaterelay.appleid.com`); profile created without explicit email if user opts to hide
- [ ] **AUTH-10**: ONBOARD-05/06/07/10/11 finished (activation event walkthrough + admin step builder fixtures + Mobile Lighthouse re-verify) — closes v1.3 Phase 34-08/10 partials
- [ ] **AUTH-11**: PostHog Experiments wiring for onboarding A/B (ONBOARD-08) re-verified end-to-end with PostHog Personal API key (VENDOR-09)

### WS9 — RAG Knowledge Base Completion (RAG, 9 REQ-IDs — carry-over from v1.3 Phase 50 Waves 2-4)

> Phase 60 — resume in-place: scrape + chunk + embed + admin curation + re-rank + federated sources; MVP + STRETCH per user's aggressive-foundations preference.

- [ ] **RAG-01**: Scrape pipeline (Wave 2 50-05) — admin-pasted URL → Edge Fn fetches HTML → Trafilatura-equivalent boilerplate strip → chunked → queued for embedding
- [ ] **RAG-02**: Embedding worker (50-06) — pgvector batch insert via OpenAI `text-embedding-3-small` (reuses RECOMMEND-02 gateway); HNSW index already shipped Wave 1
- [ ] **RAG-03**: Admin curation surface (50-07) — pending-chunks review queue → approve / reject / edit / re-chunk; 2-person review for clinical-content sources
- [ ] **RAG-04**: AI-coach citation integration (Wave 3 50-08) — `ai-chat` Edge Fn injects top-k retrieved RAG chunks into system prompt; response includes citation footnotes linking to source row
- [ ] **RAG-05**: Re-ranker (50-09 MVP) — cross-encoder cohere-reranker pass on top-k=20 retrieved chunks; returns top-3 to LLM
- [ ] **RAG-06**: Federated sources (Wave 3 STRETCH) — PubMed E-utilities + FDA OpenFDA + DailyMed API adapters; periodic sync into `external_knowledge_sources` table; admin enables per-source
- [ ] **RAG-07**: Tip-of-day cron (Wave 4) — daily Edge Fn picks one curated chunk → sends as in-app + push notification (PUSH-06 category)
- [ ] **RAG-08**: Newsletter integration (Wave 4) — weekly Resend digest highlights newly curated chunks; opt-in via notification_settings
- [ ] **RAG-09**: Public knowledge hub (Wave 4 STRETCH) — `/knowledge/*` SEO-indexed surface rendered via page-render Fn; rate-limited; sitemap inclusion

### WS10 — Admin Protocol Creator (PROTOCOL, 8 REQ-IDs — NEW)

> Phase 61 — admin authors evidence-based dosing protocols (Tirzepatide 12-wk titration, Retatrutide stack, GHRP-2 sleep stack); RAG-evidence-cited; distributes to clinician dashboard + patient dose-log + KB.

- [ ] **PROTOCOL-01**: Schema: `protocols` table (id, name, audience[], compound, version, review_state ENUM 'draft|published|archived', published_at, created_by_admin_id) + `protocol_steps` (protocol_id, week, dose_mg, frequency, monitoring[]) + `protocol_evidence` (protocol_id, citation, rag_source_id FK to Phase 60 RAG)
- [ ] **PROTOCOL-02**: Admin authoring UI at `/admin/protocols` — compound picker + target audience multiselect (B2C / clinic) + step-builder grid + RAG-evidence search drawer + AI-assist suggesting safe escalation curves
- [ ] **PROTOCOL-03**: RAG-evidence search uses Phase 60 retriever; selected chunks attach as `protocol_evidence` rows with citation text
- [ ] **PROTOCOL-04**: 2-person review rule: draft → reviewer-admin approves → published; reviewer cannot be author; enforced via SECDEF RPC `publish_protocol(protocol_id)` checking actor != created_by
- [ ] **PROTOCOL-05**: Versioning — edits create new `version` row (immutable history); previous `published` version remains live until new version approved; rollback action restores prior `published`
- [ ] **PROTOCOL-06**: Clinician dashboard (Phase 30 extension) — clinicians browse published protocols + adopt-for-patient flow assigns protocol to roster patient → prefills patient dose schedule + reminder timing + side-effect-monitor cadence
- [ ] **PROTOCOL-07**: Patient dose-log (Phase 35 extension) — protocol prefills the dose schedule UI; patient can deviate but UI shows protocol expectation alongside actual logged values
- [ ] **PROTOCOL-08**: Helpdesk KB integration (Phase 37 extension) — KB articles can reference a published protocol via `protocol_id`; renders inline protocol summary card with citation footnotes

### WS11 — Insights & Research Engine (INSIGHTS, 10 REQ-IDs — NEW)

> Phase 62 — anonymized aggregate compilation: dose logs + body metrics + symptoms + retention curves + gamification engagement + AI coach interactions. K-anonymity + differential privacy. Admin research dashboard + white-paper publishing pipeline + opt-in public blog. Feeds RAG.

- [ ] **INSIGHTS-01**: K-anonymity (k≥5) enforced on every aggregate rollup view; cohorts <5 returned as `<suppressed>` rather than partial data
- [ ] **INSIGHTS-02**: Differential privacy Laplace-noise injection for cohorts 5-50; epsilon configurable per output surface (admin / public differ)
- [ ] **INSIGHTS-03**: Aggregate rollups schema — `insights_dose_rollup`, `insights_body_metrics_rollup`, `insights_retention_rollup`, `insights_engagement_rollup`, `insights_ai_interaction_rollup` matviews refreshed via pg_cron daily; NO user_id, email, phone, address ever appear
- [ ] **INSIGHTS-04**: Date binning to week-level for all metric rollups (no day-level public output)
- [ ] **INSIGHTS-05**: AI-coach interaction inclusion requires explicit user opt-in (`profiles.research_consent BOOLEAN DEFAULT false`); revoke-consent triggers user-data drop from future rollups within 30 days via cron
- [ ] **INSIGHTS-06**: Admin research dashboard at `/admin/research` — interactive cohort builder (compound × tenure × audience × outcome metric) + cross-tab + retention curves; admin-only role gate
- [ ] **INSIGHTS-07**: White-paper publishing pipeline — markdown-source under version control at `content/research/*.md`; PDF + HTML generators; reviewer approval workflow (IRB-equivalent 2-person admin review per PROTOCOL-04 pattern); published artifacts in `research_publications` table
- [ ] **INSIGHTS-08**: Public research blog at `/research/*` — opt-in publishing (admin-curated); SEO-optimized + sitemap inclusion + RSS feed; social-share OG cards
- [ ] **INSIGHTS-09**: RAG feedback loop — published white papers become Phase 60 RAG primary-research evidence (closing the loop); auto-ingested into `kb_chunks` + tagged `source_type='leanshot_research'`
- [ ] **INSIGHTS-10**: HIPAA compliance — aggregate-only output structurally; no PHI ever leaves rollup view; SECDEF RPC `compile_research_cohort(...)` rejects cohorts that would breach k-anonymity floor

### WS12 — Device-UAT + Tech Debt Cleanup (DEBT, 6 REQ-IDs — v1.3 carry)

> Phase 63 — Phase 42's 5 device-UAT signals + REVIEW.md IN-* findings (Phase 41 + 51) + v1.2/v1.3-era tech debt sweep + ROADMAP checkbox drift fix.

- [ ] **DEBT-01**: Phase 42 5 device-UAT signals validated (axe-core CI baseline, push device smoke, dark-mode VR snapshots, PWA installability, smart notifications); evidence captured to `.planning/phases/63-*/EVIDENCE/`
- [ ] **DEBT-02**: REVIEW.md IN-* findings (Phase 41 embed-provider IN-01..04 + Phase 51 traffic IN-01..02) addressed; per-finding resolution row in `tech_debt_log` table
- [ ] **DEBT-03**: ROADMAP.md checkbox drift fix — phase-close hook normalizes per-plan checkboxes against SUMMARY frontmatter (closes `feedback_roadmap_format_variance_close_out_check` recurring issue)
- [ ] **DEBT-04**: SUMMARY frontmatter `requirements:` tagging consistency sweep across v1.2 + v1.3 SUMMARY.md files; broken refs surfaced and fixed
- [ ] **DEBT-05**: Phase 41 CR-02 Calendly OAuth signed-handoff redesign (carry-over) — implements the deferred signed-redirect flow rather than the current popup-iframe pattern
- [ ] **DEBT-06**: VALIDATION.md flag-flip post-merge automation (closes `feedback_validation_md_inline_generation_when_missing` recurring inline-generation cost)

### WS13 — Legal Refresh (LEGAL, 10 REQ-IDs — research B1+B2+HD6+HD7+HD8)

> Phase 64 — state privacy + policy update + accessibility + DMCA + cookie WCAG. BLOCKER per research.

- [ ] **LEGAL-01**: State-privacy disclosures shipped — CCPA/CPRA (California) + CDPA (Virginia) + CPA (Colorado) + CTDPA (Connecticut) + UCPA (Utah) state addendums in `PrivacyPolicy.tsx`; legal-reviewed copy
- [ ] **LEGAL-02**: "Do Not Sell or Share My Personal Information" footer link + dedicated `/privacy/do-not-sell` opt-out form wired to new `privacy_optout_requests` table; submission triggers PostHog opt-out + ad-network exclusion update
- [ ] **LEGAL-03**: DSAR portal (v1.3 Phase 22) extended to handle state-rights flavors (CCPA "right to delete" / VA "right to portability" / CO "right to limit sensitive data use" with state-specific intake form variants)
- [ ] **LEGAL-04**: Privacy policy + ToS audit driven from existing Phase 25 `subprocessor-diff` cron output; covers PostHog Session Replay, Anthropic egress, Mux, Stripe Connect, pgvector recommender, traffic-attribution; record-of-changes timestamp + grandfathered-notice email to existing users via lifecycle Edge Fn
- [ ] **LEGAL-05**: Accessibility statement page at `/legal/accessibility` matching `LegalLayout` pattern; states WCAG 2.2 AA conformance + ADA Title III posture + contact email
- [ ] **LEGAL-06**: DMCA agent registered with U.S. Copyright Office; `/legal/dmca` page lists agent name + address + email + takedown procedure; `abuse@leanshot.app` mailbox routing configured
- [ ] **LEGAL-07**: Cookie banner WCAG 2.2 AA re-audit via axe-core; non-conformances fixed; banner copy updated with CPRA-mandated "Do Not Sell" surfaced in same banner (not separate page)
- [ ] **LEGAL-08**: ToS update for community user-generated-content (Phase 44-49 surfaces); content license clause + community-rules link + takedown procedure cross-referenced from LEGAL-06
- [ ] **LEGAL-09**: Grandfathered-notice email campaign — one-shot lifecycle send to all pre-v1.4 registered users notifying of policy update + new sharing/processing purposes; honors email-preference + unsubscribe
- [ ] **LEGAL-10**: Legal-page link audit + sitemap inclusion — every footer + auth + onboarding surface includes correct cross-links to privacy / ToS / cookie / DMCA / accessibility / do-not-sell

### WS14 — Stripe Tax + Payment Resilience (PAY, 11 REQ-IDs — research B3+B4+HD9+HD10+HD12)

> Phase 65 — BLOCKER per research. Stripe Tax + dunning + refund self-service + idempotency + win-back/trial-ending emails.

- [ ] **PAY-01**: Stripe Tax enabled in Stripe Dashboard; `automatic_tax: { enabled: true }` added to ALL checkout sessions (consumer + clinic + affiliate-payout where applicable) in `stripe-checkout/index.ts`
- [ ] **PAY-02**: `customer_update.address: 'auto'` set on all checkout sessions so customer-address-on-file feeds Tax calc
- [ ] **PAY-03**: B2B `tax_id_collection.enabled = true` on clinic-org checkout sessions; collected tax IDs stored on Stripe Customer + mirrored to `org_subscriptions.tax_id`
- [ ] **PAY-04**: Nexus-monitoring admin dashboard at `/admin/tax` — reads Stripe Tax Reports API daily; surfaces per-state revenue + nexus-threshold-proximity warnings; threshold breach fires Slack alert via VENDOR-09 webhook
- [ ] **PAY-05**: Dunning email sequence on `invoice.payment_failed` — 3 emails at T+1d / T+3d / T+7d via Resend; copy CTA links to in-app `/settings/billing` (NOT Stripe-hosted page); templates under `_shared/email-templates/dunning-*.html`
- [ ] **PAY-06**: In-app `<PaymentFailedBanner>` component renders on app shell when `subscriptions.dunning_state IS NOT NULL`; CTA opens billing portal with deep-link to update-payment-method
- [ ] **PAY-07**: `subscriptions.dunning_state` column added (`'none' | 'first_failed' | 'second_failed' | 'final_warning' | 'cancelled_for_payment'`); webhook handlers + cron transition states
- [ ] **PAY-08**: Refund self-service flow — within trial OR within N-day money-back window (ROSCA-compliant), user clicks "Request Refund" → `request-refund` Edge Fn validates eligibility → executes Stripe refund + records `refunds` row; receipt-page CTA links to this flow
- [ ] **PAY-09**: Stripe webhook idempotency burst-retry Deno test — sends 5× same `event_id` in <1s + verifies single-row outcome for affiliate-eligibility, ux_tier flip, subscription_events row; under `supabase/functions/stripe-webhook/__tests__/burst-retry.test.ts`
- [ ] **PAY-10**: Trial-ending lifecycle emails (T-3d + T-1d) via Resend; CTA encourages plan selection; copy A/B variant via PostHog flag
- [ ] **PAY-11**: Win-back lifecycle emails for cancelled subscriptions at T+30d / T+60d / T+90d post-cancel; per-user reactivation-discount coupon via Stripe Promotion Codes; opt-out honors email preferences

### WS15 — Consumer Account Security (AUTH continued, 6 REQ-IDs — research HD1+HD2)

> Phase 66 — Consumer MFA + sign-in lockout. Continues AUTH-* family.

- [ ] **AUTH-12**: Consumer-facing MFA / TOTP self-serve at `/settings/security` (reuses Phase 25 admin SetupTotpPage flow + Supabase Auth `mfa.enroll/challenge/verify`); QR-code + backup-codes UX
- [ ] **AUTH-13**: AAL2 step-up required for sensitive consumer actions (delete-account, export-all-data, change-email) when MFA is enabled; uses `supabase.auth.mfa.getAuthenticatorAssuranceLevel()` per `reference_supabase_v2_aal_api`
- [ ] **AUTH-14**: Per-IP + per-email sign-in lockout — after 5 failed attempts in 15min, account locks for 30min; `auth_attempts_log` table + Edge Fn middleware on `auth/v1/token` path
- [ ] **AUTH-15**: Brute-force PostHog alerting — N consecutive failed attempts on same email or N from same IP within window emits `auth_brute_force_detected` event + Slack webhook (VENDOR-09)
- [ ] **AUTH-16**: Cookie banner mentions sign-in-rate-limiting per CPRA notice-of-security-practices clause (LEGAL-07 cross-reference)
- [ ] **AUTH-17**: MFA-enabled badge surfaces in admin user-detail view; admins can require MFA per-role (clinic-org admins, affiliate-payout-tier-Gold+, research-opt-in users)

### WS16 — Operational Runbooks + Observability (OPS, 10 REQ-IDs — research HD3+HD4+HD5+HD14+HD15+HD16)

> Phase 67 — secrets rotation + DDoS load-test + Sentry verify + funnel alerts + incident runbook + backup drill.

- [ ] **OPS-01**: Secrets-rotation runbook at `.planning/runbooks/secrets-rotation.md` — inventory all 30+ secrets, per-secret rotation procedure, blast-radius assessment, last-rotated-at tracking; superset of VENDOR-12
- [ ] **OPS-02**: DDoS / abuse k6 load-test against public Edge Fns (`affiliate-impression`, `lead-capture`, `traffic-attribution-recorder`, `/api/og/*`, `page-render`); baseline + 10× + 100× scenarios documented
- [ ] **OPS-03**: Vercel rate-limit configuration — per-route limits in `vercel.json` (Vercel-platform rate-limits where supported) + Edge Middleware fallback layer for routes Vercel doesn't natively cover
- [ ] **OPS-04**: SENTRY_DSN production verification for Edge Functions (closes research Gap 1.5); CI guard fails build if any Edge Fn `import('@sentry/...')` resolves to a no-op shim
- [ ] **OPS-05**: Funnel-break PostHog alert config — activation / payment / signup funnels each get alert thresholds (week-over-week drop >20%); Slack webhook dispatch via VENDOR-09; runbook entry on each alert
- [ ] **OPS-06**: Incident-response runbook at `.planning/runbooks/incident-response.md` — on-call rotation + log locations (Sentry, Supabase, Vercel, Better Stack) + rollback procedure + status-page update + HIPAA breach-notification 60-day clock trigger
- [ ] **OPS-07**: Backup + PITR restore drill — execute one Supabase PITR restore into a test project + verify data integrity post-restore (HIPAA Security Rule §164.308(a)(7) contingency testing); documented at `.planning/runbooks/backup-restore.md`
- [ ] **OPS-08**: On-call rotation tooling — even if 1-person rotation initially, capture rotation calendar + escalation path; integrate with Better Stack on-call (or PagerDuty if upgraded)
- [ ] **OPS-09**: Edge Fn cold-start budget audit + documentation; per-Fn p95 cold-start ceiling captured; outliers flagged for refactor
- [ ] **OPS-10**: Status-page automation — Better Stack incidents auto-detect from Sentry + Vercel + Supabase health checks (Phase 41 foundation extension); manual override via admin button

### WS17 — Audience Landing + Sales Enablement (LAND, 8 REQ-IDs — research HD11+HD13)

> Phase 68 — 3 audience landing pages + demo sandbox.

- [ ] **LAND-01**: `/for-doctors` landing page via Phase 15 page-builder — doctor-targeted copy + read-share value prop + sample-report screenshot + CTA "Get patient-shared access"
- [ ] **LAND-02**: `/for-clinics` landing page — clinic-buyer copy + HIPAA-BAA reassurance + per-patient pricing + multi-tenant capability highlights + CTA "Book demo" (Calendly via VENDOR-05)
- [ ] **LAND-03**: `/for-coaches` landing page — coach/wellness-pro copy + roster-management value prop + cohort-tracking highlights + CTA "Start free trial"
- [ ] **LAND-04**: schema.org `Service` JSON-LD per audience landing page; differentiated `serviceType` + `audience` per page; sitemap inclusion
- [ ] **LAND-05**: Demo / sandbox mode for clinic-buyer prospects — `is_demo BOOLEAN` flag on `organizations`; admin creates demo-org with 5 synthetic patients (deterministic-generator script under `scripts/seed-demo-org.ts`); RLS denies cross-tenant SELECT against real org data
- [ ] **LAND-06**: Demo-org auto-purge — pg_cron at 7 days deletes demo-org + cascades; admin extension button to extend up to 30 days max
- [ ] **LAND-07**: Per-audience PostHog Funnels wire — Phase 51 traffic attribution captures `landing_page` dimension; admin sees per-audience conversion separately
- [ ] **LAND-08**: Per-audience UTM-default-landing config — affiliate / ad-network campaigns can declare a default landing page (e.g., `utm_source=clinic_outreach` → `/for-clinics`); resolver in `traffic-attribution-recorder`

### WS18 — Layout & Design Polish (DS, 10 REQ-IDs — Phase 69)

> Phase 69 — design-system harmonization audit across all v1.1/v1.2/v1.3/v1.4 surfaces using the established LeanShot DS. Per `feedback_ui_researcher_prebake_constraints`: bake ui-checker dimension traps into research up front.

- [ ] **DS-01**: Tailwind v4 `@theme` token audit — every consumer / admin / marketing surface uses ONLY tokens declared in `leanshot/src/index.css` `@theme {}` block; ad-hoc hex/rgb values caught + replaced
- [ ] **DS-02**: 4-size typography ceiling enforced across every surface (11 / 13 / 18 / 28 px); 2 weights only (regular 400 + semibold 600); per `reference_ui_checker_dimension_traps`
- [ ] **DS-03**: Accent color reserved-list documented + enforced; non-reserved accent usage caught via ui-checker run
- [ ] **DS-04**: DS primitive adoption sweep — `Card`, `Modal`, `Sheet`, `Pill`, `PillGroup`, `EmptyState`, `Button`, `Input`, `Toast`, `Badge`, `ProgressRing`, `Skeleton`, `Sparkline` reused across surfaces; one-off duplicate components refactored to use DS primitives
- [ ] **DS-05**: a11y baseline re-verified — `aria-label` on icon-only buttons, `role="dialog"` + `aria-modal="true"` on modals, `aria-sort` on sortable columns, `useReducedMotion` for all animations
- [ ] **DS-06**: Dark mode parity audit — every new v1.4 surface (P52-68) renders correctly in `data-theme="dark"`; VR snapshots captured under `tests/vr/dark-mode/`
- [ ] **DS-07**: Mobile responsive sweep at 375px breakpoint — no horizontal scroll, ≥44px tap targets, content reflows correctly
- [ ] **DS-08**: Spacing audit — all margins/padding are multiples of 4; documented exceptions captured in `DESIGN-DECISIONS.md`
- [ ] **DS-09**: Copywriting consistency sweep — CTA verbs match canonical list (Save / Continue / Cancel / Confirm / Delete / etc.); error states show solution-path copy not just "Error"
- [ ] **DS-10**: `gsd-ui-auditor` clean-run across admin shell + consumer surfaces + marketing + clinic + community + courses + events + research + landing pages; per-surface PASS evidence captured

### WS19 — Consolidated UAT — v1.4 Launch Gate (UAT, 7 REQ-IDs — Phase 70)

> Phase 70 — `autonomous: false`. Multi-signal HUMAN-UAT per `feedback_multi_signal_human_verify_checkpoint_pattern`. Roll up of EVERY outstanding UAT signal.

- [ ] **UAT-01**: 33 v1.3-deferred HUMAN-UAT signals (from `v1.3-uat-deferred.md`) replayed at staging with live-vendor-secret fixtures + signoff per signal
- [ ] **UAT-02**: 5 Phase 42 device-UAT signals validated on physical iOS + Android device (overlap with DEBT-01 from Phase 63 — re-validate against final v1.4 build)
- [ ] **UAT-03**: New v1.4 phase UAT signals validated — mobile shells (P53) cold-launch + dose-log; push (P54) cross-platform delivery; HealthKit (P55) opt-in + import + revoke; Apple OAuth (P59) sign-in + private-relay-email handling; watch (P57) complication + quick-log; ad network (P56) consumer-only placement + clinic-zero-ads; RAG (P60) AI-coach citation + admin curation; Protocol Creator (P61) 2-person-review + clinician-adopt + patient-prefill; Insights (P62) k-anonymity-enforcement + research-blog-publish; Legal (P64) state-privacy-opt-out + DMCA-takedown; Stripe Tax (P65) cross-state-purchase + dunning-email-cadence + refund-self-service; MFA (P66) consumer-TOTP-enroll + brute-force-lockout; Runbooks (P67) PITR-restore-drill-evidence + DDoS-load-test-results; Landing (P68) per-audience-page-render + demo-org-auto-purge
- [ ] **UAT-04**: Phase 69 design polish UAT — `gsd-ui-auditor` final-pass evidence + dark-mode VR snapshot diff + mobile-responsive Lighthouse score ≥90 on all critical surfaces
- [ ] **UAT-05**: Full regression sweep — Playwright e2e suite + Deno test sweep + axe-core CI + per-Edge-Fn smoke run + Sentry health-check; CI green across `main` for ≥48h before launch
- [ ] **UAT-06**: Multi-signal structure — each individual UAT item is an independently approvable signal (per `feedback_multi_signal_human_verify_checkpoint_pattern`); operator can approve subsets inline + carry browser/device items to milestone close; signals grouped by environment-fixture-shared sets (browser, iOS device, Android device, Stripe test, vendor-OAuth, ops-runbook-drill)
- [ ] **UAT-07**: Ship rule decided at Phase 70 planning + applied — either (a) ALL signals must pass OR (b) ≥X/Y inline-approved + critical-gate subset must all pass; documented + applied uniformly

---

## Cross-cutting Concerns

1. **VENDOR-* gates downstream** — Phase 52 is hard prerequisite for P53/54/55/57/59/61 (and most launch-gap phases). Per `feedback_vendor_secret_preflight_surface`: pre-flight at execute dispatch.
2. **HealthKit two-tunnel firewall** — 3-layer enforcement (ESLint AST + runtime + CI grep) per `feedback_3_layer_must_never_invariant_pattern`. Owners: HEALTH + AD.
3. **Ad-surface exclusions** — clinic / doctor-share / admin / `/dose-log/*` / `/share/*` / `/patient/*` NEVER show ads (AD-03). Owners: AD + every surface owner.
4. **RAG → Protocol → Insights closed loop** — RAG (P60) feeds Protocol (P61) evidence + Insights (P62) outputs feed back into RAG. Ordering matters: P60 → P61 → P62.
5. **HIPAA carry-over** — v1.3 vendor BAA chain extends to Mux (community + KB); Phase 52 VENDOR-10 re-verifies BAA scope. Owners: VENDOR + HEALTH + INSIGHTS.
6. **K-anonymity floor (k≥5)** — Insights aggregate rollups + Protocol evidence-counts + Landing analytics never break floor. Owners: INSIGHTS + admin dashboards that surface aggregate counts.
7. **State-privacy opt-out propagation** — LEGAL-02 opt-out request must propagate to PostHog opt-out + ad-network exclusion + email-marketing exclusion within 30 days per CCPA. Owners: LEGAL + AD + email lifecycle.
8. **Design system 4/2/reserved ceiling** — DS-02 / DS-03 enforced via ui-checker run on every NEW surface in P52-68 (NOT just in P69). Per `feedback_ui_researcher_prebake_constraints`.
9. **Consolidated UAT** — every phase P52-69 has `autonomous: true` + leaves HUMAN-UAT signals EMPTY in its own frontmatter; signals roll up to Phase 70. Per `feedback_milestone_uat_deferral_consolidation` forward-looking variant.

---

## Out of Scope (explicit exclusions)

**Carry-forward NEVER:**
- HealthKit data into ad targeting (Apple §5.1.3; HEALTH-04 + AD-11 firewall)
- Ads on clinic / doctor-share / admin / patient-dose-log surfaces (AD-03)
- PHI keywords in Stripe API call fields (HIPAA-08 CI lint, still active)
- Native rating-prompt gated by NPS score (REVIEW-01 BLOCKER, still active)
- Session-replay autocapture on PHI routes (HIPAA-17, still active)
- Direct EHR / HL7 / FHIR integration (HIPAA-CE tier push)
- HIPAA covered-entity-tier conversion
- Multi-level affiliate (MLM)

**v1.4 NEVER:**
- HIPAA HITRUST certification (10-20× SOC 2 cost; only large clinics demand)
- Hourly ad-revenue ETL (currently daily; revisit at $1k/mo revenue)
- Subdomain white-label `acme.leanshot.app` (Capacitor universal-link complexity)
- i18n `/es/` path-prefix routing (would double Vercel rewrites; query-string stays)
- HealthKit write-back (read-only this milestone)
- Standalone watch mode (companion only; iPhone required)
- Net-new community features beyond v1.3 Phase 49 (digest send loop, search already shipped)

**v1.5+ candidates (post-v1.4):**
- M5b full AI Personalization (anomaly detection + churn model + automated win-back)
- Core Web Vitals re-baseline post-v1.4
- Database top-10 hot-query explain-analyze + index sweep
- Edge Fn cold-start budget refactor (OPS-09 surfaces; v1.4 only audits)
- Translation memory + glossary maintenance process (post Phase 32-06 contractor delivery)
- RTL CSS preparation (Arabic / Hebrew when demand signal exists)
- First-touch attribution training-the-team documentation
- App Store / Play in-app review SDK (M3 native rating, requires shipped store presence)

---

## Traceability

REQ-ID → Phase mapping. 200 REQ-IDs mapped across 19 phases (52-70). 100% coverage; no orphans; no duplicates.

| Requirement | Phase | Status |
|-------------|-------|--------|
| VENDOR-01 | Phase 52 | Pending |
| VENDOR-02 | Phase 52 | Pending |
| VENDOR-03 | Phase 52 | Pending |
| VENDOR-04 | Phase 52 | Pending |
| VENDOR-05 | Phase 52 | Pending |
| VENDOR-06 | Phase 52 | Pending |
| VENDOR-07 | Phase 52 | Pending |
| VENDOR-08 | Phase 52 | Pending |
| VENDOR-09 | Phase 52 | Pending |
| VENDOR-10 | Phase 52 | Pending |
| VENDOR-11 | Phase 52 | Pending |
| VENDOR-12 | Phase 52 | Pending |
| MOBILE-01 | Phase 53 | Pending |
| MOBILE-02 | Phase 53 | Pending |
| MOBILE-03 | Phase 53 | Pending |
| MOBILE-04 | Phase 53 | Pending |
| MOBILE-05 | Phase 53 | Pending |
| MOBILE-06 | Phase 53 | Pending |
| MOBILE-07 | Phase 53 | Pending |
| MOBILE-08 | Phase 53 | Pending |
| MOBILE-09 | Phase 53 | Pending |
| MOBILE-10 | Phase 53 | Pending |
| PUSH-01 | Phase 54 | Pending |
| PUSH-02 | Phase 54 | Pending |
| PUSH-03 | Phase 54 | Pending |
| PUSH-04 | Phase 54 | Pending |
| PUSH-05 | Phase 54 | Pending |
| PUSH-06 | Phase 54 | Pending |
| PUSH-07 | Phase 54 | Pending |
| PUSH-08 | Phase 54 | Pending |
| HEALTH-01 | Phase 55 | Pending |
| HEALTH-02 | Phase 55 | Pending |
| HEALTH-03 | Phase 55 | Pending |
| HEALTH-04 | Phase 55 | Pending |
| HEALTH-05 | Phase 55 | Pending |
| HEALTH-06 | Phase 55 | Pending |
| HEALTH-07 | Phase 55 | Pending |
| HEALTH-08 | Phase 55 | Pending |
| AD-01 | Phase 56 | Pending |
| AD-02 | Phase 56 | Pending |
| AD-03 | Phase 56 | Pending |
| AD-04 | Phase 56 | Pending |
| AD-05 | Phase 56 | Pending |
| AD-06 | Phase 56 | Pending |
| AD-07 | Phase 56 | Pending |
| AD-08 | Phase 56 | Pending |
| AD-09 | Phase 56 | Pending |
| AD-10 | Phase 56 | Pending |
| AD-11 | Phase 56 | Pending |
| AD-12 | Phase 56 | Pending |
| WATCH-01 | Phase 57 | Planned |
| WATCH-02 | Phase 57 | Planned |
| WATCH-03 | Phase 57 | Planned |
| WATCH-04 | Phase 57 | Planned |
| WATCH-05 | Phase 57 | Planned |
| WATCH-06 | Phase 57 | Planned |
| WATCH-07 | Phase 57 | Planned |
| WATCH-08 | Phase 57 | Planned |
| I18N-11 | Phase 58 | Pending |
| I18N-12 | Phase 58 | Pending |
| I18N-13 | Phase 58 | Pending |
| I18N-14 | Phase 58 | Pending |
| I18N-15 | Phase 58 | Pending |
| AUTH-07 | Phase 59 | Pending |
| AUTH-08 | Phase 59 | Pending |
| AUTH-09 | Phase 59 | Pending |
| AUTH-10 | Phase 59 | Pending |
| AUTH-11 | Phase 59 | Pending |
| RAG-01 | Phase 60 | Pending |
| RAG-02 | Phase 60 | Pending |
| RAG-03 | Phase 60 | Pending |
| RAG-04 | Phase 60 | Pending |
| RAG-05 | Phase 60 | Pending |
| RAG-06 | Phase 60 | Pending |
| RAG-07 | Phase 60 | Pending |
| RAG-08 | Phase 60 | Pending |
| RAG-09 | Phase 60 | Pending |
| PROTOCOL-01 | Phase 61 | Pending |
| PROTOCOL-02 | Phase 61 | Pending |
| PROTOCOL-03 | Phase 61 | Pending |
| PROTOCOL-04 | Phase 61 | Pending |
| PROTOCOL-05 | Phase 61 | Pending |
| PROTOCOL-06 | Phase 61 | Pending |
| PROTOCOL-07 | Phase 61 | Pending |
| PROTOCOL-08 | Phase 61 | Pending |
| INSIGHTS-01 | Phase 62 | Pending |
| INSIGHTS-02 | Phase 62 | Pending |
| INSIGHTS-03 | Phase 62 | Pending |
| INSIGHTS-04 | Phase 62 | Pending |
| INSIGHTS-05 | Phase 62 | Pending |
| INSIGHTS-06 | Phase 62 | Pending |
| INSIGHTS-07 | Phase 62 | Pending |
| INSIGHTS-08 | Phase 62 | Pending |
| INSIGHTS-09 | Phase 62 | Pending |
| INSIGHTS-10 | Phase 62 | Pending |
| DEBT-01 | Phase 63 | Pending |
| DEBT-02 | Phase 63 | Pending |
| DEBT-03 | Phase 63 | Pending |
| DEBT-04 | Phase 63 | Pending |
| DEBT-05 | Phase 63 | Pending |
| DEBT-06 | Phase 63 | Pending |
| LEGAL-01 | Phase 64 | Pending |
| LEGAL-02 | Phase 64 | Pending |
| LEGAL-03 | Phase 64 | Pending |
| LEGAL-04 | Phase 64 | Pending |
| LEGAL-05 | Phase 64 | Pending |
| LEGAL-06 | Phase 64 | Pending |
| LEGAL-07 | Phase 64 | Pending |
| LEGAL-08 | Phase 64 | Pending |
| LEGAL-09 | Phase 64 | Pending |
| LEGAL-10 | Phase 64 | Pending |
| PAY-01 | Phase 65 | Pending |
| PAY-02 | Phase 65 | Pending |
| PAY-03 | Phase 65 | Pending |
| PAY-04 | Phase 65 | Pending |
| PAY-05 | Phase 65 | Pending |
| PAY-06 | Phase 65 | Pending |
| PAY-07 | Phase 65 | Pending |
| PAY-08 | Phase 65 | Pending |
| PAY-09 | Phase 65 | Pending |
| PAY-10 | Phase 65 | Pending |
| PAY-11 | Phase 65 | Pending |
| AUTH-12 | Phase 66 | Pending |
| AUTH-13 | Phase 66 | Pending |
| AUTH-14 | Phase 66 | Pending |
| AUTH-15 | Phase 66 | Pending |
| AUTH-16 | Phase 66 | Pending |
| AUTH-17 | Phase 66 | Pending |
| OPS-01 | Phase 67 | Pending |
| OPS-02 | Phase 67 | Pending |
| OPS-03 | Phase 67 | Pending |
| OPS-04 | Phase 67 | Pending |
| OPS-05 | Phase 67 | Pending |
| OPS-06 | Phase 67 | Pending |
| OPS-07 | Phase 67 | Pending |
| OPS-08 | Phase 67 | Pending |
| OPS-09 | Phase 67 | Pending |
| OPS-10 | Phase 67 | Pending |
| LAND-01 | Phase 68 | Pending |
| LAND-02 | Phase 68 | Pending |
| LAND-03 | Phase 68 | Pending |
| LAND-04 | Phase 68 | Pending |
| LAND-05 | Phase 68 | Pending |
| LAND-06 | Phase 68 | Pending |
| LAND-07 | Phase 68 | Pending |
| LAND-08 | Phase 68 | Pending |
| DS-01 | Phase 69 | Pending |
| DS-02 | Phase 69 | Pending |
| DS-03 | Phase 69 | Pending |
| DS-04 | Phase 69 | Pending |
| DS-05 | Phase 69 | Pending |
| DS-06 | Phase 69 | Pending |
| DS-07 | Phase 69 | Pending |
| DS-08 | Phase 69 | Pending |
| DS-09 | Phase 69 | Pending |
| DS-10 | Phase 69 | Pending |
| UAT-01 | Phase 70 | Pending |
| UAT-02 | Phase 70 | Pending |
| UAT-03 | Phase 70 | Pending |
| UAT-04 | Phase 70 | Pending |
| UAT-05 | Phase 70 | Pending |
| UAT-06 | Phase 70 | Pending |
| UAT-07 | Phase 70 | Pending |

**Coverage:** 200/200 REQ-IDs mapped across 19 phases. No orphans. No duplicates.
