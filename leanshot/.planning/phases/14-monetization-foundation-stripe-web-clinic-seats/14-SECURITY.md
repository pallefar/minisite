---
phase: 14-monetization-foundation-stripe-web-clinic-seats
audit_date: 2026-05-14
re_audit_date: 2026-05-16
auditor: gsd-security-auditor (claude-sonnet-4-6)
asvs_level: L1
block_on: high
threats_total: 42
threats_mitigate: 32
threats_accept: 10
threats_closed: 42
threats_open: 0
status: SECURED
re_audit_trigger: Phase 19 drift in stripe-webhook/index.ts (559388b) and stripe-checkout/index.ts (30f8fb5)
phase_19_followup_flags: 5  # P19-F1..P19-F5 — informational, evaluated at /gsd-secure-phase 19
---

# Phase 14 Security Audit

## Summary

All 32 `mitigate`-disposition threats verified by grep evidence in the implementation.
All 10 `accept`-disposition threats confirmed with coherent rationale.
Zero unregistered flags from SUMMARY.md threat-flag section.

---

## Threat Verification

### Plan 14-01 — Subscriptions schema + RLS (migration 20260601000019_stripe_subscriptions.sql)

| Threat ID | Category | Disposition | Status | Evidence |
|-----------|----------|-------------|--------|----------|
| T-14-01 | InfoDisclosure | mitigate | CLOSED | `20260601000019_stripe_subscriptions.sql:107` — `using (auth.uid() = user_id)` on subscriptions SELECT policy. Only the owning user's row is visible. |
| T-14-02 | InfoDisclosure | mitigate | CLOSED | `20260601000019_stripe_subscriptions.sql:127-143` — clinic-tier branch in `users read own sub` policy requires `EXISTS` on `memberships` JOIN `roles` with `r.name = 'Owner'` and `m.revoked_at IS NULL`. Cross-clinic rows return 0 rows. |
| T-14-03 | InfoDisclosure | mitigate | CLOSED | `20260601000019_stripe_subscriptions.sql:112-124` — `clinic admins read clinic customer` policy requires `EXISTS` on `memberships` JOIN `roles` where `r.name = 'Owner'` AND `m.revoked_at IS NULL`. Non-owner roles and cross-clinic reads denied. |
| T-14-04 | Tampering | mitigate | CLOSED | `20260601000019_stripe_subscriptions.sql:98` — `ALTER TABLE public.subscription_events ENABLE ROW LEVEL SECURITY`. No `CREATE POLICY` for `subscription_events` exists in the migration (grep returns zero matches). RLS with zero policies = deny-all for authenticated. Comment at line 145 documents intent: `-- subscription_events: service_role only; no policies = deny-all for authenticated`. |
| T-14-05 | ElevationOfPrivilege | mitigate | CLOSED | `20260601000019_stripe_subscriptions.sql:174-191` — `DECLARE v_uid uuid := auth.uid()`. When `v_uid IS NOT NULL`, function checks `memberships` JOIN `roles` for `r.name = 'Owner'` and raises `42501 forbidden` if not found. Service-role callers (auth.uid() = NULL) bypass the check. |
| T-14-06 | Tampering | mitigate | CLOSED | `20260601000019_stripe_subscriptions.sql:170` — `set search_path = public, extensions` present in `count_active_patients()` SECURITY DEFINER function definition. |
| T-14-07 | DoS | accept | CLOSED | Accepted risk with coherent rationale: 30-day activity window in `count_active_patients()` bounds the `EXISTS` subquery to recent rows. Materialized view deferred to Phase 19+. Accepted for v1.2 scope. |
| T-14-08 | Repudiation | accept | CLOSED | Accepted risk with coherent rationale: `subscription_events` table is the audit trail — every state change comes from a webhook INSERT with full Stripe payload. No additional audit_logs row required. |

### Plan 14-03 — stripe-webhook Edge Function (index.ts + cors.ts)

