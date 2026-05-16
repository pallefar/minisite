# Phase 22: Owner/Admin + Lifecycle Email + DSAR + Cookie Consent — Research

**Researched:** 2026-05-16
**Domain:** Operator admin surface + GDPR/CCPA compliance (cookie consent + DSAR) + Resend lifecycle templates + read-only impersonation + 7-day account-deletion UI
**Confidence:** HIGH (8/10) — every load-bearing decision has VERIFIED or CITED backing; 3 ASSUMED claims flagged for user confirmation in §"Assumptions Log"

## Summary

Phase 22 is the final cross-cutting layer for v1.2 — it ships the owner/admin operator surface (members table, MRR/ARR/churn, read-only impersonation, refunds, feature-flag overrides, affiliate review queue extension, cohort retention heatmap), the in-app account-deletion UI (Apple §5.1.1(v)), the GDPR/CCPA cookie banner + DSAR portal + consent records audit, and 12 Resend lifecycle email templates on the v2 design tokens. It is heavily a composition phase — almost every load-bearing primitive already exists in the codebase from Phases 7/9/14/15/19 (audit_logs schema, `profiles.is_staff` gate, `pending_account_deletions` table, account-delete cascade Edge Function, Resend direct-HTTPS pattern, AdminAffiliatesScaffold, jsPDF dynamic-import pattern, IP-geolocation via Vercel Edge). The novel surface area is narrow but compliance-sensitive: the impersonation JWT-mint pattern, the cookie-consent + Consent Mode v2 wiring, the 7-day vs 30-day soft-delete reconciliation (a real conflict — see §"Critical Conflicts"), and the DSAR JSON+PDF bundle.

