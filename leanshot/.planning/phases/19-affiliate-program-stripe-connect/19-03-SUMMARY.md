---
phase: 19
plan: 3
subsystem: stripe-connect-onboarding
tags: [edge-fn, stripe-connect, wave-2, jit-account-link, state-machine, jwt-gated]
requirements: [AFF-03]
dependency_graph:
  requires:
    - Phase 14 stripe-checkout (Stripe SDK v19 + 2026-04-22.dahlia API pin pattern)
    - Phase 19 Plan 19-01 (affiliates table with stripe_connect_account_id + stripe_payouts_enabled columns)
    - Phase 19 Plan 19-02 (config.toml first writer; this plan appends after)
    - Phase 12 stripe-done vendor checkpoint (STRIPE_SECRET_KEY Function Secret; deferred to Wave 6 for live capability check)
  provides:
    - JWT-gated POST /stripe-connect-onboard (creates Stripe Connect Express account + JIT account_link.url)
    - JWT-gated GET /partner-account-status (4-state machine + payouts_enabled mirror)
    - Wave-0 D-37 #2 smoke script (committed in prior turn as 6682bdb; live capability check DEFERRED to Wave 6)
  affects:
    - Plan 19-06 partner-dashboard StripeConnectOnboardingCard (consumes both endpoints)
    - Plan 19-09 monthly payout cron (reads affiliates.stripe_payouts_enabled mirror set by status endpoint)
tech_stack:
  added:
    - Stripe SDK v19 (esm.sh + denonext target) — pinned to match Phase 14
    - Stripe API version 2026-04-22.dahlia — one API version project-wide
  patterns:
    - Lazy Stripe + admin init via Proxy + __setXForTest seam (clone from Phase 14 stripe-checkout)
    - JIT account_link.url generation (Pitfall 6 — never persist 5-min-TTL URL)
    - 4-state machine derived from Stripe acct fields (restricted > active > needs_info > pending)
    - V7 PII-safe error responses (catch-all returns { error: 'internal' }; Stripe error message NEVER echoed)
key_files:
  created:
    - /Users/karstenhaldan/minisite/supabase/functions/stripe-connect-onboard/index.ts
    - /Users/karstenhaldan/minisite/supabase/functions/stripe-connect-onboard/index.test.ts
    - /Users/karstenhaldan/minisite/supabase/functions/stripe-connect-onboard/cors.ts
    - /Users/karstenhaldan/minisite/supabase/functions/stripe-connect-onboard/deno.json
    - /Users/karstenhaldan/minisite/supabase/functions/partner-account-status/index.ts
    - /Users/karstenhaldan/minisite/supabase/functions/partner-account-status/index.test.ts
    - /Users/karstenhaldan/minisite/supabase/functions/partner-account-status/cors.ts
    - /Users/karstenhaldan/minisite/supabase/functions/partner-account-status/deno.json
  modified:
    - /Users/karstenhaldan/minisite/supabase/config.toml (appended two [functions.*] blocks AFTER 19-02 affiliate-attribute block)
  previously_committed:
    - /Users/karstenhaldan/minisite/leanshot/scripts/wave-0-stripe-transfers-capability.sh (committed in prior executor turn as 6682bdb)
decisions:
  - "JIT account_link mint per request; never persisted (Pitfall 6 — 5-min TTL + single-use)"
  - "Stripe SDK pinned to v19 + 2026-04-22.dahlia API to match Phase 14 stripe-checkout/stripe-webhook (one API version per project)"
  - "esm.sh + denonext target for Stripe SDK (matches stripe-checkout — plan-prompt-suggested 'npm:stripe@19' override rejected because analog uses esm.sh)"
  - "capabilities.transfers.requested=true is load-bearing for Plan 19-09 transfers.create cron (D-37 #2)"
  - "DB UPDATE failure after accounts.create does NOT fail the call (the account exists in Stripe; the next click retries the write — worse outcome would be a dangling Stripe account with no DB pointer)"
  - "deriveState: 4-state machine with disabled_reason > active > needs_info > pending precedence (matches UI-SPEC card)"
  - "stripe_payouts_enabled mirror updated on every status read (Pitfall 7 — cron tolerates one stale tick; always reads cached value to avoid Stripe rate-limit during monthly payout sweep)"
  - "Task 1 (Wave-0 D-37 #2 live capability check) DEFERRED to Wave 6 alongside Plan 19-02's D-37 #1 Vercel-rewrite smoke (script already committed in prior turn; live check requires production STRIPE_SECRET_KEY + STRIPE_CONNECT_RETURN/REFRESH_URL env vars not yet set)"
