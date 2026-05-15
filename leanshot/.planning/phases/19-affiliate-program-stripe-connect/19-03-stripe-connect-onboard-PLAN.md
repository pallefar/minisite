---
phase: 19
plan: 3
type: execute
wave: 2
depends_on: [2]
files_modified:
  - /Users/karstenhaldan/minisite/supabase/functions/stripe-connect-onboard/index.ts
  - /Users/karstenhaldan/minisite/supabase/functions/stripe-connect-onboard/index.test.ts
  - /Users/karstenhaldan/minisite/supabase/functions/stripe-connect-onboard/cors.ts
  - /Users/karstenhaldan/minisite/supabase/functions/stripe-connect-onboard/deno.json
  - /Users/karstenhaldan/minisite/supabase/functions/partner-account-status/index.ts
  - /Users/karstenhaldan/minisite/supabase/functions/partner-account-status/index.test.ts
  - /Users/karstenhaldan/minisite/supabase/functions/partner-account-status/deno.json
  - /Users/karstenhaldan/minisite/supabase/config.toml
  - /Users/karstenhaldan/minisite/leanshot/scripts/wave-0-stripe-transfers-capability.sh
autonomous: false
requirements: [AFF-03]
tags: [edge-fn, stripe-connect, wave-0]
user_setup:
  - service: stripe-connect-express
    why: "AFF-03 — Stripe Connect Express W-9/W-8BEN/1099-NEC hosted onboarding"
    env_vars:
      - name: STRIPE_SECRET_KEY
        source: "Already provisioned by Phase 12 stripe-done checkpoint (Supabase Function Secret)"
      - name: STRIPE_CONNECT_REFRESH_URL
        source: "NEW — set to https://leanshot.app via Supabase Dashboard → Functions → Secrets"
      - name: STRIPE_CONNECT_RETURN_URL
        source: "NEW — set to https://leanshot.app via Supabase Dashboard → Functions → Secrets"
    dashboard_config:
      - task: "Verify Stripe Connect `transfers` capability is ENABLED on platform (Wave-0 D-37 #2 smoke)"
        location: "Stripe Dashboard → Settings → Connect → Platform settings → Capabilities"

must_haves:
  truths:
    - "Wave-0 smoke confirms Stripe platform's `transfers` capability is active (D-37 #2)"
    - "POST /stripe-connect-onboard with affiliate JWT creates a Stripe Express account (with capabilities.transfers.requested=true) if none exists, then mints a fresh one-time account_link.url and returns it"
    - "Stale account_link URLs are NEVER persisted (Pitfall 6 — 5-min TTL; JIT generation per call)"
    - "GET /partner-account-status returns the affiliate's current Connect state (pending/needs_info/active/restricted) consumed by StripeConnectOnboardingCard in Plan 19-06"
  artifacts:
    - path: "/Users/karstenhaldan/minisite/supabase/functions/stripe-connect-onboard/index.ts"
      provides: "JWT-gated POST that creates account + account_link (AFF-03)"
      contains: "accountLinks.create"
    - path: "/Users/karstenhaldan/minisite/supabase/functions/partner-account-status/index.ts"
      provides: "JWT-gated GET that returns Stripe account.requirements + payouts_enabled (UI-SPEC state machine consumer)"
      contains: "accounts.retrieve"
    - path: "/Users/karstenhaldan/minisite/leanshot/scripts/wave-0-stripe-transfers-capability.sh"
      provides: "Wave-0 smoke (D-37 #2) — verifies platform has transfers capability before any transfers.create call"
      contains: "transfers"
  key_links:
    - from: "partner dashboard StripeConnectOnboardingCard (Plan 19-06)"
      to: "stripe-connect-onboard"
      via: "fetch('/functions/v1/stripe-connect-onboard', { method: 'POST' })"
      pattern: "stripe-connect-onboard"
    - from: "partner dashboard StripeConnectOnboardingCard (Plan 19-06)"
      to: "partner-account-status"
      via: "10-min poll + focus-trigger"
      pattern: "partner-account-status"
---

<objective>
Ship the two Stripe Connect Edge Functions that drive the affiliate's tax-form onboarding flow: `stripe-connect-onboard` (creates account + JIT `account_link.url`) and `partner-account-status` (state-machine read for the UI card). Includes Wave-0 smoke (D-37 #2) — verifies Phase 12's `stripe-done` vendor checkpoint enabled the `transfers` capability BEFORE any plan attempts `transfers.create`.

