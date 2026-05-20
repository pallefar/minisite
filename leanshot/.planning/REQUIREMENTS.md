# Milestone v1.3 Requirements

**Milestone:** v1.3 — Platform Expansion: Revenue + Depth + B2B + HIPAA
**Goal:** Triple-bet release that lands paying clinics under BAA, deepens consumer product on web, and tightens unit economics before v1.4 mobile launch. Foundation layer (modular admin + event taxonomy + PostHog hardening) underpins all three strategic bets.

**Source documents:**
- `.planning/PROJECT.md` — milestone scope + locked decisions
- `.planning/research/SUMMARY.md` — synthesized research (4 dimensions; HIGH confidence overall)
- `.planning/research/STACK.md` / `FEATURES.md` / `ARCHITECTURE.md` / `PITFALLS.md` — dimension detail
- User-pasted "Milestone Requirements Brief v2.0" (in conversation history) — origin

**REQ-ID totals:** ~120 active requirements across 18 workstreams. All user-confirmed via per-category multiSelect 2026-05-17.

**Path picked (over 1=hybrid carve, 2=sequential carve, 3=tight v1.3):** **Path 1 megamilestone** — accept all 18 workstreams + every differentiator. ~19 phases starting at Phase 24, 5-8 month delivery. v1.4 mobile slips a quarter.

---

## v1.3 Requirements

### WS1 — Foundation: Admin Shell (ADMIN, 6 REQ-IDs)

- [ ] **ADMIN-01**: Admin opens any module in the admin shell from a modular router (Users / Content / Onboarding / Gamification / Reviews / Membership / Analytics / AI / Helpdesk / Billing / Settings / Audit Log) without hard-coded conditionals — each module is feature-flagged, route-gated, lazy-loaded
- [ ] **ADMIN-02**: Admin views the audit log with a before/after JSONB diff viewer; rows are append-only with RLS denying updates/deletes
- [ ] **ADMIN-03**: Admin login enforces 2FA (Supabase Auth TOTP) for any Admin-or-higher role; bypass blocked at middleware
- [ ] **ADMIN-04**: Admin runs bulk actions on the Members table (CSV export, tag, comp-plan, ban, force-password-reset) with operation-confirmation modal + audit-log entry per row affected
- [ ] **ADMIN-05**: Admin defines + saves cohorts via a cohort-builder UI ("free users >7d", "past-due >3 days", "clinic admins") with cross-feature reuse (cohorts wired into TAXO, GAME challenges, PAYWALL variants, RECOMMEND triggers, SAVE eligibility)
- [ ] **ADMIN-06**: Admin invokes the command palette (Cmd+K) for fuzzy-search navigation across modules + recent items + quick actions

### WS2 — Foundation: Event Taxonomy + Server-side PostHog (TAXO, 6 REQ-IDs)

- [ ] **TAXO-01**: Canonical event registry versioned in repo at `src/lib/analytics/events.ts`; each event annotated `{name, version, payload-schema, phi: boolean}`; PR-reviewed (no ad-hoc events allowed via ESLint rule)
- [ ] **TAXO-02**: Server-side PostHog capture via `_shared/posthog-server.ts` Edge Function helper for events adblockers eat (signup, payment, activation, refund); `client.shutdown()` called before Edge return
- [ ] **TAXO-03**: Cohort builder primitives wired (`cohort_definitions` table + `cohort_membership` matview refreshed via pg_cron 15-min) — consumed by ADMIN-05
- [ ] **TAXO-04**: PostHog session-replay masks PHI via `disable_session_recording_on_url` regex covering `/clinic/*`, `/admin/*`, `/share/*`, `/auth/*`; data-sentry-mask attributes on PHI components
- [ ] **TAXO-05**: Anomaly-detection cron flags funnel-drop regressions in admin (rolling 7-day baseline; alert when conversion < baseline-2σ on any tracked funnel)
- [ ] **TAXO-06**: Event-version migration tooling (event-name + payload migrations versioned; downgrade-map for stale clients during rolling deploy)

### WS3 — A Revenue: Multi-Tier Affiliate (AFFTIER, 6 REQ-IDs)

- [ ] **AFFTIER-01**: Affiliate progresses through tiered commissions (Standard / Gold / Lifetime) with volume-threshold promotion (Standard → Gold at N paid-conversions; Gold → Lifetime by admin grant); locked-once-earned policy enforced
- [ ] **AFFTIER-02**: Every new affiliate_conversion row stamps `tier_at_conversion_time` + `commission_cents` at insert; commission NEVER recomputed retroactively on tier upgrade
- [ ] **AFFTIER-03**: Partner dashboard shows tier-progress bar + commissions earned-per-tier breakdown + next-tier-thresholds
- [ ] **AFFTIER-04**: Lifetime affiliates receive monthly recurring commissions on existing subscribers via `affiliate-lifetime-recurring` cron Edge Fn (until subscriber cancels)
- [ ] **AFFTIER-05**: Click-rate anomaly detector (impressions/clicks ratio Z-score >3σ on 7-day baseline) flags conversions to admin queue; extends v1.2 AFF-08 hybrid scope
- [ ] **AFFTIER-06**: Co-branded `/r/{code}/landing` template selection by tier (Gold partners get premium-styled landing; reuses Phase 19 AffiliateLandingResolver)

### WS4 — A Revenue: Mid-Trial Paywall A/B (PAYWALL, 7 REQ-IDs)

- [ ] **PAYWALL-01**: Trialing user sees a paywall variant after activation event (NOT at signup, NOT at trial end) via PostHog flag + variant config
- [ ] **PAYWALL-02**: Variant assignment server-side captured by TAXO-02 server-side PostHog (immune to adblockers + flag-stickiness race conditions per V13-7)
- [ ] **PAYWALL-03**: Composite goal measured (paid conversion + retained 30 days post-conversion); short-term wins that hurt retention DO NOT promote
- [ ] **PAYWALL-04**: Refund-rate kill-switch auto-disables variant if 7-day refund rate exceeds 2× baseline; admin gets Slack notification
- [ ] **PAYWALL-05**: Per-cohort paywall variant (free-user cohort vs past-due cohort vs trial-day-N cohort sees distinct paywall)
- [ ] **PAYWALL-06**: Multi-screen onboarding paywall (5-7 screens with value pillars + social proof + pricing) variant available alongside single-screen modal
- [ ] **PAYWALL-07**: Pricing-page experiments per UTM source (visitors from "lean" keyword see different copy than "transformation"); LandingPage cookie maps utm_source → variant_id at first visit, persisted to user_experiments table

### WS5 — A Revenue: Page-Builder A/B (PAGEAB, 7 REQ-IDs)

- [ ] **PAGEAB-01**: Admin creates a variant of any published page via the page-builder editor with PostHog flag-controlled traffic split
- [ ] **PAGEAB-02**: Every variant page emits `<link rel="canonical">` to the control page (avoids V13-4 silent SEO penalty)
- [ ] **PAGEAB-03**: Variants cap at 42 days live; after 42 days variant auto-archives + admin gets nudge to ship-or-rollback
- [ ] **PAGEAB-04**: Per-variant ISR cache key prevents control + variant cross-cache-poisoning
- [ ] **PAGEAB-05**: Admin clicks "Ship Winner" on a variant's experiment-summary page → variant promotes to 100% traffic + becomes new control + PostHog flag stickiness preserved
- [ ] **PAGEAB-06**: Per-block A/B (Hero CTA copy variants without ratting the rest of the page); block-level variant overrides via PageEditor
- [ ] **PAGEAB-07**: Statistical-significance badge in admin (Bayesian posterior probability of variant winning); badge color codes by confidence (gray<80% / yellow 80-95% / green >95%)

