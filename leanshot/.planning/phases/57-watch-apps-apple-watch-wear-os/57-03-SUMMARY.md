---
phase: 57-watch-apps-apple-watch-wear-os
plan: "03"
subsystem: watch-sync-contract
tags: [watch, typescript, tdd, firewall, vitest, dedupe, complication-data]
dependency_graph:
  requires: []
  provides:
    - leanshot/src/lib/watch/sync-contract.ts
    - leanshot/src/lib/watch/complication-data.ts
    - leanshot/src/lib/watch/__tests__/sync-contract.test.ts
    - leanshot/src/lib/watch/__tests__/complication-data.test.ts
  affects:
    - leanshot/eslint-rules/no-health-in-ad-context.cjs
    - leanshot/scripts/check-no-health-in-ad-context.sh
tech_stack:
  added: []
  patterns:
    - verbatim-port-of-healthSampleId-XOR-algorithm
    - tdd-red-green-refactor
    - phase-55-three-layer-firewall-extension
    - calcStreak-reuse
    - SiteRotationCard-recency-logic-extracted-pure
key_files:
  created:
    - leanshot/src/lib/watch/sync-contract.ts
    - leanshot/src/lib/watch/complication-data.ts
    - leanshot/src/lib/watch/__tests__/sync-contract.test.ts
    - leanshot/src/lib/watch/__tests__/complication-data.test.ts
  modified:
    - leanshot/eslint-rules/no-health-in-ad-context.cjs
    - leanshot/scripts/check-no-health-in-ad-context.sh
decisions:
  - "makeDedupedId input is source:datetime (not userId:date:metric:sourceId) — watch logs pre-date phone-side stamping so userId is not available on the watch; stamped phone-side by dedupeAndMerge"
  - "watchComplicationData accepts optional today: Date parameter for test determinism while keeping the exported signature ergonomic (no mandatory parameter change)"
  - "CI grep gate pattern tightened to native/health(\.ts)?['\"] to avoid false positive on native/healthAssert imports (Layer 2 enforcer legitimately imported by watch files per WATCH-08)"
metrics:
  duration: "7m 52s"
  completed: "2026-05-25"
  tasks_completed: 3
  tasks_total: 3
  files_created: 4
  files_modified: 2
---

# Phase 57 Plan 03: TS Sync Contract + Complication Data + Firewall Extension Summary

Watch TypeScript core: WatchQueuedLog contract + deterministic makeDedupedId (healthSampleId port) + dedupeAndMerge (phone-stamped idempotent merge to Injection[]) + watchComplicationData/watchSiteRecommendation pure functions + Phase 55 three-layer firewall extended to src/lib/watch/.

## What Was Built

**sync-contract.ts** — The offline-queue payload contract for Apple Watch and Wear OS logs. Exports:
- `WatchQueuedLog` — the watch-side payload shape (deduped_id, datetime, dose, unit, site, source, optional user_id to be ignored)
- `makeDedupedId(source, datetime)` — deterministic UUID-v5-shaped ID; verbatim port of `healthSampleId` XOR byte-mixing from `src/lib/native/health.ts:71-107`, changing only the input composition to `${source}:${datetime}`
- `dedupeAndMerge(queued, userId, existingLogIds)` — filters entries already in existingLogIds or seen in the same batch, maps to `Injection[]` with phone-stamped user_id (T-57-AUTH), pkEngineVersion=1, and source-labeled notes

**complication-data.ts** — Pure derived-data functions for Apple Watch complication / Wear OS tile. Exports:
- `WatchComplicationData` — {nextDoseDate, currentStreak, nextSite, medication, lastDose}
- `watchComplicationData(state, today?)` — derives all fields purely from PersistedState; reuses `calcStreak` from `@/hooks/useStreaks` and the SiteRotationCard.tsx recency logic (7-day window, first empty SITES-order slot)
- `watchSiteRecommendation(state, today?)` — delegates to watchComplicationData for single-value access

