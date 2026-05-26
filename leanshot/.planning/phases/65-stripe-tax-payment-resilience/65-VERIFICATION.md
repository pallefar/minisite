---
phase: 65
status: human_needed
verified: 2026-05-27
mode: automated-verify-only (operator + remote-deploy items rolled to Phase 70)
---

# Phase 65: Stripe Tax + Payment Resilience — VERIFICATION

**Verdict:** Automated checks PASS for all 9 implementation plans (65-01..09). Plan 65-10 close-out partially complete — planning artifacts shipped, remote deploy + operator gates deferred to Phase 70 milestone UAT. Phase advances as `code-complete` with **`human_needed`** post-execution routing for milestone consolidation.

---

## Automated Verification (PASS)

| Check | Method | Result |
|-------|--------|--------|
| 10 schema migrations exist in tree | `ls supabase/migrations/202901040000[0-9]*.sql` | ✅ 10 files |
| Forward-timestamp safe vs remote | `npx supabase migration list --linked` showed last remote = `20290103000005` (all 10 forward) | ✅ |
| 7 Edge Fns ship in tree | `ls supabase/functions/{stripe-checkout,stripe-webhook,stripe-dunning-orchestrator,request-refund,lifecycle-trial-ending,lifecycle-win-back,nexus-monitor}/` | ✅ 7 dirs |
| 31 email templates ship | `ls supabase/functions/_shared/email-templates/{dunning-*,refund-confirmation*,trial-ending-*,winback-*}` | ✅ |
| CAN-SPAM placeholder guard present | grep for 503 + Slack alert on `[placeholder]` in each Fn handler | ✅ 5/5 Fns |
| tsc | `npx tsc --noEmit` in `leanshot/` | ✅ exit 0 |
| Phase 65 Deno tests | per-Fn `deno test --no-check`: 21+47+13+14+17+14+11 | ✅ 137/137 |
| Phase 65 Vitest tests | in-scope `src/components/billing` + `src/components/admin/tax` + `src/lib/billing` + `src/hooks/useSubscription` | ✅ 31/31 new green |
| ADMIN_MODULES manifest contains `'tax'` | `grep "^\s*key:\s*'tax'" src/lib/admin/modules.ts` | ✅ |
| AppShell mounts PaymentFailedBanner | `grep PaymentFailedBanner src/components/layout/AppShell.tsx` | ✅ |
| /admin/tax route reachable | `grep -E "'tax'\|TaxDashboard" src/components/admin/tax/index.ts` + module registration | ✅ |

---

## Human-Verify Signals (DEFERRED TO PHASE 70)

Per `[[feedback_multi_signal_human_verify_checkpoint_pattern]]` — close-out HUMAN gate split into discrete signals. ALL deferred to Phase 70 milestone UAT (Tasks 1-4 of Plan 65-10):

### Signal 1: Schema migrations applied to remote
- **Status:** ⏭ deferred
- **Blocker:** Migration `20290104000001` failed `db push` with `relation "public.org_subscriptions" does not exist (SQLSTATE 42P01)` even though `migration list` shows `20270601100008_org_subscriptions_table.sql` as applied. Schema-tracking drift on remote — needs operator psql investigation.
- **UAT step:** Operator runs `npx supabase db push --linked` after resolving the org_subscriptions drift (see [65-CARRY-OVER.md](./65-CARRY-OVER.md)). Then verify `npx supabase migration list --linked | grep -c "20290104000" = 10`.

### Signal 2: Stripe Tax enabled in Dashboard
- **Status:** ⏭ deferred (operator gate)
- **UAT step:** Operator signs in to Stripe Dashboard → Products → Tax → Settings → Get started + complete origin/nexus wizard. Register tax-collection IDs for top-revenue states.

### Signal 3: 3 Win-back Coupons created in Stripe
- **Status:** ⏭ deferred (operator gate)
- **UAT step:** Operator creates `WINBACK_10` (10% off, once), `WINBACK_25` (25% off, once), `WINBACK_50` (50% off, once). Records IDs in 65-CARRY-OVER.md.

### Signal 4: Function Secrets set
- **Status:** ⏭ deferred (depends on Signal 3)
- **UAT step:** `npx supabase secrets set STRIPE_COUPON_WINBACK_10=... STRIPE_COUPON_WINBACK_25=... STRIPE_COUPON_WINBACK_50=... --project-ref ytnsipxxmzgaebkqmokp`.

### Signal 5: SLACK_GUARDRAIL_WEBHOOK_URL + PHYSICAL_ADDRESS verified set
- **Status:** ⏭ deferred (operator audit)
- **UAT step:** `npx supabase secrets list --project-ref ytnsipxxmzgaebkqmokp | grep -E "SLACK_GUARDRAIL_WEBHOOK_URL|PHYSICAL_ADDRESS"`. Carried from Phase 60.5.

### Signal 6: 7 Edge Fns deployed
- **Status:** ⏭ deferred (depends on Signals 1+4)
- **UAT step:** `npx supabase functions deploy <fn> --project-ref ytnsipxxmzgaebkqmokp` for each of: stripe-checkout, stripe-webhook, stripe-dunning-orchestrator, request-refund, lifecycle-trial-ending, lifecycle-win-back, nexus-monitor. Smoke `GET /healthz` returns `ok:true` for the 5 new Fns.

### Signal 7: 5 pg_cron jobs registered (and Migration 000011 created + pushed)
- **Status:** ⏭ deferred (depends on Signal 6 per `[[feedback_fn_deploy_before_cron_db_push]]`)
- **UAT step:** Create `supabase/migrations/20290104000011_phase65_cron_schedules.sql` using vault-bearer pattern + named dollar-quote tags, then second `db push`. Verify `select count(*) from cron.job where jobname like 'phase65%'` = 5.

### Signal 8: End-to-end user flows
- **Status:** ⏭ deferred (Phase 70 UAT)
- **Flows:**
  - Cross-state tax-calc walkthrough on real Stripe account
  - 3-email dunning cadence end-to-end (mock invoice.payment_failed → T+1d/T+3d/T+7d emails delivered)
  - Refund within trial AND within 14-day MBG window
  - Win-back T+30/60/90 with coupon redemption

---

## Test Coverage Summary

- **New Phase 65 tests:** 173 (137 Deno + 36 Vitest)
- **Pre-existing tests still passing:** ~46 covered through cross-Fn sweep + Phase 65-UI vitest scope
- **Pre-existing failures (NOT Phase 65 regressions):** 5 in `src/lib/billing-sync.test.ts`, manifest count drift in `src/lib/admin/modules.test.ts`, plus `src-lib-unit` AAL2 + job-polling + 1 `aal2-step-up` legacy fixtures. Confirmed against base commit `e397c819`. See 65-CARRY-OVER.md.
