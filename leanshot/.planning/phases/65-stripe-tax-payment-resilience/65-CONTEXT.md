# Phase 65: Stripe Tax + Payment Resilience - Context

**Gathered:** 2026-05-26
**Status:** Ready for planning
**Mode:** Smart Discuss (autonomous, compressed) — prescriptive requirements, zero grey areas

<domain>
## Phase Boundary

v1.4 launch BLOCKER. Stripe Tax enablement + payment resilience patterns: automatic_tax in all checkout sessions + B2B tax_id collection + nexus-monitoring dashboard + 3-stage dunning email sequence + payment-failed banner + dunning state machine + refund self-service + webhook idempotency burst-retry test + trial-ending lifecycle emails + win-back campaign.

**Surfaces delivered (12):**
1. `stripe-checkout/index.ts` extension — `automatic_tax: { enabled: true }` + `customer_update.address: 'auto'` + `tax_id_collection.enabled: true` for B2B
2. `tax_collection_log` table tracking Stripe Tax calculations
3. `subscriptions.dunning_state` column + state machine (`none` → `first_failed` → `second_failed` → `final_warning` → `cancelled_for_payment`)
4. `dunning_emails_sent` audit table (idempotency)
5. `stripe-dunning-orchestrator` Edge Fn (cron-driven; reads subs in failing state, fires Resend emails)
6. `<PaymentFailedBanner>` component on app shell
7. `/admin/tax` nexus-monitoring dashboard (Stripe Tax Reports API)
8. `request-refund` Edge Fn (eligibility check + Stripe refund + log row)
9. `<RefundRequestForm>` component (within trial OR N-day money-back window)
10. Stripe webhook idempotency burst-retry test (5× same event_id, single-row outcome)
11. `lifecycle-trial-ending` Edge Fn (T-3d + T-1d emails, PostHog A/B copy variant)
12. `lifecycle-win-back` Edge Fn (T+30d/T+60d/T+90d emails post-cancel, per-user coupons)

**Out of scope (defer to v1.5 / later):**
- Stripe Atlas tax-residency conversion
- VAT for EU residents (US-only launch)
- 1099-K affiliate-payout reporting (Phase 26 affiliate already handles separately)
- Crypto / ACH / alternative payment methods

</domain>

<decisions>
## Implementation Decisions

### Stripe Tax + B2B tax_id Collection

- **All checkout sessions get**: `automatic_tax: { enabled: true }` + `customer_update: { address: 'auto', name: 'auto' }`
- **Consumer flows**: customer-address-on-file feeds Tax calc; no extra collection
- **B2B clinic-org flows**: ADD `tax_id_collection: { enabled: true }` + on completion webhook, mirror collected tax_id to `org_subscriptions.tax_id` column (new — ALTER TABLE)
- **Stripe Tax must be enabled in Dashboard BEFORE deploy** — operator action documented in CARRY-OVER; check via `stripe.tax.calculations.create()` smoke test at deploy time
- **Migration**: `ALTER TABLE org_subscriptions ADD COLUMN IF NOT EXISTS tax_id text`

### Nexus Monitoring Dashboard

- **`/admin/tax`** new route in admin shell (`tax` module alongside `protocols`, `research`, etc.)
- **Daily cron** `nexus-monitor` Edge Fn calls Stripe Tax Reports API (`stripe.tax.reports.list()` or transactions list aggregated by state)
- **`tax_nexus_thresholds`** table (state, threshold_amount_cents, threshold_period_days) seeded with US economic-nexus thresholds (CA $500k/yr, TX $500k/yr, NY $500k/yr, etc.)
- **`tax_nexus_state_revenue`** matview refreshed daily with per-state revenue + threshold-proximity %
- **Slack alert** via `SLACK_GUARDRAIL_WEBHOOK_URL` (Phase 60.5) when state crosses 80% of nexus threshold

### Dunning State Machine

- **`subscriptions.dunning_state` enum**: `'none' | 'first_failed' | 'second_failed' | 'final_warning' | 'cancelled_for_payment'`
- **`dunning_emails_sent`** table: `(subscription_id, stage, sent_at)` composite PK for idempotency
- **State transitions** via Stripe webhook handlers (`invoice.payment_failed` + `customer.subscription.updated`):
  - First failure: `none` → `first_failed` (T+1d email)
  - Second failure: `first_failed` → `second_failed` (T+3d email)
  - Final retry failure: `second_failed` → `final_warning` (T+7d email, cancellation imminent)
  - Stripe-cancelled: → `cancelled_for_payment`
- **Cron-driven** `stripe-dunning-orchestrator` Edge Fn reads `subscriptions WHERE dunning_state IS NOT NULL AND last_email_sent_at < now() - interval` + fires next-stage email
- **`<PaymentFailedBanner>`** component reads `useStore((s) => s.user?.subscription?.dunning_state)` and renders banner with CTA to billing portal deep-link

### Refund Self-Service