| Threat ID | Category | Disposition | Status | Evidence |
|-----------|----------|-------------|--------|----------|
| T-14-03-S1 | Spoofing | mitigate | CLOSED | `stripe-webhook/index.ts:148-149` — `if (!signature) return jsonResponse(400, { error: 'missing-signature' })`. `stripe-webhook/index.ts:160-172` — `constructEventAsync(body, signature, webhookSecret, undefined, cryptoProvider)` in try/catch; throws → `return jsonResponse(400, { error: 'bad-signature' })`. |
| T-14-03-T1 | Tampering | mitigate | CLOSED | `stripe-webhook/index.ts:182-192` — `admin.from('subscription_events').insert({ event_id: event.id, ... })`. On `insertErr.code === '23505'` returns `200 { duplicate: true }`. Event ID PRIMARY KEY in schema enforces uniqueness. |
| T-14-03-T2 | Tampering | mitigate | CLOSED | `stripe-webhook/index.ts:155` — `const body = await request.text()` is the first body operation; comment `// RAW BODY — DO NOT JSON.parse before verify`. `request.json()` never appears before `constructEventAsync` (grep returns zero matches). |
| T-14-03-R1 | Repudiation | mitigate | CLOSED | `stripe-webhook/index.ts:183-185` — INSERT includes `event_id`, `event_type`, and `payload: event` (full Stripe event object). Schema column `received_at timestamptz NOT NULL DEFAULT now()` at migration line 84 provides timestamp. |
| T-14-03-I1 | InfoDisclosure | mitigate | CLOSED | `stripe-webhook/index.ts:204-209` — catch block logs `err.message` only, never `event.data.object`. All error responses are `{ error: '<short-code>' }` (grep confirms no `event.data.object` appears in any `JSON.stringify` or `new Response` call). |
| T-14-03-I2 | InfoDisclosure | mitigate | CLOSED | `stripe-webhook/cors.ts:13-16` — `BASE_RESPONSE_HEADERS` exported with `'Cache-Control': 'private, no-store'`. `jsonResponse` helper at `index.ts:59-63` passes these headers on every response. OPTIONS preflight at `index.ts:138-139` also uses `BASE_RESPONSE_HEADERS`. |
| T-14-03-D1 | DoS | accept | CLOSED | Accepted risk with coherent rationale: signature verify on bogus payloads is fast, returns 400 with no DB write. Platform rate limiting at function level is sufficient for v1.2. Revisit if abuse pattern emerges. |
| T-14-03-E1 | ElevationOfPrivilege | mitigate | CLOSED | `stripe-webhook/index.ts:54` — `Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')` is the single functional read; result stored into `admin` constant. Lines 17/29/50 are comment-only references. Key never interpolated into any response or thrown error string (grep confirms zero occurrences of the key value in response paths). |

### Plan 14-04 — stripe-checkout Edge Function (index.ts)

