---
phase: 23-tech-debt-sweep-launch-polish
plan: "02"
subsystem: ci-tooling
tags: [ci-gate, knip, ts-unused-exports, tech-debt, baseline-diff, devDeps]
requires: [23-01]
provides: [DEBT-05-ci-gate, unused-exports-baseline]
affects: [.github/workflows/ci.yml, leanshot/package.json]
tech-stack:
  added:
    - knip@6.14.1 (devDep — unused file/export/dep detector)
    - ts-unused-exports@11.0.1 (devDep — TypeScript unused-export scanner)
  patterns:
    - warn-on-new baseline gate (exits 1 only when warn count exceeds committed baseline)
    - D-17 organic escalation (baseline=0 → fail-on-any-warn automatically)
key-files:
  created:
    - leanshot/knip.config.ts
    - leanshot/ts-unused-exports.json
    - leanshot/scripts/check-unused-baseline.sh
    - .github/workflows/baselines/unused-exports.json
  modified:
    - leanshot/package.json (added knip, ts-unused-exports devDeps + unused-check script)
    - leanshot/package-lock.json
    - .github/workflows/ci.yml (added unused-check job)
key-decisions:
  - "Baseline set to 164 knip / 227 tue to absorb concurrent 23-03 on-disk state"
  - "ts-unused-exports has no config file; ts-unused-exports.json is documentation consumed by bash script"
  - "jq selector uses per-array length to avoid nested-array ambiguity in duplicates field"
requirements-completed: [DEBT-05]
duration: "8 min"
completed: "2026-05-16T12:44:30Z"
---

# Phase 23 Plan 02: knip + ts-unused-exports CI Gate Summary

knip@6.14.1 + ts-unused-exports@11.0.1 installed as devDeps with a warn-on-new baseline gate wired into CI, blocking PRs that ADD unused exports but absorbing the existing 164/227 tech-debt baseline per D-16.

## Overview

**Duration:** 8 min (2026-05-16T12:36:00Z → 2026-05-16T12:44:30Z)  
**Tasks completed:** 4/4  
**Files created:** 4 | **Files modified:** 3

## Commits

| Task | Hash | Description |
|------|------|-------------|
| T1 | `da81999` | feat(23-02): install knip + ts-unused-exports devDeps + unused-check npm script |
| T2 | `2abf873` | feat(23-02): knip.config.ts + ts-unused-exports.json with D-15 exclusions |
| T3 | `40ce98a` | feat(23-02): scripts/check-unused-baseline.sh + initial baseline JSON |
| T4 | `57f20dd` | feat(23-02): wire unused-check job into ci.yml (parallel to audit-deferred-tests) |

## Initial Baseline Warn Counts

| Tool | Metric | Value |
|------|--------|-------|
| knip | Total warns | **164** |
| knip | — Unused files | 15 |
| knip | — Unused exports | 52 |
| knip | — Unused types | 41 |
| knip | — Duplicate export pairs | 56 |
| ts-unused-exports | Modules with >=1 unused export | **227** |

Baseline committed at `.github/workflows/baselines/unused-exports.json`.  
Captured from commit `2abf873` on 2026-05-16.

## Bundle Delta

**Zero.** `knip` and `ts-unused-exports` are `devDependencies` only — they never appear in production builds. Verified: `dist/assets/` contains no chunks with `knip` or `ts-unused` in filename/content.

## CI Job

```yaml
unused-check:
  name: Unused exports check
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with:
        node-version: '22'
        cache: 'npm'
        cache-dependency-path: leanshot/package-lock.json
    - run: npm ci
    - name: Baseline diff (knip + ts-unused-exports)
      run: bash scripts/check-unused-baseline.sh
```

Job runs parallel to `lint`, `typecheck`, `test-unit` (no `needs:` dependency, per D-18 signal-only posture).

## Gate Logic

- **Exit 0** when `current_warns <= baseline_warns` for both tools (pass)
- **Exit 1** when `current_warns > baseline_warns` for either tool (blocks PR)
- **D-17 organic escalation**: when a cleanup PR drives baseline to 0, the gate automatically enforces fail-on-any-warn — no workflow change needed