### WS6 — A Revenue: Hourly Ad-Spend ETL (ADETL, 9 REQ-IDs)

- [x] **ADETL-01**: Hourly cron Edge Fn pulls spend + click + impression + conversion from Meta Marketing API into `ad_spend_facts` (partitioned by month)
- [x] **ADETL-02**: Hourly cron Edge Fn pulls same metrics from Google Ads API
- [x] **ADETL-03**: Hourly cron Edge Fn pulls same metrics from TikTok Business API (note: most-fragile API per V13-5; hand-rolled fetch client)
- [x] **ADETL-04**: `ad_revenue_normalized` view joins facts to PostHog conversion events using normalized attribution window (configurable per-network override; defaults: Meta 7d-click, Google 30d-click, TikTok 7d-click)
- [x] **ADETL-05**: Daily gap-detection cron compares facts-row-count to expected (hours × ad-accounts × 24) and inserts `ad_etl_gaps` row + admin notification when actual < expected
- [x] **ADETL-06**: Idempotent re-sync covers last-72h on each run (catches API outages + late-arriving data); INSERT … ON CONFLICT replays without dupes
- [x] **ADETL-07**: Admin views CAC dashboard with cost-per-acquisition by source/campaign/creative; alert fires when 7-day-rolling CAC > target LTV × 0.5
- [x] **ADETL-08**: Creative-level attribution joins ad-creative-id → conversion-user-id (where API supports); admin filters by creative for top-5 / bottom-5
- [x] **ADETL-09**: `fx_rates` table + daily ECB fetch + USD-normalization view (required when ads run in EUR/MXN/etc.); FX conversion uses spend-day rate

### WS7 — B Depth: Embed-Provider Blocks (EMBED, 8 REQ-IDs)

- [ ] **EMBED-01**: Admin drops Calendly block on a landing page → visitor sees Calendly booking widget in sandboxed iframe + lazy-loaded after cookie consent
- [ ] **EMBED-02**: Admin drops YouTube block → visitor sees YouTube embed via `youtube-nocookie.com` (privacy-preserving) + lazy-loaded
- [ ] **EMBED-03**: Admin drops Tally block → visitor sees Tally form embed with per-form configuration + sandboxed + consent-gated
- [ ] **EMBED-04**: Every embed iframe has `sandbox` attribute with minimum-required permissions + CSP allowlist updated for each provider's hosts + dompurify XSS protection on any admin-pasted HTML
- [ ] **EMBED-05**: Embed loading shows DS Skeleton until iframe `onLoad` fires; opacity transitions 0→1 over 200ms (gated by `useReducedMotion()`); per Phase 15 pattern
- [ ] **EMBED-06**: Embed blocks render in helpdesk KB articles (extends EMBED-01..04 reach to M6 surfaces)
- [ ] **EMBED-07**: Admin drops Custom-iframe block (paste-your-own-iframe URL) with admin allowlist of hostnames per-deployment; allowlist enforced via CSP + iframe `src` validator
- [ ] **EMBED-08**: Admin sees live preview of Calendly availability inline in PageEditor (editor-side OAuth bouncing handled via popup, not iframe-internal; per V13-EMBED pitfall)

### WS8 — B Depth: Pharmacology Paywall Test (PHARMA, 8 REQ-IDs)

- [ ] **PHARMA-01**: Pro-tier users see full pharmacology content (drug interactions + dosing schedules + contraindications); free-tier users see paywall on these specific content surfaces
- [ ] **PHARMA-02**: Safety-information content (overdose warnings, contraindication alerts, FDA black-box warnings) NEVER paywalled — free for everyone (always-free carve-out enforced in `phaCheck()` helper)
- [ ] **PHARMA-03**: A/B test runs 4 weeks measuring composite goal (conversion uplift + NPS no-drop + no spike in 1-star reviews)
- [ ] **PHARMA-04**: Reversibility plan automated: kill-switch flag + 1-click rollback + variant config archived for forensic review
- [ ] **PHARMA-05**: Free users see content summaries (1-2 sentence overview); Pro users see full details — tiered access vs hard paywall (lower backlash risk per V13-PHARMA-03)
- [ ] **PHARMA-06**: WMHMDA (Washington) + CTDPA (Connecticut) per-region pharma compliance carveouts: pharma paywall disabled for users with detected state-of-residence WA or CT (belt-and-suspenders against consumer-health-data law inquiry)
- [ ] **PHARMA-07**: Pharma content versioning + audit log (every pharma copy change creates `pharma_content_versions` row with author + diff + clinical-review-signoff); regulator-audience differentiator
- [ ] **PHARMA-08**: Pharma paywall surface visible in admin (current variant config + composite-goal metrics + 1-click disable)

### WS9 — B Depth: Spanish i18n (I18N, 10 REQ-IDs)

- [ ] **I18N-01**: User sees Spanish UI via `?lang=es` query string (NOT `/es/` path prefix — avoids Vercel rewrite doubling per V13-9 + ARCHITECTURE)
- [ ] **I18N-02**: First-visit Accept-Language detection + cookie set; explicit user preference persisted to `profiles.locale` overrides browser default
- [ ] **I18N-03**: react-i18next + i18next-http-backend lazy-loads `/locales/{lng}/{ns}.json` (NOT eager-bundled JSON imports)
- [ ] **I18N-04**: Transactional emails ship Spanish templates (welcome series, password reset, payment receipt, clinic invite, dunning, DSAR confirmation, lifecycle behavior triggers)
- [ ] **I18N-05**: KB articles store Spanish translations at `kb_articles WHERE locale='es'` (admin uploads parallel `{slug}.es.md` files; full-text search HELP-KB-search respects locale)
- [ ] **I18N-06**: Crowdin glossary workflow (or in-house equivalent) established for translator pipeline; translator workflow documented; review/approval gates wired
- [ ] **I18N-07**: ICU pluralization correctness verified (ES has more plural forms than EN — singular/plural/zero/other); icu-format `{count, plural, ...}` strings tested per pluralization rule
- [ ] **I18N-08**: Admin-editable locale overrides (`locale_overrides` table) — admin hot-patches translation bugs per-org or per-deployment without redeploying or waiting for Crowdin
- [ ] **I18N-09**: Medical-term clinical glossary review pass before Spanish ships (clinical-content-liability gate); GLP-1 drug names, dosing terms, symptom names reviewed by Spanish-native clinical advisor
- [ ] **I18N-10**: CSS uses logical properties (`margin-inline-start`, `padding-block-end`) per LTR-RTL future-proofing (no RTL languages in v1.3 scope but prepared for v1.5)

### WS10 — C B2B: Clinic Organizations (ORG, 13 REQ-IDs)

