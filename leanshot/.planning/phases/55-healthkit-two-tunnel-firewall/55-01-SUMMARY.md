---
phase: 55-healthkit-two-tunnel-firewall
plan: "01"
subsystem: firewall
tags: [eslint, runtime-guard, ci-gate, health, apple-5-1-3, HEALTH-04, HEALTH-08]
dependency_graph:
  requires: []
  provides: [eslint-rule-no-health-in-ad-context, assertHealthTunnel, check-no-health-in-ad-context-sh]
  affects: [leanshot/eslint.config.js, .github/workflows/ci.yml]
tech_stack:
  added: []
  patterns: [3-layer-MUST-NEVER-enforcement, Phase-39-PHARMA-02-precedent, comment-stripped-grep-gate]
key_files:
  created:
    - leanshot/eslint-rules/no-health-in-ad-context.cjs
    - leanshot/eslint-rules/__tests__/no-health-in-ad-context.test.cjs
    - leanshot/src/lib/native/healthAssert.ts
    - leanshot/src/lib/native/healthAssert.test.ts
    - leanshot/scripts/check-no-health-in-ad-context.sh
    - leanshot/scripts/__tests__/check-no-health-in-ad-context.test.ts
  modified:
    - leanshot/eslint.config.js
    - leanshot/package.json
    - .github/workflows/ci.yml
decisions:
  - key: additive-eslint-wiring
    what: "New leanshot-health plugin block added AFTER Phase 39 pharma block in eslint.config.js; Phase 12 Zones 1-6 and Blocks A-C unchanged"
    why: "Plan requires ADDITIVE — existing firewall zones must not be touched"
  - key: importer-scoped-rule-design
    what: "ESLint rule scopes to ad-context IMPORTER files; non-ad files return {} no-op"
    why: "Rule is about blocking the ad-side from pulling health; health.ts itself must be unlinted by this rule"
  - key: vitest-config-workaround
    what: "Tests run via npx vitest run --config vite.config.ts (not default vitest run)"
    why: "Vitest 4.x projects: block in vitest.config.ts masks default test: config (per reference_vitest_4_projects_config_masks_default)"
metrics:
  duration_minutes: 15
  completed: "2026-05-25"
  tasks_completed: 3
  files_created: 6
  files_modified: 3
---

# Phase 55 Plan 01: Two-Tunnel Firewall — Three Layers Summary

Three independent firewall layers preventing HealthKit/PHI from reaching ad-targeting surfaces (Apple §5.1.3 compliance), each individually unit-tested: ESLint AST rule + runtime assertHealthTunnel guard + comment-stripped CI grep gate.

## What Was Built

### Layer 1: ESLint AST Rule (`no-health-in-ad-context.cjs`)

**File:** `leanshot/eslint-rules/no-health-in-ad-context.cjs`

Custom ESLint rule (CommonJS `.cjs` per package.json `"type":"module"` convention) that fires on `ImportDeclaration` nodes in files matching `FORBIDDEN_IMPORTERS` (ad/marketing/analytics/affiliate directories OR `*.ad-eligible.ts` suffix). Reports `crossImport` messageId when the import path matches `HEALTH_IMPORT` (`native/health` or `@/lib/native/health`).

Wired into `eslint.config.js` ADDITIVELY after the Phase 39 `leanshot-pharma` block:
- Plugin: `leanshot-health`, rule: `no-health-in-ad-context`
- Scoped to: `src/lib/ads/`, `src/lib/analytics/`, `src/lib/marketing/`, `src/lib/affiliate/`, `src/lib/native/ads*.ts`, `src/**/*.ad-eligible.ts`
- Test files excluded
- Phase 12 Zones 1-6 + Blocks A-C confirmed unchanged (7 zone messages present)

**Test:** `leanshot/eslint-rules/__tests__/no-health-in-ad-context.test.cjs`
- 4 fixtures via `RuleTester` / `node --test`
- INVALID: analytics file imports `../native/health` (Fixture 1)
- INVALID: `*.ad-eligible.ts` file imports `@/lib/native/health` (Fixture 2)
- VALID: marketing file imports `./platform` (non-health, Fixture 3)
- VALID: `healthkit/` component imports `./health` (non-ad file, Fixture 4)
- All 4 pass; zero false positives on existing src/

### Layer 2: Runtime Guard (`assertHealthTunnel`)

**File:** `leanshot/src/lib/native/healthAssert.ts`

Exports `assertHealthTunnel(callerContext: string): void`. Module-level `isLoudEnvironment()` evaluates once at import: returns `true` in DEV or when `MODE === 'test'` (Vitest), falls back to `true` (loud) when `import.meta.env` is unavailable (Node test runner). In loud environments, throws `Error` with message: `"Two-tunnel firewall: health data accessed in ad context [callerContext]. Apple §5.1.3 violation."` In production, `console.error`-logs only.

Mirrors the `phaCheck.ts` Phase 39 PHARMA-02 precedent exactly.

**Test:** `leanshot/src/lib/native/healthAssert.test.ts`
- 4 vitest tests (run via `--config vite.config.ts` due to Vitest 4.x projects: config)
- Throws in test env (Vitest sets MODE=test)
- Thrown message contains caller context string
- Thrown message contains `§5.1.3`
- Thrown error is `instanceof Error` with descriptive message
- All 4 pass

