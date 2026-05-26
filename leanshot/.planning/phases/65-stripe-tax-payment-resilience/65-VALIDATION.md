---
phase: 65-stripe-tax-payment-resilience
type: validation
created: 2026-05-26
mode: compressed (inline-generated from per-plan automated verify blocks per feedback_validation_md_inline_generation_when_missing)
---

# Phase 65 — Validation Matrix

Per-plan automated checks pulled from each PLAN.md `<verify><automated>` block. Each row maps a PAY-NN requirement to the command that proves it.

| Plan | PAY-IDs | Verification Command | Expected Outcome |
|------|---------|----------------------|------------------|
| 65-01 | PAY-03, PAY-04, PAY-05, PAY-07, PAY-08, PAY-10, PAY-11 | `ls supabase/migrations/20290104000001_*.sql ... 000005_*.sql 2>&1 \| grep -c "^supabase"` returns 5 + `grep -L "if not exists.*create policy" ...` returns clean | 5 migration files present; no `if not exists` on `create policy` |
| 65-01 | PAY-04 | `grep -c "insert into public.tax_nexus_thresholds" supabase/migrations/20290104000007_*.sql` ≥ 1 + matview created with unique index | 3 additional migrations; seed data present; matview ready |
| 65-02 | PAY-09 | `deno test --no-check --allow-env --allow-net supabase/functions/stripe-webhook/__tests__/burst-retry.test.ts` exits 0 | 5 Deno.test blocks pass; <1s wall-clock; single-row outcomes asserted |
| 65-03 | PAY-01, PAY-02, PAY-03 | `deno test --no-check --allow-env --allow-net supabase/functions/stripe-checkout/index.test.ts` exits 0 + `grep -c automatic_tax stripe-checkout/index.ts` ≥ 2 | 5 new tests pass; `automatic_tax` present; clinic-only `tax_id_collection` |
| 65-04 | PAY-03, PAY-07 | `deno test --no-check --allow-env --allow-net supabase/functions/stripe-webhook/events/invoice-payment-failed.test.ts subscription-updated.test.ts checkout-session-completed.test.ts` exits 0 | 15 new tests across 3 event handlers; dunning state machine deterministic; tax_id mirror works |
| 65-05 | PAY-05, PAY-07 | `deno test --no-check --allow-env --allow-net supabase/functions/stripe-dunning-orchestrator/__tests__/handler.test.ts` exits 0 + index.ts has `import.meta.main` guard | 13 tests pass; CAN-SPAM guard + composite-PK idempotency + Resend per-recipient verified |
| 65-06 | PAY-08 | `deno test --no-check --allow-env --allow-net supabase/functions/request-refund/__tests__/handler.test.ts` exits 0 | 12 tests pass; trial + money-back eligibility matrix; refund + cancel + Resend flow |
| 65-07 | PAY-10, PAY-11 | `deno test --no-check --allow-env --allow-net supabase/functions/lifecycle-trial-ending/__tests__/handler.test.ts lifecycle-win-back/__tests__/handler.test.ts` exits 0 | 24 tests across both Fns; PostHog A/B fallback; Stripe Promotion Code mint + rollback; composite-PK idempotency |
| 65-08 | PAY-04 | `deno test --no-check --allow-env --allow-net supabase/functions/nexus-monitor/__tests__/handler.test.ts` exits 0 + 2 new migrations exist (000009 + 000010) | 11 tests pass; tier classification deterministic; 23h de-dup gate; matview refresh RPC |
| 65-09 | PAY-04, PAY-06, PAY-08 | `cd leanshot && npm run lint` exits 0 + `npx vitest run src/components/billing/ src/components/admin/tax/ src/lib/billing/ --reporter=basic` exits 0 | 8 + 11 + 10 component tests pass; no undefined `@theme` tokens; banner renders 3 copy variants; admin module manifest has 'tax' entry |
| 65-10 | PAY-01..11 | `supabase migration list --linked \| grep -c "20290104000"` ≥ 11 + `supabase functions list --linked \| grep -E "stripe-dunning-orchestrator\|request-refund\|lifecycle-trial-ending\|lifecycle-win-back\|nexus-monitor" \| wc -l` returns 5 + `select count(*) from cron.job where jobname like 'phase65%'` returns 5 | 11 migrations applied; 7 Fn deploys; 5 cron jobs registered |

## Coverage Matrix (PAY-NN → Plan)

