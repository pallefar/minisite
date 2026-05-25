---
phase: 56-ad-network
plan: "06"
subsystem: ad-network / security
tags: [ci-gate, grep-gate, healthkit-firewall, compliance, ad-exclusion]
dependency_graph:
  requires: [56-01, 56-03]
  provides: [AD-03-ci-gate, AD-11-regression]
  affects: [.github/workflows/ci.yml]
tech_stack:
  added: []
  patterns: [comment-stripped-grep-gate, three-layer-firewall, self-test-proves-non-trivial]
key_files:
  created:
    - leanshot/scripts/check-no-ads-on-excluded-surfaces.sh
    - leanshot/scripts/check-no-ads-on-excluded-surfaces.test.sh
  modified:
    - leanshot/src/lib/native/healthAssert.test.ts
    - .github/workflows/ci.yml
decisions:
  - "Grep pattern targets @/components/ads and @/lib/ads/ import paths — catches all ad-serving component imports (AdRenderer, EmbedAdSlot, PlatformAdSlot, HouseAdSlot, canShowAds) while cleanly excluding the admin revenue dashboard which only reads a Supabase SECDEF RPC"
  - "Self-test has 3 assertions: clean-src exits 0, planted clinic violation exits 1, commented-import exits 0 (proves comment-stripping works)"
  - "healthAssert.test.ts extended with 5 AD-11 regression cases (safe ad params pass, health-shaped params throw) without removing Phase 55 coverage — 24 total tests pass"
metrics:
  duration: "~25min"
  completed: "2026-05-25"
  tasks_completed: 3
  files_count: 4
---

# Phase 56 Plan 06: Surface-Exclusion Gate + HealthKit Firewall Regression Summary

**One-liner:** Comment-stripped CI grep gate (AD-03) + 3-assertion self-test + HealthKit firewall regression tests (AD-11) + ci.yml wiring — both gates run on every push.

## Completed Tasks

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Surface-exclusion CI grep gate + self-test | 2d67f936 | check-no-ads-on-excluded-surfaces.sh, .test.sh |
| 2 | HealthKit firewall regression (AD-11) | 9e77fa19 | healthAssert.test.ts (+5 AD-11 cases), check-no-health-in-ad-context.sh |
| 3 | Wire both gates into ci.yml | 5a9f7b02 | .github/workflows/ci.yml |

## What Was Built

### check-no-ads-on-excluded-surfaces.sh (AD-03 Layer 3)

Mirrors `check-no-health-in-ad-context.sh` structure exactly. Targets files under:
- `src/components/clinic/`
- `src/components/admin/`
- `src/components/dashboard/share/`
- `MedicationTab.tsx` (dose-log PHI equivalent)
- Any `*dose-log*` or `*patient*` files

Forbidden pattern (comment-stripped via `perl -0pe`):
```
from ['"]@/components/ads
from ['"]@/lib/ads/
import(['"]@/components/ads
import(['"]@/lib/ads/
require(['"]@/components/ads
require(['"]@/lib/ads/
```

**Admin revenue dashboard carveout confirmed:** `AdRevenueDashboardPage.tsx` imports only `@/components/ui/` and Supabase RPC — zero ad-serving imports. Gate passes cleanly.

Exit codes: 0 (pass) / 1 (violation with `::error::` annotation) / 2 (src root not found).

### check-no-ads-on-excluded-surfaces.test.sh (self-test)

3 assertions proving the gate is non-trivial:
1. Gate exits 0 on current clean src tree
2. Gate exits 1 on a planted clinic file importing `@/components/ads` (violation caught)
3. Gate exits 0 when the import is comment-stripped (no false positive from comments)

### healthAssert.test.ts AD-11 regression section

5 new test cases added (24 total, all green):
- Safe ad-param objects (`{ adUnitId, surface, tier }`) — do NOT throw
- Health-shaped leaks into ad params (`{ weight }`, `{ steps }`, `{ bodyMass }`) — throw with firewall message

Documents the contract: `ads.ts` (56-03) MUST call `assertNoHealthData` at every ad-SDK boundary before using data for targeting.

### ci.yml wiring

Both gates added to the `lint` job after the existing CSS logical-properties gate:
```yaml
- name: Two-tunnel firewall health gate (HEALTH-08 Layer 3)
  run: bash scripts/check-no-health-in-ad-context.sh src
- name: Ad surface-exclusion gate (AD-03)
  run: bash scripts/check-no-ads-on-excluded-surfaces.sh src
```

## Verification

```
cd leanshot && bash scripts/check-no-ads-on-excluded-surfaces.sh src
# OK: no ad-serving import found in excluded-surface files under src (AD-03 gate passes).

cd leanshot && bash scripts/check-no-health-in-ad-context.sh src
# OK: no health import in ad-context files under src (Layer 3 passes).

cd leanshot && bash scripts/check-no-ads-on-excluded-surfaces.test.sh src
# Self-test results: 3 passed, 0 failed

vitest run src/lib/native/healthAssert.test.ts --config vite.config.ts
# Test Files  1 passed (1)  Tests  24 passed (24)
```

## Deviations from Plan

None — plan executed exactly as written.

The worktree base pre-dated Phase 55, so `healthAssert.ts`, `healthAssert.test.ts` (existing Phase 55 content), and `check-no-health-in-ad-context.sh` were copied from main before adding AD-11 regression cases. This is expected worktree hygiene, not a deviation.

## Threat Surface Scan

No new network endpoints, auth paths, or schema changes introduced. All files are CI scripts and a test extension. Threat model coverage for T-56-16 (surface exclusion), T-56-17 (health firewall preservation), and T-56-18 (grep evasion via comments) confirmed as mitigated.

## Self-Check: PASSED

- `leanshot/scripts/check-no-ads-on-excluded-surfaces.sh` — EXISTS, exits 0 on clean src
- `leanshot/scripts/check-no-ads-on-excluded-surfaces.test.sh` — EXISTS, 3/3 assertions pass
- `leanshot/src/lib/native/healthAssert.test.ts` — EXISTS, 24/24 tests pass
- `.github/workflows/ci.yml` — contains both gate step names
- Commits: 2d67f936, 9e77fa19, 5a9f7b02 — all present in git log
