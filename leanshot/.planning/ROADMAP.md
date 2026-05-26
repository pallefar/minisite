# Roadmap: LeanShot

## Milestones

- ✅ **v1.1 Multi-audience SaaS** — Phases 1-10 (shipped 2026-05-13) → [`.planning/milestones/v1.1-ROADMAP.md`](milestones/v1.1-ROADMAP.md)
- ✅ **v1.2 Polished Launch + Full Monetization** — Phases 12-15, 19, 22-23 shipped (2026-05-17); Phases 16-18, 20-21 deferred to v1.4 → [`.planning/milestones/v1.2-ROADMAP.md`](milestones/v1.2-ROADMAP.md)
- ✅ **v1.3 Platform Expansion — Revenue + Depth + B2B + HIPAA + M4 Community** — Phases 24-51 shipped 2026-05-25 (28 phases, 242 plans, 206/206 REQ-IDs functionally satisfied; audit `tech_debt`); Phase 32-06 ES contractor, Phase 34 Apple OAuth, Phase 50 Waves 2-4 deferred to v1.4 → [`.planning/milestones/v1.3-ROADMAP.md`](milestones/v1.3-ROADMAP.md)
- 📋 **v1.4 Launch Readiness** — Phases 52-70 (19 phases, 200 REQ-IDs). Carry-over backlog (P52-63) → launch-readiness gaps (P64-68) → design polish (P69) → consolidated UAT (P70). Per `feedback_milestone_uat_deferral_consolidation` forward-looking variant: every phase `autonomous: true`; ALL HUMAN-UAT rolls up to Phase 70.

## Phases

- [x] **Phase 52: Vendor Setup Foundation** — All vendor onboarding upfront so downstream phases have live integrations (Apple Dev + Play + APNs + FCM + HealthKit entitlement + Mux + Calendly + Better Stack + Sentry CSP + 7 v1.3 carry-over secrets)
- [x] **Phase 53: Capacitor Mobile Shells** — iOS + Android wrappers; CI per-platform builds; signing certs; RevenueCat SDK; store submission package
- [x] **Phase 54: Push Notifications** — Web Push (VAPID) + native iOS APNs + Android FCM; permission UX; frequency-cap + quiet-hours; per-platform delivery telemetry
- [x] **Phase 55: HealthKit + Two-Tunnel Firewall** — Apple Health PHI ingestion; iOS-only; OPT-IN per HIPAA; 3-layer firewall enforcement (no ad-surface cross-import)
- [x] **Phase 56: Ad Network** — AdMob iOS+Android + AdSense web; 3 modes (embed/platform/house); clinic-zero-ads enforced; per-network revenue ETL
- [x] **Phase 57: Watch Apps** — Apple Watch SwiftUI + Wear OS Compose companion; quick dose log + complication; offline-tolerant
- [x] **Phase 58: Spanish i18n Wiring** — Contractor TMX import + glossary integration + ES KB articles + ES smoke spec
- [x] **Phase 59: Apple OAuth + Onboarding Completion** — Sign-in-with-Apple provider + private-relay email + ONBOARD-05/06/07/10/11 finished
- [x] **Phase 60: RAG Knowledge Base Completion** — Phase 50 Waves 2-4 resume (scrape + embed + curation + AI-coach citations + federated PubMed/FDA + tip-of-day + newsletter + public hub)
- [ ] **Phase 60.5: Late-Phase Vendor Setup (60-69)** — `autonomous: false`. Consolidates operator-required vendor onboarding that emerged during Phase 60-69 planning: Cohere Rerank, OpenAI direct + Vercel AI Gateway, PostHog Personal API key (cost dashboard), Jina/PubMed/OpenFDA optional, Slack guardrail webhook vault entry. Mirrors Phase 52 pattern; runtime-verification of Phase 60+ gates on this.
- [x] **Phase 61: Admin Protocol Creator** — Evidence-cited dosing protocols (Tirzepatide titration, Retatrutide stack); 2-person review; distributes to clinician + patient + KB
- [x] **Phase 62: Insights & Research Engine** — Anonymized aggregate research compilation; k-anonymity (k≥5) + differential privacy; admin dashboard + white-paper pipeline + opt-in blog; feeds RAG
- [x] **Phase 64: Legal Refresh** — State-privacy (CCPA/CDPA/CPA/CTDPA/UCPA) + policy/ToS audit + accessibility statement + DMCA agent + cookie WCAG 2.2 AA re-audit + grandfathered-notice email (BLOCKER)
- [ ] **Phase 65: Stripe Tax + Payment Resilience** — Stripe Tax enable + automatic_tax + B2B tax_id collection + nexus-monitoring dashboard + 3-email dunning + in-app banner + refund self-service + idempotency burst-retry test + trial-ending/win-back (BLOCKER)
- [ ] **Phase 66: Consumer Account Security** — Consumer-facing MFA/TOTP self-serve + per-IP/per-email sign-in lockout + brute-force PostHog alerting
- [ ] **Phase 67: Operational Runbooks + Observability** — Secrets-rotation runbook + DDoS k6 load-test + Vercel rate-limit + SENTRY_DSN Edge-Fn verify + funnel-break alerts + incident-response runbook + backup PITR restore drill
- [ ] **Phase 68: Audience Landing + Sales Enablement** — /for-doctors + /for-clinics + /for-coaches via page-builder + schema.org Service JSON-LD + demo/sandbox mode for clinic-buyer prospects (synthetic patients + auto-purge)
- [ ] **Phase 69: Layout & Design Polish** — DS harmonization audit across all v1.1/v1.2/v1.3/v1.4 surfaces; 4-size typography + 2 weights + accent reserved-list + DS primitive adoption + a11y baseline + dark mode parity + responsive sweep
- [ ] **Phase 69.5: Final Tech Debt Sweep + Device-UAT (Launch Prep)** — Last cleanup phase before launch gate. Phase 42's 5 device-UAT signals + REVIEW.md IN-* findings + ROADMAP checkbox drift + Calendly signed-handoff redesign + absorbed tech-debt from Phases 60/61/62 CARRY-OVER.md (vitest project bloat, schema-drift audit, migration timestamp drift, build artifacts gitignore, community_engagement fallback, matview cron registration). Mirrors Phase 60.5 decimal pattern.
- [ ] **Phase 70: Consolidated UAT — v1.4 Launch Gate** — `autonomous: false`. Multi-signal HUMAN-UAT roll-up: 33 v1.3 carry + 5 Phase 42 device + new v1.4 per-phase UAT + design polish UAT + full regression sweep across all 4 milestones

## Phase Details

### Phase 52: Vendor Setup Foundation

**Goal**: Consolidate every vendor onboarding upfront so every downstream phase has live integrations from day one. Eliminates the per-phase secret-deferral pattern that bit v1.3 (7 unset secrets at milestone close). Per user direction 2026-05-25: *"group all the vendor setups in to one phase, to ensure all is setup correctly from start of the milestone."*
**Depends on**: v1.3 complete (Phase 25 vendor BAA chain + Phase 41 vendor secret patterns)
**Requirements**: VENDOR-01, VENDOR-02, VENDOR-03, VENDOR-04, VENDOR-05, VENDOR-06, VENDOR-07, VENDOR-08, VENDOR-09, VENDOR-10, VENDOR-11, VENDOR-12
**Success Criteria** (what must be TRUE):

  1. `supabase secrets list` shows every Phase 53-68 dependency secret set with non-empty values
  2. `vercel env ls` shows every build-time public env var (`VITE_VAPID_PUBLIC_KEY`, `ADMOB_APP_ID_*`, etc.) present in production
  3. Apple Developer + Google Play accounts active; HealthKit entitlement approved; APNs cert + FCM service-account JSON captured
  4. Per-vendor smoke Edge Fn pings each live API successfully; failures surface in admin `vendor_smoke_log` dashboard
  5. `.planning/runbooks/vendor-secrets.md` documents every secret with rotation cadence + blast-radius
  6. `vendor_baa_chain` row exists for each new vendor (Mux confirmed BAA scope; Apple Dev + Google Play n/a noted)

