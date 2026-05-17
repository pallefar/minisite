# Pitfalls Research — v1.3 Platform Expansion

**Domain:** Adding multi-tier affiliate + mid-trial paywall A/B + page-builder A/B + hourly ad ETL + embed-provider blocks + Spanish i18n + pharmacology paywall + clinic organizations + custom rank weights/alerts + HIPAA BAA chain + onboarding overhaul + gamification + review prompts + AI recommender + helpdesk + cancellation save offers + public status page to LeanShot's shipped v1.2 architecture (Vite SPA + Supabase + Stripe + Anthropic + PostHog + Sentry + Resend + Vercel)
**Researched:** 2026-05-17
**Confidence:** HIGH on App Store / Play Store review-prompt policy + Anthropic BAA scope + Supabase RLS multi-tenant + Stripe customer-namespace + Meta/Google ad API rate limits (verified against current official docs 2026-05-17). MEDIUM on HIPAA BAA chain operational details + medical translation liability (verified against multiple secondary sources). LOW on Helpdesk Resend Inbound spam protection (vendor docs were not directly fetched — flag for phase research).

> **Audience:** This document feeds the v1.3 roadmap success-criteria and plan-checker mitigation verification. Every pitfall maps to an owning v1.3 workstream:
> - **M1** = Foundation (modular admin + event taxonomy + PostHog hardening)
> - **A** = Revenue / Growth (multi-tier affiliate, mid-trial paywall A/B, page-builder A/B, hourly ad ETL)
> - **B** = Product Depth web (embed blocks, pharmacology paywall, Spanish i18n)
> - **C** = B2B Clinic + HIPAA (organizations + Stripe orgs + BAA chain + custom rank weights/alerts)
> - **M2** = Onboarding overhaul (value-first preview + activation event + magic-link/Google/Apple)
> - **M3a** = Gamification (XP/streaks/freeze tokens/leaderboards)
> - **M3b** = Review prompt engine (two-stage NPS → store)
> - **M6** = Helpdesk (tickets + AI assist + KB + CSAT)
> - **M5b** = AI Personalization (pgvector recommender + weekly summary)
> - **M7** = Misc (cancellation save offers, status page)
>
> **Inheritance:** The v1.2 PITFALLS.md (33 pitfalls across mobile/HealthKit/ads/Stripe/affiliate/page-builder) still applies wherever those surfaces are touched. This document covers what v1.3 adds **on top of** v1.2. Cross-references to v1.2 pitfalls use the form "v1.2 Pitfall N".
>
> **Failure-mode legend:** 🔇 LANDMINE = silent failure (no error log, no user signal, surfaces weeks-to-quarters later as data corruption, leak, fine, or rejection). 🔊 LOUD = visible error, fast feedback. Plan-checker should treat LANDMINE pitfalls as plan-required mitigations; LOUD pitfalls as quality-of-life.

---

## Critical Pitfalls

### Pitfall V13-1: HIPAA BAA chain breaks silently when a vendor revokes ZDR or adds a subprocessor without notice 🔇 LANDMINE

