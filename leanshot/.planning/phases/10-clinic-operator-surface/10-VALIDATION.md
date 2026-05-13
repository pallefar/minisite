---
phase: 10
slug: clinic-operator-surface
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-13
completed: 2026-05-13
---

# Phase 10 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Phase 10 = clinic operator surface (roster + drill-in + audit + bulk affordances). RLS surfaces: 1 RPC `rank_org_patients`, 1 RPC `log_clinic_view`, 1 RPC `log_bulk_export_inclusion`, 1 trigger `broadcast_patient_signal_change`, 3 Edge Function paths (`clinic-snapshot`, `patient-activity`, `bulk-csv-export`). Per project rule from memory `reference_supabase_project.md`, every NEW RLS surface gets cross-tenant impersonation proof.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Frameworks** | Vitest 2.x (unit/component) · Playwright 1.x (e2e) · Deno test (Edge Functions; `<name>.test.ts` per memory `reference_deno_test_discovery.md`) · pgTAP (cross-tenant RLS impersonation, Phase 5+ pattern) |
| **Config files** | `vitest.config.ts` (existing) · `playwright.config.ts` (existing) · `supabase/functions/<fn>/deno.json` (per-function) |
| **Quick run command** | `npm run typecheck && npm run lint && npm run test -- --run` |
| **Full suite command** | `npm run typecheck && npm run lint && npm run test -- --run && npm run test:e2e && npm run test:rls && (cd supabase/functions/clinic-snapshot && deno test --allow-all) && (cd supabase/functions/patient-activity && deno test --allow-all) && (cd supabase/functions/bulk-csv-export && deno test --allow-all)` |
| **Estimated runtime** | quick ~30s · full ~6 min (e2e contributes most; roster-perf seeds 50 patients ≈ ~30s) |

---

## Sampling Rate

- **After every task commit:** Run quick command (`npm run typecheck && npm run lint && npm run test -- --run`)
- **After every plan wave:** Run full suite for waves that touched Edge Functions or migrations (Waves 1-2-4-5); Vitest + e2e suffices for Wave 3 (frontend-only).
- **Before `/gsd-verify-work`:** Full suite must be green AND `roster-perf.spec.ts` reports < 2000ms render.
- **Max feedback latency:** quick ≤ 30s · per-wave ≤ 6 min.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 10-01-01 | 01 | 1 | CLINIC-04, CLINIC-05, CLINIC-07 | T-10-01 | New audit_logs action enums callable via INSERT; `roster.read_breakdown` permission row exists | unit (SQL probe) | `psql -c "select 1 from permissions where key='roster.read_breakdown'"` after push | ❌ W0 (Plan 10-01 creates) | ⬜ pending |
| 10-02-01 | 02 | 2 | CLINIC-04 | T-10-02 | `rank_org_patients` rejects cross-tenant call with `access_denied` | RLS pgTAP | `npm run test:rls -- 'rank-org-patients.test.ts'` | ❌ W0 (Plan 10-02 creates) | ⬜ pending |
| 10-03-01 | 03 | 2 | CLINIC-04 | T-10-03 | Realtime broadcast on `injections` INSERT only reaches orgs with `consent_scope.injections=true` | RLS pgTAP + Deno integration | `npm run test:rls -- 'realtime-clinic-broadcast.test.ts'` | ❌ W0 (Plan 10-03 creates) | ⬜ pending |
| 10-04-01 | 04 | 2 | CLINIC-05, CLINIC-07 | T-10-04 | `clinic-snapshot` returns 401/403 on missing/invalid auth; per-section permission gating works; Cache-Control header always set | Deno test | `cd supabase/functions/clinic-snapshot && deno test --allow-all` | ❌ W0 (Plan 10-04 creates) | ⬜ pending |
| 10-04-02 | 04 | 2 | CLINIC-07 | T-10-04 | `log_clinic_view` rejects non-member callers; rejects logging for patients outside org | RLS pgTAP | `npm run test:rls -- 'log-clinic-view.test.ts'` | ❌ W0 (Plan 10-04 creates) | ⬜ pending |
| 10-05-01 | 05 | 3 | CLINIC-05 | T-10-05 | `ReadOnlyPatientView` renders SharePage chrome unchanged; `clinic` mode hides photos when `permissionMap.canViewPhotos=false` | Vitest | `npm run test -- --run ReadOnlyPatientView` | ❌ W0 (Plan 10-05 creates) | ⬜ pending |
| 10-06-01 | 06 | 3 | CLINIC-04 | T-10-06 | RosterTable sorts via re-RPC; row drill-in routes correctly; threshold-cross toast fires when score crosses 70 | Vitest + Playwright | `npm run test -- --run RosterTable && npx playwright test e2e/clinic-roster-sort.spec.ts` | ❌ W0 (Plan 10-06 creates) | ⬜ pending |
| 10-07-01 | 07 | 3 | CLINIC-05, CLINIC-07 | T-10-07 | Drill-in page mounts ReadOnlyPatientView; `log_clinic_view` fires once per visible section on first mount; back button returns to roster preserving sort | Vitest + Playwright | `npm run test -- --run ClinicDrillInPage && npx playwright test e2e/clinic-drill-in.spec.ts` | ❌ W0 (Plan 10-07 creates) | ⬜ pending |
| 10-08-01 | 08 | 4 | CLINIC-07 | T-10-08 | AuditTab fetches via supabase-js with RLS; 3 filters apply + clear; per-row expand/collapse works | Vitest + Playwright | `npm run test -- --run AuditTab && npx playwright test e2e/clinic-audit.spec.ts` | ❌ W0 (Plan 10-08 creates) | ⬜ pending |
| 10-09-01 | 09 | 4 | CLINIC-07 | T-10-09 | PatientActivityModal opens scoped to org+patient; cross-tenant query returns empty; both tabs paginate | Vitest + Deno | `npm run test -- --run PatientActivityModal && cd supabase/functions/patient-activity && deno test --allow-all` | ❌ W0 (Plan 10-09 creates) | ⬜ pending |
| 10-10-01 | 10 | 5 | CLINIC-04, CLINIC-07 | T-10-10 | Bulk PDF dynamic-imports `jspdf` (no static import); CSV export RLS-respects consent_scope; per-included-patient audit row written | Vitest + Deno + bundle grep | `npm run test -- --run BulkExport && cd supabase/functions/bulk-csv-export && deno test --allow-all && ! grep -rE "^import .* from ['\"]jspdf['\"]" src/ \| grep -v test` | ❌ W0 (Plan 10-10 creates) | ⬜ pending |
| 10-11-01 | 11 | 5 | CLINIC-04, CLINIC-05, CLINIC-07 | T-10-11 | 4 Playwright e2e specs green; `roster-perf` CI job appended to ci.yml after `share-security-drill`; bundle-size + PHI-safety greps pass | Playwright + grep | `npx playwright test e2e/clinic-roster-sort.spec.ts e2e/clinic-drill-in.spec.ts e2e/clinic-audit.spec.ts e2e/clinic-bulk-pdf.spec.ts e2e/roster-perf.spec.ts && grep -A 5 'share-security-drill:' .github/workflows/ci.yml \| grep 'roster-perf:'` | ❌ W0 (Plan 10-11 creates) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Phase 10 doesn't introduce a NEW test framework — Vitest, Playwright, Deno test, and pgTAP are all in place from Phase 5/7/8/9. Wave 0 work for Phase 10 is **per-plan**: each plan creates its own test files alongside its implementation files (per project planner-iter1 anti-pattern memory: scaffolds belong with their owning plan, not in a centralized Wave 0 plan).

