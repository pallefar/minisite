# Phase 22: Owner/Admin + Lifecycle Email + DSAR + Cookie Consent — Context

**Gathered:** 2026-05-16
**Status:** Ready for research / planning
**Source:** `/gsd-discuss-phase 22 leanshot` — 8 deep-dive questions (2 rounds), all locked

<domain>

## Phase Boundary

Phase 22 ships the final cross-cutting layer for v1.2: the owner/admin operator surface (members table, MRR/ARR/churn, read-only impersonation, refund/cancel/comp, feature-flag overrides, affiliate review queue, cohort retention heatmap), account-deletion UI (Apple §5.1.1(v) compliance), GDPR/CCPA cookie consent + DSAR portal + consent records, and lifecycle email templates (welcome / behavior-triggered / transactional / retention) on the v2 design tokens plus self-serve email preference center.

**Cross-phase handoffs (consumes):**
- **P19 `account-delete` Edge Function** — DEL-02 cascade Edge Fn already shipped in Phase 19; P22 ships the in-app DEL-01 UI surface that invokes it
- **P19 affiliate fraud signals** — ADMIN-06 review queue consumes `affiliate_conversions.status='flagged'` + `affiliate_clicks.flagged=true` populated by P19's fraud trigger
- **P19 Resend integration** — ON-02 lifecycle emails reuse the direct-HTTPS Resend pattern from `clinic-invite/resend.ts` (W-5 fix); gate sends on the deferred-from-P19 Resend domain verify
- **P19 `tier_effective` view** — ADMIN-02 MRR/ARR/churn reads tier state from the unified view (Stripe-only at v1.2; RC joins when P16 lands)
- **P14 Stripe Customer + Subscription** — ADMIN-04 refunds/cancels/comps wrap the Stripe API
- **P7 `audit_logs` + `app.suppress_audit` GUC** — ADMIN-03 impersonation audit trail extends the existing P7 schema; cascade-friendly suppression already documented
- **P9/P10 clinic-operator table pattern** — ADMIN-01 members table reuses the bento-grid + role-gated route pattern from `/clinic/*`

**Cross-phase handoffs (deferred — carved out / pushed to P22b):**
- **ADMIN-07 ad-revenue dashboard** → **CARVED OUT** to Phase 20 (per D-01). P22 ships ZERO ad-revenue routes. When P20 resumes after P16+P18, ADMIN-07 lands there as part of P20's deliverable set.
- **ON-01 revamped 7-step onboarding** → **DEFERRED to Phase 22b** (per D-02). P22 ships ZERO onboarding changes; v1.1 onboarding stays live through v1.2 launch. Revamp lands as P22b after P16+P17+P18+P21 ship.
- **iOS App Store §5.1.1(v) "≤3 taps from in-app settings"** (DEL-01) — settings UI exists in v1.1 SPA. For v1.2 web ship, the route + tap-count target is met. iOS-native tap-count compliance verification waits for P16 mobile shell.

**NOT in scope (deferred):**
- Multi-account admin (multiple owners with role splits) — v1.3
- Detailed PostHog cohort-builder UI in the admin (PostHog dashboard handles) — v1.3
- Refund/cancel BULK actions across many users — v1.3
- DSAR auto-fulfillment (manual review at v1.2; 30-day SLA per REQ) — auto-export to S3/Drive deferred to v1.3
- Co-shared data unwinding (deleting your data from a clinic you were part of) — v1.3 with legal sign-off
- Per-cohort PostHog flag overrides (per D-08: per-user only at v1.2; PostHog dashboard handles cohort rules)
- Right-strip / sidebar cookie banner variants (locked to bottom slide-up per D-07)

</domain>

<decisions>

## Implementation Decisions

### ADMIN-07 ad-revenue dashboard scope
- **D-01:** **Carved out entirely from P22.** Ships in Phase 20 when P20 resumes. P22 includes NO ad-revenue route, NO `ad_revenue_daily` table dependency, NO ETL consumer. The ROADMAP annotation on P20 already records this; planner: do NOT plan an `/admin/ad-revenue` route or any provider-revenue UI. ADMIN-07 stays unticked in REQUIREMENTS.md until P20 ships.