metrics:
  duration: "~25 minutes"
  completed_date: "2026-05-15"
  tests_added: 13 (6 stripe-connect-onboard + 7 partner-account-status)
  files_created: 8
  files_modified: 1
---

# Phase 19 Plan 19-03: Stripe Connect Onboarding Edge Functions — Summary

JWT-gated `stripe-connect-onboard` POST creates Stripe Connect Express accounts with `transfers.requested=true` and mints fresh 5-minute account_link URLs on every call (Pitfall 6 — never persisted). Sister GET endpoint `partner-account-status` retrieves the Stripe account, derives a 4-state machine for the UI card, and mirrors `payouts_enabled` onto the affiliate row so Plan 19-09's monthly cron can filter without an extra Stripe roundtrip. Wave-0 smoke script for D-37 #2 transfers-capability check was committed in a prior executor turn (6682bdb); the live capability check is deferred to Wave 6 alongside Plan 19-02's Vercel-rewrite smoke.

## What Shipped

### Function 1: `stripe-connect-onboard` (POST, verify_jwt=true)

**File:** `supabase/functions/stripe-connect-onboard/index.ts` (~210 LOC)

Handler flow:
1. Extract Bearer JWT; resolve via `admin.auth.getUser` → 401 on failure.
2. SELECT `id, status, stripe_connect_account_id` FROM `public.affiliates` WHERE `user_id = auth.uid()`.
   - No row → `404 not_an_affiliate`.
   - `status !== 'approved'` → `403 not_approved` (D-25).
3. If `stripe_connect_account_id` is null, call `stripe.accounts.create({ type: 'express', country: 'US', capabilities: { transfers: { requested: true } }, business_type: 'individual', metadata: { affiliate_id, leanshot_user_id, leanshot_phase: '19' } })` and UPDATE the affiliate row.
4. ALWAYS call `stripe.accountLinks.create({ account, refresh_url: '${RETURN_URL}/partner/payouts?refresh=1', return_url: '${RETURN_URL}/partner/payouts?from=connect', type: 'account_onboarding' })`.
5. Return `{ url }` — body is strictly one field (V7 PII safety; no account id leak).

Error handling: catch-all logs `err.message` to console.error and returns `{ error: 'internal' }`. Stripe error messages NEVER appear in response bodies (Pattern S3, Threat T-19-03-I).

Idempotency: if the affiliate already has `stripe_connect_account_id`, `accounts.create` is NOT called — the partner-dashboard "Resume onboarding" button can be clicked any number of times without spawning duplicate Connect accounts.

### Function 2: `partner-account-status` (GET, verify_jwt=true)

**File:** `supabase/functions/partner-account-status/index.ts` (~205 LOC)

Handler flow:
1. JWT auth (same shape).
2. SELECT `id, stripe_connect_account_id` FROM `public.affiliates`.
3. No row or no account id → return `{ state: 'pending', requirements: [], disabled_reason: null }`.
4. `stripe.accounts.retrieve(stripe_connect_account_id)`.
5. `deriveState(acct)` (exported pure helper):
   - `requirements.disabled_reason` set → `'restricted'`
   - `charges_enabled && payouts_enabled` → `'active'`
   - `currently_due.length > 0 && details_submitted` → `'needs_info'`
   - else → `'pending'`
6. UPDATE `affiliates.stripe_payouts_enabled = acct.payouts_enabled` (Pitfall 7 — cron mirror).
7. Return `{ state, requirements: acct.requirements.currently_due, disabled_reason }`.

### State Machine Truth Table

| `charges_enabled` | `payouts_enabled` | `details_submitted` | `currently_due` | `disabled_reason` | → `state`    |
| ----------------- | ----------------- | ------------------- | --------------- | ----------------- | ------------ |
| any               | any               | any                 | any             | set               | `restricted` |
| true              | true              | any                 | any             | null              | `active`     |
| any               | any               | true                | non-empty       | null              | `needs_info` |
| any               | any               | false               | any             | null              | `pending`    |
| any               | any               | true                | empty           | null              | `pending`    |

All 5 rows are exercised by the `deriveState` unit test (Test 0).

### Tests — 13/13 Passing

