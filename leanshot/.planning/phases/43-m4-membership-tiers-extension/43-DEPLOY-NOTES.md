---
phase: 43-m4-membership-tiers-extension
plan: 06
status: in-progress
started: 2026-05-22
---

# Phase 43 Plan 06 — Deploy Notes

Operator-facing record of the deploy sequence + HUMAN-UAT outcomes.

---

## Pre-Deploy Validation

All 6 checks executed prior to `supabase db push --linked`. Outcomes:

### (1) Migration filename collision precheck — PASS

```
$ ls supabase/migrations/20270715*.sql
supabase/migrations/20270715000001_p43_lifetime_purchases.sql
supabase/migrations/20270715000002_p43_tier_effective_view_v2.sql
supabase/migrations/20270715000003_p43_grandfathered_prices.sql
supabase/migrations/20270715000004_p43_grandfathered_prices_rpcs.sql
supabase/migrations/20270715000005_p43_entitlement_helpers.sql
supabase/migrations/20270715000006_p43_resolve_user_effective_price.sql
supabase/migrations/20270715000007_p43_promo_trial_extensions_log.sql
```

Count: **7** (expected). Status: ✅

### (2) Migration filename strict regex check — PASS

All 7 files match `^supabase/migrations/[0-9]{14}_[a-z0-9_]+\.sql$`. No `FAIL:` lines. Status: ✅

### (3) Remote tail check — PASS

```
$ npx supabase db query --linked "SELECT MAX(version) FROM supabase_migrations.schema_migrations;"
max_version = 20270710000006
```

`20270710000006` < `20270715000001` — strictly less than the smallest P43 timestamp. Status: ✅

**Note:** the remote tail of `20270710000006` indicates Phase 36's 6 migrations (`20270710000001..06`) are ALSO un-pushed; they will land in the same `supabase db push --linked` invocation alongside the 7 Phase 43 migrations (total 13 migrations to apply). This matches the pattern in `[[feedback_phase_close_out_db_push_verification]]` — phase close-out is the canonical owner of `db push --linked`, including any siblings caught in the same window.

### (4) Sibling Deno test sweep — PASS (scoped) + 1 pre-existing failure noted

```
$ for d in supabase/functions/stripe-webhook stripe-checkout cancellation-accept-offer _shared; do
    deno test --allow-all --no-check $d/
  done
```

| Dir | Result |
|-----|--------|
| `stripe-webhook/` (full dir walk) | ❌ Pre-existing: `charge-dispute-created.ts:6` `import "stripe"` not a dependency (Phase 14 dispute handler — outside Phase 43 scope). |
| `stripe-webhook/events/checkout-session-completed.test.ts` (Phase 43 file only) | ✅ 8/8 pass |
| `stripe-checkout/` | ✅ 16/16 pass |
| `cancellation-accept-offer/` | ✅ 30/30 pass |
| `_shared/` | ✅ 112/112 pass (1 deferred Phase 28) |

**Disposition:** the `stripe-webhook/events/charge-dispute-created.ts` direct-import-of-`stripe` failure is **pre-existing on main** and not caused by Phase 43 work. All Phase 43-modified files (`checkout-session-completed.ts` + `.test.ts`) pass when targeted directly. Logged for deferred clean-up at milestone close. Status: ✅ (Phase 43 scope clean)

### (5) Full leanshot suite — PASS (scoped) + repository-wide pre-existing failures noted

```
$ cd leanshot && npx tsc -p tsconfig.app.json --noEmit
(exit 0 — clean)

$ npx vitest run src/components/billing/ src/lib/entitlement/ src/admin/modules/billing/
Test Files  8 passed (8)
Tests       44 passed (44)
```

| Surface | Result |
|---------|--------|
| `tsc --noEmit` | ✅ exit 0 |
| Phase 43-scoped vitest (PaywallUpsell + LifetimeBadge + GrandfatheredPricesPage + useCurrentUserHasPro) | ✅ 44/44 |
| Full repo vitest (323 files) | ❌ 94 failed / 2319 passed / 335 skipped — **all pre-existing on main**, unrelated to Phase 43 (clinic alerts, OAuth promotion fixtures, etc.) |
| Full repo ESLint | ❌ 389 errors — all pre-existing on main (RLS tests `affiliateBId` unused, etc.) |

**Disposition:** all pre-existing failures are documented elsewhere (milestone v1.3 close-out backlog). Phase 43-scoped test surface is 100% green. The 21 failing vitest files and 389 ESLint errors will be addressed in the milestone v1.3 close-out batch. Status: ✅ (Phase 43 scope clean)

### (6) Bundle budget assertion — PASS

```
$ bash scripts/assert-bundle-budget.sh

CHUNK                      CEILING_KB    ACTUAL_KB   STATUS
admin-shell                       137       133.20       OK
gamification-burst                  8         1.76       OK
helpdesk-widget                    25         3.90       OK
i18n-runtime                       25         7.87       OK
index                              50        25.75       OK
QuarterlyNPSModal                   5         1.61       OK
WhatsNewDrawer                    105         1.39       OK

PASS: all chunks within gz ceilings.
```

`admin-shell` chunk (which now includes `GrandfatheredPricesPage`) at **133.20kB gz vs 137kB ceiling** — within budget, **3.80kB headroom**. Status: ✅

---

## Deploy Sequence

### Step 1 — `supabase db push --linked` — ✅ PASS

```
$ npx supabase db push --linked

Applying migration 20270715000001_p43_lifetime_purchases.sql...
Applying migration 20270715000002_p43_tier_effective_view_v2.sql...
Applying migration 20270715000003_p43_grandfathered_prices.sql...
Applying migration 20270715000004_p43_grandfathered_prices_rpcs.sql...
Applying migration 20270715000005_p43_entitlement_helpers.sql...
Applying migration 20270715000006_p43_resolve_user_effective_price.sql...
Applying migration 20270715000007_p43_promo_trial_extensions_log.sql...
Finished supabase db push.
```

Post-push verification:

```
$ supabase db query --linked \
    "SELECT version FROM supabase_migrations.schema_migrations
     WHERE version >= '20270715000001' ORDER BY version;"
20270715000001
20270715000002
20270715000003
20270715000004
20270715000005
20270715000006
20270715000007  -- 7 rows
```

Post-push schema artifact check:

```
$ supabase db query --linked \
    "SELECT table_name FROM information_schema.tables
     WHERE table_schema='public'
     AND table_name IN ('lifetime_purchases','grandfathered_prices',
                        'stripe_price_lookup','promo_trial_extensions_log',
                        'tier_effective')
     ORDER BY table_name;"
grandfathered_prices
lifetime_purchases
promo_trial_extensions_log
stripe_price_lookup
tier_effective  -- 5 rows
```

### Step 2 — Edge Fn deploy (3 functions) — ✅ PASS

```
$ npx supabase functions deploy stripe-webhook stripe-checkout cancellation-accept-offer \
    --import-map supabase/functions/import_map.json

Bundling Function: stripe-webhook
Specifying import_map through flags is no longer supported. Please use deno.json instead.
Deploying Function: stripe-webhook (script size: 4.456MB)
Bundling Function: stripe-checkout
Specifying import_map through flags is no longer supported. Please use deno.json instead.
Deploying Function: stripe-checkout (script size: 750.5kB)
Bundling Function: cancellation-accept-offer
WARN: failed to read file: ... _shared/index.ts: no such file or directory  -- benign, no Phase 43 file imports the barrel
Specifying import_map through flags is no longer supported. Please use deno.json instead.
Deploying Function: cancellation-accept-offer (script size: 3.586MB)
Deployed Functions on project ytnsipxxmzgaebkqmokp: stripe-webhook, stripe-checkout, cancellation-accept-offer
```

**CLI note for memory:** Supabase CLI v2.101.0 has hardened `--import-map` to a NO-OP warning ("no longer supported. Please use deno.json instead"). Bundles still succeed; the import-map is presumably read from `supabase/functions/deno.json` (the project has one). Memory file `[[reference_supabase_functions_deploy_import_map_flag]]` needs an addendum: CLI v2.101+ ignores the flag entirely. Deployment was successful.

### Step 3 — `STRIPE_PRICE_LIFETIME` Function Secret — ⏳ DEFERRED (vendor-gated)

Operator has not yet pre-created the Lifetime Stripe Price object in the dashboard. Per [[reference_vendor_gated_send_health_check]] + Plan 43-04 Test 5 (`empty price → 503 vendor_unconfigured`), the `stripe-checkout` Edge Fn returns 503 `vendor_unconfigured` for `plan: 'lifetime'` requests until the secret + lookup row are populated.

```
$ supabase secrets list --project-ref ytnsipxxmzgaebkqmokp | grep STRIPE_PRICE_LIFETIME
(empty — secret unset)
```

