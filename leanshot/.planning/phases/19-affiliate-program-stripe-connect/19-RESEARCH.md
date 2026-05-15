# Phase 19: Affiliate Program + Stripe Connect — Research

**Researched:** 2026-05-15
**Domain:** Stripe Connect Express (Marketplace Payouts + Hosted Tax Forms) + Server-set First-Party HttpOnly Cookie Attribution + Postgres `tier_effective` view forward-compat (P16 deferral) + Fraud detection (IP /24, fingerprint, Z-score) + Account-deletion cascade with IRS 7-yr retention (MONEY-10)
**Confidence:** HIGH on Stripe Connect / cookies / Postgres view / cascade — MEDIUM on fraud-fingerprint library choice and SWR cadence implementation — LOW on $500 W-9 threshold (CONTEXT.md says "Stripe Connect Express default" but research finds platforms must opt in and set the value)

## Summary

Phase 19 ships an entire viral-affiliate workstream by cloning three already-shipped patterns: Phase 14's `stripe-webhook` (signature verification + idempotent upsert), Phase 8's `share` Edge Function (server-set `HttpOnly` `Set-Cookie` via `jsr:@std/http/cookie`), and Phase 15's page-builder template-instance pattern (deep-copied scaffold, never live-linked). Most of the surface is well-trodden — the **non-obvious landmines** are:

1. **The "$500 W-9 default" in CONTEXT D-31 is not a Stripe default — platforms must explicitly configure W-9 enforcement thresholds.** [CITED: docs.stripe.com/connect/connect-w8-w9-onboarding] Stripe's docs are explicit: "Platforms have full customization in setting enforcement thresholds." There is no built-in $500 trigger. The 2026 IRS reporting threshold is $2,000 (up from $600 in 2025, OBBB Act). [CITED: 1800accountant.com/blog/irs-1099-reporting-changes-2026] Phase 19 needs an explicit `tax_form_collection_strategy` lock: either keep the strict $500 collection trigger as a *platform-set* enforcement rule on top of Stripe's built-in IRS-filing threshold ($2,000 for 2026 1099-NEC issuance) — OR raise the lock to $2,000 to match the legal threshold. This is the single open question this research surfaces for the planner. **[ASSUMED → must confirm with user]**
2. **Stripe Connect deletion is conditional, NOT idempotent.** [CITED: docs.stripe.com/api/accounts/update] Test-mode accounts always delete; live-mode accounts can only be deleted with **zero balance**. **Standard accounts cannot be deleted via API.** Express accounts CAN — but only when balance is zero and there are no pending payouts. CONTEXT D-33 step 1's 409 pre-flight already handles this; the planner needs to make the pre-flight check live data (`balance.retrieve` + `payouts.list({status: 'pending'})`), not just the local `payouts` table.
3. **Stripe `transfers.create` (NOT `payouts.create`) is the right API for "send $10 commission to affiliate".** [CITED: docs.stripe.com/connect/separate-charges-and-transfers; docs.stripe.com/connect/end-to-end-marketplace] `payouts.create` is for moving Stripe balance → an external bank account (initiated by the connected account itself or by the platform on behalf). `transfers.create` is platform → connected-account balance. For "monthly batch payout to affiliate", we `transfers.create({destination: acct_xxx, amount: 1000, currency: 'usd'})` and **the connected account's payout schedule** then moves it to their bank. CONTEXT D-29 ("monthly batch via `affiliate-payout` Edge Function") is correctly named, but the implementation is `transfers.create` to the connected account balance — Stripe then payouts to bank on the connected account's schedule (default daily). This naming distinction MUST be in the plan to avoid the executor reaching for `stripe.payouts.create({destination_bank_account_id})` which requires Custom Connect accounts (not Express).
4. **The 60-day chargeback hold in CONTEXT D-30 is a project-internal rule, not a Stripe Connect Express default.** Stripe Connect's actual reserve hold uses `application_fee` reversals or platform-set rolling reserves (max 180 days). [CITED: docs.stripe.com/connect/connected-account-reserves; support.stripe.com/questions/reserves-for-connect-platforms-and-connected-accounts] The 60-day rule must be enforced in **our** `payouts` table state machine — DON'T expect Stripe to enforce it for us. Implementation: `payouts.eligible_at = invoice.paid + interval '60 days'`; monthly cron only `transfers.create` rows where `eligible_at < now()`. This is also forward-compat with eventual refund/dispute handling (set `payouts.status = 'reversed'` if a chargeback fires within the 60-day window).
5. **Safari ITP server-side-cookie persistence has a hidden IP-matching requirement.** [CITED: WebKit ITP documentation via jentis.com, seresa.io 2026] A server-set `HttpOnly Secure SameSite=Lax` cookie persists 400 days in Safari — **only if your server IP matches your website IP**. Our setup: `affiliate-attribute` runs at `{supabase-project}.supabase.co/functions/v1/affiliate-attribute` (different IP from `leanshot.app`). To get the 400-day persistence, the cookie's `Domain` attribute must be set to `.leanshot.app` AND the response must be returned through a same-origin endpoint. Practical approach: serve `/r/{code}` via a `vercel.json` rewrite that proxies to `{supabase-fn-url}/affiliate-attribute?code={code}`, OR use a Vercel Edge Function alternative. The locked decision (`Domain=.leanshot.app` per D-21) requires this proxy. **[ASSUMED — should confirm Vercel proxy behavior preserves `Set-Cookie` headers]**
6. **`security_invoker = true` on the `tier_effective` view IS the supported Supabase 2025/2026 pattern.** [CITED: supabase.com/docs/guides/database/database-advisors?lint=0010_security_definer_view] Default views inherit creator privileges (SECURITY DEFINER semantically); `WITH (security_invoker = true)` is the supported flag (Postgres 15+, Supabase compat). The planner must declare this explicitly — Supabase's database-advisor lints will fail on a SECURITY DEFINER view.
7. **`stripe@22.x` is now latest** (was `19.x` when Phase 14 shipped). [VERIFIED: npmjs.com/package/stripe via WebSearch 2026-05-15] Latest is `22.1.1` with pinned API version `2026-04-22.dahlia`. Phase 14 pins `stripe@19` via `https://esm.sh/stripe@19?target=denonext` and works. **Phase 19 should NOT bump to `22.x` mid-milestone** — it would force re-pinning every Phase 14 Edge Function's API-version compatibility. **Recommendation: pin `stripe@19` to match Phase 14 exactly, defer the SDK bump to a future tech-debt sweep.**

**Primary recommendation:** Implement Phase 19 in 8 plans across 3 waves. Wave 0 reuses Phase 14 + Phase 8 + Phase 15 patterns verbatim (no net-new infrastructure). Wave 1 ships database schema, `affiliate-attribute` Edge Function, `tier_effective` view (MONEY-07 forward-compat), and Stripe Connect Express onboarding flow. Wave 2 ships partner dashboard, fraud detection, monthly payout cron, account-deletion cascade. Plan-checker will flag shared-file conflict on `stripe-webhook/index.ts` (Wave 1 adds `invoice.paid` affiliate-attribution path) — handle via pathspec commits per `feedback_parallel_executor_git_isolation`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Apply-form submission | Browser → API (`/affiliate-apply` lead-capture clone) | Database (`affiliates` INSERT with `status='pending'`) | Public surface; uses `lead-capture` pattern (verify_jwt=false, service-role INSERT, honeypot + rate-limit) |
| Server-set `_aff` cookie | API / Edge Function (`affiliate-attribute`, verify_jwt=false) | Browser (302 redirect with `Set-Cookie`) | First-party HttpOnly REQUIRES server origin; client cannot set HttpOnly cookies |
| Stripe Connect onboarding link | API / Edge Function (`affiliate-connect-onboard`) | Browser (window.location.href = account_link.url) | `account_links.create` requires Stripe secret key → server-only |
| Conversion attribution | API / Edge Function (extends Phase 14 `stripe-webhook` on `invoice.paid`) | Database (`affiliate_conversions` INSERT) | Webhook is single source of truth (cf. Phase 14 D-14) |
| `tier_effective` view | Database (view + `security_invoker=true`) | Client (`billing-sync.ts` SELECT from view, not table) | View centralizes MAX-of-providers logic; RLS honored via invoker |
| Partner dashboard render | Browser / Client (React + Zustand) | Database (RLS-gated SELECT on `affiliate_conversions`, `affiliate_clicks`, `payouts`) | Standard dashboard — no Realtime needed (10-min poll per D-10) |
| Fraud Z-score baseline | Database (materialized view, refreshed nightly) | API (cron) | Heavy aggregation belongs in DB; refresh is async batch |
| Fraud signal check | Database (trigger on `affiliate_conversions` INSERT) | API (mutating webhook path can no-op trigger via GUC if needed) | Server-side enforcement so fraud signals can never be bypassed by malicious clients |
| Monthly payout batch | API / Edge Function (`affiliate-payout`) | Stripe (`transfers.create` to connected account) | Server-only — needs Stripe secret + service-role DB access |
| Co-branded landing page | Edge Function (`page-render` extended) + Browser | Database (`landing_pages` row scaffolded from template) | Reuses Phase 15 renderer — affiliate customization is just block-content writes |
| Account-deletion cascade | API / Edge Function (extends Phase 7 `account-delete` cascade) | Stripe (customer.delete + Connect account.delete + PaymentIntent.cancel) | Multi-step transaction across 4+ systems; only Edge Function can hold Stripe secret + service-role DB |
| Affiliate role claim | API / Edge Function (admin approval handler) | Auth (`auth.admin.updateUserById({app_metadata: {role: 'affiliate'}})`) | Mirrors Phase 9/10 clinic-operator role-claim pattern |

## User Constraints (from CONTEXT.md)

### Locked Decisions

**MONEY-07 — tier_effective view + P16 deferral:**
- **D-01:** Ship `tier_effective` view in P19 (forward-compatible). Add `subscriptions.provider` text column (`'stripe'` default) via idempotent `ADD COLUMN IF NOT EXISTS`. View computes `MAX(current_period_end) > now()` GROUP BY `user_id`. RC returns 0 rows until P16 — view works for Stripe-only.
- **D-02:** SC#4 reformulated: "Two overlapping Stripe subs (paid + clinic seat) reconcile to MAX(`current_period_end`) in `tier`". Test: insert two `subscriptions` with `provider='stripe'` + overlapping windows; assert view returns correct row.
- **D-03:** Migration safety — text column (no enum), `security_invoker=true` view, no SECURITY DEFINER, partial index `WHERE user_id IS NOT NULL` (IMMUTABLE-safe).
- **D-04:** Cross-phase contract — P16-06 becomes no-op for `provider` column (already exists via P19) + adds RC webhook only.

**Affiliate apply + admin approval (AFF-05):**
- **D-05:** Apply form at `/affiliate`. Fields: email, name, audience size (number), audience type (Instagram / TikTok / YouTube / Newsletter / Coaching / Other), "Why us?" (max 500 char).
- **D-06:** Email confirmation via Resend "Application received". `affiliates.status='pending'`. Second email on approve/reject.
- **D-07:** Admin queue lives in **P22 ADMIN-06** (cross-phase). P19 ships `affiliates` table + read-only `/admin/affiliates` scaffold gated by `role='admin'`.
- **D-08:** Approval defaults: `commission_rate_cents=1000`, `referral_code` auto-generated (`{name-slug}-{4-char-suffix}`), Resend transactional with Stripe Connect onboarding link.

