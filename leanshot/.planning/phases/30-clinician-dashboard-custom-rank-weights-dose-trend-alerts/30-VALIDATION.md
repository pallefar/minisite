---
phase: 30
slug: clinician-dashboard-custom-rank-weights-dose-trend-alerts
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-17
---

# Phase 30 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Source-of-truth Validation Architecture lives in `30-RESEARCH.md`.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x (unit + RLS integration) + Deno test (Edge Functions) + Playwright (e2e + realtime) |
| **Config file** | `vitest.config.ts`, `vitest-e2e.config.ts`, `deno.json` (per-fn), `playwright.config.ts` |
| **Quick run command** | `npm run test:unit -- <changed-file>` (vitest) or `deno test supabase/functions/<fn>/` |
| **Full suite command** | `npm run test && npm run lint && npm run lint:stripe-phi && npm run build && deno test supabase/functions/**` |
| **Estimated runtime** | ~120s quick / ~7min full |

---

## Sampling Rate

- **After every task commit:** scoped quick command (vitest --run for changed file OR deno test for changed fn)
- **After every plan wave:** `npm run test && deno test supabase/functions/**` (RLS suites + edge-fn suites)
- **Before `/gsd:verify-work`:** Full suite green + bundle ceiling (`npm run build && bash scripts/assert-clinic-bundle-budget.sh`) + Stripe PHI lint (`npm run lint:stripe-phi`)
- **Max feedback latency:** 120 seconds

---

## Per-Task Verification Map

> Populated by gsd-planner after planning. Each plan task's `<acceptance_criteria>` becomes a row here.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 30-00-01 | 00 | 0 | CLIN-01,02,07 | T-30-W0-01 | RECONCILE migration drafted: ADD `org_settings.ranking_weights jsonb null`, ADD `org_settings.dose_trend_thresholds jsonb default`, CREATE `org_patient_thresholds`, CREATE `clinician_alerts`, CREATE `clinician_alert_deliveries`, EXTEND `rank_org_patients` SECDEF with NULL-fallback | grep + filename regex | see 30-00-PLAN Task 1 automated | ❌ W0 | ⬜ pending |
| {to be filled by planner per plan} | … | … | … | … | … | … | … | … | … |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `supabase/migrations/20270601300001_p30_reconcile.sql` — Plan 30-00 RECONCILE migration (extends org_settings + creates 3 new tables + extends rank_org_patients SECDEF + adds 2 matviews + adds 3 pg_cron jobs)
- [ ] `leanshot/src/lib/__tests__/rls-clinician-alerts.test.ts` — cross-tenant proof per [[reference_supabase_project]] (BLOCKER R1)
- [ ] `leanshot/src/lib/__tests__/rls-org-patient-thresholds.test.ts` — cross-tenant proof (BLOCKER R1)
- [ ] `leanshot/src/lib/__tests__/rank-org-patients-weights.test.ts` — NULL-fallback + weighted-ranking invariant
- [ ] `supabase/functions/clinician-alert-deliver-cron/clinician-alert-deliver-cron.test.ts` — deno tests (retry semantics + PHI-free template)
- [ ] `leanshot/e2e/clinician-alert-realtime.spec.ts` — Playwright realtime broadcast → panel renders within 5s
- [ ] `leanshot/e2e/clinic-ranking-weights-roster-reorder.spec.ts` — Playwright weight-save → roster reorder within 1s (SC#1)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Resend non-PHI alert email arrives in clinician inbox with no patient identifiers | CLIN-03 | Email-rendering is template-driven; visual + receipt inspection | Trigger detect-cron manually; observe `noreply@app.leanshot.app` → `+test1@gmail.com`; confirm subject `New clinical alert — {org_name}`, body single CTA, NO patient name / dose / diagnosis |
| In-app realtime panel reflects new alert within 5s | CLIN-03 SC#3 | Browser session + WebSocket connection | Two-tab test: insert alert via SECDEF in tab A; observe ClinicianAlertsPanel render in tab B (clinician's authenticated session) |
| Auto-resolve cron transitions 7d-old pending alerts | CLIN-06 SC#4 | Time-travel SQL or 7-day wait | Set test alert `created_at = now() - interval '8 days'`; run auto-resolve cron manually; assert status = 'auto_resolved' |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies (populated post-planning)
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter (by gsd-validate-phase at phase close)

**Approval:** pending
