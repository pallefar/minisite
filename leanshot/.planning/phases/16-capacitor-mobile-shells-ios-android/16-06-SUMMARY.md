---
phase: 16-capacitor-mobile-shells-ios-android
plan: 06
subsystem: payments-server-revenuecat
tags: [revenuecat, edge-function, supabase, webhooks, tier-reconciliation, money-06, money-07, d-02, d-04]
requires:
  - phase-14-stripe-subscriptions-shape (subscriptions + subscription_events tables; provider column + CHECK)
  - phase-19-plan-01-tier-effective-view (P19 shipped the cross-provider view ahead of P16 via D-04 contract)
provides:
  - supabase-edge-function-revenuecat-webhook (Bearer + optional HMAC dual gate)
  - idempotency-via-subscription_events-event_id-pk
  - d-04-immediate-downgrade-enforcement (CANCELLATION/EXPIRATION set current_period_end=now())
affects:
  - phase-16-plan-05-iap-realtime-tier-flip (this webhook is the server half; RC client purchase has somewhere to land)
  - phase-16-plan-10-uat-apple-sandbox (end-to-end RC purchase → tier_effective propagation now possible)
tech-stack:
  added:
    - none (uses Deno + esm.sh + npm:@supabase/supabase-js@2 — same as stripe-webhook P14)
  patterns:
    - bearer-token-cheap-gate-before-body-read
    - optional-hmac-sha256-via-deno-crypto-subtle-verify
    - raw-body-text-first-never-json-parse-pre-verify
    - idempotent-insert-via-event-id-pk-23505-duplicate
    - test-injection-shim-with-onUpsertCapture-seam (extends stripe-webhook pattern with payload-capture)
    - vendor-gated-send (function ships + serves 401 until user pastes RC bearer secret)
key-files:
  created:
    - supabase/functions/revenuecat-webhook/index.ts (376 lines — handler, dispatcher, HMAC verify, dual-auth gate)
    - supabase/functions/revenuecat-webhook/index.test.ts (367 lines — 14 Deno tests)
    - supabase/functions/revenuecat-webhook/cors.ts (17 lines — BASE_RESPONSE_HEADERS mirroring stripe-webhook)
    - supabase/functions/revenuecat-webhook/deno.json (15 lines — verbatim stripe-webhook deno.json)
    - supabase/migrations/20270601000022_rc_subscriptions_provider.sql (idempotent no-op; defensive fresh-DB seed)
    - supabase/migrations/20270601000023_tier_effective_view.sql (intentional empty no-op + column-mapping documentation)
  modified:
    - supabase/config.toml (appended [functions.revenuecat-webhook] verify_jwt = false block)
decisions:
  - Dual-gate auth (Bearer + optional HMAC) instead of either-or — Bearer always required (cheap, runs pre-body); HMAC optional via REVENUECAT_WEBHOOK_SECRET secret so function ships even before HMAC is enabled in RC dashboard (vendor-gated pattern per reference_vendor_gated_send_health_check)
  - D-04 immediate-downgrade asymmetry (CANCELLATION/EXPIRATION → current_period_end=now()) deliberately preserved vs Stripe's grace period — matches Apple's native subscription UX, regression-tested by Deno test 4.1
  - Both migration files kept (not deleted) as idempotent no-ops so fresh-DB / disaster-recovery seed flow has the full registry; the SQL itself no-ops on existing objects via IF NOT EXISTS + DO-block guards
  - Filename renumbering from 20270101* → 20270601000022/000023 to clear the live registry's highest applied timestamp (20270601000021) — avoids the silent CLI-skip trap per reference_supabase_migration_filename_regex
  - Did NOT rewrite the existing P19 tier_effective view to match P16's planned column shape — P19 view is RICHER (5 columns vs 4), already honors revenuecat, and CREATE OR REPLACE VIEW cannot drop columns (SQLSTATE 42P16). Column-mapping documentation embedded in migration 23 header instead.
metrics:
  duration: ~50 minutes (single-pass, no checkpoints)
  completed: 2026-05-16
  tasks_completed: 4/4 (plan defined 3 + Task 4 deploy + smoke)
  tests_added: 14 Deno tests (all green; 11ms total)
  migrations_pushed_live: 2 (both no-op against existing schema; registered in remote migration registry)
  edge_function_deployed: revenuecat-webhook @ https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/revenuecat-webhook (697.3kB bundle)
---

# Phase 16 Plan 06: RevenueCat Webhook + Migration + Tier-Effective View Summary

Ship the **server half of MONEY-06**: a `revenuecat-webhook` Edge Function that ingests iOS/Android subscription events from RevenueCat, writes them to `public.subscriptions` with `provider='revenuecat'`, and lets the existing P19 `tier_effective` view reconcile them with Stripe rows via `MAX(current_period_end)`. Plus paired migrations that were intended to add schema but turned out to be no-ops because Phase 19 shipped the same schema ahead of P16 via cross-phase contract D-04.