| Threat ID | Category | Disposition | Status | Evidence |
|-----------|----------|-------------|--------|----------|
| T-14-04-01 | Spoofing | mitigate | CLOSED | `stripe-checkout/index.ts:292-293` — `if (!jwt) return jsonError(401, 'unauthenticated')`. `index.ts:295-296` — `adminInstance.auth.getUser(jwt)` validates JWT via Supabase admin; on error returns 401. Both `/session` and `/portal` handlers enforce this gate. |
| T-14-04-02 | Spoofing | mitigate | CLOSED | `stripe-checkout/index.ts:323-332` — clinic-mode queries `memberships` + `roles!inner(name)` for `org_id = clinicId`, `user_id = user.id`, `revoked_at IS NULL`; if `roleName !== 'Owner'` returns `403 forbidden`. |
| T-14-04-03 | Tampering | accept | CLOSED | Accepted risk with coherent rationale: `stripe_customers` is keyed on `auth.uid()` from JWT, not from request body; customer reuse across users requires compromising the JWT itself. |
| T-14-04-04 | Repudiation | accept | CLOSED | Accepted risk with coherent rationale: Stripe audit log + `subscription_events` table (written by webhook) is the system of record for Checkout initiation. |
| T-14-04-05 | InfoDisclosure | mitigate | CLOSED | `stripe-checkout/index.ts:394-395` — on Stripe session create failure: `console.error(... err.message ...)` + `return jsonError(500, 'checkout_failed')`. `index.ts:481-482` — portal failure: `return jsonError(500, 'portal_failed')`. No `JSON.stringify(stripeErr)` in any response body. |
| T-14-04-06 | DoS | mitigate | CLOSED | `stripe-checkout/index.ts:292-296` — JWT validation at top of both handlers is the gate; no Stripe API call fires for unauthenticated requests. Customer mapping uses SELECT-first idempotent pattern (lines 184-226). |
| T-14-04-07 | ElevationOfPrivilege | mitigate | CLOSED | Same code path as T-14-04-02 (`index.ts:323-332` and `429-439`). Owner-only check enforced in both `/session` (clinic plan branch) and `/portal` (clinic mode). |
| T-14-04-08 | Tampering | mitigate | CLOSED | `stripe-checkout/index.ts:368-369` — `successUrl` and `cancelUrl` built from `getPublicAppOrigin()` which reads `PUBLIC_APP_ORIGIN` env var (`index.ts:73`). No user-supplied URL field in the request body is used in URL construction. |
| T-14-04-09 | InfoDisclosure | transfer | CLOSED | Transfer documentation present in `14-VERIFICATION.md` human_verification checkpoint 5: "Configure Stripe Customer Portal return-URL allowlist — https://app.leanshot.app/settings?from=portal in Portal allowed return URLs". Confirmed completed per `14-HUMAN-UAT.md` (6/6 PASS noted in VERIFICATION.md:47). |
| T-14-04-10 | Tampering | mitigate | CLOSED | `stripe-checkout/index.ts:213` — on INSERT error with `pgCode === '23505'`, re-SELECTs and returns existing customer ID. Same pattern for clinic at `index.ts:264`. Both `ensureWebCustomer` and `ensureClinicCustomer` implement the UNIQUE-conflict-aware re-SELECT path. |

### Plan 14-07 — invoice-upcoming handler (events/invoice-upcoming.ts)

| Threat ID | Category | Disposition | Status | Evidence |
|-----------|----------|-------------|--------|----------|
| T-14-07-01 | Spoofing | mitigate | CLOSED | Inherited from dispatcher: `stripe-webhook/index.ts:160-172` — `constructEventAsync` HMAC verify fires before `dispatch()` is called. `invoice-upcoming.ts` `handle()` function is only reachable after signature verification passes. |
| T-14-07-02 | Tampering | mitigate | CLOSED | `invoice-upcoming.ts:113-115` — `periodStartMarker = new Date(periodStart * 1000).toISOString().slice(0, 7)` (YYYY-MM); `identifierRaw = \`${clinicId}_${periodStartMarker}\``; `hashHex = await sha256Hex(identifierRaw)`. 64-char SHA-256 hex identifier passed to `stripe.billing.meterEvents.create({ ..., identifier: hashHex })` at line 132. Stripe deduplicates server-side. |
| T-14-07-03 | Tampering | mitigate | CLOSED | `invoice-upcoming.ts:59-68` — `clinicId` is resolved by querying `clinic_stripe_customers` WHERE `stripe_customer_id = customerId` (the customer ID from the HMAC-verified event payload). No request-body or user-supplied clinic_id accepted. |
| T-14-07-04 | InfoDisclosure | mitigate | CLOSED | `invoice-upcoming.ts:137-143` — success log includes only `event_id`, `clinic_id`, `active_count`, `overage`, and `identifier_prefix` (first 8 chars). No `event.data.object`, no customer email, no payment data. Error logs at lines 51, 78, 93 contain only structural metadata (event_id, message, age_days). |
| T-14-07-05 | DoS | accept | CLOSED | Accepted risk with coherent rationale: Stripe SDK handles 5xx retries automatically. Handler propagates errors → dispatcher returns 500 → Stripe retries within 24h window. |
| T-14-07-06 | InfoDisclosure | mitigate | CLOSED | `invoice-upcoming.ts:59-70` — `clinicId` resolved exclusively from `clinic_stripe_customers` keyed on the trusted Stripe customer ID from the verified event. `count_active_patients(clinicId)` at line 87 uses only this trusted ID. Cross-tenant count would require the attacker to forge the Stripe customer ID in a signed webhook. |
| T-14-07-07 | Tampering | mitigate | CLOSED | `invoice-upcoming.ts:76-83` — `ageDays = (Date.now() - periodStart * 1000) / (1000 * 86400)`. `if (ageDays > 35)` → `console.warn(... 'period_start older than 35 days' ...)` and `return` (no meter event). |
| T-14-07-08 | Repudiation | accept | CLOSED | Accepted risk with coherent rationale: Stripe Dashboard logs every `meterEvents.create` call. `console.info` at line 137 provides cross-reference with `event.id`. No separate audit trail needed for v1.2. |

