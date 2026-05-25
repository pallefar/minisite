---
phase: 58
slug: spanish-i18n-wiring-contractor-delivered
status: planned
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-25
---

# Phase 58 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (unit) + existing i18n CI gate (`scripts/check-locale-coverage.sh`) + Playwright (`@playwright/test`, opt-in es-smoke) |
| **Config file** | `leanshot/vite.config.ts` (vitest projects-config masks default `test:`); `leanshot/playwright.config.ts` (testDir `./e2e`) |
| **Quick run command** | `npx vitest run --config vite.config.ts <changed-area>` + `bash scripts/check-locale-coverage.sh` |
| **Full suite command** | `npx vitest run --config vite.config.ts` + `bash scripts/check-locale-coverage.sh` |
| **es-smoke command** | `PLAYWRIGHT_RUN_ES_SMOKE=1 npx playwright test e2e/i18n/es-smoke.spec.ts --project=p58-es-smoke` |
| **TS typecheck** | `npx tsc -p tsconfig.app.json --noEmit` |
| **ICU Gate 3** | `! grep -rE '\{\{[a-záéíóúñ]' public/locales/es/` |
| **Estimated runtime** | ~45s unit + ~30s locale gate; es-smoke ~1-2min |

---

## Sampling Rate

- **After every task commit:** locale-coverage gate (`bash scripts/check-locale-coverage.sh`) + tsc on changed area + Gate 3 ICU grep
- **After every plan wave:** full vitest + locale gate
- **Before verify:** locale gate green (en↔es parity + ICU validity) + es-smoke passes
- **Max feedback latency:** ~45 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 58-01-T1 | 58-01 | 1 | I18N-13 | T-58-01 | Gate 3 rejects translated `{{vars}}` (relative ES path) | CI config | `grep -q 'Gate 3' .github/workflows/i18n-gate.yml && ! grep -q 'leanshot/public/locales/es' .github/workflows/i18n-gate.yml` | ❌ creates | ⬜ pending |
| 58-01-T2 | 58-01 | 1 | I18N-15 | T-58-04 | opt-in es-smoke excluded from default run | scaffold | `test -f e2e/i18n/es-smoke.spec.ts && grep -q 'p58-es-smoke' playwright.config.ts` | ❌ creates | ⬜ pending |
| 58-01-T3 | 58-01 | 1 | I18N-12 | T-58-02 | clinical terms flagged signoff-pending | file existence | `test -f docs/clinical-glossary.md && grep -q signoff-pending docs/clinical-glossary.md && test -f docs/TRANSLATOR-WORKFLOW.md` | ❌ creates | ⬜ pending |
| 58-02-T1 | 58-02 | 1 | I18N-11 | T-58-02 | static-key helpers; no template keys | typecheck | `grep -q "useTranslation(['onboarding'" src/components/onboarding/OnboardingFlow.tsx && npx tsc -p tsconfig.app.json --noEmit` | ✅ edits | ⬜ pending |
| 58-02-T2 | 58-02 | 1 | I18N-11,13 | T-58-01,05 | en↔es parity + ICU integrity | parity gate | `bash scripts/check-locale-coverage.sh` (onboarding) + ICU grep on es/onboarding.json | ❌ creates | ⬜ pending |
| 58-03-T1 | 58-03 | 1 | I18N-11 | T-58-06 | scope guard: clinic/ untouched | typecheck | `git diff --name-only -- src/components/clinic/` empty + tsc | ✅ edits | ⬜ pending |
| 58-03-T2 | 58-03 | 1 | I18N-11,13 | T-58-01,05 | en↔es parity + ICU | parity gate | `bash scripts/check-locale-coverage.sh` (clinic) + ICU grep | ❌ creates | ⬜ pending |
| 58-04-T1 | 58-04 | 1 | I18N-11 | T-58-01 | cancellation flow keyed | typecheck | `grep -q settings:cancellation ...CancellationModal.tsx && tsc` | ✅ edits | ⬜ pending |
| 58-04-T2 | 58-04 | 1 | I18N-11,13 | T-58-01,05 | settings+kb parity + ICU | parity gate | `bash scripts/check-locale-coverage.sh` (settings,kb) + ICU grep | ❌ creates | ⬜ pending |
| 58-04-T3 | 58-04 | 1 | I18N-14 | T-58-07 | content-only migration, no schema change | sql guard | `! grep -qiE 'alter table.*add column\|create index' <migration>` | ❌ creates | ⬜ pending |
| 58-05-T1 | 58-05 | 1 | I18N-11 | T-58-02 | clinical card labels static keys | typecheck | `useTranslation patient checks + tsc` | ✅ edits | ⬜ pending |
| 58-05-T2 | 58-05 | 1 | I18N-11,13 | T-58-01,05,09 | patient.json established + parity + ICU | parity gate | `[ en≠{} ] + jq paths parity + ICU grep + coverage` | ❌ creates | ⬜ pending |
| 58-06-T1 | 58-06 | 2 | I18N-11 | T-58-02 | MedicationTab clinical keyed | typecheck | `useTranslation patient + tab-labels.ts + tsc` | ✅ edits | ⬜ pending |
| 58-06-T2 | 58-06 | 2 | I18N-11,13 | T-58-09,01,05 | card.* preserved + tab.* added + parity | parity gate | `jq -e .card + paths parity + ICU grep + coverage` | ✅ edits | ⬜ pending |
| 58-07-T1 | 58-07 | 3 | I18N-11 | T-58-02 | AI/modals/charts keyed | typecheck | `useTranslation patient + no template keys + tsc` | ✅ edits | ⬜ pending |
| 58-07-T2 | 58-07 | 3 | I18N-11,13 | T-58-09,01,05 | all prefixes present + parity + ICU | parity gate | `jq -e '.card and .tab and .ai' + paths parity + ICU + coverage` | ✅ edits | ⬜ pending |
| 58-08-T1 | 58-08 | 4 | I18N-15 | T-58-05,11 | real ES assertions, no route nav | e2e | `grep toHaveAttribute lang es + >=3 real assertions + no goto routes + tsc` | ✅ edits | ⬜ pending |
| 58-08-T2 | 58-08 | 4 | I18N-14,15 | T-58-05,11 | full smoke GREEN + all-ns parity + Gate 3 | e2e | `PLAYWRIGHT_RUN_ES_SMOKE=1 playwright test ...--project=p58-es-smoke` + coverage + ICU all | ✅ edits | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Wave 0 work is consolidated into plan **58-01** (Wave 1, native-disjoint from the namespace plans):

