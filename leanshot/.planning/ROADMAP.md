# Roadmap: LeanShot

## Milestones

- ✅ **v1.1 Multi-audience SaaS** — Phases 1-10 (shipped 2026-05-13) → [`.planning/milestones/v1.1-ROADMAP.md`](milestones/v1.1-ROADMAP.md)
- ✅ **v1.2 Polished Launch + Full Monetization** — Phases 12-15, 19, 22-23 shipped (2026-05-17); Phases 16-18, 20-21 deferred to v1.4 → [`.planning/milestones/v1.2-ROADMAP.md`](milestones/v1.2-ROADMAP.md)
- 🚧 **v1.3 Platform Expansion — Revenue + Depth + B2B + HIPAA + M4 Community** — Phases 24-49 (started 2026-05-17, 9-12 month estimate)
- 📋 **v1.4** — Absorbs v1.2-deferred (PUSH/HEALTH/AD/WATCH/MOBILE/ON-01 = 44 REQs) + all v1.2/v1.3-era tech debt + additional new features

## Phases

<details>
<summary>✅ v1.2 Polished Launch + Full Monetization (Phases 12-15, 19, 22-23) — SHIPPED 2026-05-17</summary>

7 active phases, 59 plans, 60 REQ-IDs satisfied. 5 phases descoped to v1.4.

- [x] **Phase 12: Bootstrap & Bundle Foundations** (5/5 plans)
- [x] **Phase 13: Design System v2 Rollout** (6/6 plans + 13-07 addendum)
- [x] **Phase 14: Monetization Foundation** (11/11 plans)
- [x] **Phase 15: Page Builder + Landing Pages** (10/10 plans)
- [ ] **Phase 16: Capacitor Mobile Shells** — **descoped to v1.4**
- [ ] **Phase 17: Push Notifications** — **descoped to v1.4**
- [ ] **Phase 18: HealthKit + Two-tunnel Firewall** — **descoped to v1.4**
- [x] **Phase 19: Affiliate Program + Stripe Connect** (10/10 plans)
- [ ] **Phase 20: Ad Network** — **descoped to v1.4**
- [ ] **Phase 21: Watch Apps** — **descoped to v1.4**
- [x] **Phase 22: Owner/Admin + Lifecycle Email + DSAR + Cookie Consent** (12/12 plans)
- [x] **Phase 23: v1.1 Tech Debt Sweep + Launch Polish** (5/5 plans)

</details>

<details>
<summary>✅ v1.1 Multi-audience SaaS (Phases 1-10) — SHIPPED 2026-05-13</summary>

11 phases / 76 plans / 497 commits / 48/49 REQ-IDs. Production live. Full detail: [`.planning/milestones/v1.1-ROADMAP.md`](milestones/v1.1-ROADMAP.md).

</details>

### 🚧 v1.3 Platform Expansion (Phases 24-49) — IN PROGRESS

26 phases, 204 REQ-IDs across 24 workstreams. Triple-bet release: paying clinics under BAA, deepened consumer product, tightened unit economics, plus M4 Membership / Community in-house. Mobile (P16-21) deferred to v1.4.

- [ ] **Phase 24: Foundation — Modular Admin Shell + Event Taxonomy + Server-side PostHog** — Load-bearing measurement layer; admin 2FA; canonical events.ts; `_shared/posthog-server.ts`
- [x] **Phase 25: HIPAA Audit Hardening + Vendor BAA Chain** — Engineering layer (BAA-scope guard, subprocessor cron, PHI lint, email-router, Sentry/PostHog scrub); vendor/legal runs PARALLEL from Wave 0 (completed 2026-05-18)
- [ ] **Phase 26: Multi-Tier Affiliate (Standard / Gold / Lifetime)** — Tier stamping + locked-once-earned + recurring-commission cron + co-branded landing
- [ ] **Phase 27: Modular Admin Shell Extensions** — Bulk actions + cohort builder + command palette + funnel-anomaly cron + cohort matview
- [ ] **Phase 28: Clinic Organizations — Schema + RLS Hardening** — 16+ org-scoped tables + `withOrgScope` + HMAC realtime + cross-tenant proof tests + `src/lib/org.ts`
- [x] **Phase 29: Org Subscriptions + Per-Patient Metered Billing** — Separate `stripe_customer_id_org` + Stripe Meter Events + clinic patient-invite magic-link
- [ ] **Phase 30: Clinician Dashboard + Custom Rank Weights + Dose-Trend Alerts** — Per-clinic ranking + nightly alert cron + PHI-aware delivery + ack/snooze
- [x] **Phase 31: White-Label (Path-Based) + Org Roles + Clinic Onboarding Builder** — `org_branding` CSS-var overlay + owner/clinician/staff matrix + per-clinic onboarding override (completed 2026-05-18)
- [ ] **Phase 32: Spanish i18n (Parallel with Clinic Track)** — react-i18next + http-backend + `?lang=es` + transactional-email shim + `locale_overrides` + ICU pluralization
- [x] **Phase 33: Hourly Ad-Spend ETL (Meta + Google + TikTok)** — 3 hourly Edge Fns + `ad_spend_facts` partitioned + gap-detection cron + normalized-attribution view + `fx_rates` + admin CAC dashboard (completed 2026-05-18)
- [ ] **Phase 34: M2 Onboarding Overhaul + Activation Event** — Value-first preview + magic-link/Google/Apple SSO + drag-drop step builder + activation-event lock (blocks P39)
- [ ] **Phase 35: M3 Gamification Engine** — `xp_ledger` append-only + streak + freeze tokens + cohort-scoped leaderboard matview + canvas-confetti
- [x] **Phase 36: M3 Review Prompt Engine (Web Only)** — Internal NPS as INDEPENDENT surface + promoter → external CTA + non-promoter → helpdesk ticket
- [ ] **Phase 37: M6 Helpdesk Core** — `tickets` + `kb_articles` + Resend Inbound webhook + HMAC reply-threading + Claude AI assist + CSAT + realtime
- [ ] **Phase 38: M5b AI Recommender (pgvector + Claude Digest)** — `content_embeddings vector(1536)` + IVFFlat-vs-HNSW + OpenAI via AI Gateway + weekly Claude summary + win-back prompts
- [ ] **Phase 39: A/B Trifecta — Mid-Trial Paywall + Pharma Paywall + Page-Variant A/B** — Activation-triggered paywall + composite-goal kill-switch + canonical-link + 42-day cap + safety-info carve-out
- [ ] **Phase 40: Cancellation Save-Offers Flow** — Pause/downgrade/discount/extended-trial + offer-take ROI dashboard
- [ ] **Phase 41: Public Status Page + Embed-Provider Blocks** — Better Stack on `status.leanshot.app` + Calendly/YouTube/Tally sandboxed iframes + dompurify + Custom-iframe allowlist
- [ ] **Phase 42: v1.3 Polish Closeout — WCAG 2.2 AA + Smart Notifications + PWA Offline + Dark Mode + What's New + NPS** — axe-core CI + per-category notification center + `vite-plugin-pwa` + admin-shell dark mode + quarterly NPS
- [x] **Phase 43: M4 Membership Tiers Extension** — Lifetime tier on `tier_effective` + grandfathering coupons + community-gated entitlements
- [ ] **Phase 44: M4 Community Feed Foundation** — Posts + threaded comments + reactions + @mentions + image/Mux video embeds + Realtime
- [ ] **Phase 45: M4 Community Spaces + Member Directory + Opt-in DMs + Leaderboard** — Per-space tier visibility + DM rate-limiting + cohort-scoped leaderboard
- [ ] **Phase 46: M4 Courses / Classroom** — Modules + lessons + Mux adaptive video + completion certificates (jsPDF) + landing-page A/B + Pro-gated resources
- [ ] **Phase 47: M4 Events Calendar + Zoom + Reminders + Recording** — RSVPs with capacity/waitlist + Zoom OAuth + timezone-aware reminders + post-event lesson conversion
- [ ] **Phase 48: M4 Moderation** — Reports queue + mute/ban/suspend + banned-words + Claude auto-flagging + immutable audit log
- [ ] **Phase 49: M4 Search + Email Digests** — Postgres FTS (English + Spanish dictionaries shared with HELP-11) + daily/weekly Resend digests + opt-out + 1-click unsubscribe

## Phase Details

### Phase 24: Foundation — Modular Admin Shell + Event Taxonomy + Server-side PostHog

**Goal**: Measurement layer is load-bearing-ready for every downstream A/B + cohort + recommender; admin shell is modular + 2FA-enforced.
**Depends on**: v1.2 (Phase 22 admin foundation; Phase 19 affiliate)
**Requirements**: ADMIN-01, ADMIN-02, ADMIN-03, TAXO-01, TAXO-02, TAXO-04, TAXO-06
**Success Criteria** (what must be TRUE):

  1. Admin opens any module via the modular router without any module being hard-coded in admin shell (lazy-loaded, feature-flagged, route-gated)
  2. Admin login (and every admin-or-higher role) is blocked at middleware unless 2FA TOTP is verified
  3. Server-side PostHog captures signup/payment/activation/refund events from Edge Functions and the events are present in PostHog even when the browser has an adblocker installed
  4. Admin views the audit log diff viewer with before/after JSONB and confirms RLS denies updates/deletes on `audit_logs` rows
  5. Per-chunk bundle ceilings (admin-shell 30 kB, helpdesk-widget 25 kB, i18n-runtime 15 kB, gamification-burst 8 kB, community-feed 20 kB, course-player 30 kB) are declared in CI and `npm run build` fails when any chunk exceeds its ceiling

**UI hint**: yes

### Phase 25: HIPAA Audit Hardening + Vendor BAA Chain

