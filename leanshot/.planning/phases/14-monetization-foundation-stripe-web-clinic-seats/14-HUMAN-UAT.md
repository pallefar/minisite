---
status: partial
phase: 14-monetization-foundation-stripe-web-clinic-seats
source: [14-VERIFICATION.md]
started: 2026-05-14T09:35:00Z
updated: 2026-05-14T09:35:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Deploy stripe-webhook + stripe-checkout Edge Functions
expected: `supabase functions deploy stripe-checkout stripe-webhook` succeeds; both functions appear in Supabase project `ytnsipxxmzgaebkqmokp` dashboard under Edge Functions
result: [pending]

### 2. Register Stripe webhook endpoint + set Supabase Function secrets
expected: `STRIPE_WEBHOOK_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_PRICE_*` secrets visible in `supabase secrets list`; webhook events include `customer.subscription.created/updated/deleted`, `invoice.paid`, `invoice.payment_failed`, `checkout.session.completed`
result: [pending]

### 3. Register invoice.upcoming event on the Stripe webhook endpoint
expected: `invoice.upcoming` appears alongside the other events in the endpoint configuration (drives the clinic metered true-up handler)
result: [pending]

### 4. Run scripts/stripe-bootstrap.ts against the live Stripe test account
expected: 5 prices created idempotently; `VITE_STRIPE_PRICE_PLUS_MONTHLY`, `_YEARLY`, `STRIPE_PRICE_CLINIC_BASE`, `_OVERAGE`, and `STRIPE_METER_ACTIVE_PATIENTS` populated in Vercel env + Supabase secrets
result: [pending]

### 5. Configure Stripe Customer Portal return-URL allowlist
expected: `https://app.leanshot.app/settings?from=portal` and `https://app.leanshot.app/clinic/settings?from=portal` in the Portal's allowed return URLs
result: [pending]

### 6. Push migration 20260601000019_stripe_subscriptions.sql to live Supabase DB
expected: `supabase db push` succeeds; `subscriptions` / `subscription_events` / `stripe_customers` / `clinic_stripe_customers` tables visible in dashboard; RLS policies active; `count_active_patients()` deployed with the CR-06 `LIMIT 1` fix
result: [pending]

## Summary

total: 6
passed: 0
issues: 0
pending: 6
skipped: 0
blocked: 0

## Gaps