**Plans**: 4 plans

- [x] 52-01-vendor-smoke-edge-fn-PLAN.md — vendor-smoke Edge Fn (dual-auth, fail-soft per-vendor registry, vendor_smoke_log upsert, deno tests)
- [x] 52-02-vendor-smoke-log-migration-PLAN.md — vendor_smoke_log table + staff RLS + daily 08:00 UTC vault-bearer cron
- [x] 52-03-admin-vendor-smoke-dashboard-PLAN.md — AdminVendorSmokeDashboard module + ADMIN_MODULES registration
- [x] 52-04-baa-seed-and-secrets-runbook-PLAN.md — vendor_baa_chain seed rows + runbooks/vendor-secrets.md

**UI hint**: yes

> Signals roll up to Phase 70 — see consolidated UAT phase.

### Phase 53: Capacitor Mobile Shells (iOS + Android)

**Goal**: Bundle the v2 web app as installable native iOS + Android apps with CI per-platform builds, signed bundles, RevenueCat SDK wired, and TestFlight + Play internal-testing first builds on real devices.
**Depends on**: Phase 52 (Apple Dev cert + Play service-account)
**Requirements**: MOBILE-01, MOBILE-02, MOBILE-03, MOBILE-04, MOBILE-05, MOBILE-06, MOBILE-07, MOBILE-08, MOBILE-09, MOBILE-10
**Success Criteria** (what must be TRUE):

  1. `ios/` + `android/` platform dirs exist; `npx cap sync` succeeds on both; iOS + Android builds run green in GitHub Actions
  2. Signed AAB (Android) + IPA (iOS) artifacts produced by CI; uploaded to internal testing track / TestFlight automatically
  3. Cold-launch on physical iOS + Android device renders dashboard; login flow works; dose log persists to backend
  4. Universal Links + App Links resolve `https://app.leanshot.app/*` deep-link to in-app route (not browser)
  5. In-app account deletion screen reachable from mobile Settings (Apple §5.1.1(v) + Play §13.7)
  6. App Store + Play Store metadata package complete (screenshots + descriptions + privacy nutrition labels)

**Plans**: 4 plans

- [x] 53-01-PLAN.md — fastlane toolchain (build/upload lanes, gated signing) + store metadata + privacy nutrition labels
- [x] 53-02-PLAN.md — RevenueCat client-SDK env stubs + deep-link association validity + mobile account-deletion reachability + cap config validity
- [x] 53-03-PLAN.md — iOS + Android CI workflows (unsigned-green + gated upload) + AndroidManifest App Links
- [x] 53-04-revenuecat-webhook-mirror-PLAN.md — MOBILE-06 ownership: verify RC webhook → canonical public.subscriptions mirror + REVENUECAT_WEBHOOK_SECRET runbook

**UI hint**: yes

> Signals roll up to Phase 70 — see consolidated UAT phase.

### Phase 54: Push Notifications

**Goal**: Cross-platform push fan-out (Web Push + iOS APNs + Android FCM) with consistent permission UX, frequency-capping, quiet-hours, and per-platform delivery telemetry. Foundation for dose reminders + clinician alerts + community mentions + helpdesk replies.
**Depends on**: Phase 52 (APNs cert, FCM JSON, VAPID), Phase 53 (Capacitor shell)
**Requirements**: PUSH-01, PUSH-02, PUSH-03, PUSH-04, PUSH-05, PUSH-06, PUSH-07, PUSH-08
**Success Criteria** (what must be TRUE):

  1. Web push notification delivers to a Chrome desktop session after permission grant
  2. iOS push notification delivers to a real iOS device via APNs cert; opening notification deep-links to in-app route
  3. Android push notification delivers via FCM; same deep-link behavior
  4. `push-dispatch` Edge Fn fans out across all user's registered tokens; cross-platform delivery telemetry visible in PostHog
  5. Quiet-hours window (22:00-08:00 user-tz) blocks non-urgent notifications; urgent (clinician alerts) override
  6. Failing tokens auto-prune after 3 consecutive failures

**Plans**: 5 plans

- [x] 54-01-PLAN.md — migrations (platform/device_token/failure_count + helpdesk-reply widening) + Category type sync + Wave-0 RED scaffolds
- [x] 54-02-PLAN.md — push-dispatch Edge Fn (cross-platform fan-out, quiet-hours, prune, telemetry)
- [x] 54-03-PLAN.md — @capacitor/push-notifications + native registerForPush + push-subscribe native body
- [x] 54-04-PLAN.md — notification-send web-only push filter + helpdesk-reply category
- [x] 54-05-PLAN.md — NotificationsSubtab quiet-hours UI + helpdesk-reply matrix + native enable branch

**UI hint**: yes

> Signals roll up to Phase 70 — see consolidated UAT phase.

### Phase 55: HealthKit + Two-Tunnel Firewall

**Goal**: Apple Health read-only import path with explicit OPT-IN consent and architectural firewall preventing HealthKit data from reaching ad-targeting surfaces (Apple §5.1.3). Imports map to existing weight/meal/workout/sleep tables.
**Depends on**: Phase 52 (HealthKit entitlement), Phase 53 (Capacitor shell)
**Requirements**: HEALTH-01, HEALTH-02, HEALTH-03, HEALTH-04, HEALTH-05, HEALTH-06, HEALTH-07, HEALTH-08
**Success Criteria** (what must be TRUE):

  1. User on iOS device toggles HealthKit ON via explicit OPT-IN consent screen with full disclosure
  2. Background sync at admin-configured interval imports bodyMass / steps / sleep / heartRate; data appears in existing dashboard surfaces
  3. Two-tunnel firewall enforced: 3-layer (ESLint AST + runtime + CI grep) blocks any `health-*` Fn importing ad/marketing modules
  4. User can revoke HealthKit access from Settings; future syncs blocked; historical imported data optionally purgeable
  5. `PrivacyInfo.xcprivacy` lists every read type; App Store reviewer can verify
  6. Battery-aware background sync skips on low-battery state

**Plans**: 4 plans

Plans:

- [x] 55-01-firewall-three-layers-PLAN.md — 3-layer two-tunnel firewall (ESLint AST + runtime guard + CI grep), each individually tested
- [x] 55-02-db-foundation-plugin-PLAN.md — hk_source columns + healthkit_sync_state table + purge/upsert RPCs + @capgo/capacitor-health plugin install
- [x] 55-03-health-impl-import-mapping-PLAN.md — full health.ts read-only import + idempotent mapping to existing tables + revoke/purge logic (mock-tested)
- [x] 55-04-consent-ui-settings-privacy-PLAN.md — OPT-IN consent modal + Settings revoke/purge + PrivacyInfo.xcprivacy §5.1.3 fix

**UI hint**: yes

> Signals roll up to Phase 70 — see consolidated UAT phase.

### Phase 56: Ad Network