## Regression Test Evidence

- Baseline at 164/227 → `npm run unused-check` exits 0 (PASS)
- Baseline decremented to 162/225 → script exits 1 (FAIL: warns INCREASED)
- Restored to 164/227 → exits 0 again

## False-Flag Exclusions Added to ignoreDependencies

Beyond the D-15 path list, these were needed because knip traced `package.json` entries not imported in TypeScript source:

| Package | Reason |
|---------|--------|
| `@capacitor/android` | Consumed by Capacitor native build system, not TS imports |
| `@capacitor/ios` | Same |
| `@capacitor/clipboard`, `@capacitor/filesystem`, `@capacitor/haptics`, `@capacitor/keyboard`, `@capacitor/network`, `@capacitor/preferences`, `@capacitor/splash-screen`, `@capacitor/status-bar` | Capacitor bridge plugins — used at runtime via Capacitor, not statically imported |
| `ts-unused-exports` | CLI tool — not imported in src/ |
| `eslint-plugin-*`, `tailwindcss`, `prettier`, `rollup-plugin-visualizer`, `@lhci/cli`, `@capacitor/cli`, `stripe`, `supabase`, `tsx`, `@playwright/test`, test infrastructure | CLI/plugin tooling only |

## Deviations from Plan

**1. [Rule 1 - Bug] ts-unused-exports has no JSON config file support**
- **Found during:** Task 2
- **Issue:** Plan's `<interfaces>` block specified `ts-unused-exports.json` with `pathsToIgnore` as if the tool reads a JSON config. It does not — it's purely CLI-driven.
- **Fix:** `ts-unused-exports.json` now serves as documentation for the script's CLI flags (note added via `_comment` key). The shell script reads it conceptually (the flags are hardcoded matching the JSON values). Tool has `--ignoreFiles=<regex>` and `--excludePathsFromReport=<semicolons>` for exclusions.
- **Files modified:** `leanshot/ts-unused-exports.json`, `leanshot/scripts/check-unused-baseline.sh`
- **Commit:** `40ce98a`

**2. [Rule 1 - Bug] jq flatten approach gave wrong duplicate count**
- **Found during:** Task 3
- **Issue:** Plan's `<interfaces>` jq skeleton used `flatten` on the full issues array, which flattened `duplicates[][items]` into individual items (2 per pair = 112) instead of counting pairs (56). This doubled the duplicate contribution and made the baseline unstable.
- **Fix:** Used per-array `length` sum: `[(.issues[].duplicates | length), ...]|add` which counts pairs correctly and matches Python validation.
- **Files modified:** `leanshot/scripts/check-unused-baseline.sh`
- **Commit:** `40ce98a`

**3. [Context] Baseline set to 164/227 (not 163/226)**
- **Context:** Plan 23-03 ran concurrently and added `PatientActivityModal.tsx` to disk before our baseline capture. This extra file contributed +1 knip unused-file and +1 tue module. Baseline was set to the higher value (164/227) so the gate passes once the wave merges. The gate exits PASS with "decreased" message when knip returns 163 (the file is traced in some runs).

**Total deviations:** 2 auto-fixed (Rule 1), 1 context note. **Impact:** Gate works correctly, no plan goals missed.

## Self-Check

- [x] `leanshot/knip.config.ts` exists: confirmed
- [x] `leanshot/ts-unused-exports.json` exists: confirmed  
- [x] `leanshot/scripts/check-unused-baseline.sh` exists: confirmed (chmod +x applied)
- [x] `.github/workflows/baselines/unused-exports.json` exists with `knip_warns` + `tue_warns`: confirmed
- [x] `.github/workflows/ci.yml` has `unused-check` job: confirmed (python3 yaml.safe_load passes)
- [x] `npm run unused-check` exits 0: confirmed
- [x] Regression test (exit 1 on baseline-1): confirmed
- [x] Commits exist: da81999, 2abf873, 40ce98a, 57f20dd

## Self-Check: PASSED