- [ ] **ORG-01**: Schema: `organizations` + `org_members` + `org_invites` + `org_subscriptions` + `org_settings` + `org_branding` + `org_patient_links` + `org_consent_grants` + 4 more downstream tables (16+ migrations)
- [ ] **ORG-02**: JWT `app_metadata.org_ids` claim propagates org-scope to all RLS policies (336ms propagation window — UI loading state handled per `reference_supabase_app_metadata_jwt_propagation`)
- [ ] **ORG-03**: `withOrgScope` service_role wrapper enforces `org_id` filter on EVERY service_role query (compile-time TypeScript enforcement; runtime assertion + Sentry alert if bypassed) — closes V13-2 service_role-bypass vector
- [x] **ORG-04**: Realtime channels named with HMAC-derived org-scoped token; channel-subscribe rejects mismatched org_id — closes V13-2 realtime-channel-collision vector
- [ ] **ORG-05**: Every org-scoped table gets a live cross-tenant impersonation proof test (extends Phase 5/6/19/22 project rule from `user_id` axis to `org_id` axis)
- [ ] **ORG-06**: `src/lib/org.ts` org-context layer detects current org via path + member.org_id + provides surface-check helpers + overlays white-label theme tokens
- [x] **ORG-07**: Path-based clinic routing `/clinic/{slug}/...` (subdomain `acme.leanshot.app` deferred to v1.5)
- [x] **ORG-08**: Stripe Billing for orgs uses SEPARATE `stripe_customer_id_org` keyed by `(user_id, customer_context)` — consumer customer email == clinic customer email = different Stripe customers (closes V13-2 Stripe-namespace vector)
- [x] **ORG-09**: Per-active-patient metered billing via Stripe Meter Events 2024 API; nightly cron aggregates usage
- [x] **ORG-10**: Patient invite flow: clinic admin invites email → magic link → patient onboards under clinic's org → patient's `profiles.primary_org_id` set + consent grant recorded
- [x] **ORG-11**: White-label theming per clinic (CSS-var overlay + custom logo + custom colors + favicon); path-based for v1.3 (`/clinic/{slug}` overlays `org_branding` CSS-vars)
- [x] **ORG-12**: Org admin manages 3 roles (owner / clinician / staff) with permission matrix; UI gates admin actions by role
- [x] **ORG-13**: Per-clinic onboarding flow override (clinics customize their patient-invite onboarding via M2 step builder reusing Phase 15 dnd-kit primitives)

### WS11 — C B2B: Custom Rank Weights + Dose-Trend Alerts (CLIN, 8 REQ-IDs)

- [ ] **CLIN-01**: Clinic admin configures per-clinic ranking weights (which signals matter most for patient roster ranking: dose-adherence / weight-loss / activity / etc.) stored in `org_settings` JSONB
- [ ] **CLIN-02**: Dose-trend cron job runs nightly; compares each patient's dose-pattern against per-clinic thresholds; inserts `clinician_alerts` row when threshold breached
- [ ] **CLIN-03**: Clinician receives in-app notification + email when alert fires; email is PHI-aware (uses HIPAA-eligible email path; never includes patient name in subject)
- [ ] **CLIN-04**: Alert delivery is debounced (same alert within 24h aggregates to one notification) + retry-on-failure (3 attempts over 1h)
- [ ] **CLIN-05**: Admin views aggregate alert metrics in clinic-side dashboard (alerts-by-type, alerts-by-clinician-ack-rate)
- [ ] **CLIN-06**: Clinician-side alert acknowledge + snooze workflow; alerts age out (auto-resolve after 7d if not acted on)
- [ ] **CLIN-07**: Per-patient threshold overrides (clinician sets patient-specific dose-trend thresholds via patient drill-in surface)
- [ ] **CLIN-08**: Aggregate clinic dashboard surfaces population-level dose-trend metrics ("# patients on Wegovy below dosing range this week") via materialized view

### WS12 — C B2B: HIPAA BAA Chain (HIPAA, 18 REQ-IDs)

- [x] **HIPAA-01**: Supabase Team + HIPAA add-on plan active ($599/mo + $325/mo add-on); BAA signed; data-region locked
- [x] **HIPAA-02**: Vercel Pro + HIPAA add-on active ($20/seat + $350/mo add-on); BAA signed
- [x] **HIPAA-03**: Sentry Business plan active (~$80/mo); BAA signed; PHI scrubbing rules configured
- [x] **HIPAA-04**: Anthropic Enterprise plan active (sales-assisted; cannot self-serve); BAA signed; ZDR addendum signed; runtime model-allowlist guard refuses requests to non-BAA-covered model IDs (Workbench/Console/Cowork/beta endpoints blocked)
- [x] **HIPAA-05**: AWS SES BAA active for PHI-touching email path (BAA via AWS Artifact); `_shared/email-router.ts` switches on `phi:boolean` template flag to route PHI email via SES, non-PHI via Resend
- [x] **HIPAA-06**: PostHog tier-decision implemented (Boost add-on $2K/mo for session-replay-with-BAA on clinic-staff routes, OR scrub-only without add-on); session-replay disabled on PHI URL regex regardless
- [x] **HIPAA-07**: Two Anthropic credentials wired: consumer ai-chat (existing) vs clinical-context ai-chat (BAA + ZDR + restrictive system prompt + web_search disabled); branches in `ai-chat` Edge Fn on `org_id IS NOT NULL`
- [x] **HIPAA-08**: Stripe will NEVER sign BAA (per Stripe policy) — CI lint blocks PHI keywords (patient name, diagnosis, medication name, lab value, etc.) in any Stripe API call site (description, metadata, line-item descriptions); uses HIPAA "normal banking exemption"
- [x] **HIPAA-09**: SOC 2 Type I attestation in parallel (Drata/Vanta/Secureframe ~$10-15K + 6 weeks); trust signal beyond BAA (clinics ask for both)
- [x] **HIPAA-10**: Employee security training + periodic access-review automation (Drata/Vanta or self-built); periodic-access-review HIPAA requirement met
- [x] **HIPAA-11**: Written policies live in `/legal/hipaa/` + internal wiki: access control, incident response, breach notification, employee training, BAA management
- [x] **HIPAA-12**: `vendor_baa_chain` table tracks each vendor BAA + expiry + scope; weekly subprocessor-diff cron compares vendor subprocessor lists against last-known and alerts on changes
- [x] **HIPAA-13**: BAA expiry calendar (60-day advance alert) ensures no vendor BAA lapses silently
- [x] **HIPAA-14**: Audit-log hardening: `phi_access_log` sibling table records every read of PHI by clinician/admin (actor + patient_id + accessed-field + timestamp); append-only RLS
- [x] **HIPAA-15**: MFA enforcement on all clinician + admin roles (Supabase Auth TOTP); hard-cutover vs 30d-soft-banner decision logged
- [x] **HIPAA-16**: Sentry `data-sentry-mask` audit on every PHI-bearing component; CI lint requires explicit mask attribute on inputs touching `profiles.email`, `patient.name`, dose values, etc.
- [x] **HIPAA-17**: PostHog `disable_session_recording_on_url` regex covers `/clinic/*`, `/patient/*`, `/admin/users/*`, `/dose-log/*`
- [x] **HIPAA-18**: Annual risk assessment + breach-notification SLA (60 days HHS) documented + drilled

### WS13 — User-facing: M2 Onboarding Overhaul (ONBOARD, 13 REQ-IDs)

