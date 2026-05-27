---
phase: 69
title: Layout & Design Polish
status: code-complete (audit-fixes-deferred-to-69.5)
shipped: 2026-05-27
mode: autonomous --from 65 --to 69 (compressed-planner)
plans_completed: 5-of-5
requirements: [DS-01, DS-02, DS-03, DS-04, DS-05, DS-06, DS-07, DS-08, DS-09, DS-10]
---

# Phase 69: Layout & Design Polish — SUMMARY

**Goal:** Design-system harmonization across all v1.1/v1.2/v1.3/v1.4 surfaces. Ship CI gates that prevent regression + audit scripts that report violations + VR snapshot suite for dark-mode parity.

**Status:** **CODE-COMPLETE.** All 5 plans shipped to main. Three CI fail-gates active on next PR. Seven audit-report scripts ship 139 first-run findings; operator fixes in Phase 69.5. VR baseline snapshot capture deferred to Phase 69.7 after deploy.

## REQ-ID Coverage

| REQ-ID | Plan | Code-Complete | Notes |
|--------|------|---------------|-------|
| DS-01 (undefined @theme token CI gate) | 69-01 | ✅ | 3 grandfathered files in baseline.txt |
| DS-02 (typography ceiling CI gate) | 69-01 | ✅ | 366 grandfathered files in baseline.txt |
| DS-03 (accent reserved-list CI gate) | 69-01 | ✅ | 12 grandfathered files in baseline.txt |
| DS-04 (DS primitive adoption audit) | 69-02 | ✅ | 4 candidates flagged (2 Card + 2 Modal); fix → 69.5 |
| DS-05 (a11y baseline audit) | 69-03 | ✅ | 10 findings (9 missing useReducedMotion); fix → 69.5 |
| DS-06 (Dark mode VR parity) | 69-04 | ✅ | Spec + config + README; baselines captured post-deploy |
| DS-07 (Mobile responsive audit) | 69-03 | ✅ | 114 findings; operator filter → 69.5 |
| DS-08 (Spacing audit, multiples-of-4) | 69-03 | ✅ | 15 findings; fix → 69.5 |
| DS-09 (Copywriting consistency) | 69-03 | ✅ | **0 findings — codebase clean** |
| DS-10 (gsd-ui-auditor clean-run) | 69-05 | ⏭ | Auditor run deferred to Phase 69.5 against 7 v1.4 surfaces |

## Plans Shipped

| Plan | Outcome | Tests |
|------|---------|-------|
| 69-01 | 3 CI fail-gates (`check-tailwind-tokens.ts` / `check-typography-ceiling.ts` / `check-accent-reserved.ts`) + `.baseline.txt` grandfather allow-list per gate + `design-system-check.yml` workflow + `accent-reserved-list.md` doc. | 41 Deno (14+14+13) |
| 69-02 | `audit-ds-primitives.ts` report-only script + `primitive-adoption-report.md` template. 4 candidates flagged in first run. | 20 Deno |
| 69-03 | 4 audit-report scripts: a11y (10), mobile-responsive (114), spacing (15), copywriting (0) + `DESIGN-DECISIONS.md` exception-catalogue stub. | 76 Deno (23+19+16+18) |
| 69-04 | `tests/vr/v1.4/baseline.spec.ts` Playwright VR suite + `playwright.config.vr.ts` + README. Catches: 7 v1.4 surfaces × 4 variants (light/dark × mobile-375/desktop-1280). Critical Rule-1 fix: `seedThemeDark()` helper instead of `emulateMedia({colorScheme})` — app applies `data-theme` pre-paint from localStorage. | n/a (spec runs against staging) |
| 69-05 | Close-out (this SUMMARY + VERIFICATION + CARRY-OVER + ROADMAP/STATE/REQUIREMENTS flips + Phase 69.7 insertion). Inline. | — |

**Total new tests:** 137 Deno (all green). Total scripts shipped: 8 (3 fail-gates + 5 audit-reports). Total docs: 3 (accent-reserved-list, DESIGN-DECISIONS, VR README).

## Patterns Established / Reinforced

1. **Grandfather-via-`.baseline.txt`** (69-01) — when adding CI gates to a codebase with pre-existing violations, ship a baseline allow-list file alongside the script. New PRs fail on NEW violations; pre-existing 3/366/12-file baselines tolerated. Operator removes baseline entries as Phase 69.5 fixes them.

2. **Report-only audit scripts** (69-02 + 69-03) — exit-code-0 always. Heuristic regex + markdown report. Operator filters in fix pass. Pattern parity across all 5 audit scripts: `parseArgs / scanFile / scanRoot / buildReport / runMain`.

3. **VR `seedThemeDark()` over `emulateMedia`** — app's `data-theme` is set pre-paint from localStorage in `main.tsx`, NOT from OS colorScheme. Browser emulation alone produces light-themed snapshots in dark-variant slots. Use existing project test helpers.

4. **CI gate pattern reusable across DS dimensions** — Phase 67-03's two-layer real-vs-stub classifier (per `[[reference_two_layer_real_vs_stub_classifier]]`) applies here: VALID_USAGE_MARKERS (Tailwind built-ins + @theme tokens) first, VIOLATION_PATTERNS only on absence.

5. **CTA copywriting canonical-verb list as enforcement target** — DS-09 audit found 0 findings, suggesting the codebase already follows canonical verbs. CI gate could promote DS-09 from audit to fail-gate in v1.5.

## What Didn't Land (Carry to 69.5 / 69.7 / 70)

- DS-04..DS-09 audit-report FIXES (139 findings total across 4 reports)
- DS-10 gsd-ui-auditor run against 7 v1.4 surfaces
- VR baseline snapshot capture (run after Phase 69.7 deploy)
- Phase 60 carry-over 9 UI-review FLAGs (deferred per Phase 60 close-out plan)
- Pre-existing test failures: `modules.test.ts`, `auth.test.ts`, `aal2-step-up.test.ts`, `billing-sync.test.ts`, `job-polling.test.ts` (see prior carry-overs)
