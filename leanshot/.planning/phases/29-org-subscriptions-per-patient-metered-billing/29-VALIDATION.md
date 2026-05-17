---
phase: 29
slug: org-subscriptions-per-patient-metered-billing
status: planned
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-17
updated: 2026-05-17 (per-task map populated by gsd-planner after 8 plans created)
---

# Phase 29 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Source-of-truth Validation Architecture lives in `29-RESEARCH.md` — this file is the
> orchestration shape the gsd-planner and gsd-validate-phase agents consume.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x (TypeScript unit + RLS integration) + Deno test (Edge Functions) + Playwright (e2e) |
| **Config file** | `vitest.config.ts`, `vitest-e2e.config.ts`, `deno.json` (per-fn), `playwright.config.ts` |
| **Quick run command** | `npm run test:unit -- <changed-file>` (vitest) or `deno test supabase/functions/<fn>/` |
| **Full suite command** | `npm run test && npm run lint && npm run lint:stripe-phi && npm run build && deno test supabase/functions/**` |
| **Estimated runtime** | ~90 seconds quick / ~6 minutes full |

---

## Sampling Rate

- **After every task commit:** Run scoped quick command (vitest --run for changed file OR deno test for changed fn)
- **After every plan wave:** Run `npm run test && deno test supabase/functions/**` (RLS suites + edge-fn suites)
- **Before `/gsd:verify-work`:** Full suite must be green + bundle ceiling check (`npm run build && scripts/assert-clinic-bundle-budget.sh`) + Stripe PHI lint (`npm run lint:stripe-phi`)
- **Max feedback latency:** 90 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 29-00-01 | 00 | 0 | ORG-08+09+10 | T-29-00-01 | RECONCILE migration drafted: drop org_subscriptions, ADD seats_*, ADD primary_org_id, ADD 5 event-table indexes | grep + filename regex | see 29-00-PLAN Task 1 automated | ❌ W0 | ⬜ pending |
| 29-00-02 | 00 | 0 | ORG-08+09+10 | T-29-00-01 | Migration applied to linked Supabase project; live schema matches D-09/D-10 | SQL probe + CLI | `supabase db query --linked` (full probe in 29-00-PLAN Task 2) | ❌ W0 | ⬜ pending |
| 29-00-03 | 00 | 0 | — | — | SUMMARY.md committed; verification evidence captured | grep + git log | see 29-00-PLAN Task 3 automated | ❌ W0 | ⬜ pending |
| 29-01-01 | 01 | 1 | ORG-09 | T-29-01-01 | count_active_patients SECDEF: 10-table UNION, org_patient_links source, search_path locked; no memberships/roles.name | grep negative + grep positive | see 29-01-PLAN Task 1 automated | ❌ W1 | ⬜ pending |
| 29-01-02 | 01 | 1 | ORG-09 | T-29-01-04 | 7+ behavior tests pass: count correctness, distinct dedup, unlinked exclusion, service-role bypass, non-admin 42501, cross-org 42501 | vitest | `npx vitest run src/lib/__tests__/count-active-patients.test.ts --config vitest-e2e.config.ts` | ❌ W1 | ⬜ pending |
| 29-01-03 | 01 | 1 | — | — | SUMMARY.md committed | grep + git log | see 29-01-PLAN Task 3 | ❌ W1 | ⬜ pending |
| 29-02-01 | 02 | 1 | ORG-10 | T-29-02-01 | org_patient_invites table with on delete restrict + force RLS + SELECT-only policy + ORG_SCOPED_TABLES updated (BLOCKER R2) | SQL probe + grep | see 29-02-PLAN Task 1 automated | ❌ W1 | ⬜ pending |
| 29-02-02 | 02 | 1 | ORG-10 | T-29-02-02,03,05 | 3 SECDEFs (send_org_patient_invite + accept_preview + accept) with search_path locked + log_admin_action audit + W-1 invariant | SQL probe | see 29-02-PLAN Task 2 automated | ❌ W1 | ⬜ pending |
| 29-02-03 | 02 | 1 | ORG-10 | T-29-02-01,02,03 | cross-tenant RLS proof T3/T4/T5a/T5b/T3b/T6/T7 pass (BLOCKER R1) | vitest | `npx vitest run src/lib/__tests__/rls-org-patient-invites.test.ts --config vitest-e2e.config.ts` | ❌ W1 | ⬜ pending |
| 29-03-01 | 03 | 1 | ORG-08 | T-29-03-01,02 | invoice.created handler: early-return on missing clinic_id; variance >10% triggers Sentry warning; RPC failure caught | deno test | `deno test supabase/functions/stripe-webhook/events/invoice-created.test.ts --allow-env --allow-net=esm.sh,jsr.io --allow-read` | ❌ W1 | ⬜ pending |
| 29-03-02 | 03 | 1 | ORG-08 | T-29-03-04 | namespace separation CI test: consumer + clinic Stripe customer IDs distinct for same email | vitest | `npx vitest run src/lib/__tests__/stripe-namespace-separation.test.ts --config vitest-e2e.config.ts` | ❌ W1 | ⬜ pending |
| 29-04-01 | 04 | 2 | ORG-09 | T-29-04-01,02 | meter event value is STRING (Pitfall 3); identifier matches regex `org_{uuid}_YYYYMM`; per-org error isolation; D-11 PHI-free payload | deno test | `deno test supabase/functions/org-metered-billing-cron/org-metered-billing-cron.test.ts --allow-env --allow-net=esm.sh,jsr.io --allow-read` | ❌ W2 | ⬜ pending |
| 29-04-02 | 04 | 2 | ORG-09 | T-29-04-05 | pg_cron `p29_org_metered_billing_cron` registered at `0 2 * * *` with active=true; no slot collision | SQL probe | `supabase db query --linked "select jobname, schedule, active from cron.job where jobname='p29_org_metered_billing_cron';"` | ❌ W2 | ⬜ pending |
| 29-05-01 | 05 | 2 | ORG-10 | T-29-05-01,02,03,05 | Edge Fn (send+preview+accept): W-1 invariant + PHI-keyword grep zero + two-phase pattern (RPC before generateLink) + 9 deno tests pass | deno test + grep | `deno test supabase/functions/clinic-patient-invite/clinic-patient-invite.test.ts --allow-env --allow-net=esm.sh,jsr.io --allow-read` | ❌ W2 | ⬜ pending |
| 29-05-02 | 05 | 2 | ORG-10 | — | `src/lib/clinic-patient-invite.ts` helpers exist + TS compiles | grep + tsc | `npx tsc --noEmit` | ❌ W2 | ⬜ pending |
| 29-06-01 | 06 | 3 | ORG-08+10 | T-29-06-01,02,03 | ClinicBillingCard + PatientInviteForm + ConsentAcceptScreen + App.tsx route wire + build pass + bundle ceiling | tsc + build + budget script | `npm run build && bash scripts/assert-clinic-bundle-budget.sh` | ❌ W3 | ⬜ pending |
| 29-06-02 | 06 | 3 | ORG-10 | — | Playwright e2e proves full invite→accept round-trip + primary_org_id set | Playwright | `PLAYWRIGHT_RUN_P29=1 npx playwright test e2e/clinic-patient-invite-accept.spec.ts` | ❌ W3 | ⬜ pending |
| 29-06-HV | 06 | 3 | ORG-08 SC#4 | T-29-06-03 | Realtime billing surface updates within 30s of Stripe webhook | HUMAN-VERIFY | two-tab test (see 29-06-PLAN Task 4) | manual | ⬜ pending |
| 29-07-01 | 07 | 3 | ORG-10 | T-29-07-05 | invite expiry cron `p29_org_patient_invites_expiry_purge` at `30 4 * * *` active | SQL probe | `supabase db query --linked "select jobname from cron.job where jobname='p29_org_patient_invites_expiry_purge';"` | ❌ W3 | ⬜ pending |
| 29-07-02 | 07 | 3 | ORG-09+10 | T-29-07-01 | Stripe PHI keyword lint passes against current codebase (zero violations in org-metered-billing-cron + stripe-webhook + stripe-checkout + admin-stripe-action) | CI lint | `npm run lint:stripe-phi` | ❌ W3 | ⬜ pending |
| 29-07-HC-stripe | 07 | 3 | ORG-09 | T-29-07-03 | Stripe Meter `active_patient_month` registered in Dashboard | HUMAN-CHECKPOINT | dashboard.stripe.com/test/billing/meters | manual | ⬜ pending |
| 29-07-HC-resend | 07 | 3 | ORG-10 | — | RESEND_API_KEY + RESEND_FROM Function Secrets verified | HUMAN-CHECKPOINT | `supabase secrets list --linked` | manual | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `supabase/migrations/20270601200001_p29_reconcile.sql` — Plan 29-00 RECONCILE migration (drops `org_subscriptions`, verify-or-add `subscriptions.seats_*`, `profiles.primary_org_id`, indexes on the 5 event tables missing `(user_id, created_at)`) — drafted; pushed in Plan 29-00 Task 2
- [ ] `src/lib/__tests__/rls-org-patient-invites.test.ts` — cross-tenant proof (Plan 29-02 Task 3)
- [ ] `src/lib/__tests__/count-active-patients.test.ts` — count_active_patients D-01 invariants (Plan 29-01 Task 2)
- [ ] `src/lib/__tests__/stripe-namespace-separation.test.ts` — ORG-08 SC#1 (Plan 29-03 Task 2)
- [ ] `supabase/functions/clinic-patient-invite/clinic-patient-invite.test.ts` — W-1 + two-phase + PHI-lint (Plan 29-05 Task 1)
- [ ] `supabase/functions/org-metered-billing-cron/org-metered-billing-cron.test.ts` — value-as-string + idempotency-key + per-org isolation (Plan 29-04 Task 1)
- [ ] `supabase/functions/stripe-webhook/events/invoice-created.test.ts` — variance handler 6 behaviors (Plan 29-03 Task 1)
- [ ] `e2e/clinic-patient-invite-accept.spec.ts` — Playwright invite→accept→consent→primary_org_id round-trip (Plan 29-06 Task 3)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Stripe Meter Event appears in Dashboard with `event_name=active_patient_month` | ORG-09 SC#2 | Stripe Test Mode Dashboard requires browser session; not scriptable via CLI without bootstrap-token-then-revoke pattern | After 02:00 UTC cron, log in to dashboard.stripe.com/test/billing/meters → confirm row with org idempotency key (Plan 29-07 HUMAN-CHECKPOINT) |
| Resend non-PHI patient invite email renders without leaking org_name surface area beyond what Phase 25 D-12 allows | ORG-10 | Email rendering is template-driven; visual inspection of inbox | Trigger `clinic-patient-invite/send` against `noreply@app.leanshot.app` to a `+test1` Gmail; inspect — confirm no patient name / no diagnosis / no dose values |
| Realtime billing surface receives `org-{hmac8}-subscriptions` UPDATE within 30s of webhook | ORG-08 SC#4 | Requires two browser tabs (admin UI + Stripe Dashboard manual subscription update) | Plan 29-06 Task 4 HUMAN-VERIFY (5 steps); also documented in 29-RESEARCH.md §Manual Verifications |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (populated post-planning)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (Plan 29-00 lands the schema; downstream test files created in subsequent plans)
- [x] No watch-mode flags
- [x] Feedback latency < 90s
- [ ] `nyquist_compliant: true` set in frontmatter (set by gsd-validate-phase at phase close)

**Approval:** pending execution