Purpose: AFF-03 (W-9/W-8BEN/1099-NEC via Stripe-hosted). We never build tax-form UI. JIT link generation mitigates Pitfall 6 (5-min URL TTL).

Output: 2 Edge Functions (index.ts + index.test.ts + deno.json each) + cors.ts shared + config.toml updates + Wave-0 smoke script.

**Iter-1 revision (BL-4, 2026-05-15):** Pushed from Wave 1 to Wave 2 with `depends_on: [2]` because this plan appends two `[functions.*]` blocks to `supabase/config.toml` — same file as Plan 19-02's append. Wave-1 parallel writes would conflict; sequencing via `depends_on` is the BL-4-recommended fix (option a). The Wave-0 D-37 #2 smoke (Stripe transfers capability) is unaffected by the wave bump — it runs at Wave 2 start, still before any `transfers.create` call (those land in Plan 19-09 / Wave 5).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@/Users/karstenhaldan/minisite/leanshot/.planning/phases/19-affiliate-program-stripe-connect/19-CONTEXT.md
@/Users/karstenhaldan/minisite/leanshot/.planning/phases/19-affiliate-program-stripe-connect/19-CONTEXT-ADDENDUM-research.md
@/Users/karstenhaldan/minisite/leanshot/.planning/phases/19-affiliate-program-stripe-connect/19-RESEARCH.md
@/Users/karstenhaldan/minisite/leanshot/.planning/phases/19-affiliate-program-stripe-connect/19-PATTERNS.md
@/Users/karstenhaldan/minisite/supabase/functions/stripe-checkout/index.ts
@/Users/karstenhaldan/minisite/supabase/functions/stripe-webhook/index.ts

<interfaces>
From `supabase/functions/stripe-checkout/index.ts` (analog):
- Module-level lazy Stripe init at lines 49, 86-94: `_stripeInstance = new Stripe(getStripeSecretKey(), { apiVersion: '2026-04-22.dahlia', httpClient: Stripe.createFetchHttpClient() })`
- JWT-resolve pattern at lines 290-298: `const jwt = jwtFromReq(req); const { data: userData } = await adminInstance.auth.getUser(jwt);`
- Helper for service-role admin client at lines 112-143 (with Proxy wrapper for test-time `__setAdminForTest` override)

From CONTEXT D-08: `commission_rate_cents = 1000` default; affiliate row identified by `auth.uid()`.
From CONTEXT D-37 #2: BEFORE any `transfers.create` call, verify `stripe.accounts.retrieve(platform_id, { expand: ['capabilities'] })` returns `capabilities.transfers === 'active'`. If not, enable in dashboard or via `stripe.accounts.update({ requested_capabilities: ['transfers'] })`.
From RESEARCH Pitfall 6: `account_link.url` is single-use + 5-min TTL — JIT generation, never persist.
</interfaces>
</context>