**Goal**: Every engineering control HIPAA needs is live in code; vendor BAA chain is signed across 6 critical vendors so the first clinic deal can close mid-v1.3.
**Depends on**: Phase 24 (TAXO event registry + server-side PostHog masking surfaces); vendor/legal runs PARALLEL from Wave 0
**Requirements**: HIPAA-01, HIPAA-02, HIPAA-03, HIPAA-04, HIPAA-05, HIPAA-06, HIPAA-07, HIPAA-08, HIPAA-09, HIPAA-10, HIPAA-11, HIPAA-12, HIPAA-13, HIPAA-14, HIPAA-15, HIPAA-16, HIPAA-17, HIPAA-18
**Success Criteria** (what must be TRUE):

  1. Runtime BAA-scope guard in `ai-chat` Edge Fn refuses calls to non-BAA-covered Anthropic model IDs (Workbench / Console / beta endpoints) and a CI test proves the refusal
  2. CI lint (custom rule) BLOCKS any commit whose Stripe API call sites contain PHI keywords (patient name, diagnosis, medication name, lab value) in description/metadata/line-item description
  3. `vendor_baa_chain` row exists for each of Supabase / Vercel / Sentry / Anthropic / AWS SES / PostHog with `baa_signed_at` + `baa_expiry_at` columns populated; a weekly subprocessor-diff cron alerts on subprocessor changes
  4. `_shared/email-router.ts` routes PHI emails through AWS SES and non-PHI through Resend, switched by template `phi:boolean` flag; consumer ai-chat vs clinical-context ai-chat branches on `org_id IS NOT NULL`
  5. Sentry `data-sentry-mask` is asserted on every PHI input via a CI lint; PostHog `disable_session_recording_on_url` regex covers `/clinic/*`, `/patient/*`, `/admin/users/*`, `/dose-log/*`, `/share/*`, `/auth/*`

**Plans**: 10 plans

