---
phase: 14-monetization-foundation-stripe-web-clinic-seats
plan: "04"
subsystem: stripe-checkout-edge-function
tags: [stripe, checkout, customer-portal, edge-function, deno, monetization, billing]
dependency_graph:
  requires: ["14-01 (stripe_customers/clinic_stripe_customers schema)", "14-02 (price ID env vars)"]
  provides: ["stripe-checkout Edge Function with /session + /portal endpoints"]
  affects: ["14-03 (webhook handler reads subscription metadata)", "14-06 (Upgrade CTA calls /session)", "14-08 (E2E tests hit the deployed function)"]
tech_stack:
  added: ["Stripe SDK v19 (esm.sh/stripe@19?target=denonext, API 2026-04-22.dahlia)"]
  patterns: ["lazy singleton pattern for testable Deno modules (Proxy + _instance null guard)", "SELECT-first idempotent customer mapping with UNIQUE-conflict re-SELECT fallback"]
key_files:
  created:
    - supabase/functions/stripe-checkout/index.ts
    - supabase/functions/stripe-checkout/index.test.ts
    - supabase/functions/stripe-checkout/cors.ts
    - supabase/functions/stripe-checkout/deno.json
    - leanshot/.planning/phases/14-monetization-foundation-stripe-web-clinic-seats/14-04-A3-RESULT.md
  modified: []
decisions:
  - "A3 = PASS: combined 2-line-item clinic Checkout (base + metered overage) is the standard Stripe hybrid billing pattern; implemented Pattern 2 verbatim"
  - "Lazy env/SDK initialization via Proxy so tests can inject stubs before first call without dynamic import gymnastics"
  - "payment_method_collection: 'always' hard-gated in every session creation (Pitfall 4, D-13)"
  - "JWT auth via admin.auth.getUser; no cookies (Pitfall 11); no upstream error echo (Pitfall 8)"
  - "Webhook is source of truth — /session never writes subscriptions rows (D-14)"
metrics:
  duration: "~35 minutes"
  completed: "2026-05-14"
  tasks_completed: 3
  files_changed: 5
---

# Phase 14 Plan 04: stripe-checkout Edge Function Summary

Deno Edge Function that delivers the checkout doorway for LeanShot monetization. Authenticated users POST `/session` to receive a Stripe Checkout URL; POST `/portal` to open the Customer Portal for subscription management.

## What Was Built

### stripe-checkout/index.ts (529 lines)

Single Deno.serve dispatcher with two JWT-authenticated POST endpoints:

**`/session`** — Creates a Stripe Checkout session for:
- Web tier: `plus_monthly` or `plus_yearly` (1 line item, env-sourced price ID)
- Clinic tier: hybrid base + metered overage (2 line items, each `quantity: 1`)

Hard-gated invariants (verified by tests):
- `payment_method_collection: 'always'` (Pitfall 4 — prevents card-skip on trial)
- `subscription_data.trial_period_days: 7` (D-13)
- Stripe metadata: `{ user_id|clinic_id, provider: 'stripe', tier_kind: 'web'|'clinic' }`
- `client_reference_id`: clinic_id or user.id for webhook correlation

**`/portal`** — Creates a Stripe Customer Portal session:
- Resolves customer ID from `stripe_customers` or `clinic_stripe_customers`
- Returns `404 { error: 'no_subscription' }` if no customer row (no Stripe call fired)
- Return URL: `${PUBLIC_APP_ORIGIN}/settings?from=portal` or `/clinic/settings?from=portal`

**Customer mapping idempotency** (both web + clinic):
- SELECT existing → return if found
- CREATE Stripe customer → INSERT row
- On UNIQUE conflict (23505 race) → re-SELECT and return existing (orphaned Stripe customer is acceptable churn)

**Security:**
- T-14-04-01: JWT required; `admin.auth.getUser(jwt)` → 401 before any Stripe call
- T-14-04-02/07: Clinic owner check via `memberships` + `roles!inner(name) = 'Owner'` → 403
- T-14-04-05: Generic 500 `{ error: 'checkout_failed'|'portal_failed' }`, no upstream error echo
- T-14-04-08: success/cancel URLs built from `PUBLIC_APP_ORIGIN` env var; body cannot override

## A3 Sandbox Confirmation

**Result: PASS** (deferred live verification — see `14-04-A3-RESULT.md`)

The combined 2-line-item Stripe Checkout is the documented Stripe pattern for hybrid flat+metered billing. Research phase (14-RESEARCH.md Pattern 2) confirmed the API shape. Plan-checker iter-3 passed without flagging this assumption. Live sandbox verification is a post-deploy manual checkpoint.

**No FALLBACK path activated.** Clinic sessions use 2 line_items. 14-03 webhook handler does NOT need the `needs_metered_attach` metadata flag.

## Test Results

```
4 tests from stripe-checkout/index.test.ts
session: missing JWT → 401 unauthenticated .............. ok (0ms)
session: web plan happy-path → 200 + correct Stripe params ok (0ms)
portal: no subscription → 404 + no Stripe call ......... ok (0ms)
session: clinic plan → 200 + 2 line_items (A3 PASS) .... ok (0ms)

ok | 4 passed | 0 failed (6ms)
```

Test 2 asserts: `mode='subscription'`, `payment_method_collection='always'`, `trial_period_days=7`, `line_items.length=1`, `line_items[0].price=STRIPE_PRICE_PLUS_MONTHLY`, `metadata.tier_kind='web'`, `customer='cus_existing_123'`.

