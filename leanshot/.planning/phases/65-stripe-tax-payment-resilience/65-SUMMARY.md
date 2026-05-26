---
phase: 65
title: Stripe Tax + Payment Resilience
status: code-complete (remote-deploy-deferred)
shipped: 2026-05-27
mode: autonomous --from 65 --to 69
plans_completed: 9-of-10 (close-out partial — operator + remote-deploy deferred to Phase 70)
requirements: [PAY-01, PAY-02, PAY-03, PAY-04, PAY-05, PAY-06, PAY-07, PAY-08, PAY-09, PAY-10, PAY-11]
---

# Phase 65: Stripe Tax + Payment Resilience — SUMMARY

**Goal:** Ship Stripe Tax + B2B tax ID collection + nexus-monitoring + 3-email dunning + in-app banner + refund self-service + webhook idempotency burst-retry test + trial-ending/win-back lifecycle emails.

**Status:** **CODE-COMPLETE — REMOTE-DEPLOY DEFERRED TO PHASE 70.** All 9 implementation plans (65-01..09) shipped to `main`; 10 schema migrations + 7 Edge Fns + 31 email templates + 3 UI surfaces all live in-tree with test coverage. **Plan 65-10 close-out Tasks 1-4 (db push + operator gates + Fn deploy + cron registration) deferred** — see [65-CARRY-OVER.md](./65-CARRY-OVER.md). Operator-action gate (Stripe Dashboard) and a real-world schema drift on `org_subscriptions` block remote deploy.

---

## REQ-ID Coverage

| REQ-ID | Plan | Code-Complete | Deployed |
|--------|------|---------------|----------|
| PAY-01 (Stripe Tax: automatic_tax on every Checkout session) | 65-03 | ✅ | ⏭ Phase 70 |
| PAY-02 (B2B tax_id_collection on org seat sessions) | 65-03 | ✅ | ⏭ Phase 70 |
| PAY-03 (Mirror collected tax IDs to org_subscriptions.tax_id) | 65-04 | ✅ | ⏭ Phase 70 |
| PAY-04 (Nexus-monitor Slack alerts on 80%/100% threshold) | 65-08 | ✅ | ⏭ Phase 70 |
| PAY-05 (3-email dunning T+1d/T+3d/T+7d) | 65-05 | ✅ | ⏭ Phase 70 |
| PAY-06 (PaymentFailedBanner in-app) | 65-09 | ✅ | ⏭ Phase 70 |
| PAY-07 (Dunning state machine on invoice.payment_failed) | 65-04 | ✅ | ⏭ Phase 70 |
| PAY-08 (Refund self-service Fn + UI + tax dashboard) | 65-06, 65-09 | ✅ | ⏭ Phase 70 |
| PAY-09 (Webhook burst-retry idempotency test) | 65-02 | ✅ | ✅ (test-only) |
| PAY-10 (Tax-collection audit log on every Tax calculation) | 65-04 | ✅ | ⏭ Phase 70 |
| PAY-11 (Trial-ending T-3d/T-1d + win-back T+30/60/90d with promo codes) | 65-07 | ✅ | ⏭ Phase 70 |

---

## Plans Shipped

| Plan | Wave | Outcome | Tests |
|------|------|---------|-------|
| 65-01 | 1 | 8 schema migrations (org_subscriptions.tax_id, subscriptions.dunning_state, dunning_emails_sent, refunds, lifecycle_emails_sent, tax_collection_log, tax_nexus_thresholds, tax_nexus_state_revenue MATVIEW). Rule-1 auto-fixed FK types (subscriptions.id=text, org_subscriptions PK=org_id uuid). | n/a (SQL) |
| 65-02 | 1 | PAY-09 burst-retry Deno test validating `subscription_events.event_id PK + ON CONFLICT DO NOTHING` under 5× same-event_id <1s. | 5/5 pass |
| 65-03 | 2 | stripe-checkout `automatic_tax: {enabled:true}` + `customer_update: {address:'auto', name:'auto'}` + B2B `tax_id_collection: {enabled:true}` on org seat sessions. | 21/21 (5 new + 16 pre-existing) |
| 65-04 | 2 | 4 stripe-webhook event handlers (`invoice-payment-failed`, `subscription-updated`, `checkout-session-completed`, `tax-collection-log`). Dunning state machine + tax_id mirror + tax_collection_log audit insert. | 47/47 (17 new + 30 pre-existing) |
| 65-05 | 2 | stripe-dunning-orchestrator Fn (handler/index split mirroring grandfathered-policy-notice) + 6 email templates (dunning-first/second/final × html/txt) + CAN-SPAM placeholder guard. | 13/13 |
| 65-06 | 2 | request-refund JWT-authed Fn (531 LOC handler) + 2 email templates. Eligibility check (trial OR 14d MBG) → Stripe refund → subscription cancel → audit row → Resend confirmation. Rule-1 fixes: `trial_end_at` → `trial_end`, `subscriptions.id` IS the Stripe `sub_xxx` natural PK. | 14/14 |
| 65-07 | 2 | lifecycle-trial-ending (395 LOC, PostHog A/B variant for t3d copy) + lifecycle-win-back (429 LOC, per-user Stripe Promotion Codes from coupons). 12 email templates total. | 31/31 (17 + 14) |
| 65-08 | 2 | nexus-monitor Fn + 2 unplanned-but-auto-shipped migrations (`000009_nexus_alert_log`, `000010_refresh_nexus_revenue_rpc`). 23h alert dedup gate. | 11/11 |
| 65-09 | 2 | PaymentFailedBanner (app shell) + RefundRequestForm (/settings/billing/refund) + TaxDashboard (/admin/tax). Admin module manifest entry `'tax'`. useSubscription hook + Subscription/DunningState types. | 31/31 |
| 65-10 | 3 | Partial — Tasks 5+6 (planning artifacts) inline; Tasks 1-4 (db push + operator gates + Fn deploy + cron) deferred to Phase 70. | n/a |

