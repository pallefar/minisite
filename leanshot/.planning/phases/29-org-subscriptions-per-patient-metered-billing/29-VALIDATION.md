---
phase: 29
slug: org-subscriptions-per-patient-metered-billing
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-17
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
| **Config file** | `vitest.config.ts`, `deno.json` (per-fn), `playwright.config.ts` |
| **Quick run command** | `npm run test:unit -- <changed-file>` (vitest) or `deno test supabase/functions/<fn>/` |
| **Full suite command** | `npm run test && npm run lint && npm run build && deno test supabase/functions/**` |
| **Estimated runtime** | ~90 seconds quick / ~6 minutes full |

---

## Sampling Rate

- **After every task commit:** Run scoped quick command (vitest --run for changed file OR deno test for changed fn)
- **After every plan wave:** Run `npm run test && deno test supabase/functions/**` (RLS suites + edge-fn suites)
- **Before `/gsd:verify-work`:** Full suite must be green + bundle ceiling check (`npm run build && scripts/assert-clinic-bundle-budget.sh`)
- **Max feedback latency:** 90 seconds

---

## Per-Task Verification Map

> Populated by gsd-planner from PLAN.md task IDs after planning. Each PLAN task's
> `<acceptance_criteria>` becomes a row here. Plans 29-00..29-NN to be enumerated
> by gsd-planner.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 29-00-01 | 00 | 0 | ORG-08, ORG-09, ORG-10 | T-29-W0-01 | `org_subscriptions` table absent; `subscriptions.seats_*` + `profiles.primary_org_id` present | SQL probe | `supabase db query --linked "select to_regclass('public.org_subscriptions') is null and exists(select 1 from information_schema.columns where table_name='subscriptions' and column_name='seats_paid');"` | ❌ W0 | ⬜ pending |
| {to be filled by planner} | … | … | … | … | … | … | … | … | … |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `supabase/migrations/<14-digit>_phase29_reconcile.sql` — Plan 29-00 RECONCILE migration (drops `org_subscriptions`, verify-or-add `subscriptions.seats_*`, `profiles.primary_org_id`, indexes on the 5 event tables missing `(user_id, created_at)`)
- [ ] `leanshot/tests/rls/p29-org-patient-invites.rls.spec.ts` — fixture stubs file with file-scoped `TEST_SLUG_PREFIX` per [[feedback_rls_per_file_slug_prefix]]
- [ ] `leanshot/tests/rls/p29-count-active-patients.rls.spec.ts` — fixture stubs (cross-tenant impersonation proof per [[reference_supabase_project]])
- [ ] `supabase/functions/clinic-patient-invite/clinic-patient-invite.test.ts` — deno test stubs (per [[reference_deno_test_discovery]] glob)
- [ ] `supabase/functions/org-metered-billing-cron/org-metered-billing-cron.test.ts` — deno test stubs (idempotency-key invariant)
- [ ] `e2e/clinic-patient-invite-accept.spec.ts` — Playwright invite→accept→consent→primary_org_id round-trip

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Stripe Meter Event appears in Dashboard with `event_name=active_patient_month` | ORG-09 SC#2 | Stripe Test Mode Dashboard requires browser session; not scriptable via CLI without bootstrap-token-then-revoke pattern | After 02:00 UTC cron, log in to dashboard.stripe.com/test/billing/meters → confirm row with org idempotency key |
| Resend non-PHI patient invite email renders without leaking org_name surface area beyond what Phase 25 D-12 allows | ORG-10 | Email rendering is template-driven; visual inspection of inbox | Trigger `clinic-patient-invite/send` against `noreply@app.leanshot.app` to a `+test1` Gmail; inspect — confirm no patient name / no diagnosis / no dose values |
| Realtime billing surface receives `org-{hmac8}-subscriptions` UPDATE within 30s of webhook | ORG-08 SC#4 | Requires two browser tabs (admin UI + Stripe Dashboard manual subscription update) | See `29-RESEARCH.md` §Manual Verifications |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies (populated post-planning)
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 90s
- [ ] `nyquist_compliant: true` set in frontmatter (set by gsd-validate-phase at phase close)

**Approval:** pending