```
running 6 tests from ./supabase/functions/stripe-connect-onboard/index.test.ts
onboard: missing JWT → 401 unauthenticated ............................. ok
onboard: no affiliate row → 404 not_an_affiliate (no Stripe call) ...... ok
onboard: status=pending → 403 not_approved (no Stripe call) ............ ok
onboard: approved + no account id → creates account with transfers
         .requested + persists + mints link ............................ ok
onboard: approved + existing account id → idempotent, only mints link .. ok
onboard: Stripe accounts.create throws → 500 internal (no Stripe error
         echoed) ........................................................ ok

running 7 tests from ./supabase/functions/partner-account-status/index.test.ts
deriveState: 4-branch state machine .................................... ok
status: missing JWT → 401 unauthenticated .............................. ok
status: no affiliate row → 200 { state: pending, requirements: [] } .... ok
status: disabled_reason set → state restricted ......................... ok
status: charges+payouts enabled → state active; affiliates
        .stripe_payouts_enabled UPDATEd to true ........................ ok
status: currently_due + details_submitted → state needs_info ........... ok
status: details_submitted=false → state pending ........................ ok

ok | 13 passed | 0 failed (57ms)
```

`deno check` clean on both `index.ts` files.

### Idempotency Proof

Test 5 (`onboard: approved + existing account id → idempotent, only mints link`):
- Spy injected as `accounts.create` throws if called.
- Affiliate row pre-seeded with `stripe_connect_account_id: 'acct_existing_77'`.
- Result: `accounts.create.calls.length === 0`; `accountLinks.create.calls[0][0].account === 'acct_existing_77'`; no DB UPDATE attempted; response = `{ url }`.

### config.toml Append

```toml
[functions.affiliate-attribute]      # ← Plan 19-02, first writer
verify_jwt = false

[functions.stripe-connect-onboard]   # ← Plan 19-03 (this plan), appended
verify_jwt = true

[functions.partner-account-status]   # ← Plan 19-03 (this plan), appended
verify_jwt = true
```

Both `verify_jwt = true` declarations are defensive — `true` is the Supabase CLI default per `[[reference-supabase-edge-function-deploy]]`, but explicit declarations document intent and survive any future default-flip in upstream tooling.

## Env-Var Inventory

| Env Var                        | Source                                     | Used By                                  | Deferred to Wave 6? |
| ------------------------------ | ------------------------------------------ | ---------------------------------------- | ------------------- |
| `SUPABASE_URL`                 | Supabase platform default                  | Both functions                           | No (always set)     |
| `SUPABASE_SERVICE_ROLE_KEY`    | Supabase platform default                  | Both functions                           | No (always set)     |
| `STRIPE_SECRET_KEY`            | Phase 12 stripe-done vendor checkpoint     | Both functions                           | No (already set)    |
| `STRIPE_CONNECT_RETURN_URL`    | NEW — Wave 6 `supabase secrets set --linked` | `stripe-connect-onboard` accountLinks.create | **YES**           |
| `STRIPE_CONNECT_REFRESH_URL`   | NEW — Wave 6 `supabase secrets set --linked` | `stripe-connect-onboard` accountLinks.create | **YES**           |

The two `STRIPE_CONNECT_*_URL` vars have hardcoded `'https://leanshot.app'` fallbacks in the function (`env(name, fallback)` helper), so even if Wave 6 forgets to set them, the function returns a syntactically valid (though pointing-at-prod) URL pair. Wave 6 should set them explicitly for staging/preview environments.

## Wave-0 D-37 #2 Smoke — DEFERRED to Wave 6

Per orchestrator instruction: Task 1 was already committed in a prior executor turn (`6682bdb` on worktree-agent-ac808e4bf762d0f0d, merged as `c650b3f`). The script lives at `leanshot/scripts/wave-0-stripe-transfers-capability.sh` and is ready to run. The **live capability check** is deferred to Wave 6 deploy time alongside Plan 19-02's D-37 #1 Vercel-rewrite smoke because:

1. The smoke requires a live `STRIPE_SECRET_KEY` (Function Secret — not surfaced to local dev).
2. It also verifies `STRIPE_CONNECT_RETURN_URL` / `STRIPE_CONNECT_REFRESH_URL` Function Secrets exist, which are NEW and only set at Wave 6.
3. The capability is requested (not required to already be active) when `accounts.create({ capabilities: { transfers: { requested: true } } })` runs in Test 4 above — Stripe begins activating the capability asynchronously; only Plan 19-09's `transfers.create` cron strictly requires it to be `'active'`.

This deferral is safe: between merge and Wave 6, no code path calls `transfers.create`. The 5 plans between (19-03 through 19-09) are all read-side or UI-side work.

## Pitfalls Verified