### Plan 14-08 — e2e billing specs (clinic-metered-billing.spec.ts)

| Threat ID | Category | Disposition | Status | Evidence |
|-----------|----------|-------------|--------|----------|
| T-14-08-01 | InfoDisclosure | mitigate | CLOSED | `clinic-metered-billing.spec.ts` — test annotations log only `count_active_patients` integer result, webhook HTTP status, and `meterEventSummaries.data.length` + `aggregated_value`. No full Stripe event payloads logged anywhere in the spec file. |
| T-14-08-02 | Tampering | accept | CLOSED | Accepted risk with coherent rationale: `fireWebhookEvent` fixture operates against test-mode handler only; production webhook secrets are never reachable from the test environment. |
| T-14-08-03 | ElevationOfPrivilege | mitigate | CLOSED | `clinic-metered-billing.spec.ts:87,184,217` — `admin = createClient(SUPABASE_URL, SERVICE_ROLE, ...)` used only in `beforeAll`, `afterAll`, and the Node-side assertion block. No `page.evaluate`, `page.addInitScript`, or `page.goto` calls appear in the spec file; the service-role client is never passed to the browser context. |
| T-14-08-04 | Repudiation | accept | CLOSED | Accepted risk with coherent rationale: webhook handler is idempotent via `ON CONFLICT(event_id) DO NOTHING`; replayed fixture events return 200 without duplicating DB rows. |
| T-14-08-05 | Spoofing | accept | CLOSED | Accepted risk with coherent rationale: `admin.auth.admin.createUser({ email_confirm: true })` is test-design intent; production authentication flow is not exercised in this spec. |

### Plan 14-10 — invoice handler fix (invoice-paid.ts + invoice-payment-failed.ts)

| Threat ID | Category | Disposition | Status | Evidence |
|-----------|----------|-------------|--------|----------|
| T-14-10-T1 | Tampering | mitigate | CLOSED | Both handlers reachable only through `stripe-webhook/index.ts` dispatcher (lines 116, 119) which requires `constructEventAsync` to succeed (HMAC-verified) before any dispatch. No separate entry surface. |
| T-14-10-I1 | InfoDisclosure | mitigate | CLOSED | `invoice-paid.ts:36` — `console.error('[stripe-webhook/invoice-paid] update error', error.message)`. `invoice-payment-failed.ts:31` — `console.error('[stripe-webhook/invoice-payment-failed] update error', error.message)`. Both log `error.message` only; thrown Error carries a short code string without invoice fields. |
| T-14-10-D1 | DoS | mitigate | CLOSED | `invoice-payment-failed.ts:25-26` — writes `ux_tier: 'past_due', status: 'past_due'` directly on payment failure. `invoice-paid.ts:29-31` — writes `ux_tier: 'paid', status: 'active'` directly on payment success. CR-04 inverted-logic bug confirmed fixed (neither handler reads the non-existent `invoice.subscription_status` field). |