### ON-01 onboarding revamp scope
- **D-02:** **Entire ON-01 deferred to Phase 22b** (runs after P16/P17/P18/P21). v1.1's 7-step onboarding remains the live onboarding through v1.2 launch. Planner: do NOT touch `src/components/onboarding/OnboardingFlow.tsx` or any onboarding-step components in P22 scope. v1.2 design-token refresh on onboarding waits for P22b. The deferred-from-P19 affiliate-attribution capture stays in the v1.1 flow via the `aff_manual_entry` feature flag (already shipped in P19 19-04 Task 3).

### ON-02 lifecycle email Resend domain dependency
- **D-03:** Build all lifecycle email templates + send paths assuming production sender `LeanShot <noreply@app.leanshot.app>` (the value already in Supabase Function secret `RESEND_FROM` per PROJECT.md). Each lifecycle Edge Function (welcome-series + behavior-triggered + transactional + retention + preference-update) does a startup health check via the Resend `/domains` API: if `app.leanshot.app` `status !== 'verified'`, the function logs a structured warning, increments a `resend_domain_unverified_skips` counter (Sentry breadcrumb), and exits 200 without sending. User completes the DNS verify (deferred P19 vendor pass) once via Dashboard + flips the production toggle. No code changes needed at flip time; the health check passes on next invocation. Cutover risk: ZERO (single template set; no sandbox→prod swap).

### ADMIN-08 cohort retention heatmap definition
- **D-04:** **Cohort = `date_trunc('week', users.created_at)`; retention metric = `count(distinct user_id) WHERE last_active_at >= cohort_start + day_N`.** Granularity: weekly cohort rows × daily columns 0-90 (13 weeks × 91 days = 1183 cells; well under heatmap render limits). Backing data: new `user_activity_daily` matview refreshed by daily pg_cron at 02:00 UTC. Existing `auth.users.last_sign_in_at` is the source-of-truth for "active"; if PostHog `last_event_at` diverges, prefer the Supabase value (system-of-record). Reuses the matview pattern from Phase 19 `affiliate_click_baseline` (Plan 19-07).

### ADMIN-03 impersonation scope
- **D-05:** **READ-ONLY impersonation.** Impersonated session can VIEW everything the user sees (dashboard, photos, AI history, billing, etc.) but cannot mutate state. All `INSERT`/`UPDATE`/`DELETE` originating from an impersonated session are blocked at the supabase-js client layer with an `"impersonation is read-only"` toast + Sentry breadcrumb. Refund/cancel/comp actions from ADMIN-04 are separate admin-level operations performed from `/admin/members/{id}` while NOT impersonating — they log as the admin actor with `target_user_id`, not as the user themselves. Impersonation injects `app.impersonator_id` GUC into the JWT claims (or session cookie) for RLS-level read scoping; writes hit a custom RLS gate `current_setting('app.impersonator_id', true) IS NULL`. 30-min auto-expire via `setTimeout` + JWT exp claim. Red banner mounted at AppShell root for all impersonated sessions. Audit log row created on impersonation start + end + every blocked-write attempt.

### GDPR-03 DSAR scope (co-shared data redaction)
- **D-06:** **Patient's OWN records only; co-shared data redacted.** Export bundle includes:
  - **Patient's own records:** injections, photos, weight, food, activity, mood, symptoms, AI history (user side of conversation only), Stripe charges + subscriptions, PostHog events keyed to user_id, affiliate clicks/conversions/payouts where the user was the affiliate.
  - **Doctor-share records:** the share metadata (token, doctor email, when shared, when last accessed) BUT NOT the doctor's notes/responses — those are the doctor's data.
  - **Clinic records:** the user's own clinic membership row + the user's own activity within the clinic. NOT other clinic members' data.
  - **Affiliate referred-user data:** if the patient was an affiliate, their `affiliate_conversions` rows include the converted user's email **hashed (SHA-256)**, NOT plaintext. The conversion timestamps + commission amounts stay plaintext (the user's own ledger).
- **Format:** JSON (machine-readable) + PDF (human-readable summary with 7-section structure: Profile, Subscriptions, Health Log, Photos, Sharing History, Affiliate Activity, Communications). PDF generated via jsPDF (already in stack per `reference_phase7_research_findings`).
- **30-day SLA tracker** in `dsar_requests` table with `requested_at`, `completed_at`, `status ('pending' | 'in_progress' | 'completed' | 'rejected')`. Admin processes manually via ADMIN-04-adjacent surface at v1.2 (auto-fulfillment deferred to v1.3).