**Goal**: Three-mode ad system (embed-code / ad-platform / house ads) with strict surface exclusion (clinic / doctor-share / admin / dose-log / patient / share NEVER show ads), tier-gated (Pro/Lifetime zero ads), HealthKit firewall preserved, and per-network revenue ETL closing the unit-economics loop with Phase 33 ad-spend.
**Depends on**: Phase 52 (AdMob/AdSense publisher IDs), Phase 53 (Capacitor for AdMob SDK), Phase 55 (HealthKit firewall sibling enforcement)
**Requirements**: AD-01, AD-02, AD-03, AD-04, AD-05, AD-06, AD-07, AD-08, AD-09, AD-10, AD-11, AD-12
**Success Criteria** (what must be TRUE):

  1. Free-tier consumer surface shows ad placements (AdSense web + AdMob mobile); Pro/Lifetime tier shows zero ads
  2. Clinic / doctor-share / admin / `/dose-log/*` / `/share/*` / `/patient/*` surface shows zero ads regardless of tier; runtime guard + CI grep test prove it
  3. Frequency capping limits per-user-per-session-per-placement impressions to admin-configured ceiling
  4. Admin revenue dashboard shows eCPM / RPM / fill rate / CTR by placement + network
  5. Advertiser block-list excludes competing GLP-1 brands by default; CSP allowlist generated from this
  6. HealthKit data structurally cannot reach ad-targeting (3-layer test green)

**Plans**: 6 plans in 3 waves

- [x] 56-01-PLAN.md — Ad guard core: canShowAds(surface,tier) + freq-cap + placement registry contract (AD-03/08/10)
- [x] 56-02-PLAN.md — Revenue ETL backend: ad_placements + GLP-1 blocklist + ad_revenue_facts + cron/RPC + ad-revenue-etl Edge Fn (AD-05/09/12)
- [x] 56-03-PLAN.md — Ad serving: @capacitor-community/admob + real ads.ts + AdSense injector + AdRenderer 3-mode dispatch (AD-01/02/04/07)
- [x] 56-04-PLAN.md — CSP allowlist generated from GLP-1 block-list, wired into Edge Middleware (AD-09)
- [x] 56-05-PLAN.md — Admin revenue dashboard (eCPM/RPM/fill/CTR) reusing AdminMetrics + manifest entry (AD-06)
- [x] 56-06-PLAN.md — Surface-exclusion CI grep gate + HealthKit firewall regression test + ci.yml wiring (AD-03/11)

**UI hint**: yes

> Signals roll up to Phase 70 — see consolidated UAT phase.

### Phase 57: Watch Apps (Apple Watch + Wear OS)

**Goal**: Companion watch apps surfacing quick dose log + next-dose complication + streak + site-rotation recommendation. Offline-tolerant queue + phone backend sync on reconnect. Inherits HealthKit firewall scope from Phase 55.
**Depends on**: Phase 52 (Apple Dev cert), Phase 53 (Capacitor + iOS/Android projects), Phase 55 (HealthKit firewall pattern)
**Requirements**: WATCH-01, WATCH-02, WATCH-03, WATCH-04, WATCH-05, WATCH-06, WATCH-07, WATCH-08
**Success Criteria** (what must be TRUE):

  1. Apple Watch complication renders next-dose + streak; tap → quick-log → row enters `injections`
  2. Wear OS tile renders same data; tap → quick-log syncs to phone backend
  3. Dose-reminder push delivers to watch when phone is locked
  4. Offline log on watch queues + syncs on next-connect without data loss
  5. Site-rotation next-recommended-site visible on watch mini-card
  6. HealthKit / Health Services reads (heart rate, activity) route via same firewall as Phase 55 — no ad-surface cross-import

**Plans**: 3 plans (Wave 1 — all parallel, no file overlap)
Plans:

- [x] 57-01-PLAN.md — iOS watchOS SwiftUI app + WidgetKit complication scaffolds (file-existence + xcodebuild -list)
- [x] 57-02-PLAN.md — Wear OS :wear Compose module + Tile + Data-Layer scaffold (static Gradle validation)
- [x] 57-03-PLAN.md — TS sync-contract + complication-data (vitest) + Phase 55 firewall extension to src/lib/watch/

**UI hint**: yes

> Signals roll up to Phase 70 — see consolidated UAT phase.

### Phase 58: Spanish i18n Wiring (Contractor-Delivered)

**Goal**: Full i18n keying of the patient-facing surfaces (onboarding, dashboard, settings, KB, clinic-invite) into the existing i18next namespaces + machine/Claude-generated ES translations at en↔es parity, CI ICU/parity gates, clinical glossary (flagged for Phase 70 advisor signoff), and a Spanish smoke test across the critical flow. NOTE (2026-05-25): the ROADMAP "wiring + verification only" framing (D-04) was OVERRIDDEN by the user after a reality check found the patient namespaces empty and no contractor TMX delivered — see 58-CONTEXT.md.
**Depends on**: v1.3 Phase 32 (i18n infrastructure shipped); contractor delivery (external; surfaces in this phase)
**Requirements**: I18N-11, I18N-12, I18N-13, I18N-14, I18N-15
**Success Criteria** (what must be TRUE):

  1. TMX file imported into `/locales/es/*.json` namespaces; CI lint validates ICU + missing-key coverage
  2. Clinical glossary integrated; clinical-advisor signoff captured in `.planning/runbooks/`
  3. TRANSLATOR-WORKFLOW.md runbook documents contractor handoff loop
  4. ES KB articles rendered; locale picker visible; tsvector ES dictionary returns results
  5. Playwright `es-smoke.spec.ts` passes across signup → onboarding → first dose log → AI chat → cancellation → KB search

**Plans**: 8 plans in 4 waves
Plans:
**Wave 1**

- [ ] 58-01-PLAN.md — Wave-0 infra: Gate 3 ICU guard, p58-es-smoke project + RED scaffold, clinical-glossary.md, TRANSLATOR-WORKFLOW.md
- [ ] 58-02-PLAN.md — onboarding namespace keying + ES (owns onboarding.json)
- [ ] 58-03-PLAN.md — clinic-invite (patient-side) namespace keying + ES (owns clinic.json)
- [ ] 58-04-PLAN.md — settings + KB keying + ES + KB ES content seed migration (owns settings.json, kb.json)
- [ ] 58-05-PLAN.md — dashboard cards → patient:card.* (establishes patient.json)

**Wave 2** *(blocked on Wave 1 completion)*

- [ ] 58-06-PLAN.md — dashboard tabs → patient:tab.* (depends_on 58-05; serialized patient.json)

**Wave 3** *(blocked on Wave 2 completion)*

- [ ] 58-07-PLAN.md — AI/modals/charts → patient:ai./modal./chart. (depends_on 58-06; finalizes patient.json)

**Wave 4** *(blocked on Wave 3 completion)*

- [ ] 58-08-PLAN.md — ES smoke GREEN across the full I18N-15 flow (depends_on 58-01/02/03/04/07)

**UI hint**: yes

> Signals roll up to Phase 70 — see consolidated UAT phase.

### Phase 59: Apple OAuth (Sign-in-with-Apple) + Onboarding Completion

**Goal**: Ship Sign-in-with-Apple (required for App Store) and finish v1.3 Phase 34's 5 partial ONBOARD requirements (activation walkthrough fixtures + Mobile Lighthouse re-verify + PostHog Experiments wiring).
**Depends on**: Phase 52 (Apple Sign-in service ID), Phase 53 (mobile shell for native button)
**Requirements**: AUTH-07, AUTH-08, AUTH-09, AUTH-10, AUTH-11
**Success Criteria** (what must be TRUE):

  1. Apple OAuth provider configured in Supabase Auth Dashboard; redirect URLs whitelisted
  2. "Sign in with Apple" button visible on login + signup + onboarding surfaces (≥44px tap target; native Apple branding compliance)
  3. Apple-private-relay email signup creates profile; user reaches activation event without explicit email
  4. ONBOARD-05/06/07/10/11 verified end-to-end (activation walkthrough + admin step builder + Mobile Lighthouse ≥90 + anonymous-to-authenticated merge)
  5. PostHog Experiments traffic split + ship-winner re-verified live with VENDOR-09 Personal API key

**Plans**: 3 plans in 3 waves

Plans:
**Wave 1**