**Trigger condition:**
Anthropic (or any LLM/AI vendor under BAA) makes one of these changes WITHOUT proactive customer notification: (a) cancels Zero Data Retention for our enterprise tier; (b) adds a new subprocessor that the BAA-signed clinic has not approved; (c) ships a "feature in beta" (e.g. Claude Office, Claude Design) that is NOT BAA-covered but routes data through the same API; (d) the BAA itself reaches renewal date and we miss the auto-renew. Per [Anthropic Privacy Center](https://privacy.claude.com/en/articles/8114513-business-associate-agreements-baa-for-commercial-customers): BAA explicitly does NOT cover Workbench/Console, Free/Pro/Max/Team plans, Cowork, OR features currently in beta. ZDR is an additional, separately-negotiated arrangement on top of the BAA.

**Why it happens:**
The BAA is a paper contract; the runtime is unaware of its scope. A LeanShot engineer enables Claude Code, Claude Workbench, or any beta feature for AI coach iteration → PHI flows through a non-BAA-covered surface. Or the AI-coach proxy auto-upgrades to a new model that has different ZDR semantics. Or Anthropic adds a new subprocessor (e.g. a new GPU vendor) that triggers a clinic's BAA subprocessor-notification clause → clinic is technically out of compliance, doesn't know, audit finds it 18 months later.

**Silent vs loud:** 🔇 LANDMINE — no runtime error, no Sentry event. Surfaces during the clinic's first HIPAA audit, OR via OCR breach-notification investigation if exfiltration ever happens.

**Suggested mitigation:**
1. **Runtime BAA-scope guard** — the AI-proxy Edge Function MUST refuse to forward requests from `org_id IS NOT NULL` (clinic users) unless the upstream call goes to a hard-coded allowlist of model IDs + endpoints that have written BAA coverage. Reject with 451 on any unrecognized model. Plan-checker must verify the allowlist exists.
2. **Monthly subprocessor diff cron** — scrape [trust.anthropic.com/updates](https://trust.anthropic.com/updates) + Supabase + Vercel + Sentry + Resend + Stripe subprocessor pages weekly into `vendor_subprocessor_snapshots`; diff against last snapshot; on change, fire Sentry alert + auto-email clinic admins via the disclosure obligation in the clinic BAA.
3. **BAA expiry calendar** — `vendor_baa_chain` table: vendor, scope, effective_date, renewal_date, contact_email, contract_pdf_url. Cron alerts owner 60d / 30d / 7d before renewal.
4. **PHI fence on PostHog/Sentry** — anything from a clinic-org user route must NOT carry PHI properties. Server-side strip on event ingest (PostHog `before_send`, Sentry `beforeSend`). Plan-checker fails if a new event in `events.ts` includes patient name/email/DOB/dose values for clinic context.
5. **Beta-feature ban** — eslint rule `no-restricted-imports` blocks `@anthropic-ai/sdk` imports that reference any beta endpoint string (`/v1/beta/`, `/v1/workbench/`, `messages-2025-` non-GA versions). CI fails the build.

**Owning phase:** **C (Clinic + HIPAA)** owns the BAA chain table + runtime guard + subprocessor diff cron. **M1 (Foundation)** owns the PHI fence on PostHog/Sentry (server-side strip) + canonical event taxonomy that classifies events as `phi: true|false`. **A (Revenue)** consumes (must not affiliate-promote BAA-restricted features to clinic orgs).

---

### Pitfall V13-2: Multi-tenant clinic org_id leakage via service_role bypass, missing JOIN policy, or realtime channel collision 🔇 LANDMINE

**Trigger condition:**
v1.2 RLS isolates patients by `auth.uid()`. v1.3 adds `organizations` + `org_members` + cross-org-shared patient data (a clinic-invited patient still has their own `auth.users.id` but is also a member of one or more `organizations`). At least four leak vectors emerge:
- **(a) service_role bypass:** an Edge Function uses `SUPABASE_SERVICE_ROLE_KEY` to satisfy a cross-org admin query, forgets to manually filter by `org_id`, returns Org A's roster to Org B's admin call. Per [Supabase docs](https://supabase.com/docs/guides/troubleshooting/why-is-my-service-role-key-client-getting-rls-errors-or-not-returning-data-7_1K9z): "When you create a Supabase client with the service_role key, all RLS policies are bypassed."
- **(b) JOIN-table policy gap:** `patient_observations` has RLS on `user_id = auth.uid()`, but a clinic-side view JOINs through `org_patient_link` and `patients` — if `org_patient_link` doesn't have its OWN RLS policy gating `org_id = ANY(auth.jwt() -> 'org_ids')`, the JOIN leaks. Per [Makerkit](https://makerkit.dev/blog/tutorials/supabase-rls-best-practices) — each table in a JOIN has its policy checked independently.
- **(c) Realtime channel collision:** clinic-side dashboard subscribes to `realtime:org:abc` for live patient updates. If channel name is computed client-side from `org_id` without server-side membership check, an attacker subscribes to `realtime:org:competitor` and gets pushes.
- **(d) Email collision:** patient with personal `tier='paid'` Stripe customer accepts clinic invite under same email → Stripe creates a NEW customer (Stripe does NOT enforce email uniqueness, per [Stripe docs](https://docs.stripe.com/billing/customer)) → both subscriptions active, both charged.

**Why it happens:**
The v1.1/v1.2 RLS pattern (per project rule from `reference_supabase_project.md`) covers user-owned data but multi-tenant org overlay is net-new. Cross-tenant tests at v1.2 prove `user_id != auth.uid()` isolation but no v1.2 test exercises `org_id != ANY(auth.jwt() -> 'org_ids')` because there are no orgs yet.

**Silent vs loud:** 🔇 LANDMINE on (a), (b), (c) — query returns data; nothing logs that it was the wrong tenant's data. 🔊 LOUD on (d) only if an end-user complains "I'm being charged twice."

**Suggested mitigation:**
1. **Per-org cross-tenant impersonation proof tests** — extend the project rule (every RLS surface gets a live cross-tenant test) to every NEW org-scoped surface: `organizations`, `org_members`, `org_subscriptions`, `org_patient_link`, `clinic_alerts`, `org_audit_logs`, `org_themes`, `org_rank_weights`. Tests use the `admin.generateLink` + plain `fetch /auth/v1/verify` pattern (project rule `reference_rls_fixture_gotrueclient_flake.md`). Plan-checker MUST require an `*-rls.test.ts` file per new org-scoped table + verify the impersonation pattern is used (not raw `signInWithPassword`).
2. **JWT custom claim `org_ids`** — Supabase Auth hook on signup/login populates `app_metadata.org_ids: string[]`. Per [project memory reference_supabase_app_metadata_jwt_propagation.md], 336ms propagation window after `updateUserById` — UI must handle the gap (loading state).
3. **service_role audit pragma** — every Edge Function that uses service_role MUST call a wrapper `withOrgScope(orgId, fn)` that injects `WHERE org_id = $1` into a final query-builder pre-flight; the wrapper logs every bypass. CI grep fails the PR if a new Edge Function imports `createClient(..., SERVICE_ROLE_KEY)` without `withOrgScope`.
4. **Realtime channel naming** — channel names MUST embed a per-org HMAC token (`org:abc:hmac-prefix-of-shared-secret`); server-side RLS on the `realtime.messages` view checks the HMAC. Don't accept raw `org_id` from the client.
5. **Stripe namespace** — store `stripe_customer_id` keyed by `(user_id, customer_context)` where context is `personal` or `org:xxx`. NEVER reuse `users.stripe_customer_id` across personal and clinic subs. On clinic invite to an existing paid user, prompt "Convert to clinic-paid (cancel personal)?" or "Keep both (you'll be charged twice)?" — explicit informed consent.

**Owning phase:** **C (Clinic + HIPAA)** owns the entire mitigation set. Plan-checker BLOCKERS: (i) every new org-scoped migration must ship a paired `*-rls.test.ts`; (ii) every new Edge Function importing SERVICE_ROLE_KEY must import `withOrgScope`; (iii) realtime channel HMAC migration must land before any clinic-side realtime subscription.

---

### Pitfall V13-3: App Store + Play Store rating-gating policy violation via two-stage NPS prompt 🔇 LANDMINE → 🔊 LOUD on review

**Trigger condition:**
M3b's "two-stage review prompt" design pattern: prompt user with internal NPS ("How likely are you to recommend LeanShot?"); if 9-10 (promoter) → trigger `SKStoreReviewController.requestReview()` / Google Play in-app review API; if ≤8 → route to internal "tell us what went wrong" form. This is **textbook review-gating** and is explicitly prohibited by Google Play and at high risk of App Store rejection.

**Per Google Play Developer Program Policy** (verified [Google Play User Ratings, Reviews, and Installs](https://support.google.com/googleplay/android-developer/answer/9898684)): "We don't allow developers to attempt to manipulate the placement of their apps in Google Play. We prohibit incentivized rating, reviews, or installs… Developers must not engage in any practice that affects the integrity of ratings, reviews, or installs." Review-gating (only showing the in-app review to satisfied users) is the named violation.

**Per Apple App Review Guidelines** §3.2.2(x) (verified [developer.apple.com/app-store/review/guidelines](https://developer.apple.com/app-store/review/guidelines/)): "Apps must not force users to rate the app, review the app, download other apps, or other store-related actions in order to access functionality, content, or use of the app." Apple's intro section: "If we find that you have attempted to manipulate reviews, inflate your chart rankings with paid, incentivized, filtered, or fake feedback… we will take steps to preserve the integrity of the App Store, which may include expelling you from the Apple Developer Program." Apple does not explicitly call out NPS-gating by name in the guideline text, but `filtered… feedback` and intentional steering of negative feedback away from the store has been the cited basis for expulsions and is the consistent industry interpretation.

**Apple's `SKStoreReviewController.requestReview()` API** (verified [Apple Developer SKStoreReviewController](https://developer.apple.com/documentation/storekit/skstorereviewcontroller)) constrains the system: max 3 prompts per user per app per 365 days, and "should not be called in response to a user action or button tap." This is an API constraint, NOT a policy that lets you bypass the policy by gating in your own code.

**Why it happens:**
The "two-stage NPS" pattern is famously evangelized as a growth hack. Engineers ship it on web first (where it's just a survey funnel) then port it to mobile and unwittingly cross the policy line.

**Silent vs loud:** 🔇 LANDMINE on Google Play — they may not catch it for months but when they do, app suspension is the typical action (not just one rejection). 🔊 LOUD on Apple — caught at App Review submission; rejection is fast but expulsion-from-program is the catastrophic tail.

**Suggested mitigation — safe pattern:**
1. **Internal NPS is FINE if it's purely an internal product survey and does NOT determine whether the native rating prompt fires.**
2. **Fire the native rating prompt unconditionally (subject only to the SKStoreReviewController/Play in-app review API's own throttling)** after a positive product moment (e.g., user logged 7 doses in a row, OR user completed onboarding, OR user used the AI coach 3 times). DO NOT condition the prompt on a survey response.
3. **Send the internal NPS survey ASYNC** via a different surface (in-app banner, email, post-cancellation flow). Both can exist; they MUST be independent.
4. **Web is exempt from the App/Play rating-gate rules** — on web, you can use Trustpilot's "review widget" with whatever segmentation you want (subject to Trustpilot's own policy: their TOS technically also prohibits review-gating for businesses claiming a profile, but enforcement is lighter and the consequences are removal of the profile, not store expulsion).
5. **Plan-checker check** — for any plan involving M3b, BLOCK if the plan contains BOTH `SKStoreReviewController` (or `play-core/review`) AND a code path that conditions the call on an NPS/CSAT/satisfaction value.

**Reference (web for Trustpilot context):** [Trustpilot business reviews policy](https://business.trustpilot.com/reviews/learn-how-trustpilot-works/our-anti-fake-reviews-pledge) — "selectively soliciting reviews from customers based on their satisfaction or transaction outcome" is prohibited.

**Owning phase:** **M3b (Review prompt engine)** owns. Plan-checker BLOCKER on conditional native-prompt code. **M6 (Helpdesk)** is the safe place to route low-NPS users (open a ticket with the NPS context) — this is an independent surface, not a gate.

---

### Pitfall V13-4: Page-builder A/B variants cause SEO penalty via inconsistent content + missing canonical 🔇 LANDMINE

**Trigger condition:**
v1.3 page-builder A/B (variant A vs variant B at 50/50 traffic split) is bolted onto the existing Phase 15 `page-render` Edge Function. Each visitor sees a randomly-selected variant. Googlebot crawls the page multiple times, sees different HTML body each visit. Without a `<link rel="canonical">` pointing to a single canonical variant URL (or without using Google's recommended A/B test patterns), Google interprets this as cloaking or thin/duplicate content → ranks the page lower or de-indexes it.

**Per Google's A/B testing SEO guidance** (long-standing): use rel=canonical pointing to the control version, use 302 (not 301) redirects for split testing, and don't run tests for longer than necessary (4-6 weeks max).

**Why it happens:**
PostHog feature-flag-based variant assignment happens at render time in the Edge Function. The naive implementation rotates `<h1>` and CTA copy per visit without changing the URL. Canonical is not added by default. The team A/B-tests indefinitely (PostHog doesn't enforce a cap).

**Silent vs loud:** 🔇 LANDMINE — SEO drop takes 4-12 weeks to manifest, never raises an error, only shows up in Google Search Console organic-traffic decline.

**Suggested mitigation:**
1. **Always emit `<link rel="canonical" href="https://leanshot.app/{slug}">`** in the rendered HTML, pointing to the slug without variant params. The canonical body content is whichever variant the admin marked as "control".
2. **Variant content body MUST keep the same semantic structure** (H1 text, primary CTA, primary value prop) and only vary "tone" / "headline phrasing" / "image" / "section ordering" — not the whole page meaning. The page-builder A/B UI should constrain variant edits to a per-block "variant override" field, not allow a wholesale variant clone.
3. **Variant traffic-split cap** — admin UI rejects variant configs that have been live >42 days; auto-prompts the admin to promote a winner or rollback.
4. **PostHog cohort retention on variant** — when admin "promotes variant B to 100%", the historical `$feature/page_ab` property MUST stay intact (don't delete the flag); otherwise cohort retention analyses (built later via M1 cohort-builder) collapse.
5. **`Cache-Control: no-store` on A/B routes during the test** — Vercel ISR will cache the first variant served and pin it forever otherwise. Per-variant cache key (PostHog distinct-id-hash → variant) means cache miss every visit.
6. **Render JSON-LD on the canonical body only** — variants don't get JSON-LD (only the control does), so Google's structured-data picks up one consistent product/article schema.

**Owning phase:** **A (Revenue) — page-builder A/B sub-feature** owns. Plan-checker check: any plan touching `page-render` Edge Function for variant support MUST include (a) canonical-link emit, (b) variant-cap admin UI, (c) PostHog flag persistence check.

---

### Pitfall V13-5: Hourly ad ETL silently drops data on API rate-limit or partial-day outage 🔇 LANDMINE

**Trigger condition:**
Hourly Vercel Cron → Meta Marketing API + Google Ads API + TikTok Ads API → Supabase pipeline. Per [Meta Marketing API rate limits](https://developers.facebook.com/docs/marketing-api/insights/best-practices/): Standard tier app gets `190000 + 400*active_ads - 0.001*user_errors` per ad-account per rolling hour; Dev tier gets `600` (LeanShot starts in Dev tier; Standard tier requires App Review). Google Ads API: 15,000 ops/day developer token in Test/Basic, higher with Standard access. TikTok Ads API: rate limits per app + per advertiser, varies by endpoint.

The naive ETL pipeline catches HTTP 429 / 400-with-rate-limit-code and either (a) crashes the cron (job retried next hour, hour gap left in `ad_revenue_hourly`), (b) swallows the error and continues (silent gap), or (c) backs off but doesn't re-sync the missed window. Compounding:
- **Attribution window mismatch:** Meta defaults 7-day click + 1-day view (you can request 7d view, 28d click via report config); Google Ads default 30-day click; TikTok 7-day click + 1-day view. Joining on `(date, source, campaign_id)` without normalizing attribution window = wrong CAC.
- **Currency conversion:** spend reported in advertiser-set currency. Conversion to USD requires daily-FX-rate join (Open Exchange Rates / ECB). If FX rate row is missing (weekend, holiday), spend either silently NULL'd or converted at last-known stale rate.
- **Privacy budget (iOS 14.5+ AEM):** Meta Aggregated Event Measurement caps post-iOS-14.5 events to top 8 conversion events per domain. If clinic + patient + affiliate + paywall events compete for the slot, lower-priority events are dropped silently from reporting.
- **Creative-level data joins:** Google Ads `creative_id` differs from `ad_id`; Meta `ad_id` ≠ `creative_id` ≠ `adset_id`. Joining creatives to performance requires per-network FK mapping or analyses break.

**Why it happens:**
ETL engineers default to "happy path" and assume APIs are reliable. Rate limit headers are advisory and easy to miss (`x-fb-ads-insights-throttle` is a JSON header that requires explicit parsing).

**Silent vs loud:** 🔇 LANDMINE on all four sub-failures. CAC dashboards just look "wrong-but-close" and the team makes spend decisions on broken data.

**Suggested mitigation:**
1. **Idempotent partial-day re-sync** — `ad_revenue_raw` keyed by `(network, ad_account_id, ad_id, date, hour)` with `UPSERT ON CONFLICT`. Cron always pulls the LAST 72h (not just last hour). Late-arriving data (Meta backfills 24-48h) overwrites correctly.
2. **Rate-limit-aware backoff with quota-aware throttle** — parse `x-fb-ads-insights-throttle.app_id_util_pct` BEFORE each call; if >80%, sleep until next hour boundary. Google Ads: respect `quota-error` retry-after header. TikTok: implement exponential backoff with jitter. Log every throttle event to `etl_throttle_log`.
3. **Gap-detection cron (separate from ETL cron)** — daily 04:00 UTC checks `ad_revenue_hourly` for any (network, ad_account, hour) gap >2h in last 7d; alerts owner via Sentry + queues a forced re-sync. Plan-checker requires the gap-detection cron alongside the ETL cron.
4. **Attribution window normalization** — `ad_revenue_normalized` view exposes ONLY `attribution_window_days` = 7 (the common ground); the raw table stores per-network native window. CAC analyses MUST join on the normalized view (eslint rule blocks `SELECT FROM ad_revenue_raw` outside the ETL function).
5. **Currency-conversion fallback chain** — `fx_rates` table populated via daily Open Exchange Rates cron; on missing date, fall back to last-known-rate with a `stale_rate=true` flag carried through to the normalized view. UI shows a banner when `stale_rate=true` rows are in the window.
6. **AEM priority register** — declare top-8 conversion events in Meta Events Manager + document in `events.ts` taxonomy with `aem_priority: 1-8`. v1.3 M1 canonical event taxonomy is the source of truth; new events at priority 9+ get a `aem_dropped: true` flag and CAC analyses skip them.
7. **Creative-FK mapping table** — `ad_creative_xref` (`network`, `network_ad_id`, `network_creative_id`, `network_campaign_id`, `internal_campaign_id`) — every ETL run upserts. Joining creative → performance goes through this view.

**Owning phase:** **A (Revenue) — hourly ad ETL sub-feature** owns. Plan-checker checks: (i) ETL function exists alongside gap-detection cron; (ii) `ad_revenue_normalized` view exists with single attribution window; (iii) `fx_rates` cron exists; (iv) AEM priority register populated in `events.ts`.

---

### Pitfall V13-6: Multi-tier affiliate state-machine drift on tier upgrade resets payout/chargeback hold 🔇 LANDMINE

**Trigger condition:**
v1.3 multi-tier affiliate adds `tier IN ('standard', 'gold', 'lifetime')` with different commission rates. Affiliate is upgraded mid-month from `standard` (30%) to `gold` (40%). The state-machine has at least these transitions:
- Conversion attribution at time T → which tier's rate applies?
- 60-day chargeback hold from time T → does the hold reset on tier change?
- Promotional coupon (one-time signup $20-off) on top of tier-based commission → who eats the discount?

Per project memory [feedback_status_machine_transition_owner.md] (from Phase 19 BL-11): every status transition needs an owning plan+task or the feature ships dead. v1.3 multi-tier introduces 3 new transitions (`standard→gold`, `gold→lifetime`, `*→suspended`) that all touch `affiliate_conversions.tier_at_conversion_time` + `payouts.eligible_at` + `chargeback_hold_until`. If any transition forgets to STAMP the historical tier on existing pending conversions, retroactive recompute happens and payouts are wrong.

**Concretely:**
- Affiliate has 50 pending conversions at standard tier (30%) with $500 commission accrued; gets upgraded to gold; if the upgrade re-stamps `commission_cents` from current tier, those 50 conversions retroactively pay 40% = $667 (over-pay by $167).
- Conversely, if the upgrade does NOT re-stamp and ALSO does not stamp `tier_at_conversion_time`, downstream analytics joining `conversions × affiliate_tiers` shows everything as gold and inflates "gold-tier conversion rate" metrics.
- Promotional coupon `SIGNUP20` discounts MRR by $20; affiliate commission is computed off post-coupon MRR or pre-coupon MRR? Both are defensible; pick one and document. The wrong choice puts affiliate-vs-promo math at war.

**Why it happens:**
Phase 19 shipped single-tier; tier was implicit. v1.3 makes it explicit and the historical denormalization (stamp at conversion time) is easy to forget.

**Silent vs loud:** 🔇 LANDMINE — affiliates dispute payouts months later; reconciliation is manual + painful.

**Suggested mitigation:**
1. **Stamp `tier_at_conversion_time` on `affiliate_conversions` insert** + `commission_cents` is calculated at insert time from the stamped tier — NEVER recomputed. Per project rule from Phase 19, do NOT let downstream views recompute commission.
2. **Tier-change does NOT reset chargeback hold** — `chargeback_hold_until` is stamped per-conversion at insert and never updated. (Rationale: tier is the affiliate's status; chargeback risk is the END USER's status.)
3. **Coupon-stack policy locked in CONTEXT** — pick one of (a) commission on pre-coupon MRR (affiliate gets full rate, platform eats the discount), (b) commission on post-coupon MRR (affiliate shares the discount cost). Recommendation: (b) for non-affiliate-issued coupons, (a) for affiliate-promoted coupons (already in their landing page). Document in `affiliate_conversions.commission_basis` enum.
4. **Tier transition audit log** — `affiliate_tier_history` (`affiliate_id`, `from_tier`, `to_tier`, `changed_at`, `changed_by`, `reason`); join enables "what tier was affiliate X at on date Y" without losing data.
5. **Self-referral check upgraded to per-tier** — fraud signal Z-score baseline (per Phase 19) is per-tier; gold-tier affiliates have higher legitimate conversion rates than standard, so cross-tier baselines false-positive.
6. **Plan-checker state-graph audit** (per project rule) — every plan in workstream A multi-tier-affiliate must enumerate which tier transitions it writes to + which it reads from. Plan-checker compares writer-set vs reader-set; gap = BLOCKER (this is what caught BL-11 in P19).

**Owning phase:** **A (Revenue) — multi-tier affiliate sub-feature** owns. Plan-checker MUST run a state-graph audit (`gsd-tools state-graph affiliate_tier`) before any v1.3-A plan exits planning.

---

### Pitfall V13-7: Mid-trial paywall A/B variant spikes refund rate via flow disruption + PostHog flag stickiness 🔇 LANDMINE

**Trigger condition:**
Mid-trial paywall A/B = show paywall to a fraction of trial users mid-trial (after activation event) instead of end-of-trial. Variants: control (paywall at trial end), variant B (paywall at day 3, before card-fail-friction wakes user). The hypothesis is paying users convert earlier so trial-to-paid lifts. The risk:
- **Refund rate spike:** users in variant B are paying off momentary product enthusiasm, not real evaluation. On day 8 when they realize they didn't actually want it, refund. Net revenue change is paywall lift × (1 − refund_rate), and refund_rate can swing wildly.
- **PostHog flag stickiness across sessions/devices:** flag assignment via anonymous `distinctId` BEFORE signup; user signs up, gets a new authenticated `distinctId`; if `identify()` merges incorrectly OR runs out of order with `capture()` (per [PostHog issue #21591](https://github.com/PostHog/posthog/issues/21591)), the user MAY get re-assigned to the other variant mid-experiment. Result: same user sees control on web, variant B on mobile. Conversion attribution is borked.
- **Analytics-blocker false-negative on activation events:** ~25% of users run ad-blockers that block PostHog. Activation event "user logged 3 doses" doesn't fire → variant-B trigger doesn't fire → user stays in trial-end paywall (control) silently. The experiment is contaminated by an unrepresentative-of-paying-users sub-sample.

**Why it happens:**
PostHog `identify()` race condition is well-documented (project memory's existing issue). Refund rate is a lagging metric (Stripe 90-day chargeback window) so the experiment looks like a win for weeks before it inverts.

**Silent vs loud:** 🔇 LANDMINE on all three. The analytics-blocker case is the worst — silently corrupts the experiment AND we never know which users were affected.

**Suggested mitigation:**
1. **Refund-rate guardrail** — A/B success metric is NOT trial-to-paid; it is `(trial_to_paid × (1 − refund_rate_at_30d) × (1 − refund_rate_at_60d) × (1 − refund_rate_at_90d))`. Experiment is paused if any variant's 30d-refund-rate exceeds control + 5pp absolute.
2. **Sticky flag via PostHog `bootstrap`** — at first anonymous pageview, generate a UUID, write to first-party cookie `_lps_aid`, pass to PostHog `bootstrap.distinctID` AND `bootstrap.featureFlags`. On signup, call `posthog.identify(userId, { _lps_aid: cookieValue })` AND `posthog.alias(cookieValue, userId)` AND server-side store the flag value in `user_experiments(user_id, experiment_key, variant)` table. From that point, ALL flag reads come from the server-side table (PostHog is now just analytics). Plan-checker rule: any new experiment touching trial/paywall MUST go through `user_experiments` table, NOT raw PostHog flag reads.
3. **Server-side activation event** — activation = "logged 3 doses" is server-detected (trigger on `injections` insert) and fires `posthog.capture()` SERVER-SIDE via PostHog's Python/Node lib in the Edge Function. Ad-blockers don't block server-side captures. M1 PostHog hardening workstream owns this pattern for ALL load-bearing events (signup, activation, payment).
4. **Variant assignment AT signup, not at first anonymous view** — anonymous view captures the cookie; experiment assignment happens on first authenticated request (so ad-blocker false-negatives are bounded to UNAUTHENTICATED metric noise, not experiment assignment).
5. **Mandatory 14-day burn-in before reading the experiment** — Stripe trial is 7d, refund window 90d. Don't declare a winner before T+30d on a refund-sensitive experiment.

**Owning phase:** **A (Revenue) — mid-trial paywall A/B sub-feature** + **M1 (Foundation) — PostHog hardening** co-own. Plan-checker BLOCKER on raw PostHog flag reads for paywall variants.

---

### Pitfall V13-8: Embed-provider blocks (Calendly / YouTube / Tally) bypass sandbox or break OAuth-inside-iframe 🔇 LANDMINE + 🔊 LOUD

**Trigger condition:**
Phase 15 page-builder shipped embed-blocks at v1.2 (per CONTEXT D-question 3 + ROADMAP open question). v1.3 may extend with more providers. Three classes of failure:
- **(a) Sandbox bypass** 🔇 — `<iframe sandbox="">` (empty) is the strict default; adding `allow-scripts allow-same-origin` together is a documented [browser security anti-pattern](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/iframe#sandbox) — it allows the embedded content to remove its sandbox attribute. Calendly's docs request `allow-scripts allow-same-origin allow-forms allow-popups` for full functionality; if the page-builder admin pastes a Calendly URL with the embed's recommended sandbox, an attacker-controlled provider page in the future could remove the sandbox.
- **(b) Consent-gating race** 🔇 — embed blocks must respect cookie consent (the v1.2 vanilla-cookieconsent + Consent Mode v2 stack); naive mount renders the iframe at page-render time, BEFORE consent module loads, and Calendly/YouTube cookies fire pre-consent. Same GDPR risk as v1.2 Pitfall 4.
- **(c) OAuth-flow embeds inside iframe sandbox** 🔊 — Calendly embed includes "Log in to schedule" flow that opens an OAuth popup. In iframe sandbox `allow-popups allow-popups-to-escape-sandbox`, popup escapes but the third-party identity provider (Google OAuth) rejects iframe-originated auth via `X-Frame-Options: DENY`; user sees blank popup or "this content cannot be embedded".

**Why it happens:**
Embed UX docs are written assuming a publisher's own marketing site (where sandbox is wide-open). Embed-block-as-page-builder-primitive is a different threat model.

**Silent vs loud:** 🔇 LANDMINE on (a) and (b); 🔊 LOUD on (c) — user reports "can't log in to book a meeting".

**Suggested mitigation:**
1. **Per-provider whitelist with locked sandbox attributes** — `embed_providers` registry: `calendly` ⇒ sandbox `allow-scripts allow-forms allow-popups`, URL must match `https://calendly.com/`; `youtube` ⇒ sandbox `allow-scripts allow-same-origin allow-presentation`, URL must match `https://(www\.)?youtube(-nocookie)?\.com/embed/`; `tally` ⇒ sandbox `allow-scripts allow-forms`, URL match `https://tally.so/embed/`. Page-builder admin UI does NOT allow arbitrary iframe URLs.
2. **`allow-scripts` + `allow-same-origin` combination explicitly FORBIDDEN** — registry validator rejects any provider config combining both.
3. **Lazy mount on consent + interaction** — embed renders a click-to-load placeholder by default (e.g., poster image + provider name); user clicks → IF marketing consent granted, mount iframe; ELSE show consent prompt. This single change avoids both consent-gating race AND CLS + bandwidth + bundle issues.
4. **OAuth-flow embeds explicitly excluded from sandbox** — providers like Calendly's "logged-in scheduling" REQUIRE leaving iframe; document in admin UI that this is a Calendly limitation and offer "Open in new tab" as the only safe UX.
5. **CSP `frame-src` enumeration** — CSP header allows only the whitelisted providers' domains; new provider in registry triggers a CSP-snapshot test (project pattern from v1.2 Phase 12 SC-4) and CI fails if CSP isn't updated.

**Owning phase:** **B (Product Depth) — embed-provider blocks** owns. Plan-checker BLOCKER: any new provider in `embed_providers` registry MUST ship with paired CSP-snapshot test update.

---

### Pitfall V13-9: Spanish i18n medical-term translation accuracy creates clinical liability 🔇 LANDMINE

**Trigger condition:**
v1.3 ships Spanish localization across UI + transactional emails + KB. Three categories of risk:
- **(a) Pluralization correctness** — Spanish has TWO plural categories (one, other) per CLDR — simpler than English, but `react-i18next` with default JSON pluralization is naive (`weight_one`, `weight_other`); without [`i18next-icu`](https://www.i18next.com/translation-function/plurals), nested plurals like "Logged {{count}} doses across {{days}} days" don't compose properly. Result: grammatically broken phrases that look unprofessional in a HEALTH product.
- **(b) Medical-term translation** — "dose" → `dosis` (correct), but "titration" → `titulación` is the chemistry sense; the clinical sense is `escalonamiento` or `titulación de dosis` (regional drift: MX vs ES vs AR). "Side effects" → `efectos secundarios` (correct) vs `efectos adversos` (different clinical meaning). "Injection site rotation" → `rotación de sitios de inyección` (literal) vs `rotación de zonas de aplicación` (more natural for ES patient comms). MISTRANSLATION OF DOSE/UNITS/FREQUENCY in a health product = liability exposure if a patient takes the wrong action.
- **(c) RTL preparation** — Spanish isn't RTL, but Phase 15 design tokens use physical CSS properties (`padding-left`, `margin-right`); shipping Spanish without converting to LOGICAL properties (`padding-inline-start`, `margin-inline-end`) means a future Arabic/Hebrew localization requires re-touching every component. Cost rises 10× compared to doing it now.

**Why it happens:**
SaaS translation is typically done via DeepL or GPT machine translation + crowdsourced review; clinical terms are NOT covered by general translation memory. Engineers default to physical CSS because Tailwind v3 documentation defaults to physical (Tailwind v4 [supports logical properties](https://tailwindcss.com/docs/padding) but doesn't enforce them).

**Silent vs loud:** 🔇 LANDMINE on all three. (b) is the catastrophic case — a translated dose-unit confusion (`mg` vs `mcg`, `ml` vs `unit`) could harm a patient. (c) is silently expensive (tech debt that compounds).

**Suggested mitigation:**
1. **Clinical terminology glossary FIRST** — before any translation work, build `medical_glossary_es.json` covering 80-100 GLP-1-domain terms reviewed by a Spanish-speaking medical professional (sourced via Upwork or via clinic-partner if one is bilingual). Translation memory locks these terms. Plan-checker check: any v1.3-B i18n plan MUST cite glossary review-by date + reviewer.
2. **ICU plurals via `i18next-icu`** — install at i18n setup; use `{count, plural, one {1 dosis} other {# dosis}}` syntax across the board, not native `_one`/`_other` JSON keys. Enables future locales (Polish has 4 plural categories, Arabic has 6) without re-touching strings.
3. **DO NOT machine-translate dose-related strings** — flag every string containing `{{count}}`, `{{dose}}`, `{{unit}}`, `{{frequency}}`, OR a regex for medication names (semaglutide / tirzepatide / etc.) as "manual translation only". Translation pipeline (Lokalise/Tolgee/Crowdin) tags these as `requires_clinical_review`.
4. **Convert physical → logical CSS NOW** — Tailwind v4: `pl-4 mr-2` → `ps-4 me-2`; codemod across `src/components/` in a single PR before Spanish translation work starts. Then Arabic future-launch is a strings-only project, not a layout re-do.
5. **Side-by-side QA before launch** — every page renders in both EN and ES side-by-side; reviewer checks every dose-relevant string. Plan-checker requires `qa-i18n-es-medical.spec.ts` Playwright suite with screenshot regression.
6. **Disclaimer in ES** — medical disclaimer ("Not medical advice…") MUST be reviewed by the same clinical reviewer; auto-translated disclaimers are NOT legally equivalent.

**Owning phase:** **B (Product Depth) — Spanish i18n** owns. Plan-checker BLOCKERS: (i) clinical glossary file exists + reviewer attribution; (ii) `i18next-icu` installed not native plurals; (iii) physical-to-logical CSS codemod landed before strings work; (iv) `qa-i18n-es-medical.spec.ts` suite exists.

---

### Pitfall V13-10: Pharmacology paywall test triggers reputational backlash or regulator inquiry 🔇 LANDMINE → 🔊 LOUD

**Trigger condition:**
v1.3 B-pharmacology paywall = gating "advanced dosing context" (interactions, dosing optimization, contraindications) behind Pro. The Core Value of LeanShot is the drug-level curve and rotation tracking — paywalling adjacent SAFETY information triggers two distinct risks:
- **(a) Reputational** 🔇→🔊 — an HN/Reddit post titled "LeanShot is paywalling safety information for people on GLP-1s" goes viral. Trust evaporates in 48h. (HN front-page → 50k+ uniques to landing page, refund spike, churn spike.)
- **(b) Regulatory** 🔇 — Washington state's [My Health My Data Act (WMHMDA)](https://app.leg.wa.gov/RCW/default.aspx?cite=19.373.030) RCW 19.373.030 + Connecticut Data Privacy Act (CTDPA) impose specific disclosure + consent rules for consumer health data. Gating "contraindications" or "interactions" behind a paywall could be interpreted by a state AG as either (i) deceptive consumer-protection violation OR (ii) failure to provide adequate disclosure to obtain valid consent for health-data processing. Per project memory [reference_phase7_research_findings.md]: WMHMDA mandates 5 CHDP sections; missing one is a per-violation action.

**Why it happens:**
Engineers think paywall = "monetization tweak"; legal/medical risk is invisible at planning time. The decision to test the paywall is a one-line PostHog flag flip; the consequences are NOT.

**Silent vs loud:** 🔇 LANDMINE on (b) — state AG investigations take 12-18 months between trigger and inquiry. 🔊 LOUD on (a) — Reddit/HN hits within hours of release.

**Suggested mitigation:**
1. **Decide what's "safety information" vs "advanced features" UP FRONT in CONTEXT.md** — paywall-acceptable: longer-window projection (90d vs 7d), AI optimization suggestions, alternative-protocol comparisons, "best titration plan for your goal" prescriptive content. PAYWALL-FORBIDDEN: drug-interaction warnings, contraindications, allergic-reaction signs, dose-conversion errors, OR ANY content that exists to PREVENT HARM. The line is "if absence of this content could lead to user harm, NEVER paywall it."
2. **Reversibility plan in CONTEXT** — if backlash hits, flip PostHog flag to 0% within 30min + tweet apology + post-mortem. The plan is written before launch, not improvised.
3. **State AG disclosure scrub** — every paywall variant copy reviewed against WMHMDA "consumer health data" definition. If the gated content is "data we collected from you, processed, and now charge to give back" the consent disclosure on the cookie/onboarding consent must cite it.
4. **A/B audience exclusion** — paywall A/B excludes any user with a logged adverse-event-like symptom in the last 30d (use existing `symptoms` table); these users see the unpaywalled version. Rationale: never paywall safety info for someone currently experiencing a possible adverse event.
5. **Public statement scripted in advance** — if Reddit/HN post hits, comms response is ready (acknowledges concern, links to the unpaywalled safety surface, offers free Pro for affected users for 90d). Don't draft this in the middle of the crisis.

**Owning phase:** **B (Product Depth) — pharmacology paywall test** owns. Plan-checker BLOCKER: any plan touching paywall-gating for pharmacology content MUST link to a CONTEXT.md decision recording the paywall-acceptable vs paywall-forbidden line + reversibility plan + state AG disclosure scrub.

---

### Pitfall V13-11: HIPAA session-timeout requirement conflicts with consumer UX 🔊 LOUD on review

**Trigger condition:**
HIPAA Security Rule (45 CFR 164.312(a)(2)(iii)) recommends "automatic logoff" after a period of inactivity — industry-standard ~15min for clinical sessions. LeanShot's consumer UX assumes session persists until explicit logout (so users can leave the app open + log doses throughout the day). With clinic orgs, a clinic-side operator IS in a HIPAA-clinical session; the consumer-side patient is NOT (unless they're a patient of a BAA-signed clinic, then arguably yes).

**Why it happens:**
HIPAA Security Rule is "addressable" (not "required") for some controls including auto-logoff, meaning we need a documented justification if we don't implement it. But a clinic auditor will reasonably expect a 15-min timeout on clinical-context sessions.

**Silent vs loud:** 🔊 LOUD during HIPAA audit, security questionnaire, or clinic-prospect technical review.

**Suggested mitigation:**
1. **Context-aware session policy** — patients in pure-consumer mode keep current ∞-session UX. Clinic operators (`org_member.role IN ('admin', 'operator', 'viewer')`) get 15-min idle timeout. Patients of BAA-signed clinics get an opt-in "clinical mode" badge in settings that, if enabled, applies the 15-min timeout. Document in CONTEXT.md.
2. **Idle-detection client-side** — Supabase session refresh is automatic, but our app must implement a real idle-timer (e.g., reset on mouse/keyboard/touch events) that calls `supabase.auth.signOut()` at 15min idle for clinical sessions.
3. **Re-auth challenge for sensitive actions** — for clinical sessions, refunds/grants/impersonation/data-export require password OR biometric re-confirmation regardless of session age.
4. **MFA enforcement for clinic admins** — `org_member.role = 'admin'` MUST have MFA enrolled; admin-modular-shell middleware blocks access if `factors_enrolled === 0`. v1.3 M1 admin 2FA enforcement absorbs this.
5. **Audit log retention** — clinic-side `org_audit_logs` retained 6 years (HIPAA standard) vs consumer audit_logs at 1 year. Two separate tables OR a single table with `retention_class` column.

**Owning phase:** **C (Clinic + HIPAA)** owns. M1 owns admin 2FA enforcement consumed by HIPAA admin role.

---

### Pitfall V13-12: Custom rank weights change historical rankings (clinic alert delivery + HIPAA PHI in email) 🔇 LANDMINE

**Trigger condition:**
Per-clinic custom rank weights = each clinic configures how patients are ranked in their dashboard (e.g., Clinic A weighs "missed doses" 3×, Clinic B weighs "weight loss velocity" 2×). Two failures:
- **(a) Retroactive ranking** 🔇 — if clinic changes weights on day 90, the historical ranking displayed for days 0-89 in the audit/timeline view also changes (rankings are computed live from current weights). Operators making historical clinical decisions based on a snapshot they reviewed in week 4 may not realize the snapshot is now showing different rank-positions. Compliance issue (audit trail integrity) + clinical operations issue (decision rationale broken).
- **(b) Alert delivery via email** 🔇 — "Patient John Smith missed 3 doses, his dose-trend shows declining adherence" sent via Resend to clinic operator email IS PHI per HIPAA (contains patient identifier + treatment info). If Resend doesn't have a BAA covering it (or BAA was revoked, see V13-1), the email is an impermissible disclosure. Plus alert fatigue: thresholds too sensitive → operator ignores → real alert missed (notification debounce vs delivery guarantee tension).

**Why it happens:**
Rank weights stored as `clinic_rank_weights` JSONB updated in-place by admin UI. Alert delivery uses the same Resend pipeline as consumer transactional email (no PHI separation).

**Silent vs loud:** 🔇 LANDMINE on both.

**Suggested mitigation:**
1. **Versioned weights** — `clinic_rank_weights_versions` append-only (`org_id`, `version`, `weights_jsonb`, `effective_at`, `created_by`); current version pointer in `organizations.current_rank_weights_version`. Ranking queries either (a) JOIN to versions table using snapshot-time match, or (b) materialize daily ranking snapshots and serve historical from snapshots. Recommend (b) for performance; (a) for storage-cheap exact-reproducibility.
2. **Snapshot rankings on every operator drill-in** — `ranking_snapshots` (`org_id`, `patient_id`, `rank`, `weights_version_id`, `viewed_at`, `viewed_by`); auditable.
3. **PHI-safe alert email design** — alert email contains NO patient identifier, NO dose values, NO clinical detail. Just: "You have 3 new patient alerts. [Sign in to view]". The PHI lives in-app behind auth. Resend then carries no PHI; BAA gap is closed.
4. **Alert debouncing with delivery guarantee** — `clinic_alerts` table with `state ENUM('pending', 'sent', 'acknowledged', 'snoozed', 'dismissed')`; cron sweeps `pending` older than 5min into batched-email; operator acknowledgment writes `acknowledged_at` for audit. Don't lose alerts during alert-fatigue throttling — escalate to weekly digest if individual alerts > 20/wk.
5. **Per-clinic threshold tuning** — admin sliders for sensitivity; alert volume preview ("at this threshold, your roster would have 12 alerts/week").
6. **`clinic_alerts.acknowledged_at` audit** — operator must acknowledge or dismiss with reason; "all alerts dismissed at once" pattern flagged for compliance review.

**Owning phase:** **C (Clinic + HIPAA) — custom rank weights + alerts** owns. Plan-checker BLOCKER: weights migration must be versioned-table not in-place column; alert email design must not include PHI fields.

---

### Pitfall V13-13: Gamification streak loss-aversion crosses into UX-brief dark-pattern + timezone bugs 🔇 LANDMINE + 🔊 LOUD

**Trigger condition:**
Gamification (XP/levels/streaks/freeze tokens/leaderboards) is famously prone to "dark pattern" framing per the project's own UX brief warnings. Three failures:
- **(a) Loss-aversion dark pattern** 🔇 — "You'll lose your 28-day streak in 3 hours!" push notification at 9pm = textbook compulsion-loop dark pattern. EU regulators (Norway Consumer Authority, French CNIL) have publicly named loss-aversion-based engagement nudges as dark patterns; not banned outright but ammunition for an unfair-commercial-practices claim.
- **(b) Timezone bugs in streak calc** 🔊→🔇 — user logs dose in NYC at 11pm Mar 14, flies to LAX, logs at 9pm Mar 14 LAX (which is Mar 15 NYC). Did the streak continue? Server stores ISO timestamps; client UI shows local. Naive `date_trunc('day', logged_at)` server-side = streak breaks on transcontinental travel even though user logged once per calendar day in their local TZ. Worse, user sees streak intact on phone (client local TZ) but lost on web (server UTC) = confidence in product breaks.
- **(c) Freeze-token economy abuse** 🔇 — admin grants freeze tokens for customer support ("I was sick, please don't break my streak"); users figure out the magic words and game the system. Or refunded users keep their tokens. Or freeze tokens have value > $0 (Pro features) and grant flow is unlogged.

**Silent vs loud:** 🔇 LANDMINE on (a) and (c); 🔊 LOUD on (b) initially (user reports) but 🔇 if quietly under-counting streaks long-term.

**Suggested mitigation:**
1. **UX brief sign-off** — every gamification surface explicitly reviewed against the UX brief's dark-pattern list. Don't ship "streak about to break" loss-framing pushes. Instead: "Log today's dose to keep building your streak" (gain-framing).
2. **Streak calc uses user's stored timezone** — `users.timezone` (TZ identifier like `America/Los_Angeles`); streak calc does `date_trunc('day', logged_at AT TIME ZONE users.timezone)`. User changes timezone in settings → recompute streak on next read (don't auto-recompute via cron, that's expensive).
3. **Timezone change grace period** — user changes timezone setting → 48h grace where ANY day-bucket (old TZ or new TZ) satisfies streak. Prevents border-case streak-loss.
4. **Audit log for ALL freeze-token grants** — `freeze_token_grants` (`user_id`, `granted_by`, `reason`, `support_ticket_id`, `granted_at`); admin UI requires reason + ticket link; weekly anomaly review (user X received 5 grants in a quarter = flag).
5. **Freeze tokens expire 90d** + reset on refund (refund event hooks into freeze-token-zeroing trigger).
6. **Leaderboard PII protection** — display names are user-chosen (not real names); rank-position visible but exact-value (XP) bucketed; user can opt out of public leaderboard at any time; anonymized handles still re-identifiable via timing-content correlation → only show top-100 + "you" position, not full leaderboard.

**Owning phase:** **M3a (Gamification)** owns. Plan-checker BLOCKER: streak calc plan must reference `users.timezone`; freeze-token-grant plan must include audit log + reason field.

---

### Pitfall V13-14: Onboarding value-first preview leaks PII before consent + merge-on-signup race 🔇 LANDMINE

**Trigger condition:**
M2 onboarding overhaul = "value-first preview" — user sees product working with their data BEFORE creating account. Concretely: user inputs weight + medication + dose → sees personalized 28-day curve → THEN onboarding asks for signup. Two failures:
- **(a) PII leak pre-consent** 🔇 — input flow writes to a server-side anonymous session (so the curve can compute server-side). That session contains PII (weight, medication, dose) attached to an anonymous-ID cookie. Cookie consent for the marketing site defaults to "no" in EU; if we wrote the session BEFORE consent, GDPR violation. Per [WMHMDA RCW 19.373.030 + similar state laws] applies even to anonymous "consumer health data".
- **(b) Merge-on-signup race** 🔇 — user opens preview on phone, types weight; opens preview on laptop, types different weight; signs up on laptop. Which anonymous session merges into the new user? Naive last-write-wins clobbers the phone session silently. Worse: user A and user B share a public computer; user A's preview session merges into user B's account on signup. Cross-user data leak.
- **(c) A/B variant fingerprint deanonymization** 🔇 — onboarding variant assigned at first anonymous pageview; PostHog flag fingerprint (variant + signup time + page-load order) uniquely identifies the signup user post-hoc. Adversary correlating flag-assignment logs + signup events can deanonymize "this signed-up user is from this preview-flow IP".

**Silent vs loud:** 🔇 LANDMINE on all three.

**Suggested mitigation:**
1. **Client-side-only preview** — preview computation runs in browser (pharmacology engine is already pure-function client-side). NO server-side anonymous session writes for preview values. The cookie that persists across page loads is `_lps_preview_state` containing the typed values; user-controlled, easy to clear. NO PII server-side until signup.
2. **Explicit consent before persist** — IF the team insists on server-side preview (for cross-device), preview UI shows "Save my preview" toggle that DEFAULT-OFF; toggle = explicit consent + creates a temporary session with 7d TTL + opt-in cookie. Anonymous session writes ONLY happen post-toggle-on.
3. **Single-active-anonymous-session per browser** — anonymous session cookie is browser-scoped (not user-scoped). Sign-up merges THE SAME-COOKIE preview into the new account, ignores other-cookie sessions (which never get merged). No cross-device-preview merge. Document UX limitation: "your preview values from your other device are saved separately; you can re-enter them or copy from your phone."
4. **Public-computer warning** — if `_lps_preview_state` cookie exists when sign-up form opens, show "Are these your values? (weight: X, dose: Y) — Reset if not yours". Explicit user confirmation before merge.
5. **PostHog flag fingerprint deidentification** — onboarding variant assignment happens server-side at signup (NOT at preview page-load); PostHog `featureFlags` for the preview surface are page-static (same variant for all preview viewers); analytics consents to a coarse-grained variant exposure.

**Owning phase:** **M2 (Onboarding overhaul)** owns. Plan-checker BLOCKER: preview implementation plan must declare client-side-only OR explicit-consent-toggled-server-side; cross-device merge behavior documented.

---

### Pitfall V13-15: AI recommender pgvector index drift on embedding-model upgrade 🔇 LANDMINE

**Trigger condition:**
M5b recommender via pgvector stores embeddings of content + user-history; recommends content with cosine similarity. Anthropic releases Claude-X next month with a new embedding model (or we switch from OpenAI text-embedding-3-small to a newer model). New embeddings have DIFFERENT dimensionality OR different vector-space orientation. Stored old embeddings + new query embedding = nonsense similarity scores. Result: recommendations silently become random.

**Why it happens:**
Embedding models evolve faster than database migrations. Engineers think "it's the same string, same model family, should work" but vector spaces don't align across model versions.

**Silent vs loud:** 🔇 LANDMINE — recommendations don't error, they just stop being good. CTR drops slowly; team chases the wrong variables for weeks.

**Suggested mitigation:**
1. **Embedding versioning** — `embeddings` table has `model_id TEXT NOT NULL` + `model_version TEXT NOT NULL` + `embedding vector(N) NOT NULL`. Query at read-time MUST filter `WHERE model_id = $current AND model_version = $current`. Two parallel embeddings during migration window.
2. **Two-phase migration** — (i) compute new embeddings for ALL content + new user history into parallel rows; (ii) cut read-path to new model atomically; (iii) drop old embeddings on T+7d (rollback window).
3. **Drift detection cron** — daily, compute pairwise cosine on a fixed sample set; alert if mean similarity drifts > 0.1 day-over-day (indicates model behavior change OR upstream API change).
4. **Recommendation explainability for clinical context** — for clinic users, every recommendation MUST include "because patient logged X" + "from KB article Y" provenance. Black-box "AI says read this" is unacceptable in clinical context.
5. **Echo-chamber prevention** — engagement-only ranking traps users in their existing patterns. Inject 10% exploration content (high-quality but low-similarity-to-history) per recommendation batch.
6. **Latency budget** — recommendation generation runs server-side; budget 200ms p95. pgvector with IVFFlat index + 100-row limit usually OK; if exceeded, async-recompute + cache for 1h.

**Owning phase:** **M5b (AI Personalization)** owns. Plan-checker check: any pgvector migration plan must include `model_id`/`model_version` columns; recommendation query must filter on both.

---

### Pitfall V13-16: Helpdesk email-to-ticket spam + AI auto-reply hallucination 🔇 LANDMINE + 🔊 LOUD

**Trigger condition:**
M6 helpdesk = Resend Inbound webhook → tickets; AI assists draft replies via Claude. Failures:
- **(a) Email-to-ticket spam** 🔊 — `support@app.leanshot.app` published in app + footer. Spam bots flood it. No spam protection in Resend Inbound (verify in M6 phase research — flag for confirmation). Result: ticket volume swamps support; legitimate tickets buried.
- **(b) AI auto-reply hallucination** 🔇→🔊 — Claude drafts a reply citing "our Pro plan is $19/month" but actual plan is $14.99. Or worse: drafts medical advice ("for nausea, try X"). Reply auto-sent without human review = direct harm.
- **(c) KB article version drift** 🔇 — admin updates KB article; cached ticket auto-reply contains stale URL or stale price quote; user receives reply pointing at deleted/changed article.
- **(d) CSAT response rate** 🔊 — no payment incentive → low return rate → CSAT scores are noise.

**Silent vs loud:** 🔊 (a), (d); 🔇 (b), (c).

**Suggested mitigation:**
1. **Spam triage cron + SPF/DKIM check** — incoming-email cron rejects emails failing SPF/DKIM, rate-limits by sender domain (5/hour), checks against [SpamAssassin]-style heuristics OR uses Cloudflare Email Routing as preflight. Document in M6 plan.
2. **AI replies REQUIRE human review** for v1.3; ship as "draft suggested by AI" in operator UI, never auto-send. AI confidence scores surfaced. Plan-checker BLOCKER: any plan auto-sending AI replies for v1.3 is rejected.
3. **No medical advice from AI** — system prompt explicitly forbids medical advice; classifier on AI draft refuses to send anything matching medical-recommendation patterns ("you should take", "try X dose", etc.); routes to human.
4. **KB article references via stable token** — AI draft cites `{{kb:article_slug}}` template-style; render at send-time from current KB; if article deleted, draft fails with operator alert ("KB X referenced is gone, please rewrite").
5. **CSAT via single-click email** — Resend transactional email with 1-5 star buttons that GET back to `csat-record` endpoint; one click, no auth, no friction. Per-ticket CSAT.

**Owning phase:** **M6 (Helpdesk)** owns. Research gap: M6 phase research must verify Resend Inbound spam-protection options. Plan-checker BLOCKER on auto-send AI replies.

---

### Pitfall V13-17: Public status page auto-incident detection false-positives undermine trust 🔇 LANDMINE

**Trigger condition:**
M7 status page (via Better Stack or similar). Auto-incident triggers on (a) Edge Function 500-rate spike, (b) Supabase connection-pool exhaustion, (c) Sentry-error-rate spike. Each has different false-positive modes:
- **(a)** 500-rate spike from one buggy user's auto-retrying client = global incident published = users panic.
- **(b)** Supabase connection storm from a single tenant = global "Database degraded" status = competitors screenshot for sales.
- **(c)** Sentry error-rate spike from a new browser version's flaky web-push API = "Push notifications down" published for 4h.

Plus per-region status: Vercel deploys multi-region; eu-central can be degraded while us-east is fine; single global "Vercel: green" badge is wrong for an EU customer experiencing actual issues.

Plus subscriber email burst: incident "resolved" notification fans out to 10k subscribers in one minute; Resend rate-limit (per project memory `feature_resend_rate_limit`); some users get the resolved-email at T+2h.

**Silent vs loud:** 🔇 — false positives feel reasonable individually, the credibility erosion is gradual.

**Suggested mitigation:**
1. **Two-of-three incident detection** — auto-incident only fires if 2+ independent signals trip in 5-min window (e.g., 500-rate AND Sentry-spike AND Supabase-conn-exhaustion). Single-signal triggers go to PagerDuty for human review.
2. **Per-region status pages** — `status.leanshot.app/us-east`, `status.leanshot.app/eu-central`; subscribers pick region.
3. **Subscriber notifications via Resend batch API** — fan-out goes through `Resend.emails.batch.create` (avoid rate-limit); incident-resolved emails throttled to 100/sec.
4. **Manual confirmation requirement for global incidents** — auto-detection only opens a "pending incident" visible to admin; admin clicks "publish" to make public; or "false positive" to dismiss.
5. **Per-component status** — `Auth`, `Database`, `AI coach`, `Realtime`, `Email`, `Payments` as separate components; one degraded doesn't drag others.

**Owning phase:** **M7 (Misc — public status page)** owns.

---

### Pitfall V13-18: Cancellation save-offer discount stacking + ROI tracking gap 🔇 LANDMINE

**Trigger condition:**
M7 cancellation flow offers discount/pause to retain. Failures:
- **(a) Discount stacking** 🔇 — user already on promo coupon (e.g., 50% off first 3mo); cancellation offer "50% off next 3mo" stacks → free for 3mo. Stripe accepts coupons additively per its `coupon` model; we must prevent stacking server-side.
- **(b) Pause-then-cancel-anyway** 🔇 — user pauses via save offer; pause expires; user cancels at T+3mo; we never measure this as a "save" failure → save-offer ROI looks great when it's actually a delayed loss.
- **(c) ROI tracking** 🔇 — LTV uplift of save offer requires 12mo+ measurement window; team optimizes for "saved this month" → misses long-term churn pattern.

**Silent vs loud:** 🔇 all three.

**Suggested mitigation:**
1. **Server-side coupon-stack guard** — before applying cancellation offer, check `stripe.subscriptions.list({ customer })` for active discounts; if present, offer pause-only OR show "your current 50% discount continues; we can't stack additional discount" message.
2. **Save-offer outcome tracking** — `save_offers` table (`subscription_id`, `offer_type`, `offered_at`, `accepted_at`, `outcome_evaluated_at`, `final_outcome ENUM('retained_12mo', 'churned_after_pause', 'churned_after_discount', 'still_active')`). Cron evaluates at T+90d, T+180d, T+365d.
3. **LTV-based ROI dashboard** — save-offer success metric is `(saved_user_ltv_at_12mo − offer_discount_cost) / control_user_ltv_at_12mo` — compare to a non-offered control cohort. Admin dashboard surfaces 90d/180d/365d cuts.
4. **Pause expiry follow-up** — pause-end is a transactional touch-point; send reactivation email; track reactivation rate as separate metric from save-offer.

**Owning phase:** **M7 (Misc — cancellation save offers)** owns.

---

## Moderate Pitfalls

### Pitfall V13-19: Modular admin shell + per-module Edge Function permission checks drift 🔇 LANDMINE

**Trigger condition:** M1 modular admin = each module (members / finance / affiliates / clinics / experiments / KB / status) has its own Edge Function; permission check is per-module. A new module added without permission-check stub = admin-bypass leak.

**Mitigation:** ESLint rule + project pattern — every `supabase/functions/admin-*/` MUST `import { assertAdmin } from "../_shared/assert-admin.ts"` as first executable line; CI grep fails PRs missing it. Plan-checker check on any M1 admin-module plan.

**Owning phase:** M1 (Foundation).

---

### Pitfall V13-20: PostHog session-replay PII masking incomplete on new v1.3 surfaces 🔇 LANDMINE

**Trigger condition:** v1.3 introduces new input surfaces (clinic patient roster, helpdesk ticket details, AI coach with PHI, custom rank weights with clinical labels). PostHog session-replay default-masks `<input type=password>` but NOT contenteditable, NOT custom-component inputs, NOT div-based forms. PHI captured in replay → BAA violation.

**Mitigation:** Per-surface review — every new v1.3 surface that displays PHI gets `data-private="true"` on outermost wrapper + PostHog `mask_all_inputs: true, mask_all_text: true` on clinical routes via per-route init. Pattern: `useEffect(() => posthog.startSessionRecording({ mask_all_text: true }), [orgId])` on clinic routes. Plan-checker check: any v1.3 plan adding a clinical-context surface MUST include the mask config.

**Owning phase:** M1 (Foundation) ships the pattern; C consumes.

---

### Pitfall V13-21: Bulk admin actions (CSV import / mass-tag / mass-comp / mass-ban / force-reset) lack idempotency + audit 🔇 LANDMINE

**Trigger condition:** M1 bulk admin actions on 10k members. Mid-action failure (network blip, function timeout) leaves DB in partial state. Re-running causes double-comp / double-ban / double-tag.

**Mitigation:** Idempotency key per bulk action (UUID generated client-side; server stores in `bulk_actions(id, action_type, status, count_total, count_completed, started_at, completed_at, error)`); resumable from `count_completed`. Audit log per row. Soft-preview ("this action will affect N members") before commit.

**Owning phase:** M1 (Foundation).

---

### Pitfall V13-22: Canonical event taxonomy versioning + server-side capture mismatch 🔇 LANDMINE

**Trigger condition:** M1 ships `events.ts` v1 with PostHog server-side capture; v2 renames `signup` → `account_created`; ALL downstream cohort builders break silently if the renamed event isn't aliased.

**Mitigation:** `events.ts` is APPEND-ONLY for v1.3 (no renames, no removals). Each event has `version` + `deprecated_at` (nullable); cohort builder warns on deprecated events. PostHog server-side capture is wrapped in `captureCanonical(eventKey, props)` that validates eventKey against the registry; unknown event = build-time TS error.

**Owning phase:** M1 (Foundation).

---

### Pitfall V13-23: White-label clinic theming CSS leakage between orgs 🔇 LANDMINE

**Trigger condition:** Clinic A and B both have custom theme; CSS variables scoped via `[data-org-id="abc"] { --primary: blue }`. Operator switching between Org A and Org B's read-only view: cached CSS from Org A leaks into Org B render until manual refresh. Or user with multi-org membership sees Org B's theme on Org A surface due to leakage in styled-component cache.

**Mitigation:** Theme CSS loaded via `<style id="org-theme">` element fully replaced on org-context-change; theme variables ALL scoped under `:root[data-active-org="X"]` + body class change forces repaint; useEffect-clean on unmount removes the stylesheet.

**Owning phase:** C (Clinic + HIPAA — white-label theming).

---

### Pitfall V13-24: Clinic-invited patient ownership conflict on clinic-leave 🔇 LANDMINE

**Trigger condition:** Patient invited by Clinic A, logs 90d of data; patient leaves clinic. Three policy options: (a) data stays with patient (clinic loses access via `org_patient_link` delete), (b) data anonymized for clinic (clinic retains aggregate, patient keeps full), (c) data full-anonymization (clinic loses all, patient retains). Picking the wrong default = patient lawsuit OR clinic lawsuit.

**Mitigation:** Patient ALWAYS retains their own data (consumer-side); clinic-leaving deletes `org_patient_link` row; clinic-side roster no longer sees patient. Aggregate clinical-quality metrics for the clinic use `org_id`-stamped daily-snapshot views (which retain anonymized totals even after delink). Document in CONTEXT.md + present to patient at clinic-invite acceptance ("If you leave the clinic, your data stays with you; the clinic loses access").

**Owning phase:** C (Clinic + HIPAA).

---

### Pitfall V13-25: Recommendation latency budget breaks under cold-start pgvector 🔊 LOUD

**Trigger condition:** M5b recommender computes on-demand; pgvector IVFFlat index cold-start after Supabase restart takes seconds (full index scan first time). User-facing latency spikes.

**Mitigation:** Warmup cron (1/hour) runs a dummy query to keep index in cache; precompute recommendations daily for active users into `user_recommendations` table; on-demand only for new users.

**Owning phase:** M5b (AI Personalization).

---

### Pitfall V13-26: Web-push permission asked too early (M2 onboarding) → permanent denial 🔇 LANDMINE

**Trigger condition:** Onboarding step 5 prompts for push permission before user understands what they'll receive. User denies. Browser permanently denies (must reset in settings) → no future opportunity. Apple iOS Safari is especially strict.

**Mitigation:** Push permission asked AFTER first positive product moment (logged 3 doses, used AI coach, completed first weekly streak). Pre-prompt with custom explainer ("Get reminders for your next dose. Tap allow when prompted."). Same anti-pattern as v1.2 Pitfall #UX.

**Owning phase:** M2 (Onboarding).

---

### Pitfall V13-27: Helpdesk SLA clock-start ambiguity (received vs assigned vs first-response) 🔇 LANDMINE

**Trigger condition:** Clinic prospect's BAA includes "support SLA: 24h first-response". Helpdesk clock-start defined inconsistently (some tickets clock-start at email-received, others at human-assigned, others at first-AI-draft).

**Mitigation:** SLA clock starts at ticket-creation timestamp (Resend Inbound webhook receive time), pauses on awaiting-customer-reply, resumes on customer-reply-received. Per-tier SLA: consumer ∞, clinic-paid 24h, clinic-enterprise 4h. Cron alerts at 50% / 75% / 100% of SLA budget.

**Owning phase:** M6 (Helpdesk).

---

## Minor Pitfalls

### Pitfall V13-28: Email-as-org-namespace breaks Google Workspace clinic with shared aliases
Clinic uses `staff@clinic.com` shared inbox; multiple humans behind it; LeanShot treats it as ONE user. Mitigation: SSO via Google Workspace (org-domain-based provisioning) OR explicit per-human email enforcement at invite. **Phase:** C.

### Pitfall V13-29: Affiliate impressions ratio detector false-positives on small-affiliate burst
Phase 19 D-38 v1.3 affiliate impressions tracker uses Z-score baseline; small affiliate gets one viral post → flagged as fraud. Mitigation: minimum N=30 clicks before fraud-flag eligible. **Phase:** A.

### Pitfall V13-30: KB article search uses Postgres FTS in English only post-Spanish i18n
KB articles in ES; FTS configured `to_tsvector('english', ...)` misses ES stemming. Mitigation: `to_tsvector(coalesce(locale, 'simple'), ...)` per-article. **Phase:** B + M6.

### Pitfall V13-31: Bulk-action cron clobbers org-admin's individual-record edit mid-action
Bulk "comp all paid users 1mo" runs while org-admin edits one user manually. Last-write-wins clobbers manual edit. Mitigation: optimistic-lock on `users.updated_at`; bulk action fetches → checks → writes; on conflict, skip + log. **Phase:** M1.

### Pitfall V13-32: Sentry release-fingerprint mismatch on v1.3 vs v1.2 → false-spike on existing errors
Sentry groups errors by release fingerprint. v1.3 deploy bumps release ID; pre-existing v1.2 errors re-appear "new" in Sentry → false alert storm. Mitigation: sentry `release` config keeps semantic version stable across phases of a milestone; only bump major version on milestone boundary. **Phase:** M1.

### Pitfall V13-33: PostHog cohort builder query latency at 100k+ users
M1 cohort builder issues complex JSONB filters server-side; PostHog Cloud query latency degrades past 100k events/day. Mitigation: materialized cohorts (compute nightly, serve from materialized view); on-demand only for ad-hoc admin queries with caching. **Phase:** M1.

---

## Phase-Specific Warnings

| v1.3 Workstream | Top 3 Critical Pitfalls | Plan-Checker Mitigation Required In Plans |
|------------------|--------------------------|-------------------------------------------|
| **M1 (Foundation)** | V13-1 (PHI fence), V13-7 (server-side activation), V13-20 (session-replay PII), V13-22 (canonical events) | Event-taxonomy versioning; PHI-strip pattern on PostHog/Sentry; admin-module permission-check eslint rule |
| **A (Revenue) — multi-tier affiliate** | V13-6 (state-machine drift) | State-graph audit (`gsd-tools state-graph affiliate_tier`); tier-stamped conversions; chargeback-hold not reset on tier change |
| **A (Revenue) — mid-trial paywall A/B** | V13-7 (PostHog stickiness + refund-rate) | Server-side activation event; `user_experiments` table not raw PostHog flag reads; refund-rate guardrail with 30d burn-in |
| **A (Revenue) — page-builder A/B** | V13-4 (SEO penalty) | Canonical link emit; 42-day variant cap; PostHog flag persistence; per-variant cache key |
| **A (Revenue) — hourly ad ETL** | V13-5 (silent data drops) | Idempotent re-sync (last 72h); rate-limit-aware backoff; gap-detection cron; attribution-window normalized view; AEM priority register |
| **B (Depth) — embed blocks** | V13-8 (sandbox + consent + OAuth) | Per-provider whitelist; lazy-mount on consent + click; CSP frame-src enumeration; sandbox `allow-scripts` + `allow-same-origin` forbidden together |
| **B (Depth) — pharmacology paywall** | V13-10 (reputational + regulatory) | CONTEXT.md paywall-acceptable-vs-forbidden decision; reversibility plan; state AG disclosure scrub; adverse-event-symptom exclusion |
| **B (Depth) — Spanish i18n** | V13-9 (medical translation accuracy) | Clinical glossary review-by date + reviewer; `i18next-icu`; physical-to-logical CSS codemod; `qa-i18n-es-medical.spec.ts` |
| **C (Clinic + HIPAA)** | V13-1 (BAA chain), V13-2 (RLS multi-tenant), V13-11 (session timeout), V13-12 (alert PHI), V13-24 (patient ownership) | Vendor BAA chain table + scope guard; per-org cross-tenant RLS tests (every new org-scoped table); `withOrgScope` service_role wrapper; HMAC realtime channel names; versioned rank weights; PHI-free alert emails; clinic-leave data ownership documented |
| **M2 (Onboarding)** | V13-14 (preview PII), V13-26 (push permission) | Client-side-only preview default OR explicit-consent-toggled-server-side; push permission AFTER first positive moment |
| **M3a (Gamification)** | V13-13 (dark pattern + TZ bugs) | UX brief sign-off per surface; `users.timezone`-aware streak calc; freeze-token grant audit log |
| **M3b (Review prompt)** | V13-3 (rating-gating policy) | BLOCKER on conditional native-prompt code (NPS gating); native prompt unconditional after positive moment; NPS routes to M6 helpdesk |
| **M5b (AI recommender)** | V13-15 (pgvector drift) | `model_id`/`model_version` columns on embeddings; two-phase migration; drift-detection cron |
| **M6 (Helpdesk)** | V13-16 (spam + AI hallucination) | Resend Inbound spam research; BLOCKER on auto-send AI; medical-advice classifier on AI drafts; stable KB token references |
| **M7 (Cancellation save)** | V13-18 (discount stacking + ROI gap) | Server-side coupon-stack guard; save-offer outcome tracking at 90d/180d/365d |
| **M7 (Status page)** | V13-17 (false-positive incidents) | Two-of-three detection; per-region pages; Resend batch fan-out; manual-confirm for global; per-component breakdown |

---

## Integration Gotchas (v1.3-specific, builds on v1.2)

| Integration | Common Mistake | Correct Approach |
|-------------|---------------|------------------|
| Anthropic BAA + clinic users | Routing clinic AI-coach to beta endpoints | Hard-coded allowlist of BAA-covered model + endpoint; reject 451 otherwise |
| Supabase Auth + multi-org | `auth.uid()` only in RLS policies | Add `auth.jwt() -> 'org_ids'` claim populated via Auth hook; per-org policies on every org-scoped table |
| Stripe customer + clinic invite | Sharing personal Stripe customer ID for clinic sub | Per-context customer ID; explicit user consent if both subs exist |
| PostHog + paywall A/B | Raw flag reads on conversion-critical paths | `user_experiments` table as source of truth; PostHog is analytics-only post-signup |
| Resend + clinic alerts | Sending PHI in email body | Email contains only "you have N alerts"; PHI behind auth in-app |
| Vercel Cron + ad ETL | Single hourly run with no gap detection | Always pull last 72h + separate gap-detection cron + alert on missed window |
| `iframe sandbox` + embeds | `allow-scripts allow-same-origin` together | One or the other; never both; per-provider attribute whitelist |
| `i18next` + medical strings | Machine-translate dose/unit/frequency | Manual translation tag on regex match; clinical reviewer sign-off |
| `pgvector` + model upgrade | In-place re-embed | Parallel rows with `model_id` + two-phase cutover + drift-detection cron |
| `SKStoreReviewController` + NPS | Condition `requestReview()` on satisfaction score | NEVER condition; fire unconditionally after positive product moment; NPS routes elsewhere |
| Resend Inbound + spam | No spam preflight | Cloudflare Email Routing preflight OR SpamAssassin-style scoring before ingest |
| Supabase Realtime + multi-org | Raw `org_id` in channel name | HMAC-token channel name + server-side membership check |
| Tailwind v4 + i18n | Physical `pl-4 mr-2` properties | Logical `ps-4 me-2` properties; codemod before Spanish strings ship |

---

## "Looks Done But Isn't" Checklist (v1.3-specific additions)

- [ ] **HIPAA BAA chain:** Often missing — runtime guard refusing clinic-user requests to non-BAA-covered model IDs
- [ ] **HIPAA BAA chain:** Often missing — subprocessor-diff weekly cron with auto-disclosure email to BAA clinics
- [ ] **HIPAA BAA chain:** Often missing — BAA expiry calendar with 60d/30d/7d alerts
- [ ] **Clinic org RLS:** Often missing — per-org cross-tenant impersonation test per new org-scoped table
- [ ] **Clinic org RLS:** Often missing — `withOrgScope` wrapper on every service_role-using Edge Function
- [ ] **Clinic org RLS:** Often missing — HMAC token in realtime channel names
- [ ] **Multi-tier affiliate:** Often missing — `tier_at_conversion_time` stamping on insert (not recompute)
- [ ] **Multi-tier affiliate:** Often missing — coupon-stack policy locked in CONTEXT with `commission_basis` enum
- [ ] **Multi-tier affiliate:** Often missing — state-graph audit on every tier-touching plan
- [ ] **Paywall A/B:** Often missing — server-side activation event capture (bypasses ad-blockers)
- [ ] **Paywall A/B:** Often missing — `user_experiments` table as source of truth (not raw PostHog flag)
- [ ] **Paywall A/B:** Often missing — refund-rate guardrail + 30d burn-in
- [ ] **Page-builder A/B:** Often missing — `<link rel="canonical">` to control variant
- [ ] **Page-builder A/B:** Often missing — 42-day max variant cap in admin UI
- [ ] **Page-builder A/B:** Often missing — per-variant cache key in ISR
- [ ] **Ad ETL:** Often missing — last-72h re-sync pattern (not just last hour)
- [ ] **Ad ETL:** Often missing — gap-detection cron separate from ETL cron
- [ ] **Ad ETL:** Often missing — `ad_revenue_normalized` view with single attribution window
- [ ] **Ad ETL:** Often missing — `fx_rates` daily cron with stale-rate fallback
- [ ] **Ad ETL:** Often missing — Meta AEM priority register in `events.ts`
- [ ] **Embed blocks:** Often missing — `allow-scripts allow-same-origin` forbidden together
- [ ] **Embed blocks:** Often missing — click-to-load placeholder by default (consent + CLS)
- [ ] **Embed blocks:** Often missing — CSP `frame-src` updated when new provider added
- [ ] **Spanish i18n:** Often missing — clinical glossary file with reviewer attribution
- [ ] **Spanish i18n:** Often missing — `i18next-icu` not native plurals
- [ ] **Spanish i18n:** Often missing — physical-to-logical CSS codemod landed
- [ ] **Pharmacology paywall:** Often missing — CONTEXT.md paywall-acceptable-vs-forbidden line
- [ ] **Pharmacology paywall:** Often missing — reversibility plan written before launch
- [ ] **Pharmacology paywall:** Often missing — adverse-event-symptom user exclusion
- [ ] **Session timeout (HIPAA):** Often missing — context-aware (consumer ∞, clinical 15min)
- [ ] **Session timeout (HIPAA):** Often missing — re-auth on sensitive actions for clinical sessions
- [ ] **Rank weights:** Often missing — versioned table (not in-place JSONB column)
- [ ] **Rank weights:** Often missing — daily ranking snapshots for historical audit
- [ ] **Alert email:** Often missing — PHI-free email body ("you have N alerts" only)
- [ ] **Gamification:** Often missing — `users.timezone`-aware streak calc with grace period
- [ ] **Gamification:** Often missing — freeze-token grant audit log with reason
- [ ] **Onboarding preview:** Often missing — client-side-only computation (no server-side PII write)
- [ ] **Onboarding preview:** Often missing — single-active-session-per-browser merge policy
- [ ] **Review prompt:** Often missing — native prompt fires unconditionally (NOT conditioned on NPS)
- [ ] **Review prompt:** Often missing — internal NPS routes to M6 helpdesk (independent surface)
- [ ] **AI recommender:** Often missing — `model_id`/`model_version` columns on embeddings
- [ ] **AI recommender:** Often missing — drift-detection cron
- [ ] **Helpdesk:** Often missing — AI auto-send blocker for v1.3 (human review required)
- [ ] **Helpdesk:** Often missing — medical-advice classifier on AI drafts
- [ ] **Status page:** Often missing — two-of-three auto-detection
- [ ] **Status page:** Often missing — per-region + per-component breakdown
- [ ] **Cancellation save:** Often missing — server-side coupon-stack guard
- [ ] **Cancellation save:** Often missing — 90d/180d/365d outcome tracking

---

## Recovery Strategies (v1.3-specific)

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| V13-1 BAA chain breach | **CATASTROPHIC** | (1) Suspend AI-coach for clinic users immediately; (2) full incident response to affected clinic admins per BAA breach-notification clause; (3) OCR notification within 60d if PHI > 500 individuals; (4) re-architect runtime guard; (5) external HIPAA audit at our cost. Reputational + potential 7-figure penalty. |
| V13-2 Cross-tenant leak | **HIGH** | (1) Identify affected query/route + impact scope (which orgs saw which orgs' data); (2) per-org disclosure per BAA; (3) re-architect RLS + add missing tests; (4) external security audit if PHI involved. |
| V13-3 Rating-gating policy violation | **HIGH** on Apple expulsion case; **MEDIUM** on Play suspension | (1) Pull binary from store; (2) re-architect prompt to unconditional; (3) re-submit; (4) potentially write reinstatement appeal letter for expulsion. Re-review 1-2 weeks per round. |
| V13-4 SEO penalty | **HIGH** (slow recovery) | (1) Add canonical + revert non-canonical variants; (2) submit reconsideration request via Google Search Console; (3) wait 4-12 weeks for ranking recovery; (4) interim SEM spend to backfill organic loss. |
| V13-5 Ad ETL gap | **LOW–MEDIUM** | (1) Run 30-day backfill via gap-detection cron; (2) re-render historical CAC dashboards; (3) audit any spend decisions made during gap window. |
| V13-6 Affiliate state drift | **MEDIUM** | (1) Pause all affiliate payouts; (2) reconcile manually via tier-history audit; (3) re-issue corrected commissions OR claw back overpaid; (4) communicate to affiliates with corrected statement. |
| V13-7 Paywall A/B contamination | **MEDIUM** | (1) Discard the experiment results entirely; (2) re-architect with server-side activation; (3) re-run with proper guardrails; (4) communicate to team that prior conclusions are invalid. |
| V13-8 Embed sandbox bypass | **MEDIUM (potential XSS)** | (1) Add `allow-scripts allow-same-origin` forbidden-together CSP rule + JS validator; (2) audit existing embed configs; (3) Sentry-trace any reports of unexpected behavior on embed surfaces. |
| V13-9 Spanish medical mistranslation | **HIGH (potential patient harm)** | (1) Roll back Spanish locale immediately; (2) clinical reviewer pass on all dose/unit/frequency strings; (3) re-release after sign-off; (4) outreach to affected ES-locale users with English fallback offer if harm risk. |
| V13-10 Pharmacology paywall backlash | **MEDIUM (reversible)** | (1) Flip PostHog flag to 0% within 30min; (2) tweet apology; (3) post-mortem on the blog; (4) offer Pro for 90d to affected users; (5) re-scope paywall lines with stricter "no safety info" rules. |
| V13-13 Gamification dark-pattern complaint | **LOW** | (1) Reframe push notification copy from loss-aversion to gain-framing; (2) review remaining gamification surfaces against UX brief. |
| V13-14 Onboarding PII leak | **MEDIUM** | (1) GDPR disclosure to affected users; (2) re-architect preview to client-side-only; (3) document in next DPA audit. |
| V13-15 Recommender drift | **LOW** | (1) Run two-phase migration; (2) discard the past N days of recommendation-CTR data as contaminated; (3) bake drift-detection cron going forward. |
| V13-16 AI auto-reply harm | **HIGH (potential patient harm)** | (1) Disable AI auto-send immediately; (2) review last 30d of AI-sent replies for medical-advice content; (3) per-user disclosure if harm risk; (4) re-architect as draft-only for v1.3. |
| V13-17 False-positive incidents | **MEDIUM (trust erosion)** | (1) Reset status-page subscriber trust via long-form post-mortem; (2) implement two-of-three detection; (3) acknowledge prior false-positive log publicly. |
| V13-18 Save-offer discount stacking | **MEDIUM (revenue leak)** | (1) Identify free-for-3mo users from logs; (2) communicate change in offer terms going forward (don't claw back); (3) ship server-side guard. |

---

## Sources

**App Store / Play Store rating policy (HIGH confidence):**
- [App Review Guidelines — Apple Developer (verified 2026-05-17)](https://developer.apple.com/app-store/review/guidelines/) — §3.2.2(x) rating prompts + Introduction on review manipulation
- [SKStoreReviewController — Apple Developer Documentation](https://developer.apple.com/documentation/storekit/skstorereviewcontroller) — 3 prompts per 365 days, no user-action trigger
- [User Ratings, Reviews, and Installs — Google Play Console Help](https://support.google.com/googleplay/android-developer/answer/9898684) — explicit prohibition on review-gating
- [What Is Review Gating and Why It Violates Google's Review Policies — SEOlogist](https://www.seologist.com/knowledge-sharing/what-is-review-gating-and-why-does-it-violate-googles-review-policies/) — review-gating defined as deceptive practice

**HIPAA + Anthropic BAA + ZDR (HIGH confidence):**
- [Business Associate Agreements (BAA) for Commercial Customers — Anthropic Privacy Center](https://privacy.claude.com/en/articles/8114513-business-associate-agreements-baa-for-commercial-customers) — BAA scope; beta features NOT covered
- [I have a zero data retention agreement with Anthropic — Anthropic Privacy Center](https://privacy.claude.com/en/articles/8956058-i-have-a-zero-data-retention-agreement-with-anthropic-what-products-does-it-apply-to) — ZDR scope
- [Anthropic Subprocessors Update](https://trust.anthropic.com/updates) — subprocessor list (scrape target for diff cron)
- [Is Claude HIPAA Compliant? 2026 Guide — Strac](https://www.strac.io/blog/is-claude-hipaa-compliant) — BAA, Code, Cowork, Enterprise scope confirmation

**Supabase RLS multi-tenant (HIGH confidence):**
- [Row Level Security — Supabase Docs](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Why is my service role key client getting RLS errors — Supabase Docs](https://supabase.com/docs/guides/troubleshooting/why-is-my-service-role-key-client-getting-rls-errors-or-not-returning-data-7_1K9z) — service_role bypass
- [Supabase RLS Best Practices — Makerkit](https://makerkit.dev/blog/tutorials/supabase-rls-best-practices) — JOIN-table policy gap
- [The Supabase service-role key — Securie](https://securie.ai/guides/supabase-service-role-key) — when to use, when not to

**Ad API rate limits (HIGH confidence Meta, MEDIUM Google/TikTok):**
- [Marketing API Limits & Best Practices — Meta for Developers](https://developers.facebook.com/docs/marketing-api/insights/best-practices/) — 190k/600 per ad account per hour formula
- [Marketing API Rate Limiting — Meta for Developers](https://developers.facebook.com/docs/marketing-api/overview/rate-limiting/) — throttle headers + tiers
- [Breakdowns — Marketing API](https://developers.facebook.com/docs/marketing-api/insights/breakdowns/) — attribution windows + AEM

**Stripe customer namespace (HIGH confidence):**
- [Customers — Stripe Documentation](https://docs.stripe.com/billing/customer) — email uniqueness NOT enforced
- [Can I merge multiple Customers into one? — Stripe Help](https://support.stripe.com/questions/can-i-merge-multiple-customers-into-one) — Stripe does NOT support customer merge
- [Share customers and payment methods across accounts in an organization — Stripe](https://docs.stripe.com/get-started/account/orgs/sharing/customers-payment-methods)

**PostHog feature flags + identify (MEDIUM confidence):**
- [Identifying users — PostHog Docs](https://posthog.com/docs/product-analytics/identify)
- [Best practices for production-ready flags — PostHog Docs](https://posthog.com/docs/feature-flags/best-practices)
- [Feature flags are incorrect on client identify call — PostHog GitHub issue #21591](https://github.com/PostHog/posthog/issues/21591) — race condition reference
- [Feature flag value changes after identify, Flag persistence is enabled — PostHog GitHub issue #2623](https://github.com/PostHog/posthog-js/issues/2623)

**i18n + ICU plurals (MEDIUM confidence):**
- [Plurals — i18next documentation](https://www.i18next.com/translation-function/plurals)
- [Using with ICU format — react-i18next documentation](https://react.i18next.com/misc/using-with-icu-format)
- [ICU Message Format Guide — Crowdin](https://crowdin.com/blog/icu-guide)

**iframe sandbox + embed security (MEDIUM confidence):**
- [iframe sandbox attribute — MDN Web Docs](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/iframe#sandbox) — `allow-scripts allow-same-origin` anti-pattern

**LeanShot project memory (internal references inherited from v1.2):**
- `reference_supabase_project.md` — every RLS surface gets a live cross-tenant impersonation proof test (project rule)
- `reference_rls_fixture_gotrueclient_flake.md` — `admin.generateLink` + plain fetch pattern for RLS tests
- `reference_supabase_app_metadata_jwt_propagation.md` — 336ms JWT claim propagation window
- `feedback_status_machine_transition_owner.md` — state-graph audit pattern (Phase 19 BL-11)
- `reference_phase7_research_findings.md` — WMHMDA RCW 19.373.030 5 CHDP sections
- `feedback_regulator_vs_user_audience_pattern.md` — regulator-vs-user audience scope pattern (pharmacology paywall design)
- `feedback_defer_then_batch_fix_pattern.md` — `.planning/deferred-tests.md` registry for env-gated/timing-flaky tests
- `reference_vendor_gated_send_health_check.md` — vendor-gated send via health check (Resend/BAA chain pattern)

**v1.2 PITFALLS.md (carried over — apply where v1.2 surfaces are touched):**
- v1.2 Pitfall 4 (cookie consent pre-fire) — applies to embed-block consent gating + onboarding preview
- v1.2 Pitfall 5 (bundle ceiling) — applies to new v1.3 SDKs (i18next, Better Stack widget, recommender lib)
- v1.2 Pitfall 6 (Safari ITP affiliate cookies) — still applies to multi-tier affiliate
- v1.2 Pitfall 7 (affiliate ledger retention) — multi-tier compounds this
- v1.2 Pitfall 10 (clinic/share ads-free) — clinic orgs now have org-scoped surfaces with same trust requirement
- v1.2 Pitfall 11 (page-builder SEO/a11y) — variant A/B compounds the SEO risk
- v1.2 Pitfall 14 (PrivacyInfo manifest) — only applies if v1.3 touches mobile shells (deferred per v1.3 ROADMAP)
- v1.2 Pitfall 15 (DSAR completeness) — new v1.3 PII surfaces (orgs, tickets, alerts, embeddings) each need DSAR-export module updates
- v1.2 Pitfall 18 (Resend deliverability) — clinic alerts compound the deliverability requirement
- v1.2 Pitfall 24 (account merging clinic invite × B2C) — directly relevant to V13-2(d)

---

## Open Research Gaps Flagged for Phase-Level Research

| Topic | Why flagged | Suggested phase to research |
|-------|-------------|------------------------------|
| Resend Inbound spam-protection options | Vendor docs not directly fetched in this pass; M6 phase needs definitive answer | M6 (Helpdesk) `/gsd-research-phase` |
| TikTok Ads API rate-limit specifics per endpoint | High-level confirmation only; M1/A phase needs per-endpoint table | A (hourly ad ETL) `/gsd-research-phase` |
| HIPAA BAA enforcement runtime cost in Supabase Pro vs Team vs Enterprise | Pricing tier impacts BAA chain implementation timing | C (Clinic + HIPAA) `/gsd-research-phase` |
| WMHMDA + CTDPA enforcement actions to date (precedent) | Counsel review topic; informs pharmacology paywall risk tolerance | B (pharmacology paywall) — counsel referral, not engineering research |
| Better Stack vs Statuspage.io vs Instatus comparison for clinic-acceptable status pages | Vendor research needed; status page is clinic-facing trust surface | M7 (status page) `/gsd-research-phase` |
| RevenueCat + Stripe tier reconciliation under multi-tier affiliate context | P16 deferred; reconciliation under new tier system is unscoped | A (multi-tier affiliate) — context decision; or defer to v1.4 if P16 still deferred |
| pgvector index type (IVFFlat vs HNSW) tradeoff at clinic-tenant scale | Clinic patient counts could be much higher than consumer; index choice differs | M5b (AI recommender) `/gsd-research-phase` |

---

*Pitfalls research for: LeanShot v1.3 (foundation + multi-tier affiliate + paywall A/B + page-builder A/B + ad ETL + embed blocks + pharmacology paywall + Spanish i18n + clinic orgs + custom rank weights/alerts + HIPAA BAA chain + onboarding overhaul + gamification + review prompts + AI recommender + helpdesk + cancellation save + status page)*

*Inherits all 33 v1.2 pitfalls; adds 33 v1.3-specific pitfalls (V13-1 through V13-33).*
