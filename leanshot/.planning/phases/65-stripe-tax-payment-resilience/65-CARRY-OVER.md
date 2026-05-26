---
phase: 65
status: code-complete (remote-deploy-deferred)
audience: Phase 70 milestone UAT operator
priority: HIGH (revenue-affecting deploys)
---

# Phase 65: Stripe Tax + Payment Resilience — CARRY-OVER

Items owed to Phase 70 milestone UAT operator. **Phase 65 ships code-complete; all remote-deploy + operator-gate items are deferred** per `[[feedback_autonomous_false_close_out_partial_execution]]`. Tasks 1–4 of Plan 65-10 are NOT done.

---

## 1. **BLOCKER — Remote schema drift on `org_subscriptions`**

**Discovered:** 2026-05-27 during inline `npx supabase db push --linked` attempt.

**Symptom:**
```
Applying migration 20290104000001_org_subscriptions_tax_id.sql...
ERROR: relation "public.org_subscriptions" does not exist (SQLSTATE 42P01)
```

**Contradiction:** `npx supabase migration list --linked | grep 20270601100008` shows `20270601100008_org_subscriptions_table.sql` as APPLIED to remote.

**Root cause hypothesis:** Migration recorded in `supabase_migrations.schema_migrations` (via `migration repair`) but never actually executed against the live database — OR the table was created then dropped via a manual ops action.

**Operator fix path (recommended order):**
1. `psql <connection-string>` to remote DB.
2. `\dt public.org_subscriptions` — confirm table is genuinely missing.
3. If missing: extract the CREATE TABLE + RLS body from `supabase/migrations/20270601100008_org_subscriptions_table.sql` and apply it manually inline.
4. After org_subscriptions exists, re-run `npx supabase db push --linked`.
5. Verify all 10 Phase 65 migrations apply cleanly.

**Related:** `[[reference_rag_sources_source_type_drift]]` (analogous tracking-vs-actual drift on rag_sources.source_type column).

---

## 2. Operator-Gate Tasks (un-done)

### 2a. Enable Stripe Tax in Dashboard
- **Action:** Sign in to Stripe Dashboard → Products → Tax → Settings → Get started → complete origin/nexus setup wizard. Register tax-collection IDs for top-revenue states (CA + TX most likely).
- **Required for:** PAY-01/02/03 deploy. Without this, `automatic_tax: {enabled: true}` returns 400 at every Checkout session.
- **Blocking:** Yes — Phase 65 Fn deploys cannot proceed until this is done.

### 2b. Create 3 Win-back Coupons
- **Action:** In Stripe Dashboard → Products → Coupons, create:
  - `WINBACK_10` — 10% off, duration: once. Description: "Phase 65 win-back T+30d".
  - `WINBACK_25` — 25% off, duration: once. Description: "Phase 65 win-back T+60d".
  - `WINBACK_50` — 50% off, duration: once. Description: "Phase 65 win-back T+90d".
- **Required for:** PAY-11 deploy.
- **Output:** 3 coupon IDs (may be your custom IDs or Stripe-generated `coupon_xxx`). Record them here for posterity.

### 2c. Set 3 Function Secrets (depends on 2b)
```bash
npx supabase secrets set \
  STRIPE_COUPON_WINBACK_10=<id-from-2b> \
  STRIPE_COUPON_WINBACK_25=<id-from-2b> \
  STRIPE_COUPON_WINBACK_50=<id-from-2b> \
  --project-ref ytnsipxxmzgaebkqmokp
```

### 2d. Audit Phase 60.5 secrets are set
- **Action:** `npx supabase secrets list --project-ref ytnsipxxmzgaebkqmokp` — confirm `SLACK_GUARDRAIL_WEBHOOK_URL` AND `PHYSICAL_ADDRESS` (CAN-SPAM) are both present and NOT `REPLACE_ME` / `TODO` / placeholder.
- **Blocking:** Yes — `stripe-dunning-orchestrator` + 3 lifecycle Fns will return 503 at runtime via their built-in placeholder guards if either secret is missing/placeholder.

---

## 3. Deploy Sequence (after operator gates clear)

Order per `[[feedback_fn_deploy_before_cron_db_push]]` — deploy Fns BEFORE registering cron, otherwise cron fires against non-existent endpoints.

1. **Push 10 schema migrations:** `npx supabase db push --linked` (depends on §1 fix).
2. **Deploy 7 Edge Fns:**
   ```bash
   for fn in stripe-checkout stripe-webhook stripe-dunning-orchestrator request-refund lifecycle-trial-ending lifecycle-win-back nexus-monitor; do
     npx supabase functions deploy "$fn" --project-ref ytnsipxxmzgaebkqmokp
   done
   ```