- [ ] **ONBOARD-01**: Visitor sees value-first preview (anonymous session row keyed by cookie; populated dashboard before signup); merge to authenticated row on signup
- [ ] **ONBOARD-02**: User signs in via magic link OR Google OAuth OR Apple OAuth (password optional, not required); native input types + ≥44px tap targets on mobile
- [ ] **ONBOARD-03**: One question per screen on mobile (375px); progress bar; back nav; resumable across devices via Supabase row (NOT localStorage)
- [ ] **ONBOARD-04**: Smart defaults inferred from `Accept-Language` + IP (currency, units, timezone)
- [ ] **ONBOARD-05**: Onboarding ends by completing one real task (logged injection / scheduled dose / joined challenge based on stated goal) — activation event fires
- [ ] **ONBOARD-06**: Activation event clearly defined for LeanShot + instrumented in TAXO event registry + measured per cohort
- [ ] **ONBOARD-07**: Admin drag-and-drop step builder (question type / copy / validation / branching) — schema stored as JSON in `onboarding_flows.config`
- [ ] **ONBOARD-08**: A/B variants via PostHog feature flags + `getFeatureFlagPayload`; traffic split %; "ship winner" button promotes variant to 100%
- [ ] **ONBOARD-09**: Per-step funnel analytics in admin (views / completions / drop-off / time-on-step) queried from PostHog
- [ ] **ONBOARD-10**: Mobile Lighthouse score ≥90 on onboarding route
- [ ] **ONBOARD-11**: Anonymous-to-authenticated session merge handles race conditions (two devices both opening anonymous sessions); merge strategy chooses richest-data row
- [ ] **ONBOARD-12**: Social proof on signup (live user counter via Supabase Realtime + 3 rotating testimonials + tier badges) — opt-out via privacy-mode users
- [ ] **ONBOARD-13**: First-action surface respects user goal (different first-action per stated objective: lose-weight goal → weight log; new-prescription goal → first injection log)

### WS14 — User-facing: M3 Gamification Engine (GAME, 9 REQ-IDs)

- [ ] **GAME-01**: User accumulates XP in append-only `xp_ledger` (entry per qualifying action: log injection +5, complete weekly challenge +50, etc.); level computed deterministically from XP total
- [ ] **GAME-02**: Streak tracked in `streak_state` (current_streak_days + longest_streak_days + last_action_at) computed via daily `pg_cron` job respecting user's stored timezone
- [ ] **GAME-03**: Freeze tokens granted free monthly (1/month) to all users; ethical-only mechanic (NOT monetized, NOT sold); appendable via admin grant for support cases
- [ ] **GAME-04**: Cohort-scoped opt-in leaderboards (anonymized handles) refreshed via `pg_cron` 15-min on materialized view
- [ ] **GAME-05**: Weekly challenges admin-configurable (challenge_type + duration + reward) stored in `weekly_challenges`; ethical-only loss aversion (notify BEFORE streak break, no dark patterns)
- [ ] **GAME-06**: Progress rings render on dashboard for goals + streak (Site-rotation card already shipped in v1.2 DS-9); `useReducedMotion` respected
- [ ] **GAME-07**: Shareable level-up cards (OG-image generation via Vercel Function); user shares to Twitter/X/LinkedIn/Instagram with auto-generated visual
- [ ] **GAME-08**: Weekly challenges support admin variant A/B (cohort-scoped challenge framing variants; e.g., A: "Log 5 injections this week" vs B: "Build a 5-day streak")
- [ ] **GAME-09**: Cross-streak rewards (streak + challenge completion combo unlocks special badge); celebrates compound consistency

### WS15 — User-facing: M3 Review Prompt Engine (REVIEW, 8 REQ-IDs)

- [ ] **REVIEW-01**: Internal NPS-style rating fires as INDEPENDENT surface (NOT gating any store-native prompt) — V13-3 plan-checker BLOCKER active on conditional native-prompt code
- [ ] **REVIEW-02**: Admin defines trigger rules via rule-builder UI (if/and/or composition over event names + cohort membership + cooldown state)
- [ ] **REVIEW-03**: Cooldown rules enforced: min days between prompts (default 30); max prompts per lifetime (default 3)
- [ ] **REVIEW-04**: Promoter (4-5★ NPS) routes to external CTA (Trustpilot / G2 / Capterra); user opt-in to external review redirect
- [ ] **REVIEW-05**: Non-promoter (1-3★ NPS) routes to in-app feedback form → auto-creates M6 helpdesk ticket (subject "Feedback from NPS rating")
- [ ] **REVIEW-06**: PostHog A/B on prompt copy + timing (test variants of trigger conditions, copy framings, CTA wordings)
- [ ] **REVIEW-07**: Admin views per-funnel review-rate dashboard (prompt shown → internal rating → external review posted) with per-variant breakdown
- [ ] **REVIEW-08**: Multi-channel external CTAs (Trustpilot / G2 / Capterra / Apple-PWA-store / Google-Play-PWA when applicable)

### WS16 — User-facing: M6 Helpdesk Core (HELP, 13 REQ-IDs)

- [ ] **HELP-01**: Schema: `tickets` + `ticket_messages` + `ticket_attachments` + `ticket_tags` + `kb_articles` + `kb_article_versions` + `csat_responses` + `agent_macros` (8+ tables); RLS isolates user-side ticket views from agent-side
- [ ] **HELP-02**: In-app widget on every screen (KB search first → ticket form fallback if no helpful article)
- [ ] **HELP-03**: Email-to-ticket via Resend Inbound webhook (or Postmark fallback if Resend BAA NO) → Edge Function → row insert; HMAC token in `Reply-To` for reply-threading
- [ ] **HELP-04**: AI assist via Claude (draft replies + auto-tag tickets + auto-route by topic) — agent reviews + edits + sends
- [ ] **HELP-05**: CSAT survey auto-sent after ticket close via Resend (or SES if PHI-touching); 1-tap reply
- [ ] **HELP-06**: SLA tracking with breach alerts; `pg_cron` checks open tickets against priority SLA, emits agent + on-call notifications
- [ ] **HELP-07**: KB articles use markdown + react-markdown rendering + dompurify XSS protection; admin-editable with versioning
- [ ] **HELP-08**: KB articles localized to Spanish (parallel `{slug}.es.md` files); locale picker per article
- [ ] **HELP-09**: Realtime updates for agents + users via Supabase Realtime (typing indicator + live message arrival); reuses Phase 9 patterns
- [ ] **HELP-10**: Macros / canned responses per-agent + per-team; agents insert via `/macro` slash command in reply composer
- [ ] **HELP-11**: KB full-text search using Postgres `tsvector` + GIN indexes (English + Spanish dictionaries); upgrade to Typesense/Meilisearch ONLY if needed at v1.5+
- [ ] **HELP-12**: Admin routing rules (tag → agent assignment); admin macro editor; admin SLA-targets editor; admin sentiment-alert thresholds
- [ ] **HELP-13**: Admin sees per-tag-cluster ticket-volume trending dashboard (helps identify product-issue clusters before they spike)

### WS17 — User-facing: M5b AI Recommender (RECOMMEND, 10 REQ-IDs)