- [ ] Plan 10-01 creates `e2e/seed/permission-row-roster-read-breakdown.test.ts` (SQL probe).
- [ ] Plan 10-02 creates `e2e/rls-rank-org-patients.test.ts`.
- [ ] Plan 10-03 creates `e2e/rls-realtime-clinic-broadcast.test.ts`.
- [ ] Plan 10-04 creates `supabase/functions/clinic-snapshot/index.test.ts` + `e2e/rls-log-clinic-view.test.ts`.
- [ ] Plan 10-05 creates `src/components/shared/ReadOnlyPatientView.test.tsx`.
- [ ] Plan 10-06 creates `e2e/clinic-roster-sort.spec.ts`.
- [ ] Plan 10-07 creates `e2e/clinic-drill-in.spec.ts`.
- [ ] Plan 10-08 creates `e2e/clinic-audit.spec.ts` + Vitest test for AuditTab.
- [ ] Plan 10-09 creates `supabase/functions/patient-activity/index.test.ts`.
- [ ] Plan 10-10 creates `supabase/functions/bulk-csv-export/index.test.ts` + `e2e/clinic-bulk-pdf.spec.ts` + `e2e/rls-bulk-export.test.ts`.
- [ ] Plan 10-11 creates `e2e/roster-perf.spec.ts` + `e2e/fixtures/seed-org-50.ts`.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| PostHog dashboard verifies all 10 events appear within 30s of executing each user action | D-24, D-25 | Live PostHog ingestion is operationally external | After Plan 10-11 ships to staging, run each Phase 10 user flow once and check PostHog Live Events tab for the 10 event names listed in `10-EVENTS.md`. |
| jsPDF visual fidelity in bulk PDF (font fallback to Helvetica is acceptable per RESEARCH MEDIUM-confidence note) | D-22 | Visual rendering of generated PDF requires human eyes | Open the bulk PDF generated for 3 patients in Plan 10-10 e2e fixture; confirm chart images, section headings, and patient identifiers render legibly. |
| Mobile long-press bulk-select gesture | D-22, D-23 | iOS Safari touch gesture stack varies | Open `/clinic/{slug}` on iOS Safari, long-press a roster card, confirm selection bar slides up + tapping additional cards toggles selection. |
| Reduced-motion respect on row flash + threshold-cross toast | D-17, accessibility contract | OS-level accessibility setting | Enable "Reduce motion" in System Preferences; trigger a Realtime broadcast (e.g., as a patient, log an injection); confirm row flashes with opacity-only fade (no movement). |

---

## Validation Sign-Off

- [ ] All tasks have `<verify><automated>` block (no manual-only verifies in implementation tasks)
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify (Phase 10 has 11 plans × 2-3 tasks; verify map above guarantees per-task sampling)
- [ ] All 7 NEW RLS surfaces have cross-tenant impersonation proofs (project rule from memory `reference_supabase_project.md`)
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s for quick command, < 6 min for full suite
- [ ] `nyquist_compliant: true` set in frontmatter after Plan 10-01 lands the migration + permission seed AND Plan 10-11 lands the CI job

**Approval:** pending