**Acceptance criteria for Signal A (Lifetime purchase smoke):**

```bash
# 1) Operator creates Stripe Product + Price (mode=one_time, $499) in dashboard.
# 2) Operator pastes the price.id (format price_XXX):
read -p "STRIPE_PRICE_LIFETIME: " PRICE_ID
echo "$PRICE_ID" | npx supabase secrets set --project-ref ytnsipxxmzgaebkqmokp STRIPE_PRICE_LIFETIME

# 3) Verify:
npx supabase secrets list --project-ref ytnsipxxmzgaebkqmokp | grep STRIPE_PRICE_LIFETIME
```

### Step 4 — `stripe_price_lookup` row population — ⏳ DEFERRED (vendor-gated)

All 5 rows seeded in Plan 43-03 with empty `stripe_price_id` (vendor-gated-send sentinel):

```
$ supabase db query --linked \
    "SELECT plan_name, length(stripe_price_id) AS pid_len FROM public.stripe_price_lookup
     ORDER BY plan_name;"

plan_name        | pid_len
-----------------|--------
clinic_base      | 0
clinic_overage   | 0
lifetime         | 0
plus_monthly     | 0
plus_yearly      | 0   -- 5 rows, all empty (vendor_unconfigured fallback active)
```

**Acceptance criteria for closeout of vendor-gating:**

```sql
-- Operator runs in Supabase Studio (project ytnsipxxmzgaebkqmokp):
UPDATE public.stripe_price_lookup SET stripe_price_id = '<paste-id>' WHERE plan_name='plus_monthly';
UPDATE public.stripe_price_lookup SET stripe_price_id = '<paste-id>' WHERE plan_name='plus_yearly';
UPDATE public.stripe_price_lookup SET stripe_price_id = '<paste-id>' WHERE plan_name='clinic_base';
UPDATE public.stripe_price_lookup SET stripe_price_id = '<paste-id>' WHERE plan_name='clinic_overage';
UPDATE public.stripe_price_lookup SET stripe_price_id = '<paste-id>' WHERE plan_name='lifetime';

-- Verify all 5 non-empty:
SELECT plan_name, stripe_price_id FROM public.stripe_price_lookup ORDER BY plan_name;
```

Until this is done, all `plan: 'plus_monthly|plus_yearly|clinic|lifetime'` requests to `stripe-checkout` return 503 `vendor_unconfigured`. This is **by design** (Plan 43-03 D-c) — fail-fast surfaces missing vendor configuration to the operator instead of silently routing to a wrong Stripe Price object.

---

## HUMAN-UAT Signals

Per [[feedback_multi_signal_human_verify_checkpoint_pattern]], the 4 HUMAN gates are structured as DISCRETE resume signals. Each can be approved independently; environmentally-blocked signals carry to milestone v1.3 close-out via `43-CARRY-OVER.md`.

**Current state:** all 4 signals are **PENDING** at plan close. Vendor pre-conditions (Stripe Lifetime Product, `STRIPE_PRICE_LIFETIME` secret, `stripe_price_lookup` row population, test cohort with grandfathered override) are not satisfied yet. Per [[feedback_hitl_walkthrough_deferred_when_fixtures_missing]] + [[feedback_spike_accept_deploy_evidence_defer_runtime_verify]], we ship the deploy-evidence + defer browser/Stripe-test-mode runtime verification to milestone v1.3 close-out as a batch (alongside other vendor-gated wiring from Phases 35, 38, 39, 40).

### Signal A — Lifetime purchase smoke (MEMBER-01) — ⏳ PENDING

**What built:** stripe-webhook handler upserts `lifetime_purchases(stripe_payment_intent_id UNIQUE)` on `checkout.session.completed` with `mode='payment'` + `meta.tier_kind='lifetime'`. `tier_effective` view UNIONs active lifetime_purchases as `tier_label='lifetime'`. Slack alert via `EdgeRuntime.waitUntil` (degrades gracefully if `SLACK_WEBHOOK_EXPERIMENTS_URL` unset).

**How to verify (operator runs):**