- [ ] **RECOMMEND-01**: pgvector extension enabled (Supabase Pro+); `content_embeddings vector(1536)` table + HNSW (or IVFFlat — decide at plan-phase) index
- [ ] **RECOMMEND-02**: OpenAI `text-embedding-3-small` routed via Vercel AI Gateway (same proxy posture as v1.2 Anthropic); embeddings only, not chat
- [ ] **RECOMMEND-03**: Nightly cron embeds new content (community posts when M4 ships, KB articles, blog posts, course lessons) into `content_embeddings`
- [ ] **RECOMMEND-04**: Next-Best-Action recommender Edge Fn takes user_id + recent events + profile → returns top-3 dashboard recommendations (cosine similarity on user-context embedding)
- [ ] **RECOMMEND-05**: Weekly Claude summary email (short narrative + 1-3 suggested actions) sent via Resend (or SES if PHI); cron at 09:00 user-timezone Sunday
- [ ] **RECOMMEND-06**: Sentry recommendation-CTR tracking + admin dashboard with recommendation-impression + recommendation-click rates per recommendation-type
- [ ] **RECOMMEND-07**: Human-in-the-loop review queue for AI suggestions; admin approves/rejects/edits before auto-apply within guardrails (whitelisted recommendation set only)
- [ ] **RECOMMEND-08**: Content recommendations surface in KB article footer ("Related articles") + community feed ("You might like") + course landing ("Recommended courses")
- [ ] **RECOMMEND-09**: Pricing/offer personalization (annual nudge for monthly subscribers showing churn signal; discount eligibility per user's plan-history); plan-personalization Edge Fn called by PAYWALL + SAVE
- [ ] **RECOMMEND-10**: Win-back prompts for at-risk users (simple churn model: days-since-last-action × declining-streak × paywall-dismissals); auto-send via SAVE-engine

### WS18 — User-facing: M7 Polish (POLISH, 12 REQ-IDs)

- [ ] **POLISH-01**: Cancellation flow with save-offers (pause / downgrade / discount / extended trial); user clicks Cancel → modal offers one of 4 (per eligibility rules)
- [ ] **POLISH-02**: `cancellation_offers_log` records offer-take rate per offer-type per cohort; admin sees offer-take ROI analysis
- [ ] **POLISH-03**: Pause subscription (1/2/3 months) returns user to active billing on resume date
- [ ] **POLISH-04**: Discount save-offer (20%-30% off for 2-3 months) applies as Stripe coupon
- [ ] **POLISH-05**: Smart notifications (email + web-push + in-app) with frequency-capping + snoozable + sentiment-aware per `notification_settings`
- [ ] **POLISH-06**: User manages notification preferences in self-serve center (per-category opt-out: dose-reminders / AI-insights / clinic-alerts / billing / marketing)
- [x] **POLISH-07**: PWA + offline mode via `vite-plugin-pwa`; native-feeling install prompt on supported browsers
- [ ] **POLISH-08**: Dark mode parity across all v1.3 new surfaces (admin shell + helpdesk + onboarding builder + clinic dashboard)
- [ ] **POLISH-09**: WCAG 2.2 AA accessibility audit via axe-core in CI; keyboard nav + screen-reader labels + contrast + focus rings verified
- [ ] **POLISH-10**: Public status page at `status.leanshot.app` via Better Stack ($12/mo); auto-incident detection from Sentry + Vercel + Supabase
- [x] **POLISH-11**: "What's New" in-app drawer surfaces shipped improvements (changelog-style, per-user dismissal state)
- [ ] **POLISH-12**: Quarterly NPS survey (one-question + open-text follow-up) sent to active users; segmented by tenure + plan + cohort; results visible in admin

### WS19 — M4: Membership Tiers Extension (MEMBER, 4 REQ-IDs)

- [ ] **MEMBER-01**: Lifetime tier added to `tier_effective` view + Stripe one-time price wiring; one-time payment grants permanent Pro entitlement
- [ ] **MEMBER-02**: Grandfathering — admin sets per-cohort grandfathered pricing (e.g., "Pro early-adopters keep $9.99/mo when public price moves to $14.99")
- [ ] **MEMBER-03**: Coupon-driven Pro upgrades + 7-day-trial extension for cancellation save flow (compounds with POLISH-04 + SAVE flow); admin-creatable coupons via Stripe Coupons + Promotion Codes
- [ ] **MEMBER-04**: Community-gated content entitlements — Pro-only spaces / courses / events enforced via `tier_effective` lookup at COMMUNITY/COURSE/EVENT surfaces

### WS20 — M4: Community Feed (COMMUNITY, 9 REQ-IDs)

- [ ] **COMMUNITY-01**: User posts + threaded comments (markdown body via react-markdown + dompurify, shared with HELP-07); posts schema with author_id + space_id + parent_comment_id + body + reactions
- [ ] **COMMUNITY-02**: Likes + reactions (extensible to emoji reactions); post_reactions table with idempotent toggle
- [ ] **COMMUNITY-03**: @mentions in posts + comments fire in-app + email notifications to mentioned user (respect notification_settings)
- [ ] **COMMUNITY-04**: Image embeds (Supabase Storage signed URLs) + video embeds (Mux upload + adaptive playback); per-post image-count cap
- [ ] **COMMUNITY-05**: Realtime feed updates via Supabase Realtime (new posts + new comments + reaction updates) — reuses Phase 9 + HELP-09 Realtime patterns
- [ ] **COMMUNITY-06**: Spaces / categories admin-configurable (e.g., "GLP-1 starters", "Trial month tips", "Clinic Q&A"); per-space visibility (Free / Pro / Lifetime)
- [ ] **COMMUNITY-07**: Member directory with profile pages (bio, links, joined-date, badges); admin sets directory visibility (org-only for clinics)
- [ ] **COMMUNITY-08**: Opt-in DMs (1:1 message threads); per-user DM-open toggle; rate limiting (max N new DM threads/day)
- [ ] **COMMUNITY-09**: Community leaderboard (separate from GAME app leaderboard); top contributors per space + per month; cohort-scoped opt-in (anonymized handles)

### WS21 — M4: Courses / Classroom (COURSE, 6 REQ-IDs)

- [ ] **COURSE-01**: courses + modules + lessons schema; admin creates course → adds modules → adds lessons (video + text + downloadable files)
- [ ] **COURSE-02**: Mux video integration (admin uploads MP4 → Mux transcodes to adaptive HLS → playback via Mux Player); per-lesson video stored as `mux_asset_id`
- [ ] **COURSE-03**: lesson_progress tracking + per-user completion %; resume-where-left-off across devices
- [ ] **COURSE-04**: Completion certificates generated server-side as PDFs (jsPDF, already in v1.2 stack); certificate includes user name + course title + completion date + verification URL
- [ ] **COURSE-05**: Course landing pages reuse PageBuilder + A/B (PAGEAB-06 per-block variants); admin templates: long-form sales + outcome-focused + FAQ-heavy
- [ ] **COURSE-06**: Lesson resources (downloadable files via Supabase Storage signed URLs); per-resource entitlement check (Pro-only resources gated)

### WS22 — M4: Events / Calendar (EVENT, 5 REQ-IDs)

- [ ] **EVENT-01**: Events schema + calendar UI (admin creates event with title + description + start + end + capacity + space + RSVP settings + visibility per tier)
- [ ] **EVENT-02**: User RSVPs (Going / Maybe / Not Going); capacity limits enforced; waitlist when capacity hit
- [ ] **EVENT-03**: Zoom / Google Meet integration (admin pastes meeting link OR auto-generates via Zoom OAuth; deep-link revealed to attendees only)
- [ ] **EVENT-04**: Automatic reminder emails (1 day before + 1 hour before) via Resend (or SES for PHI-touching clinic events); per-user-timezone-aware
- [ ] **EVENT-05**: Post-event recording uploaded to Mux → attached as new lesson in adjacent course (optional, admin-toggled)

### WS23 — M4: Moderation (MOD, 5 REQ-IDs)

- [ ] **MOD-01**: User reports post / comment / DM → admin queue with reporter context + reported-content snapshot + cooldown on duplicate-reports
- [ ] **MOD-02**: Admin mutes (silent suspend) + bans (account disable) + temporary suspensions (auto-restore after duration)
- [ ] **MOD-03**: Banned-words list (admin-configurable) + automatic post-create flagging on match → admin queue
- [ ] **MOD-04**: Auto-flagging via Claude API for toxicity + spam + medical-misinformation; compounds with HELP AI-assist Claude budget; flagged content sent to admin queue NOT auto-removed
- [ ] **MOD-05**: Moderation audit log (every admin action + automated flag) for compliance trail; immutable per HIPAA-14 pattern

### WS24 — M4: Search + Email Digests (DIGEST, 4 REQ-IDs)

- [ ] **DIGEST-01**: Postgres full-text search on community posts + courses + events (`tsvector` + GIN); shared infra with HELP-11 KB search (English + Spanish dictionaries)
- [ ] **DIGEST-02**: Daily email digest (top posts in your spaces + new comments on your posts + tagged-you mentions) via Resend, `pg_cron` 09:00 user-timezone
- [ ] **DIGEST-03**: Weekly email digest (course progress recap + upcoming events you RSVP'd + community top-3 of the week); respects user notification preferences
- [ ] **DIGEST-04**: Per-user digest opt-out + frequency control in notification settings (POLISH-06 extension); 1-click unsubscribe link in every digest

---

## Future Requirements (v1.4+)

Items defer to v1.4 milestone (mobile + deferred carry-over) or v1.5+:

**v1.4 carry-over from v1.2:**
- Phase 16 Mobile Shells (MOBILE-01..10 + MONEY-06)
- Phase 17 Push Notifications (PUSH-01..05)
- Phase 18 HealthKit + Two-tunnel Firewall (HEALTH-01..08)
- Phase 20 Ad Network (AD-01..12)
- Phase 21 Watch Apps (WATCH-01..08)
- P22b Onboarding revamp ON-01 (now subsumed by v1.3 ONBOARD workstream — revisit at v1.4 scoping)

**v1.4 additions from v1.3 deferred:**
- M3 native SKStoreReviewController (iOS) + Play in-app review (Android) — depends on P16
- M6 App Store / Play review-ingestion hub — depends on store presence

**v1.5 candidates:**
- M5b full AI Personalization (anomaly detection + full churn model + automated win-back automation) — needs event-data maturity
- Subdomain white-label `acme.leanshot.app` — Capacitor universal-link + AASA complexity
- i18n `/es/` path-prefix routing (would double Vercel rewrites)
- HealthKit write-back
- Standalone watch mode (no iPhone required)
- HIPAA HITRUST certification (10-20× SOC 2 cost, only large clinics demand)
- Hourly ad-revenue ETL (currently daily; revisit at $1k/mo revenue)

---

## Out of Scope (explicit exclusions)

Items explicitly excluded from v1.3 with reasoning:

**Already in v1.2; not re-shipped:**
- Cookie consent + DSAR portal + audit_logs base (P22 shipped)
- Page builder base + 8 blocks + 5 templates + page-render + ISR (P15 shipped)
- Owner/Admin members table + MRR/ARR + impersonation + audit + refunds + feature-flag overrides (P22 shipped — v1.3 EXTENDS via ADMIN workstream)
- Single-tier affiliate + Stripe Connect Express + partner dashboard + 10-step deletion cascade (P19 shipped — v1.3 EXTENDS via AFFTIER)
- StreakBadge 4-tier visuals + AI avatar + 8 illustrations + Site-rotation v2 (P13 shipped — v1.3 EXTENDS via GAME engine)

**Cross-cutting NEVER:**
- HealthKit data into ad targeting (Apple §5.1.3; Two-tunnel firewall structural)
- Ads on clinic/doctor-share/admin surfaces (B2B trust; AD-03 enforcement in v1.4)
- PHI keywords in Stripe API call fields (HIPAA-08 CI lint)
- Native rating-prompt gated by NPS score (App/Play violation; REVIEW-01 BLOCKER)
- Session-replay autocapture on PHI routes (HIPAA-17)
- Per-admin custom permission matrix (keep fixed 3-role)
- Multi-level affiliate (MLM)
- Bandit auto-traffic-shifting A/B (manual ship-winner only)

**Vendor/technical:**
- Mixpanel/Amplitude (PostHog covers)
- Pinecone/Weaviate (pgvector covers)
- LaunchDarkly/Statsig/GrowthBook (PostHog Experiments covers)
- Mux/Cloudflare Stream (v1.5 if needed for M4 community video)
- Postmark full swap of Resend (additive AWS SES path is cheaper)
- TikTok community SDK (alpha-tier; hand-roll fetch)
- Self-hosting PostHog for HIPAA dodge (PostHog explicitly does NOT sign self-hosted BAAs)
- CMS for KB articles (Markdown files + existing page-render Edge Fn covers)
- Turborepo monorepo migration (polyrepo+ stays per v1.2 ARCHITECTURE)

---

## Cross-cutting Concerns

These cut across multiple workstreams. Each future phase's CONTEXT.md must address its share.

1. **HIPAA BAA chain — every vendor decision affects clinic deal eligibility.** v1.3 vendor cost +$1,864-4,364/mo. Owners: HIPAA workstream + every workstream consuming vendors (Resend → HELP, Anthropic → RECOMMEND + HELP, PostHog → TAXO + PAYWALL + REVIEW)
2. **Multi-tenant `org_id` second RLS axis** — every new table joining patient data MUST get a cross-tenant impersonation proof test. Owners: ORG + CLIN + HELP + RECOMMEND
3. **Bundle ceiling: 50 kB gz index hard ceiling, 22 kB target post-v1.3.** New per-chunk ceilings: admin-shell 30 kB, helpdesk-widget 25 kB, i18n-runtime 15 kB, gamification-burst 8 kB
4. **Stripe will NEVER sign a BAA** — CI lint blocks PHI keywords in Stripe API call sites (HIPAA-08). Owners: HIPAA + ORG + every Stripe touch point
5. **Two Anthropic credentials** (consumer vs clinical) — branch in `ai-chat` Edge Fn on `org_id IS NOT NULL`. Owners: HIPAA + RECOMMEND + HELP AI-assist
6. **App Store / Play Store native review-prompt policy** — V13-3 plan-checker BLOCKER on conditional native-prompt code. Owners: REVIEW (v1.3 web only; native deferred to v1.4)
7. **Page-builder A/B canonical-link omission** — V13-4 silent SEO penalty. Every variant page MUST emit `<link rel="canonical">` to control. Owners: PAGEAB
8. **Ad ETL 4 silent-drop modes** — V13-5 idempotent re-sync + gap-detection + AEM priority register + FX normalization. Owners: ADETL
9. **Activation event definition** — load-bearing for PAYWALL + REVIEW + RECOMMEND + cohort triggers. Locked at ONBOARD CONTEXT.md before PAYWALL or REVIEW plan-phase
10. **Pharmacology paywall safety-info carve-out** — never paywalled (PHARMA-02). Owners: PHARMA + clinical-content review
11. **i18n routing = `?lang=es` query** (NOT `/es/` path prefix) — avoids V13-9 Vercel rewrite doubling. Owners: I18N + every consumer of locale (HELP KB, transactional emails, ORG white-label)

---

## Open Questions (locked at plan-phase, not milestone scope)

1. **Resend BAA y/n** — Phase 25 first task = Resend Sales call. Gates HELP email-to-ticket choice + transactional email split (`_shared/email-router.ts` design)
2. **PostHog Enterprise/Boost add-on y/n** — Phase 25 CONTEXT.md decision; gates session-replay scope on clinic-staff routes
3. **Anthropic Enterprise pricing for LeanShot scale** — Phase 25 CONTEXT.md; gates HIPAA-07 dual-credential AI + RECOMMEND + HELP AI-assist split
4. **"Active patient" definition for metered billing** — Phase 29 CONTEXT.md (e.g., "logged-event-in-last-30-days"); affects MRR forecasting
5. **Pharmacology paywall line** — Phase 39 CONTEXT.md decision artifact; what stays free on principle vs paid (safety NEVER paywalled per PHARMA-02 is the floor)
6. **IVFFlat vs HNSW for pgvector at clinic-tenant scale** — Phase 38 CONTEXT.md; based on v1.3 user count + clinic-tenant fanout
7. **Meta App Review (Dev → Standard tier)** — Phase 33 prerequisite; 2-4 week vendor lead time
8. **First-clinic-deal price floor** — $1,864-4,364/mo HIPAA vendor burn → finance conversation; affects clinic-tier pricing model

---

## Traceability

REQ-ID → Phase mapping (created 2026-05-17 by `gsd-roadmapper`). 204 REQ-IDs mapped across 26 phases (24-49). 100% coverage; no orphans; no duplicates.

| Requirement | Phase | Status |
|-------------|-------|--------|
| ADMIN-01 | Phase 24 | Pending |
| ADMIN-02 | Phase 24 | Pending |
| ADMIN-03 | Phase 24 | Pending |
| ADMIN-04 | Phase 27 | Pending |
| ADMIN-05 | Phase 27 | Pending |
| ADMIN-06 | Phase 27 | Pending |
| TAXO-01 | Phase 24 | Pending |
| TAXO-02 | Phase 24 | Pending |
| TAXO-03 | Phase 27 | Pending |
| TAXO-04 | Phase 24 | Pending |
| TAXO-05 | Phase 27 | Pending |
| TAXO-06 | Phase 24 | Pending |
| AFFTIER-01 | Phase 26 | Pending |
| AFFTIER-02 | Phase 26 | Pending |
| AFFTIER-03 | Phase 26 | Pending |
| AFFTIER-04 | Phase 26 | Pending |
| AFFTIER-05 | Phase 26 | Pending |
| AFFTIER-06 | Phase 26 | Pending |
| PAYWALL-01 | Phase 39 | Pending |
| PAYWALL-02 | Phase 39 | Pending |
| PAYWALL-03 | Phase 39 | Pending |
| PAYWALL-04 | Phase 39 | Pending |
| PAYWALL-05 | Phase 39 | Pending |
| PAYWALL-06 | Phase 39 | Pending |
| PAYWALL-07 | Phase 39 | Pending |
| PAGEAB-01 | Phase 39 | Pending |
| PAGEAB-02 | Phase 39 | Pending |
| PAGEAB-03 | Phase 39 | Pending |
| PAGEAB-04 | Phase 39 | Pending |
| PAGEAB-05 | Phase 39 | Pending |
| PAGEAB-06 | Phase 39 | Pending |
| PAGEAB-07 | Phase 39 | Pending |
| ADETL-01 | Phase 33 | Complete |
| ADETL-02 | Phase 33 | Complete |
| ADETL-03 | Phase 33 | Complete |
| ADETL-04 | Phase 33 | Complete |
| ADETL-05 | Phase 33 | Complete |
| ADETL-06 | Phase 33 | Complete |
| ADETL-07 | Phase 33 | Complete |
| ADETL-08 | Phase 33 | Complete |
| ADETL-09 | Phase 33 | Complete |
| EMBED-01 | Phase 41 | Pending |
| EMBED-02 | Phase 41 | Pending |
| EMBED-03 | Phase 41 | Pending |
| EMBED-04 | Phase 41 | Pending |
| EMBED-05 | Phase 41 | Pending |
| EMBED-06 | Phase 41 | Pending |
| EMBED-07 | Phase 41 | Pending |
| EMBED-08 | Phase 41 | Pending |
| PHARMA-01 | Phase 39 | Pending |
| PHARMA-02 | Phase 39 | Pending |
| PHARMA-03 | Phase 39 | Pending |
| PHARMA-04 | Phase 39 | Pending |
| PHARMA-05 | Phase 39 | Pending |
| PHARMA-06 | Phase 39 | Pending |
| PHARMA-07 | Phase 39 | Pending |
| PHARMA-08 | Phase 39 | Pending |
| I18N-01 | Phase 32 | Pending |
| I18N-02 | Phase 32 | Pending |
| I18N-03 | Phase 32 | Pending |
| I18N-04 | Phase 32 | Pending |
| I18N-05 | Phase 32 | Pending |
| I18N-06 | Phase 32 | Pending |
| I18N-07 | Phase 32 | Pending |
| I18N-08 | Phase 32 | Pending |
| I18N-09 | Phase 32 | Pending |
| I18N-10 | Phase 32 | Pending |
| ORG-01 | Phase 28 | Pending |
| ORG-02 | Phase 28 | Pending |
| ORG-03 | Phase 28 | Pending |
| ORG-04 | Phase 28 | Complete |
| ORG-05 | Phase 28 | Pending |
| ORG-06 | Phase 28 | Pending |
| ORG-07 | Phase 28 | Complete |
| ORG-08 | Phase 29 | Complete |
| ORG-09 | Phase 29 | Complete |
| ORG-10 | Phase 29 | Complete |
| ORG-11 | Phase 31 | Complete |
| ORG-12 | Phase 31 | Complete |
| ORG-13 | Phase 31 | Complete |
| CLIN-01 | Phase 30 | Pending |
| CLIN-02 | Phase 30 | Pending |
| CLIN-03 | Phase 30 | Pending |
| CLIN-04 | Phase 30 | Pending |
| CLIN-05 | Phase 30 | Pending |
| CLIN-06 | Phase 30 | Pending |
| CLIN-07 | Phase 30 | Pending |
| CLIN-08 | Phase 30 | Pending |
| HIPAA-01 | Phase 25 | Complete |
| HIPAA-02 | Phase 25 | Complete |
| HIPAA-03 | Phase 25 | Complete |
| HIPAA-04 | Phase 25 | Complete |
| HIPAA-05 | Phase 25 | Complete |
| HIPAA-06 | Phase 25 | Complete |
| HIPAA-07 | Phase 25 | Complete |
| HIPAA-08 | Phase 25 | Complete |
| HIPAA-09 | Phase 25 | Complete |
| HIPAA-10 | Phase 25 | Complete |
| HIPAA-11 | Phase 25 | Complete |
| HIPAA-12 | Phase 25 | Complete |
| HIPAA-13 | Phase 25 | Complete |
| HIPAA-14 | Phase 25 | Complete |
| HIPAA-15 | Phase 25 | Complete |
| HIPAA-16 | Phase 25 | Complete |
| HIPAA-17 | Phase 25 | Complete |
| HIPAA-18 | Phase 25 | Complete |
| ONBOARD-01 | Phase 34 | Pending |
| ONBOARD-02 | Phase 34 | Pending |
| ONBOARD-03 | Phase 34 | Pending |
| ONBOARD-04 | Phase 34 | Pending |
| ONBOARD-05 | Phase 34 | Pending |
| ONBOARD-06 | Phase 34 | Pending |
| ONBOARD-07 | Phase 34 | Pending |
| ONBOARD-08 | Phase 34 | Pending |
| ONBOARD-09 | Phase 34 | Pending |
| ONBOARD-10 | Phase 34 | Pending |
| ONBOARD-11 | Phase 34 | Pending |
| ONBOARD-12 | Phase 34 | Pending |
| ONBOARD-13 | Phase 34 | Pending |
| GAME-01 | Phase 35 | Pending |
| GAME-02 | Phase 35 | Pending |
| GAME-03 | Phase 35 | Pending |
| GAME-04 | Phase 35 | Pending |
| GAME-05 | Phase 35 | Pending |
| GAME-06 | Phase 35 | Pending |
| GAME-07 | Phase 35 | Pending |
| GAME-08 | Phase 35 | Pending |
| GAME-09 | Phase 35 | Pending |
| REVIEW-01 | Phase 36 | Pending |
| REVIEW-02 | Phase 36 | Pending |
| REVIEW-03 | Phase 36 | Pending |
| REVIEW-04 | Phase 36 | Pending |
| REVIEW-05 | Phase 36 | Pending |
| REVIEW-06 | Phase 36 | Pending |
| REVIEW-07 | Phase 36 | Pending |
| REVIEW-08 | Phase 36 | Pending |
| HELP-01 | Phase 37 | Pending |
| HELP-02 | Phase 37 | Pending |
| HELP-03 | Phase 37 | Pending |
| HELP-04 | Phase 37 | Pending |
| HELP-05 | Phase 37 | Pending |
| HELP-06 | Phase 37 | Pending |
| HELP-07 | Phase 37 | Pending |
| HELP-08 | Phase 37 | Pending |
| HELP-09 | Phase 37 | Pending |
| HELP-10 | Phase 37 | Pending |
| HELP-11 | Phase 37 | Pending |
| HELP-12 | Phase 37 | Pending |
| HELP-13 | Phase 37 | Pending |
| RECOMMEND-01 | Phase 38 | Pending |
| RECOMMEND-02 | Phase 38 | Pending |
| RECOMMEND-03 | Phase 38 | Pending |
| RECOMMEND-04 | Phase 38 | Pending |
| RECOMMEND-05 | Phase 38 | Pending |
| RECOMMEND-06 | Phase 38 | Pending |
| RECOMMEND-07 | Phase 38 | Pending |
| RECOMMEND-08 | Phase 38 | Pending |
| RECOMMEND-09 | Phase 38 | Pending |
| RECOMMEND-10 | Phase 38 | Pending |
| POLISH-01 | Phase 40 | Pending |
| POLISH-02 | Phase 40 | Pending |
| POLISH-03 | Phase 40 | Pending |
| POLISH-04 | Phase 40 | Pending |
| POLISH-05 | Phase 42 | Pending |
| POLISH-06 | Phase 42 | Pending |
| POLISH-07 | Phase 42 | Complete |
| POLISH-08 | Phase 42 | Pending |
| POLISH-09 | Phase 42 | Pending |
| POLISH-10 | Phase 41 | Pending |
| POLISH-11 | Phase 42 | Complete |
| POLISH-12 | Phase 42 | Pending |
| MEMBER-01 | Phase 43 | Pending |
| MEMBER-02 | Phase 43 | Pending |
| MEMBER-03 | Phase 43 | Pending |
| MEMBER-04 | Phase 43 | Pending |
| COMMUNITY-01 | Phase 44 | Pending |
| COMMUNITY-02 | Phase 44 | Pending |
| COMMUNITY-03 | Phase 44 | Pending |
| COMMUNITY-04 | Phase 44 | Pending |
| COMMUNITY-05 | Phase 44 | Pending |
| COMMUNITY-06 | Phase 44 | Pending |
| COMMUNITY-07 | Phase 45 | Pending |
| COMMUNITY-08 | Phase 45 | Pending |
| COMMUNITY-09 | Phase 45 | Pending |
| COURSE-01 | Phase 46 | Pending |
| COURSE-02 | Phase 46 | Pending |
| COURSE-03 | Phase 46 | Pending |
| COURSE-04 | Phase 46 | Pending |
| COURSE-05 | Phase 46 | Pending |
| COURSE-06 | Phase 46 | Pending |
| EVENT-01 | Phase 47 | Pending |
| EVENT-02 | Phase 47 | Pending |
| EVENT-03 | Phase 47 | Pending |
| EVENT-04 | Phase 47 | Pending |
| EVENT-05 | Phase 47 | Pending |
| MOD-01 | Phase 48 | Pending |
| MOD-02 | Phase 48 | Pending |
| MOD-03 | Phase 48 | Pending |
| MOD-04 | Phase 48 | Pending |
| MOD-05 | Phase 48 | Pending |
| DIGEST-01 | Phase 49 | Pending |
| DIGEST-02 | Phase 49 | Pending |
| DIGEST-03 | Phase 49 | Pending |
| DIGEST-04 | Phase 49 | Pending |

**Coverage check:** 204/204 REQ-IDs mapped. 0 orphans. 0 duplicates. 26 phases (24-49).

### Coverage Summary

| Workstream | REQ-IDs | Count | Bet |
|-----------|---------|-------|-----|
| ADMIN | ADMIN-01..06 | 6 | Foundation |
| TAXO | TAXO-01..06 | 6 | Foundation |
| AFFTIER | AFFTIER-01..06 | 6 | A Revenue |
| PAYWALL | PAYWALL-01..07 | 7 | A Revenue |
| PAGEAB | PAGEAB-01..07 | 7 | A Revenue |
| ADETL | ADETL-01..09 | 9 | A Revenue |
| EMBED | EMBED-01..08 | 8 | B Depth |
| PHARMA | PHARMA-01..08 | 8 | B Depth |
| I18N | I18N-01..10 | 10 | B Depth |
| ORG | ORG-01..13 | 13 | C B2B |
| CLIN | CLIN-01..08 | 8 | C B2B |
| HIPAA | HIPAA-01..18 | 18 | C B2B |
| ONBOARD | ONBOARD-01..13 | 13 | User-facing depth |
| GAME | GAME-01..09 | 9 | User-facing depth |
| REVIEW | REVIEW-01..08 | 8 | User-facing depth |
| HELP | HELP-01..13 | 13 | User-facing depth |
| RECOMMEND | RECOMMEND-01..10 | 10 | User-facing depth |
| POLISH | POLISH-01..12 | 12 | User-facing depth |
| MEMBER | MEMBER-01..04 | 4 | M4 Membership/Community |
| COMMUNITY | COMMUNITY-01..09 | 9 | M4 Membership/Community |
| COURSE | COURSE-01..06 | 6 | M4 Membership/Community |
| EVENT | EVENT-01..05 | 5 | M4 Membership/Community |
| MOD | MOD-01..05 | 5 | M4 Membership/Community |
| DIGEST | DIGEST-01..04 | 4 | M4 Membership/Community |
| **Total** | | **204** | |

**Coverage:** 204 v1.3 REQ-IDs across 24 workstreams. To be mapped to ~25-27 phases by roadmapper (original 19 + 6-8 for M4). 9-12 month delivery (vs original 5-8). M4 stack additions: Mux video + react-markdown (shared with HELP) + dompurify (shared with HELP) + Zoom OAuth + Typesense (optional at scale).

---

*Generated: 2026-05-17 from /gsd-new-milestone v1.3 (per-category multiSelect; all 18 categories' differentiators selected by user)*