- [x] 25-01-PLAN.md — vendor_baa_chain + subprocessor_snapshots + admin module-seed migrations + 6 vendor seed rows + RLS integration test [Wave 1]
- [x] 25-02-PLAN.md — phi_access_log table + log_phi_access SECDEF RPC + patient Settings "Who has viewed my data" viewer + RLS test [Wave 1]
- [x] 25-03-PLAN.md — _shared/email-router.ts (Resend↔SES PHI split) + ses-bounce-webhook Edge Fn + ses_suppression_list table — vendor-gated Pattern S4 [Wave 1]
- [x] 25-04-PLAN.md — _shared/anthropic-baa-allowlist.ts + resolve-org-id stub + ai-chat 3-way branch (consumer Moonshot / clinical Anthropic / BAA-pending) [Wave 1]
- [x] 25-05-PLAN.md — scripts/lint-stripe-phi.ts + 23-keyword JSON + CI step (HIPAA-08) [Wave 1]
- [x] 25-06-PLAN.md — scripts/audit-sentry-mask.ts + PHI-prop JSON + CI step (HIPAA-16); baseline scan documented [Wave 2 — sequential ci.yml with 25-05]
- [x] 25-07-PLAN.md — PostHog session-replay PHI guard hook + analytics.ts global default (HIPAA-17 per RESEARCH correction #1) [Wave 1]
- [x] 25-08-PLAN.md — clinician MFA hard-cut guard + setup modal + patient optional MFA card + requireStepUp for sensitive actions + Playwright e2e [Wave 2]
- [x] 25-09-PLAN.md — baa-expiry-check + subprocessor-diff Edge Fns + pg_cron schedules + admin Compliance page (BaaChainTable + ExpiryBanner + SubprocessorDiffFeed) [Wave 2]
- [x] 25-10-PLAN.md — 7 HIPAA policy markdowns + Notion mirror script + Drata/training/risk-assessment human checkpoints [Wave 3]

### Phase 26: Multi-Tier Affiliate (Standard / Gold / Lifetime)

**Goal**: Existing v1.2 affiliate program graduates to tiered commissions with stamped-at-conversion-time accounting and Lifetime recurring payouts.
**Depends on**: v1.2 Phase 19 (affiliate program live)
**Requirements**: AFFTIER-01, AFFTIER-02, AFFTIER-03, AFFTIER-04, AFFTIER-05, AFFTIER-06
**Success Criteria** (what must be TRUE):

  1. New `affiliate_conversion` row stamps `tier_at_conversion_time` and `commission_cents` at insert; a CI test proves a retroactive tier upgrade DOES NOT mutate any historical conversion row
  2. Affiliate progresses Standard → Gold automatically at N paid conversions; Gold → Lifetime requires admin grant; partner dashboard renders a tier-progress bar + per-tier earnings breakdown + next-tier threshold
  3. Lifetime affiliates receive monthly recurring commissions on still-active subscribers via `affiliate-lifetime-recurring` cron Edge Fn until subscriber cancels
  4. Click-rate anomaly detector flags conversions whose impressions/clicks ratio Z-score exceeds 3σ on the 7-day baseline; flagged conversions appear in the admin review queue
  5. Gold partners` `/r/{code}/landing` page resolves to the premium-styled template variant (verified via Playwright screenshot diff)

**Plans**: 7 plans (2 waves)

Plans:

- [ ] 26-01-PLAN.md — schema slab: tier ALTERs + stamp trigger + ratchet trigger + new tables + payouts.adjustments + TS source-of-truth (AFFTIER-01, AFFTIER-02)
- [ ] 26-02-PLAN.md — ratio Z-score matview + affiliate-attribute extension + anomaly SLA reminder cron (AFFTIER-05)
- [ ] 26-03-PLAN.md — partner dashboard tier-progress bar + per-tier earnings breakdown (AFFTIER-03)
- [ ] 26-04-PLAN.md — Gold landing template variant + Playwright toHaveScreenshot infra + silent-fallback fix (AFFTIER-06)
- [ ] 26-05-PLAN.md — 5 SECDEF admin RPCs + tier-management + anomaly-review admin tabs (AFFTIER-01, AFFTIER-05)
- [ ] 26-06-PLAN.md — affiliate-lifetime-recurring monthly cron Edge Fn (AFFTIER-04)
- [ ] 26-07-PLAN.md — stripe-webhook charge.refunded + charge.dispute.created handlers + BLOCKING schema push + Stripe Dashboard HUMAN-UAT (AFFTIER-04 + D-06)

### Phase 27: Modular Admin Shell Extensions

**Goal**: Bulk actions + cohort builder + command palette + funnel anomaly detector unlock shared infrastructure for Phases 28, 30, 34, 37.
**Depends on**: Phase 24 (admin shell)
**Requirements**: ADMIN-04, ADMIN-05, ADMIN-06, TAXO-03, TAXO-05
**Success Criteria** (what must be TRUE):

  1. Admin runs a bulk action on the Members table (CSV export / tag / comp-plan / ban / force-password-reset) with a confirmation modal and an `audit_logs` row written per affected user
  2. Admin defines a cohort ("free users >7d", "past-due >3 days", "clinic admins") in the cohort-builder UI; cohort definition is reusable across TAXO funnels, GAME challenges, PAYWALL variants, RECOMMEND triggers, SAVE eligibility
  3. Cmd+K command palette opens from any admin route and fuzzy-searches modules + recent items + quick actions with keyboard-only navigation
  4. `cohort_membership` matview refreshes via pg_cron every 15 minutes and serves cohort-membership reads with sub-50ms p99 latency
  5. Anomaly-detection cron flags any tracked funnel where 24-hour conversion < (rolling-7-day-baseline − 2σ) and admin receives the alert in-app + email within 5 minutes of detection

**UI hint**: yes

### Phase 28: Clinic Organizations — Schema + RLS Hardening

**Goal**: 4-leak-vector multi-tenant schema is live and proven via cross-tenant impersonation tests; `withOrgScope` wrapper compile-time-enforced on all service_role queries.
**Depends on**: Phase 25 (HIPAA controls); Phase 24 (server PostHog for org events)
**Requirements**: ORG-01, ORG-02, ORG-03, ORG-04, ORG-05, ORG-06, ORG-07
**Success Criteria** (what must be TRUE):

  1. 16+ org-scoped tables (`organizations`, `org_members`, `org_invites`, `org_subscriptions`, `org_settings`, `org_branding`, `org_patient_links`, `org_consent_grants`, + 8 downstream) are live with RLS policies that JOIN on `org_id`; every one has a passing cross-tenant impersonation proof test (User A in Org X cannot read User B in Org Y)
  2. JWT `app_metadata.org_ids` claim propagates on `signInWithPassword` within the 336ms documented window; UI loading state shown until propagation completes (no flash-of-empty-org)
  3. `withOrgScope` TypeScript wrapper REFUSES at compile time any service_role query that omits `.eq('org_id', orgId)`; runtime assertion + Sentry alert fires if a bypass somehow lands
  4. Realtime channels are subscribed with HMAC-derived `org-{hmac}-{table}` names; subscribing to a channel with a mismatched org_id is rejected by the channel auth callback
  5. `src/lib/org.ts` resolves current org via path `/clinic/{slug}` → member.org_id → injection into every supabase-js client query

**Plans**: 8 plans (4 waves)

- [x] 28-00-PLAN.md — RECONCILE Phase 9 public.orgs → organizations (ALTER + 3 cols + 4 callsite patches) — HUMAN-CHECKPOINT [Wave 0]
- [x] 28-01-PLAN.md — 7 net-new org_* tables + RLS + 8 cross-tenant *-rls.test.ts + clinic-org-invite Edge Fn + cron [Wave 1]
- [x] 28-02-PLAN.md — withOrgScope 4-layer defense (brand types + ESLint rule + Proxy runtime + Sentry fatal) [Wave 1]
- [x] 28-03-PLAN.md — JWT Custom Access Token Hook + WorkspaceSwitcher propagation UX — HUMAN-CHECKPOINT [Wave 2]
- [x] 28-04-PLAN.md — HMAC realtime: Vault secret + SECDEF helper + RLS policy + browser channelNameFor — HUMAN-CHECKPOINT [Wave 2]
- [x] 28-05-PLAN.md — src/lib/org.ts org-context layer (6 D-03 exports + ROLE_PERMISSIONS + USER_UPDATED invalidation) [Wave 2]
- [x] 28-06-PLAN.md — RouteOrgGuard + resolve_clinic_slug anti-enumeration RPC [Wave 2]
- [ ] 28-07-PLAN.md — 28-EXTENSION-CONTRACT.md + admin manifest preview + plan-checker BLOCKER rules [Wave 3]

### Phase 29: Org Subscriptions + Per-Patient Metered Billing

**Goal**: Clinics pay Stripe per active patient via separate Stripe namespace; clinic admin invites patients via magic link.
**Depends on**: Phase 28 (org schema)
**Requirements**: ORG-08, ORG-09, ORG-10
**Success Criteria** (what must be TRUE):

  1. Same email address as a consumer customer creates a SEPARATE Stripe customer when used as a clinic admin (keyed by `(user_id, customer_context)`); a CI test proves no Stripe namespace collision
  2. Nightly metered-billing cron aggregates `count_active_patients(org_id)` (definition locked at Phase 29 CONTEXT.md, e.g., "logged-event-in-last-30-days") and POSTs a Stripe Meter Event per org; invoice line matches usage
  3. Clinic admin enters a patient email → patient receives magic-link invite → on first login, patient's `profiles.primary_org_id` is set and an `org_consent_grants` row records explicit consent
  4. Stripe webhook updates `org_subscriptions.status` and reflects in the clinic admin's billing surface within 30 seconds of the Stripe event

**Plans**: 8 plans (4 waves)

- [x] 29-00-PLAN.md — RECONCILE: drop org_subscriptions skeleton + extend subscriptions.seats_* + profiles.primary_org_id + 5 missing event-table indexes [Wave 0]
- [x] 29-01-PLAN.md — count_active_patients v2: 10-table UNION + org_patient_links source + service-role bypass + tests [Wave 1]
- [x] 29-02-PLAN.md — org_patient_invites table + 3 SECDEF RPCs + cross-tenant RLS proof (BLOCKER R1) [Wave 1]
- [x] 29-03-PLAN.md — invoice.created variance handler (D-04) + ORG-08 Stripe namespace CI test [Wave 1]
- [x] 29-04-PLAN.md — org-metered-billing-cron Edge Fn + pg_cron 02:00 UTC + deno tests [Wave 2]
- [x] 29-05-PLAN.md — clinic-patient-invite Edge Fn (send+preview+accept, two-phase magic-link) + browser helper [Wave 2]
- [x] 29-06-PLAN.md — ClinicBillingCard + ConsentAcceptScreen + realtime wire + Playwright e2e — HUMAN-VERIFY [Wave 3]
- [x] 29-07-PLAN.md — invite expiry cron (04:30 UTC) + Stripe PHI lint (D-11) + vendor checkpoints + phase close — HUMAN-CHECKPOINT [Wave 3]

### Phase 30: Clinician Dashboard + Custom Rank Weights + Dose-Trend Alerts

**Goal**: Clinic deals close on this surface; per-clinic ranking + nightly alert cron + ack/snooze workflow ship together.
**Depends on**: Phase 28 (org schema); Phase 25 (PHI email path); v1.1 Phase 10 (roster/drill-in)
**Requirements**: CLIN-01, CLIN-02, CLIN-03, CLIN-04, CLIN-05, CLIN-06, CLIN-07, CLIN-08
**Success Criteria** (what must be TRUE):

  1. Clinic admin configures per-clinic ranking weights (dose-adherence / weight-loss / activity / etc.) in `org_settings`; roster reorders within 1 second of save
  2. Nightly `dose-trend` cron inserts `clinician_alerts` rows for any patient breaching the per-clinic threshold; clinician receives in-app notification + PHI-aware email (no patient name in subject; routed via SES per HIPAA-05)
  3. Same alert within 24h debounces to a single notification; on delivery failure, 3 retries over 1h are attempted before failure is logged
  4. Clinician can acknowledge or snooze an alert; un-acted alerts auto-resolve after 7 days
  5. Aggregate clinic dashboard surfaces population-level metrics ("# patients on Wegovy below dosing range this week") via materialized view refreshing every 15 minutes

**UI hint**: yes
**Plans**: 6 plans (3 waves)

Plans:
**Wave 1**

- [ ] 30-00-PLAN.md — Wave 0 schema foundation: 5 migrations (org_settings cols + 3 new org-scoped tables + 4 SECDEFs + AFTER UPDATE trigger + weighted rank_org_patients + 2 matviews + 4 pg_cron jobs) + ORG_SCOPED_TABLES update + 6 RLS/unit test files + BLOCKING supabase db push
- [ ] 30-01-PLAN.md — Wave 1 clinician-alert-deliver-cron Edge Function + PHI lint extension + deno test suite
- [ ] 30-02-PLAN.md — Wave 1 ClinicRankingWeightsForm + ClinicDoseTrendThresholdsForm + use-org-settings-realtime hook + RosterTable wiring (SC#1)
- [ ] 30-03-PLAN.md — Wave 1 ClinicianAlertsPanel + AlertSnoozePopover + ClinicContextBar bell + Badge amber tone (SC#3/SC#4)
- [ ] 30-04-PLAN.md — Wave 1 ClinicDashboardOverview + use-clinic-metrics + PatientThresholdOverrideForm + ClinicDrillInPage Dose thresholds tab (SC#5)

**Wave 2** *(blocked on Wave 1 completion)*

- [ ] 30-05-PLAN.md — Wave 2 Playwright realtime e2e (SC#1 + SC#3) + Edge Fn deploy + bundle ceiling assertion + RLS suite live + phase close

### Phase 31: White-Label (Path-Based) + Org Roles + Clinic Onboarding Builder

**Goal**: Each clinic can theme itself path-based, admin per 3-role matrix, and customize patient onboarding via the same dnd-kit primitives Phase 15 shipped.
**Depends on**: Phase 28 (org_branding table); Phase 15 (dnd-kit primitives)
**Requirements**: ORG-11, ORG-12, ORG-13
**Success Criteria** (what must be TRUE):

  1. Visiting `/clinic/{slug}/...` applies `org_branding` CSS-var overlay (logo, primary color, accent, favicon) within first paint; no flash of unstyled theme
  2. Org admin assigns 3 roles (owner / clinician / staff) to org_members; UI gates admin actions per role; permission matrix is enforced both server-side (RLS) and client-side (UI)
  3. Clinic admin drags onboarding steps in the customizer (reusing Phase 15 dnd-kit primitives) and saves an org-specific onboarding flow; invited patients see that org's flow on first sign-in

**UI hint**: yes

### Phase 32: Spanish i18n (Parallel with Clinic Track)

**Goal**: Spanish ships as a non-blocking, lazy-loaded i18n runtime — UI strings + transactional emails + KB articles + clinical glossary all localized.
**Depends on**: Phase 24 (chunk ceilings — i18n-runtime 15 kB gz)
**Requirements**: I18N-01, I18N-02, I18N-03, I18N-04, I18N-05, I18N-06, I18N-07, I18N-08, I18N-09, I18N-10
**Success Criteria** (what must be TRUE):

  1. User loads `/?lang=es` → entire UI renders in Spanish; preference persists to `profiles.locale`; user with `Accept-Language: es-MX` on first visit auto-detects to Spanish
  2. `/locales/{lng}/{ns}.json` chunks lazy-load via `i18next-http-backend` (NOT eager-bundled); switching language adds ≤15 kB gz to network not bundle
  3. Welcome series, password reset, payment receipt, clinic invite, dunning, DSAR confirmation emails all render correct Spanish copy when `profiles.locale='es'`
  4. KB article `{slug}.es.md` files serve at the same URL path with `?lang=es`; HELP search returns Spanish results when `locale='es'`
  5. Admin edits a `locale_overrides` row to hot-patch a mistranslation per-org or per-deployment without redeploying; ICU pluralization passes the singular/plural/zero/other test fixture for both `en` and `es`

**UI hint**: yes

**Plans:** 7 plans

Plans:

- [x] 32-01-PLAN.md — i18n runtime + namespaces + missing-key telemetry (foundation)
- [x] 32-02-PLAN.md — String extraction sweep + EN catalogs (8 namespaces) + coverage CI gate
- [x] 32-03-PLAN.md — profiles.locale schema + custom detector + Settings Language picker + D-12 kg-default
- [x] 32-04-PLAN.md — locale_overrides table + RLS + admin module + Realtime invalidation
- [x] 32-05-PLAN.md — Email Edge Fn i18n: _shared/i18n-server.ts + 7 transactional fns rewired
- [ ] 32-06-PLAN.md — Contractor delivery: ES corpus + glossary signoff + KB ES articles + TRANSLATOR-WORKFLOW.md **[DEFERRED to v1.4 — vendor-blocked on bilingual clinical contractor engagement; see 32-CARRY-OVER.md]**
- [x] 32-07-PLAN.md — hreflang tags + CSS logical-properties audit + lint (partial; ship-gate UAT deferred with 32-06)

### Phase 33: Hourly Ad-Spend ETL (Meta + Google + TikTok)

**Goal**: True CAC dashboard is live; ad-spend reconciles to PostHog conversions across 3 networks with FX normalization and gap detection.
**Depends on**: Phase 24 (event taxonomy + AEM priority register)
**Requirements**: ADETL-01, ADETL-02, ADETL-03, ADETL-04, ADETL-05, ADETL-06, ADETL-07, ADETL-08, ADETL-09
**Success Criteria** (what must be TRUE):

  1. 3 hourly cron Edge Fns (Meta Marketing API + Google Ads API + TikTok Business API) populate `ad_spend_facts` (partitioned by month) with spend + clicks + impressions + conversions per ad account
  2. Idempotent last-72h re-sync runs on each fetch (INSERT … ON CONFLICT) so API outages and late-arriving data backfill without duplicating rows
  3. Daily gap-detection cron compares actual fact-row count to expected (hours × accounts × 24); inserts `ad_etl_gaps` row + admin notification when actual < expected
  4. `ad_revenue_normalized` view joins facts to PostHog conversion events using per-network normalized attribution window (Meta 7d-click default; configurable per-network); USD-normalized via `fx_rates` table populated by daily ECB fetch
  5. Admin CAC dashboard renders cost-per-acquisition by source/campaign/creative; alert fires when 7-day rolling CAC > target LTV × 0.5

**UI hint**: yes

### Phase 34: M2 Onboarding Overhaul + Activation Event

**Goal**: Anonymous → activated funnel is the new front door; activation event is LOCKED here and consumed by Phase 39 paywall + Phase 36 review + Phase 38 recommender.
**Depends on**: Phase 24 (event taxonomy); blocks Phase 39
**Requirements**: ONBOARD-01, ONBOARD-02, ONBOARD-03, ONBOARD-04, ONBOARD-05, ONBOARD-06, ONBOARD-07, ONBOARD-08, ONBOARD-09, ONBOARD-10, ONBOARD-11, ONBOARD-12, ONBOARD-13
**Success Criteria** (what must be TRUE):

  1. Anonymous visitor sees a populated value-first dashboard preview (anonymous session row keyed by cookie); on signup, anonymous row merges to authenticated row with no data loss
  2. User signs in via magic link OR Google OAuth OR Apple OAuth without a required password; on mobile 375px, every input is ≥44px tap-target
  3. Onboarding ends by completing one real task (logged injection / scheduled dose / joined challenge based on stated goal); `activation_events` row inserted and event fires server-side via TAXO-02
  4. Admin drags/drops question types in the step builder, saves to `onboarding_flows.config` JSONB, runs a PostHog A/B variant, clicks "Ship Winner" → variant promotes to 100% traffic
  5. Mobile Lighthouse score ≥90 on `/onboard` route; per-step funnel analytics render in admin from PostHog queries (views / completions / drop-off / time-on-step)

**UI hint**: yes

**Plans:** 9/10 plans executed

Plans:

- [x] 34-01-PLAN.md — Schema: anonymous_sessions + onboarding_flows + profiles.primary_goal + activation_events ALTER + SECDEFs
- [x] 34-02-PLAN.md — Weekly TTL cron + create-anon-session Edge Fn + _ls_anon cookie helper
- [x] 34-03-PLAN.md — events.ts activation_completed + Phase38Event union widening + record-activation Edge Fn + fire-once RPC
- [x] 34-04-PLAN.md — PKCE OAuth wrapper (signInWithOAuthProvider) + /auth/callback view in App.tsx
- [x] 34-05-PLAN.md — merge_anon_session SECDEF + merge-anon-session Edge Fn (preferences + aff_code + PostHog alias)
- [x] 34-06-PLAN.md — useConsumerOnboardingFlow + AnonymousPreviewLayer + ConsumerOnboardingRenderer + 8-goal selector + smart defaults + social proof + /onboard route
- [x] 34-07-PLAN.md — FirstActionSurface 3-card hybrid UI + activation-hooks fire-once + store.replayDraftEntries
- [x] 34-08-PLAN.md — Admin onboarding-builder shell (StepPalette + SortableTreePanel + StepPropertyPanel) + manifest entry (autonomous: false — human verify)
- [x] 34-09-PLAN.md — ship-winner-flag + onboarding-funnel-query Edge Fns (vendor-gated) + OnboardingABPanel + OnboardingFunnelTab
- [ ] 34-10-PLAN.md — Playwright e2e (anon-merge / activation / mobile Lighthouse ≥90) + Apple Services ID checkpoint + PostHog API key checkpoint

### Phase 35: M3 Gamification Engine [Complete — approved automated-verify-only; UAT deferred to v1.3 close]

> 6 HUMAN-UAT signals (vault secret, Vercel env, Twitter/LinkedIn/Instagram previews, copy review) consolidated in `.planning/v1.3-uat-deferred.md` — run at milestone close.

**Goal**: XP/levels/streaks/freeze tokens/leaderboards/weekly challenges ship as ethical-only mechanics; canvas-confetti gates respect reduced-motion.
**Depends on**: Phase 24 (event taxonomy); Phase 27 (cohort builder for leaderboards)
**Requirements**: GAME-01, GAME-02, GAME-03, GAME-04, GAME-05, GAME-06, GAME-07, GAME-08, GAME-09
**Success Criteria** (what must be TRUE):

  1. User logs a qualifying action → `xp_ledger` row appended (entry per action); level computed deterministically from XP total; rollback test proves ledger replay yields identical level
  2. Streak survives across timezones (computed via daily `pg_cron` respecting `profiles.timezone`); freeze tokens granted free monthly (NOT monetized, NOT sold) prevent break
  3. Cohort-scoped opt-in leaderboard renders anonymized handles; matview refreshes every 15 minutes; user can opt-out and disappear from the leaderboard within the next refresh cycle
  4. Admin creates a weekly challenge (challenge_type + duration + reward) and optionally enables a cohort-scoped A/B variant; users are notified BEFORE streak break (no dark patterns)
  5. Level-up event generates a shareable OG-image card via Vercel Function; user shares to social and the card renders correctly on Twitter/X, LinkedIn, Instagram; gamification-burst chunk stays ≤8 kB gz

**Plans:** 10 plans

Plans:

- [ ] 35-01-PLAN.md — XP ledger + compute_level pure fn + badge_catalog seed + RLS proofs
- [ ] 35-02-PLAN.md — Streak state + freeze tokens ledger + tz crons + admin grant Edge Fn
- [ ] 35-03-PLAN.md — xp-grant hybrid triggers + xp-event Edge Fn + combo cross-streak badge
- [ ] 35-04-PLAN.md — Cohort leaderboard matview + opt-in + 15-min refresh + handle validation
- [ ] 35-05-PLAN.md — Weekly challenges schema + admin form + A/B variants + admin module
- [ ] 35-06-PLAN.md — Dashboard cards + LevelUpBurst + gamification-burst lazy chunk
- [ ] 35-07-PLAN.md — OG share-card Vercel Function + SSR + rewrite carve-out + HMAC tokens
- [ ] 35-08-PLAN.md — Settings Leaderboards subtab + opt-in nudge wiring + dismiss persistence
- [ ] 35-09-PLAN.md — Notification wiring (streak-warn + challenge-notify) via lifecycle-behavior-triggered
- [ ] 35-10-PLAN.md — Schema push + Edge Fn deploy + bundle audit + multi-signal HUMAN-UAT

**UI hint**: yes

### Phase 36: M3 Review Prompt Engine (Web Only)

**Goal**: Internal NPS routes deterministically to external review CTAs OR helpdesk tickets WITHOUT ever conditionally firing a native rating prompt (V13-3 BLOCKER).
**Depends on**: Phase 24 (event registry); Phase 37 (helpdesk ticket creation)
**Requirements**: REVIEW-01, REVIEW-02, REVIEW-03, REVIEW-04, REVIEW-05, REVIEW-06, REVIEW-07, REVIEW-08
**Success Criteria** (what must be TRUE):

  1. Internal NPS surface is INDEPENDENT — plan-checker BLOCKER lint blocks any code that conditions a native (App/Play) rating prompt on NPS score
  2. Admin composes trigger rules in the rule-builder UI (event names + cohort membership + cooldown state with if/and/or composition); cooldowns enforce min 30 days between prompts + max 3 per lifetime
  3. Promoter (4-5★) clicks through to external CTA (Trustpilot / G2 / Capterra) via opt-in redirect; non-promoter (1-3★) submits feedback → ticket auto-created in HELP queue with subject "Feedback from NPS rating"
  4. Admin dashboard renders per-funnel review-rate (prompt shown → internal rating → external review posted) with per-variant breakdown
  5. PostHog A/B varies trigger conditions / copy / CTA wordings; winning variant promotes via admin "Ship Winner" button

**UI hint**: yes

**Plans:** 5 plans

Plans:
**Wave 1**

- [ ] 36-01-PLAN.md — Schema: 4 tables (rules/history/native/cta-catalog) + SECDEF RPCs + events.ts nps_trigger_eligible flag + V13-3 ESLint test fixtures + grep gate (REVIEW-01, REVIEW-02, REVIEW-03, REVIEW-08)

**Wave 2** *(blocked on Wave 1 completion)*

- [ ] 36-02-PLAN.md — Edge Fns: nps-trigger-decide (server cooldown + variant resolve) + nps-feedback-submit (user-JWT-forwarding to create_ticket RPC) + nps-cta-click-log + useNativeReviewTrigger hook + review-shim + decide-client (REVIEW-01, REVIEW-03, REVIEW-04, REVIEW-05, REVIEW-06)

**Wave 3** *(blocked on Wave 2 completion)*

- [ ] 36-03-PLAN.md — Consumer modals: NPSPromptModal (5★ ARIA radiogroup) + PromoterCtaModal + DetractorFeedbackModal + useNPSPromptListener + App.tsx mount (REVIEW-01, REVIEW-03, REVIEW-04, REVIEW-05)

**Wave 4** *(blocked on Wave 3 completion)*

- [ ] 36-04-PLAN.md — Admin module: modules.ts placeholder swap + RulesListPage + RuleFormPanel + FunnelDashboardPage + VariantGrid (ship-winner reuse) + CtaCatalogPage + CohortPicker + funnel-aggregate RPC (REVIEW-02, REVIEW-06, REVIEW-07, REVIEW-08)

**Wave 5** *(blocked on Wave 4 completion)*

- [ ] 36-05-PLAN.md — Closeout: supabase db push --linked (BLOCKING) + 3 Edge Fn deploys + multi-device cooldown E2E + A/B variant E2E + admin rule-builder E2E + 4-signal HUMAN-UAT (all REVIEW-* verified)

### Phase 37: M6 Helpdesk Core

**Goal**: Tickets + KB + email-to-ticket + AI assist + CSAT ship end-to-end; Resend Inbound vs SES PHI routing decided at Phase 25 propagates here.
**Depends on**: Phase 25 (Resend BAA decision); Phase 27 (admin shared infra)
**Requirements**: HELP-01, HELP-02, HELP-03, HELP-04, HELP-05, HELP-06, HELP-07, HELP-08, HELP-09, HELP-10, HELP-11, HELP-12, HELP-13
**Success Criteria** (what must be TRUE):

  1. User on any screen opens in-app helpdesk widget; widget surfaces KB-search-first; falling through to a ticket form posts to `tickets` and user receives confirmation email
  2. Inbound `support@app.leanshot.app` email creates a ticket via Resend Inbound webhook; reply-threading works via HMAC token in `Reply-To`; helpdesk-widget chunk ≤25 kB gz
  3. Agent composes reply with AI-drafted suggestion (Claude API), `/macro` slash-command-inserts canned response, optionally attaches; CSAT auto-sent after close via Resend (or SES if PHI-touching)
  4. KB article renders markdown via react-markdown + dompurify; English + Spanish full-text search via Postgres `tsvector` + GIN returns ranked results in <100ms; article versioning preserves history
  5. SLA breach alert fires via pg_cron when open ticket exceeds priority SLA; admin sees per-tag-cluster volume trend dashboard for product-issue identification

**UI hint**: yes

**Plans:** 3/9 plans executed

Plans:

- [x] 37-01-PLAN.md — Schema: 12 helpdesk tables + RLS + SECDEF RPCs + seed (HELP-01)
- [x] 37-02-PLAN.md — KB FTS (tsvector EN+ES + GIN) + pg_cron SLA schedule + email-router templates + HMAC helper (HELP-06, HELP-08, HELP-11)
- [x] 37-03-PLAN.md — helpdesk-inbound Edge Fn: Svix verify + 2-step body fetch + HMAC reply gate + idempotency + attachments (HELP-03)
- [ ] 37-04-PLAN.md — helpdesk-ai-assist Edge Fn: BAA-aware Claude classifier + Zod output + apply/suggest split + sentiment (HELP-04)
- [ ] 37-05-PLAN.md — helpdesk-csat-send + helpdesk-sla-breach-cron + close trigger + UPSERT dedupe state (HELP-05, HELP-06)
- [ ] 37-06-PLAN.md — Frontend widget: lazy chunk ≤25 kB gz, KB search, KB article, ticket form, realtime, /macro slash (HELP-02, HELP-07, HELP-09, HELP-10, HELP-11)
- [ ] 37-07-PLAN.md — Admin module: manifest replace + HelpdeskLayout + InboxPage + TicketDetail + AiSuggestionPane + agent-reply-send Edge Fn (HELP-04, HELP-12)
- [ ] 37-08-PLAN.md — Admin sub-pages: KBEditor + MacroEditor + RoutingRules + SLATargets + TrendsDashboard (HELP-07, HELP-08, HELP-12, HELP-13)
- [ ] 37-09-PLAN.md — Closeout: RLS impersonation proof tests + Resend Inbound MX human-UAT + Function Secrets + e2e smoke (all HELP-* verified)

### Phase 38: M5b AI Recommender (pgvector + Claude Digest)

**Goal**: pgvector + OpenAI embeddings power Next-Best-Action; weekly Claude summary email sends per user-timezone; win-back prompts route via SAVE engine.
**Depends on**: Phase 25 (Anthropic clinical-vs-consumer credential split); Phase 24 (event registry); Phase 40 (SAVE engine for win-back)
**Requirements**: RECOMMEND-01, RECOMMEND-02, RECOMMEND-03, RECOMMEND-04, RECOMMEND-05, RECOMMEND-06, RECOMMEND-07, RECOMMEND-08, RECOMMEND-09, RECOMMEND-10
**Success Criteria** (what must be TRUE):

  1. `content_embeddings vector(1536)` table backed by HNSW (or IVFFlat — decided at Phase 38 CONTEXT.md based on clinic-tenant fanout) returns top-3 recommendations in <50ms p99
  2. Nightly cron embeds new KB articles + community posts + course lessons + blog posts via OpenAI `text-embedding-3-small` (routed via Vercel AI Gateway, same posture as v1.2 Anthropic)
  3. User receives weekly Claude summary email at Sunday 09:00 in their timezone (short narrative + 1-3 suggested actions); sends via Resend (or SES if PHI)
  4. Recommender Edge Fn returns top-3 dashboard recommendations for a given (user_id + recent events + profile); admin dashboard tracks impression + click rates per recommendation-type
  5. Human-in-the-loop review queue lets admin approve/reject/edit AI suggestions before auto-apply; whitelisted recommendation set only

**Plans:** 7/10 plans executed

Plans:

- [x] 38-01-PLAN.md — Schema: pgvector + content_embeddings + HNSW + match_content_embeddings RPC + profiles.timezone + supporting tables (12 migrations)
- [x] 38-02-PLAN.md — _shared helpers: openai-embed, anthropic-summarize (/v1/messages), baa-scope, digest-schema (Zod+whitelist), render-user-facts, recommender-rank, BAA allowlist extension for claude-sonnet-4-6
- [x] 38-03-PLAN.md — recommend-next-best-action Edge Fn + multi-surface payload + RLS cross-tenant impersonation proof + p95<800ms
- [x] 38-04-PLAN.md — embed-content-nightly Edge Fn (sha256 dedup + 429 backoff + soft-delete cleanup)
- [x] 38-05-PLAN.md — weekly-digest Edge Fn (BAA-scope first; /v1/messages; red-flag guardrail O5; DST timezone tests)
- [x] 38-06-PLAN.md — plan-personalize Edge Fn (rule-based, no LLM, p99<50ms)
- [ ] 38-07-PLAN.md — winback-scorer Edge Fn (14d threshold + 30d cap + Phase 40 handoff)
- [ ] 38-08-PLAN.md — HITL admin queue UI (Phase 24 module + super-admin RLS + approve/reject/edit)
- [x] 38-09-PLAN.md — pg_cron schedules + TAXO event registration + ForYouCard + RelatedArticlesFooter + track-rec-click
- [ ] 38-10-PLAN.md — AI-SPEC §5 eval harness: 20-row refset + 10 dimension tests + LLM judge + nightly CI gate

### Phase 39: A/B Trifecta — Mid-Trial Paywall + Pharma Paywall + Page-Variant A/B

**Goal**: Three A/B surfaces ship together with composite-goal measurement, canonical-link discipline, and the always-free safety-info carve-out.
**Depends on**: Phase 34 (activation event); Phase 24 (server PostHog); Phase 15 (page builder)
**Requirements**: PAYWALL-01, PAYWALL-02, PAYWALL-03, PAYWALL-04, PAYWALL-05, PAYWALL-06, PAYWALL-07, PAGEAB-01, PAGEAB-02, PAGEAB-03, PAGEAB-04, PAGEAB-05, PAGEAB-06, PAGEAB-07, PHARMA-01, PHARMA-02, PHARMA-03, PHARMA-04, PHARMA-05, PHARMA-06, PHARMA-07, PHARMA-08
**Success Criteria** (what must be TRUE):

  1. Trialing user sees the paywall variant AFTER the activation event (not at signup, not at trial end); variant assignment captured server-side via TAXO-02 so adblockers cannot corrupt attribution
  2. Composite goal (paid conversion + retained-30-days) decides winner; refund-rate kill-switch auto-disables variant when 7-day refund rate > 2× baseline and Slack-alerts admin
  3. Every page-builder variant emits `<link rel="canonical">` to the control page; variants auto-archive at 42 days; per-variant ISR cache key prevents cross-variant cache poisoning
  4. Pharmacology paywall test: Pro users see full drug-interactions/dosing/contraindications; free users see 1-2 sentence summaries; safety-information (overdose warnings, contraindications, FDA black-box) NEVER paywalled (enforced by `phaCheck()` helper test + WMHMDA/CTDPA region-detect carveout)
  5. Admin clicks "Ship Winner" on an experiment-summary page → variant promotes to 100% + becomes new control + PostHog flag stickiness preserved; Bayesian significance badge color-codes <80% / 80-95% / >95%

**UI hint**: yes


**Plans:** 10 plans in 6 waves

Plans:

**Wave 1** *(parallel: zero file overlap)*

- [ ] 39-01-PLAN.md — Schema foundation: 11 migrations (user_experiments, variant_config, utm_variant_map, pharma_content, pharma_content_versions, page_variants, experiment_results matview, cohort + UTM seeds, subscriptions.refunded_at, resolve_cohort_for_user RPC) + 3 pgTAP RLS proofs
- [ ] 39-02-PLAN.md — 3-layer phaCheck enforcement (ESLint AST rule + runtime helper + CI grep gate) + BlockNode.variant_set_id extension (D-06 + D-13)

**Wave 2** *(blocked on Wave 1)*

- [ ] 39-03-PLAN.md — variant-resolver Edge Fn + slack-alert-experiments Edge Fn + bayes-posterior helper + 3 pg_cron jobs (42-day archive, refund kill, pharma NPS kill) + 3 pgTAP proofs

**Wave 3** *(blocked on Wave 1+2; parallel: zero overlap)*

- [ ] 39-04-PLAN.md — Consumer paywall surfaces: PaywallModal + 6-screen OnboardingFlowPaywall + PaywallGate + consent-adapter + UTM capture (PAYWALL-01/02/05/06/07)
- [ ] 39-05-PLAN.md — Pharma consumer: PharmaContentBlock + SafetyInfoBadge + region-detect + tier resolution + RLS append-only proof (PHARMA-01/02/05/06/07)

**Wave 4** *(blocked on Wave 1+2)*

- [ ] 39-06-PLAN.md — Admin growth/experiments module shell + ExperimentDashboardPage 3-tab chrome + experiment-types module + AdminShell parity test

**Wave 5** *(blocked on Wave 1+2+6)*

- [ ] 39-07-PLAN.md — Paywall + Page-Builder admin tabs + ShipWinnerConfirmModal (D-12) + BayesianBadge + TrafficSplitSlider + 2 SECDEF RPCs (PAYWALL-03/04, PAGEAB-03/05/07)
- [ ] 39-08-PLAN.md — Pharma admin tab + version list + metrics card + 3 SECDEF RPCs (get_pharma_experiments, version write, disable) + 2 Playwright e2e (PHARMA-03/04/07/08) — SEQUENCED after 39-07 due to ExperimentDashboardPage co-edit
- [ ] 39-09-PLAN.md — Page-render extension (Vary + per-variant cache key + canonical + per-block resolver) + PageEditorView extension + BlockVariantDrawer + page-variant-create e2e (PAGEAB-01/02/04/06)

**Wave 6 — Close-out** *(blocked on all prior waves)*

- [ ] 39-10-PLAN.md — [BLOCKING] supabase db push + 3 Edge Fn deploys + Slack webhook secret + Vercel deploy + automated sweep + 6 HUMAN-UAT signals
### Phase 40: Cancellation Save-Offers Flow [Complete — approved automated-verify-only; UAT deferred to v1.3 close]

> 4 HUMAN-UAT signals (Stripe coupon seed, admin rule create, e2e cancel flow, copy review) consolidated in `.planning/v1.3-uat-deferred.md` — run at milestone close.

**Goal**: Cancelling user sees one of 4 personalized save offers (pause / downgrade / discount / extended trial) before cancellation completes.
**Depends on**: v1.2 Phase 14 (Stripe subscriptions live); Phase 27 (cohort eligibility)
**Requirements**: POLISH-01, POLISH-02, POLISH-03, POLISH-04
**Success Criteria** (what must be TRUE):

  1. User clicks Cancel → modal offers one of 4 save offers based on eligibility rules (per-cohort + per-tenure); offer-take logged to `cancellation_offers_log`
  2. Pause subscription for 1/2/3 months returns user to active billing on the resume date via Stripe pause_collection API
  3. Discount save-offer (20%-30% for 2-3 months) applies as a Stripe coupon at the next invoice
  4. Admin sees offer-take ROI dashboard (retention-uplift per offer-type per cohort) and can A/B different offer copy/eligibility-rules

**UI hint**: yes
**Plans:** 6 plans (3 waves)

Plans:

- [x] 40-01-PLAN.md — Schema: cancellation_offers_log + save_offer_rules + Stripe coupon seed (Wave 1) [SHIPPED]
- [x] 40-02-PLAN.md — Stripe webhook extension + pause-reminder cron + email-router widening (Wave 1) [SHIPPED]
- [x] 40-03-PLAN.md — Edge Fns: cancellation-decide-offer (lookup) + cancellation-accept-offer (Stripe write) (Wave 2) [SHIPPED]
- [x] 40-04-PLAN.md — CancellationModal single-chunk + analytics events + cancellation-feedback-to-ticket Fn (Wave 2) [SHIPPED]
- [x] 40-05-PLAN.md — Admin Save-Offer Rule Editor module + SECDEF RPCs (Wave 3) [SHIPPED]
- [x] 40-06-PLAN.md — Admin ROI Dashboard + CSV export + PostHog Ship-Winner + phase close-out (Wave 3) [CHECKPOINT — pending operator Stripe seed + browser walkthrough]
- [ ] 40-07-PLAN.md — Dashboard read-only gating during pause (D-07 audit gap) (Wave 3)

### Phase 41: Public Status Page + Embed-Provider Blocks

**Goal**: `status.leanshot.app` is live; 4 embed blocks (Calendly + YouTube + Tally + Custom-iframe) ship with sandboxing + consent gating + CSP allowlist.
**Depends on**: Phase 15 (page builder block schema); v1.2 Phase 22 (cookie consent)
**Requirements**: POLISH-10, EMBED-01, EMBED-02, EMBED-03, EMBED-04, EMBED-05, EMBED-06, EMBED-07, EMBED-08
**Success Criteria** (what must be TRUE):

  1. Public visitor opens `status.leanshot.app` and sees real-time component status driven by Better Stack auto-incident detection from Sentry + Vercel + Supabase
  2. Admin drops Calendly / YouTube / Tally block on a landing page; visitor sees the widget in a sandboxed iframe that lazy-loads ONLY after cookie-consent grant; opacity transitions 0→1 over 200ms (gated by `useReducedMotion`)
  3. YouTube embed routes through `youtube-nocookie.com`; every iframe has minimum-required `sandbox` attribute; CSP allowlist updated per provider; dompurify sanitizes any admin-pasted HTML
  4. Custom-iframe block accepts arbitrary URL but only renders when hostname matches the per-deployment admin allowlist (enforced via CSP + iframe `src` validator)
  5. Embed blocks also render inside helpdesk KB articles (extends EMBED reach to M6 surfaces); admin sees live Calendly preview in PageEditor via popup OAuth (not iframe-internal)

**UI hint**: yes

**Plans:** 6 plans in 3 waves

Plans:
**Wave 1**

- [ ] 41-01-PLAN.md — Phase 22 consent-event emit retrofit + canonical event module + typed subscribe helper (EMBED-01/02/03/05 foundation) [Wave 1]
- [ ] 41-02-PLAN.md — iframe_allowlist table + SECDEF audit-logged RPCs + BlockType union + validateCustomIframeUrl + admin client wrappers (EMBED-04/07) [Wave 1]

**Wave 2** *(blocked on Wave 1 completion)*

- [ ] 41-03-PLAN.md — Vercel Edge Middleware for D-14 dynamic CSP + vercel.json D-12 additions + atomic csp-snapshot regen + page-render Deno consent-gating retrofit (EMBED-01/02/03/04/07) [Wave 2]
- [ ] 41-04-PLAN.md — Calendly OAuth Edge Fns (start + callback) + CalendlyPreviewPopup with postMessage origin validation (EMBED-08) [Wave 2]

**Wave 3** *(blocked on Wave 2 completion)*

- [ ] 41-05-PLAN.md — ConsentGatedEmbed HOC + EmbedPlaceholderCard + CustomIframeBlock + 3-block retrofit + PROPERTY_CONFIGS + KB-article render (EMBED-01..07) [Wave 3]
- [ ] 41-06-PLAN.md — Superadmin allowlist admin module + BLOCKING supabase db push + Edge Fn deploys + Better Stack HUMAN-UAT close-out (POLISH-10, EMBED-04/07) [Wave 3]

### Phase 42: v1.3 Polish Closeout — WCAG 2.2 AA + Smart Notifications + PWA Offline + Dark Mode + What's New + NPS

**Goal**: Cross-phase accessibility / notifications / offline / dark-mode parity / changelog / quarterly NPS survey close out v1.3.
**Depends on**: All prior v1.3 phases
**Requirements**: POLISH-05, POLISH-06, POLISH-07, POLISH-08, POLISH-09, POLISH-11, POLISH-12
**Success Criteria** (what must be TRUE):

  1. axe-core CI gate passes WCAG 2.2 AA on every new v1.3 route (admin shell + helpdesk + onboarding builder + clinic dashboard + community + courses); keyboard nav + screen-reader labels + contrast + focus rings verified
  2. Smart notifications respect per-category opt-out (dose / AI / clinic / billing / marketing) with frequency-capping + snoozable + sentiment-aware; user manages preferences in self-serve `/settings/notifications`
  3. PWA installs via `vite-plugin-pwa`; offline mode lets user view tracked data without network; native-feeling install prompt appears on supported browsers
  4. Dark mode renders correctly across ALL v1.3 new surfaces (admin shell + helpdesk + onboarding builder + clinic dashboard + community + courses) with no contrast regressions
  5. "What's New" drawer surfaces shipped improvements with per-user dismissal state; quarterly NPS survey (one-question + open-text) sends to active users via Resend, segmented by tenure + plan + cohort, results visible in admin

**UI hint**: yes

### Phase 43: M4 Membership Tiers Extension

**Goal**: Lifetime tier joins `tier_effective`; grandfathering preserves legacy pricing; community/course/event entitlements gate on tier.
**Depends on**: v1.2 Phase 14 (Stripe + tier_effective); Phase 40 (SAVE flow for coupon compounding)
**Requirements**: MEMBER-01, MEMBER-02, MEMBER-03, MEMBER-04
**Success Criteria** (what must be TRUE):

  1. User pays Stripe one-time price → `tier_effective` returns `has_active=true` permanently for that user; lifetime entitlement persists across renewal cycles
  2. Admin sets per-cohort grandfathered pricing; NEW subscribers matching the cohort see the grandfathered price at stripe-checkout. Existing-subscriber renewal-time price update deferred per 43-CARRY-OVER.md.
  3. Coupon-driven Pro upgrade + 7-day trial extension stack with SAVE-offer discount; admin creates coupons via Stripe Coupons + Promotion Codes
  4. Community spaces / courses / events flagged as `pro_only=true` return 403 to free-tier users; tier check uses `tier_effective` lookup (NOT `tier='paid'` string match — uses `has_active` per P19 D-04 contract)

**Plans:** 6 plans

Plans:
**Wave 1**

- [ ] 43-01-PLAN.md — lifetime_purchases schema + tier_effective view UNION extension + stripe-webhook lifetime branch + Slack alert (MEMBER-01)
- [ ] 43-02-PLAN.md — grandfathered_prices schema + admin SECDEF write RPCs (MEMBER-02)
- [ ] 43-03-PLAN.md — Entitlement helpers (current_user_has_pro + user_has_pro) + resolve_user_effective_price + 43-PRO-GATING-CONTRACT.md (MEMBER-02, MEMBER-04)

**Wave 2**

- [ ] 43-04-PLAN.md — stripe-checkout lifetime branch + grandfathered resolver wiring + 70%-cap clamp + trial-extension idempotency log + cancellation-accept-offer cap injection (MEMBER-01, MEMBER-02, MEMBER-03)

**Wave 3**

- [ ] 43-05-PLAN.md — PaywallUpsell pro_only_resource variant + useCurrentUserHasPro 60s LRU cache + LifetimeBadge + GrandfatheredPricesPage admin CRUD + ADMIN_MODULES manifest entry (MEMBER-01, MEMBER-02, MEMBER-04)
- [ ] 43-06-PLAN.md — [BLOCKING] supabase db push --linked + 3-Fn deploy + STRIPE_PRICE_LIFETIME secret + stripe_price_lookup populate + 4-signal HUMAN-UAT (MEMBER-01, MEMBER-02, MEMBER-03, MEMBER-04)

### Phase 44: M4 Community Feed Foundation

**Goal**: Skool-style in-house posts/comments/reactions/mentions/media/Realtime live on Supabase + Mux.
**Depends on**: Phase 37 (react-markdown + dompurify shared); Phase 28 (org_id for clinic-private spaces); Phase 43 (tier entitlements)
**Requirements**: COMMUNITY-01, COMMUNITY-02, COMMUNITY-03, COMMUNITY-04, COMMUNITY-05, COMMUNITY-06
**Success Criteria** (what must be TRUE):

  1. User creates a markdown post (rendered via react-markdown + dompurify); user threads comments to depth N; community-feed chunk ≤20 kB gz
  2. User reacts to a post (like + extensible emoji reactions); reaction toggle is idempotent and surfaces in real time via Supabase Realtime to all subscribers
  3. @mention in post or comment fires in-app + email notification to the mentioned user (respecting `notification_settings`); mention parsing handles edge cases (`@@user`, `@user.`, etc.)
  4. User attaches image (Supabase Storage signed URL) OR video (Mux upload + adaptive HLS playback); per-post image-count cap enforced
  5. Admin creates Space ("GLP-1 starters", "Trial month tips", "Clinic Q&A") with per-tier visibility (Free / Pro / Lifetime); enforcement uses `tier_effective` at read-time

**UI hint**: yes

**Plans:** 4/10 plans executed

- [x] 44-01-PLAN.md — Community schema + RLS + bucket + SECDEF RPCs + RLS tests (Wave 0)
- [x] 44-02-PLAN.md — Notification CHECK widening + email-router union + VALID_CATEGORIES + 2 templates (Wave 0)
- [x] 44-03-PLAN.md — dompurify-config + tier-gate + community-storage + mention-parse + types + 4 unit tests (Wave 0)
- [ ] 44-04-PLAN.md — mux-create-upload (tier-gated) + mux-webhook (HMAC) Edge Fns + Deno tests (Wave 1)
- [ ] 44-05-PLAN.md — notify-community Edge Fn (dual-auth) + 2 vitest-e2e integration tests (Wave 1)
- [ ] 44-06-PLAN.md — CommunityPost + CommunityFeed + CommentThread + ReactionBar + use-feed (Wave 1)
- [x] 44-07-PLAN.md — CommunityPostComposer + CommunityCommentComposer + MentionTypeahead (Wave 1)
- [ ] 44-08-PLAN.md — CommunityImageUploader + CommunityMediaUploader + CommunityVideoPlayer + media strip (Wave 1)
- [ ] 44-09-PLAN.md — use-space-realtime + SpaceList + SpaceView + admin SpaceEditor + vite.config.ts chunk rules + App route (Wave 2)
- [ ] 44-10-PLAN.md — [BLOCKING] supabase db push + Edge Fn deploys + bundle gate + Playwright e2e + 4-signal HUMAN-UAT (Wave 3)


### Phase 45: M4 Community Spaces + Member Directory + Opt-in DMs + Leaderboard

**Goal**: Discovery layer above the feed — directory + DMs + per-month leaderboard close the community loop.
**Depends on**: Phase 44 (feed foundation); Phase 35 (leaderboard matview pattern)
**Requirements**: COMMUNITY-07, COMMUNITY-08, COMMUNITY-09
**Success Criteria** (what must be TRUE):

  1. Member directory page renders profile cards (bio + links + joined-date + badges); admin can scope directory visibility to org-only for clinic memberships
  2. User opens 1:1 DM thread with another user only when recipient has DMs opted-in; rate limit caps new DM threads per day to prevent harassment
  3. Community leaderboard (separate from GAME app leaderboard) shows top contributors per space + per month with anonymized handles; cohort-scoped opt-in

**UI hint**: yes

### Phase 46: M4 Courses / Classroom

**Goal**: Self-paced course platform — Mux video + lessons + completion certs + landing-page A/B + Pro-gated resources.
**Depends on**: Phase 44 (Mux integration patterns); Phase 39 (PAGEAB-06 per-block variants); Phase 43 (entitlement check)
**Requirements**: COURSE-01, COURSE-02, COURSE-03, COURSE-04, COURSE-05, COURSE-06
**Success Criteria** (what must be TRUE):

  1. Admin creates course → adds modules → adds lessons; each lesson supports video (Mux asset_id) + markdown text + downloadable resources
  2. User watches a Mux-transcoded lesson via Mux Player with adaptive HLS; lesson_progress updates per playback; user resumes where left off across devices; course-player chunk ≤30 kB gz
  3. On course completion, server generates a PDF certificate (jsPDF, already in v1.2 stack) with user name + course title + date + verification URL; user downloads via signed URL
  4. Course landing page uses PageBuilder with per-block A/B variants (reuses PAGEAB-06); admin selects from long-form / outcome-focused / FAQ-heavy templates
  5. Pro-gated downloadable resources return 403 to free-tier users; entitlement check uses `tier_effective.has_active`

**UI hint**: yes

### Phase 47: M4 Events Calendar + Zoom + Reminders + Recording

**Goal**: Events + RSVPs + Zoom integration + timezone-aware reminders + auto-converted recordings → lessons.
**Depends on**: Phase 46 (lesson conversion target); Phase 25 (SES for PHI clinic events)
**Requirements**: EVENT-01, EVENT-02, EVENT-03, EVENT-04, EVENT-05
**Success Criteria** (what must be TRUE):

  1. Admin creates event (title + description + start + end + capacity + space + RSVP settings + per-tier visibility); event appears on calendar UI
  2. User RSVPs Going / Maybe / Not Going; capacity limits enforced; waitlist auto-promotes when an attendee cancels
  3. Admin pastes Zoom link OR auto-generates via Zoom OAuth; deep-link visible to attendees only (not in public event card)
  4. Automatic reminder emails (1 day before + 1 hour before) fire via Resend (or SES for PHI clinic events) in each user's timezone
  5. Post-event Mux recording optionally attaches as new lesson in an adjacent course (admin-toggled)

**UI hint**: yes

### Phase 48: M4 Moderation

**Goal**: Community-safety surface — reports queue + mute/ban + banned-words + Claude auto-flag + immutable audit log.
**Depends on**: Phase 44 (community schema); Phase 25 (Anthropic clinical-vs-consumer credential)
**Requirements**: MOD-01, MOD-02, MOD-03, MOD-04, MOD-05
**Success Criteria** (what must be TRUE):

  1. User reports post / comment / DM → admin queue receives reporter context + content snapshot + cooldown blocks duplicate-reports from same reporter
  2. Admin mutes (silent suspend) + bans (account disable) + applies temporary suspension (auto-restore after duration); user UI reflects state immediately
  3. Banned-words list (admin-configurable) flags matching posts at create-time → admin queue; banned-words sweep is also re-runnable across historical content
  4. Claude API auto-flags posts/comments/DMs for toxicity + spam + medical-misinformation; flagged content goes to admin queue (NOT auto-removed); compounds with HELP AI-assist Claude budget
  5. Every moderation action (admin + automated) writes to moderation_audit_log (immutable per HIPAA-14 pattern); audit log queryable by admin

**UI hint**: yes

### Phase 49: M4 Search + Email Digests

**Goal**: Postgres FTS across community + courses + events; daily + weekly Resend digests with per-user opt-out and 1-click unsubscribe.
**Depends on**: Phase 37 (FTS infra shared); Phase 44 (community schema); Phase 46 (courses)
**Requirements**: DIGEST-01, DIGEST-02, DIGEST-03, DIGEST-04
**Success Criteria** (what must be TRUE):

  1. User searches "GLP-1 dosing" → results combine community posts + courses + events ranked by `tsvector` + GIN with both English and Spanish dictionaries; shared with HELP-11 KB search infra
  2. Daily digest email (top posts in your spaces + new comments on your posts + tagged-you mentions) sends via Resend at 09:00 user-timezone
  3. Weekly digest email (course progress recap + upcoming events you RSVP'd + community top-3 of the week) respects user notification preferences
  4. Every digest contains 1-click unsubscribe link; per-user digest opt-out + frequency control surfaces in `/settings/notifications`

**UI hint**: yes

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 24. Foundation — Admin Shell + Event Taxonomy + Server PostHog | 2/8 | In Progress|  |
| 25. HIPAA Audit Hardening + BAA Chain | 10/10 | Complete    | 2026-05-18 |
| 26. Multi-Tier Affiliate | 0/? | Not started | — |
| 27. Modular Admin Shell Extensions | 0/? | Not started | — |
| 28. Clinic Organizations — Schema + RLS Hardening | 7/8 | In Progress|  |
| 29. Org Subscriptions + Per-Patient Metered Billing | 1/8 | In Progress|  |
| 30. Clinician Dashboard + Custom Rank Weights + Dose-Trend Alerts | 0/6 | Planned | — |
| 31. White-Label + Org Roles + Clinic Onboarding Builder | 8/8 | Complete   | 2026-05-18 |
| 32. Spanish i18n | 0/? | Not started | — |
| 33. Hourly Ad-Spend ETL | 5/5 | Complete    | 2026-05-18 |
| 34. M2 Onboarding Overhaul + Activation Event | 9/10 | In Progress|  |
| 35. M3 Gamification Engine | 0/? | Not started | — |
| 36. M3 Review Prompt Engine (Web) | 0/? | Not started | — |
| 37. M6 Helpdesk Core | 3/9 | In Progress|  |
| 38. M5b AI Recommender | 7/10 | In Progress|  |
| 39. A/B Trifecta — Paywall + Pharma + Page-Variant | 0/? | Not started | — |
| 40. Cancellation Save-Offers | 0/? | Not started | — |
| 41. Public Status Page + Embed-Provider Blocks | 0/? | Not started | — |
| 42. v1.3 Polish Closeout | 8/11 | In Progress|  |
| 43. M4 Membership Tiers Extension | 0/? | Not started | — |
| 44. M4 Community Feed Foundation | 4/10 | In Progress|  |
| 45. M4 Community Spaces + Directory + DMs + Leaderboard | 0/? | Not started | — |
| 46. M4 Courses / Classroom | 0/? | Not started | — |
| 47. M4 Events Calendar | 0/? | Not started | — |
| 48. M4 Moderation | 0/? | Not started | — |
| 49. M4 Search + Email Digests | 0/? | Not started | — |

## Cross-Cutting Concerns (applies across multiple phases — each phase CONTEXT.md must address its share)

1. **HIPAA BAA chain** — Owners: Phase 25 + every vendor-touching workstream (Resend → P37, Anthropic → P38 + P37 + P48, PostHog → P24 + P34 + P36 + P39)
2. **Multi-tenant `org_id` axis** — Every new table joining patient data MUST get a cross-tenant impersonation proof test. Owners: P28 + P29 + P30 + P37 + P38 + P44
3. **Bundle ceiling: 50 kB gz index hard ceiling; per-chunk ceilings** — admin-shell 30 kB, helpdesk-widget 25 kB, i18n-runtime 15 kB, gamification-burst 8 kB, community-feed 20 kB, course-player 30 kB. Declared in P24, respected by every later phase.
4. **Stripe never signs a BAA** — CI lint blocks PHI keywords in Stripe API call sites. Owners: P25 + P29 + every Stripe touch-point.
5. **Two Anthropic credentials** (consumer vs clinical) — Branch in `ai-chat` Edge Fn on `org_id IS NOT NULL`. Owners: P25 + P37 + P38 + P48.
6. **App/Play native review-prompt policy** — Plan-checker BLOCKER on conditional native-prompt code. Owner: P36.
7. **Page-builder A/B canonical-link** — Every variant page MUST emit `<link rel="canonical">` to control. Owner: P39.
8. **Ad ETL 4 silent-drop modes** — Idempotent re-sync + gap-detection + AEM priority register + FX normalization. Owner: P33.
9. **Activation event definition** — Load-bearing for P39 + P36 + P38 + cohort triggers. Locked at P34 CONTEXT.md.
10. **Pharmacology paywall safety-info carve-out** — Never paywalled. Owner: P39 + clinical-content review.
11. **i18n routing = `?lang=es` query** (NOT `/es/` path prefix). Owners: P32 + every locale consumer (P37 KB, transactional emails, P31 white-label).
12. **Canonical `tier_effective.has_active`** (NOT `tier='paid'` string) — Reused across P29 + P39 + P43 + P44 + P46.
13. **Resend-or-SES email router** — `_shared/email-router.ts` switches on `phi:boolean`. Owners: P25 + P30 + P37 + P38 + P47 + P49.

## Open Questions (locked at plan-phase, not roadmap)

1. **Resend BAA y/n** — Phase 25 first task (vendor call). Gates HELP email-to-ticket choice + transactional email split.
2. **PostHog Enterprise/Boost add-on y/n** — Phase 25 CONTEXT.md. Gates session-replay scope on clinic routes.
3. **Anthropic Enterprise pricing for LeanShot scale** — Phase 25 CONTEXT.md. Gates HIPAA-07 dual-credential AI + P38 + P37 AI-assist split.
4. **"Active patient" definition for metered billing** — Phase 29 CONTEXT.md (e.g., "logged-event-in-last-30-days"); affects MRR forecasting.
5. **Pharmacology paywall line** — Phase 39 CONTEXT.md decision artifact; safety NEVER paywalled per PHARMA-02 is the floor.
6. **IVFFlat vs HNSW for pgvector at clinic-tenant scale** — Phase 38 CONTEXT.md; based on v1.3 user count + clinic-tenant fanout.
7. **Meta App Review (Dev → Standard tier)** — Phase 33 prerequisite; 2-4 week vendor lead time.
8. **First-clinic-deal price floor** — $1,864-4,364/mo HIPAA vendor burn → finance conversation; affects clinic-tier pricing model.

### Phase 50: Admin-Curated RAG Knowledge Base — Peptide/Topic Research Scraper Feeding AI Tips + Newsletters

**Goal:** Admin defines research topics → Firecrawl scrapes external sources (allowlist + open-web hybrid) → content normalized/summarized/chunked → tiered review queue (Tier-A auto-publish, B/C manual) → embeddings in dedicated `external_kb_embeddings` pgvector table → surfaced via AI coach citations + Dashboard "Tip of the day" + Research newsletter + public `/research` hub. Additive to Phase 38 (separate embeddings table, recommender Edge Fn extended not duplicated).
**Requirements**: (None mapped to dedicated REQ-IDs; 36 D-IDs in `.planning/phases/50-*/50-CONTEXT.md` are the requirements — covered by `must_haves.truths` per plan; decision-coverage gate PASSED)
**Depends on:** Phase 49 (newsletter unsubscribe pattern reuse; standalone fallback documented). Plans also forward-reference Phase 24 (admin shell + event taxonomy), Phase 25 (email router + HIPAA posture), Phase 32 (i18n shim), Phase 38 (recommender Edge Fn extension; standalone fallback documented).
**Plans:** 4/9 plans executed

Plans:

**Wave 1** (4 plans in parallel — data layer + admin surface + event registry):

- [x] 50-01-PLAN.md — SQL schema (9 migrations): rag_topics, rag_sources + seed, rag_chunks, external_kb_embeddings + HNSW, rag_topic_audit, rag_scrape_runs, rag_cost_ledger, rag_newsletter_subscriptions, RLS policies [Wave 1]
- [x] 50-02-PLAN.md — Admin module + RagLayout + Topics/Sources pages + TierBadge/HealthBadge/CostBar primitives + 8 admin RPCs + telemetry rollup [Wave 1]
- [x] 50-03-PLAN.md — 13 rag_* PostHog events registered in events.ts + disable_session_recording_on_url regex extension + captureRagEvent helper [Wave 1]

**Wave 2** *(blocked on Wave 1 completion)* (3 plans in parallel — scrape + summarize + review queue):

- [x] 50-04-PLAN.md — rag-scrape-runner Edge Fn (Firecrawl + robots.txt + cost-gating + 3-attempt backoff + auto-pause) + pg_cron orchestrator [Wave 2]
- [ ] 50-05-PLAN.md — rag-summarize-and-chunk Edge Fn (Anthropic via P25 consumer credential + quote-only-mode + prompt-injection guard + sentence-aware chunker) [Wave 2]
- [ ] 50-06-PLAN.md — RagQueuePage + side-by-side source/quote pane + 6-reason reject taxonomy + Edit/Retract modals + state-machine RPCs + SLA backlog cron [Wave 2]

**Wave 3** *(blocked on Wave 2 completion — D-22 MVP cut)* (2 plans in parallel — embeddings + must-have user surfaces):

- [ ] 50-07-PLAN.md — rag-embed-approved Edge Fn (OpenAI text-embedding-3-small + nightly cron) + rag-retrieve Edge Fn (HNSW + tier-boost + freshness-derank; standalone until P38 ships) [Wave 3]
- [ ] 50-08-PLAN.md — AI Coach CitationMarker+Popover + Dashboard TipOfTheDayCard + i18n disclaimer shim (rag.attribution, rag.disclaimer) + server-rag-event-relay [Wave 3 — MVP cut]

**Wave 4** *(blocked on Wave 3 completion — D-22 STRETCH cut; can defer to Phase 51 if scope tightens)*:

- [ ] 50-09-PLAN.md — Research newsletter Edge Fn (weekly cron + Resend via P25) + 1-click unsubscribe + public /research Hub + ResearchArticleDetail + NewsletterSettings + RagCostPage final (vendor cards + auto-pause + acknowledge-and-resume) [Wave 4 — STRETCH] **[DEFERRED — D-22 explicitly marks this wave deferrable; carry-over to Phase 51 or v1.4 closeout. See 50-CARRY-OVER.md]**

**Cross-cutting constraints:**

- Every SECURITY DEFINER function sets `search_path = extensions, public, pg_temp` per [[reference_supabase_migration_gotchas]].
- Every Edge Fn that captures PostHog events calls `await ph.shutdown()` before return per Phase 24 D-13.
- Every vendor call writes a `rag_cost_ledger` row; 100% MTD triggers auto-pause + admin acknowledge to resume (D-30).
- Single shared i18n key `rag.attribution` + `rag.disclaimer` used across coach + tip + newsletter + Research Hub (D-33).
- Scraped content stored as excerpt + canonical URL only; never full-text (D-03).
- Medical-claim sentences stored verbatim in source language; English gloss in quote_blocks (D-05 + D-17).

### Phase 51: Full traffic + conversion tracking system + unified dashboard (UTM/source attribution, funnel analytics, ad-spend rollup)

**Goal:** Multi-channel traffic + conversion intelligence live for operators and clinic owners: every visit's UTM + referrer captured into `user_traffic_attribution` (first + last touch), classified via operator-configurable `channel_groups`, rolled up into per-channel × per-audience funnels (Consumer / Clinic-org / Affiliate) with D1/D7/D14/D30/D60 retention curves and CAC-to-activation joined from P33 `ad_spend_facts`, surfaced in a new `growth/traffic` admin module (Channels / Funnels / Landing Pages / Real-time) — platform-wide for admins and org-scoped for clinic owners.
**Requirements**: TRAFFIC-01, TRAFFIC-02, TRAFFIC-03, TRAFFIC-04, TRAFFIC-05, TRAFFIC-06, TRAFFIC-07, TRAFFIC-08, TRAFFIC-09, TRAFFIC-10, TRAFFIC-11, TRAFFIC-12
**Depends on:** Phase 33 (ad_spend_facts; sequenced matview refresh), Phase 34 (activation event as CAC north-star), Phase 24 (events.ts + captureServer + events_mirror + funnel-anomaly-cron), Phase 27 (events_mirror dual-write + admin_notifications), Phase 28/29 (org_id schema + org membership), Phase 15 (page_variant_id)
**Plans:** 10 plans

Plans:

**Wave 1**

- [ ] 51-01-PLAN.md — REQUIREMENTS.md TRAFFIC-NN block + user_traffic_attribution + channel_groups + referrer_channel_rules + is_retained + upsert RPCs + RLS + events.ts additive defs

**Wave 2** *(blocked on Wave 1 completion)*

- [ ] 51-02-PLAN.md — Vercel Edge Middleware (lt_anon_id cookie) + traffic-attribution-recorder Edge Fn + recordTouch helper + merge-anon-session extension (PostHog alias + claim_traffic_attribution)
- [ ] 51-03-PLAN.md — 3 matviews (channel/funnel/landing rollups) + realtime VIEW + SECDEF accessors + sequenced pg_cron refresh extending P33

**Wave 3** *(blocked on Wave 2 completion)*

- [ ] 51-04-PLAN.md — compute_channel_stage_rate RPC + funnel-anomaly-cron per-channel-stage extension to admin_notifications

**Wave 4** *(blocked on Wave 3 completion)*

- [ ] 51-05-PLAN.md — growth/traffic admin module manifest + TrafficDashboardPage shell + Pill PillGroup tab strip + 5 sub-tab stubs
- [ ] 51-06-PLAN.md — Channels tab (table + retention sparkline drill-in + first/last touch toggle + CAC deep-link to growth/cac)
- [ ] 51-07-PLAN.md — Funnels tab (3-audience switcher + BaseChart funnel-stage bars + anomaly badge + per-stage channel-origin drill-in)
- [ ] 51-08-PLAN.md — Landing Pages tab (top-N selector + filter + sortable columns + PAGEAB variant join)
- [ ] 51-09-PLAN.md — Real-time tab (5-min visibility-aware poll + stale pip) + Taxonomy admin sub-page (CRUD via SECDEF RPCs) + taxonomy_admin_rpcs migration

**Wave 5** *(blocked on Wave 4 completion)*

- [ ] 51-10-PLAN.md — [BLOCKING] supabase db push --linked + 3 Edge Fn deploys + Vercel middleware deploy + cross-tenant RLS deny test + cookie smoke + 6-signal HUMAN-UAT checkpoint

---

*Last updated: 2026-05-17 — v1.3 roadmap created (26 phases, 204 REQ-IDs, 24 workstreams). Foundation-first → HIPAA-engineering-parallel-with-vendor → 3 strategic tracks (Revenue / B2B / User-depth) → M4 Community closeout.*
