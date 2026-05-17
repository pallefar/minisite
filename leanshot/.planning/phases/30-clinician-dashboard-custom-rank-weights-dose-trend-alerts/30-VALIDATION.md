---
phase: 30
slug: clinician-dashboard-custom-rank-weights-dose-trend-alerts
status: planned
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-17
planned: 2026-05-17
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
| **Quick run command** | `cd leanshot && npm run test:unit -- --run <changed-file>` (vitest) or `deno test supabase/functions/<fn>/` |
| **Full suite command** | `cd leanshot && npm run test:unit && npm run test:e2e:rls && npm run lint && npm run lint:stripe-phi && npm run build && bash scripts/assert-clinic-bundle-budget.sh && PLAYWRIGHT_RUN_P30=1 npx playwright test --project=p30 && cd .. && deno test supabase/functions/clinician-alert-deliver-cron/` |
| **Estimated runtime** | ~120s quick / ~8min full |

---

## Sampling Rate

- **After every task commit:** scoped quick command (vitest --run for changed file OR `deno test` for changed fn OR `supabase db query --linked` for changed migration)
- **After every plan wave:** `cd leanshot && npm run test:unit && npm run test:e2e:rls`
- **Before `/gsd:verify-work`:** Full suite green + bundle ceiling + Stripe PHI lint (now scanning clinician-alert-deliver-cron directory)
- **Max feedback latency:** 120 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 30-00-01 | 00 | 0 | CLIN-01,02,07 | T-30-00-04 | 2 schema migrations: org_settings cols + validator trigger; 3 new tables (clinician_alerts, clinician_alert_deliveries, org_patient_thresholds) + RLS forced + on delete restrict + clinic_matview_refresh_log; uses 'staff' enum not 'clinician' | grep + filename regex | `grep -q ranking_weights supabase/migrations/20270601300001_*.sql && grep -q 'create table if not exists public.clinician_alerts' supabase/migrations/20270601300002_*.sql && ! grep -q "'clinician'" supabase/migrations/20270601300002_*.sql` | ❌ W0 | ⬜ pending |
| 30-00-02 | 00 | 0 | CLIN-01,03,04,06 | T-30-00-01,03,05,06,08 | 3 migrations: 4 SECDEFs (ack/snooze/update_weights/set_patient_thresholds) + AFTER UPDATE trigger + weighted rank_org_patients NULL-fallback + 2 matviews + 4 pg_cron jobs at researched schedules; ORG_SCOPED_TABLES extended with 3 tables | grep + cron-job count | `grep -q 'acknowledge_clinician_alert' supabase/migrations/20270601300003_*.sql && grep -q 'p30_clinician_alert_detect' supabase/migrations/20270601300004_*.sql && grep -q 'select ranking_weights into v_weights' supabase/migrations/20270601300005_*.sql && grep -c 'clinician_alerts' supabase/functions/_shared/with-org-scope.ts | awk '\$1>=1{exit 0} {exit 1}'` | ❌ W0 | ⬜ pending |
| 30-00-03 | 00 | 0 | CLIN-01,02,04,05,06,07 | T-30-00-02 | 6 vitest files: cross-tenant RLS (clinician_alerts + org_patient_thresholds) + weighted-rank parity + debounce dedup + auto-resolve transition + matview refresh CONCURRENTLY succeeds; ES256-compat fixture + file-scoped slug prefix | vitest + tsc | `test -f leanshot/src/lib/__tests__/rls-org-clinician-alerts.test.ts && cd leanshot && npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -E '(rls-org-clinician-alerts|rank-org-patients-weights)\\.test\\.ts' | wc -l | grep -q '^0$'` | ❌ W0 | ⬜ pending |
| 30-00-04 | 00 | 0 | CLIN-01..08 | T-30-00-* | BLOCKING `supabase db push --linked` succeeds with no skipped migrations; cron.job query returns 4 P30 jobs; org_settings columns + 4 tables live | HUMAN-CHECKPOINT | `supabase db query --linked "select count(*) from cron.job where jobname like 'p30_%';" --output csv | tail -1 | grep -q '^4$'` | ❌ W0 | ⬜ pending |
| 30-01-01 | 01 | 1 | CLIN-03,04 | T-30-01-01,02,05 | clinician-alert-deliver-cron Edge Fn: _createServiceRoleClientUnsafe + channelNameFromSecret + supabase-js channel.send broadcast + Resend non-PHI template (subject `New clinical alert — {org_name}`, body single CTA) + vendor-gated startup health check + per-alert try/catch + retry/delivery_failed transition; PHI lint sweeps directory | deno test + npm run lint:stripe-phi | `cd supabase/functions/clinician-alert-deliver-cron && deno test --no-check && cd /Users/karstenhaldan/minisite/leanshot && npm run lint:stripe-phi 2>&1 | grep -qE 'OK: no PHI keywords'` | ❌ | ⬜ pending |
| 30-01-02 | 01 | 1 | CLIN-03,04 | T-30-01-01,04 | 6 Deno tests: vendor-gated skip, PHI-free template, retry_count bump, delivery_failed transition on 3rd failure, delivery_log inserts per attempt, batch resilience; body-keys assertion catches PHI metadata regression | deno test | `cd supabase/functions/clinician-alert-deliver-cron && deno test --no-check 2>&1 | tail -5 | grep -qE 'ok\\.|passed'` | ❌ | ⬜ pending |
| 30-02-01 | 02 | 1 | CLIN-01,02 | T-30-02-01,04 | ClinicRankingWeightsForm + ClinicDoseTrendThresholdsForm + ClinicSettingsPage Clinical tab; auto-normalize-on-blur; SECDEF dispatch with normalized 0–1 numerics; min/max input clamping; admin-role surface-check gate | RTL via vitest | `cd leanshot && npm run test:unit -- --run src/components/clinic/settings/ClinicRankingWeightsForm.test.tsx src/components/clinic/settings/ClinicDoseTrendThresholdsForm.test.tsx 2>&1 | tail -10 | grep -qE 'Test Files\\s+2 passed'` | ❌ | ⬜ pending |
| 30-02-02 | 02 | 1 | CLIN-01 (SC#1) | T-30-02-02,03 | use-org-settings-realtime hook subscribes to channelNameFor(orgId, 'settings') postgres_changes + invokes onWeightsChanged only for matching org_id + survives CHANNEL_ERROR; RosterTable wires hook; 30s polling failsafe preserved | RTL hook test | `cd leanshot && npm run test:unit -- --run src/components/clinic/roster/use-org-settings-realtime.test.ts 2>&1 | tail -10 | grep -qE 'Test Files\\s+1 passed'` | ❌ | ⬜ pending |
| 30-03-01 | 03 | 1 | CLIN-03,06 (SC#3) | T-30-03-01,02 | ClinicianAlertsPanel + use-clinician-alerts + use-clinician-alerts-realtime + ClinicContextBar bell + Badge tone='amber' (NOT tone='warning'); role='region' aria-label='Clinician alerts'; subscription-failure inline warning; lazy-loaded | RTL via vitest | `cd leanshot && npm run test:unit -- --run src/components/clinic/alerts/ClinicianAlertsPanel.test.tsx 2>&1 | tail -10 | grep -qE 'Test Files\\s+1 passed'` | ❌ | ⬜ pending |
| 30-03-02 | 03 | 1 | CLIN-06 | T-30-03-01 | AlertSnoozePopover with 4 preset duration buttons (1h/4h/24h/7d → SECDEF p_duration literals); role='dialog' aria-modal + focus trap + Escape close + return-focus; mobile Sheet bottom-drawer | RTL via vitest | `cd leanshot && npm run test:unit -- --run src/components/clinic/alerts/AlertSnoozePopover.test.tsx 2>&1 | tail -10 | grep -qE 'Test Files\\s+1 passed'` | ❌ | ⬜ pending |
| 30-04-01 | 04 | 1 | CLIN-05,08 | T-30-04-01,04 | ClinicDashboardOverview 4 stat cards + responsive grid + staleness caption + empty/loading states; color coding per UI-SPEC (--color-amber NOT --color-warning); reads mv_clinic_alert_metrics + mv_clinic_dose_trend_population + clinic_matview_refresh_log | RTL via vitest | `cd leanshot && npm run test:unit -- --run src/components/clinic/dashboard/ClinicDashboardOverview.test.tsx 2>&1 | tail -10 | grep -qE 'Test Files\\s+1 passed'` | ❌ | ⬜ pending |
| 30-04-02 | 04 | 1 | CLIN-07 | T-30-04-02,03 | PatientThresholdOverrideForm in ClinicDrillInPage Dose thresholds tab; canonical reset modal copy; binary-choice buttons (Reset to defaults danger + Keep current thresholds secondary); reset_patient_dose_thresholds SECDEF dispatched | RTL via vitest | `cd leanshot && npm run test:unit -- --run src/components/clinic/drill-in/PatientThresholdOverrideForm.test.tsx 2>&1 | tail -10 | grep -qE 'Test Files\\s+1 passed'` | ❌ | ⬜ pending |
| 30-05-01 | 05 | 2 | CLIN-01 (SC#1), CLIN-03 (SC#3) | T-30-05-01 | 2 Playwright specs: SC#1 weight save → roster reorder <1s; SC#3 alert INSERT → broadcast → panel render <5s; addInitScript seeding + DB-level channel.subscribe pattern per [[feedback_realtime_layer_e2e_pattern]]; PLAYWRIGHT_RUN_P30=1 gate | playwright --list | `cd leanshot && PLAYWRIGHT_RUN_P30=1 npx playwright test --list e2e/clinic-ranking-weights-roster-reorder.spec.ts e2e/clinician-alerts-realtime.spec.ts 2>&1 | tail -5 | grep -qE '[0-9]+ tests in 2 files'` | ❌ | ⬜ pending |
| 30-05-02 | 05 | 2 | CLIN-01..08 | T-30-05-02,03,04 | Deliver-cron Edge Fn deployed + UAT-probe 200; bundle ceiling clinic-shell <45 kB; 6 RLS/unit/matview test files pass live; 2 Playwright specs pass; 4 cron jobs active=true; phase SUMMARY committed | HUMAN-CHECKPOINT (CLI-driven) | `supabase db query --linked "select count(*) from cron.job where jobname like 'p30_%' and active = true;" --output csv | tail -1 | grep -q '^4$' && cd leanshot && bash scripts/assert-clinic-bundle-budget.sh 2>&1 | grep -qE 'OK: clinic-shell'` | ❌ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements (must exist before Wave 1 plans run)

- [ ] `supabase/migrations/20270601300001_p30_org_settings_extensions.sql` — Plan 30-00 Task 1
- [ ] `supabase/migrations/20270601300002_p30_clinician_alerts_schema.sql` — Plan 30-00 Task 1
- [ ] `supabase/migrations/20270601300003_p30_secdef_and_triggers.sql` — Plan 30-00 Task 2
- [ ] `supabase/migrations/20270601300004_p30_matviews_and_cron.sql` — Plan 30-00 Task 2
- [ ] `supabase/migrations/20270601300005_p30_weighted_rank_org_patients.sql` — Plan 30-00 Task 2
- [ ] `supabase/functions/_shared/with-org-scope.ts` — ORG_SCOPED_TABLES extended (Plan 30-00 Task 2)
- [ ] `leanshot/src/lib/__tests__/rls-org-clinician-alerts.test.ts` — cross-tenant proof per [[reference_supabase_project]] (BLOCKER R1)
- [ ] `leanshot/src/lib/__tests__/rls-org-patient-thresholds.test.ts` — cross-tenant proof (BLOCKER R1)
- [ ] `leanshot/src/lib/__tests__/rank-org-patients-weights.test.ts` — NULL-fallback + weighted-ranking invariant
- [ ] `leanshot/src/lib/__tests__/clinician-alert-debounce.test.ts` — UNIQUE dedup test
- [ ] `leanshot/src/lib/__tests__/clinician-alert-auto-resolve.test.ts` — 7d transition + snooze-resume
- [ ] `leanshot/src/lib/__tests__/mv-clinic-alert-metrics.test.ts` — REFRESH CONCURRENTLY succeeds + ack_rate_pct correctness
- [ ] BLOCKING `supabase db push --linked` succeeds (Plan 30-00 Task 4 checkpoint)

## Wave 1 Requirements (must exist before Wave 2 plan runs)

- [ ] `supabase/migrations/20270601300006_p30_dose_thresholds_rpc.sql` — Plan 30-02 Task 1 Step 0 (update_org_dose_trend_thresholds SECDEF)
- [ ] `supabase/migrations/20270601300007_p30_reset_patient_thresholds_rpc.sql` — Plan 30-04 Task 2 Step 0 (reset_patient_dose_thresholds SECDEF)
- [ ] `supabase/functions/clinician-alert-deliver-cron/clinician-alert-deliver-cron.test.ts` — deno tests (Plan 30-01 Task 2)
- [ ] `leanshot/src/components/clinic/roster/RosterRow.tsx` — data-testid="roster-row" + data-patient-id attributes added (Plan 30-02 Task 2; required by Plan 30-05 SC#1 e2e)

## Wave 2 Requirements (Plan 30-05 deliverables)

- [ ] `leanshot/e2e/clinician-alerts-realtime.spec.ts` — Playwright realtime broadcast → panel renders within 5s
- [ ] `leanshot/e2e/clinic-ranking-weights-roster-reorder.spec.ts` — Playwright weight-save → roster reorder within 1s (SC#1)
- [ ] Edge Function `clinician-alert-deliver-cron` deployed via `supabase functions deploy --linked`
- [ ] `bash scripts/assert-clinic-bundle-budget.sh` passes against post-build artifacts

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Resend non-PHI alert email arrives in clinician inbox with no patient identifiers | CLIN-03 | Email-rendering is template-driven; visual + receipt inspection | Trigger detect-cron via `supabase db query --linked "select cron.schedule_in_database('p30_clinician_alert_detect_oneshot', '* * * * *', '<detect-cron SQL body>', current_database());"` (one-shot) OR direct INSERT INTO clinician_alerts via service-role admin client. Wait for next */20-min deliver-cron tick OR call deliver-cron URL manually. Observe email at `noreply@app.leanshot.app` → clinician inbox; confirm subject `New clinical alert — {org_name}`, body single CTA link `/clinic/{slug}/alerts?alert={uuid}`, NO patient name / dose / diagnosis / vitals anywhere. |
| In-app realtime panel reflects new alert within 5s | CLIN-03 SC#3 | Browser session + WebSocket connection | Plan 30-05 Playwright spec automates this; manual fallback: two-tab test — service-role INSERT alert in tab A's terminal; observe ClinicianAlertsPanel bell badge update in tab B (clinician's authenticated session) within ~5s. |
| Auto-resolve cron transitions 7d-old pending alerts | CLIN-06 SC#4 | Time-travel SQL or 7-day wait | Insert test alert with `created_at = now() - interval '8 days'`, status='pending', snooze_until=null via service-role; manually invoke `04:15` cron body SQL via `supabase db query --linked`; assert status flipped to 'auto_resolved'. |
| HMAC realtime subscriptions reject cross-org subscribe attempts | CLIN-03 SC#3 (security) | Live WebSocket auth check | Manual: as User A (org X), open browser console and attempt `supabase.channel(await channelNameFor('<org Y uuid>', 'alerts')).subscribe()` — expect CHANNEL_ERROR per Phase 28 realtime_topic_authorized contract. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies (populated above)
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify (verified — every task has an automated grep / vitest / deno / playwright command)
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s (quick run); full suite ~8min acceptable for end-of-wave + pre-verify-work
- [ ] `nyquist_compliant: true` set in frontmatter (by gsd-validate-phase at phase close)

**Approval:** pending (Plan 30-05 phase-close task)