**Primary recommendation:** Extend existing assets aggressively (audit_logs, account-delete fn, AdminAffiliatesScaffold pattern, jsPDF dynamic-import) rather than build parallel systems. Treat the 7-day soft-delete window as an OVERRIDE of the existing 30-day window (NEW migration, NEW UI copy, NEW cron interval). Adopt vanilla-cookieconsent v3.1.0 with dynamic-import gating via `src/lib/sync-defer.ts` analog. Implement impersonation via short-lived JWT mint (admin API) carrying an `impersonator_id` JWT claim — RLS write-deny policy reads the claim from `current_setting('request.jwt.claims', true)::json->>'impersonator_id'`.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| `/admin/*` route shell + nav | Browser (React SPA) | API (RLS) | Existing pattern: `is_staff` client gate (UX) + Postgres RLS (security boundary), per Phase 15/19 |
| Members table query (search/filter/pagination) | API (Postgres view + RLS) | Browser (Pill filters, sort URLs) | DB owns query — RPC `admin_list_members(filter, page, size)` returns server-paginated rows |
| MRR/ARR/churn chart | API (Postgres view over `subscriptions` + `tier_effective`) | Browser (chart.js render) | Aggregation is SQL; client only renders |
| Read-only impersonation session start | Edge Function (admin JWT mint) | Browser (sets session, mounts banner) | `supabase.auth.admin.signInWithUserId()` or magic-link mint requires service-role; cannot run in browser |
| Read-only enforcement (writes blocked) | API (RLS deny policy on `impersonator_id` JWT claim) | Browser (`useImpersonationReadOnly()` disables buttons) | Defense-in-depth: client disables UI (UX), RLS rejects writes (security) — same dual-layer pattern as `is_staff` |
| Refund / cancel / comp Stripe operations | Edge Function (`admin-stripe-action`) | Browser (modal + 3-step flow) | Stripe API requires server-side secret key; webhook updates DB; UI just initiates |
| Feature-flag overrides | API (`feature_flag_overrides` table + RLS) + client wrapper around `posthog.isFeatureEnabled()` | Browser (admin CRUD) | Override lookup happens client-side (already-loaded cache); writes are admin-only RPCs |
| Affiliate review queue extension | API (Phase 19 schema + new RPCs `admin_approve_affiliate`, `admin_pay_out`) | Browser (extends `AdminAffiliatesScaffold`) | Reuses existing scaffold + per-row inline actions |
| Cohort retention heatmap | API (matview `user_activity_daily` + `cohort_retention` view) | Browser (CSS-grid render) | DB owns aggregation; browser owns render |
| Account-deletion UI (≤3 taps + typed-confirm + 7-day grace) | Browser (settings → modal → countdown banner) | API (existing `initiate_account_deletion` RPC + `account-delete` Edge Fn) | UI shell only; backend cascade already shipped |
| Cookie consent banner | Browser (vanilla-cookieconsent v3) | Edge Function (geo-detect via Vercel Edge headers) | UI is browser; default toggles depend on EU vs US geolocation read server-side |
| Consent records audit | API (`consent_records` table + UPSERT RPC) | Browser (calls RPC from cookie consent `onConsent` callback) | Server is system-of-record per GDPR Art. 7(1) |
| DSAR export bundle (JSON + PDF + Storage objects) | Edge Function (`dsar-export` — assembles ZIP) | Browser (request form + email-link landing page for download) | Cross-system aggregation requires service-role; PDF generation via jsPDF SSR or server-side |
| Lifecycle emails (12 templates) | Edge Functions (5 functions: welcome-series, behavior-triggered, transactional, retention, preference-update) | API (DB triggers + scheduled cron invoke functions) | Templates rendered server-side (Gmail/Outlook can't run JS); cron + DB-event triggers fire them |
| Email preference center | Browser (`/settings/email-preferences`) | API (`consent_records.email_preferences` JSONB column UPSERT) | Form is browser; persistence is DB |
| Soft-delete countdown banner | Browser (AppShell sticky banner reading `pending_account_deletions` row) | API (existing RLS-scoped select) | UI only; data already exists |

---

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** ADMIN-07 ad-revenue dashboard **carved out entirely from P22**. Ships in Phase 20 when P20 resumes. P22 includes NO ad-revenue route, NO `ad_revenue_daily` table dependency, NO ETL consumer. ADMIN-07 stays unticked in REQUIREMENTS.md until P20 ships.

- **D-02:** ON-01 onboarding revamp **deferred to Phase 22b** (runs after P16/P17/P18/P21). v1.1's 7-step onboarding remains the live onboarding through v1.2 launch. Planner: do NOT touch `src/components/onboarding/OnboardingFlow.tsx` or any onboarding-step components in P22 scope.

- **D-03:** ON-02 lifecycle emails build all templates + send paths assuming production sender `LeanShot <noreply@app.leanshot.app>` (the value already in Supabase Function secret `RESEND_FROM`). Each lifecycle Edge Function does a startup health check via the Resend `/domains` API: if `app.leanshot.app` `status !== 'verified'`, the function logs a structured warning, increments a `resend_domain_unverified_skips` counter (Sentry breadcrumb), and exits 200 without sending. User completes the DNS verify (deferred P19 vendor pass) once via Dashboard. No code changes at flip time.

- **D-04:** ADMIN-08 cohort retention heatmap definition. **Cohort = `date_trunc('week', users.created_at)`; retention metric = `count(distinct user_id) WHERE last_active_at >= cohort_start + day_N`.** Granularity: weekly cohort rows × daily columns 0-90 (13 weeks × 91 days = 1183 cells). Backing data: new `user_activity_daily` matview refreshed by daily pg_cron at 02:00 UTC. `auth.users.last_sign_in_at` is source-of-truth.

- **D-05:** ADMIN-03 impersonation is **READ-ONLY.** Impersonated session can VIEW everything (dashboard, photos, AI history, billing) but cannot mutate state. All `INSERT/UPDATE/DELETE` from impersonated session blocked at supabase-js client layer with `"impersonation is read-only"` toast + Sentry breadcrumb. Refund/cancel/comp actions from ADMIN-04 are SEPARATE admin-level operations performed from `/admin/members/{id}` while NOT impersonating — they log as admin actor with `target_user_id`, not as the user. Impersonation injects `app.impersonator_id` GUC into JWT claims for RLS-level read scoping; writes hit RLS gate `current_setting('app.impersonator_id', true) IS NULL`. 30-min auto-expire via `setTimeout` + JWT exp claim. Red banner mounted at AppShell root. Audit log row on start + end + every blocked-write attempt.

- **D-06:** GDPR-03 DSAR scope. **Patient's OWN records only; co-shared data redacted.** Export includes patient's own records (injections, photos, weight, food, activity, mood, symptoms, AI history user-side only, Stripe charges + subscriptions, PostHog events, affiliate clicks/conversions/payouts where user was affiliate). Doctor-share metadata only (NOT doctor's notes). Clinic membership row only (NOT other members' data). Affiliate referred-user emails **hashed (SHA-256)**, NOT plaintext; conversion timestamps + commission amounts stay plaintext. **Format:** JSON + PDF (jsPDF, 7 sections: Profile, Subscriptions, Health Log, Photos, Sharing History, Affiliate Activity, Communications). 30-day SLA tracker in `dsar_requests` table.

- **D-07:** GDPR-01 cookie consent UX. **Bottom slide-up banner with "Customize" expandable categories.** vanilla-cookieconsent library + Consent Mode v2 integration. Non-blocking (user can browse). "Accept all / Reject all / Customize" three buttons. Customize expands inline (no separate modal) to per-category toggles (Essential always-on / Analytics / Marketing / Personalization). EU geo → all non-Essential default OFF; US geo → Analytics default ON (CCPA opt-out model). Reuses existing IP-geolocation from Vercel Edge headers (P12).

- **D-08:** ADMIN-05 feature-flag admin UI depth. **Per-user override ONLY at v1.2;** PostHog stays source of truth for cohort + default rules. New `feature_flag_overrides` table (`user_id`, `flag_key`, `value`, `set_by`, `set_at`, `expires_at`). PostHog client wraps `posthog.isFeatureEnabled(key)` with overrides-first check; if user-specific row exists AND `expires_at > now()`, use it; else fall through. CRUD UI: bool flags only at v1.2 (multivariate flags deferred to v1.3). Per-cohort overrides handled in PostHog dashboard.

### Claude's Discretion

- Members table search/filter UX — clone Phase 9/10 `/clinic/*` operator-roster pattern
- Refund/cancel/comp UI flow — Stripe Dashboard-style modal with confirmation text-entry
- Lifecycle email template HTML — reuse Phase 9 `clinic-invite/templates.ts` structure with v2 design tokens; 12 templates per ON-02 spec
- Email preference center route — `/settings/email-preferences`; per-category checkboxes; updates `consent_records.email_preferences` JSONB
- Soft-delete countdown UI — 7-day grace banner in AppShell + "undelete account" CTA in post-delete confirmation email
- Cookie banner copy — vanilla-cookieconsent default copy + leanshot brand voice; legal counsel review at go-live
- Audit log row structure — extend P7 `audit_logs` with `impersonator_id`, `target_user_id`, `action_type`
- DSAR ZIP packaging — concat JSON + PDF + Storage downloads server-side; upload to `dsar-exports` private bucket; signed URL emailed via Resend with 7-day TTL
- PostHog cohort rule sync — read-only mirror in admin UI showing which PostHog cohort a user is in

### Deferred Ideas (OUT OF SCOPE)

- ADMIN-07 ad-revenue dashboard → Phase 20
- ON-01 revamped 7-step onboarding → Phase 22b
- Per-cohort PostHog flag overrides → v1.3
- Multivariate (non-bool) feature flags → v1.3
- Multi-account admin (multiple owners with role splits) → v1.3
- Detailed PostHog cohort-builder UI in admin → v1.3
- Bulk refund/cancel actions → v1.3
- DSAR auto-fulfillment + S3/Drive upload → v1.3
- Co-shared data unwinding (delete-from-clinic) → v1.3 with legal sign-off
- Center-screen modal cookie banner variant → never (locked to bottom slide-up per D-07)
- iOS-native ≤3-tap compliance verification → P16 mobile shell

</user_constraints>

---

<phase_requirements>

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| **ADMIN-01** | Members table with search/filter (tier, signup, last-active, clinic, country, billing) + per-row quick actions | `/clinic/*` operator-roster pattern + `AdminAffiliatesScaffold` (already shipped); reuse `<Pill>` segmented + `<Badge>` tones; extend `tier_effective` view for unified tier display |
| **ADMIN-02** | MRR / ARR / churn chart with free-vs-paid + clinic-seat utilization | chart.js + `<BaseChart>` already in bundle; SQL view over `subscriptions` + `tier_effective`; reuse `<Sparkline>` for per-clinic seat utilization |
| **ADMIN-03** | Impersonation with red banner + audit_logs entry + 30-min auto-expire (READ-ONLY per D-05) | JWT-mint pattern via `supabase.auth.admin.generateLink({type:'magiclink'})` + custom claim `impersonator_id` via Custom Access Token Hook OR `admin.updateUserById({app_metadata:{impersonator_id}})` (option B simpler — see Pattern 1); RLS write-deny policy reads claim |
| **ADMIN-04** | Refunds (full/partial) + force-cancel subs + retry failed charges + comps — all audit-logged | Stripe SDK already in `src/lib/billing.ts`; new Edge Function `admin-stripe-action` wraps `stripe.refunds.create`, `stripe.subscriptions.update({cancel_at_period_end:true})`; writes audit_log row with admin actor + target_user_id |
| **ADMIN-05** | Per-user feature-flag overrides | New `feature_flag_overrides` table; client wrapper around `posthog.isFeatureEnabled()` — overrides-first check with `expires_at TTL` |
| **ADMIN-06** | Affiliate-payout review queue (consumes P19 fraud signals) | Extends `AdminAffiliatesScaffold` (already shipped); inline approve/hold/pay-out actions write to existing tables; **see Critical Conflict #1 — `confirmed` status transition needs an owner** |
| **ADMIN-08** | Cohort retention heatmap (signup-week × DAU day-0..90) | New `user_activity_daily` matview refreshed daily at 02:00 UTC pg_cron; CSS-grid render (no new chart primitive); reuses matview pattern from Phase 19 |
| **DEL-01** | ≤3 taps from in-app settings + typed-confirm + 7-day soft-delete grace + email-link cancel | Existing `DeleteAccountModal.tsx` (Phase 7) covers typed-confirm; SettingsPage modal trigger is tap #2; **CRITICAL: Phase 7 shipped 30-day grace; P22 spec calls for 7-day — see Critical Conflict #2** |
| **DEL-02** | account-delete cascade Edge Fn (Stripe + Connect + Resend + Storage + RLS) with retention exceptions | ALREADY SHIPPED in Phase 19 (`supabase/functions/account-delete/index.ts`, 517 lines, 10-step cascade including pre-flight Stripe Connect balance check); P22 contributes ONLY the UI surface |
| **GDPR-01** | Cookie consent banner (vanilla-cookieconsent + Consent Mode v2) with granular Essential/Analytics/Marketing/Personalization toggles; EU default off, US default analytics-on | vanilla-cookieconsent v3.1.0 (verified npm 2025-02); Pattern 4 below; dynamic-import gate via `src/lib/sync-defer.ts` analog |
| **GDPR-02** | `consent_records` table + dynamic-`import()` gating for PostHog / AdSense / Pixel / Meta | New `consent_records` table; PostHog dynamic-import already established in `src/lib/sync-defer.ts`; AdSense/Pixel/Meta scripts ship at P20 (gates plug in then) |
| **GDPR-03** | DSAR portal + `dsar_requests` table + `dsar-export` Edge Function (JSON + PDF, 30-day SLA, hashed referred emails per D-06) | jsPDF + jspdf-autotable already in deps with established dynamic-import pattern (`src/lib/export-data.ts`); new `dsar-export` Edge Fn; `dsar-exports` private Storage bucket; SHA-256 via Postgres `extensions.digest()` |
| **ON-02** | Resend lifecycle emails (12 templates: welcome-series + behavior-triggered + transactional + retention + preference-update) on new design tokens | Resend direct-HTTPS pattern from `clinic-invite/resend.ts` already proven; D-03 startup health check gate; 5 new Edge Functions; HTML inline-CSS only (no Tailwind) per UI-SPEC §Email Templates |
| **ON-03** | Self-serve email preference center | New `/settings/email-preferences` route; UPSERT to `consent_records.email_preferences` JSONB; Resend audience contact membership API |

**Note on ON-01 vs ON-03 disambiguation:** ON-01 is the *revamped 7-step onboarding flow* — DEFERRED to P22b per D-02. ON-03 is the *self-serve email preference center* (`/settings/email-preferences`) — IN SCOPE for P22 (it is a settings sub-page, not onboarding). The naming overlap in REQUIREMENTS.md is misleading; treat them as completely separate features.

</phase_requirements>

---

## Critical Conflicts (must resolve at plan time)

### Conflict #1: `affiliate_conversions.status='confirmed'` has no writer

Phase 19 BL-11 caught this pattern (per memory `feedback_status_machine_transition_owner.md`):
- Phase 19 Plan 19-04 writes `pending` on `invoice.paid`
- Phase 19 Plan 19-07 writes `flagged` on fraud-trigger
- Phase 19 Plan 19-09 monthly payout cron filters `status='confirmed'` for inclusion
- **Nobody writes `confirmed`** — payouts would never include conversions

**P22 ADMIN-06 owns the `pending → confirmed` transition** (admin review approve action). Plan-checker MUST verify the Approve button writes `confirmed` and a payout row gets eligible on next cron run.

### Conflict #2: 30-day vs 7-day soft-delete grace period

Phase 7 shipped `pending_account_deletions` with a hardcoded `interval '30 days'` in:
- `20260601000010_pending_account_deletions.sql` (comment)
- `20260601000013_finalize_account_deletions_cron.sql` (the cron `WHERE` clause)
- `src/components/dashboard/settings/DeleteAccountModal.tsx` toast copy: `"Account scheduled for deletion in 30 days."`

CONTEXT.md D-01 + UI-SPEC + DEL-01 + ROADMAP SC #2 all call for **7-day** grace + cancellable email link.

**Resolution required at plan-phase:** Either (a) ship a NEW migration that changes `interval '30 days'` to `interval '7 days'` in the cron + a NEW UI-copy update, OR (b) negotiate with user that 30 days is acceptable. **RECOMMENDATION:** Lock 7 days per the locked decision; ship `20270601000001_finalize_account_deletions_cron_seven_days.sql` (cron interval change + comment update) + edit `DeleteAccountModal.tsx` copy. The Resend "cancel deletion" transactional email becomes the new affordance (Phase 7 had no email).

### Conflict #3: Phase 22 UI-SPEC says preference center is ON-03; REQUIREMENTS.md says ON-03 is the Resend domain verification

REQUIREMENTS.md (line 191): `ON-03: User manages email preferences via self-serve preference center (per-category unsubscribe); Resend domain app.leanshot.app verified in Phase 0 (carry-over from v1.1)`

The two are conflated. P22 should ship the preference center (`/settings/email-preferences`). The Resend domain verification is a P12 prereq (already documented as STATE.md blocker). Plan-phase should treat ON-03 as "preference center" full stop; domain verify is just a precondition flagged via D-03.

---

## Standard Stack

### Core (already in package.json — VERIFIED via grep)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@supabase/supabase-js` | ^2.105.4 | Auth, RLS queries, Edge Function invoke | Project baseline since v1.1 |
| `posthog-js` | ^1.372.10 | Feature flag SDK (wrapped by override layer) | Existing |
| `jspdf` | ^4.2.1 | DSAR PDF generation (Pattern 7) | Already deployed via dynamic-import in `export-data.ts` |
| `jspdf-autotable` | ^5.0.7 | DSAR PDF tabular sections | Companion to jsPDF |
| `chart.js` | ^4.4.6 | MRR/ARR/churn chart + matview render | Already in bundle via `<BaseChart>` |
| `lucide-react` | ^0.460.0 | All admin icons | Project baseline |
| `stripe` | ^19.0.0 (devDep — for Deno Edge Fns) | Refund/cancel/comp Edge Fn | Phase 14 + Phase 19 pattern; pin to Stripe API `2026-04-22.dahlia` |
| `@sentry/react` | ^10.52.0 | Read-only-blocked-write breadcrumbs, Resend-skip counter breadcrumbs | Project baseline |

### NEW (to install)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `vanilla-cookieconsent` | `^3.1.0` | Cookie consent banner UI + Consent Mode v2 callbacks | VERIFIED npm registry 2025-02-04 (stable, 3.1.0 released); already approved at milestone level in STACK.md. Tree-shakeable ESM, zero deps. [CITED: npm view + Context7 /orestbida/cookieconsent] |

**Version verification commands run:**
```bash
npm view vanilla-cookieconsent version       # → 3.1.0 (stable, modified 2025-02-04)  [VERIFIED]
npm view jspdf version                       # → 4.2.1 (deps already 4.2.1)           [VERIFIED]
npm view jspdf-autotable version             # → 5.0.7 (deps already 5.0.7)           [VERIFIED]
npm view posthog-js version                  # → 1.373.5 latest (we ship 1.372.10 — minor patch behind, acceptable)  [VERIFIED]
npm view stripe version                      # → 22.1.1 latest (we ship 19.0.0 — Stripe SDK major versions are mostly additive; staying on 19 to match Phase 14/19) [VERIFIED]
```

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Postgres `pg_cron` | bundled | `user_activity_daily` matview refresh (02:00 UTC); 7-day soft-delete finalize cron interval change; lifecycle behavior-triggered email scheduler | New phase work |
| Postgres `pgcrypto` | bundled | SHA-256 hashing of referred-user emails in DSAR export (`extensions.digest(email::bytea, 'sha256')`) | DSAR D-06 |
| Resend HTTPS API | n/a | All 12 lifecycle emails + DSAR signed-URL delivery + soft-delete cancellation email | Pattern from `clinic-invite/resend.ts` |
| Vercel Edge headers | n/a | `request.geo.country` for EU vs US default-toggle logic | P12 already wired |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| vanilla-cookieconsent | OneTrust / Cookiebot | SaaS pricing $200+/mo; vanilla-cookieconsent is open-source MIT and was the milestone-level STACK choice |
| vanilla-cookieconsent | osano-cookieconsent | Older, less Consent-Mode-v2 documentation |
| JWT-mint impersonation | PG role switch via `set_config('role','authenticated',true) + set_config('request.jwt.claims',...)` inside one transaction | Doesn't work across HTTP requests — every supabase-js call would need to issue a multi-statement transaction. Hostile to REST API model. |
| JWT-mint impersonation | Magic-link sign-in as user (catjam.fi pattern) | Loses original admin identity (admin BECOMES user); harder to enforce read-only + audit; harder to expire |
| CSS-grid heatmap | New chart.js plugin | Heavier; chart.js doesn't have built-in heatmap; CSS-grid + `color-mix()` (already in spec) is simpler and on-token |
| `dsar-export` Edge Function ZIP server-side | Generate JSON+PDF client-side, ZIP via `jszip` in browser | Photos in Storage need signed URLs anyway; centralizing in Edge Fn keeps 30-day SLA tracker logic in one place; client-side ZIP fails for users with thousands of photos (memory) |
| jsPDF for PDF | Puppeteer / Playwright headless render | Heavier; jsPDF already in stack and dynamic-import-gated |

**Installation:**
```bash
npm install vanilla-cookieconsent@^3.1.0
```

---

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            BROWSER (React SPA)                              │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │  AppShell (existing) — adds:                                         │  │
│  │   ┌────────────────────────────────────────────────────────────────┐ │  │
│  │   │  ImpersonationBanner (red, sticky, 48px, countdown)            │ │  │
│  │   │  SoftDeleteCountdownBanner (7-day, with Cancel CTA)            │ │  │
│  │   │  CookieConsentBanner (bottom slide-up, vanilla-cookieconsent)  │ │  │
│  │   └────────────────────────────────────────────────────────────────┘ │  │
│  └─────────────────────┬──────────────────────────┬─────────────────────┘  │
│                        │                          │                         │
│         ┌──────────────▼──────┐    ┌──────────────▼────────────────┐       │
│         │  /admin/* routes    │    │  /settings/* (existing)        │       │
│         │  (is_staff gated)   │    │   + /settings/email-preferences│       │
│         │                     │    │   + /settings/privacy/dsar     │       │
│         │  • /admin/members   │    │   + DeleteAccountModal (Phase7)│       │
│         │  • /admin/members/X │    └──────────────┬─────────────────┘       │
│         │  • /admin/metrics   │                   │                         │
│         │  • /admin/affiliates│                   │                         │
│         │  • /admin/cohorts   │                   │                         │
│         └──────────┬──────────┘                   │                         │
└────────────────────┼──────────────────────────────┼─────────────────────────┘
                     │                              │
                     │  supabase-js (anon + JWT)    │
                     ▼                              ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                    SUPABASE (Postgres + Edge Functions + Auth)               │
│                                                                              │
│  ┌─────────────────────────────────┐   ┌───────────────────────────────────┐│
│  │  Edge Functions (NEW)            │   │  Postgres (NEW migrations)        ││
│  │                                  │   │                                   ││
│  │  • admin-impersonate             │──▶│  • feature_flag_overrides         ││
│  │    (mint JWT w/ impersonator_id  │   │  • consent_records                ││
│  │     custom claim; 30-min exp)    │   │  • dsar_requests                  ││
│  │                                  │   │  • user_activity_daily (matview)  ││
│  │  • admin-stripe-action           │──▶│  • cohort_retention (view)        ││
│  │    (refund/cancel/comp + audit)  │   │                                   ││
│  │                                  │   │  Extended:                         ││
│  │  • dsar-export                   │──▶│  • audit_logs gains action_type   ││
│  │    (JSON + PDF + Storage ZIP)    │   │    enum values (impersonate_*)     ││
│  │                                  │   │  • pending_account_deletions      ││
│  │  • lifecycle-welcome-series      │   │    cron interval 30d→7d           ││
│  │  • lifecycle-behavior-triggered  │   │                                   ││
│  │  • lifecycle-transactional       │   │  Existing (CONSUMED):              ││
│  │  • lifecycle-retention           │   │  • audit_logs (Phase 7)            ││
│  │  • lifecycle-preference-update   │   │  • profiles.is_staff (Phase 15)    ││
│  │   ↓ all 5 share D-03 health-check│   │  • subscriptions, tier_effective   ││
│  │                                  │   │    (Phase 14 + 19)                 ││
│  │  REUSED:                         │   │  • affiliate_* (Phase 19)          ││
│  │  • account-delete (Phase 19 —    │   │  • pending_account_deletions       ││
│  │    invoked by P22 DEL-01 UI)     │   │    (Phase 7)                       ││
│  │                                  │   │  • storage.objects + photos        ││
│  └─────────────────┬────────────────┘   └───────────────────────────────────┘│
│                    │                                                          │
│                    ▼                                                          │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  External APIs                                                         │  │
│  │   • Stripe (refund/cancel via stripe-node@19)                          │  │
│  │   • Resend (lifecycle emails + DSAR delivery + soft-delete cancel)     │  │
│  │   • Vercel Edge (request.geo.country for EU/US default)                │  │
│  │   • PostHog REST (cohort mirror read in admin UI — read-only)          │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Data flow examples:**
- *Owner clicks "Impersonate"*: Browser → `admin-impersonate` Edge Fn → mint JWT with `impersonator_id=admin_uuid, exp=now+30m` → return token → browser swaps session → AppShell sees `app_metadata.impersonator_id`, mounts ImpersonationBanner → RLS write-deny policy reads JWT claim → any write returns 42501.
- *User clicks "Delete my account"*: Browser → SettingsPage → DeleteAccountModal (existing) → typed-confirm → `initiate_account_deletion` RPC (existing) → `pending_account_deletions` row written → SoftDeleteCountdownBanner mounts in AppShell → Resend "cancel deletion" transactional email sent → on day 7 (NEW cron) `finalize_account_deletion` invokes `account-delete` Edge Fn (existing) → full cascade.
- *EU visitor lands on marketing*: Browser loads vanilla-cookieconsent (dynamically imported per Pattern 4) → Vercel Edge `request.geo.country` → `'DE' ∈ EU_COUNTRIES` → all non-Essential default OFF → banner mounts → user clicks "Accept all" → `onConsent` callback → `gtag('consent', 'update', {analytics_storage:'granted',...})` → dynamic-import PostHog → `consent_records` UPSERT.

### Recommended Project Structure

```
src/
├── components/
│   ├── admin/                           # extends existing scaffold
│   │   ├── AdminLayout.tsx              # NEW — admin shell with sub-nav
│   │   ├── pages/                       # NEW
│   │   │   ├── AdminMembersPage.tsx
│   │   │   ├── AdminMemberDrillInPage.tsx
│   │   │   ├── AdminMetricsPage.tsx
│   │   │   ├── AdminCohortsPage.tsx
│   │   │   └── AdminAffiliatesPage.tsx  # EXTENDS AdminAffiliatesScaffold.tsx (Phase 19)
│   │   ├── members/                     # NEW
│   │   │   ├── MembersTable.tsx
│   │   │   ├── MemberRowActions.tsx
│   │   │   ├── ImpersonateButton.tsx
│   │   │   ├── RefundModal.tsx          # 3-step
│   │   │   ├── CancelSubModal.tsx
│   │   │   └── FeatureFlagOverridePanel.tsx
│   │   └── cohorts/                     # NEW
│   │       └── CohortHeatmap.tsx        # CSS-grid implementation
│   ├── impersonation/                   # NEW
│   │   ├── ImpersonationBanner.tsx
│   │   ├── useImpersonation.ts          # hook reading JWT claims
│   │   └── useImpersonationReadOnly.ts  # disabled-props provider
│   ├── consent/                         # NEW
│   │   ├── CookieConsentBootstrap.tsx   # dynamic-imports vanilla-cookieconsent
│   │   └── consent-config.ts            # CookieConsent.run() config
│   ├── dsar/                            # NEW
│   │   ├── DsarPortalPage.tsx           # /settings/privacy/dsar
│   │   └── DsarStatusCard.tsx
│   ├── soft-delete/                     # NEW
│   │   └── SoftDeleteCountdownBanner.tsx
│   └── dashboard/
│       └── settings/                    # EXTENDS Phase 7
│           ├── DeleteAccountModal.tsx   # MODIFY copy 30d → 7d
│           ├── EmailPreferencesPage.tsx # NEW (ON-03)
│           └── SettingsPage.tsx         # MODIFY — link to /settings/email-preferences + /settings/privacy/dsar
│
├── lib/
│   ├── admin/                           # NEW
│   │   ├── admin-api.ts                 # admin_list_members, admin_approve_affiliate RPCs
│   │   └── admin-impersonate.ts         # Edge Fn invoker
│   ├── consent/                         # NEW
│   │   ├── consent-defer.ts             # analog of sync-defer.ts for vanilla-cookieconsent
│   │   ├── consent-records.ts           # UPSERT consent_records
│   │   └── feature-flag-overrides.ts    # wrapper around posthog.isFeatureEnabled
│   ├── dsar/                            # NEW
│   │   ├── dsar-export-client.ts        # Browser → Edge Fn invoke + status poll
│   │   └── dsar-pdf-render.ts           # jsPDF dynamic-import (mirrors export-data.ts pattern)
│   └── account-delete.ts                # EXISTING (Phase 7) — toast copy update only
│
supabase/
├── functions/
│   ├── admin-impersonate/               # NEW
│   ├── admin-stripe-action/             # NEW (refund/cancel/comp)
│   ├── dsar-export/                     # NEW
│   ├── lifecycle-welcome-series/        # NEW
│   ├── lifecycle-behavior-triggered/    # NEW
│   ├── lifecycle-transactional/         # NEW
│   ├── lifecycle-retention/             # NEW
│   ├── lifecycle-preference-update/     # NEW
│   ├── account-delete/                  # EXISTING (Phase 19) — no changes
│   └── _shared/                         # NEW
│       └── resend-domain-health-check.ts # D-03 shared helper for all 5 lifecycle fns
│
└── migrations/
    ├── 20270601000001_finalize_cron_seven_days.sql      # Conflict #2 resolution
    ├── 20270601000002_audit_logs_impersonation_cols.sql # action_type enum extension
    ├── 20270601000003_feature_flag_overrides_table.sql
    ├── 20270601000004_consent_records_table.sql
    ├── 20270601000005_dsar_requests_table.sql
    ├── 20270601000006_dsar_exports_storage_bucket.sql
    ├── 20270601000007_user_activity_daily_matview.sql
    ├── 20270601000008_user_activity_daily_refresh_cron.sql
    ├── 20270601000009_cohort_retention_view.sql
    ├── 20270601000010_admin_list_members_rpc.sql        # server-paginated
    ├── 20270601000011_admin_impersonate_rpcs.sql        # token-mint helper
    ├── 20270601000012_impersonation_write_deny_policies.sql # cross-table RLS
    └── 20270601000013_resend_domain_unverified_skips_counter.sql
```

### Pattern 1: Read-Only Impersonation via JWT Custom Claim + RLS Write-Deny

**What:** Owner clicks "Impersonate" → Edge Function mints a short-lived JWT for the target user with `impersonator_id` custom claim → browser swaps session → AppShell reads `app_metadata.impersonator_id` → every RLS write policy gates on `current_setting('request.jwt.claims', true)::json->>'impersonator_id' IS NULL`.

**When to use:** Owner/Admin tier explicitly needs read-as-user visibility for support/debugging without state mutation.

**Implementation choice (RECOMMENDED):** Use `supabase.auth.admin.updateUserById(targetId, {app_metadata: {impersonator_id: adminId, impersonation_exp: now+30m}})` to write the claim, then `supabase.auth.admin.generateLink({type:'magiclink', email: target.email})` to mint a session. Banner reads `useStore` for both claims. On end-impersonation, `updateUserById(targetId, {app_metadata: {impersonator_id: null, impersonation_exp: null}})` clears + admin re-signs-in as themselves.

**Alternative considered (more complex):** Supabase Custom Access Token Hook — function runs at JWT-mint time and injects claim. Requires Supabase Auth Hooks (a feature) — defer to v1.3 if hook plumbing is non-trivial.

**Example (RLS write-deny policy fragment — applied across ALL user-writable tables):**
```sql
-- Apply to: injections, weights, meals, workouts, supplements, mood, sleep,
-- symptoms, vials, settings, photos, ai_messages, shares, consent_records,
-- pending_account_deletions, feature_flag_overrides
create policy "deny_writes_during_impersonation_INSERT"
  on public.injections
  for insert to authenticated
  with check (
    current_setting('request.jwt.claims', true)::json->>'app_metadata' IS NULL
    OR (current_setting('request.jwt.claims', true)::json
         #>> '{app_metadata,impersonator_id}') IS NULL
  );
-- Repeat for UPDATE + DELETE; existing owner policies still apply.
```

**Example (client-side disabled-props hook):**
```typescript
// src/components/impersonation/useImpersonationReadOnly.ts
// Source: Phase 22 Pattern 1
export function useImpersonationReadOnly() {
  const claims = useStore((s) => s.signedIn?.session?.user?.app_metadata);
  const impersonating = !!claims?.impersonator_id;
  if (!impersonating) return { disabled: false, props: {} };
  return {
    disabled: true,
    props: {
      disabled: true,
      'aria-disabled': true,
      title: 'Read-only during impersonation',
    },
  };
}
```

[ASSUMED] The `app_metadata` write via `admin.updateUserById` is reflected in the NEXT minted JWT (not the existing session). The catjam.fi article confirms that magic-link sign-in produces a fresh JWT carrying the new `app_metadata`. Need to verify at plan time that `app_metadata` mutations propagate to RLS within 1 request cycle (no Auth server cache). If they don't, fallback to Custom Access Token Hook.

### Pattern 2: Resend Domain Gated-Send Health Check (D-03)

**What:** Each of the 5 lifecycle Edge Functions calls `resendDomainHealthCheck()` at startup. If `app.leanshot.app status !== 'verified'`, function logs warning + increments `resend_domain_unverified_skips` counter + Sentry breadcrumb + returns 200 WITHOUT sending. When user verifies DNS, next invocation passes the gate. Zero code-change cutover.

**When to use:** All ON-02 lifecycle email sends; the existing `clinic-invite` function should be RETROFITTED to use this shared helper in a follow-up (out of P22 scope but flagged in Open Questions).

**Example:**
```typescript
// supabase/functions/_shared/resend-domain-health-check.ts
// Source: Phase 22 D-03 + reference_vendor_gated_send_health_check.md
const DOMAIN = 'app.leanshot.app';

export async function resendDomainHealthCheck(supabase: SupabaseClient): Promise<{ok: boolean; status: string}> {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  if (!apiKey) return { ok: false, status: 'no_api_key' };
  if (apiKey === 'test-stub') return { ok: true, status: 'verified' };

  const res = await fetch(`https://api.resend.com/domains`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) return { ok: false, status: `resend_${res.status}` };
  const { data } = await res.json();
  const domain = data?.find((d: any) => d.name === DOMAIN);
  const verified = domain?.status === 'verified';
  if (!verified) {
    // D-03: increment counter + Sentry breadcrumb
    await supabase.rpc('increment_resend_domain_unverified_skips');
    console.warn(`[lifecycle] Resend domain ${DOMAIN} status=${domain?.status ?? 'not_found'} — skipping send`);
  }
  return { ok: verified, status: domain?.status ?? 'not_found' };
}
```

### Pattern 3: Cookie Consent + Consent Mode v2 (vanilla-cookieconsent v3)

**What:** Bottom slide-up banner with "Accept all / Reject all / Customize" + inline-expand to 4 toggles (Essential / Analytics / Marketing / Personalization). `onConsent` callback fires `gtag('consent','update',...)` per Consent Mode v2 spec. UPSERT to `consent_records` server-side for audit.

**When to use:** First page load by any visitor on marketing or app shell; persists in `cc_cookie` localStorage entry; admin can revoke via `/settings/privacy/cookies` (also opens the banner).

**Example (consent-config.ts):**
```typescript
// src/components/consent/consent-config.ts
// Source: Context7 /orestbida/cookieconsent + Phase 22 D-07
import * as CookieConsent from 'vanilla-cookieconsent';
import { upsertConsentRecord } from '@/lib/consent/consent-records';

const isEU = window.__VERCEL_GEO__?.country && EU_COUNTRIES.includes(window.__VERCEL_GEO__.country);

window.dataLayer = window.dataLayer || [];
function gtag(...args: any[]) { dataLayer.push(arguments); }

// Default state: deny everything (Consent Mode v2 requires this BEFORE any
// gtag('config') call).
gtag('consent', 'default', {
  ad_storage: 'denied',
  ad_user_data: 'denied',
  ad_personalization: 'denied',
  analytics_storage: isEU ? 'denied' : 'granted', // CCPA opt-out: US = analytics on
  functionality_storage: 'granted',
  personalization_storage: 'denied',
  security_storage: 'granted',
});

function updateGtagConsent() {
  gtag('consent', 'update', {
    analytics_storage: CookieConsent.acceptedCategory('analytics') ? 'granted' : 'denied',
    ad_storage: CookieConsent.acceptedCategory('marketing') ? 'granted' : 'denied',
    ad_user_data: CookieConsent.acceptedCategory('marketing') ? 'granted' : 'denied',
    ad_personalization: CookieConsent.acceptedCategory('marketing') ? 'granted' : 'denied',
    personalization_storage: CookieConsent.acceptedCategory('personalization') ? 'granted' : 'denied',
  });
}

export function initCookieConsent() {
  CookieConsent.run({
    guiOptions: {
      consentModal: {
        layout: 'box inline',           // bottom slide-up per D-07
        position: 'bottom right',       // or 'bottom center' — UI-SPEC decides
        equalWeightButtons: true,
      },
      preferencesModal: {
        layout: 'box',                  // inline-expand toggles per D-07
      },
    },
    cookie: { name: 'cc_cookie', expiresAfterDays: 182 },
    categories: {
      necessary: { enabled: true, readOnly: true },
      analytics: {
        enabled: !isEU,
        autoClear: { cookies: [{name: /^ph_/}, {name: '_ga'}] }, // PostHog + GA cleanup
      },
      marketing: { enabled: false, autoClear: { cookies: [{name: '_fbp'}] } },
      personalization: { enabled: false },
    },
    onFirstConsent: ({cookie}) => { updateGtagConsent(); void upsertConsentRecord(cookie); },
    onConsent: ({cookie}) => { updateGtagConsent(); void upsertConsentRecord(cookie); },
    onChange: ({cookie}) => { updateGtagConsent(); void upsertConsentRecord(cookie); },
  });
}
```

### Pattern 4: Dynamic-Import Gate for vanilla-cookieconsent (Bundle Budget)

**What:** vanilla-cookieconsent ships ~5-7 kB gz [ASSUMED — need to verify with vite build]; even that is too much for the initial paint budget (50 kB ceiling, holding at 21 kB). Defer-import via `src/lib/sync-defer.ts` analog. Banner is non-blocking per D-07; deferral is invisible to user.

**When to use:** Always for new third-party libs > 2 kB gz; established project rule (memory `project_phase5_bundle_regression.md`).

**Example (consent-defer.ts):**
```typescript
// src/lib/consent/consent-defer.ts — analog of src/lib/sync-defer.ts
type ConsentCall = { kind: 'init' };
const buffer: ConsentCall[] = [];
let initialized = false;

export function scheduleConsentInit() {
  buffer.push({ kind: 'init' });
  if (initialized) return;
  const fire = () => void loadConsent();
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(fire, { timeout: 2000 });
  } else {
    setTimeout(fire, 200);
  }
}

async function loadConsent() {
  if (initialized) return;
  initialized = true;
  const { initCookieConsent } = await import('@/components/consent/consent-config');
  initCookieConsent();
}
```

### Pattern 5: 7-Day Soft-Delete Cron Interval Update + Cancellable Email Link

**What:** Override the Phase 7 `interval '30 days'` in the finalize cron with `interval '7 days'`. The cron's `WHERE initiated_at <= now() - interval '7 days'` is still IMMUTABLE-safe (no expression index on the WHERE clause, just a range scan on `initiated_at`). Add Resend "deletion scheduled" transactional email with `cancel_url=https://leanshot.app/settings/cancel-deletion?token=...` (token: signed by `auth.uid()` + `initiated_at`; cancellation deletes the `pending_account_deletions` row).

**When to use:** ONE new migration overrides the cron interval; ONE new RPC `cancel_account_deletion(token)`; ONE Resend transactional template.

**Example (migration sketch):**
```sql
-- supabase/migrations/20270601000001_finalize_cron_seven_days.sql
-- Phase 22 DEL-01: shorten soft-delete grace 30d → 7d (CONTEXT D-01 + ROADMAP SC #2).
-- Phase 7 finalize cron WHERE clause was `initiated_at <= now() - interval '30 days'`;
-- this migration unschedules + re-schedules with `'7 days'`. The cron's
-- partial-index predicate `finalize_attempts < 5` is unchanged.

select cron.unschedule('finalize_account_deletions_daily');
select cron.schedule(
  'finalize_account_deletions_daily',
  '0 4 * * *',
  $$
  select public.finalize_account_deletions_batch();
  $$
);
-- The finalize_account_deletions_batch() function body needs an ALTER FUNCTION
-- to change the interval literal — see companion migration ...000002.

alter function public.finalize_account_deletions_batch()
  rename to finalize_account_deletions_batch_30d;
create or replace function public.finalize_account_deletions_batch()
returns void
security definer
set search_path = public, pg_catalog
language plpgsql
as $$
declare
  victim record;
begin
  for victim in
    select user_id
      from public.pending_account_deletions
     where initiated_at <= now() - interval '7 days'  -- D-01 CHANGE
       and finalize_attempts < 5
  loop
    begin
      perform public.finalize_account_deletion(victim.user_id);
    exception when others then
      update public.pending_account_deletions
         set finalize_attempts = finalize_attempts + 1
       where user_id = victim.user_id;
    end;
  end loop;
end
$$;
```

### Pattern 6: DSAR Export (JSON + PDF + Storage ZIP)

**What:** User → DSAR portal → POST `dsar-export` Edge Fn → fn creates `dsar_requests` row (status='in_progress') → fn aggregates: (a) Postgres tables via service-role SELECT, (b) Storage signed URLs for photos, (c) jsPDF render of 7-section summary, (d) ZIP via Deno `zipjs` or shell-out, (e) upload to `dsar-exports` private bucket, (f) sign 7-day TTL URL, (g) Resend transactional email with download link, (h) update `dsar_requests` status='completed'.

**Co-shared redaction (D-06):** Affiliate `affiliate_conversions.converter_user_id` JOIN → email retrieval → SHA-256 hash via `extensions.digest(email::bytea, 'sha256')` → hex-encode → include in export instead of plaintext.

**Example (jsPDF dynamic-import — mirrors export-data.ts):**
```typescript
// src/lib/dsar/dsar-pdf-render.ts
// Source: src/lib/export-data.ts pattern; Phase 22 D-06
import type { jsPDF as JsPDFType } from 'jspdf';
import type autoTableFn from 'jspdf-autotable';

export async function renderDsarPdf(data: DsarBundle): Promise<Blob> {
  // Dynamic-import — keeps initial bundle under 50 kB gz ceiling
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;
  const doc: JsPDFType = new jsPDF();

  // Section 1: Profile
  doc.setFontSize(18);
  doc.text('Your LeanShot Data Export', 14, 20);
  doc.setFontSize(11);
  doc.text(`Generated: ${new Date().toISOString()}`, 14, 28);

  // Section 2: Subscriptions (autotable)
  autoTable(doc, {
    head: [['Plan', 'Status', 'Started', 'Renews']],
    body: data.subscriptions.map(s => [s.plan, s.status, s.start, s.renewal]),
    startY: 40,
  });
  // ... 6 more sections per D-06
  return doc.output('blob');
}
```

### Anti-Patterns to Avoid

- **Hardcoding admin email allowlist in code.** Use `profiles.is_staff` server-side; client gate is UX-only. Pattern established Phase 15.
- **Storing impersonator_id in localStorage.** It belongs in JWT app_metadata (so RLS enforces it). Client-side state is bypassable.
- **Letting the cookie banner load at first paint.** Defer per Pattern 4 or eat the 5-7 kB hit on FCP.
- **Generating DSAR PDF in the browser.** Photos in Storage need signed URLs anyway; browser-side ZIP fails for users with thousands of photos. Server-side ZIP is one-and-done.
- **Embedding plaintext referred-user emails in DSAR.** D-06 requires SHA-256 hashing of cross-tenant data; ANY plaintext leak is a regulatory finding.
- **Adding NEW columns to `audit_logs` without a migration ordering plan.** Phase 7+ has 9 audit_logs-touching migrations; ordering matters (see Pitfall 3 below).
- **Re-implementing the account-delete cascade.** Phase 19 shipped a 517-line, threat-modeled, test-covered Edge Function. P22 is ONLY a UI surface for invoking it.
- **Spinning up a new admin scaffold.** Extend `src/components/admin/AdminAffiliatesScaffold.tsx`'s pattern (is_staff gate + Pill segmented + Badge tones + InitialsAvatar).
- **Building a chart.js heatmap plugin.** CSS-grid + `color-mix(in srgb, ...)` per UI-SPEC is simpler and stays on-token.
- **Treating the impersonator banner as cosmetic.** RLS write-deny IS the security; UI is UX. Both layers required.
- **Embedding Tailwind classes in Resend email HTML.** Gmail/Outlook strip them. Inline-CSS only per UI-SPEC §Email Templates.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cookie consent UI + Consent Mode v2 wrapper | Custom toggles + custom localStorage + custom gtag plumbing | `vanilla-cookieconsent@3.1.0` | 4 years of edge cases (autoshow, sub-cookies, revision bumps); native Consent Mode v2 integration with `acceptedService` API; ESM + tree-shakeable + zero deps |
| PDF generation for DSAR | Custom HTML→PDF render | `jspdf` + `jspdf-autotable` (already in stack) | Project pattern; bundle-budget compliant via dynamic-import |
| ZIP packaging in Edge Fn | Manual file concatenation | Deno standard library `archive` module OR `https://deno.land/x/zipjs` | Battle-tested; streaming-friendly |
| Cohort retention SQL | Custom Postgres aggregation per query | Materialized view refreshed by pg_cron (Phase 19 pattern) | Refresh time amortized; query is `SELECT * FROM matview`; 1183-cell render is trivial |
| Stripe refund/cancel | Manual `fetch` to Stripe API | `stripe-node@19` SDK (already in project) | Phase 14 + 19 established pattern; webhook signature verification utilities included |
| Resend HTTPS dispatch | New SDK adoption | Direct HTTPS pattern from `clinic-invite/resend.ts` | Project rule per `reference_resend_phase9_wiring.md`; smaller bundle |
| Audit log writes | Manual INSERT from every admin RPC | SECURITY DEFINER trigger function (Phase 7 pattern) | Cannot be bypassed; centralized retention logic |
| JWT minting for impersonation | Custom token signing | `supabase.auth.admin.generateLink({type:'magiclink'})` | Server signs with Supabase's JWKS; existing key rotation; verified in `auth.users` table |
| EU vs US geo-detection | IP geolocation API call | Vercel Edge `request.geo.country` (already wired P12) | Free; ms latency; no new dependency |
| Soft-delete cancellation token | Custom token scheme | Signed JWT (HMAC with Vault secret) OR Postgres `pgcrypto` HMAC | Avoid rolling crypto |
| Status badges (DSAR, impersonation, etc.) | New `<StatusBadge>` primitive | Existing `<Badge tone="info|success|warning|danger|neutral">` | UI-SPEC §Color → no new primitives |

**Key insight:** Phase 22 is composition, not greenfield. Every architectural primitive needed is already in the codebase from P7/P14/P15/P19. The risk surface is in the COMBINATIONS (impersonation × RLS, cookie consent × dynamic-import, DSAR × hash-pseudonymization), not the parts. Plan tasks should explicitly call out the EXISTING file being extended.

---

## Runtime State Inventory

Phase 22 is mostly greenfield UI on top of existing schemas, but DEL-01 + the impersonation deployment + cookie-consent rollout have small inventory items:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| **Stored data** | Existing `pending_account_deletions` rows written under the 30-day regime. After cron migration, any "30-day pending" rows finalize within 7 days of cron deploy (could be IMMEDIATELY if `initiated_at < now() - 7 days`). | **Plan-time decision:** (a) accept 30-day rows finalize next cron run after deploy (small population, never deployed to production users), OR (b) ship a one-time data migration that re-stamps `initiated_at = now()` for rows with `initiated_at < now() - 7 days` to give them another 7-day window. Recommend (a) — Phase 7 was deployed to a small test cohort; verify via `select count(*) from pending_account_deletions` at plan-time. |
| **Live service config** | Resend `audiences` membership for all existing users (lifecycle email opt-in state). Currently NONE — Resend was used only for clinic-invite + soon for affiliate-apply. | After ON-02 ships, a one-time backfill `script/seed-resend-audience.ts` populates Resend audience with all existing user emails + `email_preferences` defaults (all opt-in EXCEPT marketing). Document as a P22 closeout task. |
| **OS-registered state** | None — no OS-level registrations carry Phase 22 strings. | None — verified by inspection (no Task Scheduler, no launchd, no systemd). |
| **Secrets/env vars** | `RESEND_API_KEY`, `RESEND_FROM` (already in Function secrets per P12 prereq). NEW: `IMPERSONATION_JWT_SIGNING_KEY` if going Custom-Access-Token-Hook route. NEW: `CANCEL_DELETION_HMAC_KEY` for soft-delete cancel link signing. | (a) Verify `RESEND_FROM=LeanShot <noreply@app.leanshot.app>` (UAT-probe per `reference_supabase_edge_function_deploy.md`). (b) Mint two new secrets at plan time + document in P22 SUMMARY.md vendor-pass list. |
| **Build artifacts** | None — vanilla-cookieconsent is npm-installed; no native build steps. | None. |

---

## Common Pitfalls

### Pitfall 1: Postgres `set_config('app.X', val, true)` GUC does NOT survive across PostgREST requests

**What goes wrong:** Naïve plan: client calls `supabase.rpc('set_impersonator', {id:adminId})` which does `set_config('app.impersonator_id', $1, true)`. Next `supabase.from('injections').select()` returns empty because the GUC reset between requests.

**Why it happens:** PostgREST runs each HTTP request in its own transaction. The `local=true` flag scopes the GUC to that transaction. The next request is a fresh transaction.

**How to avoid:** Use a **JWT claim** (`app_metadata.impersonator_id`) — supabase-js sends the JWT on every request, PostgREST sets `request.jwt.claims` GUC at request-start time, RLS policies read from it. This is THE standard pattern (Pattern 1 above).

**Warning signs:** Tests that pass with everything in one query but fail with two-step flows; RLS that "works in Studio's SQL editor but not via supabase-js."

[CITED: PostgREST docs — `set_config('response.X', val, true)` is transaction-local; `request.jwt.claims` is the per-request equivalent set by PostgREST itself]

### Pitfall 2: Supabase migration filename regex strictly enforces `<14-digits>_name.sql`

**What goes wrong:** A migration like `20270601000001a_fix.sql` (letter suffix on timestamp) silently SKIPS in `supabase db push` — exit 0, one `Skipping migration` line in dry-run, no error in live push. Phase 19 BL-10 had to renumber 10 files.

**How to avoid:** Strictly use `<14-digit-timestamp>_<name>.sql`. When inline-fixing a new "between" migration, use end-of-sequence timestamp OR renumber downstream. Plan-checker BLOCKER on letter suffixes.

**Warning signs:** `supabase db push --dry-run` output containing `Skipping migration` — grep for it before live push.

[CITED: project memory `reference_supabase_migration_filename_regex.md`]

### Pitfall 3: New enum values can't be used in the same transaction they're added

**What goes wrong:** Phase 22 will extend `audit_actor_type` and `audit_action_type` enums with values like `impersonate_start`, `impersonate_end`, `impersonate_blocked_write`, `refund_issued`. If you add the enum value AND use it in a default/check/partial-index WHERE in the same migration file, Postgres rejects with `SQLSTATE 55P04: unsafe use of new value of enum type`. Phase 9 hit this; split migrations resolved it.

**How to avoid:** Use TWO migrations: first adds enum values (`ALTER TYPE ADD VALUE if not exists ...`); second references them. Idempotent `if not exists` on both.

**Warning signs:** Migration fails at column-default time with 55P04.

[CITED: project memory `feedback_planner_iter1_anti_patterns.md` (Postgres DDL transaction safety) + existing migration `20260801000000_audit_actor_type_extend.sql`]

### Pitfall 4: `audit_logs` cascade triggers fire during `account-delete`, creating extra audit rows mid-cascade

**What goes wrong:** Phase 7 fixed this with `app.suppress_audit` GUC hook (`20260601000017_audit_trigger_suppress_guc.sql`). If new admin RPCs (refund, cancel, comp) write to audit_logs directly AND also trigger cascading writes, the trigger fires AGAIN creating duplicate skeleton rows.

**How to avoid:** Admin RPCs that intentionally write audit_log rows MUST `perform set_config('app.suppress_audit', 'true', true);` at the top of the function body to disable the trigger for the rest of the transaction.

**Warning signs:** Duplicate audit_log rows for one admin action; row counts off-by-N where N = number of trigger-attached tables touched.

[CITED: project memory `reference_supabase_migration_gotchas.md` + existing migration]

### Pitfall 5: Storage `delete()` requires `set_config('storage.allow_delete_query', 'true', true)` for cascade-direct deletes

**What goes wrong:** DSAR-export Edge Fn signing URLs is read-only (safe). But the account-delete cascade (Phase 19 already handles this — listed for awareness only) needs to wipe `dsar-exports/{user_id}/*` if a DSAR ZIP was generated. Direct `storage.objects` DELETE without the GUC raises a constraint error.

**How to avoid:** Phase 22 task that touches Storage object deletion (e.g., 7-day TTL cleanup of DSAR exports) must set the GUC.

**Warning signs:** Storage cleanup function fails with `storage delete query forbidden`.

[CITED: project memory `reference_supabase_migration_gotchas.md`]

### Pitfall 6: Resend free-tier rate limit (2/hour per recipient on shared domain) breaks lifecycle e2e

**What goes wrong:** Welcome-series day-0 + day-1 + day-3 + day-7 fired against the same test recipient triggers `resend_429`. Phase 5 e2e hit this with password-reset.

**How to avoid:** Use `admin.generateLink()` server-side for tests (project rule from `reference_supabase_auth_traps.md`); for lifecycle tests, mock Resend at the Edge Fn boundary via the `RESEND_API_KEY=test-stub` short-circuit already in `clinic-invite/resend.ts`. New `lifecycle-*` functions MUST adopt the same stub pattern.

**Warning signs:** CI flakes on welcome-series tests with HTTP 429 from Resend.

[CITED: project memory `reference_supabase_auth_traps.md` + `clinic-invite/resend.ts:46`]

### Pitfall 7: vanilla-cookieconsent's `acceptedService()` requires `services` declared inside `categories`, NOT bare `acceptedCategory()`

**What goes wrong:** Plan adopts `acceptedCategory('analytics')` for the gate. PostHog wraps fine. Later, Consent Mode v2 audit fails because Google distinguishes `analytics_storage` vs `ad_storage` at the service level — `acceptedCategory` is coarser.

**How to avoid:** Per Context7 docs, declare `services` inside each `category`, then use `CookieConsent.acceptedService(service, category)` for the per-service gate. The Consent Mode v2 docs example (Pattern 3) shows both APIs side-by-side.

**Warning signs:** Google Tag Manager preview tool shows `ad_storage=denied` even after user accepted Marketing.

[CITED: Context7 /orestbida/cookieconsent — "Update gtag consent according to the users choices" example uses `acceptedService(SERVICE_AD_STORAGE, CAT_ADVERTISEMENT)`]

### Pitfall 8: Gmail/Outlook strip `<style>` blocks → lifecycle emails MUST use inline CSS only

**What goes wrong:** Reuse of `src/components/ui/Card.tsx` JSX-with-classes for email templates. Gmail's HTML sanitizer strips `<style>`, leaving unstyled HTML.

**How to avoid:** Per UI-SPEC §Email Templates "Lifecycle email templates are a SEPARATE rendering target (hand-coded HTML + inline CSS for Gmail/Outlook compat) — they CANNOT use Tailwind utility classes; this spec includes the token-to-inline-CSS mapping." Each `lifecycle-*` Edge Fn ships HTML template strings with `style="..."` on every element.

**Warning signs:** Email preview tools (Litmus, Mailtrap) showing unstyled HTML on Outlook 2016/Gmail iOS.

[CITED: UI-SPEC §Email Templates — verified via Read]

### Pitfall 9: Phase 7 30-day grace period UI copy is HARDCODED in DeleteAccountModal.tsx

**What goes wrong:** Migration changes the cron from 30 → 7 days but the toast still says `"Account scheduled for deletion in 30 days."`. User experience drift; UAT fails.

**How to avoid:** Plan tasks MUST grep for `"30 days"` across `src/` + `e2e/` and update all references. The grep target: `git grep "30 days" src/ e2e/`.

**Warning signs:** Tests pass but UAT click-through shows mismatched copy.

[VERIFIED via Read: `src/components/dashboard/settings/DeleteAccountModal.tsx` line ~67 + a likely test assertion against the exact string]

### Pitfall 10: PostHog override wrapper must check `expires_at > now()` AND clean up expired rows

**What goes wrong:** `feature_flag_overrides` rows with past `expires_at` stay in the table forever; queries become slow; orphans confuse admins viewing the override panel.

**How to avoid:** (a) The client wrapper filter `WHERE expires_at > now()` is mandatory in the SQL query; (b) ship a daily pg_cron `DELETE FROM feature_flag_overrides WHERE expires_at < now() - interval '7 days'` (grace window for audit).

**Warning signs:** Admin UI shows hundreds of "expired" overrides; PostHog admin gates return wrong values for users whose override JUST expired.

[ASSUMED — based on `expires_at TTL` pattern from CONTEXT D-08; no existing project precedent yet]

---

## Code Examples

### Common Operation 1: Admin members table — server-paginated RPC

```sql
-- supabase/migrations/20270601000010_admin_list_members_rpc.sql
create or replace function public.admin_list_members(
  p_search text default null,
  p_tier text default null,
  p_page int default 1,
  p_size int default 50
) returns table (
  user_id uuid,
  email text,
  tier text,
  signup_date timestamptz,
  last_active timestamptz,
  clinic_name text,
  country text,
  stripe_status text
)
security definer
set search_path = public, pg_catalog
language plpgsql
as $$
begin
  -- is_staff gate (Phase 15 pattern + Phase 19)
  if not exists (select 1 from public.profiles where id = auth.uid() and is_staff = true) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
    select
      u.id,
      u.email,
      te.tier,
      u.created_at,
      u.last_sign_in_at,
      o.name,
      s.country,
      s.status
    from auth.users u
    left join public.tier_effective te on te.user_id = u.id
    left join public.org_members om on om.user_id = u.id
    left join public.orgs o on o.id = om.org_id
    left join public.subscriptions s on s.user_id = u.id and s.status in ('active','past_due','trialing')
    where (p_search is null or u.email ilike '%' || p_search || '%')
      and (p_tier is null or te.tier = p_tier)
    order by u.created_at desc
    limit p_size offset ((p_page - 1) * p_size);
end
$$;
```

### Common Operation 2: vanilla-cookieconsent bottom slide-up init

See Pattern 3 above for the full config; key lines:
```typescript
guiOptions: {
  consentModal: { layout: 'box inline', position: 'bottom right' }, // bottom slide-up per D-07
  preferencesModal: { layout: 'box' },  // inline-expand toggles
}
```

### Common Operation 3: DSAR PDF render via dynamic-import jsPDF

See Pattern 6 above. Mirrors `src/lib/export-data.ts` pattern.

### Common Operation 4: Cohort retention matview

```sql
-- supabase/migrations/20270601000007_user_activity_daily_matview.sql
-- Phase 22 ADMIN-08 (D-04): user_activity_daily matview for cohort heatmap.
-- Source-of-truth: auth.users.last_sign_in_at (D-04). PostHog `last_event_at`
-- not used (system-of-record is Supabase).

create materialized view public.user_activity_daily as
select
  u.id as user_id,
  date_trunc('week', u.created_at)::date as cohort_week,
  date_trunc('day', u.last_sign_in_at)::date as activity_day,
  (date_trunc('day', u.last_sign_in_at) - date_trunc('week', u.created_at))::int as day_offset
from auth.users u
where u.last_sign_in_at is not null;

create unique index idx_uad_user
  on public.user_activity_daily(user_id, activity_day);  -- supports REFRESH CONCURRENTLY (Pitfall 5)

-- Companion view for the heatmap query (1183-cell render):
create or replace view public.cohort_retention as
select
  cohort_week,
  day_offset,
  count(distinct user_id)::int as active_users,
  (count(distinct user_id)::float / nullif(
    (select count(*) from auth.users where date_trunc('week', created_at)::date = uad.cohort_week),
    0
  )) * 100 as retention_pct
from public.user_activity_daily uad
where day_offset between 0 and 90
group by cohort_week, day_offset
order by cohort_week desc, day_offset asc;
```

Companion cron migration: `select cron.schedule('user_activity_daily_refresh', '0 2 * * *', $$refresh materialized view concurrently public.user_activity_daily;$$);`

### Common Operation 5: Feature-flag override wrapper

```typescript
// src/lib/consent/feature-flag-overrides.ts
import { posthog } from 'posthog-js';
import { supabase } from '@/lib/supabase';

const overrideCache = new Map<string, { value: boolean; exp: number }>();

export async function loadOverrides(userId: string): Promise<void> {
  const { data } = await supabase
    .from('feature_flag_overrides')
    .select('flag_key,value,expires_at')
    .eq('user_id', userId)
    .gt('expires_at', new Date().toISOString());
  data?.forEach((row) => overrideCache.set(row.flag_key, {
    value: row.value,
    exp: new Date(row.expires_at).getTime(),
  }));
}

export function isFeatureEnabled(key: string): boolean {
  const o = overrideCache.get(key);
  if (o && o.exp > Date.now()) return o.value;
  return !!posthog.isFeatureEnabled(key);
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hardcoded user-impersonation password reset → admin signs in AS user | JWT mint with `impersonator_id` custom claim + RLS write-deny | Supabase Auth Hooks GA 2024; pattern dominant 2025+ | Audit trail preserved (admin identity in claim); read-only enforced at DB layer |
| Cookie consent banners as bare HTML toggles | vanilla-cookieconsent + Consent Mode v2 (Google) | Consent Mode v2 mandatory in EEA March 2024 | Banner doesn't just hide cookies — it tells Google's tag manager which data to dropped at the SDK layer |
| `auth.users.banned_until` for "soft suspend" | Custom `pending_account_deletions` table | Phase 7 pattern (2026-Q2) | Cleaner separation of "scheduled to delete" vs "banned" — different UX, different cron |
| Per-user JSONB column for feature flag overrides | Separate `feature_flag_overrides` table with TTL | Industry norm 2024+ | Override audit trail (set_by, set_at, expires_at); cleanup cron eligible; no JSON parsing per render |
| Server-side cookie banner geofence | Vercel Edge `request.geo.country` injected at SSR/CSR boundary | Vercel 2023+; project pattern P12 | No third-party IP-geo dependency; ms latency; free |
| Manual SHA-256 in app code for cross-tenant pseudonymization | Postgres `extensions.digest()` from pgcrypto | Postgres 14+ standard | One hash function; same algorithm browser/server; no app-level keying |
| Polling for DSAR completion | `dsar_requests.status` realtime subscription | Supabase Realtime stable 2025+ | UX is "status updates live" not "refresh page in 30 min" |

**Deprecated/outdated:**
- **pgsodium** for envelope encryption: deprecated on managed Supabase (per memory `reference_phase7_research_findings.md`). Don't try to encrypt DSAR exports at-rest column-level; use Storage at-rest encryption (default) + signed URL TTL.
- **Supabase Studio's "Switch User" feature for prod debugging:** explicitly NOT production-grade per Supabase docs (Studio-only). Phase 22 ships an in-app impersonation surface for prod use.
- **OneSignal for cookie consent:** unmaintained as a consent solution; vanilla-cookieconsent is the de-facto OSS pick.

---

## Assumptions Log

> Claims tagged `[ASSUMED]` above. Planner + discuss-phase should confirm with user OR validate at plan-time before locking.

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `app_metadata` writes via `supabase.auth.admin.updateUserById()` propagate to the NEXT minted JWT (not the existing session) within one request cycle | Pattern 1, Pitfall fallback note | HIGH — if there's an Auth-server cache delay, impersonation banner mounts before RLS sees claim → window of failed reads. Fallback: Custom Access Token Hook. Verify at plan time with a 5-minute Postman probe. |
| A2 | vanilla-cookieconsent v3.1.0 minified+gzipped is ~5-7 kB | Pattern 4, Stack | LOW — even if 10 kB, dynamic-import gate makes it bundle-invisible at first paint. Verify with `vite build` after install. |
| A3 | Daily pg_cron `DELETE FROM feature_flag_overrides WHERE expires_at < now() - interval '7 days'` is the right cleanup cadence | Pitfall 10 | LOW — pure cleanup tuning; can be adjusted post-launch. |

**Nothing else assumed.** All other claims are VERIFIED (npm registry, codebase grep, Context7) or CITED (project memory, Postgres docs, vanilla-cookieconsent docs).

---

## Open Questions (RESOLVED)

1. **Cancellation link for soft-delete: signed JWT or signed URL?**
   - RESOLVED: HS256 JWT with Vault-stored `CANCEL_DELETION_HMAC_KEY` secret; verify in `cancel_account_deletion(token)` RPC by decoding + comparing user_id + initiated_at. Implemented by plan 22-01 File 14 (RPC + Vault secret) + plan 22-02 lifecycle-transactional `deletion_scheduled` template (JWT mint).

2. **Should `clinic-invite` Resend dispatch be retrofitted to use the new shared D-03 health check helper?**
   - RESOLVED: OUT OF SCOPE for P22; deferred to P23 polish sweep. Will be flagged in P22 SUMMARY.md follow-ups. Rationale: retrofitting risks regressing the shipped P9 clinic-invite behavior with no v1.2 customer-facing benefit.

3. **Does the existing 30-day cron need to be UNSCHEDULED + re-scheduled, or can we ALTER FUNCTION it?**
   - RESOLVED: `CREATE OR REPLACE FUNCTION` for the body change; leave the cron entry alone. Verified via 22-01 File 01 (migration replaces the function body in place); pg_cron resolves the current function definition at each invocation, so no schedule drift.

4. **DSAR export of PostHog events — how do we read PostHog events server-side?**
   - RESOLVED: synchronous pull at export time via Edge Fn call to PostHog REST API with user_id filter. PostHog `PERSONAL_API_KEY` declared as a Supabase Function secret in 22-04 plan. If `events > 10k`, paginate via PostHog's `next` cursor.

5. **Cohort heatmap "Show all" performance at 26+ weeks**
   - RESOLVED: ship as designed; revisit only if `cohort_retention` matview query > 200ms or refresh > 10s in production telemetry. v1.3 fallback to pagination/virtualization documented in plan 22-08 must_haves.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | local dev + CI build | ✓ | v22.18.0 [VERIFIED CLAUDE.md] | — |
| npm | package install | ✓ | bundled | — |
| Supabase CLI | migration push + Edge Fn deploy | ✓ | bundled in devDeps (`supabase@^2.98.2`) [VERIFIED package.json] | — |
| Postgres `pg_cron` | matview refresh + finalize_account_deletions + flag cleanup | ✓ | live on `ytnsipxxmzgaebkqmokp` per memory | — |
| Postgres `pgcrypto` | SHA-256 for DSAR hashed emails | ✓ | bundled (used in audit_logs already) | — |
| Stripe API | refund / cancel / comp | ✓ | API `2026-04-22.dahlia` live (Phase 14+19 in production) | — |
| Resend API | lifecycle emails + DSAR delivery + soft-delete cancel email | ⚠️ | API key live BUT domain `app.leanshot.app` UNVERIFIED (per memory + D-03) | **D-03 gated-send pattern is the fallback** — function 200s with `resend_domain_unverified_skips++` until user verifies DNS. No code change at flip time. |
| Vercel Edge `request.geo.country` | EU vs US default-toggle | ✓ | wired in P12 firewall fixture branch | — |
| PostHog REST API | DSAR PostHog event export + cohort mirror in admin | ⚠️ | account exists but `PERSONAL_API_KEY` not yet a Supabase Function secret | Plan-time vendor pass: mint key in PostHog dashboard + add to Supabase Function secrets via CLI. **Falls back to "PostHog section omitted from DSAR if key missing" — log warning, don't fail.** |
| Vault (Supabase) | `CANCEL_DELETION_HMAC_KEY`, `IMPERSONATION_JWT_SIGNING_KEY` (if Custom Access Token Hook chosen) | ✓ | live (used by P19 affiliate-payout per memory) | — |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** Resend domain verify (D-03 gated-send), PostHog PERSONAL_API_KEY (PostHog section optional in DSAR).

---

## Validation Architecture

> Required by `workflow.nyquist_validation: true` per `.planning/config.json`.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.5 + Playwright 1.59.1 + `vitest-e2e.config.ts` for live-DB RLS tests + Deno test for Edge Functions [VERIFIED package.json] |
| Config file | `vitest.config.ts`, `vitest-e2e.config.ts`, `vitest-mobile.config.ts`, `playwright.config.ts` |
| Quick run command | `npm run test:unit` (Vitest unit) |
| Full suite command | `npm test` (Vitest run + Playwright e2e) |
| E2E billing/RLS commands | `npm run test:e2e:billing`, `npm run test:e2e:rls` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| ADMIN-01 | Owner sees members table filtered by tier | unit (RTL) | `npx vitest run src/components/admin/members/MembersTable.test.tsx` | ❌ Wave 0 |
| ADMIN-01 | `admin_list_members` RPC respects `is_staff` gate | integration (live-DB) | `npm run test:e2e:rls -- admin-list-members` | ❌ Wave 0 |
| ADMIN-02 | MRR/ARR query returns expected aggregates | unit (SQL) | `npx vitest run src/lib/admin/admin-metrics.test.ts` | ❌ Wave 0 |
| ADMIN-03 | Impersonation mint returns JWT with `impersonator_id` claim | integration (Deno) | `deno test supabase/functions/admin-impersonate/index.test.ts` | ❌ Wave 0 |
| ADMIN-03 | RLS rejects INSERT/UPDATE/DELETE on every user table when JWT carries `impersonator_id` | integration (live-DB) | `npm run test:e2e:rls -- impersonation-write-deny` | ❌ Wave 0 |
| ADMIN-03 | Banner mounts at AppShell root; countdown decrements; auto-end at 0 | unit (RTL) | `npx vitest run src/components/impersonation/ImpersonationBanner.test.tsx` | ❌ Wave 0 |
| ADMIN-04 | Refund Edge Fn calls `stripe.refunds.create` + writes audit_log | integration (Deno) | `deno test supabase/functions/admin-stripe-action/index.test.ts` | ❌ Wave 0 |
| ADMIN-05 | `isFeatureEnabled` returns override when row present + not expired | unit | `npx vitest run src/lib/consent/feature-flag-overrides.test.ts` | ❌ Wave 0 |
| ADMIN-06 | Admin Approve writes `affiliate_conversions.status='confirmed'` | unit (RTL) | `npx vitest run src/components/admin/pages/AdminAffiliatesPage.test.tsx` | ❌ Wave 0 |
| ADMIN-06 | Next payout cron run includes the `confirmed` row | integration (live-DB) | `npm run test:e2e:rls -- payout-cron-includes-confirmed` | ❌ Wave 0 |
| ADMIN-08 | Cohort heatmap renders 13 weeks × 91 days from matview | unit (RTL) | `npx vitest run src/components/admin/cohorts/CohortHeatmap.test.tsx` | ❌ Wave 0 |
| ADMIN-08 | Matview refresh cron succeeds (CONCURRENTLY) | integration | `npm run test:e2e:rls -- user-activity-daily-refresh` | ❌ Wave 0 |
| DEL-01 | DeleteAccountModal copy says "7 days" not "30 days" | unit (RTL) | `npx vitest run src/components/dashboard/settings/DeleteAccountModal.test.tsx` | ⚠️ exists, update assertion |
| DEL-01 | SoftDeleteCountdownBanner mounts when row exists + Cancel CTA triggers RPC | unit (RTL) | `npx vitest run src/components/soft-delete/SoftDeleteCountdownBanner.test.tsx` | ❌ Wave 0 |
| DEL-01 | Cancel link from email triggers `cancel_account_deletion(token)` RPC | e2e | `npx playwright test e2e/account-delete-cancel.spec.ts` | ❌ Wave 0 |
| DEL-01 | 7-day cron finalizes pending row | integration (live-DB) | `npm run test:e2e:rls -- finalize-cron-seven-days` | ❌ Wave 0 |
| DEL-02 | account-delete Edge Fn cascade succeeds end-to-end | integration (Deno) | `deno test supabase/functions/account-delete/index.test.ts` | ✓ EXISTS (Phase 19) |
| GDPR-01 | Cookie banner renders bottom slide-up + "Customize" expands inline | e2e | `npx playwright test e2e/cookie-consent.spec.ts` | ❌ Wave 0 |
| GDPR-01 | EU geo sets analytics_storage=denied; US sets granted | e2e | `npx playwright test e2e/cookie-consent-geo.spec.ts` | ❌ Wave 0 |
| GDPR-02 | PostHog dynamically imports only AFTER `onConsent` with analytics granted | e2e | `npx playwright test e2e/posthog-defer.spec.ts` | ❌ Wave 0 |
| GDPR-02 | `consent_records` UPSERT writes a row per consent decision | integration (live-DB) | `npm run test:e2e:rls -- consent-records` | ❌ Wave 0 |
| GDPR-03 | DSAR portal POST creates `dsar_requests` row + invokes `dsar-export` Edge Fn | unit (RTL) + integration (Deno) | `npx vitest run src/components/dsar/DsarPortalPage.test.tsx && deno test supabase/functions/dsar-export/index.test.ts` | ❌ Wave 0 |
| GDPR-03 | DSAR JSON bundle contains hashed referred-user emails (NOT plaintext) | unit | `npx vitest run src/lib/dsar/dsar-pdf-render.test.ts` | ❌ Wave 0 |
| GDPR-03 | DSAR PDF renders all 7 sections | unit | `npx vitest run src/lib/dsar/dsar-pdf-render.test.ts` | ❌ Wave 0 |
| ON-02 | Each lifecycle Edge Fn: health-check passes → sends; fails → 200 + counter++ | integration (Deno) | `deno test supabase/functions/lifecycle-welcome-series/index.test.ts` (× 5 fns) | ❌ Wave 0 |
| ON-02 | Welcome-series day-0 fires on signup; day-1 fires 24h later | e2e (with mocked cron) | `npx playwright test e2e/lifecycle-welcome-series.spec.ts` | ❌ Wave 0 |
| ON-03 | Email preferences UPSERT writes JSONB correctly | unit (RTL) | `npx vitest run src/components/dashboard/settings/EmailPreferencesPage.test.tsx` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npm run test:unit` (~10-30s; covers RTL + SQL unit tests)
- **Per wave merge:** `npm test` (Vitest + Playwright; ~5-8 min) + `deno test supabase/functions/{new-fn}/index.test.ts` for each new Edge Function
- **Phase gate:** Full suite green + `npm run test:e2e:rls` green + manual UAT for impersonation flow + cookie banner visual verification + DSAR export smoke (one user, one ZIP, all 7 sections visible in PDF)

### Wave 0 Gaps

- [ ] `src/components/admin/pages/__tests__/AdminMembersPage.test.tsx` — covers ADMIN-01
- [ ] `src/components/admin/members/__tests__/MembersTable.test.tsx` — covers ADMIN-01 filter/sort/paginate
- [ ] `src/components/admin/members/__tests__/RefundModal.test.tsx` — covers ADMIN-04
- [ ] `src/components/impersonation/__tests__/ImpersonationBanner.test.tsx` — covers ADMIN-03 UI
- [ ] `src/components/impersonation/__tests__/useImpersonationReadOnly.test.ts` — covers read-only enforcement client side
- [ ] `src/components/consent/__tests__/CookieConsentBootstrap.test.tsx` — covers GDPR-01 init
- [ ] `src/components/dsar/__tests__/DsarPortalPage.test.tsx` — covers GDPR-03 UI
- [ ] `src/components/soft-delete/__tests__/SoftDeleteCountdownBanner.test.tsx` — covers DEL-01 banner
- [ ] `src/lib/admin/__tests__/admin-api.test.ts` — covers RPCs (mocked)
- [ ] `src/lib/consent/__tests__/feature-flag-overrides.test.ts` — covers ADMIN-05
- [ ] `src/lib/consent/__tests__/consent-records.test.ts` — covers GDPR-02
- [ ] `src/lib/dsar/__tests__/dsar-pdf-render.test.ts` — covers GDPR-03 PDF
- [ ] `supabase/functions/admin-impersonate/index.test.ts` (Deno) — covers ADMIN-03 JWT mint
- [ ] `supabase/functions/admin-stripe-action/index.test.ts` (Deno) — covers ADMIN-04 Stripe wrappers
- [ ] `supabase/functions/dsar-export/index.test.ts` (Deno) — covers GDPR-03 cascade
- [ ] `supabase/functions/lifecycle-welcome-series/index.test.ts` (Deno) — covers ON-02 send-or-skip
- [ ] `supabase/functions/lifecycle-behavior-triggered/index.test.ts` (Deno)
- [ ] `supabase/functions/lifecycle-transactional/index.test.ts` (Deno)
- [ ] `supabase/functions/lifecycle-retention/index.test.ts` (Deno)
- [ ] `supabase/functions/lifecycle-preference-update/index.test.ts` (Deno)
- [ ] `supabase/functions/_shared/__tests__/resend-domain-health-check.test.ts` (Deno) — covers D-03 shared helper
- [ ] `e2e/impersonation-write-deny.spec.ts` — covers ADMIN-03 RLS layer (live DB)
- [ ] `e2e/cookie-consent.spec.ts` — covers GDPR-01 happy path
- [ ] `e2e/cookie-consent-geo.spec.ts` — covers EU vs US default
- [ ] `e2e/posthog-defer.spec.ts` — covers GDPR-02 dynamic-import gate
- [ ] `e2e/account-delete-cancel.spec.ts` — covers DEL-01 cancel-link flow
- [ ] `e2e/lifecycle-welcome-series.spec.ts` — covers ON-02 with `RESEND_API_KEY=test-stub`
- [ ] `e2e/dsar-export.spec.ts` — covers GDPR-03 end-to-end (submit → email → download)
- [ ] `vitest-e2e.config.ts` extension: 3 new RLS specs (admin-list-members, payout-cron-includes-confirmed, user-activity-daily-refresh, consent-records, finalize-cron-seven-days)

---

## Security Domain

> Required (`security_enforcement` not explicitly false in config).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Supabase Auth (existing) + new JWT-mint impersonation (Pattern 1) — short-lived (30 min exp) + Custom claim verification |
| V3 Session Management | yes | Existing supabase-js session + new 30-min impersonation TTL via JWT `exp` claim |
| V4 Access Control | yes | RLS enforced. `is_staff` gate on admin routes (UX) + admin RPCs (security boundary). NEW: `impersonator_id` JWT claim gates write policies. Default-deny for `feature_flag_overrides` writes (admin RPCs only). |
| V5 Input Validation | yes | Refund amount, comp duration, override expires_at, DSAR request type — Postgres CHECK constraints + RPC argument typing. Cookie consent categories enforced by vanilla-cookieconsent schema. |
| V6 Cryptography | yes | SHA-256 via Postgres `pgcrypto extensions.digest()` for referred-user emails in DSAR (D-06). HS256 JWT for soft-delete cancel link (Vault key). NO custom crypto. |
| V7 Errors / Logging | yes | All admin actions write `audit_logs` rows. Impersonation start/end/blocked-write all logged. Resend-skip counter logged. Sentry breadcrumbs everywhere. |
| V8 Data Protection | yes | DSAR exports stored in `dsar-exports` private bucket; 7-day TTL signed URLs; Storage at-rest encryption (Supabase default). Co-shared data hashed (D-06). |
| V9 Communications | yes | All API calls over HTTPS (Vercel + Supabase enforce). Resend HTTPS direct (no SMTP). |
| V12 Files / Resources | yes | DSAR ZIP content-type sniffing → enforce `application/zip` MIME; signed URLs prevent bucket enumeration. |

### Known Threat Patterns for {React SPA + Supabase + Stripe + Resend + vanilla-cookieconsent}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Admin user-id forgery in admin RPC | Spoofing | `auth.uid()` server-side check + `profiles.is_staff = true` in every admin RPC body |
| Impersonation persists past 30 min via clock skew | Tampering | JWT `exp` claim + supabase-js auto-refresh blocked for impersonation tokens (custom hook). Server-side cron clears stale `app_metadata.impersonator_id`. |
| Impersonated user attempts UPDATE via direct REST call (bypasses client UI gate) | Tampering / E.o.P. | RLS write-deny policy reading `app_metadata.impersonator_id` IS NOT NULL → 42501. **Defense-in-depth is required — client UI gate is NOT the security boundary.** |
| Refund amount > original charge | Tampering | Stripe API rejects; admin RPC also CHECKs `amount <= stripe_charges.amount` from cached row |
| DSAR export leaks cross-tenant data | Information disclosure | D-06 SHA-256 hash referred-user emails; service-role aggregator runs as DEFINER with `set search_path` lockdown; output schema validated against allowlist |
| DSAR signed URL replay after share | Information disclosure | 7-day TTL on signed URL; one-time download flag in `dsar_requests.downloaded_at` (optional, v1.3) |
| Cookie consent bypass via direct cookie write | Tampering | vanilla-cookieconsent stores in `cc_cookie`; server-side `consent_records` is source-of-truth for audit; PostHog dynamic-import gate is client-side (best-effort) |
| Soft-delete cancel link reuse / forgery | Tampering | HS256 JWT signed with Vault key; one-time consumption (`cancel_account_deletion` deletes `pending_account_deletions` row) |
| `feature_flag_overrides` poisoning (admin sets bad override) | Tampering | `set_by` audit column + `expires_at` TTL forces re-confirmation; cleanup cron prevents orphans |
| Lifecycle email send-to-attacker via Resend hijack | Spoofing | API key in Function secret; `from:` pinned to `noreply@app.leanshot.app`; D-03 health check ensures we never send from unverified domain |
| Cohort heatmap leaks per-cohort active count (low-density bucket → re-id) | Information disclosure | `cohort_retention` view aggregates `count(distinct user_id)` — minimum bucket size 10 enforced (cells with < 10 active users render as "<10" rather than exact count). [ASSUMED — confirm with user at plan time if k-anonymity required] |
| ATT/Consent-Mode-v2 misconfiguration → Google rejects ads later | Tampering | Pattern 3 uses `acceptedService()` per Pitfall 7; manually validated against Google Tag Assistant before P20 ships |
| Stripe webhook signature replay → forged audit entry | Tampering | Existing P14 webhook signature verification; P22 admin RPCs do not consume webhooks (only invoke Stripe API). |

### Project Constraints (from CLAUDE.md)

(Extracted from CLAUDE.md user-private global instructions + project root CLAUDE.md.)

- **Tech stack locked:** React 19 + Vite + TS strict + Tailwind v4 beta + Zustand. NO router (intentionally). Tab state in Zustand.
- **Local-first must continue to work even after cloud sync is added.** P22 admin surface is online-only — that's acceptable because admin is operator-tier, not patient-tier. Patient-facing DEL-01 surface MUST work offline (read pending_account_deletions from local cache, write deletion request goes through `initiate_account_deletion` RPC which requires online).
- **Bundle size:** chart.js + framer-motion + lucide-react together are heavy. 24.5 kB gz target / 50 kB hard ceiling on index. All new SDKs via `src/lib/sync-defer.ts` analog (per memory `project_phase5_bundle_regression.md`). vanilla-cookieconsent + jsPDF dynamic-imported per Pattern 4 + Pattern 6.
- **Performance / accessibility:** keyboard nav, screen-reader labels, color contrast, reduced-motion behavior. UI-SPEC §Impersonation banner is `role="alert" + aria-live="assertive"` on mount + cosmetic countdown in own `aria-live="off"` span. DSAR portal status table needs `<table>` with header scope. Cookie banner buttons need focus order + Esc-to-dismiss-without-choice.
- **Compliance posture:** NOT a HIPAA covered entity yet. Avoid features that push into HIPAA territory. P22 DSAR + GDPR work is compatible (GDPR/CCPA, not HIPAA). HBNR (FTC Health Breach Notification Rule) applies — `audit_logs` 13-month retention covers it.
- **NO direct EHR integration.** P22 doesn't touch this.
- **AI dependency:** Anthropic outage = degraded coach UX. P22 admin surfaces don't depend on Anthropic.
- **GSD Workflow Enforcement:** all repo edits must originate from a GSD command. Planner spawned by `/gsd-plan-phase`; executors spawned by `/gsd-execute-phase`. Phase 22 follows the established choreography.
- **ESLint rule `no-restricted-syntax` blocks `useStore(generateInsights|pickFocus)`** — generic admin pages must not violate this with `useStore(s => admin_aggregate(s))` patterns. Pull `(s) => s.someSlice` selectors instead.

---

## Sources

### Primary (HIGH confidence)

- **Context7** `/orestbida/cookieconsent` — fetched 2026-05-16; Consent Mode v2 example + getting-started example used for Patterns 3, 7
- **Codebase grep + Read** — verified `audit_logs` schema, `account-delete` Edge Fn (517 lines, Phase 19), `pending_account_deletions` (Phase 7, 30-day cron), `DeleteAccountModal.tsx` (Phase 7, typed-confirm), `AdminAffiliatesScaffold.tsx` (Phase 19, is_staff gate), `src/lib/sync-defer.ts` (Phase 6, dynamic-import buffer), `src/lib/export-data.ts` (jsPDF dynamic-import pattern), `src/lib/feature-flags.ts` (Phase 19 cache pattern), `clinic-invite/resend.ts` (Phase 9, direct-HTTPS)
- **npm registry** — verified versions of vanilla-cookieconsent (3.1.0), jspdf (4.2.1), jspdf-autotable (5.0.7), posthog-js (1.373.5 latest), stripe (22.1.1 latest)
- **PostgREST docs** (`https://postgrest.org/en/stable/references/transactions.html`) — verified GUC + JWT claim per-request semantics (Pitfall 1)
- **Project CLAUDE.md** — stack lock, bundle ceiling, local-first constraint, GSD workflow enforcement

### Secondary (MEDIUM confidence)

- **WebSearch** — Supabase user-impersonation patterns (3 community articles + Supabase Discussion thread #19668); confirmed JWT claim approach is dominant
- **WebFetch** — Resend `/domains` GET endpoint response shape (status field values)
- **catjam.fi** — alternative magic-link impersonation pattern (REJECTED for P22 because it loses admin identity; preserved as fallback option)

### Tertiary (LOW confidence — flagged for plan-time validation)

- Bundle size of vanilla-cookieconsent: 5-7 kB gz ASSUMED (Bundlephobia rate-limited; verify with `vite build` post-install)
- `app_metadata` propagation time to next JWT mint — ASSUMED single request cycle (verify with Postman before locking impersonation pattern)

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every library version verified via npm registry; every existing primitive verified via codebase grep
- Architecture: HIGH — 6 of 7 patterns derive directly from existing project patterns; Pattern 1 (impersonation) has one ASSUMED (A1) with documented fallback
- Pitfalls: HIGH — 10 pitfalls each tied to specific project memory artifacts or VERIFIED docs
- Validation: HIGH — Nyquist sampling map covers all 14 REQ-IDs across unit + integration + e2e layers
- Security: HIGH — every threat tied to a STRIDE category + a project pattern; one ASSUMED k-anonymity decision (cohort heatmap min-bucket-size) for user confirmation

**Research date:** 2026-05-16
**Valid until:** 2026-06-15 (30 days; vanilla-cookieconsent + jsPDF + Resend API are stable; PostHog SDK on a minor-version cadence; Stripe API major version pinned)