### GDPR-01 cookie consent UX
- **D-07:** **Bottom slide-up banner with "Customize" expandable categories.** vanilla-cookieconsent library + Consent Mode v2 integration. Non-blocking (user can browse without choosing) but persists until user makes a choice. "Accept all / Reject all / Customize" three buttons. Customize expands inline (no separate modal) to per-category toggles (Essential always-on / Analytics / Marketing / Personalization). EU geolocation → all non-Essential default OFF; US geolocation → Analytics default ON (CCPA opt-out model). Reuses existing IP-geolocation detection from Vercel Edge headers (already wired in P12 firewall fixture branch).

### ADMIN-05 PostHog feature-flag admin UI depth
- **D-08:** **Per-user override ONLY at v1.2; PostHog stays source of truth for cohort + default rules.** Admin UI surfaces a per-user "Override flags" action from the members table (ADMIN-01). Overrides stored in new `feature_flag_overrides` table (`user_id`, `flag_key`, `value`, `set_by`, `set_at`, `expires_at`). Application's PostHog client wraps `posthog.isFeatureEnabled(key)` with an overrides-first check; if a user-specific row exists in `feature_flag_overrides` AND `expires_at > now()`, use it; else fall through to PostHog SDK. CRUD UI: bool flags only at v1.2 (multivariate flags deferred to v1.3). Per-cohort overrides handled in PostHog dashboard directly (CS reps Slack the cohort criteria to the engineer to add via PostHog UI).

### Claude's Discretion (planner decides via PATTERNS.md analog)

- **Members table search/filter UX** — clone Phase 9/10 `/clinic/*` operator-roster pattern (tier filter, signup-date sort, last-active sort)
- **Refund/cancel/comp UI flow** — Stripe Dashboard-style modal with confirmation text-entry (Stripe SDK already integrated per P14)
- **Lifecycle email template HTML** — reuse Phase 9 `clinic-invite/templates.ts` structure with v2 design tokens (Geist + Fraunces); 12 templates per ON-02 spec
- **Email preference center route** — `/settings/email-preferences` sub-page; per-category checkboxes; updates `consent_records.email_preferences` JSONB column
- **Soft-delete countdown UI** — 7-day grace banner in AppShell + an "undelete account" CTA in the post-delete confirmation email (Resend transactional template)
- **Cookie banner copy** — vanilla-cookieconsent default copy + leanshot brand voice tweak; legal counsel review at go-live
- **Audit log row structure** — extend existing P7 `audit_logs` table with `impersonator_id`, `target_user_id`, `action_type` ('impersonate_start' | 'impersonate_end' | 'impersonate_blocked_write' | 'refund_issued' | etc.)
- **DSAR ZIP packaging** — concat JSON + PDF + Storage downloads into a server-side ZIP via Edge Function; upload to `dsar-exports` private Storage bucket; signed URL emailed via Resend with 7-day TTL
- **PostHog cohort rule sync** — read-only mirror in admin UI showing which PostHog cohort a user is in (call PostHog GET `/api/feature_flag/local_evaluation` or similar); display next to per-user overrides

</decisions>

<canonical_refs>

## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase dependencies (READ FIRST)
- `.planning/phases/19-affiliate-program-stripe-connect/19-CONTEXT.md` — affiliate fraud signal schema (ADMIN-06 consumer); account-delete cascade Edge Fn contract (DEL-02 surface)
- `.planning/phases/19-affiliate-program-stripe-connect/19-SUMMARY.md`-pattern (across 19-{01,02,03,04,05,06a,06b,07,08,09}-SUMMARY.md) — shipped Edge Functions list; `tier_effective` view used by ADMIN-02
- `.planning/phases/14-monetization-foundation-stripe-web-clinic-seats/14-CONTEXT.md` — Stripe Customer + Subscription patterns (ADMIN-04 refunds/cancels)
- `.planning/phases/07-compliance-foundations-legal-counsel-led/` — `audit_logs` schema + `app.suppress_audit` GUC pattern (ADMIN-03 impersonation extension)
- `.planning/phases/09-clinic-b2b-foundations/` — Resend `clinic-invite/resend.ts` direct-HTTPS pattern (ON-02 reuse target); role-gated route pattern (ADMIN-01 members table analog)
- `.planning/phases/10-clinic-operator-surface/` — `/clinic/*` operator roster + drill-in patterns (ADMIN-01 + ADMIN-04 analog)
- `.planning/phases/12-bootstrap-bundle-foundations/12-CONTEXT.md` — IP-geolocation via Vercel Edge headers (GDPR-01 geo-default logic); Two-tunnel firewall (relevant to GDPR-02 dynamic-import gates)
- `.planning/phases/15-page-builder-landing-pages/15-CONTEXT.md` — page-builder template instance pattern (NOT directly used at P22 but useful if onboarding-revamp returns later as P22b)