**Firewall extension (WATCH-08):**
- Layer 1: `eslint-rules/no-health-in-ad-context.cjs` FORBIDDEN_IMPORTERS regex extended with `|lib\/watch|`
- Layer 2: `assertHealthTunnel('watchSyncContract')` called in both `makeDedupedId` and `dedupeAndMerge` (already satisfied in Task 1)
- Layer 3: `scripts/check-no-health-in-ad-context.sh` find clause extended with `-o -path "*/lib/watch/*"`; grep pattern tightened to `native/health(\.ts)?['"]` to correctly distinguish `health.ts` (forbidden) from `healthAssert` (the Layer 2 enforcer itself)

## Test Coverage

**sync-contract.test.ts** — 18 tests:
- makeDedupedId: determinism (same input → same ID), different datetimes produce different IDs, different sources produce different IDs, UUID-v5 shape regex, version nibble = '5', variant bits 0x80-0xBF
- dedupeAndMerge: new log passes through, existingLogIds drop, intra-batch dedup, log_id=deduped_id, user_id=phone-stamped (forged watch user_id ignored — T-57-AUTH), pkEngineVersion=1, Apple Watch notes, Wear OS notes, field preservation, empty input, null site

**complication-data.test.ts** — 16 tests:
- null-user returns empty default, nextDoseDate arithmetic (Wednesday from Monday = 2026-05-27), injectionDay=today triggers ||7 (7-day forward), YYYY-MM-DD format assertion, streak=0 with no injections, streak counts consecutive days, streak breaks on gap, nextSite skips recent sites, nextSite null when all sites recent, nextSite=abdomen-ul with no injections, medication field, lastDose formatted, lastDose null, watchSiteRecommendation delegates, watchSiteRecommendation specific value, null when user is null

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] CI grep pattern false positive on native/healthAssert**
- **Found during:** Task 3 — first run of `bash scripts/check-no-health-in-ad-context.sh src` failed
- **Issue:** The pre-existing grep pattern `native/health` (without word boundary) also matches `native/healthAssert` — the Layer 2 firewall enforcer that watch files legitimately import. When src/lib/watch/ was added to the find scope, sync-contract.ts (which imports `@/lib/native/healthAssert`) was incorrectly flagged as a firewall violation.
- **Fix:** Tightened the grep pattern in the `while` loop to `native/health(\.ts)?['"]` so it matches only the `health.ts` module (paths ending with `health` or `health.ts` before a quote) and NOT `native/healthAssert`.
- **Files modified:** `leanshot/scripts/check-no-health-in-ad-context.sh`
- **Commit:** 45651204

**2. [Rule 1 - Bug] Import order in complication-data.test.ts**
- **Found during:** Task 3 ESLint run — `import-x/order` error on line 10
- **Issue:** The relative import `../complication-data` preceded the `@/` alias type imports, violating the project's alphabetized import-group ordering
- **Fix:** Reordered imports: vitest → `@/lib/storage` → `@/types` → relative `../complication-data`
- **Files modified:** `leanshot/src/lib/watch/__tests__/complication-data.test.ts`
- **Commit:** 45651204

## TDD Gate Compliance

- RED gate: both test files failed before source files existed (import resolution error = expected RED)
- GREEN gate: sync-contract.ts → 18/18 tests pass; complication-data.ts → 16/16 tests pass
- No REFACTOR phase needed (code was clean on first write)

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes introduced. All new code is pure TypeScript with no side effects. The firewall extension makes src/lib/watch/ a monitored surface, not a new threat surface.

## Self-Check: PASSED

| Check | Result |
|-------|--------|
| sync-contract.ts exists | FOUND |
| complication-data.ts exists | FOUND |
| sync-contract.test.ts exists | FOUND |
| complication-data.test.ts exists | FOUND |
| Task 1 commit ba8d476b | FOUND |
| Task 2 commit ccde6d86 | FOUND |
| Task 3 commit 45651204 | FOUND |
| vitest 34/34 tests | PASSED |
| tsc --noEmit | PASSED |
| lint:health-firewall | PASSED |
| No health.ts imports in src/lib/watch/ | CONFIRMED |
| Phone-stamped user_id (no q.user_id usage) | CONFIRMED |
