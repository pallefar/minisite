# Phase 19: Affiliate Program + Stripe Connect — Context

**Gathered:** 2026-05-15
**Status:** Ready for research / planning
**Source:** `/gsd-discuss-phase 19 leanshot` — 4 deep-dive areas with user, defaults applied to the rest

<domain>

## Phase Boundary

Phase 19 ships the entire affiliate program: apply form, manual approval, Stripe Connect Express onboarding with hosted tax-form collection, per-affiliate co-branded landing pages, partner dashboard with clicks/conversions/commissions/payouts/marketing assets, fraud detection, and the unified `tier_effective` view that reconciles RevenueCat + Stripe subscriptions. P19 also owns the full Stripe-side account-deletion cascade (MONEY-10) that P22's DEL-01 surface will call.

**Cross-phase handoffs:**
- **P22 ADMIN-06** consumes the admin review queue surface for affiliate applications + fraud flag triage
- **P16 (deferred)** wires the RC side of `tier_effective` when it resumes; P19 ships the view forward-compatible
- **P15 page-builder** templates back the 3 co-branded landing page variants (P19 adds 3 template instances to the existing builder)
- **`stripe-webhook` Edge Function (P14)** gets a new code path: on `invoice.paid`, check for affiliate cookie attribution and write to `affiliate_conversions`

**NOT in scope (deferred):**
- Multi-tier commissions (v1.3 per AFF-05 lock)
- Per-affiliate marketing-asset generator (e.g. personalized banner images) — v1.3
- Full Phase-15-builder edit access for affiliates — v1.3
- iOS App Store referral-code manual-entry on first launch — waits for P16; v1.2 ships web-only fallback via feature flag `aff_manual_entry`
- Affiliate API for programmatic access — v1.3

</domain>

<decisions>

## Implementation Decisions

### MONEY-07 — tier-effective view with P16 deferral
- **D-01:** Ship `tier_effective` view in **P19** (forward-compatible). Migration adds `subscriptions.provider` text column (`'stripe'` default) via idempotent `ADD COLUMN IF NOT EXISTS`. View computes `MAX(current_period_end) > now()` GROUP BY `user_id`. RC side returns 0 rows until P16 lands — view works for Stripe-only users.
- **D-02:** **SC#4 reformulated:** "Two overlapping Stripe subs (e.g. user has paid + clinic seat) reconcile to MAX(expires_at) in `tier` field" — regression-proof when RC joins. Test: simulate two `subscriptions` rows with `provider='stripe'` and overlapping windows; assert `tier_effective` view returns correct row.
- **D-03:** **Migration safety:** No enum (text column to avoid enum-add-in-same-tx Postgres pitfall). View uses `security_invoker=true` so RLS is honored at query time. No `SECURITY DEFINER` functions. Partial index on `(user_id, provider) WHERE user_id IS NOT NULL` is IMMUTABLE-safe.
- **D-04:** **Cross-phase contract with P16:** When P16 plan 16-06 resumes, it adds the RC-side webhook + writes to the same `subscriptions` table with `provider='revenuecat'`. The view requires zero changes — it just starts returning the MAX of both providers. P16-06 plan's migration becomes a no-op for the `provider` column (already exists via P19) and only adds the RC webhook handler.

### Affiliate apply + admin approval (AFF-05)
- **D-05:** Apply form at public route **`/affiliate`**. Fields: email, name, audience size (number), audience type (single-select: Instagram / TikTok / YouTube / Newsletter / Coaching / Other), 1 free-text "Why us?" (max 500 char).
- **D-06:** Confirmation flow: email confirmation via Resend transactional template "Application received — review in 3-5 business days". State stored in `affiliates.status = 'pending'`. No status page; affiliate gets a second email on approve/reject.
- **D-07:** Admin queue **lives in P22 ADMIN-06** (cross-phase handoff). P19 ships the `affiliates` table + `status` column + a read-only `/admin/affiliates` route gated behind `role='admin'` as scaffold. P22 builds the full operator UX on top.
- **D-08:** Approval defaults: `commission_rate_cents = 1000` (single-tier $10 flat per AFF-05 lock), `referral_code` auto-generated from name slug + 4-char suffix (e.g. `coachjane-a3f2`), affiliate notified via Resend transactional with their Stripe Connect onboarding link.

