---
phase: 3
slug: pharmacology-insights-hardening
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-11
updated: 2026-05-11
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4 (already wired inline in `vite.config.ts:91-99`) |
| **Config file** | `vite.config.ts` (inline `test:` block; no separate `vitest.config.ts`) |
| **Quick run command** | `npm run test -- --run <changed-file>` |
| **Full suite command** | `npm run test -- --run` |
| **Estimated runtime** | ~10 seconds full suite (pure-fn unit + RTL); ~2 seconds for a single file |

---

## Sampling Rate

- **After every task commit:** Run `npm run test -- --run <changed-file>`
- **After every plan wave:** Run `npm run test -- --run` (full suite)
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** ~10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 3-01-01 | 01 | 1 | PK-01 | T-03-01 | Disclaimer constants single source of truth | source assertion | `grep -c "export const PK_DISCLAIMER_" src/lib/disclaimers.ts` | ✅ created in task | ⬜ pending |
| 3-01-02 | 01 | 1 | PK-01 | T-03-01 / T-03-03 | Corpus carries verifiable DOI/URL citations | source assertion | `grep -F "10.1007/s13300-018-0458-5" src/lib/pharmacology-corpus.ts` | ✅ created in task | ⬜ pending |
| 3-01-03 | 01 | 1 | PK-01 | T-03-01 | ±15% steady-state predicate enforced for 5 drug classes | unit | `npm run test -- --run src/lib/pharmacology.test.ts` | ✅ created in task | ⬜ pending |
| 3-02-01 | 02 | 1 | PK-02 | T-03-04 | tokenize + isDoseChangeAdvice + scrubInsights pure functions exist | source assertion | `grep -c "export function" src/lib/insights-refusal.ts` | ✅ created in task | ⬜ pending |
| 3-02-02 | 02 | 1 | PK-02 | T-03-04 | 30-row adversarial corpus enforces refusal-list behavior | unit | `npm run test -- --run src/lib/insights-refusal.test.ts` | ✅ created in task | ⬜ pending |
| 3-02-03 | 02 | 1 | PK-02 | T-03-04 / T-03-05 | generateInsights scrubbed; pickFocus guarded | unit + source | `npm run test -- --run src/lib/` + `grep -c isDoseChangeAdvice src/lib/insights.ts` | ✅ modified in task | ⬜ pending |
| 3-03-01 | 03 | 2 | PK-04 | T-03-07 | Plugin id is `medLevelWatermark-v2`; two-line render via imported constants | source + unit | `grep -F "medLevelWatermark-v2" src/components/dashboard/charts/medLevelWatermarkPlugin.ts` + plugin test green | ✅ modified in task | ⬜ pending |
| 3-03-02 | 03 | 2 | PK-04 | T-03-07 | Plugin test asserts v2 id, two-line fillText, em-dash U+2014 byte | unit | `npm run test -- --run src/components/dashboard/charts/medLevelWatermarkPlugin.test.ts` | ✅ modified in task | ⬜ pending |
| 3-03-03 | 03 | 2 | PK-03 + PK-04 | T-03-07 / T-03-08 / T-03-09 / T-03-10 | Band rendered with empty-state suppression; Y-axis abstract-unit; aria-label updated; per-instance plugin discipline preserved | source assertion + typecheck | `grep -F "fill: '+1'" src/components/dashboard/charts/MedLevelChart.tsx` + `npx tsc --noEmit` | ✅ modified in task | ⬜ pending |
| 3-04-01 | 04 | 2 | PK-04 | T-03-11 | DoctorReport renders PK disclaimer aside | source assertion + typecheck | `grep -F "<aside role=\"note\"" src/components/dashboard/modals/DoctorReport.tsx` + `npx tsc --noEmit` | ✅ modified in task | ⬜ pending |
| 3-04-02 | 04 | 2 | PK-04 | T-03-11 | RTL asserts disclaimer string present in rendered DoctorReport | unit (RTL) | `npm run test -- --run src/components/dashboard/modals/DoctorReport.test.tsx` | ✅ created in task | ⬜ pending |
| 3-04-03 | 04 | 2 | PK-04 (D-09) | — | Phase 2 cross-reference docs updated | source assertion | `grep -F "medLevelWatermark-v2" .planning/phases/02-visible-compliance-public-deploy/02-06-SUMMARY.md` | ✅ modified in task | ⬜ pending |
| 3-05-01 | 05 | 1 | PK-05 | T-03-13 | Optional pkEngineVersion field + STORAGE_VERSION = 6 | source + typecheck | `grep -F "pkEngineVersion?: number" src/types/index.ts` + `grep -F "STORAGE_VERSION = 6" src/lib/storage.ts` + `npx tsc --noEmit` | ✅ modified in task | ⬜ pending |
| 3-05-02 | 05 | 1 | PK-05 | T-03-13 / T-03-16 | Chained migrate (v4 + v5 both apply via version <= N); addInjection stamps | source + unit | `grep -F "version <= 5" src/lib/store.ts` + storage test green | ✅ modified in task | ⬜ pending |
| 3-05-03 | 05 | 1 | PK-05 | T-03-13 | v5→v6 migration + v4→v6 chain + addInjection stamping covered by Vitest | unit | `npm run test -- --run src/lib/storage.test.ts` | ✅ modified in task | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