- [ ] 59-01-PLAN.md — HIG "Sign in with Apple" button on SignInForm + SignUpForm (+ useTranslation) + en/es wordmark (AUTH-07/08)

**Wave 2** *(blocked on Wave 1 completion)*

- [ ] 59-02-PLAN.md — native iOS Apple Sign-In bridge (@capacitor-community/apple-sign-in + entitlement + signInWithIdToken, flag+platform gated) + private-relay (AUTH-07/09)

**Wave 3** *(blocked on Wave 2 completion)*

- [ ] 59-03-PLAN.md — PostHog experiment-variant bug fix + AuthCallbackView anon-merge + Lighthouse runnability (AUTH-10/11, ONBOARD-05/06/07/10/11)

**UI hint**: yes

> Signals roll up to Phase 70 — see consolidated UAT phase.

### Phase 60: RAG Knowledge Base Completion (Waves 2-4)

**Goal**: Resume v1.3 Phase 50 in-place to complete Waves 2-4: scrape + embedding worker + admin curation + AI-coach citation integration + re-ranker + federated PubMed/FDA/DailyMed + tip-of-day cron + newsletter + public knowledge hub. Per user's aggressive-foundations preference: MVP + STRETCH both ship.
**Depends on**: v1.3 Phase 50 Wave 1 (data layer + admin shell + event registry shipped); Phase 52 (Mux for any video-knowledge-source); Phase 54 (push for tip-of-day notifications)
**Requirements**: RAG-01, RAG-02, RAG-03, RAG-04, RAG-05, RAG-06, RAG-07, RAG-08, RAG-09
**Success Criteria** (what must be TRUE):

  1. Admin pastes a URL → scrape pipeline fetches HTML → chunks → queues → embedding worker writes to pgvector → curation queue surfaces it
  2. AI-coach response includes citation footnotes referencing retrieved RAG chunks with click-through to source row
  3. Cross-encoder re-ranker improves top-3 relevance vs raw cosine retrieval (a/b verifiable)
  4. Federated PubMed + FDA OpenFDA + DailyMed adapters sync external sources daily; admin can enable per-source
  5. Tip-of-day push fires daily to opted-in users; newsletter Resend digest delivers weekly
  6. Public knowledge hub at `/knowledge/*` renders SEO-indexed pages; rate-limited; sitemap inclusion

**Plans**: 15 plans (all complete — see `.planning/phases/60-rag-knowledge-base-completion-waves-2-4/`)
**Progress (Wave 0 + Wave 1 through 60-06):**
- ✅ 60-01 (kb_tables migration)
- ✅ 60-02 (_shared posthog-rag-events + rag-retrieve client)
- ✅ 60-03 (eval harness + gold-set)
- ✅ 60-04 (rag-summarize-and-chunk Fn)
- ✅ 60-05 (rag-embed-approved Fn via OpenRouter)
- ✅ 60-06 (rag-retrieve Edge Fn + Cohere/Jina rerank + eval dimensions)
- [x] 60-07 (federated PubMed/FDA/DailyMed)
- [x] 60-08 (admin queue UI)
- [x] 60-09 (admin federated toggle UI)
- [x] 60-10 (AI-coach citation UI)
- [x] 60-11 (tip-of-day card + Fn)
- [x] 60-12 (newsletter) COMPLETE
- [x] 60-13 (public /knowledge hub) COMPLETE
- [x] 60-14 (cost dashboard) COMPLETE
- [ ] 60-15 (BLOCKING close-out)
**UI hint**: yes

> Signals roll up to Phase 70 — see consolidated UAT phase.

### Phase 60.5: Late-Phase Vendor Setup (60-69)

**Goal**: Consolidate ALL operator-required vendor onboarding that emerged during Phase 60-69 planning into a single phase, per [[feedback_vendor_secret_preflight_surface]]. Mirrors Phase 52 vendor-setup-foundation pattern but for downstream v1.4 vendors. `autonomous: false` — operator runs CLI + dashboard signups.

7 secrets already set (programmatic + operator paste-back 2026-05-26):
- ✅ `POSTHOG_PROJECT_ID=140479` (programmatic)
- ✅ `RAG_RERANKER_PROVIDER=cohere` (env-flag default, programmatic)
- ✅ `NEWSLETTER_UNSUBSCRIBE_SIGNING_KEY` (openssl rand -hex 32, programmatic)
- ✅ `COHERE_API_KEY` (operator-provided)
- ✅ `POSTHOG_PERSONAL_API_KEY` (operator-provided, scope query:read)
- ✅ `OPENROUTER_API_KEY` (operator-provided — replaces direct Anthropic per substitution decision; 60-04 + 60-11 plans amended)
- ✅ `SLACK_GUARDRAIL_WEBHOOK_URL` (operator-provided; 60-02 helper patched to support env-var fast-path)

**Depends on**: Phase 52 (Vendor Setup Foundation patterns + vendor_smoke_log infra + runbooks/vendor-secrets.md)
**Requirements**: VENDOR-13, VENDOR-14, VENDOR-15, VENDOR-16, VENDOR-17, VENDOR-18 (new — extend Phase 52 vendor registry)
**Success Criteria** (what must be TRUE):

  1. `COHERE_API_KEY` set + `vendor_smoke_log` shows green Cohere Rerank v3.5 smoke (Phase 60 60-06 rerank path)
  2. `JINA_API_KEY` set (optional fallback — admin can swap via `RAG_RERANKER_PROVIDER=jina`)
  3. ✅ **Substituted:** `OPENROUTER_API_KEY` (set Batch 1) routes embeddings via `https://openrouter.ai/api/v1/embeddings` with model `openai/text-embedding-3-small`. 60-05 plan amended with `<override>` block. Direct `OPENAI_API_KEY` only needed as fallback if OpenRouter rejects the embedding model at execute time.
  4. ✅ **N/A:** Vercel AI Gateway eliminated for Phase 60 — OpenRouter provides equivalent cost-tracking + multi-provider routing. AI_GATEWAY_* env vars not needed.
  5. `POSTHOG_PERSONAL_API_KEY` set + cost dashboard HogQL query smoke green (60-14)
  6. `PUBMED_API_KEY` + `OPENFDA_API_KEY` set (optional; relaxes federated rate-limits for 60-07)
  7. Vault entry `slack_guardrail_webhook` populated (Slack incoming-webhook URL) for 60-02 guardrail alerts
  8. `.planning/runbooks/vendor-secrets.md` updated with Phase 60-69 vendor registry rows (Cohere, Jina, PubMed, OpenFDA, PostHog-personal, Slack-webhook)
  9. Runtime-verify of Phase 60 plans gated on these secrets re-run successfully after secret-set (Wave 1 retrieval/rerank/embed/federated paths)

**Plans**: TBD (operator-driven; mostly CLI + dashboard signups + one runbook update)
**UI hint**: no (admin infra only)

> Signals roll up to Phase 70 — see consolidated UAT phase.

### Phase 61: Admin Protocol Creator

**Goal**: Admin authoring tool producing versioned, RAG-evidence-cited dosing protocols (Tirzepatide 12-wk titration, Retatrutide stack, GHRP-2 sleep stack, etc.) consumable by clinician dashboard + patient dose-log + helpdesk KB. 2-person review rule + versioning + rollback.
**Depends on**: Phase 60 (RAG retriever for evidence search); v1.3 Phase 30 (clinician dashboard), Phase 35 (patient dose-log), Phase 37 (helpdesk KB)
**Requirements**: PROTOCOL-01, PROTOCOL-02, PROTOCOL-03, PROTOCOL-04, PROTOCOL-05, PROTOCOL-06, PROTOCOL-07, PROTOCOL-08
**Success Criteria** (what must be TRUE):

  1. Admin drafts a protocol → step-builder grid + RAG-evidence search drawer + AI-assist suggestions render correctly
  2. 2-person review enforced: SECDEF RPC rejects publish when actor == created_by
  3. Versioning + rollback: editing creates new version; previous published version stays live; admin can rollback
  4. Clinician on Phase 30 dashboard adopts a published protocol → assigns to patient → patient dose-log prefills
  5. Patient dose-log surfaces protocol-expected vs actual logged values
  6. Helpdesk KB article references a protocol_id → renders inline protocol summary card with citation footnotes