### Existing assets to extend (codebase)
- `supabase/migrations/` — extend `audit_logs` with impersonation columns (P7 base schema)
- `supabase/functions/clinic-invite/{resend.ts,templates.ts}` — Resend direct-HTTPS pattern to clone for 12 lifecycle templates
- `supabase/functions/account-delete/` — P19 cascade Edge Fn invoked by DEL-01 UI
- `src/components/dashboard/settings/SettingsPage.tsx` — extend with `/settings/email-preferences` sub-page
- `src/components/admin/` — existing admin scaffold (P19 19-05 shipped `AdminAffiliatesScaffold.tsx`); ADMIN-01 members table goes here
- `src/lib/billing.ts` + `src/lib/billing-sync.ts` — Stripe API integration (ADMIN-04 refund/cancel/comp wrappers)
- `src/hooks/useReducedMotion.ts` + `src/hooks/useTheme.ts` — design-token + a11y conventions

### Cross-cutting concerns (PROJECT.md)
- **Cookie consent × ad scripts** — GDPR-02 dynamic-import gates apply to PostHog + AdSense + Pixel + Meta scripts. None of those scripts load at P22 (AdSense in deferred P20); GDPR-02 ships the gating infrastructure, ad scripts plug in at P20 ship-time.
- **DSAR × affiliate ledger anonymization** — GDPR-03 export + DEL-02 cascade jointly own the `affiliate_ledger` anonymization invariant. P19 ships the `ON DELETE SET NULL` schema; P22 DEL-01 UI is the user-facing entry; the export bundle preserves the patient's OWN ledger (hashed referred-user emails per D-06).

### Project memory (must-read before planning)
- `reference_resend_phase9_wiring.md` — direct-HTTPS pattern; domain verify pattern (curl `api.resend.com/domains` with `RESEND_API_KEY`); endpoint list
- `reference_supabase_edge_function_deploy.md` — esm.sh imports; gateway Content-Type override (relevant to DSAR PDF response)
- `reference_supabase_migration_gotchas.md` — `app.suppress_audit` GUC, IMMUTABLE partial indexes (relevant to `feature_flag_overrides`)
- `reference_supabase_migration_filename_regex.md` — 14-digit timestamp + `_name.sql` pattern only; NO letter suffixes
- `reference_supabase_db_query_linked.md` — for any live audit/check (e.g., verify cookie-consent dynamic-import gate landed by querying CSP report-uri logs)
- `reference_phase19_research_findings.md` — Resend lifecycle pattern; account-delete cascade ordering
- `feedback_regulator_vs_user_audience_pattern.md` — applied: tight on regulator items (DSAR scope, cookie banner placement); invest on operator items (admin members table, refund UI)
- `feedback_aggressive_foundations.md` — applied: max coverage on user/operator UI; deferred when dependency-blocked
- `feedback_addendum_pattern_for_mid_execution_pivots.md` — pattern available if mid-execute pivots needed
- `feedback_planner_iter1_anti_patterns.md` — pre-emptive checklist for planner (status enum transitions, shared-file choreography, etc.)
- `feedback_status_machine_transition_owner.md` — apply state-graph audit for `dsar_requests.status` and `consent_records` (verify every state has a write owner)
- `project_phase19_pre_plan_state.md` — Phase 19 shipped state; Resend domain verify is the deferred-vendor-pass that gates ON-02

</canonical_refs>

<specifics>

