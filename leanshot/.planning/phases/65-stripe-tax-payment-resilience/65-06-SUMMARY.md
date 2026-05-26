---
phase: 65-stripe-tax-payment-resilience
plan: 06
subsystem: stripe-refund
tags: [stripe, refund, edge-fn, can-spam, rosca, jwt-auth, tdd]
requires:
  - supabase/migrations/20290104000004_refunds.sql      # 65-01 refunds table
  - supabase/migrations/20260601000019_stripe_subscriptions.sql # subscriptions table
  - supabase/functions/_shared/newsletter-token.ts      # HMAC unsubscribe envelope
  - supabase/functions/_shared/slack-guardrail-alert.ts # P1 alert helper
provides:
  - supabase/functions/request-refund/handler.ts        # PAY-08 backend
  - supabase/functions/request-refund/index.ts          # Deno.serve entry
  - supabase/functions/_shared/email-templates/refund-confirmation.html
  - supabase/functions/_shared/email-templates/refund-confirmation.txt
affects:
  - subscriptions table  # cancellation via Stripe webhook reflection (Plan 65-04)
  - refunds table        # INSERT new audit row per refund
tech-stack:
  added:
    - "stripe@19?target=denonext"
    - "@supabase/supabase-js@2.45.0"
  patterns:
    - "Handler/index split + import.meta.main Deno.serve guard"
    - "DI seam: RequestRefundDeps for fetchImpl/stripe/supabase/resend"
    - "FakeStripe + FakeAdmin stubs in Deno tests"
    - "CAN-SPAM placeholder runtime guard (PHYSICAL_ADDRESS) per WR-02"
key-files:
  created:
    - supabase/functions/request-refund/handler.ts
    - supabase/functions/request-refund/index.ts
    - supabase/functions/request-refund/deno.json
    - supabase/functions/request-refund/__tests__/handler.test.ts
    - supabase/functions/_shared/email-templates/refund-confirmation.html
    - supabase/functions/_shared/email-templates/refund-confirmation.txt
  modified: []
decisions:
  - "subscriptions.id IS the Stripe sub_xxx (Phase 14 natural PK); no separate stripe_subscription_id column"
  - "subscriptions.trial_end (not trial_end_at per CONTEXT.md draft) — actual schema column name"
  - "Plan-spec `inTrial && no_paid_invoice` branch returns 200 trial_no_charge_to_refund + still cancels sub"
  - "Email templates kept as reference files; handler renders inline (mirrors grandfathered-policy-notice pattern)"
  - "Sub cancel failure is best-effort (T-65-06-06 accept) — Slack P1 alert + don't roll back refund"
metrics:
  duration: "~25 min"
  completed: "2026-05-26"
requirements: [PAY-08]
---

# Phase 65 Plan 65-06: Refund Self-Service Backend Summary

## One-liner

JWT-authed `request-refund` Edge Fn with trial / 14-day-money-back eligibility check, Stripe refund + subscription cancel, refunds audit insert, Resend confirmation email, and CAN-SPAM PHYSICAL_ADDRESS guard.

## What Was Built