**Plans**: 8 plans (Wave 0 foundation: 3 / Wave 1 UI + integrations: 4 / Wave 2 close-out: 1)

- [x] 61-01-PLAN.md — DB tables + RLS + seed (PROTOCOL-01, 05)
- [x] 61-02-PLAN.md — 7 SECDEF RPCs (PROTOCOL-04, 05, 06)
- [x] 61-03-PLAN.md — protocol-ai-assist Edge Fn handler.ts/index.ts + tests (PROTOCOL-02, 03)
- [x] 61-04-PLAN.md — Admin core UI: Layout + ListPage + StatusBadge + KeyboardHelp + module manifest + @theme tokens (PROTOCOL-02)
- [x] 61-05-PLAN.md — Admin editor UI: EditorPage + StepRow + ReviewBanner + EvidenceSearchSheet + AiAssistModal (PROTOCOL-02, 03, 04, 05)
- [x] 61-06-PLAN.md — Clinician adopt flow: ClinicProtocolsPage + AdoptProtocolSheet + AdoptDiffModal + ClinicWorkspace nav (PROTOCOL-06)
- [x] 61-07-PLAN.md — Patient MedicationTab extension + BodyTab insights card + ProtocolSummaryCard + KB shortcode plugin + PublicProtocolPage + App.tsx selectView (PROTOCOL-07, 08)
- [x] 61-08-PLAN.md — Close-out: db push + Fn deploy + ROADMAP + STATE + CARRY-OVER

**UI hint**: yes

> Signals roll up to Phase 70 — see consolidated UAT phase.

### Phase 62: Insights & Research Engine

**Goal**: Anonymized aggregate research compilation across dose logs + body metrics + symptoms + retention + gamification + AI coach interactions. K-anonymity (k≥5) + differential privacy for cohorts <50. Admin research dashboard + white-paper publishing pipeline + opt-in public blog. Closes the RAG loop by feeding published papers back as primary-research evidence.
**Depends on**: Phase 60 (RAG ingestion for feedback loop); v1.3 data sources (dose logs, retention, gamification, AI coach, community engagement)
**Requirements**: INSIGHTS-01, INSIGHTS-02, INSIGHTS-03, INSIGHTS-04, INSIGHTS-05, INSIGHTS-06, INSIGHTS-07, INSIGHTS-08, INSIGHTS-09, INSIGHTS-10
**Success Criteria** (what must be TRUE):

  1. SECDEF RPC `compile_research_cohort(...)` rejects cohorts that would breach k-anonymity floor (k<5)
  2. Differential privacy Laplace noise visible on cohorts 5-50; admin sees epsilon parameter per output
  3. NO user_id / email / phone / address ever appears in `insights_*_rollup` matviews; CI grep test proves it
  4. Admin research dashboard at `/admin/research` renders interactive cohort builder + retention curves
  5. Published white paper appears at `/research/<slug>` SEO-indexed; RSS feed + OG share card render
  6. Published white paper auto-ingested into Phase 60 RAG as `source_type='leanshot_research'` chunks
  7. User revokes `profiles.research_consent` → cron drops their data from future rollups within 30 days

**Plans**: TBD
**UI hint**: yes

> Signals roll up to Phase 70 — see consolidated UAT phase.

### Phase 64: Legal Refresh

**Goal**: Ship the 5 launch-readiness legal items grouped from research B1+B2+HD6+HD7+HD8: state-privacy disclosures (CCPA + 4 others), policy/ToS audit + grandfathered notice email, accessibility statement page, DMCA agent + page, cookie banner WCAG 2.2 AA re-audit + CPRA copy. **BLOCKER per research** — cannot launch nationally without these.
**Depends on**: v1.3 Phase 22 (GDPR DSAR pipeline — extends), Phase 25 (subprocessor-diff cron — uses output)
**Requirements**: LEGAL-01, LEGAL-02, LEGAL-03, LEGAL-04, LEGAL-05, LEGAL-06, LEGAL-07, LEGAL-08, LEGAL-09, LEGAL-10
**Success Criteria** (what must be TRUE):

  1. PrivacyPolicy.tsx renders state-specific addendums for CCPA / VA-CDPA / CO-CPA / CT-CTDPA / UT-UCPA; legal-reviewed
  2. "Do Not Sell or Share" footer link + `/privacy/do-not-sell` opt-out form submit creates `privacy_optout_requests` row + propagates to PostHog opt-out + ad-network exclusion within 24h
  3. Privacy policy + ToS reflect every v1.2/v1.3 subprocessor (PostHog Session Replay, Anthropic, Mux, Stripe Connect, pgvector recommender, traffic-attribution); record-of-changes timestamped
  4. Grandfathered-notice email delivered to all pre-v1.4 registered users via lifecycle Edge Fn; honors email-preference
  5. `/legal/accessibility` + `/legal/dmca` pages exist with correct legal copy; DMCA agent registered with U.S. Copyright Office + listed
  6. Cookie banner passes axe-core WCAG 2.2 AA + surfaces "Do Not Sell" in same banner per CPRA regs

**Plans**: 8 plans
- [ ] 64-01-PLAN.md — DB schema: privacy_optout_requests + policy_notice_log + ad_targeting_exclusion + email_lifecycle_exclusion + data_rights_requests (5 migrations)
- [ ] 64-02-PLAN.md — privacy-optout-process Edge Fn (synchronous fan-out to PostHog opt-out + ad/email exclusion tables + Resend confirmation)
- [ ] 64-03-PLAN.md — grandfathered-policy-notice Edge Fn (idempotent one-shot Resend send — operator-invoked at Phase 70 UAT)
- [x] 64-04-PLAN.md — PrivacyPolicy 5 state addendums + What Changed banner + live SubprocessorList + ToS UGC content-license (LEGAL-01/04/08)
- [ ] 64-05-PLAN.md — DoNotSellPage + AccessibilityPage + DMCAPage + LegalLayout title render (LEGAL-02/05/06)
- [ ] 64-06-PLAN.md — DSAR portal state-residency Select + conditional checkboxes + data_rights_requests insert (LEGAL-03)
- [ ] 64-07-PLAN.md — Cookie banner CPRA Do-Not-Sell + AUTH-16 rate-limit mention + App.tsx routes + LegalFooter audit + sitemap (LEGAL-07/10 + AUTH-16)
- [ ] 64-08-PLAN.md — Close-out: db push + Fn deploy + axe-core re-audit checkpoint + ROADMAP/STATE/REQUIREMENTS/SUMMARY/CARRY-OVER/VERIFICATION
**UI hint**: yes

> Signals roll up to Phase 70 — see consolidated UAT phase.

### Phase 65: Stripe Tax + Payment Resilience