## Specific Ideas

- **Members table columns** (ADMIN-01): email, tier (`free` | `paid` | `clinic_seat`), signup_date, last_active_at, clinic_name (if member), country (from billing address or IP), stripe_status (`active` | `past_due` | `canceled` | `trialing`)
- **Per-row admin quick actions** (ADMIN-01): Impersonate · Refund last charge · Cancel sub · Deactivate · Override flag · View full detail
- **MRR/ARR/churn chart** (ADMIN-02): chart.js (already in bundle) with monthly bins; free-vs-paid stacked bars + churn-rate line overlay; clinic-seat utilization shown as separate sparkline
- **Impersonation banner copy:** `"Impersonating {email} · Read-only · {N}m {S}s remaining · End impersonation"`
- **Refund flow:** Stripe Dashboard-style 3-step modal — pick charge from last 90d → enter amount (full or partial) → type confirmation text → submit → log + Resend transactional to user
- **Cohort heatmap row count cap:** 26 weeks (6 months) visible by default; admin can extend to full history via "Show all" toggle (performance: load on-demand via cursor pagination)
- **Cookie consent banner library:** `vanilla-cookieconsent@^3.0` (latest stable); + Consent Mode v2 wrapper via `gtag('consent', 'update', ...)` (PostHog already initialized lazily per D-08-adjacent pattern)
- **EU detection:** Vercel `request.geo.country` → ISO-3166 EU member-state list (28 countries); UK uses same model as EU for consent. US gets analytics-on default per CCPA opt-out doctrine.
- **DSAR JSON structure:** root keys `{ profile, subscriptions, health_log, photos, sharing_history, affiliate_activity, communications, generated_at, schema_version }`; each section is an array of objects; PDF generated by walking the JSON tree.
- **Soft-delete countdown:** users see a banner at AppShell top: `"Account scheduled for deletion in {N} days. [Cancel deletion]"`. Welcome-back transactional email fires at day 6 with "1 day left" subject.
- **Lifecycle email cadence:**
  - Welcome series: day 0 (`welcome_immediately`) + day 1 (`getting_started`) + day 3 (`first_injection_reminder`) + day 7 (`week-1_check_in`)
  - Behavior-triggered: first injection logged · 7-day streak achieved · missed-dose day-3
  - Transactional: receipt (Stripe `invoice.paid` webhook fires from P14) · password reset (re-skin existing) · clinic invite (re-skin P9)
  - Retention: re-engagement at 7 days inactive · cancellation win-back +30d · milestone celebrations (1mo, 3mo, 6mo, 1yr) · doctor-share notification · weekly digest (opt-in) · affiliate payout-paid monthly (re-skin)

</specifics>

<deferred>

## Deferred Ideas

- **ADMIN-07 ad-revenue dashboard** → Phase 20 (when P20 resumes after P16+P18). Per D-01.
- **ON-01 revamped 7-step onboarding** → Phase 22b (after P16+P17+P18+P21). Per D-02.
- **Per-cohort PostHog flag overrides** → v1.3 (per D-08 — per-user only at v1.2).
- **Multivariate (non-bool) feature flags** → v1.3 (per D-08).
- **Multi-account admin (multiple owners with role splits)** → v1.3.
- **Detailed PostHog cohort-builder UI in admin** → v1.3 (PostHog dashboard suffices interim).
- **Bulk refund/cancel actions across many users** → v1.3.
- **DSAR auto-fulfillment + S3/Drive upload** → v1.3 (manual review with 30-day SLA at v1.2).
- **Co-shared data unwinding (delete-from-clinic)** → v1.3 with legal sign-off.
- **Center-screen modal cookie banner variant** → never (locked to bottom slide-up per D-07).
- **iOS-native ≤3-tap compliance verification** → P16 mobile shell (web ≤3-tap verified at v1.2 ship).

</deferred>

---

*Phase: 22-owner-admin-lifecycle-email-dsar-cookie-consent*
*Context gathered: 2026-05-16 via `/gsd-discuss-phase 22 leanshot`*
*Decisions: 8 D-NN locked across 8 areas; 14 of 16 REQ-IDs in scope (ADMIN-07 carved to P20; ON-01 deferred to P22b); 11 deferred ideas; 0 SC amendments.*