### Partner dashboard (AFF-04)
- **D-09:** Surface at own **`/partner/*`** route tree. Auth: same Supabase user, but `auth.users.app_metadata.role = 'affiliate'` claim gates the route (mirrors clinic-operator pattern from Phase 9/10). Routes:
  - `/partner/dashboard` — totals + recent activity feed
  - `/partner/links` — referral URL, landing-page template picker (3 variants), customization fields
  - `/partner/payouts` — payout history + next-payout ETA + Stripe Connect onboarding status
  - `/partner/assets` — static marketing asset gallery (download-only)
- **D-10:** Refresh cadence: **10-min SWR poll on `/partner/dashboard` load + manual "Refresh" button + "updated N min ago" badge**. Honors SC#1 "within 10 min" literal. SWR with `staleTime: 600_000`. No Realtime subscription (overkill for affiliate use case — they check 1-3×/day).
- **D-11:** Chart set on `/partner/dashboard`:
  - 4 KPI cards top: total clicks (30d), total conversions (30d), total commissions ($ 30d), pending payout
  - 1 trend chart: daily clicks + conversions over 30 days (chart.js, reuses Phase 1 `BaseChart`)
  - 1 recent-activity feed: last 10 conversions with `created_at`, status, commission amount
- **D-12:** Mobile-first layout: stack KPIs 2×2, then chart, then feed. No separate mobile route.

### Marketing assets gallery (part of AFF-04)
- **D-13:** Static admin-seeded gallery. Admin uploads 8-12 assets to a platform-level Storage bucket `marketing-assets/v1/`. Affiliates download direct (signed URL). No upload UI for affiliates at v1.2.
- **D-14:** Seed asset set (admin pre-populates):
  - Logo variants: SVG, 200×200 PNG, 1200×1200 PNG (transparent + on-brand-bg)
  - Banner ads: 728×90, 300×250, 1080×1080 (3 each in v1.2 brand colors)
  - 30s explainer video (link to existing YouTube/Vimeo upload — no hosting cost)
  - Swipe-copy email template (.txt)
  - Swipe-copy social post (.txt with hashtags)
- **D-15:** No per-affiliate personalized banner generator at v1.2 (deferred — needs server-side image generation + moderation surface). Revisit at v1.3.

### Co-branded landing pages (AFF-09)
- **D-16:** **3 template variants** at v1.2 (user override on default-1 recommendation):
  - **`coach`** — photo-forward hero, big affiliate name + headshot, value-prop list, Calendly CTA, signup CTA
  - **`story`** — testimonial-forward hero, affiliate quote pulled-out, benefit grid, signup CTA
  - **`method`** — benefits-list-forward hero, "Why I work with LeanShot" bullets, signup CTA