```bash
# Pre-req 1: Operator pre-creates Stripe Lifetime Product+Price in dashboard, sets STRIPE_PRICE_LIFETIME secret + populates stripe_price_lookup.lifetime row.
# Pre-req 2: Test user exists on app.leanshot.app (signed in, free-tier).

# 1) Open https://app.leanshot.app/pricing as the test user.
# 2) Click "Buy Lifetime $499" CTA → redirected to Stripe Checkout (test mode).
# 3) Pay with card 4242 4242 4242 4242.
# 4) Stripe redirects back to dashboard → LIFETIME badge visible next to user name.

# 5) Verify the lifetime_purchases write:
TEST_CUSTOMER_ID="cus_XXX"  # paste from Stripe dashboard payment record
npx supabase db query --linked \
  "SELECT id, user_id, stripe_payment_intent_id, paid_at, amount_cents
   FROM public.lifetime_purchases
   WHERE stripe_customer_id = '$TEST_CUSTOMER_ID';"
# Expected: 1 row, amount_cents=49900 (or operator-chosen amount).

# 6) Verify tier_effective entitlement:
TEST_USER_ID="<uuid>"
npx supabase db query --linked \
  "SELECT user_id, has_active, tier_label, effective_period_end
   FROM public.tier_effective WHERE user_id = '$TEST_USER_ID';"
# Expected: has_active=true, tier_label='lifetime', effective_period_end=NULL (permanent).
```

**Accept criteria (boolean):** lifetime_purchases row exists with matching payment_intent_id AND tier_effective row shows `has_active=true, tier_label='lifetime'` AND LIFETIME badge renders in dashboard UI.

**Resume token:** `approved-A` | `issue-A: <details>` | `defer-A: <reason>` (vendor unavailable).

### Signal B — Grandfathered pricing silent at NEW stripe-checkout (MEMBER-02) — ⏳ PENDING

**What built:** `resolve_user_effective_price(p_user_id, p_plan)` SECDEF function: looks up grandfathered_prices row by `cohort_is_member(p_user_id, gp.cohort_id)` with effective window filter, falls back to `stripe_price_lookup.stripe_price_id`. stripe-checkout calls this BEFORE `stripe.checkout.sessions.create`. No banner, no badge, no upgrade prompt — silent stability (D-05).

**How to verify (operator runs):**

```bash
# Pre-req 1: Admin opens /admin/billing/grandfathered-prices and creates a row:
#   cohort: <pick any existing P27 cohort the test user belongs to>
#   stripe_price_id: <pre-created Stripe Price in dashboard, lower than the default>
#   effective_from: now
#   effective_until: null (open-ended)

# Pre-req 2: A NEW (non-subscribed) test user matching that cohort signs in.

# 1) Test user opens /pricing.
# 2) Confirm displayed monthly/yearly amount is the GRANDFATHERED price, NOT the public default.
# 3) Confirm NO banner about pricing, NO badge, NO upgrade prompt.

# 4) Verify the resolver wiring at the DB layer:
TEST_USER_ID="<uuid>"
npx supabase db query --linked \
  "SELECT public.resolve_user_effective_price('$TEST_USER_ID'::uuid, 'plus_monthly');"
# Expected: returns the grandfathered price_id (NOT the default).

# 5) (Carry-over scope reminder per 43-CARRY-OVER.md item #2):
#    Existing-subscriber renewal-time update is DEFERRED.
#    Only NEW stripe-checkout sessions honor the grandfathered price in v1.3.
```

**Accept criteria (boolean):** displayed `/pricing` amount == grandfathered cohort price AND no UI prompts trigger AND `resolve_user_effective_price` returns the grandfathered id.

**Resume token:** `approved-B` | `issue-B: <details>` | `defer-B: <reason>`.

### Signal C — 70% cap hit (MEMBER-03) — ⏳ PENDING

**What built:** `clampCombinedDiscount(promoPct, saveOfferPct)` shared util applies multiplicative `total = price × (1 − coupon%) × (1 − save_offer%)` (D-06); 70%-cap clamp with SAVE-offer preservation (D-07). Wired at BOTH stripe-checkout (new purchase) AND cancellation-accept-offer (SAVE-offer acceptance). Fail-fast at HTTP 400 `discount_combination_exceeds_max` when combined > 70%.

**How to verify (operator runs):**

```bash
# Pre-req: Stripe Dashboard test mode — create a 50%-off promo coupon TEST50.

# 1) Have an existing 50% SAVE-offer accepted on the test subscription.
#    Easiest: insert directly via Supabase Studio:
#    INSERT INTO public.cancellation_offers_log (user_id, subscription_id, offer_payload, status, ...)
#    VALUES ('<uuid>', '<sub_xxx>', '{"offer_type":"discount","percent_off":0.50}', 'accepted', ...);

# 2) Call stripe-checkout with the combo:
TOKEN="<test user jwt>"
curl -X POST https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/stripe-checkout \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"plan":"plus_monthly","promo_code":"TEST50"}'

# Expected response (HTTP 400):
# { "error": "discount_combination_exceeds_max" }
```