**Goal**: Ship the 5 payment-resilience launch items grouped from research B3+B4+HD9+HD10+HD12: Stripe Tax + B2B tax ID collection + nexus-monitoring + 3-email dunning + in-app banner + refund self-service + webhook idempotency burst-retry test + trial-ending/win-back lifecycle emails. **BLOCKER per research** — state DOR exposure + ROSCA compliance + dunning revenue recovery.
**Depends on**: v1.3 Phase 14 (Stripe subscriptions), Phase 22 (lifecycle email pipeline), Phase 40 (cancellation save-offers — reuses email infra)
**Requirements**: PAY-01, PAY-02, PAY-03, PAY-04, PAY-05, PAY-06, PAY-07, PAY-08, PAY-09, PAY-10, PAY-11
**Success Criteria** (what must be TRUE):

  1. Every Stripe checkout session creates with `automatic_tax: { enabled: true }` + `customer_update.address: 'auto'`; B2B clinic sessions also collect tax IDs
  2. `/admin/tax` nexus-monitoring dashboard surfaces per-state revenue + threshold-proximity warnings; Slack alert fires on breach
  3. Failed-payment user receives T+1d / T+3d / T+7d Resend dunning emails; in-app `<PaymentFailedBanner>` renders with update-payment deep-link
  4. User clicks "Request Refund" within trial OR money-back window → refund executes via Stripe + `refunds` row recorded
  5. Stripe webhook burst-retry Deno test (5× same event_id <1s) produces single-row outcome across affiliate-eligibility + ux_tier + subscription_events
  6. Trial-ending T-3d + T-1d emails deliver; win-back T+30 / T+60 / T+90 emails deliver to cancelled users with reactivation coupon

**Plans**: 8 plans
**UI hint**: yes

> Signals roll up to Phase 70 — see consolidated UAT phase.

### Phase 66: Consumer Account Security

**Goal**: Ship consumer-facing MFA / TOTP self-serve (reusing the admin flow from v1.3 Phase 25) and per-IP/per-email sign-in lockout with brute-force PostHog alerting. Closes research HD1 + HD2.
**Depends on**: v1.3 Phase 25 (admin SetupTotpPage + AAL2 step-up); Phase 52 (VENDOR-09 PostHog + Slack webhook for alerts)
**Requirements**: AUTH-12, AUTH-13, AUTH-14, AUTH-15, AUTH-16, AUTH-17
**Success Criteria** (what must be TRUE):

  1. Consumer user navigates to `/settings/security` → enrolls TOTP via QR code → enters code → backup codes shown
  2. Sensitive actions (delete-account, export-all-data, change-email) require AAL2 step-up when MFA enabled
  3. 5 failed sign-in attempts within 15min from same IP OR same email → 30min lockout; `auth_attempts_log` records each attempt
  4. Brute-force detection emits PostHog `auth_brute_force_detected` event + Slack webhook fires
  5. Cookie banner copy mentions sign-in-rate-limiting per CPRA notice-of-security-practices clause
  6. Admin can require MFA per-role (clinic-org admins, Gold+ affiliates, research-opt-in users)

**Plans**: 8 plans
**UI hint**: yes

> Signals roll up to Phase 70 — see consolidated UAT phase.

### Phase 67: Operational Runbooks + Observability

**Goal**: Ship the 6 operational runbook + observability items grouped from research HD3+HD4+HD5+HD14+HD15+HD16: secrets-rotation runbook + DDoS k6 load-test + Vercel rate-limit config + SENTRY_DSN Edge-Fn-level verify + funnel-break PostHog alerts + incident-response runbook + backup PITR restore drill.
**Depends on**: Phase 52 (VENDOR-12 secrets inventory baseline); v1.3 Phase 22 (lifecycle email + HBNR runbook foundation), Phase 41 (Better Stack status page)
**Requirements**: OPS-01, OPS-02, OPS-03, OPS-04, OPS-05, OPS-06, OPS-07, OPS-08, OPS-09, OPS-10
**Success Criteria** (what must be TRUE):

  1. `.planning/runbooks/secrets-rotation.md` documents every secret with rotation procedure + blast-radius + last-rotated-at tracking
  2. k6 DDoS load-test results captured (baseline + 10× + 100× scenarios); each public Edge Fn has documented breaking point + mitigation
  3. Vercel rate-limit config in place per public route; Edge Middleware fallback for unsupported routes
  4. CI guard fails build if any Edge Fn `@sentry/*` import resolves to no-op shim; SENTRY_DSN verified for Edge Fns
  5. PostHog funnel-break alert fires + Slack webhook delivers when activation / payment / signup funnel drops >20% week-over-week
  6. `.planning/runbooks/incident-response.md` + `.planning/runbooks/backup-restore.md` exist; PITR restore drill executed once + data integrity verified

**Plans**: 8 plans

> Signals roll up to Phase 70 — see consolidated UAT phase.

### Phase 68: Audience Landing + Sales Enablement

**Goal**: Ship 3 audience-specific landing pages (`/for-doctors`, `/for-clinics`, `/for-coaches`) via Phase 15 page-builder with schema.org `Service` JSON-LD per audience, plus a demo/sandbox mode for clinic-buyer prospects (synthetic patients + auto-purge). Closes research HD11 + HD13.
**Depends on**: v1.3 Phase 15 (page-builder), Phase 28-31 (org schema for demo-org), Phase 51 (traffic attribution for per-audience funnels)
**Requirements**: LAND-01, LAND-02, LAND-03, LAND-04, LAND-05, LAND-06, LAND-07, LAND-08
**Success Criteria** (what must be TRUE):

  1. `/for-doctors` + `/for-clinics` + `/for-coaches` render distinct copy + CTAs via page-builder; each has audience-targeted hero
  2. schema.org `Service` JSON-LD differentiates audience per page; sitemap includes all 3
  3. Clinic-buyer clicks "Try demo" → demo-org spins up with 5 synthetic patients via deterministic generator; user explores without entering real PHI
  4. Demo-org auto-purges at 7 days via pg_cron; admin extension button to extend up to 30 days max
  5. Phase 51 traffic attribution captures `landing_page` dimension; admin sees per-audience conversion separately in Funnels tab
  6. UTM-default-landing resolver routes `utm_source=clinic_outreach` to `/for-clinics`

**Plans**: 8 plans
**UI hint**: yes

> Signals roll up to Phase 70 — see consolidated UAT phase.

### Phase 69: Layout & Design Polish

**Goal**: Design-system harmonization audit across every v1.1/v1.2/v1.3/v1.4 surface using the established LeanShot DS: Tailwind v4 `@theme` tokens, 4-size typography ceiling (11/13/18/28 px), 2 weights, accent reserved-list, DS primitives (`Card`, `Modal`, `Sheet`, `Pill`, `EmptyState`, `Button`, `Input`, `Toast`, `Badge`, `ProgressRing`, `Skeleton`, `Sparkline`), aria-* baseline, `useReducedMotion` gating, dark-mode parity, mobile responsive at 375px. Per `feedback_ui_researcher_prebake_constraints`: bake these constraints into the UI-SPEC up-front.
**Depends on**: Phases 52-68 (all functional surfaces shipped — design polish audits AFTER feature ship)
**Requirements**: DS-01, DS-02, DS-03, DS-04, DS-05, DS-06, DS-07, DS-08, DS-09, DS-10
**Success Criteria** (what must be TRUE):

  1. `gsd-ui-auditor` clean-run across admin shell + consumer surfaces + marketing + clinic + community + courses + events + research + landing pages; per-surface PASS evidence captured
  2. CI grep catches zero ad-hoc hex / rgb values outside `leanshot/src/index.css` `@theme {}` block
  3. Typography scan finds ONLY 4 sizes (11 / 13 / 18 / 28 px) and 2 weights (400 + 600) across all surfaces
  4. Accent color usage limited to documented reserved-list; non-reserved usage caught + fixed
  5. DS primitive adoption sweep refactors one-off duplicate components; bundle size delta documented
  6. Dark mode parity audit: every v1.4 surface (P52-68) renders correctly in `data-theme="dark"`; VR snapshots captured
  7. Mobile responsive sweep at 375px: no horizontal scroll, ≥44px tap targets, content reflows correctly

**Plans**: 8 plans
**UI hint**: yes

> Signals roll up to Phase 70 — see consolidated UAT phase.