- **D-17:** Templates are Phase 15 page-builder template instances (admin pre-creates 3 templates in the builder; affiliate's customization just fills in template slots — no full Phase 15 builder access for affiliates).
- **D-18:** Customization fields:
  - **`display_name`** (text, max 80 char)
  - **`photo_path`** (Storage upload, JPG/PNG)
  - **`blurb`** (text, max 50 char tagline)
  - **`calendly_url`** (optional URL, validated)
  - **`testimonial_quote`** (text, max 200 char — only used by `story` template)
- **D-19:** Default fallback when affiliate hasn't uploaded photo: **initials avatar with deterministic gradient bg**. First letter of `display_name` on a gradient computed by `hash(display_name) → hsl(hue, 65%, 55%)`. Uses Phase 13 design tokens for spacing/typography. Zero moderation; works immediately.
- **D-20:** Mobile photo-crop strategy: **square center-crop via Supabase Storage transforms** at 200×200 + 400×400. **v1.2 caveat:** Storage transforms require Supabase Pro (deferred per `project_phase16_research_complete`). v1.2 fallback = client-side `<img object-fit:cover>` on raw upload (`<img class="w-full aspect-square object-cover" />`). Activates transforms automatically when Pro turns on (URL helper handles both modes; see Phase 16-01 Task 4 `storageTransformUrl` pattern).

### Referral cookie + iOS fallback (AFF-02)
- **D-21:** Cookie set server-side by `affiliate-attribute` Edge Function at `/r/{code}` route. Cookie: `_aff` = referral_code, `HttpOnly`, `SameSite=Lax`, `Secure`, `Domain=.leanshot.app`, 30-day `Max-Age`. First-party + HttpOnly defeats Safari ITP.
- **D-22:** iOS App Store fallback "enter referral code on first launch" (AFF-02 spec): **deferred to P16** (mobile shells). At v1.2 web only.
- **D-23:** Web fallback for "user signs up directly without clicking referral link but has a code from elsewhere": ship a manual-entry referral-code field on the signup form **behind feature flag `aff_manual_entry`** (defaults OFF; admin can enable for specific affiliate campaigns). Single-field input with code-validation against `affiliates.referral_code`. Conversion attributed if code matches.

### Fraud detection (AFF-07, AFF-08)
- **D-24:** **Conversion fraud (AFF-07):** ANY single signal match flags. Signals: (a) converter IP /24 == affiliate IP /24 (captured at signup), (b) converter device fingerprint == affiliate fingerprint, (c) converter email domain == affiliate email domain (excluding `gmail.com`/`yahoo.com`/`outlook.com`/`icloud.com`/`hotmail.com` — public-email allowlist). Flagged conversions get `status='flagged'`.
- **D-25:** **Auto-action on flag:** Always route to P22 ADMIN-06 admin queue. No auto-reject. Affiliate dashboard shows "Pending review" badge on flagged rows. Aligns with manual-approval ethos of AFF-05.
- **D-26:** **Click-rate fraud (AFF-08):** Z-score-based per-affiliate, flag clicks that put the affiliate's daily click count `≥ 3σ` above their own 7-day rolling baseline. Stored in materialized view refreshed daily.
- **D-27:** **Cold-start (new affiliate < 7 days):** Global cap of **500 clicks/day** until 7-day baseline accumulates. Beyond cap → `affiliate_clicks` rows continue to insert but get `flagged=true`; admin reviews in queue.
- **D-28:** **Referer-based click fraud (AFF-08 second half):** Reject (don't insert) clicks where `Referer` header is mismatched (referral_code in URL doesn't match Referer host listed on affiliate's profile) OR missing entirely from a non-mobile-app user agent. Mobile app traffic exempt (Capacitor sends no Referer).

### Payout cadence + chargeback (AFF-06) — defaults applied
- **D-29:** Monthly batch on the **1st of each month at 00:00 UTC** via pg_cron + `affiliate-payout` Edge Function.
- **D-30:** **Chargeback hold: 60 days** (Stripe Connect Express default). Commissions earned in month M paid out in month M+2.
- **D-31:** **$500 W-9 threshold strict:** affiliate accrued commission held until `SUM(commission_cents) >= 50000`. On reach, Stripe Connect auto-prompts W-9/W-8BEN. 1099-NEC auto-generated by Stripe at year-end.
- **D-32:** Payout failure retry: 3 attempts at 24h intervals, then `payouts.status = 'failed'` + admin alert via Resend (P22 ADMIN-06 surfaces).

### Account-deletion cascade (MONEY-10) — defaults applied
- **D-33:** Cascade ordering in `account-delete` Edge Function (called from P22 DEL-01 surface):
  1. **Pre-flight check:** if affiliate has open payouts (`payouts.status IN ('pending', 'processing')`), return `409 Conflict` with ETA = next payout date. User can re-request after payout settles. NO data deleted in this branch.
  2. Anonymize `affiliate_ledger`: `UPDATE affiliates SET email = SHA256(email), display_name = 'deleted_user_' || id, photo_path = NULL WHERE id = $user_id`
  3. `affiliate_clicks` + `affiliate_conversions`: `ON DELETE SET NULL` on `user_id` FK (rows retained for ledger integrity; no PII remains via #2 anonymization)
  4. **Retain `payouts` rows untouched (IRS 7-yr 1099 retention)**
  5. Stripe customer delete (if any subscriptions, void any open subscriptions first via `subscriptions.cancel()`)
  6. Stripe Connect account delete (if affiliate)
  7. PaymentIntent void on any open pending charges
  8. Resend audience contact remove
  9. Storage delete: `user_id` prefix (`photos/{user_id}/*`, `affiliate-photos/{user_id}/*`)
  10. `supabase.auth.admin.deleteUser(user_id)` — LAST step
- **D-34:** Audit-log every cascade step in `audit_logs` (Phase 7) for legal + DSAR record. Use `app.suppress_audit` GUC during cascade per `reference_supabase_migration_gotchas` to prevent mid-cascade trigger fires.
- **D-35:** CI cascade test: end-to-end Playwright spec that creates affiliate + conversion + payout → calls deletion → asserts `payouts` retained, `affiliate_ledger` anonymized, Stripe customer gone, Storage empty, `auth.users` row gone.

### Claude's Discretion
- Database schema details (table column types, indexes beyond what's specified above) — planner decides via PATTERNS.md analog (`stripe-webhook` migration as template)
- Edge Function file structure / module boundaries — research will identify pattern
- Specific React components for partner dashboard surfaces — planner picks (likely reuses Phase 1 `Card`, Phase 9/10 dashboard table patterns)
- Resend email template HTML structure — research picks from existing Phase 9 clinic-invite templates
- Stripe Connect onboarding link generation flow (one-time vs reusable) — research per Stripe 2025/2026 best practices
- Affiliate referral-code collision avoidance algorithm — planner decides (probably retry-on-conflict with longer suffix)

</decisions>

<canonical_refs>

## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase dependencies (READ FIRST)
- `.planning/phases/14-monetization-foundation/14-CONTEXT.md` — Stripe foundation decisions; `stripe-webhook` patterns this phase clones
- `.planning/phases/15-page-builder-landing-pages/15-CONTEXT.md` — Page builder template instance pattern P19 reuses for landing pages
- `.planning/phases/22-owner-admin-lifecycle-dsar-cookie/22-CONTEXT.md` — IF EXISTS — ADMIN-06 admin queue surface contract + DEL-01 surface contract (cross-phase coordination)
- `.planning/phases/16-capacitor-mobile-shells-ios-android/16-06-revenuecat-webhook-migration-tier-effective-PLAN.md` — Forward-compatibility contract: P19 ships `subscriptions.provider` + `tier_effective` view; P16 plan 16-06 must be amended to detect this column exists (idempotent ADD COLUMN IF NOT EXISTS skips silently)

### Existing assets to extend (codebase)
- `supabase/functions/stripe-webhook/` — Add affiliate-conversion path on `invoice.paid`
- `supabase/functions/stripe-checkout/` — Add `?aff=<code>` param handling; set affiliate cookie metadata on checkout session
- `src/lib/billing.ts` + `src/lib/billing-sync.ts` — Tier resolution; consume `tier_effective` view
- `src/components/billing/` — Reuse primitives in `/partner/payouts`
- `supabase/migrations/` — Reference Phase 14 migrations for migration patterns

### Cross-cutting concerns (PROJECT.md)
- **Affiliate ledger × IRS 1099 retention vs GDPR deletion** — `ON DELETE SET NULL` + anonymization, NEVER `ON DELETE CASCADE`. **Owners:** AFF-10 + DEL-02 jointly.

### Project memory (must-read before planning)
- `project_phase4_linkidentity_correction.md` — Auth flow for affiliate role claim
- `reference_supabase_edge_function_deploy.md` — esm.sh URLs (no bare imports); `verify_jwt = false` for the `affiliate-attribute` cookie-setting endpoint
- `reference_supabase_migration_gotchas.md` — IMMUTABLE partial-index predicates, no SECURITY DEFINER, `app.suppress_audit` GUC for cascade
- `reference_deno_test_discovery.md` — Deno test file naming (`index.test.ts` not `index-test.ts`)
- `feedback_regulator_vs_user_audience_pattern.md` — Applied: trimmed payout/cascade decisions to defaults; invested on apply form, dashboard, fraud, landing page templates
- `feedback_aggressive_foundations.md` — Refined: user override on landing-page-template count (3 over recommended 1) reinforces invest-on-user-audience
- `project_phase16_research_complete.md` — Supabase Pro deferral; Storage transforms fallback to client-side `object-fit:cover` until Pro turns on

</canonical_refs>

<specifics>

## Specific Ideas

- **3 landing page template names (locked):** `coach` (photo-forward), `story` (testimonial-forward), `method` (benefits-list-forward)
- **Affiliate role claim:** `auth.users.app_metadata.role = 'affiliate'` (mirrors Phase 9/10 clinic-operator pattern)
- **Cookie name:** `_aff` (underscore-prefix to mark internal)
- **Z-score baseline:** 3σ on 7-day rolling daily click count
- **Global cold-start cap:** 500 clicks/day for affiliates < 7 days old
- **W-9 threshold:** $500 strict (Stripe Connect default)
- **Chargeback hold:** 60 days (Stripe Connect default)
- **Public-email allowlist for fraud signal exemption:** `gmail.com`, `yahoo.com`, `outlook.com`, `icloud.com`, `hotmail.com`
- **Marketing asset Storage path:** `marketing-assets/v1/` (versioned so v2 asset refresh doesn't break existing affiliate downloads)

</specifics>

<deferred>

## Deferred Ideas

- **Multi-tier commissions** → v1.3 (per AFF-05 lock)
- **Per-affiliate personalized banner generator** → v1.3 (server-side image generation + moderation surface)
- **Full Phase-15 builder edit access for affiliates** → v1.3 (security/moderation cost too high for v1.2)
- **Affiliate API for programmatic access** → v1.3 (out of scope; new capability)
- **iOS App Store referral-code first-launch manual entry** → P16 (mobile shells) — at v1.2 web-only fallback via `aff_manual_entry` flag
- **Real-time partner dashboard updates** → v1.3 if data demands (10-min poll sufficient for v1.2)
- **Live chat for affiliate support** → v1.3
- **Affiliate referral program for affiliates (multi-tier MLM-style)** → never (explicitly out of scope)
- **Per-locale landing pages (DE/ES/FR)** → v1.2.1 (mirrors P16-08 ASO defer decision)

</deferred>

<success_criteria_amendments>

## Success Criteria — Amendments

**Original SC#4 (ROADMAP):**
> User who subscribed on web (Stripe) AND on iOS (RevenueCat) sees a single `tier='paid'` field reflecting whichever provider's subscription expires later — verified by a test that simulates both subscriptions with overlapping windows

**Reformulated SC#4 (per D-02, P16 deferral):**
> User who has two overlapping Stripe subscriptions (e.g. personal `paid` tier + clinic seat) sees a single `tier='paid'` field reflecting MAX(`current_period_end`) — verified by a test that inserts two `subscriptions` rows with `provider='stripe'` and overlapping windows. **Forward-compatibility test:** when a third row is inserted with `provider='revenuecat'`, the view still returns MAX (zero-change RC integration when P16 resumes).

Other SC unchanged. SC#3 (fraud), SC#5 (account deletion cascade) remain as written.

</success_criteria_amendments>

---

*Phase: 19-affiliate-program-stripe-connect*
*Context gathered: 2026-05-15 via `/gsd-discuss-phase 19 leanshot`*
*Decisions: 35 D-NN locked; 8 deferred items; 1 SC amended (forward-compat for P16 deferral)*