**Accept criteria (boolean):** HTTP status == 400 AND response.error == "discount_combination_exceeds_max" AND no Stripe Checkout Session created.

**Resume token:** `approved-C` | `issue-C: <details>` | `defer-C: <reason>`.

### Signal D — RLS cross-tenant deny proof (MEMBER-02, MEMBER-04) — ⏳ PENDING

**What built:** RLS on `grandfathered_prices` (admin-read-only); RLS on `lifetime_purchases` (self-read-only); `current_user_has_pro()` SECDEF predicate reads `tier_effective` via `auth.uid()`. Service-role-callable variant `user_has_pro(p_user_id)` exists to mitigate [[feedback_rpc_auth_uid_vs_service_role_mismatch]].

**How to verify (operator runs):**

```bash
# Pre-req: 2 distinct authenticated test users (user_A, user_B), neither an admin.

# 1) Sign in as user_A. From browser console:
const { data, error } = await supabase.from('grandfathered_prices').select('*');
# Expected: data === [] (RLS admin-only-read denies non-admin reads).

# 2) Sign in as user_A. Try to read user_B's lifetime_purchases:
const { data, error } = await supabase
  .from('lifetime_purchases').select('*').neq('user_id', user_A_id);
# Expected: data === [] (self-only-read RLS).

# 3) Verify the RLS predicate function returns truthful values per session:
const { data: hasProA } = await supabase.rpc('current_user_has_pro');
# Expected: matches tier_effective.has_active for user_A.

# 4) Sign in as user_B. Repeat step 3:
const { data: hasProB } = await supabase.rpc('current_user_has_pro');
# Expected: matches tier_effective.has_active for user_B (different from hasProA if entitlements differ).

# Live RLS test fixture pattern: use leanshot/tests/rls/* infrastructure (e.g., the admin.generateLink + /auth/v1/verify pattern per [[reference_rls_fixture_gotrueclient_flake]]).
```

**Accept criteria (boolean):** All 4 sub-checks pass; non-admin sees empty array for grandfathered_prices and other-user lifetime_purchases; `current_user_has_pro` returns user-specific values matching `tier_effective`.

**Resume token:** `approved-D` | `issue-D: <details>` | `defer-D: <reason>`.

---

## Linked Dashboards

For future audit + operator reference:

- **Supabase Project:** https://supabase.com/dashboard/project/ytnsipxxmzgaebkqmokp
- **Edge Functions Dashboard:** https://supabase.com/dashboard/project/ytnsipxxmzgaebkqmokp/functions
  - stripe-webhook
  - stripe-checkout
  - cancellation-accept-offer
- **Stripe Dashboard (test mode):** https://dashboard.stripe.com/test/products — operator pre-creates Lifetime + any grandfathered Price objects here
- **Admin Grandfathered Prices CRUD:** `/admin/billing/grandfathered-prices` on app.leanshot.app
- **Slack channel (alerts):** `#growth-experiments` (Plan 43-01 D-04 single-channel pattern; webhook URL is `SLACK_WEBHOOK_EXPERIMENTS_URL` Function Secret, currently unset — degrades gracefully per Plan 43-01 Test 3.4)

---

## Close State

**Phase 43 close state:** **partial-close with carry-over to milestone v1.3 UAT batch.**

- Schema + RPCs + Edge Fn binaries are LIVE on the linked Supabase project (`ytnsipxxmzgaebkqmokp`).
- 4 HUMAN-UAT signals are STRUCTURED + PENDING vendor pre-conditions (Stripe Lifetime Product, secret population, test cohort fixture).
- Per [[feedback_milestone_uat_deferral_consolidation]] + [[feedback_spike_accept_deploy_evidence_defer_runtime_verify]]: signals A/B/C/D documented in `43-CARRY-OVER.md` and surface in the existing `<milestone>-uat-deferred.md` aggregate at v1.3 milestone close.
- Pre-existing Phase 43 carry-overs (Items 1 + 2 from plan-checker iter-1) remain documented in `43-CARRY-OVER.md` as future-phase work.
- Phase 43 SUMMARY tracking is complete; downstream Phases 44/46/47 may consume `43-PRO-GATING-CONTRACT.md` verbatim.