<tasks>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 1: Wave-0 smoke — Stripe transfers capability + onboarding env vars (D-37 #2)</name>
  <what-built>
    `/Users/karstenhaldan/minisite/leanshot/scripts/wave-0-stripe-transfers-capability.sh` — bash script that calls the Stripe REST API to confirm the platform's `transfers` capability is active. Per [[feedback-verify-human-uat-via-cli]], we prefer CLI verification over paste-back.
  </what-built>
  <how-to-verify>
1. Author + run the smoke script `/Users/karstenhaldan/minisite/leanshot/scripts/wave-0-stripe-transfers-capability.sh` containing:
   ```
   #!/usr/bin/env bash
   set -euo pipefail
   : "${STRIPE_SECRET_KEY:?Set STRIPE_SECRET_KEY from Phase 12 stripe-done checkpoint}"
   # Check PLATFORM account capabilities (singular /v1/account, not /v1/accounts which lists CONNECTED accounts)
   # BL-13: /v1/accounts (plural) returns the list of connected accounts, NOT the platform's own capabilities.
   # The platform account self-lookup is /v1/account (singular) and exposes capabilities.transfers directly.
   response=$(curl -sS https://api.stripe.com/v1/account -H "Authorization: Bearer $STRIPE_SECRET_KEY")
   echo "$response" | jq -e '.capabilities.transfers == "active"' >/dev/null \
     || (echo "FAIL — platform transfers capability is not 'active' (response: $(echo "$response" | jq -r '.capabilities.transfers // "missing"')) "; exit 1)
   # Verify env vars exist for return / refresh URL
   supabase secrets list --linked 2>/dev/null | grep -E 'STRIPE_CONNECT_(RETURN|REFRESH)_URL' || (echo "FAIL — STRIPE_CONNECT_RETURN_URL / STRIPE_CONNECT_REFRESH_URL missing from Function secrets"; exit 1)
   echo "WAVE-0 D-37 #2 PASS"
   ```
2. Run: `bash /Users/karstenhaldan/minisite/leanshot/scripts/wave-0-stripe-transfers-capability.sh`
3. If FAILs on `transfers` capability:
   - Visit Stripe Dashboard → Settings → Connect → Platform settings → Capabilities
   - Enable `transfers` (one-click toggle)
   - Re-run smoke
4. If FAILs on missing env vars:
   - `supabase secrets set STRIPE_CONNECT_RETURN_URL=https://leanshot.app --linked`
   - `supabase secrets set STRIPE_CONNECT_REFRESH_URL=https://leanshot.app --linked`
   - Re-run smoke

Expected final output: `WAVE-0 D-37 #2 PASS`.
  </how-to-verify>
  <resume-signal>Type "transfers-capability-confirmed" or describe issues</resume-signal>
</task>

<task type="auto">
  <name>Task 2: Build stripe-connect-onboard + partner-account-status Edge Functions + Deno tests + config.toml</name>
  <files>/Users/karstenhaldan/minisite/supabase/functions/stripe-connect-onboard/index.ts, /Users/karstenhaldan/minisite/supabase/functions/stripe-connect-onboard/index.test.ts, /Users/karstenhaldan/minisite/supabase/functions/stripe-connect-onboard/cors.ts, /Users/karstenhaldan/minisite/supabase/functions/stripe-connect-onboard/deno.json, /Users/karstenhaldan/minisite/supabase/functions/partner-account-status/index.ts, /Users/karstenhaldan/minisite/supabase/functions/partner-account-status/index.test.ts, /Users/karstenhaldan/minisite/supabase/functions/partner-account-status/deno.json, /Users/karstenhaldan/minisite/supabase/config.toml</files>
  <read_first>
    /Users/karstenhaldan/minisite/supabase/functions/stripe-checkout/index.ts (full file — analog for module-level Stripe init + JWT extraction + ensureCustomer pattern)
    /Users/karstenhaldan/minisite/supabase/functions/stripe-checkout/index.test.ts (Deno test pattern with `__setAdminForTest`)
    /Users/karstenhaldan/minisite/leanshot/.planning/phases/19-affiliate-program-stripe-connect/19-RESEARCH.md (Code Examples §"affiliate-connect-onboard" lines 760-815)
    /Users/karstenhaldan/minisite/leanshot/.planning/phases/19-affiliate-program-stripe-connect/19-PATTERNS.md (section B.2 — stripe-connect-onboard analog)
  </read_first>
  <action>
Two new Edge Functions; both `verify_jwt=true` (default; explicit declaration in config.toml).

**Function 1 — `supabase/functions/stripe-connect-onboard/index.ts`** (POST, JWT-gated):
- Module-level imports: `import Stripe from 'https://esm.sh/stripe@19?target=denonext';` (RESEARCH §"Standard Stack" — pin v19 NOT v22 to match Phase 14 webhook); `import { createClient } from 'npm:@supabase/supabase-js@2';`.
- Lazy Stripe init via getter that uses `Stripe.createFetchHttpClient()` (Deno requirement; clone `stripe-checkout/index.ts:86-94`).
- Lazy admin client init with Proxy wrapper supporting `__setAdminForTest` test injection (clone `stripe-checkout/index.ts:112-143`).
- `Deno.serve` handler:
  1. CORS preflight: if `req.method === 'OPTIONS'` return 204 + cors headers.
  2. JWT auth: extract Bearer JWT; call `admin.auth.getUser(jwt)`; on failure return `jsonError(401, 'unauthenticated')` (Pattern S2).
  3. SELECT from `public.affiliates` WHERE `user_id = user.id` LIMIT 1. If no row → `jsonError(404, 'not_an_affiliate')`. If `status !== 'approved'` → `jsonError(403, 'not_approved')`.
  4. If `affiliate.stripe_connect_account_id` is null:
     - `const acct = await stripe.accounts.create({ type: 'express', country: 'US', capabilities: { transfers: { requested: true } }, business_type: 'individual', metadata: { affiliate_id: aff.id, leanshot_user_id: user.id, leanshot_phase: '19' } });` (D-37 #2 — `transfers.requested = true` is load-bearing per RESEARCH).
     - UPDATE `public.affiliates SET stripe_connect_account_id = acct.id WHERE id = aff.id`.
     - `accountId = acct.id`.
  5. ALWAYS mint a fresh account link (Pitfall 6 — never persist URL):
     - `const link = await stripe.accountLinks.create({ account: accountId, refresh_url: \`${Deno.env.get('STRIPE_CONNECT_REFRESH_URL')}/partner/payouts?refresh=1\`, return_url: \`${Deno.env.get('STRIPE_CONNECT_RETURN_URL')}/partner/payouts?from=connect\`, type: 'account_onboarding' });`
  6. Return `jsonResponse(200, { url: link.url })` — DO NOT include `accountId` or any Stripe error details (V7 PII safety).
- Error handler: `catch (err) { console.error('[stripe-connect-onboard]', err instanceof Error ? err.message : 'unknown'); return jsonError(500, 'internal'); }` — never echo Stripe error messages (Pattern S3).

**Function 2 — `supabase/functions/partner-account-status/index.ts`** (GET, JWT-gated):
- Same module-level Stripe + admin setup as Function 1.
- Handler:
  1. JWT auth same shape.
  2. SELECT `stripe_connect_account_id` from `affiliates` WHERE `user_id = user.id`. If no row or no account ID → return `jsonResponse(200, { state: 'pending', requirements: [] })`.
  3. `const acct = await stripe.accounts.retrieve(stripeConnectAccountId);`
  4. Derive state per UI-SPEC §"Stripe Connect Onboarding Card — State Machine":
     - `requirements.disabled_reason` set → `state = 'restricted'`
     - `charges_enabled && payouts_enabled` → `state = 'active'`
     - `requirements.currently_due.length > 0 && details_submitted` → `state = 'needs_info'`
     - else → `state = 'pending'`
  5. UPDATE `affiliates SET stripe_payouts_enabled = acct.payouts_enabled WHERE id = aff.id` (Pitfall 7 — Plan 19-09 cron reads this).
  6. Return `jsonResponse(200, { state, requirements: acct.requirements?.currently_due ?? [], disabled_reason: acct.requirements?.disabled_reason ?? null });`

**File — `cors.ts`** (shared between both functions OR per-function clone of `stripe-checkout/cors.ts`):
- `BASE_RESPONSE_HEADERS` + `buildCorsHeaders(origin)` — same as Plan 19-02.

**File — `deno.json`** (per function): minimal `{ "imports": {} }`.

**File — `supabase/config.toml`**: APPEND
```
[functions.stripe-connect-onboard]
verify_jwt = true

[functions.partner-account-status]
verify_jwt = true
```
(explicit default declaration per [[reference-supabase-edge-function-deploy]] — be defensive even though true is the default).

**Tests — `stripe-connect-onboard/index.test.ts`** (Deno test, mocked Stripe + admin):
- Test 1: missing JWT → 401.
- Test 2: JWT user has no affiliate row → 404 `not_an_affiliate`.
- Test 3: affiliate.status='pending' → 403 `not_approved`.
- Test 4: approved + no `stripe_connect_account_id` → `stripe.accounts.create` called with `capabilities.transfers.requested=true`; affiliate row UPDATED with new acct id; `stripe.accountLinks.create` called; response returns `{ url }`.
- Test 5: approved + has acct id → `stripe.accounts.create` NOT called (idempotent); only `accountLinks.create` called; response returns `{ url }`.
- Test 6: Stripe API error → 500 `internal`; no Stripe error message echoed in response body.

**Tests — `partner-account-status/index.test.ts`**:
- Test 1: missing JWT → 401.
- Test 2: no affiliate row → 200 `{ state: 'pending', requirements: [] }`.
- Test 3: acct with `disabled_reason` set → state `restricted`.
- Test 4: acct with `charges_enabled && payouts_enabled` → state `active`; affiliates.stripe_payouts_enabled UPDATEd to true.
- Test 5: acct with currently_due[1] + details_submitted → state `needs_info`.
- Test 6: acct with details_submitted=false → state `pending`.

**Constraints:**
- Stripe SDK version: pin `stripe@19` via esm.sh (RESEARCH §Standard Stack — DO NOT bump to v22 mid-milestone; Phase 14 webhook is on v19).
- API version: `'2026-04-22.dahlia' as Parameters<typeof Stripe>[1]['apiVersion']` — match Phase 14 exactly.
- All Stripe calls must use `httpClient: Stripe.createFetchHttpClient()` (Deno requirement).
- Test files: `index.test.ts` ([[reference-deno-test-discovery]]).
- Commit with pathspec: `git commit -- supabase/functions/stripe-connect-onboard supabase/functions/partner-account-status supabase/config.toml` per [[feedback-parallel-executor-git-isolation]].
- DO NOT push DB migrations or deploy functions to live in this task — deploys happen at phase close.
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite && deno test supabase/functions/stripe-connect-onboard/index.test.ts supabase/functions/partner-account-status/index.test.ts --allow-env --allow-net</automated>
  </verify>
  <done>12 Deno tests pass; `stripe-connect-onboard` creates account + mints account_link only on demand (never persists URL); `partner-account-status` returns correct UI state per acct.requirements; `affiliates.stripe_payouts_enabled` mirror updated on every status read; no Stripe error messages echoed in response bodies.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Browser (authenticated affiliate) → Edge Function | JWT-gated; verify_jwt=true; user.id resolved server-side |
| Edge Function → Stripe API | Trusted via STRIPE_SECRET_KEY Function Secret; never exposed in response bodies |
| Edge Function → DB (service_role) | Trusted; updates `affiliates.stripe_connect_account_id` + `.stripe_payouts_enabled` |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-19-03-S | Spoofing | Stale account_link URL phishing | mitigate | JIT generation only; never persisted; Stripe enforces 5-min TTL (Pitfall 6) |
| T-19-03-T | Tampering | User onboards as another affiliate | mitigate | `affiliates.user_id = auth.uid()` JWT-resolved server-side; user cannot specify affiliate_id |
| T-19-03-R | Repudiation | Audit trail of onboarding link generation | accept | Stripe-side audit only; we don't audit URL creation (low value) |
| T-19-03-I | Information Disclosure | Stripe error messages leaked in response | mitigate | All catch blocks return `{ error: 'internal' }`; PII-safe logs (Pattern S3) |
| T-19-03-D | DoS | Spam account_link.create calls | accept | Rate-limited by Stripe; per-user JWT gate provides natural throttle |
| T-19-03-E | Elevation of Privilege | Unapproved affiliate gets onboarding link | mitigate | `affiliate.status === 'approved'` check before accountLinks.create |
| T-19-03-PSV | Privacy (env-var leak) | STRIPE_SECRET_KEY in logs | mitigate | Stripe SDK never logs secret in error paths; our error logger uses `err.message` only |
</threat_model>

<verification>
- Task 1 Wave-0 smoke: `transfers` capability active on platform; `STRIPE_CONNECT_RETURN_URL` + `STRIPE_CONNECT_REFRESH_URL` exist as Function Secrets
- 6 Deno tests for `stripe-connect-onboard` + 6 for `partner-account-status` all green
- `accounts.create` invoked with `capabilities.transfers.requested = true` (load-bearing for Plan 19-09 cron)
- `accountLinks.create` invoked on every POST (JIT — never cached URL)
- `partner-account-status` state machine derives 4 states matching UI-SPEC card
- No Stripe error messages echoed in HTTP response bodies (V7)
</verification>

<success_criteria>
- Wave-0 D-37 #2 smoke passes (transfers capability + onboarding URL env vars)
- POST /stripe-connect-onboard with valid affiliate JWT returns `{ url: 'https://connect.stripe.com/...' }` URL valid for 5 minutes
- Subsequent POST reuses the same Stripe account id (idempotent on the affiliate row)
- GET /partner-account-status returns one of 4 states per UI-SPEC; updates `affiliates.stripe_payouts_enabled` mirror
- 12 Deno tests green; no `s.user!` non-null assertions introduced
</success_criteria>

<output>
After completion, create `19-03-SUMMARY.md`: Wave-0 D-37 #2 result, account-creation idempotency proven, state-machine table validated, env-var inventory documented.
</output>
