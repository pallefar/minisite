# Architecture Research — LeanShot v1.3 Platform Expansion

**Domain:** B2B+B2C consumer-health SaaS extension on top of a shipped v1.2 React 19 + Vite + Supabase + Vercel codebase. Adds: multi-tenant clinic organizations (largest new surface), HIPAA-grade auditing, multi-tier affiliate, ad-spend ETL, i18n, AI personalization (pgvector), helpdesk, gamification, onboarding overhaul.
**Researched:** 2026-05-17
**Confidence:** HIGH on extension points into v1.2 (we own the codebase + 21 v1.2 migrations + 8 Edge Fns are now empirical, not hypothetical); MEDIUM on multi-tenant org schema shape (industry pattern, but first time we ship it); MEDIUM on HIPAA-compliant audit-log shape (regulator audience — Phase research will harden); HIGH on the "extend, don't replace" doctrine.

> **Read this first.** v1.3 is **NOT** an architecture rewrite. The v1.2 architecture (Zustand-store-as-truth, Supabase backend, Vercel SPA hosting, idle-deferred sync init, `<TierGate>`, `affiliate-attribute` + `stripe-webhook` + `account-delete` + `page-render` Edge Fns, 51 RLS deny policies, 14 cron jobs, server-side cookie attribution, Two-tunnel firewall ESLint rule) **stays**. This document describes (a) the **NEW components** that bolt onto it, (b) the **MODIFICATIONS** to existing components, and (c) the **INTEGRATION POINTS** between v1.2 and v1.3. Anything not mentioned as "modified" or "new" stays as-is per `.planning/milestones/v1.2-research/ARCHITECTURE.md`.

---

## Existing v1.2 Architecture (recap — DO NOT redesign)

```
┌────────────────────────────────────────────────────────────────────────┐
│  Vercel SPAs (static hosts)                                            │
│    • leanshot.app           — marketing (separate dist-marketing)      │
│    • app.leanshot.app       — the SPA (state-driven view router)       │
│    • Vercel rewrites:                                                  │
│        /r/{code}            → affiliate-attribute Edge Fn              │
│        /{lp-slug}           → page-render Edge Fn (ISR)                │
│        /sitemap.xml         → sitemap Edge Fn                          │
│        SPA fallback for /clinic /share /admin /auth /partner           │
│                              /affiliate /legal /signin /signup         │
└──────────────────────────┬─────────────────────────────────────────────┘
                           ▼
┌────────────────────────────────────────────────────────────────────────┐
│  Browser SPA (src/main.tsx → src/App.tsx)                              │
│    • state-driven view router                                          │
│    • Zustand store (single source of truth, partialize→localStorage)   │
│    • sync-defer.ts → idle-deferred Supabase init (bundle 17.67 kB gz)  │
│    • lazy-loaded tab/modal modules + admin-bundle + page-renderer      │
│    • PostHog (already wired) + Sentry per-platform                     │
│    • <TierGate>, <AdSlot> (firewall-gated), <SubscribeButton>          │
│    • Page Builder (dnd-kit, 8 semantic blocks + LeadForm + 3 embeds)   │
└──────────┬───────────────────────────────┬────────────────────────────┘
           │ supabase-js (PostgREST + Realtime + Storage + Edge)
           ▼                               ▼
┌────────────────────────────────┐  ┌──────────────────────────────────┐
│  Supabase ytnsipxxmzgaebkqmokp │  │  Stripe (Checkout + Connect)     │
│                                │  │  AdMob (via web stub; native     │
│  21 migrations (v1.2)          │  │    SDK wave deferred to v1.4 P16)│
│  8+ Edge Functions:            │  │  Anthropic (proxied via ai-chat) │
│   - ai-chat (gated by tier)    │  │  Resend (app.leanshot.app live;  │
│   - share, clinic-* (v1.1)     │  │    DKIM + DMARC p=quarantine)    │
│   - stripe-webhook,            │  │  PostHog (consent-gated)         │
│     stripe-checkout            │  │  Sentry (web shipped; mobile DSN │
│   - affiliate-attribute,       │  │    captured, defer to v1.4)      │
│     affiliate-impression,      │  └──────────────────────────────────┘
│     affiliate-apply,           │
│     affiliate-payout,          │  Stripe Connect Express              │
│     stripe-connect-onboard,    │   • affiliate single-tier $10 flat   │
│     partner-account-status     │   • W-9 / W-8BEN / 1099-NEC          │
│   - account-delete (cascade)   │   • unified provider via             │
│   - dsar-export                │     `tier_effective` view            │
│   - page-render (ISR-cached)   │                                      │
│   - photos-trash-purge         │  Vault: service_role_key (pending    │
│   - sitemap                    │    pass — affiliate-payout cron uses)│
│                                │                                      │
│  51 RLS deny policies          │                                      │
│  14 cron jobs (pg_cron)        │                                      │
└────────────────────────────────┘
```