- **Eligibility**: within trial period OR within 14-day money-back window (ROSCA-compliant per FTC Restore Online Shoppers' Confidence Act)
- **`request-refund`** Edge Fn:
  1. Validate JWT + load `subscriptions` row
  2. Check `trial_end_at > now()` OR `(now() - created_at) < interval '14 days'`
  3. If eligible: `stripe.refunds.create({ payment_intent, reason: 'requested_by_customer' })`
  4. Insert `refunds(subscription_id, stripe_refund_id, amount_cents, status, reason, created_at)` audit row
  5. Trigger Resend confirmation email
- **`<RefundRequestForm>`** component at `/settings/billing/refund` — shows eligibility check + reason textarea + Submit CTA: "Request refund" (NOT generic "Submit")
- Receipt-page footer CTA: "Request a refund →" links to form

### Webhook Idempotency Burst-Retry Test

- New Deno test at `supabase/functions/stripe-webhook/__tests__/burst-retry.test.ts`
- Sends 5× same `event_id` in `<1s` to handler
- Asserts: single-row outcome for `affiliate_eligibility` flip, `ux_tier` flip, `subscription_events` insert
- Validates existing Stripe webhook idempotency mechanism (likely already exists; this test ratifies it)

### Lifecycle Emails

- **Trial-ending** (`lifecycle-trial-ending` Edge Fn, cron-driven daily):
  - Query: `subscriptions WHERE status='trialing' AND trial_end_at BETWEEN now() + interval '3 days' AND now() + interval '4 days'` → T-3d send
  - Query: same with `'1 day'/'2 days'` → T-1d send
  - PostHog A/B copy variant via flag `trial_ending_copy_variant` (already in feature-flag system per Phase 33-36)
  - Idempotent: `lifecycle_emails_sent(user_id, stage, sent_at)` table
- **Win-back** (`lifecycle-win-back` Edge Fn, cron-driven weekly):
  - Query: `subscriptions WHERE status='cancelled' AND cancelled_at BETWEEN now() - interval '60d 7d' AND now() - interval '53d'` → T+60d send (similar for T+30d, T+90d)
  - Per-user reactivation coupon via Stripe Promotion Codes API: `stripe.promotionCodes.create({ coupon, max_redemptions: 1, customer })`
  - Honors `profiles.email_marketing_consent` + unsubscribe (per CAN-SPAM + LEGAL-09)

### Claude's Discretion

- Naming of new components (suggested: `PaymentFailedBanner`, `RefundRequestForm`, `TaxDashboard`)
- Migration timestamps `20290104000001+` (Phase 65; after Phase 64's `20290103*` cluster)
- Edge Fn handler/index split with `if (import.meta.main) Deno.serve` guard
- Whether to extend existing `subscriptions` table or create sibling `subscription_dunning_state` table — pick ALTER TABLE for simplicity

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`stripe-checkout/index.ts`** (Phase 14/26/40) — extend with automatic_tax + customer_update + tax_id_collection
- **`stripe-webhook/handler.ts`** (Phase 14/40) — extend with `invoice.payment_failed` handler + dunning state transitions
- **`subscriptions` table** (Phase 14) — ALTER TABLE add dunning_state + last_dunning_email_at
- **`org_subscriptions` table** (Phase 28) — ALTER TABLE add tax_id
- **Resend lifecycle pattern** (Phase 60-12 newsletter + Phase 64-03 grandfathered-notice) — copy template structure
- **PostHog A/B flag pattern** (Phase 33-36) — `trial_ending_copy_variant`
- **Admin shell** — register `tax` module alongside protocols/research
- **pg_cron vault-bearer pattern** [[reference_supabase_pg_cron_vault_service_role_pattern]]

### Established Patterns
- Edge Fn handler/index.ts split with `if (import.meta.main) Deno.serve` guard
- Bare `CREATE POLICY` (no `IF NOT EXISTS`)
- Migration timestamps forward-dated `20290104*`
- DI for testability + placeholder runtime guards on env vars

### Integration Points
- Admin shell modules.ts: register `tax` entry
- Settings page billing section: link to refund form
- App shell: PaymentFailedBanner conditional render
- Receipt page footer: refund CTA link

</code_context>

<specifics>
## Specific Ideas

- **14-day money-back window** per FTC ROSCA — clear, defensible refund SLA
- **T-3d + T-1d trial-ending cadence** (not T-7d) — closer to decision moment, higher conversion impact
- **T+30/60/90d win-back** with escalating discount (e.g., 10% / 25% / 50% reactivation coupons)
- **Slack guardrail webhook** reused for nexus-threshold-proximity alerts (vendor already configured in Phase 60.5)
- **Receipt-page CTA**: "Request a refund →" — gives users clear self-service path, reduces support burden

</specifics>

<deferred>
## Deferred Ideas

- EU VAT compliance — out of scope (US-only launch)
- Stripe Atlas tax-residency conversion — separate milestone
- Crypto / ACH payment methods — v1.5
- 1099-K affiliate-payout reporting — Phase 26 handles separately
- Multi-currency tax — single USD currency at launch

</deferred>