---

## Accepted Risks Log

| Threat ID | Category | Rationale |
|-----------|----------|-----------|
| T-14-07 | DoS | `count_active_patients()` over large clinics: 30-day activity window bounds EXISTS subquery. Materialized view option deferred to Phase 19+. Acceptable for v1.2 scale. |
| T-14-08 | Repudiation | `subscription_events` IS the audit trail. Every webhook state change is an INSERT with full Stripe event payload. No separate audit_logs row needed. |
| T-14-03-D1 | DoS | Bogus-payload flood: signature verify on bad payloads is fast (~0.1ms, returns 400, no DB write). Platform-level rate limiting is sufficient for v1.2. |
| T-14-04-03 | Tampering | Stripe customer reuse: customer lookup keyed on `auth.uid()` from JWT. Cross-user customer reuse requires JWT compromise, not a billing-layer attack. |
| T-14-04-04 | Repudiation | Checkout initiation denial: Stripe audit log + `subscription_events` (written by webhook on `checkout.session.completed`) is the system of record. |
| T-14-07-05 | DoS | Stripe Billing Meters API transient errors: Stripe SDK handles 5xx retries. Handler propagates errors → dispatcher 500 → Stripe 24h retry curve. |
| T-14-07-08 | Repudiation | Meter event audit: Stripe Dashboard logs every `meterEvents.create`. `console.info` cross-references `event.id`. Adequate for v1.2. |
| T-14-08-02 | Tampering | Fixture-forged signed events: test-mode only; production secrets are unreachable from the test environment. |
| T-14-08-04 | Repudiation | Webhook fixture replay: idempotent via `ON CONFLICT(event_id) DO NOTHING` — replays are no-ops. |
| T-14-08-05 | Spoofing | Test user bypasses email verification: `admin.auth.admin.createUser({ email_confirm: true })` is test-design intent. Production auth flow not exercised. |

---

## Unregistered Flags

None. All threat flags from SUMMARY.md `## Threat Flags` sections map to registered threat IDs in the threat register.

---

## Verification Notes

### T-14-03-E1 — Service-role key handling
The `SUPABASE_SERVICE_ROLE_KEY` string appears 4 times in `stripe-webhook/index.ts`. Three occurrences (lines 17, 29, 50) are in comment blocks. One occurrence (line 54) is the single functional `Deno.env.get()` read that stores the value into the `admin` client constant. The key is never interpolated into any response body, error message, or log statement.

### T-14-04-09 — Portal return_url allowlist (transfer disposition)
This threat is classified `transfer` in that the allow-list configuration is a Stripe Dashboard manual step rather than code. Transfer documentation is present in `14-VERIFICATION.md` human_verification checkpoint 5, and the step is confirmed completed per `14-HUMAN-UAT.md` (6/6 pass evidence cited in VERIFICATION.md line 47). Classified CLOSED.

### T-14-10-D1 — Inverted dunning trigger (CR-04 fix)
The original `invoice-payment-failed.ts` read `invoice.subscription_status` (a non-existent field), which always resolved to `undefined`, causing `mapStripeStatusToUxTier('active')` to return `'paid'` — the exact inverse of the intended behavior. Plan 14-10 replaced this with a direct `ux_tier='past_due'` write. The fixed implementation at `events/invoice-payment-failed.ts:25-26` confirms the correction. No remnants of `subscription_status` or `as unknown as` casts appear in either invoice handler.