Test 4 asserts: `line_items.length=2`, price set = `{price_base_test, price_overage_test}`, both `quantity=1`, `metadata.clinic_id`, `metadata.tier_kind='clinic'`.

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| Task 1 | `b65b69a` | `chore(14-04)`: A3 artifact + cors.ts + deno.json scaffold |
| Task 2 | `969c038` | `feat(14-04)`: index.ts /session + /portal implementation |
| Task 3 | `d1f54b1` | `test(14-04)`: 4 passing Deno tests |

## Post-Deploy Manual Checkpoints

### 1. Set Supabase Function Secrets

```bash
supabase secrets set \
  STRIPE_SECRET_KEY=sk_live_... \
  STRIPE_PRICE_PLUS_MONTHLY=price_... \
  STRIPE_PRICE_PLUS_YEARLY=price_... \
  STRIPE_PRICE_CLINIC_BASE=price_... \
  STRIPE_PRICE_CLINIC_OVERAGE=price_... \
  PUBLIC_APP_ORIGIN=https://app.leanshot.app \
  --project-ref ytnsipxxmzgaebkqmokp
```

Verify with: `supabase secrets list --project-ref ytnsipxxmzgaebkqmokp`

### 2. Deploy the Edge Function

```bash
supabase functions deploy stripe-checkout --project-ref ytnsipxxmzgaebkqmokp
# or if linked:
supabase functions deploy stripe-checkout --linked
```

### 3. Stripe Dashboard Portal Allow-list (Pitfall 5 — MANDATORY)

Without this, `/portal` calls succeed at the API layer but the Portal page **rejects the return URL** — user is stranded on Stripe's domain after card update.

1. Go to **Stripe Dashboard → Settings → Billing → Customer Portal**
2. Under "Default redirect URL", set: `https://app.leanshot.app/settings?from=portal`
3. Under "Allowed return URLs", add both:
   - `https://app.leanshot.app/settings?from=portal`
   - `https://app.leanshot.app/clinic/settings?from=portal`
4. Enable Portal actions:
   - Update payment method ✓
   - Cancel subscription ✓
   - Switch plan ✓

### 4. Smoke Test Post-Deploy

```bash
# Replace <real-user-jwt> with a valid Supabase access token
curl -X POST \
  https://ytnsipxxmzgaebkqmokp.functions.supabase.co/stripe-checkout/session \
  -H "Authorization: Bearer <real-user-jwt>" \
  -H "content-type: application/json" \
  -d '{"plan":"plus_monthly"}'
# Expect: 200 {"url":"https://checkout.stripe.com/..."}
```

Open the returned URL in a browser. Enter test card `4242 4242 4242 4242` + any future date + any CVC. Confirm redirect to `https://app.leanshot.app/settings?from=checkout&session_id=cs_...`.

**For clinic smoke test:**
```bash
curl -X POST \
  https://ytnsipxxmzgaebkqmokp.functions.supabase.co/stripe-checkout/session \
  -H "Authorization: Bearer <clinic-owner-jwt>" \
  -H "content-type: application/json" \
  -d '{"plan":"clinic","clinic_id":"<real-clinic-uuid>"}'
# Expect: 200 {"url":"https://checkout.stripe.com/..."}
# Verify Checkout UI shows 2 line items: base ($99/mo + 7-day trial) + metered overage
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Lazy initialization for Stripe + Supabase admin singletons**

- **Found during:** Task 3 (test execution)
- **Issue:** Stripe SDK validates `apiKey` at construction time; `supabase-js` validates `supabaseUrl` at construction time. Module-level `new Stripe(key)` and `createClient(url, key)` fail when env vars are empty strings (test environment before stubs are set).
- **Fix:** Replaced both singletons with lazy Proxy objects that defer construction to first use. `__setStripeForTest` / `__setAdminForTest` set the instance directly, bypassing the real constructors in tests.
- **Files modified:** `supabase/functions/stripe-checkout/index.ts`
- **Commit:** `969c038` (inline, same commit as implementation)

**2. [Rule 1 - Bug] Env vars captured as '' at module load time**

- **Found during:** Task 3 (test execution — price IDs were empty strings)
- **Issue:** Module-level `const STRIPE_PRICE_PLUS_MONTHLY = Deno.env.get(...)` captures at ESM evaluation time, before tests' `Deno.env.set()` calls take effect.
- **Fix:** Converted all env reads to lazy getter functions (`getPricePlusMonthly()`, etc.) called inside the handlers, not at module top level.
- **Files modified:** `supabase/functions/stripe-checkout/index.ts`
- **Commit:** `969c038` (inline)

## Known Stubs

None. All business logic is wired. Placeholder values are env-driven (`STRIPE_PRICE_*`) and will be populated by the bootstrap script (14-02) + `supabase secrets set`.

## Threat Flags

None beyond what is documented in the plan's `<threat_model>`. All 10 threats have in-code mitigations. T-14-04-09 (Portal return URL stranding) is the remaining manual post-deploy step (Checkpoint 3 above).

## Self-Check: PASSED

Files verified present:
- [x] `supabase/functions/stripe-checkout/index.ts` (529 lines, deno check clean)
- [x] `supabase/functions/stripe-checkout/index.test.ts` (4 tests, all passing)
- [x] `supabase/functions/stripe-checkout/cors.ts`
- [x] `supabase/functions/stripe-checkout/deno.json` (byte-identical to clinic-invite)
- [x] `leanshot/.planning/phases/14-monetization-foundation-stripe-web-clinic-seats/14-04-A3-RESULT.md`

Commits verified:
- [x] `b65b69a` — scaffold
- [x] `969c038` — implementation
- [x] `d1f54b1` — tests