### Layer 3: CI Grep Gate (`check-no-health-in-ad-context.sh`)

**File:** `leanshot/scripts/check-no-health-in-ad-context.sh`

Bash script (`set -euo pipefail`). Resolves src root (tries `leanshot/src`, then `src`, then script-relative `../src`). Uses `find` to enumerate `*.ts`/`*.tsx` files under `ads/`, `ad/`, `marketing/`, `analytics/`, `affiliate/` directories and `*.ad-eligible.ts` files. Excludes `*.test.ts`, `*.test.tsx`, `__tests__/`, `node_modules/`, `dist/`, `dist-marketing/`, `coverage/`. For each file, strips `/* */` block comments and `//` line comments via `perl -0pe` then checks for `from '.*native/health` or `from "@.*native/health"`. Exits 1 with `::error::` annotation on violation; exits 0 on clean; exits 2 if src root not found.

**Wiring:**
- `package.json`: `"lint:health-firewall": "bash scripts/check-no-health-in-ad-context.sh src"`
- `.github/workflows/ci.yml`: new step `"Two-tunnel firewall health gate (HEALTH-08 Layer 3)"` in the `lint` job after the CSS logical-properties gate

**Test:** `leanshot/scripts/__tests__/check-no-health-in-ad-context.test.ts`
- 4 vitest tests using `spawnSync` with tmp directories
- Violation fixture (analytics dir + health import) exits 1 with `::error::` in stderr
- Clean tree exits 0
- Block-comment-only health reference exits 0 (comment-strip proof)
- Missing src root exits 2
- All 4 pass

**Real src run:** exits 0 (no existing violations in the codebase)

## Verification Results

| Check | Result |
|-------|--------|
| `node --test eslint-rules/__tests__/no-health-in-ad-context.test.cjs` | 4/4 pass |
| `npx vitest run --config vite.config.ts src/lib/native/healthAssert.test.ts` | 4/4 pass |
| `npx vitest run --config vite.config.ts scripts/__tests__/check-no-health-in-ad-context.test.ts` | 4/4 pass |
| `bash scripts/check-no-health-in-ad-context.sh src` | exits 0 (OK) |
| Phase 12 Zone 1-6 messages present | 7 confirmed |
| No false positives from `leanshot-health/no-health-in-ad-context` | confirmed |

## Deviations from Plan

**1. [Rule 1 - Bug] Arrow character in test file comments caused esbuild parse failure**
- **Found during:** Task 3 initial test run
- **Issue:** Unicode `→` characters in JSDoc comments inside the `.test.ts` file caused `esbuild` to fail with "Expected ';' but found '→'" (esbuild treats the file as TS source)
- **Fix:** Replaced `→` with `--` in JSDoc comment lines inside the test file
- **Files modified:** `scripts/__tests__/check-no-health-in-ad-context.test.ts`
- **Commit:** included in e0c6cd9c

**2. [Rule 3 - Blocking] Vitest 4.x `projects:` config masks default test discovery**
- **Found during:** Task 2 verification
- **Issue:** `npx vitest run src/lib/native/healthAssert.test.ts` collected 0 tests due to Vitest 4.x `projects:` block masking default `test:` config (per `reference_vitest_4_projects_config_masks_default`)
- **Fix:** Used `--config vite.config.ts` flag for all vitest invocations targeting health firewall tests; documented in SUMMARY
- **Impact:** Plan verify command needs `--config vite.config.ts`; workaround is established project pattern

## Known Stubs

None. All 3 firewall layers are fully functional:
- Layer 1 wired in ESLint config and fires on real violations
- Layer 2 throws in dev/test per design (Plan 55-03 will wire health.ts exports to call it)
- Layer 3 runs against real src and reports correctly

## Threat Flags

None. The files created in this plan are themselves the mitigation for T-55-01-01 through T-55-01-04 (per the plan's threat model). No new network endpoints, auth paths, file access patterns, or schema changes introduced.

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 — Layer 1 ESLint rule | 38f7cdab | feat(55-01): Layer 1 — ESLint AST rule no-health-in-ad-context + wiring |
| 2 — Layer 2 runtime guard | bae764de | feat(55-01): Layer 2 — assertHealthTunnel runtime guard + vitest test |
| 3 — Layer 3 CI grep gate | e0c6cd9c | feat(55-01): Layer 3 — CI grep gate + vitest test + ci.yml/package.json wiring |

## Self-Check: PASSED

- [x] `leanshot/eslint-rules/no-health-in-ad-context.cjs` — created (commit 38f7cdab)
- [x] `leanshot/eslint-rules/__tests__/no-health-in-ad-context.test.cjs` — created (commit 38f7cdab)
- [x] `leanshot/src/lib/native/healthAssert.ts` — created (commit bae764de)
- [x] `leanshot/src/lib/native/healthAssert.test.ts` — created (commit bae764de)
- [x] `leanshot/scripts/check-no-health-in-ad-context.sh` — created (commit e0c6cd9c)
- [x] `leanshot/scripts/__tests__/check-no-health-in-ad-context.test.ts` — created (commit e0c6cd9c)
- [x] Commits 38f7cdab, bae764de, e0c6cd9c confirmed in git log