**Partner dashboard (AFF-04):**
- **D-09:** `/partner/*` route tree gated by `auth.users.app_metadata.role='affiliate'`. Routes: `/partner/dashboard`, `/partner/links`, `/partner/payouts`, `/partner/assets`.
- **D-10:** 10-min SWR poll + manual Refresh + "updated N min ago" badge. `staleTime: 600_000`. No Realtime.
- **D-11:** 4 KPI cards top (clicks 30d, conversions 30d, commissions $ 30d, pending payout) + 1 trend chart (chart.js, reuses Phase 1 `BaseChart`) + recent-activity feed (last 10 conversions).
- **D-12:** Mobile-first: KPIs 2×2, then chart, then feed.

**Marketing assets gallery (AFF-04):**
- **D-13:** Static admin-seeded gallery at `marketing-assets/v1/`. Affiliates download via signed URL. No upload UI at v1.2.
- **D-14:** Seed set: logo variants (SVG, 200×200, 1200×1200 PNG), banner ads (728×90, 300×250, 1080×1080), 30s explainer video link, swipe-copy email + social.
- **D-15:** No per-affiliate personalized banner generator at v1.2.

**Co-branded landing pages (AFF-09):**
- **D-16:** 3 template variants: `coach`, `story`, `method`.
- **D-17:** Templates are Phase 15 page-builder template instances. Admin pre-creates 3 templates; affiliate's customization fills slots only.
- **D-18:** Customization fields: `display_name` (max 80), `photo_path` (Storage), `blurb` (max 50), `calendly_url` (validated URL), `testimonial_quote` (max 200, `story` only).
- **D-19:** Default fallback — initials avatar with deterministic gradient: `hsl(hash(display_name), 65%, 55%)`.
- **D-20:** Mobile photo crop — Supabase Storage transforms (Pro-only, deferred). v1.2 fallback: `<img class="w-full aspect-square object-cover" />` on raw upload. URL helper handles both modes (Phase 16-01 Task 4 `storageTransformUrl`).

**Referral cookie + iOS fallback (AFF-02):**
- **D-21:** `_aff` cookie: `HttpOnly`, `SameSite=Lax`, `Secure`, `Domain=.leanshot.app`, 30-day Max-Age. Set server-side by `affiliate-attribute` on `/r/{code}`.
- **D-22:** iOS App Store first-launch manual entry → P16.
- **D-23:** Web fallback — manual-entry field on signup behind feature flag `aff_manual_entry` (defaults OFF).