### Phase 69.5: Final Tech Debt Sweep + Device-UAT (Launch Prep)

**Goal**: The last cleanup phase before launch gate UAT. Validate Phase 42's 5 device-UAT signals against the v1.4 build, sweep all v1.2/v1.3-era REVIEW.md IN-* findings, fix ROADMAP checkbox drift + SUMMARY frontmatter consistency, finish deferred Calendly OAuth signed-handoff redesign, AND absorb all tech-debt items accumulated during Phases 60-69 CARRY-OVER.md files (vitest project bloat, schema-drift audit, migration timestamp drift, build artifacts gitignore, community_engagement fallback, matview cron registration, Layer 1 UPDATE-immutability for published rows, org-scoping check inside `assign_protocol_to_patient`). Mirrors Phase 60.5 decimal pattern; moved from Phase 63 to position immediately before launch gate per user direction 2026-05-26 ("need this to be the final phase to clean everything before launching").
**Depends on**: v1.3 close (Phase 42 axe baseline + REVIEW.md docs); Phase 52 (Calendly OAuth secrets for CR-02 redesign); Phases 60/61/62 CARRY-OVER.md (tech-debt items absorbed at plan-time)
**Requirements**: DEBT-01, DEBT-02, DEBT-03, DEBT-04, DEBT-05, DEBT-06 (existing); plus carry-over items from Phases 60-69 cataloged at plan-time
**Success Criteria** (what must be TRUE):

  1. Phase 42 5 device-UAT signals (axe-core CI baseline, push device smoke, dark-mode VR snapshots, PWA installability, smart notifications) all PASS evidence captured
  2. REVIEW.md IN-* findings (Phase 41 + Phase 51 + any IN-* from Phase 60 code review) each resolved with `tech_debt_log` row
  3. ROADMAP.md per-plan checkbox normalization passes against SUMMARY frontmatter for every phase
  4. Phase 41 CR-02 Calendly OAuth signed-handoff redesign shipped (replaces popup-iframe pattern)
  5. VALIDATION.md flag-flip post-merge automation in place; no manual inline-generation required
  6. **Vitest project includes tightened** — `functions-unit` + `src-lib-unit` projects from Phase 62 no longer capture pre-existing Phase 47/49/50/60 Deno-only tests as false positives (per `feedback_vitest_project_include_too_broad`)
  7. **Schema-drift audit completed** — diff `supabase migration list --linked` against repo `supabase/migrations/*.sql`; reconciliation migrations written for any drift (Phase 62 surfaced `rag_sources.source_type`; expect more)
  8. **Build artifacts gitignored** — `leanshot/public/research/` + `leanshot/public/research-content/` (Phase 62 RSS/sitemap generator output) added to `.gitignore`
  9. **Matview cron registration** — pg_cron schedule for daily 02:00 UTC `REFRESH MATERIALIZED VIEW CONCURRENTLY` on all 5 Phase 62 `insights_*_rollup` matviews (currently NOT scheduled per Phase 62 CARRY-OVER)
  10. **Revoke-purge cron registration** — pg_cron schedule for nightly 01:00 UTC `purge_research_data_for_revoked()` (currently NOT scheduled per Phase 62 CARRY-OVER)
  11. **Migration timestamp convention** — codify forward-dating rule in `.planning/CLAUDE.md` or planner guidance to prevent back-dated push blocks (per `feedback_phase_close_out_supabase_gotchas`)
  12. **`community_engagement` table source** — either create the real table OR document the `ai_messages` fallback decision permanently in Phase 62 `insights_engagement_rollup` matview
  13. **Migration filename dependency ordering** — re-verify all Phase 62 migrations apply cleanly to a fresh DB rebuild (the 20290102000010 matview reorder was reactive, not preventive)
  14. **Phase 61 Layer 1 immutability** — Postgres trigger preventing UPDATE on `protocols` rows where `review_state='published'` except via SECDEF RPCs (per Phase 61 CARRY-OVER)
  15. **Phase 61 org-scoping** — add explicit org_id check inside `assign_protocol_to_patient` RPC (currently trusts Phase 30 roster RLS; per Phase 61 CARRY-OVER)
  16. **Vendor-string drift audit** — sweep all $ai_generation event emissions for canonical `vendor:` field per Phase 60 CR-01 lesson (Phase 60 CARRY-OVER item)
  17. **Admin-action-token mechanism** — Phase 60-09 Option D deferred admin-action-token; either ship the mechanism here OR explicitly defer to v1.5 with rationale (per Phase 60 CARRY-OVER)
  18. **Backlog migration audit** — retroactive testing of P48/49/50-traffic migrations applied via `migration repair` (per Phase 60 CARRY-OVER)

**Plans**: TBD (8-12 plans expected; tech-debt absorber)

> Signals roll up to Phase 70 — see consolidated UAT phase.

### Phase 70: Consolidated UAT — v1.4 Launch Gate

**Goal**: Single multi-signal HUMAN-UAT phase that rolls up every outstanding UAT signal accumulated across v1.3 carry-over + Phase 42 device-UAT + new v1.4 per-phase UAT + Phase 69 design polish UAT + full regression sweep. **`autonomous: false`** — the only non-autonomous phase in v1.4. Per `feedback_multi_signal_human_verify_checkpoint_pattern`: N discrete approve-able signals, not one mega-signal. Ship rule decided at planning.
**Depends on**: Phases 52-69 (everything else complete first)
**Requirements**: UAT-01, UAT-02, UAT-03, UAT-04, UAT-05, UAT-06, UAT-07
**Success Criteria** (what must be TRUE):

  1. All 33 v1.3-deferred HUMAN-UAT signals (from `v1.3-uat-deferred.md`) replayed at staging with live-vendor-secret fixtures + per-signal signoff captured
  2. All 5 Phase 42 device-UAT signals re-validated against v1.4 build on physical iOS + Android device
  3. New v1.4 per-phase UAT signals validated: mobile / push / HealthKit / Apple OAuth / watch / ad-network / RAG / Protocol / Insights / Legal / Stripe Tax / MFA / runbooks / landing / design-polish
  4. Phase 69 design polish UAT evidence captured (`gsd-ui-auditor` final-pass + dark-mode VR diff + mobile Lighthouse ≥90)
  5. Full regression sweep: Playwright e2e + Deno test sweep + axe-core CI + Edge Fn smoke + Sentry health-check all green for ≥48h before launch
  6. Multi-signal structure honored: signals grouped by environment-fixture-shared sets (browser, iOS, Android, Stripe test, vendor-OAuth, ops-runbook-drill); each independently approvable
  7. Ship rule applied uniformly to final go/no-go decision

**HUMAN-UAT signals (consolidated):**

