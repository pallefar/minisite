# RevenueCat Webhook — Secret Provisioning Runbook

**Phase-70-gated.** The webhook is deployed and operational in a fail-soft state today.
Real secret values, HMAC enforcement enablement, and live RC→mirror UAT are explicitly
deferred to Phase 70. This runbook documents what must be set at Phase 70 and how.

---

## Secrets Overview

| Secret | Type | Required? | Behavior when absent |
|--------|------|-----------|----------------------|
| `REVENUECAT_WEBHOOK_AUTH` | Bearer token | **REQUIRED** | 401 on every incoming request; RC retries until set |
| `REVENUECAT_WEBHOOK_SECRET` | HMAC-SHA256 key | Optional (fail-soft) | HMAC verify skipped; Bearer alone gates auth; one-line cold-start `console.warn` logged |

**BOTH ARE SERVER-ONLY SUPABASE FUNCTION SECRETS.**

These are NOT VITE_-prefixed variables and MUST NEVER appear in the client bundle.
Contrast with the VITE_RC_API_KEY_* public SDK keys declared in `.env.example` by Phase
53 Plan 02 — those ARE browser-safe. The webhook secrets are strictly server-side.

---

## Webhook Endpoint

```
https://<project-ref>.supabase.co/functions/v1/revenuecat-webhook
```

Replace `<project-ref>` with your Supabase project reference ID
(e.g., `ytnsipxxmzgaebkqmokp` for the production project).

---

## Secret 1 — `REVENUECAT_WEBHOOK_AUTH` (REQUIRED Bearer token)

### What it is

A shared secret you generate and configure in two places:

1. **RevenueCat dashboard** — the `Authorization: Bearer <token>` header value sent with
   every webhook POST.
2. **Supabase Function Secrets** — the bare token stored so the Edge Function can compare.

The webhook reads the incoming `Authorization: Bearer <token>` header and compares it
to this secret. A mismatch or absent header returns **401 Unauthorized** before any body
is read. RevenueCat will retry webhook deliveries on 401 responses until the secret is
provisioned correctly.

### Phase 70 provisioning steps

**Step 1 — Generate a random token (min 32 bytes entropy):**

```bash
openssl rand -hex 32
# Example output (DO NOT use this value): a3f8c1d29e6b74e0f5a2d8c3b1e9f7a4d6c2b8e5f3a1d9c7b4e2f0a8d6c4b2e0
```

**Step 2 — Set the secret in Supabase:**

```bash
supabase secrets set REVENUECAT_WEBHOOK_AUTH=<your-generated-token> --project-ref <project-ref>
```

**Step 3 — Configure the RC dashboard:**

1. Go to RevenueCat Dashboard → **Project** → **Integrations** → **Webhooks**
2. Add or edit your webhook endpoint with URL:
   `https://<project-ref>.supabase.co/functions/v1/revenuecat-webhook`
3. In the **Authorization** field, enter: `Bearer <your-generated-token>`
4. Select the event types to deliver (recommended: all subscription events)
5. Save and test the webhook via the RC dashboard test-event button

**Step 4 — Verify the secret is set:**

```bash
supabase secrets list --project-ref <project-ref> | grep REVENUECAT_WEBHOOK_AUTH
```

---

## Secret 2 — `REVENUECAT_WEBHOOK_SECRET` (Optional HMAC-SHA256, fail-soft)

### What it is

An HMAC-SHA256 signing secret that RevenueCat uses to sign each webhook body. When set,
the Edge Function verifies the `X-RevenueCat-Signature` header against the raw request
body before any JSON parsing.

**Pre-Phase-70 behavior:** When this secret is UNSET, the HMAC verification step is
skipped entirely and Bearer-token auth alone gates each request. The function logs a
single `console.warn` at cold-start to surface this state. This is deliberate fail-soft
behavior — the webhook is fully operational before HMAC is enabled. Do NOT treat the
`console.warn` as an error requiring immediate action; it is informational.

**Post-Phase-70 behavior:** Once set, any request with a missing or invalid
`X-RevenueCat-Signature` header is rejected with 400.

### Phase 70 provisioning steps

**Step 1 — Enable HMAC signing in the RC dashboard:**

1. RevenueCat Dashboard → **Project** → **Integrations** → **Webhooks** → edit endpoint
2. Enable **Webhook Signature** / HMAC signing (the RC dashboard generates this secret)
3. Copy the generated HMAC secret

**Step 2 — Set the secret in Supabase:**

```bash
supabase secrets set REVENUECAT_WEBHOOK_SECRET=<rc-hmac-secret> --project-ref <project-ref>
```

**Step 3 — Verify both secrets are set:**

```bash
supabase secrets list --project-ref <project-ref> | grep REVENUECAT_WEBHOOK
# Expected output shows REVENUECAT_WEBHOOK_AUTH and REVENUECAT_WEBHOOK_SECRET
```

**Step 4 — Trigger a test event from the RC dashboard** and confirm the Edge Function
logs no `bad-signature` error (check Supabase Dashboard → Edge Function logs).

---

## Mirror Target Table

RC subscription events mirror into the **existing canonical `public.subscriptions` table**
(the same table Stripe writes into — defined in Phase 14 migration
`20260601000019_stripe_subscriptions.sql`).

RC rows are discriminated by `provider = 'revenuecat'`. Stripe rows remain canonical;
RC rows reflect the IAP subscription state alongside them. There is exactly one
`public.subscriptions` table — no parallel RC-only subscription table exists or should
ever be created.

The upsert anchor is the partial unique index `idx_subscriptions_user_provider_unique`
on `(user_id, provider) WHERE user_id IS NOT NULL`, ensuring one RC row per user.

**At Phase 70 UAT, verify:**
- A test RC subscription event lands as a row in `public.subscriptions` with
  `provider = 'revenuecat'` and the correct `status`, `ux_tier`, and `current_period_end`
- A CANCELLATION event sets `current_period_end = now()` (immediate downgrade — deliberate
  Apple UX behavior, NOT a Stripe grace-period model)
- A duplicate event replay returns `{ duplicate: true }` and does not create a second row

---

## Idempotency Note

The webhook is idempotent via `subscription_events.event_id PRIMARY KEY`. If RevenueCat
retries a delivery, the duplicate event insert returns Postgres error `23505` → the
function returns `200 { duplicate: true }` and RC stops retrying. No duplicate
subscription row is created.

---

## Phase 70 Deferral Summary

| Item | Status | Owner |
|------|--------|-------|
| Webhook deployed + fail-soft | Done (Phase 16-06) | — |
| Test suite green (14 tests) | Verified (Phase 53-04) | — |
| REVENUECAT_WEBHOOK_AUTH value set | **Deferred to Phase 70** | Operator |
| REVENUECAT_WEBHOOK_AUTH RC dashboard config | **Deferred to Phase 70** | Operator |
| REVENUECAT_WEBHOOK_SECRET value set | **Deferred to Phase 70** | Operator |
| HMAC signing enabled in RC dashboard | **Deferred to Phase 70** | Operator |
| Live RC→mirror UAT (real device + real IAP) | **Deferred to Phase 70** | Operator |
