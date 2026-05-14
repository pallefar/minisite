---
phase: 14-monetization-foundation-stripe-web-clinic-seats
plan: 03
subsystem: payments
tags: [stripe, webhooks, deno, edge-function, idempotency, supabase, subscriptions]

# Dependency graph
requires:
  - phase: 14-01
    provides: subscriptions/subscription_events/stripe_customers schema + RLS policies
provides:
  - "stripe-webhook Edge Function with HMAC signature verification (constructEventAsync + SubtleCryptoProvider)"
  - "Idempotent event deduplication via subscription_events.event_id PRIMARY KEY"
  - "6 event handlers: checkout.session.completed, customer.subscription.created/updated/deleted, invoice.paid, invoice.payment_failed, invoice.upcoming (stub)"
  - "mapStripeStatusToUxTier() exhaustive switch (Pitfall 6) — trialing/active→paid, past_due/unpaid→past_due, canceled/incomplete/incomplete_expired/paused→free"
  - "25 Deno tests covering signature verify, idempotency, status mapping, handler logic"
affects: [14-04, 14-05, 14-06, 14-07, 14-08]

# Tech tracking
tech-stack:
  added:
    - "stripe@19 via https://esm.sh/stripe@19?target=denonext (added to supabase/functions/import_map.json)"
    - "Deno 2.7.14 (installed on execution machine for local test runs)"
  patterns:
    - "SubtleCryptoProvider: Stripe.createSubtleCryptoProvider() as 5th arg to constructEventAsync (Deno Pitfall 2)"
    - "Raw-body discipline: await request.text() MUST precede any signature work (Pitfall 3)"
    - "Idempotency via ON CONFLICT DO NOTHING + Postgres error code 23505 check (Pattern B)"
    - "PII safety: error responses are {error: 'short-code'} only — event.data.object never in response"
    - "Stripe HMAC key format: SubtleCryptoProvider uses TextEncoder(full_whsec_string) as key bytes (NOT base64-decoded)"

key-files:
  created:
    - "supabase/functions/stripe-webhook/index.ts — dispatcher: raw-body → constructEventAsync → idempotency → switch"
    - "supabase/functions/stripe-webhook/cors.ts — BASE_RESPONSE_HEADERS (Content-Type + Cache-Control: private, no-store)"
    - "supabase/functions/stripe-webhook/deno.json — Deno test task + lint/fmt config"
    - "supabase/functions/stripe-webhook/index.test.ts — 6 dispatcher tests"
    - "supabase/functions/stripe-webhook/events/checkout-session-completed.ts — web+clinic upsert"
    - "supabase/functions/stripe-webhook/events/subscription-updated.ts — mapStripeStatusToUxTier + upsert"
    - "supabase/functions/stripe-webhook/events/invoice-paid.ts — past_due→paid recovery"
    - "supabase/functions/stripe-webhook/events/invoice-payment-failed.ts — active/past_due flip logic"
    - "supabase/functions/stripe-webhook/events/customer-subscription-deleted.ts — ux_tier=free + status=canceled"
    - "supabase/functions/stripe-webhook/events/invoice-upcoming.ts — STUB (14-07 wires meter events)"
    - "supabase/functions/stripe-webhook/events/checkout-session-completed.test.ts — 3 tests"
    - "supabase/functions/stripe-webhook/events/subscription-updated.test.ts — 10 tests"
    - "supabase/functions/stripe-webhook/events/invoice-paid.test.ts — 3 tests"
    - "supabase/functions/stripe-webhook/events/invoice-payment-failed.test.ts — 2 tests"
    - "supabase/functions/stripe-webhook/events/customer-subscription-deleted.test.ts — 1 test"
  modified:
    - "supabase/functions/import_map.json — added stripe → esm.sh/stripe@19?target=denonext"

key-decisions:
  - "Stripe HMAC key uses full whsec_xxx string as UTF-8 bytes (NOT base64-decoded) with SubtleCryptoProvider — discovered by reading stripe SDK source (computeHMACSignatureAsync)"
  - "Lazy getters for STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET at request-time (not module load) to support Deno test env injection"
  - "TestContext injection pattern for mock DB/handler results in tests — avoids live Stripe/Supabase in unit tests"
  - "supabase functions deploy deferred to orchestrator (parallel executor constraint — not run from worktree)"

