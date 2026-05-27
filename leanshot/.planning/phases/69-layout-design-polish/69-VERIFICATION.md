---
phase: 69
status: human_needed
verified: 2026-05-27
mode: automated-verify-only
---

# Phase 69: Layout & Design Polish — VERIFICATION

## Automated Verification (PASS)

| Check | Method | Result |
|-------|--------|--------|
| 3 CI fail-gates exist | `ls scripts/ci/check-{tailwind-tokens,typography-ceiling,accent-reserved}.ts` | ✅ |
| 5 audit-report scripts exist | `ls scripts/ci/audit-{ds-primitives,a11y-baseline,mobile-responsive,spacing,copywriting}.ts` | ✅ |
| GH workflow valid | `cat .github/workflows/design-system-check.yml` | ✅ |
| 3 grandfather baselines | `wc -l scripts/ci/check-*.baseline.txt` | ✅ 3 / 366 / 12 |
| 137 Deno tests pass | `deno test --no-check scripts/ci/check-*.test.ts scripts/ci/audit-*.test.ts` | ✅ 137/137 |
| Playwright VR spec exists | `ls leanshot/tests/vr/v1.4/{baseline.spec.ts,README.md}` + `leanshot/playwright.config.vr.ts` | ✅ |
| 7 v1.4 routes referenced in VR spec | grep route literals | ✅ |
| 4 audit reports generated | `ls leanshot/.planning/design-system/*-report.md` | ✅ |
| accent-reserved-list.md | `wc -l leanshot/.planning/design-system/accent-reserved-list.md` | ✅ |
| DESIGN-DECISIONS.md stub | `ls leanshot/.planning/design-system/DESIGN-DECISIONS.md` | ✅ |
| tsc | `npx tsc --noEmit` in leanshot/ | ✅ exit 0 |

## Human-Verify Signals (DEFERRED — mix of 69.5 + 69.7 + 70)

| Signal | Owner | Description |
|--------|-------|-------------|
| S1: CI gates fire on next PR | Phase 70 first-PR | DS-01/02/03 workflow activates on next push; new violations blocked |
| S2: Operator runs `gsd-ui-auditor` against 7 v1.4 surfaces | Phase 69.5 | DS-10 evidence |
| S3: Fix 4 DS-04 primitive duplicates | Phase 69.5 | 2 Card + 2 Modal refactors |
| S4: Fix 10 DS-05 a11y findings | Phase 69.5 | 9 framer-missing-reduced-motion + 1 input-missing-label |
| S5: Triage 114 DS-07 mobile findings | Phase 69.5 | Many likely false-positives (heuristic); filter then fix |
| S6: Fix 15 DS-08 spacing findings | Phase 69.5 | All margin/padding non-multiples-of-4 |
| S7: Run `npx playwright install chromium` + `npx playwright test --config playwright.config.vr.ts --update-snapshots` | Phase 69.7 | Capture baseline snapshots |
| S8: Commit VR baselines (LFS / raw / external bucket — operator chooses) | Phase 69.7 | One-time policy decision |