**No Wave 0 task needed.** Vitest is already wired in `vite.config.ts:91-99` (Phase 1 deliverable, complete). RTL is installed and used by Phase 1 tests. No new framework install, no new shared fixture file required.

The only "scaffold-style" task is the disclaimer constant module (`src/lib/disclaimers.ts`) created in Plan 01 Task 1 — but that is itself a deliverable artifact, not Wave 0 infrastructure. Plans 03 and 04 wait for Plan 01 via the explicit `depends_on: [01]` dependency.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Uncertainty band visually rendered on Home tab `MedLevelChart` | PK-03 | Visual rendering of a Chart.js canvas with α=0.12 fill is fundamentally a "does it look right" check. Pixel-snapshot tests would over-fit theme/font rendering. | (1) `npm run dev` (2) Open the app in browser at `localhost:5173` (3) Log a tirzepatide injection if no injections exist (4) Navigate to Home tab (5) Confirm: a shaded band visible around the past line in `--color-primary` at low alpha; band visible around the projected line in `--color-rose` at low alpha; band disappears when injections list is empty; Y-axis title reads `Estimate · arbitrary units`; watermark visible at 45° in two lines with `estimate, not measured serum level` / `— based on population pharmacokinetics`. Test in both light and dark themes. |
| DoctorReport print preview includes PK disclaimer | PK-04 | `window.print()` behavior in jsdom does not match real browser print rendering. The `print:` Tailwind utility only fires in actual print preview. | (1) `npm run dev` (2) Open DoctorReport modal from the dashboard (3) Click "Print / save PDF" (4) In the browser print preview, confirm the new `<aside>` between the patient-name header and the Summary section is visible with the verbatim `Drug-level curve: estimate, not measured serum level — based on population pharmacokinetics. Shows modeled mean with shaded inter-individual variability band (~30%).` (5) Confirm the `print:border-black` class produces a visible border in print rendering even if CSS variables degrade |

All other phase behaviors (corpus assertions, refusal-list pattern matching, watermark plugin id + text, migration back-stamping, addInjection stamping, DoctorReport disclaimer presence in DOM, Phase 2 doc updates) are automated.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (no Wave 0 needed — Vitest already wired)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (every task carries an automated command)
- [x] Wave 0 covers all MISSING references (N/A — no MISSING references)
- [x] No watch-mode flags (all commands use `--run`)
- [x] Feedback latency < 30s (full suite ~10s; per-file ~2s)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-05-11
