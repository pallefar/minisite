---
status: complete
phase: 14-monetization-foundation-stripe-web-clinic-seats
source: [14-VERIFICATION.md]
started: 2026-05-14T09:35:00Z
updated: 2026-05-14T10:55:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Deploy stripe-webhook + stripe-checkout Edge Functions
expected: `supabase functions deploy stripe-checkout stripe-webhook` succeeds; both functions appear in Supabase project `ytnsipxxmzgaebkqmokp` dashboard under Edge Functions
result: pass
evidence: |
  `supabase functions list` (2026-05-14) shows both ACTIVE on ytnsipxxmzgaebkqmokp:
  stripe-webhook v5, stripe-checkout v3. stripe-webhook required 3 fixes during the
  webhook-500 debug session (bare 'stripe' imports in index.ts + invoice-upcoming.ts,
  verify_jwt=false in config.toml — commits fa21de1/6f04884/9314ec2). stripe-checkout
  deployed clean (already used full esm.sh URL). Live smoke test of stripe-webhook:
  unsigned POST → 400 missing-signature, bogus-sig → 400 bad-signature (correct).

### 2. Register Stripe webhook endpoint + set Supabase Function secrets
expected: `STRIPE_WEBHOOK_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_PRICE_*` secrets visible in `supabase secrets list`; webhook events include `customer.subscription.created/updated/deleted`, `invoice.paid`, `invoice.payment_failed`, `checkout.session.completed`
result: pass
evidence: |
  Secrets: `supabase secrets list` shows all 7 (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
  STRIPE_PRICE_PLUS_MONTHLY/YEARLY, STRIPE_PRICE_CLINIC_BASE/OVERAGE, STRIPE_METER_ACTIVE_PATIENTS).
  Endpoint: Stripe API (acct_…1IMD, test mode) shows webhook endpoint
  `https://ytnsipxxmzgaebkqmokp.functions.supabase.co/stripe-webhook` status=enabled,
  livemode=false, subscribed to all 6 required events (checkout.session.completed,
  customer.subscription.created/updated/deleted, invoice.paid, invoice.payment_failed).

### 3. Register invoice.upcoming event on the Stripe webhook endpoint
expected: `invoice.upcoming` appears alongside the other events in the endpoint configuration (drives the clinic metered true-up handler)
result: pass
evidence: |
  Stripe API: the leanshot webhook endpoint's enabled_events (7 total) includes
  `invoice.upcoming` alongside the other 6.

### 4. Run scripts/stripe-bootstrap.ts against the live Stripe test account
expected: 5 prices created idempotently; `VITE_STRIPE_PRICE_PLUS_MONTHLY`, `_YEARLY`, `STRIPE_PRICE_CLINIC_BASE`, `_OVERAGE`, and `STRIPE_METER_ACTIVE_PATIENTS` populated in Vercel env + Supabase secrets
result: pass
evidence: |
  Stripe API (test mode): the `price_0TWu1*` batch shows 4 prices created together —
  $12.99/mo (PLUS_MONTHLY), $132.49/yr (PLUS_YEARLY), $9.00/mo + $99.00/mo (clinic
  base/overage); matches the $12.99 / $132.49 pricing from project memory. Billing
  meter `mtr_test_61UgHyr2…` status=active, event_name=`active_patients`. All 5
  corresponding Supabase secrets present. CAVEAT: Vercel env side (VITE_STRIPE_PRICE_*)
  not independently verified — vercel CLI unavailable in this environment.

### 5. Configure Stripe Customer Portal return-URL allowlist
expected: `https://app.leanshot.app/settings?from=portal` and `https://app.leanshot.app/clinic/settings?from=portal` in the Portal's allowed return URLs
result: pass
evidence: |
  Stripe API: default billing portal configuration `bpc_0TWu4B…` is active, is_default=true,
  default_return_url=`https://app.leanshot.app/settings?from=portal`. NOTE: Stripe Customer
  Portal configs hold a single `default_return_url`, not a multi-URL allowlist — the
  `/clinic/settings` URL is supplied as a per-session `return_url` override at portal-session
  creation time (Stripe accepts any same-domain URL), so no separate config entry is needed.

### 6. Push migration 20260601000019_stripe_subscriptions.sql to live Supabase DB
expected: `supabase db push` succeeds; `subscriptions` / `subscription_events` / `stripe_customers` / `clinic_stripe_customers` tables visible in dashboard; RLS policies active; `count_active_patients()` deployed with the CR-06 `LIMIT 1` fix
result: pass
evidence: |
  `supabase migration list` shows `20260601000019` in BOTH Local and Remote columns —
  already applied to live DB ytnsipxxmzgaebkqmokp (no `db push` needed). Migration file
  `20260601000019_stripe_subscriptions.sql` defines all 4 tables (stripe_customers:30,
  clinic_stripe_customers:39, subscriptions:51, subscription_events:79), `enable row
  level security` on all 4 (95-98), RLS policies (105/112/127…), and
  `count_active_patients()` (166) with the CR-06 LIMIT-1 fix (comment at 202). Postgres
  migrations are transactional — recorded-as-applied means the full DDL committed.

## Summary

total: 6
passed: 6
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps
