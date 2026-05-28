---
plan: "70-02-stripe-test"
phase: "70"
wave: 0
depends_on: []
autonomous: false
type: execute
requirements:
  - UAT-01
  - UAT-03
files_modified:
  - .planning/phases/70-consolidated-uat-v1-4-launch-gate/evidence/stripe-test/**
  - .planning/phases/70-consolidated-uat-v1-4-launch-gate/70-02-PLAN-stripe-test.md
fixture_group: "stripe-test"
estimated_duration: "3-4 hours operator time (mostly Stripe test-clock + Tax cross-state runs)"
must_haves:
  - "stripe-test-S01-stripe-tax-active"
  - "stripe-test-S02-coupons-seeded"
  - "stripe-test-S03-3-email-dunning-cadence"
  - "stripe-test-S04-lifetime-checkout"
  - "stripe-test-S05-grandfathered-silent-pricing"
  - "stripe-test-S06-70-percent-cap-discount-stack"
  - "stripe-test-S07-refund-self-service"
  - "stripe-test-S08-cross-state-tax-calc"
  - "stripe-test-S09-rls-cross-tenant-deny"
---

<objective>
Plan 02 — Stripe test. All Stripe-fixture walkthroughs: tax across US states + 3-email dunning cadence + refund self-service (Phase 65), Lifetime checkout (Phase 43 MEMBER-01), grandfathered silent pricing (MEMBER-02), 70%-cap discount stack (MEMBER-03), RLS cross-tenant deny proof (MEMBER-04), original save-offer coupon seed (Phase 40), the 6 SAVE-* + 3 WB-* coupon presence sweep, admin save-offer rule create, end-to-end cancel flow accept + decline paths.

Single-operator session runs against Stripe test-mode + a few test users with active test subscriptions. Use Stripe test-clocks to fast-forward dunning where the calendar would otherwise take 7-14 days.

Purpose: UAT-01 (Phase 40 + 43 + 44 v1.3 carry-over) + UAT-03 (Phase 65 new v1.4 Stripe Tax + dunning + refund) coverage.

Output: signoff checkboxes filled inline + evidence (Stripe Dashboard screenshots + curl outputs + Stripe test-clock snapshots) committed to `evidence/stripe-test/`.
</objective>

<context>
@.planning/STATE.md
@.planning/ROADMAP.md
@.planning/REQUIREMENTS.md
@.planning/milestones/v1.3-uat-deferred.md
@.planning/phases/70-consolidated-uat-v1-4-launch-gate/70-CONTEXT.md
@.planning/phases/70-consolidated-uat-v1-4-launch-gate/70-01-PLAN-vendor-oauth-secrets.md
@.planning/phases/69.7-vercel-supabase-build-deploy-verification/69.7-SUMMARY.md
@.planning/phases/65-stripe-tax-payment-resilience/65-CARRY-OVER.md

**Prerequisite:** Plan 01 signals S06 (STRIPE_PRICE_LIFETIME), S08-S10 (STRIPE_COUPON_WB_*) must be approved before this plan's S04, S03 can run. Plan 01 S02 (Vercel share-token) gates nothing here but is required for share-card smoke.
</context>

<tasks>

<task id="02-S01" name="Signal — Stripe Tax active in Dashboard">
  <type>verification</type>
  <signal_id>stripe-test-S01-stripe-tax-active</signal_id>
  <criticality>critical</criticality>
  <fixture>stripe-test</fixture>
  <read_first>
    - .planning/phases/69.7-vercel-supabase-build-deploy-verification/69.7-SUMMARY.md §"5 HUMAN signals" row 1
    - .planning/phases/65-stripe-tax-payment-resilience/65-CARRY-OVER.md
  </read_first>
  <action>
1. Sign in to Stripe Dashboard https://dashboard.stripe.com → Products → Tax → Overview.
2. Confirm "Stripe Tax is active" banner. If "Activate Stripe Tax" CTA visible: click → walk through nexus registration (use Phase 65 nexus_thresholds_log as guidance for which states to register).
3. Tax Registrations: register in US states where LeanShot has nexus (start with HQ state at minimum). For test verification it's enough to have at least 2 states registered (CA + NY recommended).
4. CLI cross-check via Stripe API:
   `curl -H "Authorization: Bearer $STRIPE_SECRET_KEY" "https://api.stripe.com/v1/tax/settings" | jq '.status, .defaults'`
   Expected: `"status": "active"`.
5. Capture Dashboard screenshot showing Tax → Overview "active" banner + jq output.
  </action>
  <acceptance_criteria>
    - Stripe Tax status = active
    - at least 2 US states registered
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/stripe-test/S01-stripe-tax-active/
  </acceptance_criteria>
  <defer_clause>
    Cannot defer. Phase 65 cross-state tax calc + nexus monitor cron blocks without active tax. UAT-03 critical gate.
  </defer_clause>
</task>

<task id="02-S02" name="Signal — Save-offer coupons seeded (6 SAVE-* + 3 WB-*)">
  <type>verification</type>
  <signal_id>stripe-test-S02-coupons-seeded</signal_id>
  <criticality>critical</criticality>
  <fixture>stripe-test</fixture>
  <read_first>
    - .planning/milestones/v1.3-uat-deferred.md §Phase 40 — Signal A
    - Plan 01 S08-S10 signoff state
  </read_first>
  <action>
1. Trigger Phase 40 SAVE-* seed Edge Fn (idempotent):
   `curl -X POST -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" "https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/cancellation-seed-coupons"`
   Expected first run: `{"ok": true, "created": 6, "skipped": 0}`. Subsequent runs: `created:0, skipped:6` (idempotent).
2. Verify all 6 SAVE-* IDs in Stripe:
   `curl -H "Authorization: Bearer $STRIPE_SECRET_KEY" "https://api.stripe.com/v1/coupons?limit=20" | jq -r '.data[] | select(.id | startswith("SAVE-")) | .id' | sort`
   Expected exactly: `SAVE-20-2MO SAVE-20-3MO SAVE-25-2MO SAVE-25-3MO SAVE-30-2MO SAVE-30-3MO`.
3. Verify 3 WB-* coupons from Plan 01 S08-S10:
   `curl -H "Authorization: Bearer $STRIPE_SECRET_KEY" "https://api.stripe.com/v1/coupons?limit=20" | jq -r '.data[] | select(.id | startswith("WB_")) | .id' | sort`
   Expected: `WB_3MO_50 WB_6MO_30 WB_LIFETIME_20`.
4. Total `SAVE-*` + `WB_*` count: 9.
  </action>
  <acceptance_criteria>
    - 6 SAVE-* coupon IDs present
    - 3 WB_* coupon IDs present
    - cancellation-seed-coupons returns idempotent skip on re-run
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/stripe-test/S02-coupons-seeded/coupon-list.json
  </acceptance_criteria>
  <defer_clause>
    Cannot defer. Phase 40 + Phase 65 win-back lifecycle Fns reference these coupons.
  </defer_clause>
</task>

<task id="02-S03" name="Signal — 3-email dunning cadence (test-clock fast-forward)">
  <type>verification</type>
  <signal_id>stripe-test-S03-3-email-dunning-cadence</signal_id>
  <criticality>critical</criticality>
  <fixture>stripe-test</fixture>
  <read_first>
    - .planning/phases/65-stripe-tax-payment-resilience/65-CARRY-OVER.md
    - supabase/functions/stripe-dunning-orchestrator (cron-callable per 69.7-SUMMARY)
  </read_first>
  <action>
1. Create a Stripe test-clock https://dashboard.stripe.com/test/test-clocks. Initial time: now.
2. Create a test customer with payment method `4000000000000341` (always fails on renewal) attached to the test-clock. Subscribe to a monthly LeanShot plan via Stripe API or Dashboard.
3. Fast-forward test-clock by 1 month → renewal fails → invoice marked `past_due`.
4. Confirm Edge Fn `stripe-dunning-orchestrator` triggers Email 1 ("Card declined — update payment"). Either wait for the pg_cron tick or invoke directly:
   `curl -X POST -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" "https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/stripe-dunning-orchestrator/run"`
   Check Supabase `dunning_emails_log` row inserted.
5. Fast-forward test-clock +3 days → Email 2 ("Final reminder"). Verify log row.
6. Fast-forward +4 more days → Email 3 ("Subscription will cancel today"). Verify log row.
7. Fast-forward another day → subscription cancels. Verify `subscriptions.status='canceled'` + `dunning_emails_log` shows 3 rows for this customer.
8. Capture email-template screenshots (use the test inbox or Resend log).
  </action>
  <acceptance_criteria>
    - exactly 3 dunning_emails_log rows for the test customer
    - 3 email templates rendered with correct subject lines
    - subscription cancels at end of cadence
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/stripe-test/S03-3-email-dunning-cadence/
  </acceptance_criteria>
  <defer_clause>
    Cannot defer. Payment-resilience dunning is Phase 65 critical-gate. UAT-03 critical.
  </defer_clause>
</task>

<task id="02-S04" name="Signal — Lifetime checkout (MEMBER-01)">
  <type>verification</type>
  <signal_id>stripe-test-S04-lifetime-checkout</signal_id>
  <criticality>critical</criticality>
  <fixture>stripe-test</fixture>
  <read_first>
    - .planning/milestones/v1.3-uat-deferred.md §Phase 43 — Signal A
    - Plan 01 S06 (STRIPE_PRICE_LIFETIME)
  </read_first>
  <action>
1. Sign in to the app as a test user (free tier, no active subscription). Navigate to upgrade flow → select "Lifetime" SKU.
2. Stripe Checkout opens. Use test card `4242424242424242`, any future expiry, any CVC, any ZIP.
3. Complete checkout. Stripe redirects to success URL.
4. Verify in DB:
   `supabase db query --linked "SELECT user_id, stripe_price_id, created_at FROM public.lifetime_purchases WHERE user_id='&lt;test-user-uuid&gt;';"`
   Expected: 1 row matching the Stripe price.id from Plan 01 S06.
5. Verify tier resolver:
   `supabase db query --linked "SELECT tier_label FROM public.tier_effective WHERE user_id='&lt;test-user-uuid&gt;';"`
   Expected: `tier_label='lifetime'`.
6. App UI: confirm Pro-locked features now accessible (community spaces, advanced charts, etc.).
  </action>
  <acceptance_criteria>
    - lifetime_purchases row inserted
    - tier_effective shows lifetime
    - UI unlocks Pro features
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/stripe-test/S04-lifetime-checkout/
  </acceptance_criteria>
  <defer_clause>Cannot defer. MEMBER-01 critical for Pro+Lifetime tier rollout.</defer_clause>
</task>

<task id="02-S05" name="Signal — Grandfathered silent pricing (MEMBER-02)">
  <type>verification</type>
  <signal_id>stripe-test-S05-grandfathered-silent-pricing</signal_id>
  <criticality>critical</criticality>
  <fixture>stripe-test</fixture>
  <read_first>
    - .planning/milestones/v1.3-uat-deferred.md §Phase 43 — Signal B
  </read_first>
  <action>
1. Sign in as admin → /admin/billing/grandfathered-prices → "Add row". Select a test cohort (or create one with one test user). Override price to a discounted SKU.
2. Sign in as the test user in the cohort → upgrade flow. Inspect the network request to `stripe-checkout` Edge Fn: `price.id` field MUST equal the grandfathered override (NOT the catalog default).
3. Confirm user sees NO upgrade prompt banner (grandfathered users are not nudged) and pricing page shows the grandfathered amount, not the catalog price.
4. Capture screenshots of: (a) admin grandfathered row creation, (b) DevTools network request, (c) pricing page displayed price.
  </action>
  <acceptance_criteria>
    - stripe-checkout receives grandfathered price.id
    - no upgrade prompt for the cohort user
    - pricing page shows grandfathered amount
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/stripe-test/S05-grandfathered-silent-pricing/
  </acceptance_criteria>
  <defer_clause>Cannot defer. MEMBER-02 + MEMBER-04 critical.</defer_clause>
</task>

<task id="02-S06" name="Signal — 70%-cap discount stack (MEMBER-03)">
  <type>verification</type>
  <signal_id>stripe-test-S06-70-percent-cap-discount-stack</signal_id>
  <criticality>critical</criticality>
  <fixture>stripe-test</fixture>
  <read_first>
    - .planning/milestones/v1.3-uat-deferred.md §Phase 43 — Signal C
  </read_first>
  <action>
1. Create Stripe TEST50 coupon (50% off, 6-month duration repeating): Stripe Dashboard → Coupons → New. ID `TEST50`. Save.
2. Seed `cancellation_offers_log` with a 50% SAVE-* coupon for a test user:
   `supabase db query --linked "INSERT INTO public.cancellation_offers_log (user_id, subscription_id, coupon_id, percent_off) VALUES ('&lt;test-user-uuid&gt;', '&lt;sub-id&gt;', 'SAVE-30-3MO', 30);"`
3. Sign in as the test user → /settings → "Apply promo code" → enter `TEST50`.
4. Verify clamp logic kicks in per D-07: existing SAVE-30-3MO + TEST50 multiplicative would be 1 - 0.7*0.5 = 65% off baseline. Then with additional SAVE 30% nested = 30% + (50%*remaining) clamped at 70% total.
   - Confirm UI shows "70% off (capped)" banner
   - Confirm Stripe subscription `discounts[]` array has BOTH coupons but applied discount is exactly 70%
5. Test idempotency: re-submit same (subscription_id, promo_code_id) tuple:
   `supabase db query --linked "SELECT COUNT(*) FROM public.promo_trial_extensions_log WHERE subscription_id='&lt;sub-id&gt;' AND promo_code_id='&lt;promo-id&gt;';"`
   Expected: 1 (NOT 2 on duplicate submit).
  </action>
  <acceptance_criteria>
    - 70% cap enforced in Stripe + UI
    - SAVE-offer preserved, existing promo clipped (per D-07)
    - promo_trial_extensions_log idempotent on re-submit
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/stripe-test/S06-70-percent-cap-discount-stack/
  </acceptance_criteria>
  <defer_clause>Cannot defer. MEMBER-03 critical.</defer_clause>
</task>

<task id="02-S07" name="Signal — Refund self-service (trial + money-back window)">
  <type>verification</type>
  <signal_id>stripe-test-S07-refund-self-service</signal_id>
  <criticality>critical</criticality>
  <fixture>stripe-test</fixture>
  <read_first>
    - .planning/phases/65-stripe-tax-payment-resilience/65-CARRY-OVER.md (request-refund Fn)
  </read_first>
  <action>
1. As a test user with a subscription within the 30-day money-back window: Settings → Billing → "Request refund".
2. Form: enter reason + submit. Expect inline success banner.
3. Verify Edge Fn ran:
   `supabase db query --linked "SELECT user_id, subscription_id, refund_status, created_at FROM public.refund_requests_log WHERE user_id='&lt;test-user-uuid&gt;' ORDER BY created_at DESC LIMIT 1;"`
   Expected: 1 row with refund_status='processed' or 'pending_review'.
4. Stripe API: confirm refund object created:
   `curl -H "Authorization: Bearer $STRIPE_SECRET_KEY" "https://api.stripe.com/v1/refunds?limit=5" | jq '.data[0]'`
   Expected: amount matches subscription period charge; status='succeeded'.
5. Email: confirm refund-confirmation email lands at the test user inbox within 60s. Footer must contain `PHYSICAL_ADDRESS` value from Plan 01 S13.
6. Try the same flow for a user OUTSIDE the money-back window → confirm form rejects with "Outside money-back window — contact support" message.
  </action>
  <acceptance_criteria>
    - in-window refund processed via Stripe
    - refund_requests_log row created
    - refund email delivered with physical-address footer
    - out-of-window flow rejected
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/stripe-test/S07-refund-self-service/
  </acceptance_criteria>
  <defer_clause>Cannot defer. Phase 65 refund-self-service critical-gate.</defer_clause>
</task>

<task id="02-S08" name="Signal — Cross-state purchase tax calc (Phase 65)">
  <type>verification</type>
  <signal_id>stripe-test-S08-cross-state-tax-calc</signal_id>
  <criticality>critical</criticality>
  <fixture>stripe-test</fixture>
  <read_first>
    - .planning/phases/65-stripe-tax-payment-resilience/
  </read_first>
  <action>
1. Create 3 test customers, each with a different US-state billing address (CA, NY, TX recommended — TX has different tax rate vs CA + NY).
2. For each, run a Stripe Checkout for a Pro Monthly subscription using test card `4242424242424242`.
3. Inspect each invoice on Stripe Dashboard → Invoices. Confirm `tax` line item present + amount differs by state.
4. CLI cross-check:
   `for state in ca ny tx; do curl -H "Authorization: Bearer $STRIPE_SECRET_KEY" "https://api.stripe.com/v1/invoices?customer=&lt;cust-id-$state&gt;&limit=1" | jq '{customer, tax, total, state: "'$state'"}'; done`
5. Confirm tax `0` for non-nexus state (use a state NOT registered in S01, e.g. MT or AK if not registered) → tax should be `0` AND no error.
  </action>
  <acceptance_criteria>
    - tax line item present + state-correct for nexus states
    - tax 0 for non-nexus state (no error)
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/stripe-test/S08-cross-state-tax-calc/
  </acceptance_criteria>
  <defer_clause>Cannot defer. UAT-03 cross-state-purchase requirement.</defer_clause>
</task>

<task id="02-S09" name="Signal — RLS cross-tenant deny proof (MEMBER-04)">
  <type>verification</type>
  <signal_id>stripe-test-S09-rls-cross-tenant-deny</signal_id>
  <criticality>critical</criticality>
  <fixture>stripe-test</fixture>
  <read_first>
    - .planning/milestones/v1.3-uat-deferred.md §Phase 43 — Signal D
  </read_first>
  <action>
1. Seed 2 non-admin test users in different orgs. Add User A to a grandfathered cohort (via /admin/billing/grandfathered-prices). Leave User B out of any cohort.
2. Sign in as User A → confirm SELECT on `grandfathered_prices` returns A's cohort rows.
3. Sign in as User B → attempt to SELECT from grandfathered_prices via PostgREST. Expected: empty result set (NOT error — RLS silently filters).
   `curl -H "Authorization: Bearer &lt;user-B-jwt&gt;" "https://ytnsipxxmzgaebkqmokp.supabase.co/rest/v1/grandfathered_prices?select=*"`
   Expected: `[]`.
4. Verify `current_user_has_pro()` returns correct booleans:
   - call as User A (cohort, Pro) → `true`
   - call as User B (no cohort, free) → `false`
   Either via `supabase functions invoke` or PostgREST RPC.
5. Capture all 4 outputs to evidence.
  </action>
  <acceptance_criteria>
    - User B cannot read grandfathered_prices
    - current_user_has_pro returns correct boolean per user
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
    - evidence: evidence/stripe-test/S09-rls-cross-tenant-deny/
  </acceptance_criteria>
  <defer_clause>Cannot defer. MEMBER-04 RLS critical for multi-tenant security posture.</defer_clause>
</task>

<task id="02-S10" name="Signal — Evidence directory bootstrap">
  <type>verification</type>
  <signal_id>stripe-test-S10-evidence-bootstrap</signal_id>
  <criticality>non-critical</criticality>
  <fixture>cli</fixture>
  <read_first>
    - .planning/phases/70-consolidated-uat-v1-4-launch-gate/70-CONTEXT.md §Specifics §Evidence directory layout
  </read_first>
  <action>
1. `mkdir -p .planning/phases/70-consolidated-uat-v1-4-launch-gate/evidence/stripe-test/`
2. Create S01..S09 subdirs.
3. Smoke that Stripe test-mode key is local + working: `curl -s -H "Authorization: Bearer $STRIPE_SECRET_KEY" "https://api.stripe.com/v1/account" | jq '.id, .charges_enabled'` — must return `acct_*` and `true`.
  </action>
  <acceptance_criteria>
    - evidence dirs exist
    - Stripe API auth works
    - signoff: karsten.haldan@gmail.com, YYYY-MM-DD, &lt;outcome_1line&gt;
  </acceptance_criteria>
  <defer_clause>Non-critical — but bootstrap before running S01.</defer_clause>
</task>

</tasks>

<verification>
End-of-plan: every critical signal signed off; Stripe Dashboard test-mode shows: Tax active, 9 coupons present, dunning log populated, lifetime + grandfathered + 70%-cap + refund flows all exercised.
</verification>

<success_criteria>
- All 9 critical signals signed off (S01-S09).
- S10 bootstrap signed.
- Evidence under `.planning/phases/70-consolidated-uat-v1-4-launch-gate/evidence/stripe-test/`.
</success_criteria>

## Resume State

- [~] **S01** — Stripe Tax active — **PROBE-ONLY: status=pending, missing head_office; activation deferred to operator** — signoff: karsten.haldan@gmail.com, 2026-05-28, probed via `stripe get /v1/tax/settings`; Dashboard configuration required before launch
- [x] **S02** — ~~6 SAVE-* + 3 WB-*~~ → **6 SAVE-* + 3 WINBACK_*** (drift-corrected) coupons seeded — signoff: karsten.haldan@gmail.com, 2026-05-28, 6 SAVE-* created via stripe CLI direct (bypasses Fn auth via sb_secret_*); 3 WINBACK_* from Plan 70-01 already present; total 9/9 ✓
- [ ] **S03** — 3-email dunning cadence (test-clock) — signoff: __________
- [ ] **S04** — Lifetime checkout (MEMBER-01) — signoff: __________
- [ ] **S05** — Grandfathered silent pricing (MEMBER-02) — signoff: __________
- [ ] **S06** — 70%-cap discount stack (MEMBER-03) — signoff: __________
- [ ] **S07** — Refund self-service — signoff: __________
- [ ] **S08** — Cross-state tax calc — signoff: __________
- [ ] **S09** — RLS cross-tenant deny (MEMBER-04) — signoff: __________
- [x] **S10** — Evidence dir bootstrap — signoff: karsten.haldan@gmail.com, 2026-05-28, 10 subdirs + Stripe TEST auth probe (acct_1xTnHBqsUWrHpHCVbHbj6YjuGB8k1IMD country=DK)

## Composite Approval

| Disposition | Meaning |
|-------------|---------|
| `approved` | All 10 signals green |
| `approved — non-criticals-deferred` | 9 critical signals green; S10 deferred |
| `blocked: <reason>` | Any critical signal cannot land |

<output>
Update PLAN.md inline. Plan 08 aggregates this file's checkbox state for ship rule.
</output>