PAY-08 backend (`request-refund` Edge Fn) per FTC ROSCA (Restore Online Shoppers' Confidence Act) 14-day money-back window. User-callable Edge Fn at `supabase/functions/request-refund/`:

- **Auth:** `Authorization: Bearer <USER_JWT>` resolved via `supabaseServiceClient.auth.getUser(jwt)` (NOT service-role — distinct from `grandfathered-policy-notice`).
- **Eligibility matrix:** `trial_end > now()` OR `(now - created_at) < 14 days`. Otherwise 403 `window_expired` with `support_email: billing-support@leanshot.app` fallback.
- **Idempotency:** SELECT-first on `refunds` table; returns 409 `refund_already_processed` with existing `stripe_refund_id` if a pending/succeeded refund already exists for the subscription.
- **Stripe flow:** `invoices.list({status:'paid',limit:1})` → resolve `payment_intent` → `refunds.create({reason:'requested_by_customer'})` → INSERT refunds row → `subscriptions.cancel`.
- **Audit columns inserted:** `subscription_id`, `stripe_refund_id`, `stripe_payment_intent_id`, `amount_cents`, `currency`, `status`, `reason` (sanitized), `eligibility_window` ('trial' or 'money_back_14d'), `created_at`, `updated_at`.
- **Resend confirmation:** per-recipient send to `user.email` with subject "Your refund has been processed", 5-10 business-days copy, eligibility-window-aware body, RFC 8058 List-Unsubscribe headers, CAN-SPAM footer with HMAC-signed unsubscribe link.
- **CAN-SPAM PHYSICAL_ADDRESS guard:** Returns 503 + Slack P1 alert if env var unset or contains `[`, `TODO`, `REPLACE_ME` (per [[feedback_placeholder_string_runtime_guard_pattern]]).
- **Trial-no-charge branch:** If user is in-trial AND no paid invoice exists, returns 200 `{ok:true, status:'trial_no_charge_to_refund'}` and still cancels the subscription (no Stripe refund call — no money to return).

## Files Created

| File | Lines | Purpose |
|------|-------|---------|
| `supabase/functions/request-refund/handler.ts` | 531 | Pure handler (RequestRefundDeps DI seam) |
| `supabase/functions/request-refund/index.ts` | 64 | Deno.serve entry guarded by import.meta.main |
| `supabase/functions/request-refund/deno.json` | 8 | stripe@19 + @supabase/supabase-js@2.45.0 pins |
| `supabase/functions/request-refund/__tests__/handler.test.ts` | 647 | 14 Deno tests (12 behavior + CAN-SPAM + healthz) |
| `supabase/functions/_shared/email-templates/refund-confirmation.html` | 81 | Resend HTML template (designer reference; handler renders inline) |
| `supabase/functions/_shared/email-templates/refund-confirmation.txt` | 22 | Resend plain-text template (designer reference) |

## Tasks Completed

| Task | Name | Commit |
|------|------|--------|
| 1 | TDD: handler + tests + email templates (RED→GREEN) | e32b9f84 (RED) + 843da2a0 (GREEN) |
| 2 | Deno.serve entry + deno.json | 16e9ae87 |

## Verification Gates (per PLAN <verification>)

| Gate | Required | Actual | Status |
|------|----------|--------|--------|
| `supabase.auth.getUser` references | ≥ 1 | 3 | PASS |
| `stripe.refunds.create` references | ≥ 1 | 2 | PASS |
| `eligibility_window` references | ≥ 2 | 2 | PASS |
| Deno tests passing | 12 + | 14 / 14 | PASS |
| handler.ts line count | ≥ 180 | 531 | PASS |
| `import.meta.main` in index.ts | required | present | PASS |
| `stripe@19` in deno.json | required | present | PASS |

## Deno Test Results

```
ok | 14 passed | 0 failed (5ms)
```

All 12 behavior tests from the `<behavior>` block plus 2 supplementary cases (CAN-SPAM guard + GET /healthz):

1. no JWT → 401 unauthenticated
2. JWT for user without active sub → 404 no_subscription
3. in-trial user (trial_end > now()) → eligible window=trial
4. no-trial user created 10d ago → eligible window=money_back_14d
5. no-trial user created 30d ago → 403 window_expired + support fallback
6. eligible refund: `stripe.refunds.create` invoked with payment_intent + `reason:'requested_by_customer'`
7. eligible refund: refunds row INSERTed with all audit columns (subscription_id, stripe_refund_id, payment_intent, amount, currency, status, reason, eligibility_window)
8. eligible refund: `stripe.subscriptions.cancel` invoked AFTER `stripe.refunds.create`
9. eligible refund: Resend confirmation email fires with `$29.99` amount + "5-10 business days" copy
10. Stripe refund fails → refunds row NOT written + sub NOT cancelled + 500 refund_failed
11. Idempotent: existing succeeded refund → 409 refund_already_processed + existing stripe_refund_id echoed
12. POST body `{reason: '<text>'}` captured into refunds.reason column
13. CAN-SPAM guard: placeholder PHYSICAL_ADDRESS → 503 can_spam_address_not_configured
14. GET /healthz → 200 `{ok:true, fn:'request-refund'}`

## Threat Mitigations Applied (from PLAN <threat_model>)

| Threat | Mitigation |
|--------|------------|
| T-65-06-01 Spoofing JWT bypass | `supabaseServiceClient.auth.getUser(jwt)`; 401 on null user |
| T-65-06-02 Tampering other user's sub | `SELECT subscriptions WHERE user_id = user.id`; no user-controlled subscription_id |
| T-65-06-03 Repudiation | `reason` captured + `eligibility_window` recorded + `stripe_refund_id` UNIQUE + `created_at` audit row |
| T-65-06-04 Stripe error echo | Generic `{error:'refund_failed'}` on Stripe SDK exception; `console.error` logs `err.message` server-side only — never JSON.stringify'd into response body |
| T-65-06-05 Refund DoS / double-refund | Idempotency SELECT returns 409 BEFORE any Stripe call; UNIQUE constraint at DB layer also blocks |
| T-65-06-06 Refund+cancel atomicity | Cancel failure logs + Slack P1 alert but doesn't roll back refund (user already got money; operator retries) |

## Deviations from Plan

### Naming corrections (CONTEXT.md drift)

**1. [Rule 1 - Bug] CONTEXT.md says `trial_end_at`; actual subscriptions schema uses `trial_end`**
- **Found during:** Task 1 schema reading
- **Issue:** CONTEXT.md D-08 + PLAN.md `<truths>` reference `sub.trial_end_at`, but `supabase/migrations/20260601000019_stripe_subscriptions.sql` defines column as `trial_end` (Phase 14 lock).
- **Fix:** Handler queries `trial_end` and reads `sub.trial_end` consistently. Test fixtures use `trial_end`.
- **Files modified:** handler.ts, handler.test.ts.

**2. [Rule 1 - Bug] CONTEXT.md says `sub.stripe_subscription_id`; subscriptions.id IS the Stripe sub_xxx**
- **Found during:** Task 1 schema reading
- **Issue:** PLAN.md `<action>` mentions `sub.stripe_subscription_id` for `stripe.subscriptions.cancel` + `stripe.invoices.list`. Phase 14 schema (Plan 14-01) explicitly uses `id text primary key` where `id = stripe_subscription_id` (Pattern 14-PLAN iter-1 BL-2: webhook upserts on Stripe sub ID).
- **Fix:** Handler passes `sub.id` to both Stripe calls. Test fixtures use `id: 'sub_test_123'`.
- **Files modified:** handler.ts, handler.test.ts.

### Auto-fixed Issues — None other than the above naming corrections.

### Architectural Decisions

**3. [Doc] Email templates ship as reference files; handler renders inline**
- **Why:** Plan `<artifacts>` requires the template files, but mirroring the `grandfathered-policy-notice` pattern, the handler renders HTML/text inline rather than reading `.html`/`.txt` from disk at runtime (Edge Fns can't reliably read sibling files at runtime; bundled-inline is the established v1.4 lifecycle-email pattern). The reference files document the canonical template for designer / legal review.
- **Trade-off:** Single source of truth is the inline renderer in handler.ts; the template files contain the same copy with `${var}` placeholders left literal (they are documentation, not runtime-consumed).

## Self-Check: PASSED

- [x] FOUND: supabase/functions/request-refund/handler.ts
- [x] FOUND: supabase/functions/request-refund/index.ts
- [x] FOUND: supabase/functions/request-refund/deno.json
- [x] FOUND: supabase/functions/request-refund/__tests__/handler.test.ts
- [x] FOUND: supabase/functions/_shared/email-templates/refund-confirmation.html
- [x] FOUND: supabase/functions/_shared/email-templates/refund-confirmation.txt
- [x] FOUND commit: e32b9f84 (test RED)
- [x] FOUND commit: 843da2a0 (feat handler + templates GREEN)
- [x] FOUND commit: 16e9ae87 (feat Deno.serve entry + deno.json)
- [x] 14 / 14 Deno tests passing

## Carry-forward Notes

- **Plan 65-09 (UI) consumes:** `POST /functions/v1/request-refund/` with JWT bearer + optional `{reason: string}` body. Error codes UI must handle: `unauthenticated` (401), `no_subscription` (404), `window_expired` (403, with `eligibility_reason` + `support_email`), `refund_already_processed` (409, with `stripe_refund_id`), `can_spam_address_not_configured` (503), `refund_failed` (500). Success: `{ok:true, refund_id, amount_cents, status}`.
- **Plan 65-10 (close-out) deploys:** `supabase functions deploy request-refund` + sets Function Secrets (`STRIPE_SECRET_KEY`, `RESEND_API_KEY`, `PHYSICAL_ADDRESS`, `NEWSLETTER_UNSUBSCRIBE_SIGNING_KEY`, `SLACK_GUARDRAIL_WEBHOOK_URL`).
- **Receipt-page CTA:** UI Plan 65-09 owns wiring; this plan only ships backend.
- **`refunds` row insert race vs Stripe `refund.created` webhook (Plan 65-04):** request-refund handler INSERTs via service-role admin; if Stripe webhook fires before this Fn's INSERT completes, UNIQUE constraint on `stripe_refund_id` catches the duplicate. No reconciliation logic needed at this layer.