**Total tests:** 173 Phase-65-new (all green) + ~46 pre-existing-still-green. Cross-Fn Deno sweep post-merge: 100/100.

---

## New SQL Surface

**Tables (new):** `dunning_emails_sent`, `refunds`, `lifecycle_emails_sent`, `tax_collection_log`, `tax_nexus_thresholds`, `nexus_alert_log`.
**Tables (altered):** `org_subscriptions.tax_id` text column + partial index; `subscriptions.dunning_state` enum column + index.
**MATVIEW:** `tax_nexus_state_revenue` (per-state revenue rollup).
**RPCs:** `refresh_nexus_revenue()` (SECDEF), `get_nexus_proximity()`, `staff_refresh_nexus_revenue()`.
**Cron jobs (planned, deferred to deploy):** 5 (`dunning-orchestrator/15min`, `lifecycle-trial-ending/daily 09:00`, `lifecycle-win-back/weekly Mon 10:00`, `nexus-monitor/daily 06:00`, `matview-refresh/daily 05:30`).

---

## Patterns Established

1. **Handler/index split + DI seam** — 5 new Fns mirror `grandfathered-policy-notice` (Phase 64-03) shape. Service-role bearer + CAN-SPAM placeholder guard.
2. **PostHog A/B variant fallback** — `lifecycle-trial-ending` uses `getFeatureFlag(distinct_id, 'trial-ending-t3d-copy')` with default `'a'` on miss.
3. **Composite-PK email idempotency** — `dunning_emails_sent` + `lifecycle_emails_sent` keyed by `(user_id, stage)` with `INSERT … ON CONFLICT DO NOTHING` to survive cron retries.
4. **23h alert dedup** — `nexus_alert_log` keyed by `(state, threshold_tier)` with WHERE `now() - last_alerted_at > '23h'::interval` to avoid Slack-spam.
5. **Per-user Stripe Promotion Code** — `lifecycle-win-back` creates one-shot `promotion_codes` scoped to `customer: cus_xxx` from base coupons (`WINBACK_10/25/50`).
6. **Constant-time service-role compare** — all 5 new Fns use `constantTimeEqual(bearer, env.SUPABASE_SERVICE_ROLE_KEY)` per `[[reference_supabase_service_role_key_format_divergence]]`.

---

## Cross-Cutting Decisions

- **`tax` admin module added** to `ADMIN_MODULES` (modules.ts), bringing the on-disk count to 19 — though the pre-existing `modules.test.ts` asserts 18, which itself was already wrong (reality on `main` was 34 — pre-existing tech debt; see [65-CARRY-OVER.md](./65-CARRY-OVER.md)).
- **Pre-existing `src/lib/billing-sync.test.ts` 5/6 failures on `main`** (commit `e397c819`, exact Wave-2 merge base). Confirmed via pre-merge `git checkout` + re-run. Not a Phase 65 regression — tracked to 65-CARRY-OVER.

---

## What Made This Phase Clean

1. **Wave 1 + 2 zero merge conflicts** — planner correctly disjoint-partitioned `files_modified` across 7 Wave 2 plans.
2. **All 7 worktree executors emitted SUMMARY.md before return** — no `[[#2070]]` rescue needed.
3. **Cross-Fn Deno sweep 100/100 post-merge** — `[[feedback_post_merge_deno_sweep_pattern]]` honored.
4. **Pre-commit handoff issue caught at session start** — see `[[feedback_handoff_commit_excludes_plan_phase_outputs]]` (this phase generated the lesson).

---

## What Didn't Land (See CARRY-OVER)

- All 5 new Edge Fns un-deployed to remote.
- 10 schema migrations un-pushed (blocked by remote drift on `org_subscriptions`).
- 5 pg_cron jobs un-registered.
- 2 operator-gate actions un-performed (Stripe Tax enable, 3 Win-back Coupons).
- 4 Function Secrets un-set (3 coupon IDs + verification of `SLACK_GUARDRAIL_WEBHOOK_URL` / `PHYSICAL_ADDRESS`).
- 1 cron-schedule migration (`20290104000011`) un-created.