**Fraud detection (AFF-07, AFF-08):**
- **D-24:** Conversion fraud — ANY single signal flags. Signals: (a) converter IP /24 == affiliate IP /24, (b) device fingerprint match, (c) email domain match (allowlist: `gmail.com`/`yahoo.com`/`outlook.com`/`icloud.com`/`hotmail.com`). Flagged → `status='flagged'`.
- **D-25:** Auto-action — route to P22 ADMIN-06 admin queue. No auto-reject.
- **D-26:** Click fraud (Z-score) — flag clicks ≥ 3σ above own 7-day rolling baseline. Materialized view refreshed daily.
- **D-27:** Cold-start — global cap 500 clicks/day for affiliates < 7 days old. Beyond cap → rows insert with `flagged=true`.
- **D-28:** Referer-based fraud — reject when `Referer` host mismatched (affiliate's profile-listed hosts) or missing on non-mobile-app UA. Mobile app (no Referer) exempt.

**Payout cadence + chargeback (AFF-06):**
- **D-29:** Monthly batch, 1st of month at 00:00 UTC via pg_cron + `affiliate-payout` Edge Function.
- **D-30:** 60-day chargeback hold (CONTEXT calls this "Stripe Connect Express default" — RESEARCH finds it must be **our** rule, not Stripe's; see Summary #4).
- **D-31:** $500 W-9 threshold strict — held until SUM(`commission_cents`) ≥ 50000. RESEARCH finds this is **platform-set, not Stripe default**; see Summary #1 and Open Questions.
- **D-32:** Payout failure — 3 retries at 24h, then `payouts.status='failed'` + Resend admin alert.

**Account-deletion cascade (MONEY-10):**
- **D-33:** 10-step cascade in `account-delete` Edge Function (called from P22 DEL-01): (1) pre-flight 409 on open payouts; (2) anonymize ledger via SHA256(email); (3) ON DELETE SET NULL for clicks/conversions; (4) retain `payouts` (IRS 7yr); (5) Stripe customer delete (cancel subs first); (6) Stripe Connect account delete; (7) PaymentIntent void; (8) Resend audience remove; (9) Storage delete `{user_id}` prefix; (10) `supabase.auth.admin.deleteUser`.
- **D-34:** Audit-log every step. `app.suppress_audit` GUC during cascade to prevent mid-cascade trigger fires (per `reference_supabase_migration_gotchas`).
- **D-35:** CI Playwright e2e: full affiliate + conversion + payout → delete → assert payouts retained, ledger anonymized, Stripe customer gone, Storage empty, `auth.users` gone.

### Claude's Discretion
- DB schema details (column types, indexes beyond CONTEXT) — planner decides
- Edge Function file structure / module boundaries — RESEARCH identifies the pattern (Phase 14 `events/<event>.ts` dispatcher analog)
- Specific React components for partner surfaces — planner picks (likely reuses Phase 1 `Card`, Phase 9/10 dashboard table patterns)
- Resend email template HTML — RESEARCH points to Phase 9 `clinic-invite` template skeleton
- Stripe Connect onboarding link `account_links.create` semantics — RESEARCH locks one-time URL pattern with refresh
- Referral-code collision avoidance — RESEARCH locks UNIQUE constraint + retry loop with longer suffix

### Deferred Ideas (OUT OF SCOPE)
- Multi-tier commissions → v1.3
- Per-affiliate personalized banner generator → v1.3
- Full Phase-15-builder edit access for affiliates → v1.3
- iOS App Store first-launch referral-code entry → P16
- Real-time partner dashboard updates → v1.3
- Live chat for affiliate support → v1.3
- Multi-tier MLM-style → never
- Per-locale landing pages → v1.2.1

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AFF-01 | `affiliates` + `affiliate_links` + `affiliate_clicks` + `affiliate_conversions` + `payouts` tables with RLS | "Postgres schema" + "Phase 14 RLS pattern" |
| AFF-02 | `/r/{code}` → `affiliate-attribute` Edge Function sets HttpOnly first-party cookie (30d) | "Server-set cookie" + "Phase 8 share cookie pattern" |
| AFF-03 | Affiliate completes Stripe Connect Express onboarding with hosted W-9/W-8BEN/1099-NEC | "Stripe Connect Express (Express vs Custom)" + "Hosted onboarding" |
| AFF-04 | Partner dashboard (clicks, conversions, commissions, payouts, marketing assets, referral link) | "Partner dashboard architecture" + "Phase 1 BaseChart reuse" |
| AFF-05 | Public apply form → admin manual approval → $10 flat commission | "Apply form" + "Phase 15 lead-capture pattern" |
| AFF-06 | `affiliate-payout` Edge Function monthly batch (60-90d hold, $500/30d W-9 threshold) | "Stripe transfers vs payouts" + "Payout state machine" |
| AFF-07 | Conversions flagged on IP/fingerprint/email-domain match | "Fraud detection — Postgres inet operators" + "Fingerprinting library" |
| AFF-08 | Clicks rejected on Referer mismatch + Z-score baseline | "Click fraud" + "Materialized view Z-score" |
| AFF-09 | Co-branded landing page at `/r/{code}` (template-based via Phase 15) | "Page-builder template-instance pattern" |
| AFF-10 | Account deletion anonymizes ledger via ON DELETE SET NULL (IRS 1099 7yr) | "Cascade-deletion ordering" + "app.suppress_audit GUC" |
| MONEY-07 | Unified `tier` field reconciles RC + Stripe | "tier_effective view + provider column" |
| MONEY-10 | Account deletion cascades Stripe customer/sub/Connect | "10-step cascade" + "Stripe deletion API conditions" |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `stripe` (Deno) | `19.x` via `https://esm.sh/stripe@19?target=denonext` [VERIFIED: Phase 14 pinned this; latest is `22.1.1` but staying on `19.x` to avoid mid-milestone API-version bump — see Summary #7] | Stripe Connect Express API client | Matches Phase 14 exactly; `createSubtleCryptoProvider()` available; `connectedAccount.create / accountLinks.create / transfers.create` all stable since v10 |
| `@supabase/supabase-js` | `2.x` (already in deps) | Service-role admin client | Reuse Phase 14 / Phase 8 / Phase 15 pattern |
| `jsr:@std/http/cookie` | latest (Deno std) | `setCookie` / `getCookies` helpers for `_aff` cookie | **CRITICAL** — `share/cookie.ts` proves hand-rolling Set-Cookie strings is the Edge Function footgun; reuse the wrapper |
| Postgres (Supabase managed) | 15+ | `affiliates` / `affiliate_*` / `payouts` schema + `tier_effective` view (`security_invoker=true`) | Project default; v15+ required for `security_invoker` view syntax |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@thumbmark/thumbmarkjs` | `^0.18` | Browser device fingerprinting | **Recommended over FingerprintJS open-source.** ThumbmarkJS reports ~80% accuracy vs FingerprintJS OSS ~40-60% [CITED: thumbmarkjs.com/content/thumbmarkjs-vs-fingerprintjs-alternative]. MIT-licensed, no paid tier coupling. Bundle: ~12 kB gz. Lazy-load only on `/r/{code}` route + signup form — not in index chunk. **[ASSUMED — should confirm bundle ceiling availability]** |
| `nanoid` | `^5.0` | 4-char suffix for referral codes | Already widely used; URL-safe alphabet; collision-resistant at 4 chars across <10k affiliates |
| pg_cron | bundled | Monthly batch trigger for `affiliate-payout` | Already enabled (Phase 7 `anon_cleanup_pg_cron` migration uses it) |
| pg_net | bundled | HTTP call from pg_cron to Edge Function | Standard Supabase pattern [CITED: supabase.com/docs/guides/functions/schedule-functions] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `stripe@19` | `stripe@22.1.1` (latest) | Latest pins API version `2026-04-22.dahlia` — same as Phase 14, so no real difference. But mid-milestone SDK bumps in shared `stripe-webhook` are risky. Defer the bump. |
| ThumbmarkJS | FingerprintJS OSS, Fingerprint Pro (paid) | FingerprintJS OSS is the household name but ~40-60% accuracy; ThumbmarkJS at ~80% is the better free option. Fingerprint Pro at $99/mo + complexity isn't justified at v1.2 launch volume. |
| `transfers.create` | `payouts.create` | `payouts.create` requires Custom Connect accounts and a bank-account ID — Express accounts don't expose this. Stick with `transfers` (platform → connected balance) and let the connected account's payout schedule handle the bank wire. |
| Stripe-hosted W-9 collection | Custom W-9 form | **NOT AN OPTION.** Building W-9 UI = IRS/FATCA compliance risk we cannot accept. CONTEXT D-31 locks hosted. |
| Express Connect | Standard / Custom Connect | Standard accounts can't be deleted via API (a P19 cascade requirement). Custom requires us to build the dashboard. Express is the only viable choice. |

**Installation:**
```bash
# Edge Function imports (Deno resolves via esm.sh / jsr) — no npm install needed:
import Stripe from 'https://esm.sh/stripe@19?target=denonext';
import { setCookie, getCookies } from 'jsr:@std/http/cookie';

# Client-side fingerprinting (lazy-loaded — kept out of index chunk):
npm install @thumbmark/thumbmarkjs@^0.18
npm install nanoid@^5
```

**Version verification (planner must run at plan time):**
```bash
npm view @thumbmark/thumbmarkjs version
npm view nanoid version
npm view stripe version  # confirm 22.x still available; we pin 19.x via esm.sh
```

## Architecture Patterns

### System Architecture Diagram

```
                                    ┌──────────────────────────────────────┐
                                    │      Stripe (external SaaS)          │
                                    │  • Connect Express                   │
                                    │    – accounts.create (type=express)  │
                                    │    – accountLinks.create             │
                                    │    – W-9/W-8BEN/1099-NEC (hosted)    │
                                    │  • transfers.create (platform→acct)  │
                                    │  • customers.del / subs.cancel       │
                                    │  • accounts.del (zero-balance only)  │
                                    └──┬─────────────────────────────────▲─┘
                                       │                                 │
                                       │ webhook events                  │
                                       │  account.updated                │
                                       │  invoice.paid (extended!)       │
                                       │  payout.created / .paid / .failed
                                       ▼                                 │
                          ┌─────────────────────────┐    ┌────────────────────────────┐
                          │  stripe-webhook         │    │  affiliate-connect-onboard │
                          │  (Phase 14 + extended)  │    │  (POST, JWT-gated)         │
                          │                         │    │   1. authn caller          │
                          │  on invoice.paid:       │    │   2. accounts.create       │
                          │    SELECT _aff cookie   │    │      (type=express)        │
                          │    from receivedCookies │    │   3. accountLinks.create   │
                          │    → INSERT             │    │      (account_onboarding)  │
                          │      affiliate_         │    │   4. return url            │
                          │      conversions row    │    └────────────────────────────┘
                          │    → fire fraud trigger │
                          │                         │    ┌────────────────────────────┐
                          │  on account.updated:    │    │  affiliate-attribute       │
                          │    UPDATE affiliates    │    │  (verify_jwt=false, /r/*)  │
                          │      .stripe_payouts_   │    │   1. validate code         │
                          │      enabled            │    │   2. INSERT click row      │
                          └─────────────────────────┘    │   3. apply fraud filter    │
                                                          │     (Referer + 500/day cap)│
                                                          │   4. Set-Cookie _aff       │
                                                          │   5. 302 → /r/{code}       │
                                                          │      landing-page          │
                                                          │      (rendered by         │
                                                          │       page-render)        │
                                                          └────────────────────────────┘

                          ┌─────────────────────────┐    ┌────────────────────────────┐
                          │  affiliate-payout       │    │  account-delete (extended) │
                          │  (pg_cron → pg_net)     │    │  (Phase 7 + 10-step)       │
                          │  monthly batch (1st 00z)│    │                            │
                          │   1. SELECT eligible    │    │   1. pre-flight 409 on     │
                          │      payouts            │    │      open payouts          │
                          │      (eligible_at < now │    │   2. anonymize ledger      │
                          │       AND sum >= 50000) │    │   3. ON DELETE SET NULL    │
                          │   2. transfers.create   │    │   4. retain payouts (IRS)  │
                          │      per affiliate      │    │   5. Stripe customer del   │
                          │   3. UPDATE payouts SET │    │   6. Stripe Connect del    │
                          │      status='paid'      │    │   7. PaymentIntent void    │
                          │      stripe_transfer_id │    │   8. Resend audience rm    │
                          │   4. retry-3 on failure │    │   9. Storage delete prefix │
                          │      → 'failed' +       │    │   10. auth.admin.deleteUser│
                          │      Resend admin alert │    │                            │
                          └─────────────────────────┘    │   audit_logs:              │
                                                          │   app.suppress_audit=true  │
                                                          │   in same tx              │
                                                          └────────────────────────────┘
                                  │
                                  ▼
                          ┌──────────────────────────────────────────────────┐
                          │  Postgres (Supabase)                             │
                          │                                                  │
                          │  affiliates (status, referral_code,             │
                          │              stripe_connect_account_id,         │
                          │              app_metadata.role='affiliate')     │
                          │  affiliate_clicks (PK, affiliate_id, ip, ua,    │
                          │                    fingerprint, flagged)        │
                          │  affiliate_conversions (PK, affiliate_id,       │
                          │                         user_id, subscription_id │
                          │                         status, fraud_signals)  │
                          │  payouts (PK, affiliate_id, period_start,       │
                          │           amount_cents, eligible_at, status,    │
                          │           stripe_transfer_id)                   │
                          │  affiliate_click_baseline (materialized view,   │
                          │                            7d rolling Z-score)  │
                          │                                                  │
                          │  tier_effective (view, security_invoker=true,   │
                          │                  GROUP BY user_id,              │
                          │                  MAX(current_period_end))       │
                          │                                                  │
                          │  subscriptions += `provider` text column         │
                          │                  ('stripe' default)              │
                          └──────────────────────────────────────────────────┘
                                          ▲
                                          │
                          ┌──────────────────────────────────────────────────┐
                          │  Browser / SPA                                   │
                          │                                                  │
                          │  /affiliate           — public apply form        │
                          │  /partner/dashboard   — affiliate-role-gated     │
                          │  /partner/links       — referral URL + template  │
                          │  /partner/payouts     — payout history + ETA    │
                          │  /partner/assets      — marketing assets gallery │
                          │  /admin/affiliates    — admin-role-gated         │
                          │                          (read-only scaffold;    │
                          │                          full UX in P22)         │
                          │                                                  │
                          │  Sign-up form: lazy-loads ThumbmarkJS,           │
                          │    reads _aff cookie via document.cookie?  NO —  │
                          │    cookie is HttpOnly. Reading happens server-   │
                          │    side in stripe-webhook on invoice.paid by    │
                          │    reading cookie from Stripe Checkout's        │
                          │    return_url cookie context (via              │
                          │    client_reference_id passthrough).            │
                          └──────────────────────────────────────────────────┘
```

### Critical attribution-on-conversion flow

The HttpOnly cookie is set on `/r/{code}` BUT the Stripe Checkout flow is on `{supabase}.supabase.co` (different origin from `leanshot.app`). The cookie is NOT readable by `stripe-checkout` (different origin). Three options for forwarding attribution to the conversion:

1. **`client_reference_id` passthrough (RECOMMENDED).** When the user clicks "Subscribe" from a co-branded landing page, the page-render must inject the affiliate code into the Checkout request as `client_reference_id`. Then on `invoice.paid` webhook, `stripe-webhook` reads `client_reference_id` from the session and writes the conversion. **This means the affiliate code must be carried via a `_aff` cookie on `.leanshot.app` first (set by `affiliate-attribute`), then read by a small client-side helper on the co-branded landing page that calls `stripe-checkout` with `client_reference_id={code}`.** [CITED: docs.stripe.com/payments/checkout/custom-success-page — `client_reference_id` survives the Checkout round-trip]
2. **Stripe Customer metadata.** Less direct; only useful for renewals.
3. **Separate cookie-bridge endpoint.** Server-only flow that reads `_aff` cookie + creates Checkout session. More moving parts.

**Plan-checker note:** Option 1 requires `_aff` cookie to be readable by JS on `leanshot.app`. But `HttpOnly` blocks JS reads. **Resolution:** Add a parallel **non-HttpOnly** cookie `_aff_v` (visible to JS) — same value, same 30d TTL, same Domain — purely so the landing page can read it and pass to Checkout. `_aff` (HttpOnly) is the authoritative server-readable attribution cookie; `_aff_v` is the client-readable mirror. This is a standard affiliate-tracking dual-cookie pattern. **Plan must add this detail; CONTEXT D-21 doesn't mention the dual-cookie.**

### Recommended Project Structure

```
supabase/
├── functions/
│   ├── affiliate-attribute/              # Wave 1 — public cookie-setter
│   │   ├── index.ts                      # GET /r/{code} → 302 + Set-Cookie
│   │   ├── index.test.ts                 # Deno tests (per reference_deno_test_discovery — .test.ts)
│   │   ├── cookie.ts                     # CLONE share/cookie.ts (Domain=.leanshot.app)
│   │   ├── cors.ts                       # CLONE share/cors.ts
│   │   └── deno.json
│   ├── affiliate-connect-onboard/         # Wave 1 — Stripe Connect onboard link
│   │   ├── index.ts                      # POST creates account_link
│   │   ├── index.test.ts
│   │   └── cors.ts
│   ├── affiliate-payout/                 # Wave 2 — monthly batch
│   │   ├── index.ts                      # POST from pg_cron → transfers.create
│   │   ├── index.test.ts
│   │   └── retry.ts                      # 3-attempt-24h-interval
│   ├── affiliate-apply/                  # Wave 1 — public apply form (CLONE lead-capture)
│   │   ├── index.ts                      # POST → INSERT affiliates with status=pending
│   │   └── index.test.ts
│   └── stripe-webhook/                   # Wave 1 — EXTEND with affiliate-conversion path
│       └── events/
│           ├── invoice-paid.ts           # EXTEND: read client_reference_id → INSERT affiliate_conversions
│           └── account-updated.ts        # NEW: Connect onboarding completion → UPDATE affiliates
└── migrations/
    ├── 20261201000001_subscriptions_provider_column.sql       # Wave 1
    ├── 20261201000002_tier_effective_view.sql                  # Wave 1
    ├── 20261201000003_affiliates_tables.sql                    # Wave 1
    ├── 20261201000004_affiliate_rls.sql                        # Wave 1
    ├── 20261201000005_affiliate_role_check_helper.sql          # Wave 1
    ├── 20261201000006_affiliate_click_baseline_mv.sql          # Wave 2
    ├── 20261201000007_fraud_trigger_conversion.sql             # Wave 2
    ├── 20261201000008_pg_cron_affiliate_payout.sql             # Wave 2
    └── 20261201000009_landing_page_template_seeds.sql          # Wave 2

src/
├── components/
│   ├── partner/                          # Wave 2 — partner dashboard
│   │   ├── PartnerDashboard.tsx
│   │   ├── PartnerLinksPage.tsx
│   │   ├── PartnerPayoutsPage.tsx
│   │   ├── PartnerAssetsPage.tsx
│   │   └── PartnerKPICard.tsx
│   ├── affiliate/                        # Wave 1 — apply form
│   │   ├── AffiliateApplyForm.tsx
│   │   └── AffiliateApplyPage.tsx
│   └── admin/
│       └── AdminAffiliatesScaffold.tsx   # Wave 2 — read-only stub for P22
├── lib/
│   ├── affiliate/                        # NEW domain
│   │   ├── api.ts                        # SELECT affiliate_clicks / conversions / payouts
│   │   ├── client-cookie.ts              # read _aff_v (NON-HttpOnly) cookie
│   │   ├── fingerprint.ts                # ThumbmarkJS lazy wrapper
│   │   └── slug.ts                       # name→slug + collision retry
│   ├── billing-sync.ts                   # EDIT — SELECT from tier_effective view, NOT subscriptions table
│   └── billing.ts                        # may need view-shape narrowing additions
└── App.tsx                                # EDIT — add /affiliate, /r/*, /partner/* lazy routes
```

### Pattern 1: Server-set first-party HttpOnly cookie

**What:** `Set-Cookie` header from Edge Function on a `.leanshot.app` route.
**When to use:** Any cross-origin attribution where the cookie must survive Safari ITP's 7-day JS-cookie cap.
**Source pattern:** `supabase/functions/share/cookie.ts` (Phase 8).

```typescript
// affiliate-attribute/cookie.ts (CLONE share/cookie.ts):
// Source: /Users/karstenhaldan/minisite/supabase/functions/share/cookie.ts:18-50
import { setCookie } from 'jsr:@std/http/cookie';

const AFF_COOKIE = '_aff';
const AFF_V_COOKIE = '_aff_v';  // Non-HttpOnly mirror for client-side reads

export function setAffiliateCookies(headers: Headers, referralCode: string, maxAgeSec: number): void {
  // Server-readable, authoritative
  setCookie(headers, {
    name: AFF_COOKIE,
    value: referralCode,
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',           // Lax NOT Strict — cookie must survive a 302 redirect from external referer
    domain: '.leanshot.app',   // Wildcard — accessible on www / app / r subdomains
    path: '/',
    maxAge: maxAgeSec,         // 30d = 2_592_000
  });
  // Client-readable mirror for stripe-checkout client_reference_id passthrough
  setCookie(headers, {
    name: AFF_V_COOKIE,
    value: referralCode,
    httpOnly: false,           // ← Different from _aff
    secure: true,
    sameSite: 'Lax',
    domain: '.leanshot.app',
    path: '/',
    maxAge: maxAgeSec,
  });
}
```

**Anti-pattern:** Hand-rolling `Set-Cookie: _aff=…; …` as a string. Phase 8's `cookie.ts` documents this as a known footgun.

### Pattern 2: `security_invoker = true` view for `tier_effective`

**What:** PostgreSQL view that honors caller's RLS at query time.
**When to use:** Any view that crosses RLS-protected tables.

```sql
-- 20261201000002_tier_effective_view.sql
-- Pitfall avoidance:
--   - WITH (security_invoker = true) — Supabase database-advisor lints
--     SECURITY DEFINER views as security warnings.
--     [CITED: supabase.com/docs/guides/database/database-advisors?lint=0010_security_definer_view]
--   - GROUP BY user_id + MAX(current_period_end) — forward-compatible with
--     RC (P16) which inserts rows with provider='revenuecat'. Stripe-only
--     today; mixed once P16-06 lands.

create or replace view public.tier_effective
with (security_invoker = true)
as
  select
    user_id,
    max(current_period_end) as effective_period_end,
    bool_or(status in ('active', 'trialing'))  as has_active,
    bool_or(status in ('past_due', 'unpaid'))  as has_past_due,
    -- Most-recent provider for the MAX(current_period_end) row — useful for the UI
    (
      array_agg(provider order by current_period_end desc nulls last)
    )[1] as winning_provider
  from public.subscriptions
  where user_id is not null
  group by user_id;

comment on view public.tier_effective is
  'MONEY-07: unifies Stripe + RevenueCat subscriptions via MAX(current_period_end). '
  'security_invoker=true honors per-row RLS — caller sees only their own row.';

-- Grant SELECT to authenticated; RLS on underlying subscriptions table still applies.
grant select on public.tier_effective to authenticated;
```

```typescript
// src/lib/billing-sync.ts — EDIT to SELECT from view, not table
const { data, error } = await supabase
  .from('tier_effective')                                      // ← was 'subscriptions'
  .select('effective_period_end, has_active, has_past_due, winning_provider')
  .eq('user_id', userId)
  .maybeSingle();
```

### Pattern 3: Fraud-signal trigger (IP /24, fingerprint, email-domain)

**What:** Postgres trigger fires on `affiliate_conversions` INSERT, sets `status='flagged'` if ANY signal matches.
**Source pattern:** Phase 9 `clinic_realtime_broadcast_triggers` (per-row triggers with side effects).

```sql
-- 20261201000007_fraud_trigger_conversion.sql
create or replace function public.flag_conversion_fraud()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_aff record;
  v_user_ip inet;
  v_user_fingerprint text;
  v_user_email text;
  v_public_domains text[] := array['gmail.com','yahoo.com','outlook.com','icloud.com','hotmail.com'];
  v_user_domain text;
  v_flagged boolean := false;
  v_signals jsonb := '[]'::jsonb;
begin
  -- Look up affiliate's signup IP / fingerprint
  select ip, fingerprint, email into v_aff
    from public.affiliates where id = new.affiliate_id;

  -- Look up converter's IP / fingerprint / email (from auth.users + Phase 7 audit_logs)
  select ip, fingerprint, email into v_user_ip, v_user_fingerprint, v_user_email
    from public.profiles_signup_metadata where user_id = new.user_id;

  -- Signal (a): IP /24 match
  if v_user_ip is not null and v_aff.ip is not null
     and set_masklen(v_user_ip, 24) = set_masklen(v_aff.ip::inet, 24) then
    v_flagged := true;
    v_signals := v_signals || '"ip_24_match"'::jsonb;
  end if;

  -- Signal (b): device fingerprint match
  if v_user_fingerprint is not null and v_user_fingerprint = v_aff.fingerprint then
    v_flagged := true;
    v_signals := v_signals || '"fingerprint_match"'::jsonb;
  end if;

  -- Signal (c): email-domain match (with public-email allowlist exemption)
  v_user_domain := split_part(v_user_email, '@', 2);
  if v_user_domain is not null
     and v_user_domain = split_part(v_aff.email, '@', 2)
     and not (v_user_domain = any(v_public_domains)) then
    v_flagged := true;
    v_signals := v_signals || '"email_domain_match"'::jsonb;
  end if;

  if v_flagged then
    new.status := 'flagged';
    new.fraud_signals := v_signals;
  end if;

  return new;
end;
$$;

create trigger trg_flag_conversion_fraud
before insert on public.affiliate_conversions
for each row execute function public.flag_conversion_fraud();
```

### Pattern 4: Z-score click-fraud (materialized view + refresh)

```sql
-- 20261201000006_affiliate_click_baseline_mv.sql
create materialized view public.affiliate_click_baseline as
  select
    affiliate_id,
    avg(daily_count) as mean_clicks,
    stddev_samp(daily_count) as stddev_clicks,
    max(date) as latest_baseline_date
  from (
    select affiliate_id, date_trunc('day', created_at)::date as date, count(*) as daily_count
    from public.affiliate_clicks
    where created_at > now() - interval '7 days'
    group by affiliate_id, date_trunc('day', created_at)
  ) daily
  group by affiliate_id;

-- Indexes for CONCURRENTLY refresh:
create unique index idx_click_baseline_affiliate on public.affiliate_click_baseline(affiliate_id);

-- Daily refresh via pg_cron:
select cron.schedule(
  'refresh-click-baseline',
  '0 1 * * *',  -- 01:00 UTC daily
  $$ refresh materialized view concurrently public.affiliate_click_baseline; $$
);
```

### Pattern 5: Page-builder template instances (3 landing-page variants)

**Source pattern:** Phase 15 `src/lib/page-builder/templates.ts` — code-defined template catalog + scaffold helper.

```typescript
// 20261201000009_landing_page_template_seeds.sql migration calls:
// INSERT INTO landing_pages (slug, blocks, ...) VALUES (...) FOR EACH of 3 affiliate-template instances
// The slug pattern: 'r/_template_coach', 'r/_template_story', 'r/_template_method'
// At affiliate approval, the admin handler:
//   1. Calls scaffoldFromTemplate({template: 'coach', overrides: {affiliate.display_name, ...}})
//   2. INSERTs a new landing_pages row with slug = 'r/{referral_code}'
//   3. page-render Edge Function serves the slug
```

This satisfies CONTEXT D-17: "Templates are Phase 15 page-builder template instances; admin pre-creates 3 templates; affiliate's customization fills slots only." The `scaffoldFromTemplate` helper already exists at `/Users/karstenhaldan/minisite/leanshot/src/lib/page-builder/templates.ts`.

### Anti-Patterns to Avoid
- **Hand-rolling `Set-Cookie` strings.** Use `jsr:@std/http/cookie`.
- **`stripe.payouts.create({destination_bank_account_id})` for affiliate commission disbursement.** This is for Custom Connect with bank-account IDs. Use `stripe.transfers.create({destination: acct_xxx, amount, currency: 'usd'})`.
- **`ON DELETE CASCADE` on `affiliate_*` foreign keys to `auth.users(id)`.** IRS requires 7-year retention on `payouts`. Use `ON DELETE SET NULL` + email anonymization. Pitfall 7 from PROJECT.md.
- **Trusting Stripe to enforce a 60-day chargeback hold.** Stripe Connect reserves are platform-set (default = none for Express). Enforce in our `payouts.eligible_at` column.
- **SECURITY DEFINER view for `tier_effective`.** Supabase database-advisor lints this as a security warning. Use `WITH (security_invoker = true)`.
- **Reading `_aff` HttpOnly cookie from JavaScript.** It's `HttpOnly` for a reason. Use the `_aff_v` mirror cookie for client-side reads (passing to Checkout's `client_reference_id`).
- **`SELECT … WHERE user_id IS NOT NULL` as a partial-index predicate without verifying IMMUTABLE.** Column IS NOT NULL IS IMMUTABLE — safe. Anything involving `now()` or function calls is NOT. (Phase 14 migration documents this.)
- **Enum types for `affiliates.status` / `payouts.status`.** CONTEXT D-03 locks text columns to avoid enum-add-in-same-tx pitfall (`feedback_planner_iter1_anti_patterns`).
- **Cascade DELETE crossing `audit_logs` without `app.suppress_audit` GUC.** Phase 7's `audit_trigger` will fire mid-cascade and FK-error. Wrap the deletion RPC with `set_config('app.suppress_audit', 'true', true)`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Tax-form collection (W-9/W-8BEN) | Custom form + form-storage flow | Stripe Connect Express hosted onboarding | IRS/FATCA compliance + state-by-state 1099-NEC filing rules + signature attestation = lawyers + ongoing maintenance |
| 1099-NEC generation + IRS filing | Custom IRS e-file integration | Stripe-issued (auto-generated at year-end) | IRS Modernized e-File requires platform registration; Stripe is already MeF-certified |
| Affiliate's payout-to-bank flow | Custom ACH integration | Stripe Connect's built-in payout schedules | Bank-account verification (microdeposits) + ACH return handling = compliance project on its own |
| Browser device fingerprinting | Custom canvas/audio/WebGL fingerprinting | ThumbmarkJS (or FingerprintJS OSS) | Canvas-fingerprint privacy regression detection in Chrome 130+ requires expert maintenance |
| Cookie-flag construction | `Set-Cookie: _aff=...; HttpOnly; Secure; ...` strings | `jsr:@std/http/cookie` | Phase 8 documents this as a known footgun |
| Z-score / stddev in app code | JS-side rolling baseline | Postgres materialized view + `stddev_samp` | DB-level aggregation is O(n) once; app-level is O(n) per check |
| Subnet `/24` comparison | String-slicing IP octets | `set_masklen(ip::inet, 24)` + `=` | Postgres `inet` is purpose-built; handles IPv4 + IPv6 cleanly [CITED: postgresql.org/docs/current/datatype-net-types] |
| Stripe webhook signature verification | Hash + HMAC manually | `stripe.webhooks.constructEventAsync` with `createSubtleCryptoProvider()` | Pattern locked by Phase 14 — Deno + Supabase canonical approach |

**Key insight:** Stripe Connect Express + page-builder templates + Phase 8 cookie helpers + Phase 7 cascade-deletion + Postgres `inet`/`stddev_samp` — Phase 19 is almost entirely composition of already-shipped patterns. The novel surface is ~20% of the work (Phase 15 template-instance seeding + ThumbmarkJS wiring + dual-cookie attribution flow).

## Runtime State Inventory

Phase 19 is **net-new tables + Edge Functions**, NOT a rename/refactor. This section is included for completeness; nearly all rows are "N/A" because no existing runtime state references affiliate concepts yet.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | **Net-new tables only** — `affiliates`, `affiliate_links`, `affiliate_clicks`, `affiliate_conversions`, `payouts`, `affiliate_click_baseline` (mv). No existing data to migrate. | None — clean migrations |
| Live service config | **Stripe Connect Express setup** — credentials provisioned in Phase 12 Plan 12-05 (per `project_phase12_execute_complete`). Vendor checkpoint `stripe-done` was the gate. P19 plan must verify `STRIPE_SECRET_KEY` + `STRIPE_CONNECT_*` env vars are in Vercel + Supabase Function secrets. **Resend account** — domain `app.leanshot.app` verified per Phase 12 Plan 12-05. P19 plan adds 3 new transactional template IDs (apply-received, apply-approved, apply-rejected, monthly-payout-summary). | Plan-time verify: `gh secret list` shows `STRIPE_*`; Resend dashboard shows `app.leanshot.app` verified. |
| OS-registered state | None — Phase 19 is web-only at v1.2 (iOS App Store referral-code first-launch deferred to P16 per D-22). | None |
| Secrets / env vars | New: `STRIPE_CONNECT_REFRESH_URL`, `STRIPE_CONNECT_RETURN_URL` (Edge Function env). No existing names renamed. | Add to Supabase Function secrets at plan time |
| Build artifacts | None — no package renames; no new top-level npm-installs except ThumbmarkJS + nanoid (lazy-chunked, NOT in index bundle). | Bundle ceiling check: ThumbmarkJS must NOT pull into index chunk — only `/r/*` + signup form chunks |

**Nothing found in `OS-registered state`** — verified: no pg_cron jobs reference 'affiliate'; no Windows Task Scheduler / launchd / systemd entries exist (project is browser-only SPA). New pg_cron jobs ADDED in Wave 2 (monthly payout + daily mv refresh).

## Common Pitfalls

### Pitfall 1: Express Connect deletion fails on non-zero balance
**What goes wrong:** Cascade step 6 (`accounts.del(acct_xxx)`) returns 400 `account_invalid` because affiliate has a pending balance.
**Why it happens:** Stripe API contract: live-mode Connect deletion requires zero balance. [CITED: docs.stripe.com/api/accounts/update]
**How to avoid:** Pre-flight check via `stripe.balance.retrieve({stripeAccount: acct_xxx})` → if `available + pending > 0`, return 409 with "wait for next payout cycle". The CONTEXT D-33 step 1 pre-flight already covers `pending` payouts in our DB; this extends it to Stripe's view of the balance.
**Warning signs:** `stripe-webhook` `payout.created` not yet `payout.paid`; large `pending` balance in Stripe Express dashboard.

### Pitfall 2: `client_reference_id` doesn't survive Stripe Customer Portal renewals
**What goes wrong:** Affiliate gets credit for the initial subscription, but renewal payments don't trigger new `affiliate_conversions` rows.
**Why it happens:** `client_reference_id` lives on the Checkout session, not the subscription. Renewals fire `invoice.paid` with no Checkout context.
**How to avoid:** On initial `checkout.session.completed`, persist `affiliate_code` into `subscriptions.metadata.affiliate_code` AND `stripe_customers.metadata.affiliate_code`. On subsequent `invoice.paid`, read from the subscription's metadata field. Recurring revenue still triggers affiliate conversions (matches CONTEXT D-08 "per paid conversion" — interpretation: per renewal, NOT just initial).
**Warning signs:** Affiliate dashboard's `recurring` conversions count is 0 despite paid subscribers; check `subscriptions.metadata` JSON.

### Pitfall 3: ThumbmarkJS shipped in index chunk
**What goes wrong:** Bundle index regresses from 21.49 kB gz baseline to ~35 kB gz, busts the 24.5 kB target.
**Why it happens:** Static import `import { Thumbmark } from '@thumbmark/thumbmarkjs'` at module-load time.
**How to avoid:** Lazy-load via `await import('@thumbmark/thumbmarkjs')` inside the signup-form handler. Add a `manualChunks` rule in `vite.config.ts` to isolate it into a `fingerprint` chunk. Reference Phase 6 `sync-defer.ts` pattern (per `project_phase5_bundle_regression`).
**Warning signs:** CI bundle-budget red on the PR.

### Pitfall 4: `_aff` cookie not set when `/r/{code}` redirected from external referer
**What goes wrong:** Affiliate posts URL to Twitter; user clicks; landing page renders but no conversion attribution.
**Why it happens:** Browser blocks cookie when `SameSite=Strict` + cross-origin referer.
**How to avoid:** `SameSite=Lax` (NOT `Strict`). Lax allows cookies on top-level navigations from external sites, blocking only on sub-resource embeds. CONTEXT D-21 correctly locks Lax.
**Warning signs:** Manual e2e from incognito + Twitter referer; cookie missing in DevTools Application tab.

### Pitfall 5: Materialized view refresh blocks SELECTs
**What goes wrong:** `REFRESH MATERIALIZED VIEW public.affiliate_click_baseline` takes 30+ seconds; partner dashboards 500.
**Why it happens:** Plain `REFRESH` takes an `ACCESS EXCLUSIVE` lock.
**How to avoid:** `REFRESH MATERIALIZED VIEW CONCURRENTLY public.affiliate_click_baseline`. **Requires a UNIQUE index on the view** (`idx_click_baseline_affiliate` in Pattern 4 above). Without the unique index, CONCURRENTLY fails with an explicit error.
**Warning signs:** pg_cron job logs report "REFRESH MATERIALIZED VIEW CONCURRENTLY cannot be used"; refresh time > 10s.

### Pitfall 6: Stripe `account_link.url` is one-time use
**What goes wrong:** Affiliate clicks the onboarding link 2 hours after admin approval email; gets "This link has expired" Stripe error page.
**Why it happens:** `account_links` URLs expire 5 minutes after creation. [CITED: docs.stripe.com/connect/express-accounts]
**How to avoid:** Generate the `account_link.url` JIT — when the affiliate clicks "Complete onboarding" in their partner dashboard, the dashboard calls `affiliate-connect-onboard` which creates a fresh `account_link` and returns the URL. NEVER persist the URL.
**Warning signs:** Affiliates report "expired link" on first-time onboarding; `account_links.create` not called from `/partner/dashboard`.

### Pitfall 7: `transfers.create` succeeds but funds never reach affiliate bank
**What goes wrong:** `transfers.create` returns 200 + transfer ID; `payouts.status='paid'` in our DB; affiliate emails "where's my money?"
**Why it happens:** `transfers.create` moves platform → connected-account *balance*. The connected account's payout schedule then moves balance → bank. If the account never set up a bank account (incomplete onboarding) or `payouts_enabled=false`, the balance just sits.
**How to avoid:** Before `transfers.create`, check `affiliates.stripe_payouts_enabled = true` (sourced from `account.updated` webhook). If false, set `payouts.status='blocked_onboarding'` instead of attempting transfer.
**Warning signs:** Stripe Express dashboard shows positive `available` balance for the affiliate but no recent payouts.

### Pitfall 8: 60-day chargeback hold + monthly cadence creates "where is my month-1 commission" UX
**What goes wrong:** Affiliate completes onboarding Jan 1, drives a $10 conversion Jan 5. Expects January payout. Reality: first payout is March 1 (60-day hold from Jan 5 = March 6, falls into March 1 cron cycle? No — March 1 cron only sees `eligible_at < now` = Jan 5 + 60 days = March 6 > March 1, so it picks up in April 1 cycle).
**Why it happens:** Affiliates expect monthly-on-the-1st payouts; reality is 60-day rolling eligibility + monthly batch = ~90-day lag for first payment.
**How to avoid:** Partner dashboard "Next payout ETA" field that computes `MIN(eligible_at)` across pending payouts and shows the next 1st-of-month after that. CONTEXT D-30's "Commissions earned in month M paid out in month M+2" copy must be in the dashboard verbatim.
**Warning signs:** Affiliate support tickets asking "where's my money"; check dashboard ETA field accuracy.

### Pitfall 9: `app.suppress_audit` GUC scope leak
**What goes wrong:** During cascade-deletion, GUC is set via `set_config('app.suppress_audit', 'true', true)`. But if the SET is at session scope (not transaction scope, third arg `false`), subsequent unrelated queries in the connection silently skip audit_logs.
**Why it happens:** `set_config(name, value, is_local)` — `is_local=true` is required for transaction-local scope.
**How to avoid:** Always pass `is_local=true` (third arg). Phase 7's `finalize_account_deletion` already does this correctly; copy verbatim.
**Warning signs:** `audit_logs` table missing entries for normal operations after a cascade-deletion runs.

### Pitfall 10: Cookie set on `.leanshot.app` but Supabase Edge Function URL is `*.supabase.co`
**What goes wrong:** `affiliate-attribute` Edge Function returns `Set-Cookie: _aff=…; Domain=.leanshot.app` but browser rejects the cookie (cross-origin Domain mismatch).
**Why it happens:** Cookie `Domain` attribute must match the response's origin OR be a parent of it. `*.supabase.co` cannot set a cookie for `.leanshot.app`.
**How to avoid:** Route `/r/{code}` through Vercel rewrite proxying to the Edge Function. The browser sees `leanshot.app/r/{code}` as the origin → Domain=.leanshot.app is valid. **`vercel.json`:**
```json
{
  "rewrites": [
    { "source": "/r/:code", "destination": "https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/affiliate-attribute?code=:code" }
  ]
}
```
Vercel rewrites pass through `Set-Cookie` headers transparently.
**Warning signs:** DevTools Application tab shows no `_aff` cookie after `/r/{code}` navigation; Network tab shows `Set-Cookie` header in response but browser rejected it.

## Code Examples

### `affiliate-attribute` Edge Function — full handler skeleton

```typescript
// supabase/functions/affiliate-attribute/index.ts
// Source pattern: supabase/functions/share/index.ts (Phase 8)
// + supabase/functions/lead-capture/index.ts (Phase 15) for verify_jwt=false
import { createClient } from 'npm:@supabase/supabase-js@2';
import { setCookie } from 'jsr:@std/http/cookie';
import { BASE_RESPONSE_HEADERS } from './cors.ts';
import { setAffiliateCookies } from './cookie.ts';
import { isRefererAllowed } from './referer.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const COOKIE_TTL_SEC = 30 * 24 * 3600; // 30 days
const COLD_START_CAP_CLICKS_PER_DAY = 500;

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get('code') ?? '';
  if (!/^[a-z0-9-]{4,80}$/.test(code)) {
    return new Response('Not found', { status: 404 });
  }

  // 1. Validate referral_code exists, fetch affiliate metadata
  const { data: aff } = await admin
    .from('affiliates')
    .select('id, status, ip, fingerprint, allowed_referer_hosts, created_at')
    .eq('referral_code', code)
    .maybeSingle();

  if (!aff || aff.status !== 'approved') {
    return new Response('Not found', { status: 404 });
  }

  // 2. Fraud filter: Referer host check (D-28)
  const refererHeader = req.headers.get('Referer');
  const ua = req.headers.get('User-Agent') ?? '';
  const isMobileApp = ua.includes('LeanShot/'); // Capacitor sends custom UA — exempt
  const refererOk = isMobileApp || isRefererAllowed(refererHeader, aff.allowed_referer_hosts);

  // 3. Cold-start cap (D-27)
  const isColdStart = new Date(aff.created_at) > new Date(Date.now() - 7 * 24 * 3600 * 1000);
  let dailyClicks = 0;
  if (isColdStart) {
    const { count } = await admin
      .from('affiliate_clicks')
      .select('*', { count: 'exact', head: true })
      .eq('affiliate_id', aff.id)
      .gt('created_at', new Date(Date.now() - 24 * 3600 * 1000).toISOString());
    dailyClicks = count ?? 0;
  }

  const overCap = isColdStart && dailyClicks >= COLD_START_CAP_CLICKS_PER_DAY;
  const flagged = !refererOk || overCap;

  // 4. INSERT click row (flagged or unflagged — D-27 still inserts)
  await admin.from('affiliate_clicks').insert({
    affiliate_id: aff.id,
    referral_code: code,
    ip: req.headers.get('x-forwarded-for')?.split(',')[0],
    user_agent: ua,
    referer: refererHeader,
    flagged,
  });

  // 5. Set cookies + 302 to landing page (only if NOT a hard reject — but per D-28
  //    we INSERT even rejected clicks, just don't set cookie). Adjust per CONTEXT.
  const headers = new Headers(BASE_RESPONSE_HEADERS);
  if (!flagged) {
    setAffiliateCookies(headers, code, COOKIE_TTL_SEC);
  }
  headers.set('Location', `/r/${code}/landing`); // Renders co-branded landing page via page-render

  return new Response(null, { status: 302, headers });
});
```

### `affiliate-connect-onboard` — Stripe account_link generation

```typescript
// supabase/functions/affiliate-connect-onboard/index.ts
import Stripe from 'https://esm.sh/stripe@19?target=denonext';
import { createClient } from 'npm:@supabase/supabase-js@2';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2026-04-22.dahlia' as Stripe.LatestApiVersion,
});

Deno.serve(async (req) => {
  // 1. authn caller (JWT) — gateway already verified via verify_jwt=true
  const authHeader = req.headers.get('Authorization');
  // ... extract user_id from JWT ...

  // 2. SELECT affiliate row
  const { data: aff } = await admin
    .from('affiliates')
    .select('id, stripe_connect_account_id')
    .eq('user_id', user_id)
    .single();

  let accountId = aff.stripe_connect_account_id;

  // 3. Create Stripe Connect account if needed (one-time per affiliate)
  if (!accountId) {
    const acct = await stripe.accounts.create({
      type: 'express',
      country: 'US', // TODO: detect from affiliate-profile
      capabilities: {
        transfers: { requested: true }, // CRITICAL — without this, transfers.create 400s
      },
      business_type: 'individual',
      metadata: { affiliate_id: aff.id, leanshot_user_id: user_id },
    });
    accountId = acct.id;
    await admin
      .from('affiliates')
      .update({ stripe_connect_account_id: accountId })
      .eq('id', aff.id);
  }

  // 4. Generate fresh one-time account_link (5-min TTL — see Pitfall 6)
  const link = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: `${Deno.env.get('STRIPE_CONNECT_REFRESH_URL')}/partner/payouts?retry=1`,
    return_url: `${Deno.env.get('STRIPE_CONNECT_RETURN_URL')}/partner/payouts?onboarded=1`,
    type: 'account_onboarding',
    // collection_options.future_requirements='include' would also collect W-9
    // up-front; we leave default to defer W-9 until $500 threshold reached (D-31).
  });

  return new Response(JSON.stringify({ url: link.url }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
```

### `affiliate-payout` Edge Function — monthly batch transfer

```typescript
// supabase/functions/affiliate-payout/index.ts
import Stripe from 'https://esm.sh/stripe@19?target=denonext';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2026-04-22.dahlia' as Stripe.LatestApiVersion,
});

// Called from pg_cron (1st of month 00:00 UTC).
// Triggered via pg_net → POST /affiliate-payout (verify_jwt=true,
// service-role key in Authorization header from Supabase Vault).
Deno.serve(async (req) => {
  // 1. SELECT eligible payouts
  const { data: eligible } = await admin
    .from('payouts')
    .select('id, affiliate_id, amount_cents, affiliates!inner(stripe_connect_account_id, stripe_payouts_enabled)')
    .eq('status', 'pending')
    .lt('eligible_at', new Date().toISOString())
    .gte('amount_cents', 50000); // $500 W-9 threshold (D-31)

  for (const p of eligible ?? []) {
    if (!p.affiliates.stripe_payouts_enabled) {
      await admin.from('payouts').update({ status: 'blocked_onboarding' }).eq('id', p.id);
      continue;
    }

    // 2. Idempotency key — UUID per payout row, retained across retries
    const idempotencyKey = `affiliate_payout_${p.id}`;

    try {
      const transfer = await stripe.transfers.create(
        {
          amount: p.amount_cents,
          currency: 'usd',
          destination: p.affiliates.stripe_connect_account_id!,
          metadata: { payout_id: p.id, affiliate_id: p.affiliate_id },
        },
        { idempotencyKey },
      );

      await admin
        .from('payouts')
        .update({ status: 'paid', stripe_transfer_id: transfer.id, paid_at: new Date().toISOString() })
        .eq('id', p.id);
    } catch (err) {
      // Retry logic (D-32 — 3 attempts at 24h, then 'failed')
      await admin.rpc('increment_payout_retry', { p_payout_id: p.id });
      // On retry exhaustion → status='failed' + Resend admin alert (in retry RPC)
    }
  }

  return new Response('ok', { status: 200 });
});
```

### Extending `stripe-webhook` — affiliate attribution on `invoice.paid`

```typescript
// supabase/functions/stripe-webhook/events/invoice-paid.ts (EXTEND)
export async function onInvoicePaid(event: Stripe.Event, admin: SupabaseClient) {
  const invoice = event.data.object as Stripe.Invoice;

  // Existing Phase 14 logic: UPDATE subscriptions table from invoice
  // ...

  // NEW: affiliate attribution
  const subscriptionId = invoice.subscription as string | null;
  if (!subscriptionId) return;

  // Read affiliate_code from subscription metadata (set on checkout.session.completed)
  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  const affiliateCode = sub.metadata?.affiliate_code;
  if (!affiliateCode) return;

  // Look up affiliate
  const { data: aff } = await admin
    .from('affiliates')
    .select('id, commission_rate_cents, status')
    .eq('referral_code', affiliateCode)
    .single();
  if (!aff || aff.status !== 'approved') return;

  // INSERT conversion (trigger flag_conversion_fraud will set status='flagged' if signals match)
  await admin.from('affiliate_conversions').insert({
    affiliate_id: aff.id,
    user_id: sub.metadata?.user_id ?? null,
    subscription_id: subscriptionId,
    invoice_id: invoice.id,
    commission_cents: aff.commission_rate_cents, // $10 default (D-08)
    status: 'pending', // 60-day eligible_at; cron flips to 'eligible' after hold
    invoice_paid_at: new Date(invoice.status_transitions.paid_at! * 1000).toISOString(),
  });
}
```

## State of the Art

| Old Approach | Current Approach (2026) | When Changed | Impact |
|--------------|------------------------|--------------|--------|
| `client_reference_id`-only attribution | Dual-cookie (`_aff` HttpOnly server + `_aff_v` client) + `client_reference_id` passthrough | Safari 14 ITP (2020) → enforcement worsened through 2024 | First-party cookies must be server-set; document.cookie writes capped at 7-day. |
| Custom W-9 form + custom 1099-NEC e-file | Stripe Connect Express hosted (W-9 + 1099-NEC + W-8BEN) | Stripe Connect 1099 feature shipped 2022 | Eliminates 6-week compliance project per platform launch. |
| FingerprintJS OSS (40-60% accuracy) | ThumbmarkJS (80% accuracy, MIT) or Fingerprint Pro (99.5%, paid) | 2024 ThumbmarkJS gained traction (60k+ sites) | Free option moved from "barely useful" to "production-grade for fraud signal". |
| IRS 1099-NEC threshold $600 | IRS 1099-NEC threshold $2,000 | Jan 1, 2026 (OBBB Act July 2025) | Many platforms still configured for $600; we have an option to relax our internal $500 W-9 collection trigger up to $2,000. |
| Custom-mode Connect for marketplace | Express-mode Connect | 2023 — Express dashboard reached feature-parity with Custom for most use cases | We don't need to build the dashboard; affiliates manage their tax + payout schedule themselves. |
| `usage_records.create` for metered billing | Billing Meters API (`v1/billing/meters`) | Stripe API `2025-03-31.basil` deprecation | Phase 14 already on Meters — not relevant to P19 but confirms the platform is current. |
| `subscriptions.cancel_at_period_end=true` + sub-day grace | Same — still current API for affiliate-Stripe-customer-deletion cascade | unchanged | CONTEXT D-33 step 5's "cancel subs first" remains correct. |

**Deprecated/outdated:**
- **Custom Connect for new platforms** — Stripe now recommends Standard or Express; Custom is "legacy" terminology. Our use of "Express" matches the recommendation.
- **`stripe.payouts.create` from platform on behalf of connected account** — discouraged; rely on connected-account's payout schedule instead.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | D-31's "$500 strict" is platform-set, not Stripe Connect Express default | Pitfall 2 / Summary #1 | If wrong: we lose nothing — platform-set is strictly more flexible than vendor-default. But CONTEXT.md wording suggests user thinks Stripe enforces $500 automatically; planner should confirm at discuss-phase OR plan-phase amendment. |
| A2 | Vercel rewrite preserves `Set-Cookie` from Supabase Edge Function | Pitfall 10 | If wrong: cookie never sets, all affiliate attribution silently fails. **Verifiable at plan-time:** write a smoke-test curl against an existing Vercel-rewrite endpoint and inspect headers. |
| A3 | ThumbmarkJS bundle <= 12 kB gz lazy-chunked | Supporting Stack | If wrong: bundle ceiling regression. Verifiable: `npx vite build && du -h dist/assets/fingerprint-*.js.gz`. |
| A4 | Phase 12's `stripe-done` vendor checkpoint includes Connect Express enablement | Runtime State / Live Service Config | If wrong: a P19 Wave 1 plan needs an extra "enable Connect Express" Stripe dashboard step. Verifiable via Stripe dashboard `/settings/connect` URL. |
| A5 | `client_reference_id` survives renewal `invoice.paid` events via `subscription.metadata` mirror | Pitfall 2 | If wrong: only initial conversions tracked, renewals lost — affiliate revenue is initial-only. Mitigation already planned (mirror to `subscriptions.metadata.affiliate_code`). |
| A6 | `affiliate-attribute` running on `*.supabase.co` cannot set `Domain=.leanshot.app` cookies without Vercel rewrite | Pitfall 10 | If wrong (alternate solution exists): we save a Vercel rewrite rule. Risk: low. |
| A7 | Phase 15 `scaffoldFromTemplate` helper can scaffold from a template ID, not just a block-tree literal | Pattern 5 | If wrong: P19 needs a small extension to `templates.ts`. Risk: low; the helper is already pure and tested. |
| A8 | Affiliate-role claim via `auth.users.app_metadata.role='affiliate'` is recognized by an existing Phase 9/10 route gate that P19 can reuse | Architectural Map | If wrong: P19 must ship a brand-new role-gate. Grep showed `app_metadata` is NOT yet wired in src/; **mitigation: P19 ships the gate as new infrastructure regardless. Reuse claim only.** |

## Open Questions (RESOLVED)

> All 4 open questions resolved via `19-CONTEXT-ADDENDUM-research.md` (committed 2026-05-15). Inline annotations below.

1. **RESOLVED → 19-CONTEXT-ADDENDUM-research.md § D-31 (AMENDED).** $500 is deliberate fraud-reduction policy (user-confirmed 2026-05-15) — front-loads identity verification well below 2026 IRS legal $2,000 threshold. Implementation via configurable `affiliates.tax_threshold_cents` column (default 50000), not Stripe default. Original wording "Stripe Connect default" was wrong rationale; the $500 number itself stands.

2. **RESOLVED → 19-CONTEXT-ADDENDUM-research.md § D-37 #1.** Vercel rewrite preservation of `Set-Cookie` is a Wave-0 10-min smoke task in Plan 19-02 Task 1. Asserts `Set-Cookie: _aff=test; Domain=.leanshot.app` is present after rewrite. Fallback: subdomain `r.leanshot.app` pointed at Supabase function URL if smoke fails.

3. **RESOLVED → 19-CONTEXT-ADDENDUM-research.md § D-36 (NEW).** Renewals do NOT count as conversions (user-confirmed 2026-05-15). `stripe-webhook` filters `invoice.billing_reason = 'subscription_create'` only; renewals (`subscription_cycle`) write zero `affiliate_conversions` rows. Single $10 per converted user; bounded liability per CONTEXT D-08.

4. **RESOLVED → 19-CONTEXT-ADDENDUM-research.md § D-37 #2.** Phase 12 `stripe-done` capability check is a Wave-0 smoke task in Plan 19-03 Task 1. Calls `https://api.stripe.com/v1/account` and asserts `capabilities.transfers === 'active'`. If not active, vendor task added to enable transfers via Stripe dashboard before any `transfers.create` runs.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Stripe Connect Express | AFF-03, AFF-06, MONEY-10 | ✓ (per Phase 12 vendor checkpoint `stripe-done`) | — | None — required |
| Resend (transactional email) | AFF-05 (apply-received, approved, rejected), AFF-06 (payout summary) | ✓ (per Phase 12 vendor checkpoint `resend-done`) | — | None — required |
| pg_cron + pg_net | AFF-06 (monthly batch), AFF-08 (mv refresh) | ✓ (used in Phase 7 `anon_cleanup_pg_cron`) | bundled | None — required for monthly automation; could fall back to Vercel Cron + Edge Function for the monthly batch |
| Supabase Storage | AFF-04 (marketing-assets/v1/), AFF-09 (affiliate photos) | ✓ | Free tier (Pro deferred per `project_phase16_research_complete`) | Storage transforms unavailable on Free — client-side `object-fit:cover` fallback per CONTEXT D-20 |
| Vercel rewrites | Pitfall 10 (proxy `/r/*` to Supabase Edge Function) | ✓ | — | If `Set-Cookie` doesn't pass through, deploy `affiliate-attribute` as Vercel Edge Function |
| Postgres `inet` type + `set_masklen` | AFF-07 (IP /24 fraud signal) | ✓ (built-in, Postgres 15+) | — | None — built-in |
| Postgres materialized views | AFF-08 (Z-score baseline) | ✓ | — | None — built-in |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** Supabase Storage transforms (Pro-only) — fallback already planned (client-side `object-fit:cover`).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework (frontend) | Vitest (config at `/Users/karstenhaldan/minisite/leanshot/vitest.config.ts`) + Playwright (e2e at `/Users/karstenhaldan/minisite/leanshot/playwright.config.ts`) |
| Framework (Edge Functions) | Deno test (`<name>.test.ts` per `reference_deno_test_discovery`) |
| Config file (frontend) | `vitest.config.ts`, `playwright.config.ts` |
| Quick run command | `npm run test -- src/lib/affiliate/` (Vitest unit) |
| Full suite command | `npm test && npm run test:e2e && cd supabase && deno test functions/affiliate-*/` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AFF-01 | `affiliates`, `affiliate_clicks`, `affiliate_conversions`, `payouts` exist with correct RLS | unit (Postgres) | `supabase test db` against migration | ❌ Wave 0 — `supabase/tests/affiliate_schema.test.sql` |
| AFF-02 | `/r/{code}` sets HttpOnly first-party cookie via Edge Function | unit + integration | `deno test supabase/functions/affiliate-attribute/` + Playwright `tests/e2e/affiliate-cookie.spec.ts` | ❌ Wave 0 |
| AFF-03 | Stripe Connect Express account created + account_link URL returned | integration | `deno test supabase/functions/affiliate-connect-onboard/` (mocked Stripe) | ❌ Wave 0 |
| AFF-04 | Partner dashboard renders 4 KPI cards + chart + activity feed; 10-min SWR poll | unit (component) + e2e (smoke) | `vitest src/components/partner/` + `playwright tests/e2e/partner-dashboard.spec.ts` | ❌ Wave 0 |
| AFF-05 | Apply form POST creates `affiliates` row with `status='pending'` + Resend dispatch | integration | `deno test supabase/functions/affiliate-apply/` (Resend mocked) | ❌ Wave 0 |
| AFF-06 | Monthly batch `transfers.create` only for eligible payouts (≥ $500 + ≥ 60 days post-conversion) | unit + integration | `deno test supabase/functions/affiliate-payout/` (Stripe mocked) | ❌ Wave 0 |
| AFF-07 | Conversion fraud trigger flags on IP /24, fingerprint, email-domain match | unit (Postgres) | `supabase test db` against trigger | ❌ Wave 0 |
| AFF-08 | Z-score click-fraud + Referer fraud + cold-start cap enforcement | unit (Postgres + Deno) | trigger test + `deno test affiliate-attribute/` | ❌ Wave 0 |
| AFF-09 | Co-branded landing page at `/r/{code}/landing` renders affiliate's display_name + photo + Calendly | integration (page-render extension) | `vitest src/lib/page-builder/affiliate-template.test.ts` + e2e | ❌ Wave 0 |
| AFF-10 | Account deletion anonymizes ledger; payouts retained; auth.users gone | e2e | `playwright tests/e2e/affiliate-account-delete.spec.ts` | ❌ Wave 0 |
| MONEY-07 | `tier_effective` view: two overlapping Stripe subs → MAX(period_end) | unit (Postgres) | `supabase test db` against view | ❌ Wave 0 |
| MONEY-07 fwd-compat | Insert RC row → view returns MAX of both providers | unit (Postgres) | same test, extended | ❌ Wave 0 |
| MONEY-10 | 10-step cascade ordering | e2e | reuse AFF-10 spec (combined test) | shared with AFF-10 |

### Sampling Rate
- **Per task commit:** `npm run test -- <affected-module>` (Vitest fast path) + `deno test <affected-function>` if Edge Function touched
- **Per wave merge:** `npm test && npm run test:e2e && cd supabase && deno test`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `supabase/tests/affiliate_schema.test.sql` — schema + RLS test (AFF-01)
- [ ] `supabase/functions/affiliate-attribute/index.test.ts` — Deno tests (AFF-02, AFF-08)
- [ ] `supabase/functions/affiliate-connect-onboard/index.test.ts` — Deno tests (AFF-03)
- [ ] `supabase/functions/affiliate-apply/index.test.ts` — Deno tests (AFF-05)
- [ ] `supabase/functions/affiliate-payout/index.test.ts` — Deno tests (AFF-06)
- [ ] `src/components/partner/PartnerDashboard.test.tsx` — Vitest component test (AFF-04)
- [ ] `src/lib/affiliate/api.test.ts` — Vitest unit (AFF-04 data layer)
- [ ] `src/lib/page-builder/affiliate-template.test.ts` — Vitest (AFF-09)
- [ ] `tests/e2e/affiliate-cookie.spec.ts` — Playwright (AFF-02)
- [ ] `tests/e2e/affiliate-account-delete.spec.ts` — Playwright (AFF-10 + MONEY-10)
- [ ] `tests/e2e/partner-dashboard.spec.ts` — Playwright (AFF-04 smoke)
- [ ] `supabase/tests/tier_effective_view.test.sql` — Postgres view test (MONEY-07 + fwd-compat)
- [ ] `supabase/tests/flag_conversion_fraud.test.sql` — trigger test (AFF-07)

Framework install: Not needed — Vitest, Playwright, Deno test all available.

## Security Domain

`security_enforcement` is not set to false in `.planning/config.json` — applies.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Supabase Auth JWT verification on `affiliate-connect-onboard` / `affiliate-payout` (verify_jwt=true); `affiliate-attribute` is public (verify_jwt=false) — auth IS the referral code itself, no JWT needed. |
| V3 Session Management | yes | `_aff` HttpOnly + Secure + SameSite=Lax cookie. Server-issued. Domain=.leanshot.app + 30d TTL. |
| V4 Access Control | yes | RLS on all `affiliate_*` tables (affiliate reads own only, admin reads all). `auth.users.app_metadata.role='affiliate'` claim gates `/partner/*` routes. `role='admin'` gates `/admin/affiliates`. |
| V5 Input Validation | yes | `zod`-like manual validation on apply-form fields (email format, max-length, audience-type enum). Honeypot + rate-limit (5/15min/IP) cloned from `lead-capture`. Referral code regex: `/^[a-z0-9-]{4,80}$/`. |
| V6 Cryptography | yes | SHA-256 for email anonymization in cascade-delete (D-33 step 2). No envelope encryption (pgsodium deprecated per Phase 7 research). |
| V7 Error Handling | yes | All Edge Functions return `{ error: 'short_code' }` — no Stripe error messages echoed (could leak account IDs). Phase 14 pattern. |
| V9 Communications | yes | TLS required on all cookies + Storage signed URLs. `Cache-Control: private, no-store` on all `affiliate-attribute` responses (prevents CDN from caching the 302 + cookie). |
| V11 Business Logic | yes | Idempotency keys on `transfers.create` (D-32 retry semantics). UNIQUE constraint on `affiliate_conversions.invoice_id` (prevents double-counting). |
| V13 API & Web Service | yes | CORS allowlist (echo Origin from env-driven list) — cloned from `share/cors.ts`. No `Access-Control-Allow-Origin: *`. |

### Known Threat Patterns for {Supabase Edge + Stripe Connect + Browser SPA}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Affiliate self-conversion (referrer === purchaser) | Tampering / Repudiation | IP /24 + fingerprint + email-domain fraud trigger (AFF-07) — auto-flag, manual admin review |
| Referral-code stuffing (mass clicks to game payouts) | Tampering | Z-score 3σ baseline + 500/day cold-start cap (AFF-08, D-26/D-27) |
| Fake-Referer click injection | Spoofing | Referer-host allowlist per affiliate (D-28) — reject if not in profile-listed hosts (mobile-app UA exempt) |
| Stripe webhook replay | Tampering | `subscription_events.event_id` UNIQUE + signature verification with `createSubtleCryptoProvider` (Phase 14 pattern) |
| Stale `account_link` URL phishing | Spoofing | JIT generation only — never persisted; 5-min Stripe TTL (Pitfall 6) |
| Cookie session fixation | Spoofing | HttpOnly + Secure + SameSite=Lax; cookie value IS the referral code (no secret session token to fixate) |
| SQL injection via referral_code URL param | Tampering | regex `/^[a-z0-9-]{4,80}$/` validation BEFORE DB query; parameterized supabase-js client |
| Cross-tenant affiliate data exfiltration | Information Disclosure | RLS policies `auth.uid() = affiliates.user_id`; service-role used only in Edge Functions |
| Cascade-deletion mid-flight failure leaving zombie data | Repudiation / Information Disclosure | Audit-log every step (D-34); `app.suppress_audit` GUC scope-local; pre-flight 409 returns clean state |
| Trojan affiliate code in `client_reference_id` to attribute to attacker | Tampering | Validate `affiliates.status='approved'` on webhook attribution; non-approved codes silently no-op |
| Storage URL TTL too long for marketing assets | Information Disclosure | Signed URL TTL = 1 hour (recommend), regenerated on each download |

## Project Constraints (from CLAUDE.md)

- **Tech stack**: React 19 + Vite + TS strict + Tailwind v4 beta + Zustand — all Phase 19 UI must follow this. **No router** — `/affiliate`, `/r/*`, `/partner/*`, `/admin/affiliates` must derive view selection from `useStore((s) => …)` similar to `App.tsx`'s marketing/onboarding/dashboard pick.
- **Bundle size**: chart.js + framer-motion + lucide-react are already heavy. ThumbmarkJS + Stripe.js MUST lazy-load (dynamic `import()`) — never static-import in `App.tsx` / `main.tsx` / `store.ts` (per `project_phase5_bundle_regression`). Phase 14 already set up `sync-defer.ts` — reuse for ThumbmarkJS.
- **Single Zustand store**: New affiliate slice must live in `src/lib/store.ts` — no separate stores. Persisted via `partialize` only if user-data-relevant (referral code may be persisted; payout history is server-side only).
- **Strict TS**: All Edge Function code + frontend code under `tsconfig.app.json` strict. No `s.user!` non-null assertions (per Phase 7 D-06 sweep tracked by 07-09 / DEBT-02). Use early returns + typed guards.
- **No SSR**: All `/r/{code}/landing` rendering via `page-render` Edge Function returns HTML, not via React SSR.
- **Compliance posture**: HIPAA BAA not yet active (per PROJECT.md). Don't accept PHI in affiliate flow (affiliates are influencers, not patients — keep them in separate trust zone from clinic operators).

## Project Constraints (from project memory)

| Source | Constraint | How P19 honors |
|--------|------------|----------------|
| `reference_supabase_edge_function_deploy.md` | Use esm.sh URLs (no bare imports); gateway overrides Content-Type for HTML responses | All Edge Functions import via `https://esm.sh/stripe@19?target=denonext` + `jsr:@std/http/cookie`. `affiliate-attribute` returns 302 (no body) — Content-Type override irrelevant. |
| `reference_supabase_migration_gotchas.md` | IMMUTABLE partial-index predicates; no SECURITY DEFINER; `app.suppress_audit` GUC for cascade | All P19 partial indexes use `WHERE col IS NOT NULL`. `tier_effective` view uses `security_invoker=true`. Cascade-deletion calls `set_config('app.suppress_audit', 'true', true)`. |
| `reference_deno_test_discovery.md` | Deno test files: `<name>.test.ts` NOT `<name>-test.ts` | All P19 Edge Function tests named `index.test.ts`. |
| `feedback_planner_iter1_anti_patterns.md` | Anticipate enum-add-in-same-tx; CREATE POLICY forward-refs; etc. | CONTEXT D-03 locks text columns over enums. P19 migration sequencing: schema → RLS in separate migration files; never CREATE POLICY before underlying table exists in same tx. |
| `reference_eslint_import_x_path_gotcha.md` | Directory zones use bare path; file zones use glob | Not relevant — no new firewall zones in P19. |
| `project_phase16_research_complete.md` | Supabase Pro deferral; Storage transforms client-side fallback | D-20 already locks fallback. |
| `feedback_parallel_executor_git_isolation.md` | Pathspec commits for parallel executors touching shared files | **Plan must flag:** Wave 1's "extend stripe-webhook" plan must use `git commit -- supabase/functions/stripe-webhook/events/invoice-paid.ts` pathspec. Same for `vite.config.ts` if multiple plans add chunks. |
| `feedback_defer_then_batch_fix_pattern.md` | If CI-only flakes appear, `test.fixme` + central deferred-tests.md | P19 e2e tests against live Stripe + Resend may flake. If a Wave 2 e2e test goes red on env-issue, defer to `deferred-tests.md` and batch-fix at milestone close (per Phase 23 DEBT-04 pattern). |
| `feedback_verify_human_uat_via_cli.md` | Most "human_needed" vendor checkpoints are CLI-verifiable | Stripe Connect Express config is verifiable via `stripe accounts list --limit=0` + Resend domain via `curl api.resend.com/domains`. |
| `reference_supabase_auth_traps.md` | Implicit-grant + hash-routes = double-`#`; admin.generateLink for e2e | Phase 4 promotion flow (anon → email/password) — affiliate sign-up is non-anon, simpler. But if any test uses the email-link flow, mock via `admin.generateLink` per the playbook. |
| `feedback_orchestrator_inline_fix_pattern.md` | When SendMessage unavailable, fix in main + sync to worktree + commit on agent's branch + merge | Standard worktree handoff applies. |
| `feedback_realtime_layer_e2e_pattern.md` | DB-level invariants over UI traversal for Realtime tests | Not applicable — P19 has no Realtime channel (D-10 locks 10-min poll). |

## Sources

### Primary (HIGH confidence)
- Context7 `/websites/stripe` — Connect Express, account_links, transfers.create, account.updated webhook, account deletion conditions
- `docs.stripe.com/connect/express-accounts` — Express creation with capabilities[transfers][requested]=true
- `docs.stripe.com/connect/separate-charges-and-transfers` — `transfers.create` for platform → connected account
- `docs.stripe.com/connect/connect-w8-w9-onboarding` — Platforms set their own W-8/W-9 thresholds
- `docs.stripe.com/connect/hosted-onboarding` — `account_link.url` flow; `account.updated` webhook for completion
- `docs.stripe.com/api/accounts/update` — Account deletion live-mode zero-balance requirement
- `docs.stripe.com/connect/connected-account-reserves` — Rolling reserve max 180 days; platform-set
- `supabase.com/docs/guides/database/database-advisors?lint=0010_security_definer_view` — security_invoker view advisor
- `supabase.com/docs/guides/functions/schedule-functions` — pg_cron + pg_net Edge Function trigger
- Phase 8 codebase: `supabase/functions/share/cookie.ts` — verified `jsr:@std/http/cookie` pattern
- Phase 14 codebase: `supabase/functions/stripe-webhook/index.ts` — verified webhook signature verification + Idempotency pattern
- Phase 15 codebase: `src/lib/page-builder/templates.ts` — verified scaffoldFromTemplate helper
- Phase 7 codebase: `supabase/migrations/20260601000017_audit_trigger_suppress_guc.sql` — verified `app.suppress_audit` GUC pattern
- Phase 14 codebase: `supabase/migrations/20260601000019_stripe_subscriptions.sql` — verified partial-index + RLS patterns
- `postgresql.org/docs/current/datatype-net-types` — `inet` type, `set_masklen`, `<<=` subnet operators

### Secondary (MEDIUM confidence)
- WebSearch verified via Stripe docs: 2026 IRS 1099-NEC threshold $2,000 — confirmed against `1800accountant.com` + OBBB Act references
- WebSearch: ThumbmarkJS vs FingerprintJS OSS accuracy claims — single-source from `thumbmarkjs.com`, but corroborated by GitHub adoption count (60k+ sites)
- WebSearch: Safari ITP 2026 server-side cookie 400-day persistence — corroborated across `seresa.io`, `jentis.com`, `stape.io`
- npm registry: stripe@22.1.1 latest version 2026-05-15

### Tertiary (LOW confidence) — flagged for verification at plan-time
- Vercel rewrite `Set-Cookie` pass-through behavior — no authoritative doc source; verifiable empirically (Assumption A2)
- ThumbmarkJS gzipped bundle size — claim ~12 kB, verifiable via `vite build`
- Phase 12 `stripe-done` vendor checkpoint scope (did it include Connect Express + transfers capability + hosted-tax-forms toggle?) — Assumption A4

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — Stripe + jsr:@std/http/cookie + ThumbmarkJS all verified via primary sources or codebase
- Architecture: HIGH — Composes 3 already-shipped patterns (Phase 8 cookies, Phase 14 stripe-webhook, Phase 15 templates)
- Pitfalls: HIGH — IRS threshold + Vercel rewrite + cookie-domain + `transfers` vs `payouts` all surfaced and documented
- Fraud detection: MEDIUM — Postgres triggers + materialized views verified; ThumbmarkJS choice is recommendation (not user-confirmed)
- Account-deletion cascade: HIGH — Reuses Phase 7's `app.suppress_audit` pattern exactly
- Open questions: 4 surfaced for planner / discuss-phase amendment

**Research date:** 2026-05-15
**Valid until:** 2026-06-15 (Stripe API stable; ITP / W-9 thresholds stable; Supabase managed db patterns stable). Earlier expiry only if a new Stripe API version is announced.