| PAY-ID | Owned by Plan(s) |
|--------|------------------|
| PAY-01 (Stripe Tax automatic_tax) | 65-03 (checkout extension) + 65-04 (tax_collection_log audit) + 65-10 (operator Tax-enable gate) |
| PAY-02 (customer_update.address auto) | 65-03 |
| PAY-03 (B2B tax_id_collection + mirror) | 65-01 (column) + 65-03 (collection flag) + 65-04 (mirror) |
| PAY-04 (nexus dashboard + Slack alert) | 65-01 (schema) + 65-08 (cron Fn) + 65-09 (TaxDashboard UI) |
| PAY-05 (3-email dunning Resend) | 65-01 (audit table) + 65-04 (state transitions) + 65-05 (orchestrator Fn + templates) |
| PAY-06 (PaymentFailedBanner) | 65-09 |
| PAY-07 (dunning_state column + state machine) | 65-01 (column) + 65-04 (webhook transitions) + 65-05 (cron drives) |
| PAY-08 (refund self-service) | 65-01 (refunds table) + 65-06 (Fn) + 65-09 (UI) |
| PAY-09 (webhook burst-retry test) | 65-02 |
| PAY-10 (trial-ending T-3d/T-1d) | 65-01 (lifecycle_emails_sent) + 65-07 (Fn) |
| PAY-11 (win-back T+30/60/90 + Promotion Codes) | 65-01 (lifecycle_emails_sent) + 65-07 (Fn) + 65-10 (operator coupon-create gate) |

## HUMAN-UAT Signals Deferred to Phase 70

Per ROADMAP Phase 70 consolidated UAT + feedback_milestone_uat_deferral_consolidation, these 4 signals roll up to the v1.4 launch-gate UAT:

1. **Cross-state purchase tax calc verified** — make a real purchase from a US state with Stripe Tax registration in place; verify `tax_collection_log` row written with correct rate + amount.
2. **3-email dunning cadence delivered** — simulate payment failure on a test card; verify T+1d / T+3d / T+7d emails delivered to real inbox; verify in-app `<PaymentFailedBanner>` renders with correct copy per stage; verify Stripe Customer Portal deep-link works.
3. **Refund self-service in trial AND money-back window** — issue refund via `<RefundRequestForm>` for a user within trial; verify Stripe refund + audit row + confirmation email + subscription cancelled. Repeat for a user past trial but within 14-day window.
4. **Win-back T+30/60/90 with coupon redemption** — cancel a subscription, wait for cron to fire (or trigger manually via service-role POST), verify T+30 email arrives with WINBACK-XXXX code, attempt redemption at /pricing?promo=WINBACK-XXXX and confirm the discount is applied. Repeat for T+60 and T+90.

## Operator Carry-Overs Tracked in 65-CARRY-OVER.md

- Stripe Dashboard: Enable Stripe Tax (Task 2, Plan 65-10)
- Stripe Dashboard: Create Win-back Coupons WINBACK_10/25/50 (Task 2, Plan 65-10)
- Supabase Function Secrets: STRIPE_COUPON_WINBACK_10/25/50 (Task 3, Plan 65-10)
- Supabase Function Secrets: SLACK_GUARDRAIL_WEBHOOK_URL verified (Task 2, Plan 65-10 — Phase 60.5 carry-over)
- Supabase Function Secrets: PHYSICAL_ADDRESS verified non-placeholder (Task 2, Plan 65-10 — Phase 64 carry-over)
- pg_cron observation window: monitor stripe-dunning-orchestrator first 24h post-ship for unexpected errors

## Cross-Plan Tweaks Identified During Planning

These are small intra-Phase-65 adjustments surfaced during this planning pass that execute-time agents must apply:

1. **Plan 65-06 handler dry_run branch**: 65-09 task 2 calls `checkRefundEligibility(jwt)` which expects a `dry_run: true` body on request-refund POST. Plan 65-06 must add this branch (eligibility-only return without side effects). Add a 13th test case to 65-06 covering dry_run.

2. **Plan 65-08 SECDEF RPCs**: `public.refresh_nexus_revenue()` + `public.get_nexus_proximity()` + `public.staff_refresh_nexus_revenue()` migrations are owned by Plan 65-08 as a 10th migration `20290104000010_refresh_nexus_revenue_rpc.sql`. Plan 65-09 TaxDashboard depends on the staff-scoped variant.

3. **Stripe price-ID detection for clinic flow in Plan 65-04**: confirm `STRIPE_PRICE_CLINIC_BASE` env var is readable from the webhook handler context (Phase 14 set it). Verify at execute-time before relying on it as the clinic-detection signal.