**Hard constraints inherited from v1.2 that drive every v1.3 decision:**
- Local-first: app must work offline; cloud is the sync layer. (Org-aware data needs careful local-cache scoping — see Anti-pattern #1.)
- Bundle index ceiling: 50 kB gz (currently **17.67 kB**, comfortable). Heavy SDKs route through `sync-defer.ts`. New i18n + helpdesk + onboarding-builder are the next pressure points.
- RLS isolation: every new table OR Storage bucket gets a **live cross-tenant impersonation proof test** (project rule, reaffirmed in Phase 5/6/19/22). v1.3 introduces ORG-scoped RLS — second-axis tenancy needs a second-axis proof test.
- Realtime e2e assertions: use the receiving operator's `channel.subscribe()` directly. (Clinic dashboard + clinician notifications inherit this.)
- No ads on clinic / doctor-share / admin surfaces. EVER. v1.3 org dashboard inherits this — `currentSurface` check extends to org context.
- Two-tunnel firewall (HealthKit ↔ ads) — code-only stub today on web; v1.4 P18 hard-enforces with native. v1.3 must NOT regress the ESLint rule.
- Status-machine transition ownership rule (from Phase 19 BL-11): every status enum write needs an owning plan/task — applies to org_invites, ticket status, onboarding_response status, affiliate tier transitions.
- Vendor-gated send via health check (Phase 22 D-03) — Resend domain template applies to org-invite emails, clinician dose-trend alerts, helpdesk auto-reply, weekly Claude summary.
- `tier_effective` is the canonical tier source (P19 D-04). v1.3 multi-tier affiliate writes to `tier_effective` view shape; **do not invent a parallel tier table.**

---

## v1.3 Target Architecture — Layered View

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Surfaces (NEW + EXISTING)                                                  │
│                                                                             │
│  Marketing site         App SPA                Clinic SPA       Admin SPA   │
│  (leanshot.app)         (app.leanshot.app)     (NEW — same      (existing — │
│  + i18n /es /es-419?    + i18n locale switcher  bundle, org-    extended)   │
│  + variant landing      + paywall A/B variant   scoped view     + ticket    │
│    pages (Page Builder    component             branch in       inbox       │
│    A/B Vike pre-render) + pharma paywall gate   App.tsx)        + onboarding│
│  + multi-tier-aware     + helpdesk widget       + clinician-    flow editor │
│    /partners + tier      + onboarding flow      side roster +   + offer     │
│    progression CTA       (PostHog-variant      filters + drill- editor      │
│                          driven)                in + alerts +   + KB editor │
│                         + gamification          settings        + cohort    │
│                          (XP/streak/badges)                     builder     │
│                         + review prompt engine                              │
│                         + recommender (pgvector + Anthropic)                │
│       │                       │                       │             │       │
│       └───────────┬───────────┴───────────┬───────────┴─────────────┘       │
│                   ▼                       ▼                                 │
│  ┌──────────────────────────────────────────────┐                           │
│  │  NEW: Org context layer (src/lib/org.ts)     │                           │
│  │   • Detect: subdomain / path / member.org_id │                           │
│  │   • Inject into every supabase-js query      │                           │
│  │   • Surface check (clinic vs consumer)       │                           │
│  │   • White-label theme overlay (CSS vars)     │                           │
│  └──────────────────┬───────────────────────────┘                           │
└─────────────────────┼───────────────────────────────────────────────────────┘
                      │
                      ▼
┌────────────────────────────────────────────────────────────────────────────┐
│  Zustand store (EXISTING, EXTENDED)                                        │
│   src/lib/store.ts                                                         │
│   + new slices: org, orgMembership, orgSettings, helpdesk, onboarding,     │
│                 gamification, recommendations, i18n, abVariants,           │
│                 reviewPrompt, alerts                                       │
│   + persisted: locale, current_org_id (so reload restores org context);    │
│     NOT persisted: helpdesk drafts, recommendation cache, alert badges     │
│   + NEW org-scoped selectors: useOrg(), useIsClinician(), useOrgTier()     │
└──────────────────────────────┬─────────────────────────────────────────────┘
                               │  supabase-js (existing pattern, org-aware)
                               ▼
┌────────────────────────────────────────────────────────────────────────────┐
│  Supabase backend (EXISTING, EXTENDED)                                     │
│                                                                            │
│  NEW tables (organized by feature slab):                                   │
│   ── Clinic orgs (largest slab, 12+ tables) ──                             │
│   • organizations, org_members, org_invites, org_subscriptions             │
│   • org_subscription_usage_records, org_settings                           │
│   • org_patient_links (patient_id → org_id with consent_grant_id)          │
│   • org_consent_grants (revocable, audit-trailed)                          │
│   • org_audit_log (org-scoped; FK + RLS layered over global audit_logs)    │
│   • org_branding (white-label CSS vars, logo, color tokens)                │
│   • clinician_alerts (dose-trend triggered), alert_rules (per-org config)  │
│                                                                            │
│   ── Affiliate multi-tier (extends v1.2) ──                                │
│   • ALTER affiliates ADD COLUMN tier text                                  │
│         CHECK (tier IN ('standard','gold','lifetime')) DEFAULT 'standard'  │
│   • ALTER affiliates ADD COLUMN tier_changed_at timestamptz                │
│   • affiliate_tiers (config table: tier, commission_rate_pct,              │
│     payout_schedule_days, attribution_window_days, eligibility_rules_json) │
│   • affiliate_tier_history (audit trail of promotions/demotions)           │
│                                                                            │
│   ── A/B testing (paywall + page builder) ──                               │
│   • ALTER landing_pages ADD COLUMN variant_group_id uuid                   │
│   • landing_page_variants (page_id, variant_key, weight_pct, posthog_flag) │
│   • paywall_variants (variant_key, payload_json, posthog_flag, active)     │
│   • ab_exposures (user_id/anon_id, variant_key, exposed_at) — server-side  │
│                                                                            │
│   ── Ad ETL ──                                                             │
│   • ad_spend_facts (date, network, campaign_id, spend_cents,               │
│     impressions, clicks, currency) — partitioned by month                  │
│   • ad_spend_ingest_runs (network, run_at, status, rows_ingested, error)   │
│   • ad_attribution_join (anon_id/user_id ↔ ad_spend_facts.campaign_id      │
│     via UTM/click-id) — for true CAC join                                  │
│                                                                            │
│   ── i18n ──                                                               │
│   • locale_overrides (key, locale, value, surface) — admin-editable        │
│     overrides for the file-based i18next catalog                           │
│                                                                            │
│   ── Onboarding ──                                                         │
│   • onboarding_flows (id, name, active, audience_filter_json)              │
│   • onboarding_steps (flow_id, ordinal, step_type, config_json)            │
│   • onboarding_variants (flow_id, variant_key, posthog_flag, weight_pct)   │
│   • onboarding_responses (user_or_anon_id, step_id, response_json, ts)     │
│   • activation_events (user_id, event_name, occurred_at) — for funnel      │
│                                                                            │
│   ── Gamification ──                                                       │
│   • xp_ledger (user_id, delta, reason, source_id, ts) — append-only        │
│   • streak_state (user_id, current_streak, longest_streak, last_log_date,  │
│     freeze_tokens_available)                                               │
│   • freeze_tokens_ledger (user_id, delta, reason, ts) — append-only        │
│   • badges_earned (user_id, badge_key, earned_at)                          │
│   • weekly_challenges (id, week_start, config_json, active)                │
│   • leaderboard_entries (challenge_id, user_id, score, rank) — MAT VIEW    │
│     refreshed via pg_cron every 15 min                                     │
│                                                                            │
│   ── Review prompt engine ──                                               │
│   • review_prompts (id, trigger_rules_json, copy_json, active, version)    │
│   • review_prompt_responses (prompt_id, user_id, stage, response, ts)      │
│                                                                            │
│   ── AI recommender (pgvector) ──                                          │
│   • content_embeddings (content_id, content_type, embedding vector(1536),  │
│     model_version, embedded_at) — pgvector IVFFlat index                   │
│   • recommendation_runs (user_id, run_at, model_version, prompt_hash,      │
│     result_json, duration_ms)                                              │
│   • weekly_summary_log (user_id, week_start, summary_md, sent_at)          │
│                                                                            │
│   ── Helpdesk ──                                                           │
│   • tickets (id, requester_id, org_id?, subject, status, priority,         │
│     channel ['inapp','email'], assignee_id, csat_score)                    │
│   • ticket_messages (ticket_id, sender_type, sender_id, body_md, ai_draft) │
│   • ticket_attachments (ticket_id, storage_path, mime, size)               │
│   • ticket_tags (ticket_id, tag) — many-to-many via array OR junction      │
│   • kb_articles (slug, title, body_md, locale, published)                  │
│   • kb_article_versions (article_id, version, body_md, author_id, ts)      │
│   • csat_responses (ticket_id, score, comment, ts)                         │
│   • agent_macros (id, title, body_md, scope ['global','org'], org_id?)     │
│                                                                            │
│   ── Cancellation save offers ──                                           │
│   • cancellation_offers (id, name, eligibility_rules_json, offer_type,     │
│     discount_config_json, active)                                          │
│   • cancellation_offers_log (user_id, offer_id, shown_at, response,        │
│     converted_to_action, ts)                                               │
│                                                                            │
│   ── HIPAA hardening (extends v1.2 audit_logs) ──                          │
│   • audit_logs (EXISTING — extended with new event_type values)            │
│   • phi_access_log (user_id, accessed_user_id, accessed_org_id, access_   │
│     reason, ts) — clinical-context distinct from generic audit             │
│   • mfa_required_roles (role, required_at) — config table                  │
│   • subprocessors (vendor, baa_signed_at, baa_url, scope) — disclosure     │
│                                                                            │
│  NEW Edge Functions (~15 new; each = one bounded responsibility):          │
│   ── Clinic orgs ──                                                        │
│   • org-invite              — clinic creates patient invite → magic link   │
│   • org-patient-link        — accept-invite cascade + consent record       │
│   • org-billing-sync        — org_subscription ↔ Stripe (parallel customer)│
│   • org-usage-meter         — nightly per-active-patient roll-up           │
│   • clinician-dose-alert    — dose-trend rule eval → clinician_alerts ins  │
│                                                                            │
│   ── Multi-tier affiliate ──                                               │
│   • affiliate-tier-eval     — daily cron evaluates auto-promotion rules    │
│   • affiliate-tier-apply    — manual admin tier change (audited)           │
│                                                                            │
│   ── Ad ETL ──                                                             │
│   • ad-ingest-meta          — hourly cron: Meta Ads API → ad_spend_facts   │
│   • ad-ingest-google        — hourly cron: Google Ads API                  │
│   • ad-ingest-tiktok        — hourly cron: TikTok Ads API                  │
│   • ad-attribution-join     — nightly: join ad_spend × PostHog → true CAC  │
│                                                                            │
│   ── Helpdesk ──                                                           │
│   • helpdesk-email-ingest   — Resend Inbound webhook → tickets row insert  │
│   • helpdesk-ai-draft       — Anthropic-generated reply draft (agent UI)   │
│   • helpdesk-csat-send      — post-resolution CSAT email via Resend        │
│                                                                            │
│   ── Onboarding + gamification ──                                          │
│   • onboarding-merge        — anonymous cookie → user on auth (cascade)    │
│   • activation-event-eval   — server-side event landing (adblock-resistant)│
│   • leaderboard-refresh     — pg_cron-triggered MAT VIEW refresh           │
│   • weekly-challenge-eval   — Sunday cron rotates active challenge         │
│                                                                            │
│   ── AI recommender ──                                                     │
│   • embed-content           — nightly: new content → OpenAI/Voyage embed   │
│   • recommend-content       — on-demand: query user vector → top-K         │
│   • weekly-summary-claude   — Sunday cron: per-user Anthropic summary      │
│                                                                            │
│   ── i18n ──                                                               │
│   • i18n-override-fetch     — public read of locale_overrides (CDN-cache)  │
│                                                                            │
│   ── PostHog server-side ──                                                │
│   • posthog-capture-proxy   — server-side event landing (signup / payment  │
│                               / activation) — defeats adblock              │
│                                                                            │
│  NEW Storage buckets:                                                      │
│   • ticket-attachments (private; RLS by ticket.requester_id OR assignee)   │
│   • org-branding (private-per-org; RLS by org_id)                          │
│   • kb-assets (public; admin-write only)                                   │
│                                                                            │
│  NEW cron jobs (~10):                                                      │
│   • affiliate-tier-eval (daily 02:00 UTC)                                  │
│   • ad-ingest-* (hourly :00)                                               │
│   • ad-attribution-join (nightly 03:00 UTC)                                │
│   • org-usage-meter (nightly 23:00 UTC; Stripe meter event emitted)        │
│   • clinician-dose-alert (every 30 min)                                    │
│   • leaderboard-refresh (every 15 min)                                     │
│   • weekly-challenge-eval (Sunday 00:00 UTC)                               │
│   • embed-content (nightly 04:00 UTC)                                      │
│   • weekly-summary-claude (Sunday 12:00 UTC, user-locale-aware)            │
│   • helpdesk-csat-send (every 30 min — closed tickets 24h+ ago)            │
│                                                                            │
│  EXTENDED extensions:                                                      │
│   • pgvector (NEW) — content embeddings, recommender                       │
│   • pg_cron (EXISTING) — extended with 10 new schedules                    │
│   • pg_partman (NEW) — for ad_spend_facts monthly partitioning             │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## Component Responsibilities

### NEW Components

| Component | Responsibility | Location | Talks to |
|-----------|----------------|----------|----------|
| **Org context provider** | Resolves current org from subdomain/path/membership; injects into all queries; surface gating | `src/lib/org.ts` + `src/components/org/OrgProvider.tsx` | Zustand `org` slice, supabase-js |
| **Clinic dashboard shell** | Org-scoped roster + drill-in + filters + settings + billing | `src/components/clinic/*` (lazy `clinic-bundle`) | `org_*` tables, org-scoped RLS |
| **Patient invite flow** | Clinician creates patient → magic link → onboard under org context | `src/components/clinic/InvitePatient.tsx` + `org-invite` Edge Fn | `org_invites`, `org_patient_links`, Resend |
| **Org billing settings** | Per-org Stripe customer; per-active-patient meter; admin can view invoices/cards | `src/components/clinic/billing/*` | `org_subscriptions`, `org-billing-sync` Edge Fn |
| **Clinician alerts inbox** | List of dose-trend alerts; ack/dismiss; route to patient drill-in | `src/components/clinic/AlertsInbox.tsx` | `clinician_alerts` (Realtime channel `org:${org_id}:alerts`) |
| **Alert rule editor** | Per-org configurable thresholds + custom rank weights (JSONB) | `src/components/clinic/settings/AlertRules.tsx` | `alert_rules`, `org_settings` |
| **i18n bootstrap** | `react-i18next` init + locale detection (query > Accept-Language > default) + namespace lazy-load | `src/lib/i18n/index.ts` + locale catalogs under `src/locales/{en,es}/*.json` | `locale_overrides` (admin overrides), `i18n-override-fetch` |
| **Locale switcher** | UI to toggle locale; persists to `users.preferred_locale` + Zustand | `src/components/settings/LocaleSwitcher.tsx` | Zustand `i18n` slice |
| **Paywall variant component** | Reads PostHog flag → renders variant payload (copy/price/CTA) | `src/components/billing/PaywallVariant.tsx` | PostHog + `paywall_variants` |
| **Page-builder variant resolver** | At render time, `page-render` Edge Fn picks variant per visitor (PostHog flag) | EXTENDED `page-render` Edge Fn | `landing_page_variants`, PostHog server |
| **Pharma paywall gate** | Wraps pharmacology surfaces; gates on `tier_effective.has_active` | `src/components/billing/PharmaGate.tsx` | `tier_effective` view |
| **Onboarding flow renderer** | Renders steps dynamically from `onboarding_steps`; variant via PostHog | `src/components/onboarding/v2/FlowRenderer.tsx` | `onboarding_flows/steps/variants/responses` |
| **Onboarding flow editor (admin)** | Drag-and-drop step builder for admins (mirrors Page Builder pattern) | `src/components/admin/onboarding/FlowEditor.tsx` (lazy `admin-bundle`) | `onboarding_flows/steps` |
| **Gamification overlay** | XP toasts, streak ring on dashboard, freeze-token UI, badge unlocks | `src/components/gamification/*` (uses DS-10 illustrations from v1.2) | Zustand `gamification` slice; `xp_ledger`, `streak_state` |
| **Leaderboard view** | Cohort-scoped (NOT global — privacy) leaderboard for weekly challenge | `src/components/gamification/LeaderboardView.tsx` | `leaderboard_entries` MAT VIEW |
| **Review prompt engine** | Two-stage NPS gating: internal score → external review OR feedback ticket | `src/components/feedback/ReviewPrompt.tsx` | `review_prompts/responses`, helpdesk `tickets` |
| **Helpdesk widget** | In-app ticket creation + ticket list + message thread; lazy `helpdesk-bundle` | `src/components/helpdesk/*` | `tickets`, `ticket_messages`, `ticket-attachments` bucket |
| **Helpdesk agent UI (admin)** | Agent inbox + macros + AI draft + CSAT | `src/components/admin/helpdesk/*` (lazy `admin-bundle`) | All ticket tables |
| **KB article browser** | Public KB; locale-aware; renders markdown | `src/components/kb/*` (server-rendered via NEW `kb-render` Edge Fn for SEO) | `kb_articles` |
| **Recommender feed** | "For you" content list on dashboard | `src/components/recommendations/Feed.tsx` | `recommend-content` Edge Fn |
| **Weekly summary email** | Claude-generated weekly summary, locale-aware | `weekly-summary-claude` Edge Fn → Resend | Anthropic, Resend, `weekly_summary_log` |
| **Cancellation save offer** | Mid-cancel: shows targeted offer; logs response; allows continue-cancel | `src/components/billing/CancellationFlow.tsx` | `cancellation_offers`, `cancellation_offers_log`, Stripe Customer Portal |
| **Offer editor (admin)** | Admin UI for save offer rules | `src/components/admin/offers/OfferEditor.tsx` | `cancellation_offers` |
| **MFA enforcer** | Hook + route guard: clinician/admin roles require MFA enrolled | `src/lib/auth/mfa-guard.ts` + `src/components/auth/MfaEnroll.tsx` | Supabase Auth MFA APIs |
| **Subprocessor disclosure page** | Public legal page listing BAA-covered subprocessors | `src/components/legal/Subprocessors.tsx` | `subprocessors` table |
| **PostHog server-capture client** | Wraps `posthog.capture()` to fall through to `posthog-capture-proxy` Edge Fn for adblock-resistance | `src/lib/analytics.ts` (extended) | `posthog-capture-proxy` Edge Fn |
| **Event taxonomy catalog** | Single TS module enumerating all canonical events; type-safe | `src/lib/analytics/events.ts` | (consumed by analytics call sites + admin cohort builder) |
| **Modular admin shell** | Pluggable admin route registry; per-module permission check | `src/components/admin/shell/AdminShell.tsx` (extends v1.2 admin) | `admin_modules` table + Edge Fn permission check |
| **Bulk admin actions** | CSV upload, bulk tag, bulk comp, bulk ban, bulk force-reset | `src/components/admin/bulk/*` | Edge Fns per action; all audited |
| **Cohort builder** | Admin UI to filter users by event sequence + properties → cohort | `src/components/admin/cohorts/CohortBuilder.tsx` | PostHog cohort sync OR direct SQL → `audit_logs` |

### MODIFIED v1.2 components

| Component | What changes | Why |
|-----------|--------------|-----|
| `src/lib/store.ts` | Add 11 new slices (org, orgMembership, orgSettings, helpdesk, onboarding, gamification, recommendations, i18n, abVariants, reviewPrompt, alerts); persist `current_org_id` + `preferred_locale` | Domain extension |
| `src/App.tsx` | Add view branches: `/clinic` (org-scoped), `/helpdesk`, `/admin/onboarding`, `/admin/offers`, `/admin/cohorts`, `/admin/helpdesk`, `/admin/affiliate-tiers`, `/recommendations`; locale prefix routing (`/es/...`?) | New surfaces; deferred decision: locale routing strategy |
| `src/lib/sync-defer.ts` | Add deferred-init for: i18next async backend, helpdesk SDK if any, recommender client | Bundle ceilings |
| `vite.config.ts` | New `manualChunks`: `clinic-bundle`, `helpdesk-bundle`, `i18n-{en,es}`, `recommender-bundle`, `admin-{onboarding,offers,cohorts,helpdesk,affiliate}` | Per-chunk gates |
| `src/lib/storage.ts` | New persisted keys (selectively); STILL no PII beyond user_id; org context cleared on logout | Persistence extension |
| Existing `stripe-webhook` Edge Fn | Extend to handle org-subscription customer namespace (separate `customer_id`); affiliate tier change events | Multi-tenant billing |
| Existing `affiliate-attribute` Edge Fn | Look up affiliate's current `tier` from `affiliates.tier` → commission rate from `affiliate_tiers` config | Multi-tier commission |
| Existing `affiliate-payout` Edge Fn | Compute commission using `affiliate.tier` not flat $10; record tier in payout ledger | Multi-tier payout |
| Existing `account-delete` Edge Fn | Extend cascade: remove from org_members; if user is org owner → block with explicit transfer-or-delete-org flow; revoke ticket access | Org cascade |
| Existing `page-render` Edge Fn | Resolve `landing_page_variants` per visitor via PostHog flag eval | A/B page builder |
| Existing `ai-chat` Edge Fn | Inject org-context system prompt when user has org_id; log PHI access | HIPAA + B2B |
| Existing `dsar-export` Edge Fn | Include org_member rows + ticket history + onboarding responses + alert history | New tables |
| Existing `audit_logs` table | Add new event_type enum values (org-*, ticket-*, alert-*, mfa-*, phi-access) | HIPAA |
| Existing Page Builder | Add `LeadFormBlock` (already shipped v1.2); add `KbExcerptBlock`, `PartnerLogoStripBlock`, `LocaleSelectorBlock` v1.3 candidates | New block types |
| Existing PostHog config | Enable session replay PII masking (all text in `[data-phi]` regions masked); add server-side capture for signup/payment/activation; cohort sync | Privacy + adblock-resistance |
| Existing CSP | Allow Resend Inbound webhook origin, OpenAI/Voyage embedding API (for embed-content), ad-network APIs | New integrations |
| Existing `OrgProvider` wrap | NEW root-level provider in `src/App.tsx` BEFORE existing user provider | Org context flows down |

### COMPONENTS THAT DO NOT CHANGE

- `src/lib/pharmacology.ts` — clinical math stable (Core Value).
- `src/lib/insights.ts` — rule engine stable.
- `src/components/dashboard/tabs/*.tsx` — content stable; only wrapped by PharmaGate or gamification overlay.
- v1.2 design system (Phase 13) — locked; v1.3 reuses tokens + DS-10 illustrations for gamification.
- v1.2 Edge Fns: `share`, `clinic-invite` (v1.1), `clinic-photo`, `clinic-snapshot`, `patient-activity`, `bulk-csv-export`, `affiliate-impression`, `affiliate-apply`, `stripe-connect-onboard`, `partner-account-status`, `photos-trash-purge`, `sitemap` — leave alone.
- v1.2 Two-tunnel firewall ESLint rule — keep; don't weaken.

---

## Critical Architectural Decisions

### 1. Clinic Organizations — Org-scoped multi-tenancy as a SECOND RLS axis (largest new surface)

**Confidence: MEDIUM-HIGH.** Pattern is industry-standard SaaS multi-tenancy; novelty is layering it on a code base that today assumes user-scoped RLS.

**The pattern:** Two-axis RLS — every org-scoped table has BOTH `user_id` filtering (where applicable) AND `org_id` filtering. The Phase 19 status-machine rule and the project's "live cross-tenant impersonation proof test" rule extend: **every new org-scoped table needs a cross-ORG proof test in addition to the cross-USER proof test.**

```
   ┌─────────────────────────────────────────────────────────────┐
   │  organizations                                              │
   │  ─ id, slug, name, plan, stripe_customer_id_org (separate   │
   │    namespace from user.stripe_customer_id)                  │
   │  ─ status (active | suspended | deleted)                    │
   │  ─ baa_signed_at, baa_signed_by_member_id                   │
   └───┬─────────────────────────────────────────────────────────┘
       │ 1:N
       ▼
   ┌──────────────────────────────────────────────────────────────┐
   │  org_members (the org RLS pivot)                             │
   │  ─ org_id, user_id, role enum (owner/admin/clinician/staff)  │
   │  ─ invited_by_user_id, invited_at, joined_at, removed_at     │
   │  ─ UNIQUE(org_id, user_id) — one membership per pair         │
   └──────────────────────────────────────────────────────────────┘
       │
       │  RLS predicate template (used by all org-scoped tables):
       │
       │  USING (
       │    org_id IN (
       │      SELECT org_id FROM org_members
       │      WHERE user_id = auth.uid()
       │        AND removed_at IS NULL
       │    )
       │  )
       │
       │  + role-gated mutation policies:
       │  - INSERT/DELETE require role IN ('owner','admin')
       │  - Clinician role = read+write on patient data ONLY
       │    if (org_id, patient_user_id) ∈ org_patient_links
       │    AND consent_grant.revoked_at IS NULL
       │
       ▼
   ┌──────────────────────────────────────────────────────────────┐
   │  org_patient_links                                           │
   │  ─ org_id, patient_user_id, consent_grant_id, status         │
   │  ─ ON DELETE CASCADE consent_grant.revoked_at SET            │
   │                                                              │
   │  → The patient sees: "Dr. Foo's Clinic has access to your    │
   │     data" with a [Revoke] button → sets revoked_at → RLS     │
   │     stops returning data to clinic queries instantly.        │
   └──────────────────────────────────────────────────────────────┘
```

**Why a separate `org_patient_links` consent record (not just membership):**
- Patient must be able to revoke clinic access WITHOUT deleting their account.
- Revocation must be instant and auditable (HBNR + WMHMDA).
- A clinician's `org_members` row stays; the consent grant is what RLS reads.

**Why `stripe_customer_id_org` is a SEPARATE column (not the same as `users.stripe_customer_id`):**
- An org owner is also a consumer with their own subscription. ONE Stripe customer cannot cleanly carry both invoices.
- Reuses Phase 19's `tier_effective` lesson: multiple provider/subscription namespaces are real; the schema must model them.
- Org subscription billing flows through `org-billing-sync` Edge Fn — a NEW handler in `stripe-webhook` (not a new webhook endpoint; same URL, dispatch by metadata.kind='org').

**Per-active-patient metering:**
- `org-usage-meter` Edge Fn runs nightly at 23:00 UTC.
- Counts distinct `patient_user_id` in `org_patient_links` WHERE `org_id=$` AND `consent_grant.revoked_at IS NULL` AND `patient` logged at least one event in the prior month.
- Emits Stripe Meter Event (Stripe billing 2024 spec): `meter='active_patients', value=N, customer=org.stripe_customer_id_org, timestamp=now`.
- Idempotency: use `idempotency_key=org_id||YYYYMM` so re-runs don't double-count.

**White-label theming:**
- `org_branding` table holds CSS-variable overlays + logo asset path.
- App boot reads `org_branding` for current org; injects `:root` style block before first paint.
- Subdomain detection (`{clinic-slug}.app.leanshot.app`) requires wildcard cert on `*.app.leanshot.app` (already configured in v1.2) OR path-based (`/clinic/{slug}/*`) — **recommendation: PATH-based for v1.3, subdomain-based deferred to v1.4 or v1.5** (each subdomain adds DNS + SSL + Capacitor universal-link complexity).

**Trade-off accepted:** Path-based white-label means URLs say `app.leanshot.app/clinic/acme/dashboard` not `acme.leanshot.app`. Less prestigious for clinics; far simpler to ship.

### 2. HIPAA Audit-Log Hardening — EXTEND v1.2 `audit_logs`, do NOT replace

**Confidence: HIGH** on the doctrine (extend); **MEDIUM** on the exact schema additions (regulator audience — Phase planning will refine).

**The doctrine:** v1.2 `audit_logs` is already substantial (51 RLS deny policies enforce coverage; cascade DELETE has the `app.suppress_audit` GUC; 7-year retention rule). v1.3 does NOT introduce a parallel "hipaa_audit_logs" — it extends:

1. **New event_type enum values** (additive only — never remove): `org_member_added`, `org_member_removed`, `org_invite_sent`, `org_invite_accepted`, `consent_granted`, `consent_revoked`, `phi_accessed_by_clinician`, `phi_exported`, `mfa_enrolled`, `mfa_required_failed_login`, `subprocessor_added`, `ticket_phi_attached`.

2. **NEW `phi_access_log` table** (distinct from generic `audit_logs`) — required by HIPAA Security Rule §164.312(b) (audit controls) and §164.308(a)(1)(ii)(D) (information system activity review). Tracks every clinician → patient data access with reason code. Separate table because:
   - Different retention (PHI-access log MUST be reviewed periodically; generic audit log isn't).
   - Different RLS (org admins can review their org's phi_access; can't see other orgs').
   - Different reporting (HIPAA risk assessment reads from this; ops dashboards from audit_logs).

3. **MFA enforcement:** v1.2 supports MFA via Supabase Auth but doesn't require it. v1.3 introduces `mfa_required_roles` config table + a `mfa-guard` hook that blocks clinician/admin route entry until MFA enrolled. Login flow inserts `audit_logs` row.

4. **Subprocessor disclosure:** `subprocessors` table populated at v1.3 launch (Supabase, Vercel, Stripe, Resend, Anthropic, OpenAI/Voyage, PostHog, Sentry). Public legal page renders this. BAA signing dates tracked.

5. **Encryption posture:** Supabase Postgres encrypts at rest by default (HIGH confidence — Supabase official). Storage buckets for clinic content (`ticket-attachments`, `org-branding`) MUST be private + signed-URL only — **no public buckets for PHI-adjacent content**.

**What we are NOT doing in v1.3:**
- pgsodium envelope encryption (deprecated per Phase 7 research findings).
- BAA-signed Resend swap (v1.2 has Resend; if HIPAA chain requires alt vendor — Paubox / AWS SES — that's a v1.3 mid-milestone vendor swap; the `send-email-internal` abstraction shipped in v1.2 supports vendor switching with zero code-site changes).
- Field-level encryption on patient PHI (Supabase column-level encryption only via Vault — not appropriate for queryable PHI fields; rely on encryption-at-rest + RLS).

### 3. Multi-Tier Affiliate — EXTEND v1.2 `affiliates` table, do NOT migrate to parallel schema

**Confidence: HIGH.**

**The pattern:** ALTER TABLE on the existing `affiliates`; introduce `affiliate_tiers` config table; cron evaluates promotion rules; admin can manually override (audited).

**Schema delta:**
```sql
ALTER TABLE affiliates
  ADD COLUMN tier text NOT NULL DEFAULT 'standard'
  CHECK (tier IN ('standard', 'gold', 'lifetime'));
ALTER TABLE affiliates
  ADD COLUMN tier_changed_at timestamptz DEFAULT now();

CREATE TABLE affiliate_tiers (
  tier text PRIMARY KEY,
  commission_rate_pct numeric NOT NULL,
  payout_schedule_days int NOT NULL,
  attribution_window_days int NOT NULL,
  eligibility_rules_json jsonb NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true
);

INSERT INTO affiliate_tiers VALUES
  ('standard',  20, 30, 30, '{"min_referrals": 0}', true),
  ('gold',      30, 30, 60, '{"min_referrals": 25, "min_30d_revenue_usd": 500}', true),
  ('lifetime',  40, 30, 365, '{"hand_picked": true}', true);

CREATE TABLE affiliate_tier_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id uuid REFERENCES affiliates(id),
  from_tier text, to_tier text,
  changed_by_user_id uuid,  -- null for cron
  reason text NOT NULL,      -- 'auto:eligibility_met' | 'admin:promoted' | 'auto:demoted_inactivity'
  ts timestamptz DEFAULT now()
);
```

**Status-machine ownership (per Phase 19 BL-11 rule):**
- `affiliate-tier-eval` cron writes promotions.
- `affiliate-tier-apply` Edge Fn (admin-gated) writes manual changes.
- `affiliate-payout` Edge Fn READS `affiliate.tier` to compute commission.
- NEVER write `affiliate.tier` outside these three call sites.

**Commission computation lives in ONE place** (`computeCommission(affiliate_id, conversion_amount_cents)` in `_shared/affiliate-commission.ts`) — both `affiliate-payout` and admin preview UI call it.

### 4. Ad Spend ETL — Hourly cron per network, monthly-partitioned facts table

**Confidence: MEDIUM** on partitioning strategy (industry pattern); HIGH on cron + Edge Fn shape.

**The pattern:**
- `ad_spend_facts` is a wide fact table; partition monthly via `pg_partman` (new extension).
- One Edge Fn per network (Meta / Google / TikTok) — keeps API auth + rate-limit + schema-mapping per-network.
- Hourly cron at `:00` triggers all three in parallel (PostgreSQL `pg_cron` schedule).
- Nightly `ad-attribution-join` reads `ad_spend_facts` × PostHog click-data (UTM + `gclid`/`fbclid`/`ttclid`) → computes true CAC, writes to materialized `cac_by_source_daily` view.

**Why partitioning:** facts table grows ~5k rows/day across all networks; after 12 months = 1.8M rows. Without partitioning, recent-month queries scan everything. With monthly partitions + `BRIN` index on `date`, queries stay sub-100ms.

**Why a join table NOT direct attribution in `affiliate_conversions`:** Affiliate is one CAC source; paid ads are another. Keeping them in separate slabs prevents cross-domain coupling.

### 5. i18n — `react-i18next` + file-based catalogs + admin-editable DB overrides

**Confidence: HIGH.** `react-i18next` is the dominant React i18n; LinguiJS is the only serious alternative.

**The pattern:**
```
                       ┌─────────────────────────────────┐
                       │  src/locales/{en,es}/*.json     │
                       │  ─ Namespaced by surface:       │
                       │    common, marketing, app,      │
                       │    clinic, billing, emails      │
                       │  ─ Lazy-loaded per namespace    │
                       └──────────────┬──────────────────┘
                                      │
                                      ▼
                       ┌─────────────────────────────────┐
                       │  i18next runtime                │
                       │  ─ Loads locale from:           │
                       │    1. ?lang= query (highest)    │
                       │    2. users.preferred_locale    │
                       │    3. Accept-Language header    │
                       │    4. 'en' default              │
                       └──────────────┬──────────────────┘
                                      │
                                      ▼
                       ┌─────────────────────────────────┐
                       │  Admin override layer           │
                       │  ─ locale_overrides table       │
                       │  ─ Edge Fn i18n-override-fetch  │
                       │    (CDN-cached, 5-min TTL)      │
                       │  ─ Applied on top of file       │
                       │    catalog at merge time        │
                       └─────────────────────────────────┘
```

**Locale routing decision: query param + user-preference, NOT subdomain or path prefix.**
- `?lang=es` (highest precedence; for shared/marketing links).
- Persists to `users.preferred_locale` on auth.
- Page Builder published landing pages can specify `locale` in slug metadata; `page-render` Edge Fn resolves accordingly.
- **Why not `/es/...` path prefix:** Forces every Vercel rewrite rule to double (existing 7 rules → 14); breaks existing SPA fallback; complicates Capacitor universal links (v1.4). Defer path-prefix to v1.5+ if SEO research demands it.
- **Why not `es.leanshot.app` subdomain:** Same DNS/SSL complexity; defer.

**Transactional emails (Resend templates):** Each template has `template_es` variant; `send-email-internal` reads recipient's `preferred_locale` and picks template. Resend domain `app.leanshot.app` is locale-agnostic (no separate `es.app.leanshot.app` subdomain).

### 6. AI Recommender — pgvector inside Supabase, on-demand recommend Edge Fn

**Confidence: MEDIUM.** pgvector is mature; the open question is embedding model choice and re-embedding cadence.

**The pattern:**
- `content_embeddings` table with `embedding vector(1536)` (OpenAI ada-002 dim) OR `vector(1024)` (Voyage AI dim — cheaper).
- IVFFlat index for ANN search.
- Nightly `embed-content` cron: fetch new content rows → call OpenAI/Voyage embedding API → upsert into `content_embeddings`.
- On-demand `recommend-content` Edge Fn: takes `user_id` → constructs user "interest vector" from recent activity (XP events, viewed content, logged symptoms) → ANN query → returns top-K with rationale.
- `recommendation_runs` logs every call for evaluation.
- **NEW** PR check / CI: assert `pgvector` extension is enabled in migration (use `[[reference-supabase-db-query-linked]]` pattern).

**Why pgvector NOT a dedicated vector DB (Pinecone, Weaviate):**
- Embeds are user-PHI-adjacent (interest vector derived from logged symptoms). Keeping in Supabase = same RLS surface + same BAA chain (one fewer subprocessor).
- Volume is small (~10k content items × 1536 dims = ~60 MB).
- pgvector latency at this scale is sub-50ms.

**Weekly summary:** `weekly-summary-claude` Edge Fn — Sunday cron, per user, reads last week's activity + recommendations → Anthropic Claude → generates markdown summary → sends via Resend (locale-aware) → logs to `weekly_summary_log`.

### 7. Helpdesk — Ticket schema + Resend Inbound for email-to-ticket + Anthropic AI draft

**Confidence: MEDIUM.** Pattern is standard helpdesk (Zendesk-style); novelty is keeping it in-house instead of buying.

**The pattern:**
```
   ┌──────────────────────┐         ┌──────────────────────────────────┐
   │ In-app widget        │         │ Email → noreply@app.leanshot.app │
   │ User clicks "Help"   │         │ (Resend Inbound parsing)         │
   │ → POST /tickets      │         │ → Resend → helpdesk-email-ingest │
   └──────────┬───────────┘         │   Edge Fn webhook                │
              │                     └──────────────┬───────────────────┘
              ▼                                    │
   ┌─────────────────────────────────────────────────────────────┐
   │ tickets row insert (status='open', channel)                 │
   │ ticket_messages row insert (sender_type='user')             │
   │ Realtime broadcast → agent inbox                            │
   └──────────────┬──────────────────────────────────────────────┘
                  │
                  ▼
   ┌─────────────────────────────────────────────────────────────┐
   │ Agent (admin) opens ticket in /admin/helpdesk               │
   │ Clicks "AI draft" → helpdesk-ai-draft Edge Fn               │
   │   - Reads ticket history + matching kb_articles             │
   │   - Anthropic Claude → markdown reply                       │
   │   - Returns to UI as suggested draft (NOT auto-sent)        │
   │ Agent edits + sends → ticket_messages + Resend send         │
   └──────────────┬──────────────────────────────────────────────┘
                  │
                  ▼
   ┌─────────────────────────────────────────────────────────────┐
   │ On ticket close → helpdesk-csat-send cron (24h later)       │
   │   Sends CSAT email via Resend → user clicks 1-5 → csat_     │
   │   responses row insert                                      │
   └─────────────────────────────────────────────────────────────┘
```

**Resend Inbound:** Resend supports inbound webhooks (verified — Resend docs current as of milestone open). Configure MX records on `support.app.leanshot.app` → Resend → webhook to `helpdesk-email-ingest`. Avoids running our own SMTP server.

**PHI in tickets:** If user pastes PHI into a ticket, log `ticket_phi_attached` event in `audit_logs`. Attachments in `ticket-attachments` bucket — private + RLS. Org-scoped tickets (clinician opens ticket on behalf of patient) inherit org RLS.

### 8. Onboarding overhaul — Schema-driven flows with anonymous → user merge

**Confidence: HIGH.**

**The pattern:**
```
   1. Anonymous visitor lands on /onboarding (or marketing CTA)
        ↓
   2. Server-side: assign anon_id cookie (HttpOnly, 30d)
        ↓
   3. Onboarding flow resolved:
      - SELECT * FROM onboarding_flows WHERE active = true
      - Variant via PostHog flag → onboarding_variants → flow override
        ↓
   4. Each step renders from onboarding_steps.config_json:
      - Step types: 'welcome', 'value-preview', 'auth', 'goals',
        'meds', 'first-injection', 'health-import-prompt', etc.
        ↓
   5. Each response → onboarding_responses row (anon_id OR user_id)
        ↓
   6. At 'auth' step: user signs up → onboarding-merge Edge Fn:
      - UPDATE onboarding_responses SET user_id = new_user_id
        WHERE anon_id = cookie
      - Cookie cleared
        ↓
   7. On flow completion → activation_events row (event='onboarding_completed')
      - Server-side capture to PostHog (adblock-resistant)
        ↓
   8. activation-event-eval cron compares user activity to activation
      definition → activation_events row when defined criteria met
```

**Why server-side activation event:** PostHog client capture is adblock-eaten ~30% of the time. The activation event is THE conversion metric — it must be reliable. Server-side via `posthog-capture-proxy` Edge Fn (LeanShot's own domain → never blocked).

### 9. Gamification — Append-only ledgers + materialized leaderboard

**Confidence: HIGH** on the ledger pattern (standard); MEDIUM on the leaderboard refresh cadence (15 min is a guess).

**The pattern:**
- `xp_ledger` is append-only — every XP event inserts a delta with a reason.
- `streak_state` is a single row per user — read-modify-write under SERIALIZABLE isolation OR optimistic concurrency.
- `freeze_tokens_ledger` is append-only (same as xp).
- `leaderboard_entries` is a MAT VIEW refreshed every 15 min via pg_cron (`leaderboard-refresh`) — sufficient freshness for cohort-scoped weekly challenge.
- `badges_earned` inserted once per (user, badge_key).

**Why ledger NOT mutable balance:** Audit + recovery + future "show XP history" UI. Reads compute balance via `SUM(delta)` — fast with index on `(user_id, ts)`.

**Why cohort-scoped leaderboard:** Privacy — global leaderboard would expose user count + activity level publicly. Cohort = users who joined the same weekly challenge.

### 10. Modular Admin Shell + Bulk Actions + Event Taxonomy

**Confidence: MEDIUM.** Pattern is sound; ~60% of M1 already shipped in v1.2 Phase 22.

**The pattern:**
- `AdminShell.tsx` exposes a registry: modules register routes + nav entries + required permission.
- Per-module permission check happens in Edge Fn (e.g., `admin-helpdesk-action`) — frontend gating is cosmetic; backend enforces.
- `admin_modules` table seeded with module IDs; per-admin permission check against `admin_module_permissions`.
- Bulk actions ALL go through Edge Fns (CSV upload → S3-like Storage → trigger Edge Fn → process async → audit_logs entries per action).
- Event taxonomy lives in `src/lib/analytics/events.ts` — single source of truth; PostHog cohort builder reads from this catalog.

---

## Data Flow Diagrams

### Org-onboarding flow (clinic invites patient)

```
   Clinic admin (org member, role='admin') in /clinic/patients/new
        ↓
   Fill form: patient email + initial-context note
        ↓
   POST → org-invite Edge Fn
        ↓
   ┌────────────────────────────────────────────────────────┐
   │ org-invite                                             │
   │ 1. Verify caller is org_members WHERE role IN (admin,  │
   │    owner) AND removed_at IS NULL                       │
   │ 2. INSERT org_invites (org_id, email, token, expires)  │
   │ 3. Generate magic-link URL with token                  │
   │ 4. Send via Resend (locale-aware; org-branded template │
   │    if org_branding present)                            │
   │ 5. audit_logs: event_type='org_invite_sent'            │
   └────────────────────────────────────────────────────────┘
        ↓
   Patient receives email → clicks magic link
        ↓
   GET /accept-invite?token=...
        ↓
   ┌────────────────────────────────────────────────────────┐
   │ org-patient-link                                       │
   │ 1. Verify token, not expired                           │
   │ 2. If patient already has account → skip auth          │
   │ 3. Else: render minimal sign-up (passwordless)         │
   │ 4. On auth success:                                    │
   │    a. INSERT org_consent_grants (revocable)            │
   │    b. INSERT org_patient_links (org_id, patient_user_  │
   │       id, consent_grant_id)                            │
   │    c. UPDATE org_invites SET accepted_at=now()         │
   │    d. audit_logs: event_type='consent_granted'         │
   │ 5. Realtime broadcast → clinic dashboard updates       │
   │ 6. Redirect patient to /onboarding (NEW v1.3 flow,     │
   │    org-context inserted into Zustand)                  │
   └────────────────────────────────────────────────────────┘
        ↓
   Patient onboarding completes → activation_events row →
   clinic-dashboard count increments
```

### Multi-tier affiliate promotion (auto + manual)

```
   Daily cron 02:00 UTC: affiliate-tier-eval
        ↓
   For each affiliate WHERE tier != 'lifetime':
   ┌────────────────────────────────────────────────────────┐
   │ Evaluate affiliate_tiers.eligibility_rules_json        │
   │ against last-30d affiliate_conversions stats           │
   │   • count(confirmed)                                   │
   │   • SUM(commission_amount_cents)                       │
   │ If next-tier eligible:                                 │
   │   UPDATE affiliates SET tier=<next>, tier_changed_at=  │
   │   INSERT affiliate_tier_history (reason='auto:promo')  │
   │   Send congrats email via Resend                       │
   │   audit_logs entry                                     │
   └────────────────────────────────────────────────────────┘

   Manual (admin UI): /admin/affiliate-tiers
        ↓
   Admin selects affiliate + new tier + reason
        ↓
   POST → affiliate-tier-apply Edge Fn
        ↓
   ┌────────────────────────────────────────────────────────┐
   │ 1. Verify caller is admin (admin_module_permissions)   │
   │ 2. UPDATE affiliates SET tier=$, tier_changed_at=now() │
   │ 3. INSERT affiliate_tier_history (reason='admin:...')  │
   │ 4. audit_logs entry                                    │
   │ 5. If demotion: send email; if promotion: congrats     │
   └────────────────────────────────────────────────────────┘

   At next conversion (existing flow):
        ↓
   stripe-webhook → affiliate-payout schedule
        ↓
   computeCommission(affiliate_id, amount) reads CURRENT tier
   → applies affiliate_tiers.commission_rate_pct
   → records in payouts.tier_at_payout (for audit)
```

### Clinician dose-trend alert

```
   pg_cron every 30 min: clinician-dose-alert
        ↓
   For each org WHERE active AND has alert_rules:
   ┌────────────────────────────────────────────────────────┐
   │ For each (org_patient_links.patient_user_id):          │
   │   Read patient injection history (last 14d)            │
   │   Evaluate alert_rules.json against patterns:          │
   │     • missed dose >24h overdue                         │
   │     • dose change >50% week-over-week                  │
   │     • side-effect severity ≥7 logged                   │
   │     • custom rank-weight threshold breached            │
   │   If trigger met AND no existing unack alert this week:│
   │     INSERT clinician_alerts (org_id, patient_user_id,  │
   │       alert_type, severity, payload_json)              │
   │     Realtime broadcast: channel `org:${org_id}:alerts` │
   │     If severity='high': send email to org_members with │
   │       role IN (clinician, admin) (locale-aware via     │
   │       preferred_locale; org-branded template)          │
   │     audit_logs: event_type='clinician_alert_emitted'   │
   └────────────────────────────────────────────────────────┘
        ↓
   Clinician opens /clinic/alerts → sees inbox (Realtime live)
   Acks alert → UPDATE clinician_alerts SET acked_at, acked_by
   Drills into patient → phi_access_log row INSERT
```

### A/B paywall variant flow

```
   User reaches mid-trial paywall trigger
        ↓
   <PaywallVariant flag="mid_trial_paywall_v1">
        ↓
   Client reads PostHog flag value → variant_key (e.g., 'A', 'B', 'control')
        ↓
   Look up paywall_variants WHERE variant_key=$ AND active=true
        ↓
   Render variant.payload_json (copy, price ID, CTA text, image)
        ↓
   INSERT ab_exposures (user_id, variant_key, exposed_at='mid_trial_paywall_v1:A')
   posthog.capture('paywall_exposed', { variant: 'A' })
        ↓
   User converts → standard SubscribeButton flow
   stripe-webhook on subscription created:
        ↓
   Reads ab_exposures WHERE user_id=$ AND variant='mid_trial_paywall_v1:*'
   posthog.capture('paywall_converted', { variant: ..., latency_ms })
```

---

## Suggested Build Order (architectural-dependency-driven)

**Critical-path dependencies:**

```
[Foundation] ─┬─→ [Event taxonomy + PostHog server-side capture]
              │
              ├─→ [HIPAA audit-log hardening]──┐
              │                                 │
              │                                 ▼
              ├─→ [Modular admin shell] ─→ [Clinic orgs schema]
              │                                 │
              │                                 ├─→ [Clinician dashboard]
              │                                 │
              │                                 ├─→ [Org billing (Stripe)]
              │                                 │
              │                                 ├─→ [Custom rank weights + dose-trend alerts]
              │                                 │
              │                                 └─→ [White-label theming]
              │
              ├─→ [i18n bootstrap] ─→ [Spanish localization sweep]
              │
              ├─→ [Multi-tier affiliate schema + cron] ─→ [Tier-aware payouts]
              │
              └─→ [Ad ETL schema + pg_partman + first-network ingest]
                    │
                    └─→ [CAC join nightly]

[Onboarding overhaul] ─→ [Activation events] ─→ [Gamification engine]
                                                    │
                                                    ├─→ [Review prompt engine]
                                                    │
                                                    └─→ [Recommender (pgvector)]
                                                              │
                                                              └─→ [Weekly Claude summary]

[Helpdesk schema + Resend Inbound] ─→ [Agent UI + AI draft] ─→ [CSAT loop]

[Cancellation save offers] depends on [Stripe Customer Portal hook] (v1.2)
[Pharma paywall] depends on [tier_effective view] (v1.2)
[Paywall A/B] depends on [Event taxonomy] + [PaywallVariant component]
[Page-builder A/B] depends on [Existing page-render Edge Fn extension]
```

**Recommended phase order (16-20 phases starting at Phase 24, ~5-8 months):**

| Phase | Workstream | Why this order |
|-------|-----------|----------------|
| **24** | Foundation: event taxonomy + PostHog server-side proxy + session-replay PII masking + cohort builder | EVERY downstream measurement gates on canonical events; ship first |
| **25** | HIPAA audit-log hardening (schema + phi_access_log + MFA enforcement + subprocessors page) | Gates clinic-org onboarding (legal cannot ship clinic without HIPAA-grade audit); pure backend; non-blocking for parallel work |
| **26** | Multi-tier affiliate (ALTER affiliates + affiliate_tiers + cron + tier-aware payout) | Self-contained extension of v1.2 Phase 19; doesn't gate anything else; ship to capture growth ROI early |
| **27** | Modular admin shell + bulk actions + admin 2FA enforcement | Required by clinic-org admin UI; required by helpdesk agent UI; ship before either |
| **28** | Clinic orgs schema + RLS proofs (cross-org test) + org-invite + patient-link + consent | Largest new schema slab; backend-first before any clinic UI; HIGH risk → small wave granularity |
| **29** | Org billing (Stripe parallel customer namespace + per-active-patient metering) | Depends on Phase 28 schema; Stripe Meter Events are 2024 API — verify in research |
| **30** | Clinician dashboard + roster + drill-in + alerts inbox + alert rule editor + dose-trend cron | Depends on 28 + 29; surfaces the value of clinic onboarding; clinic deals can close here |
| **31** | White-label theming + org branding | Cosmetic; can ship anytime post-30; defer until first clinic asks |
| **32** | i18n bootstrap + Spanish UI sweep + transactional email es-locale + locale switcher | Non-blocking parallel work; can run alongside Phases 25-30 |
| **33** | Ad spend ETL (pg_partman + 3 ingest Edge Fns + cron + CAC join) | Self-contained; non-blocking |
| **34** | Onboarding overhaul (schema + flow renderer + onboarding-merge + admin flow editor + activation events) | Depends on Phase 24 event taxonomy; gates gamification |
| **35** | Gamification (xp_ledger + streak_state + freeze tokens + leaderboards + weekly challenges) | Depends on Phase 34 activation events to drive XP rules; uses v1.2 DS-10 illustrations |
| **36** | Review prompt engine (two-stage NPS + trigger rule editor) | Depends on activation events + helpdesk for "feedback" branch |
| **37** | Helpdesk core (schema + ticket widget + email-to-ticket + agent UI + AI draft + CSAT) | Depends on Phase 27 admin shell; standalone otherwise |
| **38** | AI recommender (pgvector + embed-content + recommend-content + weekly-summary-claude) | Depends on event taxonomy + activation events; nightly cron doesn't block anyone |
| **39** | Paywall A/B + pharma paywall + page-builder A/B variants | Depends on event taxonomy + tier_effective; touches existing page-render Edge Fn |
| **40** | Cancellation save offers + offer admin editor | Depends on Customer Portal hook (existing); standalone |
| **41** | Public status page (Better Stack integration + status badge in app) | External vendor; trivial integration |
| **42** | v1.3 polish + accessibility WCAG 2.2 AA + PWA + offline mode + dark mode validation + tech debt sweep | Last — accessibility audit pulls together all new surfaces |

**Why HIPAA (25) before Clinic (28-30):** Legal cannot offer a BAA without the audit-log + MFA + subprocessor surfaces being live. HIPAA work runs in parallel (legal/policy/vendor negotiation 4-8 weeks) BUT the engineering surfaces (audit-log hardening, MFA enforcement, phi_access_log) must be merged before first clinic deal can technically close.

**Why Foundation (24) before everything:** Every measurement gates on canonical events. Ship the event taxonomy + server-side capture as the FIRST thing so paywall A/B / page-builder A/B / activation funnel / clinician-alert-acknowledged / ticket-CSAT all land into PostHog reliably from day one.

**Why Multi-tier affiliate (26) early:** It's a self-contained EXTENSION of v1.2 Phase 19 — low risk, high revenue-ROI, ships parallel to HIPAA legal work.

**Why white-label theming (31) deferred AFTER clinic dashboard launch:** Premature optimization; ship the dashboard, learn what clinics actually want branded, then build.

**Why i18n (32) can slot anywhere parallel:** Schema-light (one table); biggest cost is translation labor (parallel to engineering).

**Why Ad ETL (33) self-contained:** No frontend dependency; pure backend; ship anytime.

**Why Gamification AFTER Onboarding:** Activation events from Phase 34 are the XP-trigger source.

---

## Anti-Patterns (v1.3-specific)

### Adding a second tier-source table parallel to `tier_effective`
**What:** Creating a separate `subscription_tier` or `user_plan` table to hold the new multi-tier-affiliate-related tier info.
**Why wrong:** Phase 19 D-04 established `tier_effective` view as the canonical source. Adding a parallel table forces every consumer (PharmaGate, paywall, AdSlot, ai-chat, recommend-content) to query two sources and reconcile. Drift inevitable.
**Do instead:** Affiliate tier lives on `affiliates.tier` (separate concept from subscription tier). Pharma paywall reads `tier_effective.has_active`. Multi-tier affiliate does NOT change anything in `tier_effective` — it's about commission rates, not user subscription.

### Treating org context as just another Zustand slice
**What:** Adding `org: { id, name, ... }` to Zustand and letting components read it directly.
**Why wrong:** Every query becomes "remember to filter by org_id"; cross-org RLS bugs creep in; surface gating (no ads on /clinic/*) gets forgotten.
**Do instead:** Wrap the entire app in an `<OrgProvider>` BELOW `<AuthProvider>`; provide an `useOrg()` hook that returns `{ org, members, isClinician, isAdmin, surface }`; every supabase-js query in clinic surfaces goes through `orgClient(org_id)` wrapper that auto-applies org_id to filters; ESLint rule (new) forbids direct `supabase.from()` calls inside `src/components/clinic/**`.

### Storing PHI in client-side Zustand persisted slices
**What:** Clinician opens patient drill-in; patient's injection history persists to clinician's localStorage.
**Why wrong:** Clinician device theft = HIPAA breach. Also stale data — patient revokes consent but clinician's local cache still shows.
**Do instead:** Org-scoped data NEVER persists. `partialize` explicitly excludes any slice with `org_` prefix. Clinic dashboard re-fetches on every mount; uses Realtime for live updates.

### Subdomain-based white-label for v1.3
**What:** Issuing `acme.app.leanshot.app` per clinic; wildcard cert; subdomain-aware routing.
**Why wrong:** Wildcard cert IS present in v1.2 but Capacitor universal-link config (v1.4) gets gnarly; each subdomain needs its own AASA file association; complicates locale routing if added later.
**Do instead:** Path-based for v1.3 (`app.leanshot.app/clinic/acme/...`). Defer subdomain decision to v1.5 when first big clinic asks AND universal-link strategy is firmed up.

### Trying to make ai-chat HIPAA-compliant by signing BAA with Anthropic
**What:** Treating clinical-context Claude calls the same as consumer ones.
**Why wrong:** Anthropic offers BAA via Enterprise tier but Zero-Data-Retention is a separate negotiation. Consumer ai-chat sends user state; clinical-context ai-chat sends PATIENT state to a clinician.
**Do instead:** Two separate Anthropic API keys / endpoints: one for consumer ai-chat (existing), one for clinical-context (org-scoped, ZDR + BAA, more restrictive system prompt). NOT shared infrastructure. `ai-chat` Edge Fn branches on `org_id IS NOT NULL` to pick endpoint.

### Putting helpdesk attachments in the public Storage bucket
**What:** Reusing the v1.2 `page-assets` bucket for ticket attachments.
**Why wrong:** Tickets can contain PHI (screenshots of patient data, blood test images). Public bucket = breach.
**Do instead:** `ticket-attachments` is a NEW private bucket with RLS by ticket.requester_id OR ticket.assignee_id. Access via signed URLs with short TTL. Live cross-org test in Phase 37.

### Server-side PostHog capture for EVERY event
**What:** Routing every analytics call through `posthog-capture-proxy` Edge Fn.
**Why wrong:** Bandwidth + Edge Fn invocation cost balloons; PostHog itself can't dedupe across server+client capture cleanly.
**Do instead:** Only the 3-4 "must-not-miss" events go server-side (signup, payment, activation, paywall_converted). Everything else stays client-side. Server-side events use a distinct `$lib='server-proxy'` property so PostHog dashboards can opt-in.

### Mutating XP via UPDATE on streak_state
**What:** `UPDATE streak_state SET xp = xp + 10`.
**Why wrong:** No audit trail; race conditions; can't reconstruct after a bug.
**Do instead:** `xp_ledger` is append-only. Read balance via `SUM(delta)`. Materialized view `user_xp_balance` for fast reads if needed (refresh on insert via trigger).

### Adding `/es/...` path prefix routing in v1.3
**What:** Doubling every Vercel rewrite rule to handle a locale prefix.
**Why wrong:** Existing 7 SPA fallback rules + page-render rewrites all need locale-aware versions; breaks AASA paths (per `feedback_wildcard_route_handler_regression_audit`); complicates Capacitor universal links.
**Do instead:** `?lang=` query + user preference for v1.3. Reassess in v1.5 if SEO research demands prefix.

### Treating Resend Inbound as best-effort
**What:** Helpdesk emails arrive sporadically; no retry; no replay.
**Why wrong:** Customer emails getting silently dropped = trust killer.
**Do instead:** `helpdesk-email-ingest` Edge Fn must be idempotent (use Resend's `message_id` as natural key). Failed inserts go to dead-letter table (`helpdesk_ingest_dlq`); admin alert on DLQ depth > 0.

---

## Integration Points (v1.2 ↔ v1.3)

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Zustand store ↔ Org slice | Direct selectors via `useOrg()` | New slice persists `current_org_id` only; org payload re-fetched per mount |
| `App.tsx` ↔ OrgProvider | Wrap below AuthProvider | Org context available app-wide; surface check (clinic vs consumer) drives `<AdSlot>`, paywall, ai-chat routing |
| `stripe-webhook` ↔ Org billing | Same webhook, dispatch on `metadata.kind` | Single endpoint; per-customer-namespace handler |
| `affiliate-payout` ↔ Multi-tier | Reads `affiliate.tier` → `affiliate_tiers.commission_rate_pct` | Single commission computation in `_shared/affiliate-commission.ts` |
| `account-delete` ↔ Org membership | Cascade extended: org_members removal, ticket transfer, alert reassignment | If user is sole org owner → block with explicit transfer-or-delete-org flow |
| `page-render` Edge Fn ↔ A/B variants | Resolve `landing_page_variants` per-visitor via PostHog | Existing ISR cache becomes per-variant cache key |
| `ai-chat` Edge Fn ↔ Org context | Branch on `org_id IS NOT NULL` → use BAA-covered endpoint + clinical system prompt | TWO Anthropic credentials |
| Existing `audit_logs` ↔ HIPAA events | Additive enum values | Never remove old enum values |
| Existing PostHog wiring ↔ Server-side capture | New `posthog-capture-proxy` Edge Fn for must-not-miss events | Client still captures everything else |
| Existing v1.2 Page Builder ↔ New blocks | Add `KbExcerptBlock`, `PartnerLogoStripBlock`, `LocaleSelectorBlock` | All blocks render via existing block-tree pattern |
| Existing `dsar-export` ↔ New tables | Extend export bundle | Include org_member rows + tickets + onboarding responses + alerts |
| Existing Resend send-email-internal ↔ Locale | Reads recipient `preferred_locale` → picks template variant | Vendor-gated send health check carries over |
| Existing `tier_effective` view ↔ Pharma paywall + Cancellation flow + Recommender | All read this view (canonical) | DO NOT create parallel tier sources |
| Realtime channels ↔ Org-scoped | New channels: `org:${org_id}:alerts`, `org:${org_id}:roster`, `ticket:${ticket_id}` | Same broadcast pattern as v1.1 clinic surfaces |

### External Services (NEW or EXTENDED)

| Service | Integration | Notes |
|---------|-------------|-------|
| Supabase Enterprise + BAA | EXISTING project; need BAA addendum (commercial action) | Engineering bandwidth: zero — legal/procurement work |
| Vercel Enterprise BAA | EXISTING project; need BAA addendum | Same |
| Stripe Connect (existing) | Extended for org billing (parallel customer namespace) | Stripe Meter Events 2024 API for per-active-patient |
| Anthropic (existing) | NEW second credential for clinical context (BAA + ZDR) | OR migrate ALL ai-chat to Enterprise tier if budget allows |
| OpenAI OR Voyage AI | NEW for embeddings (recommender) | Prefer Voyage for cost; OpenAI for proven dims |
| Resend (existing) | NEW Inbound webhook for helpdesk; NEW templates for org-invite, dose-trend alert, weekly summary, CSAT, locale variants | Domain `app.leanshot.app` already verified |
| Resend Inbound — `support.app.leanshot.app` MX | NEW DNS config | Vendor-gated send health check pattern |
| Meta Ads API + Google Ads API + TikTok Ads API | NEW credentials per network | Edge Fn per network for ETL |
| Better Stack (status page) | NEW (Phase 41) | External service; widget embed |
| PostHog (existing) | Extend for server-side capture + session-replay PII masking + cohort sync | API key already in env |
| Sentry (existing) | No new integration; HIPAA review needed (Business tier + BAA option) | Vendor-gated until BAA signed |
| Twilio / Telnyx (POSSIBLE for SMS MFA) | DEFERRED — Supabase Auth supports TOTP/Authenticator app MFA | Avoid SMS for HIPAA (insecure channel per NIST 800-63B) |

---

## Scaling Considerations

| Scale | Architecture adjustments |
|-------|--------------------------|
| **0-100 clinics, 0-50k consumer users** | Current Supabase Pro ($25/mo) + Vercel Pro sufficient. pgvector at this content volume fine. Realtime fan-out for clinic alerts fine. |
| **100-1k clinics, 50k-500k consumer users** | Move ad_spend_facts to TimescaleDB (already partitioned via pg_partman so migration is path-additive). Org-scoped Realtime channels start to compete — add Supabase channel pooling. Helpdesk volume → consider promoting to dedicated agent UI (vs in-house admin). |
| **1k+ clinics, 500k+ consumer users** | Split clinical data to a dedicated Supabase project (or PG instance) with cross-DB foreign tables for the consumer ↔ clinic linkage. AI recommender embeddings move to dedicated vector DB. Helpdesk → real Zendesk migration. |

**First v1.3 bottleneck likely:** Clinician dose-trend cron at scale. Running `clinician-dose-alert` every 30 min across 1k clinics × 100 patients each = 100k patient-rule-evals per run. Mitigate by sharding cron + per-org incremental eval (only patients with new activity since last run).

**Second bottleneck:** Org-scoped Realtime channels. Supabase Realtime has a per-project connection cap. At 1k clinics × 5 active clinicians = 5k subscribers; manageable. At 10k clinics, need channel pooling / Realtime-Postgres-Replica.

**Third bottleneck:** Helpdesk attachment storage cost. Mitigation: image compression on ingest; 90-day auto-prune for resolved tickets per retention policy.

**Bundle pressure:** v1.2 index = 17.67 kB gz against 50 kB ceiling. New chunks (clinic, helpdesk, admin-helpdesk, i18n-es, recommender, gamification) are individually lazy-loaded; index target stays ≤ 22 kB. Per-chunk ceilings: clinic-bundle ≤ 60 kB gz, helpdesk-bundle ≤ 40 kB gz, i18n-es ≤ 15 kB gz, gamification ≤ 25 kB gz.

---

## Open Questions (for phase-specific research)

1. **Locale routing for SEO:** Does Spanish-locale SEO traffic justify path-prefix routing (vs query param) in v1.4? Need market-research signal from first 60 days.
2. **Anthropic BAA tier vs Voyage AI embedding privacy posture:** If we route consumer ai-chat through BAA-Anthropic uniformly, do we still need a separate clinical endpoint? Cost/complexity tradeoff.
3. **Custom rank weights — schema flexibility vs schema rigidity:** JSONB `org_settings.rank_weights` allows arbitrary tuning; admin UI needs guardrails so a clinic doesn't ship-foot themselves into a non-functional alert config.
4. **Org-scoped audit-log retention vs global audit_logs retention:** HIPAA wants 6 yr minimum; can we keep them in the same table with a `domain` column? (Recommendation: yes — single table, indexed `domain` column, retention policy per domain via partman.)
5. **Helpdesk vendor-build decision:** Do we save 2 engineering quarters by buying Plain.com / Crisp.chat / Helpscout for v1.3 then ripping out for in-house in v1.5? (Recommendation per v1.3 brief: build in-house — but worth re-verifying in Phase 37 planning.)
6. **PostHog server-side capture cost at scale:** PostHog charges per event; server-side capture means we pay for every signup/payment. Worth it for adblock-resistance? (Verify in Phase 24 with PostHog pricing review.)
7. **MFA enforcement rollout strategy:** Hard cutover (existing clinicians must enroll on next login) vs soft (banner for 30 days, then enforce). Legal/UX call.
8. **Storage transforms on Pro plan:** v1.2 Phase 16 noted Supabase Pro upgrade pending. Pro provides image transforms — useful for org-branding logos and helpdesk attachment thumbnails. Confirm Pro is live before Phase 28 + 37.

---

## Sources

- v1.2 architecture: `.planning/milestones/v1.2-research/ARCHITECTURE.md`
- v1.2 ROADMAP: `.planning/milestones/v1.2-ROADMAP.md`
- v1.2 milestone audit: `.planning/milestones/v1.2-MILESTONE-AUDIT.md`
- LeanShot CLAUDE.md (project rules) + MEMORY.md (Phase 5/6/7/15/16/19/22 empirical findings — status-machine ownership rule, parallel-executor isolation, vendor-gated send pattern, tier_effective canonical source, Supabase migration filename regex, etc.)
- Supabase pgvector: https://supabase.com/docs/guides/database/extensions/pgvector
- Supabase Realtime channel-scoping: https://supabase.com/docs/guides/realtime
- react-i18next: https://react.i18next.com/
- Resend Inbound webhooks: https://resend.com/docs/dashboard/webhooks/inbound-emails
- Stripe Meter Events API (2024): https://docs.stripe.com/billing/subscriptions/usage-based/recording-usage
- pg_partman: https://github.com/pgpartman/pg_partman
- HIPAA Security Rule §164.312(b): https://www.hhs.gov/hipaa/for-professionals/security/laws-regulations/index.html
- NIST 800-63B (no SMS MFA for high-assurance): https://pages.nist.gov/800-63-3/sp800-63b.html
- Apple HealthKit + ad firewall (unchanged from v1.2 — v1.4 P18 hard-enforces): inherited
- Anthropic BAA / Enterprise (Zero Data Retention): https://www.anthropic.com/legal/baa-trust
- OpenAI Embeddings vs Voyage AI cost comparison: https://docs.voyageai.com/docs/pricing

---

*Architecture research for: LeanShot v1.3 Platform Expansion (Revenue + Depth + B2B + HIPAA + Foundation + Onboarding/Gamification/Helpdesk/AI-personalization-partial)*
*Researched: 2026-05-17*
*Inheritance: v1.2 architecture (DO NOT redesign) + v1.1 architecture (locked)*
