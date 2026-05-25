---
phase: 58
slug: spanish-i18n-wiring-contractor-delivered
status: draft
nyquist_compliant: false
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
| **Estimated runtime** | ~45s unit + ~30s locale gate; es-smoke ~1-2min |

---

## Sampling Rate

- **After every task commit:** locale-coverage gate (`bash scripts/check-locale-coverage.sh`) + tsc on changed area
- **After every plan wave:** full vitest + locale gate
- **Before verify:** locale gate green (en↔es parity + ICU validity) + es-smoke passes
- **Max feedback latency:** ~45 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| (planner populates per surface/namespace) | | | | | | | | | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] i18next-parser + eslint-plugin-i18next + Playwright already installed — existing infra covers tooling
- [ ] Extend `i18n-gate.yml` / `check-locale-coverage.sh` with Gate 3: ICU interpolation check (`grep -r "{{[a-záéíóúñ]" public/locales/es/` must find nothing) — catches translated `{{vars}}`
- [ ] Add `p58-es-smoke` project to `playwright.config.ts` (opt-in via `PLAYWRIGHT_RUN_ES_SMOKE=1`, locale via `?lang=es`)

*If none: "Existing infrastructure covers all phase requirements."*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Clinical-advisor signoff on ES medical-term translations | I18N-12 | Requires a clinical advisor (unavailable in autonomous run) | Defer to Phase 70: review clinical glossary ES terms |
| Native-speaker ES copy quality review | I18N-11 | Machine translation needs human polish | Defer to Phase 70 |

*If none: "All phase behaviors have automated verification."*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 45s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