### count_active_patients() LIMIT 1 fix (CR-06)
Migration `20260601000019_stripe_subscriptions.sql` lines 201-218 confirm the UNION ALL EXISTS subquery has no misplaced `LIMIT 1`. All 5 activity table arms (injections, weights, meals, workouts, symptoms) are checked. The comment at line 202 explicitly documents the CR-06 fix.

---

## Security Audit 2026-05-16 (re-pass after Phase 19 drift)

| Metric | Count |
|--------|-------|
| Threats found | 42 (unchanged) |
| Closed | 42 |
| Open | 0 |
| Status | **SECURED** |

### Drift trigger

Two audited files were modified post the 2026-05-14 audit:
- `supabase/functions/stripe-webhook/index.ts` — commit `559388b feat(19-04): invoice.paid affiliate conversion (D-36 renewal)`. Phase 19 added an `account.updated` dispatch arm + an `invoice.paid` affiliate-conversion handler hook.
- `supabase/functions/stripe-checkout/index.ts` — commit `30f8fb5 feat(19-04): propagate aff_code from ?aff/?aff_manual/_aff cookie`. Phase 19 added a `resolveAffCode()` helper + propagation into Checkout session metadata.

### Re-verification verdict

All six `stripe-webhook` threat mitigations (T-14-03-S1/T1/T2/I1/I2/E1) verified structurally identical at new line numbers — the new `account.updated` arm is reachable only after the unconditional `constructEventAsync` HMAC gate (lines 164-179), and the `handleInvoicePaid` hook runs inside the post-idempotency `dispatch()` call (line 208). All four `stripe-checkout` threat mitigations (T-14-04-01/02/08/10) verified intact — `resolveAffCode(req)` is called at line 420, strictly after JWT validation (lines 336-341) and Owner-role check (lines 367-378); `aff_code` is placed only in metadata fields, never in URL construction.

`stripe-webhook/cors.ts`, `stripe-webhook/events/invoice-upcoming.ts`, and migration `20260601000019_stripe_subscriptions.sql` not modified since prior audit — original grep evidence still holds.

### Phase 19 follow-up flags (NOT Phase 14 threats — for Phase 19's own security audit)

These are new attack surface introduced by Phase 19 into the Phase 14 code paths. They do not affect Phase 14 SECURED status but should be evaluated when `/gsd-secure-phase 19` runs.

- **P19-F1** — `aff_code` length-cap relies on `REFERRAL_CODE_PATTERN` `{4,80}` at `stripe-checkout/index.ts:56`. Adequate vs Stripe's 500-char metadata ceiling; Phase 19 auditor confirms.
- **P19-F2** — `_aff` cookie HttpOnly enforcement lives in Plan 19-02 `affiliate-attribute` Edge Function, NOT at this read site. Phase 19 auditor must verify the Set-Cookie header in that function.
- **P19-F3** — `readAffCodeFromInvoice` (`invoice-paid.ts:50-68`) reads `aff_code` from Stripe payload without regex validation. Constrained by T-14-03-S1 (HMAC verify) so adversary needs webhook secret. Defense-in-depth: add regex gate.
- **P19-F4** — `resolveAffCode` uses `adminInstance` (service role) for the affiliates lookup. By-design but Phase 19 auditor should confirm `affiliates` table has no columns that must be hidden from the service-role path.
- **P19-F5** — `invoice-paid.ts:125-126` throws `'affiliate-lookup-failed'` on DB error → propagates to dispatcher → 500 → Stripe 24h retry curve. A persistent DB error would loop retries against the already-succeeded Phase 14 tier-sync path. Phase 19 auditor should evaluate making this a no-op log rather than a throw.

### Re-pass note

All 42 Phase 14 threats CLOSED. Original audit (2026-05-14) verdict carries forward unchanged. The 5 Phase 19 follow-up flags are informational forward-pointers — they will be evaluated when Phase 19 is secured separately. Phase 14 ready for milestone-close.
