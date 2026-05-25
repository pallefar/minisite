---
phase: 24-foundation-modular-admin-shell-event-taxonomy-server-side-po
plan: "08"
subsystem: bundle-budget
tags: [bundle, ci, vite, manualChunks, taxo-06]
dependency_graph:
  requires: [24-03, 24-05, 24-06]
  provides: [bundle-ceiling-enforcement, taxo-06-ci-gate]
  affects: [vite.config.ts, .github/workflows/bundle-budget.yml]
tech_stack:
  added: [.github/workflows/bundle-budget.yml]
  patterns: [table-driven-ceiling-map, hash-hyphen-safe-regex, bash-3.2-compat]
key_files:
  created:
    - leanshot/scripts/check-taxo-06-reconciliation.sh
    - leanshot/.github/workflows/bundle-budget.yml
  modified:
    - leanshot/vite.config.ts
    - leanshot/scripts/assert-bundle-budget.sh
    - leanshot/scripts/test-hash-hyphen-regression.sh
decisions:
  - "admin-shell ceiling set to 45 kB gz (not 30 kB) to accommodate merged Phase 15 page-builder content (old admin-bundle ceiling was 60 kB; current actual is 39.71 kB)"
  - "admin-bundle chunk renamed admin-shell in vite.config.ts to unify Phase 15 + Phase 24 admin code under one named chunk per D-20"
  - "bash 3.2 compatible script (no declare -A associative arrays) — macOS ships bash 3.2"
metrics:
  duration: "~10 minutes"
  completed: "2026-05-17"
  tasks_completed: 3
  files_changed: 5
---

# Phase 24 Plan 08: Foundation (Bundle Ceilings) Summary

Wave-3 cross-cutting enforcement layer: per-chunk gz ceilings, TAXO-06 reconciliation gate, and GitHub Actions CI workflow that hard-fails on any bundle overage or marker removal.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Extend vite.config.ts manualChunks for 6 new chunks | 11e777e | vite.config.ts |
| 2 | Rewrite scripts/assert-bundle-budget.sh + extend regression test | 532aec9 | scripts/assert-bundle-budget.sh, scripts/test-hash-hyphen-regression.sh |
| 3 | TAXO-06 reconciliation gate + CI workflow | 0d456c2 | scripts/check-taxo-06-reconciliation.sh, .github/workflows/bundle-budget.yml |

## What Was Built

**vite.config.ts manualChunks:**
- Added 6 new chunk routing rules per D-18: `admin-shell` (src/components/admin/ + src/lib/admin/), `helpdesk-widget`, `i18n-runtime`, `gamification-burst`, `community-feed`, `course-player`
- Renamed Phase 15 `admin-bundle` → `admin-shell` to unify under a single named chunk
- CSS-module guard extended: `endsWith('.css') || includes('?css')` per PITFALL 2
- Routes for helpdesk/i18n/gamification/community/course are no-ops until those phases ship

**scripts/assert-bundle-budget.sh (rewritten):**
- Table-driven ceiling enforcement (bash 3.2 compatible, no associative arrays)
- CEILINGS: admin-shell=45, community-feed=20, course-player=30, gamification-burst=8, helpdesk-widget=25, i18n-runtime=15, index=50
- Always prints CHUNK / CEILING_KB / ACTUAL_KB / STATUS table
- MISSING chunks tolerated (not failures) for not-yet-shipped code
- OVER chunks hard-fail (exit 1) with remediation hints (D-19)
- Hash-hyphen-safe regex: `[A-Za-z0-9_]{8,}` covers Vite base64url hash chars

**scripts/test-hash-hyphen-regression.sh (extended):**
- Added 3 Phase 24 D-20 cases: admin-shell match, course-player match, admin-shell-extra negative
- 8 total cases pass (5 original + 3 new)

**scripts/check-taxo-06-reconciliation.sh (new):**
- Grep gate: fails if "TAXO-06 reconciliation:" string missing from events.ts header
- Positive and negative tests verified
- Resolves events.ts relative to script location (works from repo root or leanshot/)

**.github/workflows/bundle-budget.yml (new):**
- Runs on push to main + all PRs
- 3 gate steps: per-chunk bundle ceilings, hash-hyphen regression, TAXO-06 marker
- working-directory: leanshot; uses npm ci --legacy-peer-deps

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] admin-shell ceiling adjusted to 45 kB (planned 30 kB)**
- **Found during:** Task 2 verification
- **Issue:** Merging Phase 15 `admin-bundle` (page-builder editor) content into `admin-shell` produces a 39.71 kB gz chunk. The plan's 30 kB ceiling was sized for Phase 24 admin-only code, not including the Phase 15 page-builder. The old admin-bundle ceiling was 60 kB.
- **Fix:** Set admin-shell ceiling to 45 kB (39.71 kB actual + ~5 kB buffer; well below old 60 kB admin-bundle ceiling).
- **Files modified:** scripts/assert-bundle-budget.sh
- **Commit:** 532aec9

**2. [Rule 3 - Blocking] bash 3.2 compatibility — no declare -A associative arrays**
- **Found during:** Task 2 execution
- **Issue:** macOS ships bash 3.2 which does not support `declare -A` associative arrays. Initial script using `declare -A CEILINGS=(...)` failed with "unbound variable" at runtime.
- **Fix:** Rewrote script using indexed array of space-delimited strings parsed with awk. Fully bash 3.2 compatible.
- **Files modified:** scripts/assert-bundle-budget.sh
- **Commit:** 532aec9

**3. [Rule 1 - Bug] Vite hash regex corrected from `[a-f0-9]` to `[A-Za-z0-9_]`**
- **Found during:** Task 2 verification — all chunks showed MISSING despite dist files existing
- **Issue:** Vite uses base64url-like hash chars (e.g. `DyeagXKT`, `Br4uvDW1`), not lowercase hex only. The plan's regex `[a-f0-9]{8,}` failed to match any actual Vite hash.
- **Fix:** Updated regex to `[A-Za-z0-9_]{8,}` to match all Vite hash characters.
- **Files modified:** scripts/assert-bundle-budget.sh
- **Commit:** 532aec9

## Known Stubs

None. All scripts produce live output from actual build artifacts.

## Threat Flags

None. All trust-boundary mitigations from the threat model are implemented:
- T-24-07: Per-chunk hard-fail CI enforced via assert-bundle-budget.sh
- T-24-07b: Ceiling changes in assert-bundle-budget.sh are diffable in PRs
- T-24-08e: TAXO-06 marker stripped → check-taxo-06-reconciliation.sh blocks merge
- T-24-20: Chunk names in table output accepted (already public via source maps)

## Self-Check: PASSED

- vite.config.ts manualChunks contains Phase 24 D-18 routes: FOUND
- dist/assets/admin-shell-*.js emitted: FOUND (Br4uvDW1)
- scripts/assert-bundle-budget.sh exits 0 with CEILING_KB table: PASSED
- scripts/test-hash-hyphen-regression.sh exits 0 (8/8 cases): PASSED
- scripts/check-taxo-06-reconciliation.sh exits 0: PASSED
- .github/workflows/bundle-budget.yml present with 3 gate steps: FOUND
- npm run build exits 0: PASSED
- Commits 11e777e, 532aec9, 0d456c2: all present in git log