patterns-established:
  - "Stripe webhook HMAC test pattern: computeStripeSignatureHeader() using crypto.subtle with full secret as UTF-8 key"
  - "Handler mock pattern: buildMockAdmin() returns [SupabaseClient, getCalls] tuple for assertion"
  - "invoice.payment_failed behavior 2.17: maps Stripe status directly — active maps to paid (no premature flip); Stripe fires subscription.updated later"

requirements-completed: [MONEY-01, MONEY-09]

# Metrics
duration: 12min
completed: 2026-05-14
---

# Phase 14 Plan 03: stripe-webhook Edge Function Summary

**HMAC-verified Stripe webhook Edge Function with idempotent event.id deduplication, exhaustive 8-status→3-tier mapper, and 6 per-event handlers (5 production + 1 stub for 14-07) — 25 Deno tests green**

## Performance

- **Duration:** 12 min
- **Started:** 2026-05-14T04:58:59Z
- **Completed:** 2026-05-14T05:11:18Z
- **Tasks:** 2 of 3 completed (Task 3 is a human-verify checkpoint)
- **Files created:** 15 + 1 modified

## Accomplishments
- `stripe-webhook` Edge Function scaffold: raw-body read → `constructEventAsync` with `Stripe.createSubtleCryptoProvider()` → `subscription_events` idempotency insert → dispatcher switch
- `mapStripeStatusToUxTier()` exhaustive switch mapping all 8 Stripe statuses to 3 UX tiers with `never` guard
- 6 event handlers covering the full webhook surface (checkout/subscription/invoice events + stub for 14-07)
- 25 Deno tests: missing-sig/tampered-body/valid/duplicate/handler-throw/OPTIONS + all 8 status mappings + checkout/invoice/delete handler logic

## Task Commits

Each task was committed atomically:

1. **Task 1: scaffold + dispatcher + 6 event handlers + 6 index tests** - `c4293ea` (feat)
2. **Task 2: 5 per-handler test files — 19 new tests** - `2eae5de` (test)
3. **Task 3: human-verify checkpoint** - pending (deploy + Stripe Dashboard registration)

## Files Created/Modified

- `supabase/functions/stripe-webhook/index.ts` — Dispatcher (raw-body, constructEventAsync, idempotency, switch)
- `supabase/functions/stripe-webhook/cors.ts` — BASE_RESPONSE_HEADERS
- `supabase/functions/stripe-webhook/deno.json` — Deno test config
- `supabase/functions/stripe-webhook/index.test.ts` — 6 dispatcher tests
- `supabase/functions/stripe-webhook/events/checkout-session-completed.ts` — web+clinic upsert (Pitfall 8)
- `supabase/functions/stripe-webhook/events/subscription-updated.ts` — mapStripeStatusToUxTier + upsert (Pitfall 6)
- `supabase/functions/stripe-webhook/events/invoice-paid.ts` — past_due→paid recovery
- `supabase/functions/stripe-webhook/events/invoice-payment-failed.ts` — flip logic (behavior 2.17 accounted for)
- `supabase/functions/stripe-webhook/events/customer-subscription-deleted.ts` — cancellation finalization
- `supabase/functions/stripe-webhook/events/invoice-upcoming.ts` — STUB (14-07 wires meter emission)
- `supabase/functions/stripe-webhook/events/*.test.ts` — 5 test files (19 tests)
- `supabase/functions/import_map.json` — added `"stripe": "https://esm.sh/stripe@19?target=denonext"`

## Decisions Made

