---
phase: 65
slug: stripe-tax-payment-resilience
status: approved
shadcn_initialized: false
preset: none
created: 2026-05-26
reviewed_at: 2026-05-26
---

# Phase 65 — UI Design Contract: Stripe Tax + Payment Resilience

## Scope Note

Reuses LeanShot v1.4 design system established in Phases 60-13, 61, 62, 64. No new tokens/primitives/spacing/typography rules. Same color table + spacing scale + typography ceiling apply.

## Surfaces in Scope

### 1. `<PaymentFailedBanner>` (app shell)
- Renders TOP of app shell when `subscriptions.dunning_state IS NOT NULL`
- Background: `var(--color-rose-soft)` (warning surface, pre-validated in Phase 61)
- Copy varies by state:
  - `first_failed`: "We couldn't process your last payment. Please update your payment method."
  - `second_failed`: "Second payment attempt failed. Update your payment method to keep your access."
  - `final_warning`: "Your subscription will be cancelled if payment isn't updated within 24 hours."
- Primary CTA: `"Update payment method"` (NOT generic "Update") → Stripe billing portal deep-link
- Dismissible: NO — re-renders on every page until resolved (intentional friction)

### 2. `<RefundRequestForm>` at `/settings/billing/refund`
- Eligibility check inline (server-fetched on mount): "Your subscription is eligible for refund — submitted within the 14-day window."
- If ineligible: friendly message + link to support email
- Form: reason textarea + Submit CTA: `"Request refund"` (NOT generic "Submit")
- Cancel CTA: `"Keep my subscription"` (NOT generic "Cancel")
- Success state: "Your refund of $X has been processed. Allow 5-10 business days for funds to appear."

### 3. `/admin/tax` Nexus Dashboard
- Admin shell module entry alongside protocols/research
- Layout: header H1 "Tax Nexus Monitoring" + per-state revenue table + threshold-proximity bars
- Each row: state code + state name + YTD revenue (cents formatted) + threshold + proximity % + status badge
- Status badges: `safe` (<60%) → text-text-secondary; `monitoring` (60-80%) → warning tone; `at_risk` (≥80%) → danger tone; `nexus_established` (≥100%) → primary tone with "Registration required" label
- "Last refreshed" timestamp + Refresh button (operator-triggered)

### 4. Trial-ending / Win-back email templates
- HTML + plain text variants per Resend convention
- Trial-ending T-3d copy variant via PostHog flag
- Win-back templates with embedded promo code (Stripe Promotion Code)
- CAN-SPAM footer + unsubscribe (mirror Phase 64-03 grandfathered-notice)

## Copywriting Contract

- Primary CTAs (verb+noun): `"Update payment method"`, `"Request refund"`, `"Choose your plan"` (trial-ending), `"Reactivate subscription"` (win-back)
- Cancel CTAs (no generic "Cancel"): `"Keep my subscription"`
- Error states: include solution path with `billing-support@leanshot.app` fallback
- Destructive: refund request shows confirmation modal with verbatim copy: "Request a refund? Your subscription will be cancelled immediately and a credit will be issued to your original payment method within 5-10 business days."

## Reuse Targets

- `Card.tsx`, `Modal.tsx`, `Input.tsx`, `Select.tsx`, `Badge.tsx`, `Button.tsx`, `EmptyState.tsx` from `src/components/ui/`
- `Banner.tsx` (if exists, else compose from Card with danger tone) for PaymentFailedBanner
- Resend email template patterns from Phase 60-12 + Phase 64-03

## Registry Safety

No third-party UI registries. Tailwind v4 `@theme` tokens only.