- 33 v1.3 carry-over signals (Phase 35:6, Phase 36:3, Phase 40:4, Phase 41:6, Phase 43:4, Phase 44:4, Phase 51:6)
- 5 Phase 42 device-UAT signals (axe-core CI baseline, push device smoke, dark-mode VR snapshots, PWA installability, smart notifications)
- Phase 52 — per-vendor smoke + secret-presence verification
- Phase 53 — TestFlight + Play internal-testing first-build cold-launch on real iOS + Android device
- Phase 54 — cross-platform push delivery (web Chrome, iOS Safari/native, Android Chrome/native); quiet-hours respected
- Phase 55 — HealthKit OPT-IN consent + import + revoke flow on physical iOS device; PrivacyInfo.xcprivacy reviewer-verified
- Phase 56 — clinic / doctor-share / admin / dose-log surface zero-ads verification on real account
- Phase 57 — Apple Watch + Wear OS complication + quick-log + offline-queue + reconnect-sync on real devices
- Phase 58 — ES smoke spec on real browser session in Spanish locale
- Phase 59 — Apple OAuth signin + private-relay email signup → activation on real iOS device
- Phase 60 — AI-coach citation footnotes + admin curation + public knowledge hub render on real session
- Phase 61 — 2-person review flow on real admin accounts + clinician-adopt-protocol → patient-prefill on real patient account
- Phase 62 — k-anonymity-enforcement (cohort <5 returns suppressed) + research-blog publish + RAG feedback ingestion verified
- Phase 69.5 — Phase 42 5 device-UAT re-evidence against v1.4 build + accumulated tech-debt sweep from Phases 60-69 CARRY-OVER.md
- Phase 64 — state-privacy opt-out propagation to PostHog + ad-network within 24h verified on real account; DMCA-takedown email-to-action flow walkthrough
- Phase 65 — cross-state purchase tax calc verified; 3-email dunning cadence delivered; refund self-service in trial + money-back window
- Phase 66 — consumer TOTP enroll + AAL2 step-up + brute-force lockout fires on 6th failed attempt
- Phase 67 — PITR restore drill evidence captured; DDoS k6 load-test results reviewed; funnel-break alert fires on test traffic drop
- Phase 68 — per-audience landing page render + demo-org auto-purge at 7d verified
- Phase 69 — `gsd-ui-auditor` final-pass + dark-mode VR diff + mobile Lighthouse ≥90 evidence
- Full regression: Playwright e2e + Deno sweep + axe-core CI + Edge Fn smoke + Sentry health green for ≥48h

**Plans**: 8 plans

---

## Future Requirements (v1.5+)

Items deferred from v1.4 to a future milestone:

- M5b full AI Personalization (anomaly detection + churn model + automated win-back) — needs event-data maturity post-v1.4 launch traffic
- HIPAA HITRUST certification (only if large clinics demand; 10-20× SOC 2 cost)
- Hourly ad-revenue ETL (currently daily; revisit at $1k/mo revenue)
- Subdomain white-label `acme.leanshot.app` (Capacitor universal-link + AASA complexity)
- i18n `/es/` path-prefix routing (would double Vercel rewrites)
- HealthKit write-back (read-only this milestone)
- Standalone watch mode (companion only this milestone)
- App Store / Play in-app review SDK (M3 native rating; requires shipped store presence + traffic data)
- Core Web Vitals re-baseline post-v1.4
- Database top-10 hot-query explain-analyze + index sweep
- Edge Fn cold-start budget refactor (v1.4 audits in OPS-09; refactor lands in v1.5)
- RTL CSS preparation (Arabic / Hebrew when demand signal exists)

---

<details>
<summary>✅ v1.3 Platform Expansion (Phases 24-51) — SHIPPED 2026-05-25</summary>

28 phases, 242 plans, 206/206 REQ-IDs functionally satisfied across 25 workstreams. Triple-bet release: paying clinics under BAA + HIPAA controls live, deepened consumer product (M2/M3/M5b/M6/M7), tightened unit economics (multi-tier affiliate + ad-spend ETL + A/B trifecta + save-offers), plus full M4 Membership/Community Platform (feed + spaces + DMs + courses + events + moderation + search/digests) in-house on Supabase + Mux. Audit: `tech_debt` (no functional blockers).

Deferred to v1.4: Phase 32-06 (ES contractor), Phase 34 (Apple OAuth + 34-08/10), Phase 50 Waves 2-4 (RAG MVP+STRETCH), Phase 42 (5 device-UAT signals), 33 consolidated HUMAN-UAT signals, 7 vendor secrets. Mobile (P16-21) carries over from v1.2.

Full detail + per-phase plans + decisions: [`.planning/milestones/v1.3-ROADMAP.md`](milestones/v1.3-ROADMAP.md). Audit: [`.planning/milestones/v1.3-MILESTONE-AUDIT.md`](milestones/v1.3-MILESTONE-AUDIT.md). UAT runbook: [`.planning/milestones/v1.3-uat-deferred.md`](milestones/v1.3-uat-deferred.md).

</details>

<details>
<summary>✅ v1.2 Polished Launch + Full Monetization (Phases 12-15, 19, 22-23) — SHIPPED 2026-05-17</summary>

7 active phases, 59 plans, 60 REQ-IDs satisfied. 5 phases descoped to v1.4.

- [x] **Phase 12: Bootstrap & Bundle Foundations** (5/5 plans)
- [x] **Phase 13: Design System v2 Rollout** (6/6 plans + 13-07 addendum)
- [x] **Phase 14: Monetization Foundation** (11/11 plans)
- [x] **Phase 15: Page Builder + Landing Pages** (10/10 plans)
- [ ] **Phase 16: Capacitor Mobile Shells** — **descoped to v1.4 (now Phase 53)**
- [ ] **Phase 17: Push Notifications** — **descoped to v1.4 (now Phase 54)**
- [ ] **Phase 18: HealthKit + Two-tunnel Firewall** — **descoped to v1.4 (now Phase 55)**
- [x] **Phase 19: Affiliate Program + Stripe Connect** (10/10 plans)
- [ ] **Phase 20: Ad Network** — **descoped to v1.4 (now Phase 56)**
- [ ] **Phase 21: Watch Apps** — **descoped to v1.4 (now Phase 57)**
- [x] **Phase 22: Owner/Admin + Lifecycle Email + DSAR + Cookie Consent** (12/12 plans)
- [x] **Phase 23: v1.1 Tech Debt Sweep + Launch Polish** (5/5 plans)

</details>

<details>
<summary>✅ v1.1 Multi-audience SaaS (Phases 1-10) — SHIPPED 2026-05-13</summary>

11 phases / 76 plans / 497 commits / 48/49 REQ-IDs. Production live. Full detail: [`.planning/milestones/v1.1-ROADMAP.md`](milestones/v1.1-ROADMAP.md).

</details>

---

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 52. Vendor Setup Foundation | 4/4 | Complete   | 2026-05-25 |
| 53. Capacitor Mobile Shells | 4/4 | Complete   | 2026-05-25 |
| 54. Push Notifications | 5/5 | Complete   | 2026-05-25 |
| 55. HealthKit + Two-Tunnel Firewall | 4/4 | Complete   | 2026-05-25 |
| 56. Ad Network | 6/6 | Complete   | 2026-05-25 |
| 57. Watch Apps | 3/3 | Complete   | 2026-05-25 |
| 58. Spanish i18n Wiring | 0/0 | Not started | - |
| 59. Apple OAuth + Onboarding Completion | 0/3 | Planned | - |
| 60. RAG Knowledge Base Completion | 13/15 | In Progress|  |
| 61. Admin Protocol Creator | 8/8 | Complete | 3 migrations + 1 Fn deployed; 64+ tests green |
| 62. Insights & Research Engine | 8/8 | Complete | 6 migrations + 1 Fn deployed; 84 tests green |
| 64. Legal Refresh | 1/8 | In Progress|  |
| 65. Stripe Tax + Payment Resilience | 9/10 | In Progress|  |
| 66. Consumer Account Security | 0/0 | Not started | - |
| 67. Operational Runbooks + Observability | 0/0 | Not started | - |
| 68. Audience Landing + Sales Enablement | 0/0 | Not started | - |
| 69. Layout & Design Polish | 0/0 | Not started | - |
| 69.5. Final Tech Debt Sweep + Device-UAT (Launch Prep) | 0/0 | Not started | Absorbs tech-debt from Phases 60-69 CARRY-OVER.md |
| 70. Consolidated UAT — v1.4 Launch Gate | 0/0 | Not started | - |

---

*Last updated: 2026-05-25 — v1.4 ROADMAP authored. 19 phases (52-70), 200 REQ-IDs. Per `feedback_milestone_uat_deferral_consolidation` forward-looking variant: every phase autonomous:true; all HUMAN-UAT rolls up to Phase 70.*