1. **Stripe HMAC key discovery:** `SubtleCryptoProvider.computeHMACSignatureAsync()` uses `TextEncoder().encode(fullSecret)` as the HMAC key — NOT base64-decoded bytes. This is different from the Node SDK path. Confirmed by reading the cached SDK source. Tests use the same approach.
2. **Lazy env getters:** `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are read at request-time (not module cold-start) so Deno test files can set them via `Deno.env.set()` before the first request.
3. **Deploy deferred:** `supabase functions deploy stripe-webhook` NOT run from this worktree (parallel executor constraint per project memory). Task 3 human-verify checkpoint covers the deploy + Stripe Dashboard registration.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Lazy STRIPE_SECRET_KEY initialization to avoid module-load failure in tests**
- **Found during:** Task 1 (running RED tests)
- **Issue:** Module-level `new Stripe(STRIPE_SECRET_KEY)` failed because STRIPE_SECRET_KEY is empty string at module parse time (before test file sets env vars)
- **Fix:** Changed to a `getStripe()` factory function that reads from Deno.env at request-time
- **Files modified:** `supabase/functions/stripe-webhook/index.ts`
- **Verification:** All 6 index.test.ts tests pass
- **Committed in:** c4293ea

**2. [Rule 1 - Bug] Same pattern applied to SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY**
- **Found during:** Task 1 (successive test runs)
- **Issue:** `createClient('')` throws `supabaseUrl is required`
- **Fix:** Added `|| 'placeholder'` fallback for module-level client; moved sensitive key to inline read
- **Files modified:** `supabase/functions/stripe-webhook/index.ts`
- **Committed in:** c4293ea

**3. [Rule 1 - Bug] HMAC key format discovery (project knowledge gap)**
- **Found during:** Task 1 (HMAC signature test failures)
- **Issue:** Test HMAC computation used `atob(secret.replace('whsec_', ''))` (standard docs pattern), but stripe SDK SubtleCryptoProvider encodes the FULL `whsec_xxx` string as UTF-8 bytes for the key
- **Fix:** Updated `computeStripeSignatureHeader()` in test to use `TextEncoder().encode(TEST_WEBHOOK_SECRET)`
- **Files modified:** `supabase/functions/stripe-webhook/index.test.ts`
- **Verification:** All 6 tests pass including tampered-body 400 and valid-sig 200
- **Committed in:** c4293ea

---

**Total deviations:** 3 auto-fixed (all Rule 1 — bugs discovered during test execution)
**Impact on plan:** All fixes necessary for test suite correctness. No scope creep. Production code unaffected by 1 and 2 (placeholders only matter in test context).

## Issues Encountered
- Deno was not installed on the execution machine — installed via `curl -fsSL https://deno.land/install.sh | sh` (Deno 2.7.14)
- `stripe.webhooks.generateTestHeaderString()` throws `SubtleCryptoProvider cannot be used in a synchronous context` — replaced with manual `crypto.subtle` HMAC computation in tests

## User Setup Required

**Task 3 checkpoint requires manual action:**

1. Orchestrator runs: `supabase functions deploy stripe-webhook --linked --no-verify-jwt`
2. User opens Stripe Dashboard → Developers → Webhooks → Add endpoint:
   - URL: `https://ytnsipxxmzgaebkqmokp.functions.supabase.co/stripe-webhook`
   - Events (7): checkout.session.completed, customer.subscription.created/updated/deleted, invoice.paid, invoice.payment_failed, invoice.upcoming
3. User reveals `whsec_...` signing secret from endpoint page
4. Orchestrator runs: `supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_... --project-ref ytnsipxxmzgaebkqmokp`
5. User clicks "Send test webhook" → checkout.session.completed → confirms 200 + DB row
6. Replay → confirms idempotency (same row count, 200 response)

## Hand-off Notes

**For plan 14-04 (stripe-checkout):**
- `metadata.tier_kind` MUST be one of `{'web', 'clinic'}` on the Checkout session's `subscription_data.metadata`
- `metadata.user_id` required when `tier_kind='web'`; `metadata.clinic_id` required when `tier_kind='clinic'`
- The webhook handler reads these fields from `session.subscription_data.metadata ?? session.metadata`
- Any mismatch throws `metadata-missing` → dispatcher returns 500 → Stripe retries

**For plan 14-05 (TierGate frontend):**
- `subscriptions.ux_tier` is the field driving `<TierGate>` consumers
- Frontend reads via Supabase Realtime subscription or settings-page refresh

**For plan 14-07 (invoice-upcoming / meter events):**
- `supabase/functions/stripe-webhook/events/invoice-upcoming.ts` is currently a stub
- 14-07 replaces the stub body with `stripe.v1.billing.meterEvents.create()` calls
- No signature changes needed — the `handle(event, admin)` interface is stable

## Deferred to Plan 14-07

- Real `invoice.upcoming` handler body (currently stub that logs and returns)
- Meter event emission for clinic tier metered overage

## Open Phase 14 Risk

Handler errors return 500 (intentional — triggers Stripe retry curve). If a poison-pill event lands (always-throws-on-this-event-id bug), Stripe will retry for 24h. Mitigation: `subscription_events.processing_error` text column lets us see what's stuck; manual fix is "fix the bug, redeploy, Stripe re-fires automatically".

## Known Stubs

| Stub | File | Line | Reason |
|------|------|------|--------|
| `invoice-upcoming` handler | `supabase/functions/stripe-webhook/events/invoice-upcoming.ts` | entire body | 14-07 wires meter-event emission; no subscriptions mutation |

---
*Phase: 14-monetization-foundation-stripe-web-clinic-seats*
*Completed: 2026-05-14*