| Pitfall                                                                              | How verified                                                            |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| **6: account_link.url stale after 5 min**                                            | JIT mint every POST; URL never stored in `affiliates` row. Test 4 + 5 assert. |
| **7: stale `stripe_payouts_enabled` mirror**                                         | UPDATE fires on every status read. Test 4 (active) writes `true`, Test 5 (needs_info) writes `false`. |
| **V7 / Pattern S3: Stripe error message echo**                                       | Test 6: spy throws `'stripe-secret-error-do-not-echo'`, response body asserted not to contain `'stripe-secret'`. |
| **T-19-03-E: unapproved affiliate gets onboarding link**                             | Test 3: `status='pending'` → 403; `accounts.create` + `accountLinks.create` spies asserted uncalled. |

## Deviations from Plan

### Auto-fixed Issues

**1. [Plan instruction conflict — resolved by following analog]**
- **Issue:** Plan prompt's `<parallel_execution>` block said "Stripe SDK init pattern: clone from stripe-checkout/index.ts... Use `import Stripe from 'npm:stripe@19'`". But the actual stripe-checkout analog at line 49 uses `import Stripe from 'https://esm.sh/stripe@19?target=denonext';` — NOT `npm:`.
- **Resolution:** Followed the analog (esm.sh + denonext). Reasoning: Plan 19-03 PLAN.md task 2 step 1 explicitly says "Module-level imports: `import Stripe from 'https://esm.sh/stripe@19?target=denonext';`" — the PLAN is authoritative over the dispatch prompt. The esm.sh form is proven in production on stripe-checkout + stripe-webhook.
- **Files affected:** Both `index.ts` files.
- **Tracked as:** Cross-document consistency note; not a Rule N deviation since it followed plan-text precedence.

### No Other Deviations

No Rule 1 (bug), Rule 2 (missing critical functionality), or Rule 3 (blocking) fixes were needed. The plan was executed as written.

## Threat Surface Scan

No NEW threat surface introduced beyond what's already cataloged in PLAN 19-03 `<threat_model>`. All 7 STRIDE rows (S/T/T/R/I/D/E/PSV) have their mitigations realized in code:

- **T-19-03-S** (stale URL phishing) → JIT mint + 5-min TTL enforced by Stripe.
- **T-19-03-T** (onboard as another affiliate) → `auth.getUser(jwt)` → `affiliates WHERE user_id = auth.uid()` (caller cannot inject affiliate_id).
- **T-19-03-I** (Stripe error leak) → `{ error: 'internal' }` only; Test 6 asserts.
- **T-19-03-E** (unapproved gets link) → Test 3 asserts 403 + no Stripe call.
- **T-19-03-PSV** (STRIPE_SECRET_KEY in logs) → `err.message` only in console.error; secret never templated.

No additional threat flags.

## Self-Check: PASSED

Files verified present:
- `supabase/functions/stripe-connect-onboard/index.ts` — FOUND
- `supabase/functions/stripe-connect-onboard/index.test.ts` — FOUND
- `supabase/functions/stripe-connect-onboard/cors.ts` — FOUND
- `supabase/functions/stripe-connect-onboard/deno.json` — FOUND
- `supabase/functions/partner-account-status/index.ts` — FOUND
- `supabase/functions/partner-account-status/index.test.ts` — FOUND
- `supabase/functions/partner-account-status/cors.ts` — FOUND
- `supabase/functions/partner-account-status/deno.json` — FOUND
- `supabase/config.toml` — MODIFIED (two `[functions.*]` blocks appended)

Tests:
- 13/13 Deno tests pass (`deno test ... --allow-env --allow-net`).
- `deno check` clean on both `index.ts` files.

Plan completion:
- Task 1 (Wave-0 smoke script): pre-committed as `6682bdb` (in main).
- Task 2 (this commit): complete.
- Live D-37 #2 capability check: deferred to Wave 6 (documented above).

## Handoff to Plan 19-06

The partner-dashboard `StripeConnectOnboardingCard` (Plan 19-06) should:
1. Call `fetch('/functions/v1/stripe-connect-onboard', { method: 'POST', headers: { Authorization: 'Bearer ' + session.access_token } })` when the user clicks Connect / Resume.
2. On 200 `{ url }`, `window.location.href = url` (Stripe-hosted onboarding).
3. On `/partner/payouts?from=connect` return-from-Stripe, call `fetch('/functions/v1/partner-account-status', { method: 'GET', headers: { Authorization: 'Bearer ' + session.access_token } })`.
4. Poll the status endpoint every 10 min + on `window.focus`.
5. Map `body.state` to the 4 card UI states per UI-SPEC.

The 5-min URL TTL means the partner-dashboard should NEVER cache the response or expose the URL via copy/paste — direct navigation only.