- [x] i18next-parser + eslint-plugin-i18next + Playwright already installed — existing infra covers tooling (verified: package.json)
- [ ] **58-01 T1:** Extend `i18n-gate.yml` with Gate 3 ICU interpolation check (`grep -rE '\{\{[a-záéíóúñ]' public/locales/es/` — RELATIVE path; the job runs `working-directory: leanshot`)
- [ ] **58-01 T2:** Add `p58-es-smoke` project to `playwright.config.ts` (opt-in `PLAYWRIGHT_RUN_ES_SMOKE=1`, `?lang=es`) + RED es-smoke scaffold
- [ ] **58-01 T3:** clinical-glossary.md + TRANSLATOR-WORKFLOW.md

Note: the 5 surface namespaces are currently empty `{}`; check-locale-coverage.sh trivially passes until keying populates EN, then bites on any ES gap.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Clinical-advisor signoff on ES medical-term translations | I18N-12 | Requires a clinical advisor (unavailable in autonomous run) | Defer to Phase 70: review `docs/clinical-glossary.md` signoff-pending rows |
| Native-speaker ES copy quality review | I18N-11 | Machine translation needs human polish | Defer to Phase 70 |
| Live `supabase db push` for KB ES seed migration + live RPC ES-result verification | I18N-14 | Needs live linked DB; autonomous run authors migration only | Defer to phase close-out / Phase 70: push migration + assert `search_kb_articles(p_locale='es')` returns ES titles |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (consolidated into 58-01)
- [x] No watch-mode flags
- [x] Feedback latency < 45s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** planned (autonomous run; clinical signoff + live db-push deferred to Phase 70)