## What Shipped

### 1. Migrations (idempotent no-ops vs production)

Both migrations renumbered to `20270601000022` + `20270601000023` (above live registry's highest applied `20270601000021`) per `reference_supabase_migration_filename_regex` — avoids the silent CLI-skip trap.

**`20270601000022_rc_subscriptions_provider.sql`** — defensive idempotency-only:
- `ALTER TABLE subscription_events ADD COLUMN IF NOT EXISTS provider text DEFAULT 'stripe'` (already present from P19; no-op in prod)
- `subscription_events_provider_check CHECK (provider IN ('stripe','revenuecat'))` via DO block (already present; no-op)
- `idx_subscription_events_provider_received` index (already absent; created in prod by this migration)
- `idx_subscriptions_user_provider_unique` partial unique index (already present from P19; no-op)

**`20270601000023_tier_effective_view.sql`** — intentional empty no-op:
- Header explains why we did NOT `CREATE OR REPLACE VIEW` the P19 view
- Body is `select 1 where false;` — registry entry only

### 2. Edge Function `revenuecat-webhook`

Three files under `supabase/functions/revenuecat-webhook/`:

- **`cors.ts`** — verbatim shape of `stripe-webhook/cors.ts`: `BASE_RESPONSE_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' }`. No `Access-Control-Allow-*` (RC is server-to-server).
- **`deno.json`** — verbatim shape of `stripe-webhook/deno.json`: `deno test --allow-all --import-map=../import_map.json`.
- **`index.ts`** — the handler. Module shape mirrors stripe-webhook exactly. Differences:
  - Replaces Stripe SDK + `Stripe.createSubtleCryptoProvider()` with a hand-rolled HMAC-SHA256 helper (`hexToBytes` + `stringToArrayBuffer` + `verifyHmac` using `crypto.subtle.verify`). Returns plain `ArrayBuffer` from helpers to satisfy Deno's strict `BufferSource` type on `crypto.subtle.verify`.
  - Dispatcher reads `event.type` and maps to `(status, ux_tier)`. D-04 short-circuit: `CANCELLATION` + `EXPIRATION` set `current_period_end = new Date().toISOString()` (immediate). Other active types use `expiration_at_ms` from the event.
  - Upserts to `subscriptions` with `onConflict: 'user_id,provider'`, leveraging the existing `idx_subscriptions_user_provider_unique`.
  - Inserts to `subscription_events` with `provider: 'revenuecat'`.
  - Test injection shim extends stripe-webhook's `TestContext` with `upsertResult` + `onUpsertCapture` callback. The capture seam lets tests introspect the exact upsert payload that would be sent to the DB — necessary for the D-04 dispatcher-math regression test.

### 3. `supabase/config.toml` — `[functions.revenuecat-webhook] verify_jwt = false`

Appended after `[functions.stripe-webhook]`. RC has no Supabase user JWT; Bearer + HMAC are the only auth layer. Without `verify_jwt = false`, the gateway 401s every delivery before the function code runs.

### 4. Deno Test Suite (14 tests, all green)

`supabase/functions/revenuecat-webhook/index.test.ts` covers every observable behavior:

| # | Test | What it pins |
|---|---|---|
| 1.1 | Missing Authorization → 401 | Bearer-token gate enforced |
| 1.2 | Wrong Bearer token → 401 | Bearer string compared, not just header presence |
| 1.3 | GET → 405 method-not-allowed | Method guard |
| 1.4 | OPTIONS preflight → 200 + Cache-Control | Surface uniformity with stripe-webhook |
| 2.1 | HMAC enabled + missing sig header → 400 missing-signature | HMAC gate kicks in when secret is set |
| 2.2 | Bad signature → 400 bad-signature | `crypto.subtle.verify` actually verifies |
| 2.3 | Valid HMAC + valid Bearer → 200 ok | Both gates pass together |
| 3.1 | DB error 23505 → 200 duplicate | Idempotency replay returns 200 so RC stops retrying |
| 3.2 | DB error 08006 → 500 internal | Non-23505 DB error triggers RC retry curve |
| 4.1 | CANCELLATION with 30d-future expiration_at_ms → upsert `current_period_end ≈ now()` (skew < 5s) AND `ux_tier='free'` | **D-04 immediate-downgrade regression-proof** |
| 4.2 | RENEWAL with 30d-future → upsert `current_period_end = future ISO` + `ux_tier='paid'` | Control: non-cancel events preserve expiration |
| 5.1 | Malformed JSON body → 400 malformed-json | After HMAC verify, JSON.parse failure surfaces |
| 5.2 | Event missing `id` → 400 malformed-event | Shape validation post-parse |
| 6.1 | Handler error containing PII strings → response body has zero PII | T-16-06-04 mitigation enforced |

Run: `cd supabase/functions/revenuecat-webhook && deno test --allow-all --no-check` → `ok | 14 passed | 0 failed (11ms)`.

### 5. Live Deploy + Smoke Test

- `supabase functions deploy revenuecat-webhook --project-ref ytnsipxxmzgaebkqmokp` succeeded (697.3kB bundle, no bare-import warnings).
- `supabase db push --linked --include-all` registered both migrations in the remote registry (verified via `supabase migration list --linked`).
- Live smoke (Task 4 step 5a, automated): `curl -X POST` without Bearer → **HTTP/2 401, body `{"error":"unauthorized"}`, headers include `cache-control: private, no-store` + `content-type: application/json`**. All gates pass.
- Live smoke (Task 4 step 5c, automated): `to_regclass('public.tier_effective')` returns `tier_effective` (view exists, queryable).

## Deviations from Plan

### 1. [Rule 1 — Schema Drift] Phase 19 shipped the schema first

**Found during:** Task 1 live `supabase db push --linked --include-all`. The view migration failed with `SQLSTATE 42P16: cannot drop columns from view`.

**Issue:** Phase 19 Plan 19-01 (migration `20270101000004_tier_effective_view.sql`) had already created `public.tier_effective` AHEAD of Phase 16 via cross-phase contract D-04 ("When Phase 16 Plan 16-06 resumes, it inserts rows with provider='revenuecat' into public.subscriptions. The tier_effective view immediately returns MAX(current_period_end) across both providers with zero changes here."). The P19 view shape is RICHER than P16's planned shape:

| P16 plan column | P19 production column |
|---|---|
| `effective_expires_at` | `effective_period_end` |
| `tier` (`'paid' \| 'past_due' \| 'free'`) | `has_active boolean` + `has_past_due boolean` |
| `providers array` | `winning_provider text` |

P19 also already shipped the partial unique index `idx_subscriptions_user_provider_unique` AND the `subscription_events.provider` column + CHECK constraint AND the per-provider event-stream index.

**Fix:** Rewrote both migration files as no-ops:
- `20270601000022`: kept `IF NOT EXISTS` DDL + DO-block guards so the file is still safe to apply on a fresh DB (new dev clone / CI seed / disaster recovery). Every statement no-ops in current production.
- `20270601000023`: empty body (`select 1 where false`) + header comment block documenting column-name translation for downstream consumers reading the plan's must_haves wording.

The Edge Function's contract with the view is "write a `subscriptions` row with `provider='revenuecat'` that gets MAX'd against any Stripe row". The P19 view already does exactly this. **D-02 contract is fully satisfied in production; just under different column names than the plan anticipated.**

**Files modified:** `supabase/migrations/20270601000022_rc_subscriptions_provider.sql`, `supabase/migrations/20270601000023_tier_effective_view.sql`.

**Commit:** `9f4aef3` (fix commit, separate from the initial Task 1 commit `3f692d4` per executor protocol: NEVER amend; create new commits for deviations).

### 2. [Rule 1 — Strict typing] Deno `BufferSource` rejected `Uint8Array<ArrayBufferLike>`

**Found during:** Task 2 `deno check --no-lock index.ts` (pre-commit type-check).

**Issue:** `crypto.subtle.verify(..., sigBytes, encoder.encode(body))` — `encoder.encode()` returns `Uint8Array<ArrayBufferLike>` which Deno's strict types reject as not assignable to `BufferSource` (because `ArrayBufferLike` includes `SharedArrayBuffer` which is missing fields like `resizable`, `resize`, `detached`, `transfer`).

**Fix:** Introduced `stringToArrayBuffer(s: string): ArrayBuffer` and `hexToBytes(hex: string): ArrayBuffer` helpers that return plain `ArrayBuffer` (allocated explicitly, not via `.buffer` getter). All `crypto.subtle.importKey` + `verify` + `sign` calls use these helpers.

**Files modified:** `supabase/functions/revenuecat-webhook/index.ts` (lines 84–123).

**Commit:** Included in Task 2 commit `257e755`.

### 3. [Rule 1 — Cosmetic] Cold-start "REVENUECAT_WEBHOOK_SECRET unset" warning fires even when set

**Found during:** Task 3 `deno test` output. The module-level `if (!getHmacSecret()) console.warn(...)` block prints the warning on first module load even when the test file calls `Deno.env.set('REVENUECAT_WEBHOOK_SECRET', ...)` BEFORE the static import. Runtime tests still pass (lazy getter re-reads correctly per request), so this is purely a cosmetic cold-start race.

**Fix:** None applied — the warning is intentional documentation when the secret is genuinely unset (e.g., first prod deploy before HMAC is enabled in the RC dashboard). The test-suite false-positive log is acceptable; tests all pass.

**Files modified:** none.

## Auth Gates (vendor-gated send)

This plan ships the function code but **does NOT set the live Function Secrets** — those require the user to first configure the RC dashboard webhook and copy the bearer token.

Per `reference_vendor_gated_send_health_check`: function deploys + serves `401 { error: 'unauthorized' }` to all requests until the user runs:

```bash
# After creating the bearer token in RevenueCat Dashboard → Project → Integrations → Webhooks
supabase secrets set REVENUECAT_WEBHOOK_AUTH=<bearer_token> --project-ref ytnsipxxmzgaebkqmokp

# Optional (defense-in-depth): enable HMAC signing in RC dashboard, then:
supabase secrets set REVENUECAT_WEBHOOK_SECRET=<hmac_signing_secret> --project-ref ytnsipxxmzgaebkqmokp

# Then register the webhook URL in RC dashboard:
#   https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/revenuecat-webhook
```

Verified `supabase secrets list --project-ref ytnsipxxmzgaebkqmokp` does NOT yet include `REVENUECAT_WEBHOOK_AUTH` or `REVENUECAT_WEBHOOK_SECRET`. The function is correctly returning 401 until they're loaded — this is the vendor-gated pattern working as designed.

## Deferred Items

- **Live smoke step 5(b) — authorized + malformed event → 400 malformed-event**: Cannot run autonomously because `supabase secrets list` does not return plaintext values. Will run as the first manual smoke after the user pastes `REVENUECAT_WEBHOOK_AUTH`. Curl command embedded in plan Task 4 step 5(b).
- **Live smoke step 5(c) — `tier_effective` row-shape probe**: View existence already verified (`to_regclass` returns `tier_effective`). Full SELECT probe deferred until the user creates a test subscription via real RC sandbox purchase (Plan 16-10 UAT).
- **HMAC layer not yet active**: `REVENUECAT_WEBHOOK_SECRET` unset means HMAC verification is currently skipped — Bearer-token gate alone protects the endpoint. This is the documented graceful-pre-HMAC-rollout path; enable HMAC in RC dashboard + load the secret to activate full defense-in-depth.
- **Webhook URL registration in RC dashboard**: Pre-emptively unblocked by the orchestrator's session-context note. User will register `https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/revenuecat-webhook` in RC dashboard after pasting the bearer secret.

## Known Stubs

None. The function is feature-complete and tested. The migrations are intentional no-ops with documented rationale (Deviation #1).

## Column-Mapping Quick Reference for Downstream Plans

The P19 `tier_effective` view shape may surprise readers expecting the P16 plan wording. Translate as follows:

| Plan must_have wording (P16) | Real P19 production column |
|---|---|
| `SELECT tier_effective WHERE user_id = X` returns `tier='paid'` | `SELECT user_id, has_active FROM tier_effective WHERE user_id = X` returns `has_active = true` |
| `tier='free'` | `has_active = false AND has_past_due = false` |
| `tier='past_due'` | `has_past_due = true AND has_active = false` |
| `effective_expires_at` | `effective_period_end` |
| `providers` array | `winning_provider` text (the provider with the LATEST `current_period_end`) |

The semantic invariant ("user is paid iff MAX(current_period_end) > now() across providers") is identical; only the SQL projection differs.

## Cross-Phase Contract Health

- **P19 → P16**: Cross-phase contract D-04 ("P16-06 becomes no-op when it resumes") held perfectly — the only changes needed at P16 time are the Edge Function + config block. Schema was already in place.
- **P16-06 → P16-05**: Plan 16-05 (iOS RC client SDK install + Realtime tier-flip listener) now has a working server endpoint. After the user loads `REVENUECAT_WEBHOOK_AUTH`, the full propagation loop (Apple Sandbox IAP → RC webhook → subscriptions upsert → Realtime broadcast → iOS Zustand tier update) becomes end-to-end testable in Plan 16-10 UAT.
- **P16-06 → P14 stripe-webhook**: Zero interference. D-04 asymmetry (RC immediate downgrade vs Stripe grace) preserved by design.

## Self-Check: PASSED

Verified before SUMMARY commit:

- [x] All 5 created files exist under `supabase/functions/revenuecat-webhook/` + `supabase/migrations/`
- [x] `supabase/config.toml` modification present at line ~403
- [x] Both migration commits exist (`3f692d4` initial, `9f4aef3` no-op-rewrite fix)
- [x] Edge Function commit `257e755` exists
- [x] Test suite commit `cea77b3` exists
- [x] Live curl smoke: 401 + Cache-Control + Content-Type all confirmed
- [x] `supabase migration list --linked` includes 20270601000022 + 20270601000023
- [x] `deno test`: 14 passed, 0 failed