3. **Healthz smoke-test** 5 new Fns: `curl https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/<fn>/healthz` — assert `ok:true` body.
4. **Stripe Tax CLI smoke:** `stripe tax calculations create --currency=usd --customer-details[address][country]=US --customer-details[address][state]=CA --line-items[0][amount]=1000 --line-items[0][reference]=test`. Should return success. If "Tax not enabled" → §2a unfinished.
5. **Create `supabase/migrations/20290104000011_phase65_cron_schedules.sql`** with 5 jobs using vault-bearer + named dollar-quote tags (`cron_body` / `inner_body`) per `[[reference_postgres_dollar_quote_nesting_in_cron_body]]` and `[[reference_supabase_pg_cron_vault_service_role_pattern]]`.
6. **Second `npx supabase db push --linked`** — pg_cron jobs activate.
7. **Verify cron:** `psql -c "select jobname, schedule from cron.job where jobname like 'phase65%'"` — expect 5 rows.

---

## 4. UAT Flows (Phase 70 deliverables)

Each flow is a discrete resume-signal per `[[feedback_multi_signal_human_verify_checkpoint_pattern]]`.

| Flow | Steps |
|------|-------|
| **F1 Cross-state tax-calc** | Subscribe from a US state with tax (CA), confirm Stripe Receipt shows tax line + Receipt PDF includes amount. Repeat from no-tax state (NH) — confirm $0 tax. |
| **F2 3-email dunning cadence** | Mock `invoice.payment_failed` webhook → cron fires T+1d / T+3d / T+7d emails. Verify each lands in inbox + correct copy + working "Update Payment" deep link. |
| **F3 Refund within trial** | New user, start trial, click "Request Refund" → confirm refund + cancellation + confirmation email. Stripe Dashboard shows refund row. |
| **F4 Refund within 14d MBG** | Existing paid user (within 14d of first invoice), click refund → same outcome. Outside 14d → 403 with eligibility_window error code. |
| **F5 Win-back T+30 with coupon** | Cancel subscription → wait T+30d (or mock cron) → email lands with WINBACK_10 promo code, redeemable in Stripe. |
| **F6 Nexus monitor 80%/100%** | Mock revenue past CA threshold → cron fires → Slack receives alert + `nexus_alert_log` row inserted. Repeat fire <23h → dedup → no second Slack alert. |
| **F7 Idempotency burst-retry** | Trigger Stripe `event.test` 5× same event_id <1s → confirm single-row outcome across `subscription_events` + downstream tables (Deno test already proves this; replay against live). |

---

## 5. Pre-existing Test Tech-Debt (NOT Phase 65 regressions)

Discovered during post-merge Vitest gate. All confirmed against pre-merge base `e397c819`. Triage for separate cleanup phase:

| Test File | Status | Notes |
|-----------|--------|-------|
| `src/lib/billing-sync.test.ts` | 5/6 failing on `main` | Vintage Phase 14 test; mock surface drifted from real client. |
| `src/lib/admin/modules.test.ts` | 3/4 failing on `main` | Hard-codes "18 modules" + expected key list. Reality on `main` was already 34 BEFORE Phase 65. Phase 65 added one entry (`tax`) → now 35. Test needs full rewrite. |
| `src/lib/admin/palette/aal2-step-up.test.ts` | 4 failures | localStorage fixture stale; AAL2 contract from Phase 48 |
| `src/lib/admin/bulk/job-polling.test.ts` | 4 failures | Phase 27 vintage; polling mock stale |
| `|functions-unit|` vitest project | broad-include capturing Deno tests | `[[feedback_vitest_project_include_too_broad]]` — should be addressed in Phase 69.5 or 69 (final cleanup). |
| `|phase60-eval|` vitest project | RED gold-set scaffolds | By-design — gold-set fixtures missing per Phase 60-15 close-out plan. |

---

## 6. Cross-Phase Dependencies Surfaced

- **Phase 66 Consumer Account Security:** Depends on no Phase-65 surface. Independent dispatch safe.
- **Phase 67 Operational Runbooks + Observability:** SHOULD include a runbook for the §1 drift recovery (psql + table introspection). Add to Phase 67 scope.
- **Phase 69.5 Final Tech Debt Sweep:** Pick up the pre-existing test failures from §5.
- **Phase 70 milestone UAT:** F1–F7 above.

---

## 7. Unplanned-but-shipped Migrations

Plan 65-08's executor (Rule 1) auto-shipped two migrations not in the original plan body:
- `supabase/migrations/20290104000009_nexus_alert_log.sql`
- `supabase/migrations/20290104000010_refresh_nexus_revenue_rpc.sql`

These are required for `nexus-monitor` to function (dedup table + SECDEF refresh RPC). Per `[[feedback_executor_auto_adds_missing_migration]]` this is expected Rule-1 behavior. Migration 000011 (cron schedules, planned by 65-10) will slot in cleanly after.
