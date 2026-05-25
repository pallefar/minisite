---
phase: 55-healthkit-two-tunnel-firewall
plan: 02
subsystem: database
tags: [postgres, supabase, healthkit, capacitor, rls, secdef, migrations]

# Dependency graph
requires:
  - phase: 55-01-firewall-three-layers
    provides: HealthKit firewall ESLint/runtime/CI layers
provides:
  - hk_source nullable column on weights/sleep/workouts/meals (HEALTH-03 import tagging, HEALTH-07 purge target)
  - healthkit_sync_state table with RLS own-row policy + moddatetime LWW
  - purge_healthkit_imports SECDEF RPC (auth.uid() guard, hk_source='apple_health' filter)
  - upsert_healthkit_state SECDEF RPC (safe enabled toggle + revoked_at lifecycle)
  - "@capgo/capacitor-health@^8.5.2 in package.json + lockfile"
  - vitest mock Health.isAvailable/requestAuthorization/readSamples for 55-03/55-04 tests
affects:
  - 55-03-health-impl-import-mapping
  - 55-04-consent-ui-settings-privacy
  - phase-70-consolidated-uat

# Tech tracking
tech-stack:
  added:
    - "@capgo/capacitor-health@^8.5.2 (Capacitor-8 HealthKit plugin)"
  patterns:
    - "hk_source='apple_health' tag column for import-origin tracing and targeted purge"
    - "named dollar-quote tags ($purge$, $upsert$) to avoid $$ nesting inside Postgres functions"
    - "SECDEF RPC auth.uid() guard pattern: raise not_authorized (SQLSTATE 28000) on uid mismatch"
    - "moddatetime trigger on healthkit_sync_state.updated_at for LWW write semantics"
    - "vi.fn() mock shape mirroring capgo-native-biometric.ts convention with __mock.reset() helper"

key-files:
  created:
    - supabase/migrations/20280301000001_p55_hk_source_columns.sql
    - supabase/migrations/20280301000002_p55_healthkit_sync_state.sql
    - supabase/migrations/20280301000003_p55_healthkit_rpcs.sql
    - leanshot/src/lib/native/__mocks__/capgo-capacitor-health.ts
  modified:
    - leanshot/package.json
    - leanshot/package-lock.json

key-decisions:
  - "Used named dollar-quote tags ($purge$, $upsert$) not anonymous $$ to prevent nesting conflicts per reference_postgres_dollar_quote_nesting_in_cron_body memory"
  - "Migrations forward-dated to 20280301000001/2/3 to sort after 20280201000002 (latest existing)"
  - "npm install --legacy-peer-deps --package-lock-only (no node_modules; gitignored; orchestrator installs in main post-merge)"
  - "Live supabase db push deferred to phase close-out per feedback_phase_close_out_db_push_verification"
  - "@capgo/capacitor-health package-legitimacy checkpoint pre-approved by orchestrator (13k weekly downloads, Cap-go org, no postinstall)"
  - "sync_interval CHECK ('1h','6h','24h') enforced both at table level and in upsert RPC for defense-in-depth"

patterns-established:
  - "hk_source tag column: import-origin tracing across all four data tables; NULL = manual log; 'apple_health' = HealthKit import"
  - "SECDEF purge pattern: auth.uid() guard first, then DELETE WHERE hk_source='apple_health'; revoke from public, grant to authenticated"
  - "Plugin mock convention: vi.fn stubs + __mock.reset() helper for test teardown"

requirements-completed: [HEALTH-03, HEALTH-07]

# Metrics
duration: 25min
completed: 2026-05-25
---

# Phase 55 Plan 02: DB Foundation + Plugin Summary

**hk_source tag columns on 4 tables, healthkit_sync_state RLS table, purge/upsert SECDEF RPCs, and @capgo/capacitor-health@8.5.2 with vitest mock — all migrations forward-dated, file-only delivery**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-05-25T00:00:00Z
- **Completed:** 2026-05-25T00:25:00Z
- **Tasks:** 2
- **Files modified:** 6 (3 migrations + package.json + package-lock.json + mock)

## Accomplishments

- Three idempotent migrations created (20280301000001/2/3), all sorting after the previous floor of 20280201000002
- `hk_source text` nullable column added to weights, sleep, workouts, meals via `ADD COLUMN IF NOT EXISTS`
- `healthkit_sync_state` table with composite RLS own-row policy, moddatetime LWW trigger, and `sync_interval CHECK ('1h','6h','24h')`
- `purge_healthkit_imports` SECDEF RPC: auth.uid() guard + SQLSTATE 28000 raise on mismatch; DELETE across all four tables WHERE hk_source='apple_health'
- `upsert_healthkit_state` SECDEF RPC: INSERT...ON CONFLICT DO UPDATE with revoked_at lifecycle (null when re-enabling, now() when disabling)
- `@capgo/capacitor-health@^8.5.2` added to package.json + lockfile; mock at `src/lib/native/__mocks__/capgo-capacitor-health.ts` exports `Health` with vi.fn stubs + `__mock.reset()`

## Task Commits

Each task committed atomically:

1. **Task 1: Migrations (hk_source, sync_state, RPCs)** - `588930b1` (feat)
2. **Task 2: Plugin install + vitest mock** - `47606f84` (feat)

**Plan metadata:** (this commit - docs)

## Files Created/Modified

- `supabase/migrations/20280301000001_p55_hk_source_columns.sql` — ALTER TABLE ADD COLUMN IF NOT EXISTS hk_source text on all four import tables
- `supabase/migrations/20280301000002_p55_healthkit_sync_state.sql` — healthkit_sync_state table, moddatetime trigger, RLS own-row for-all policy
- `supabase/migrations/20280301000003_p55_healthkit_rpcs.sql` — purge_healthkit_imports + upsert_healthkit_state SECDEF RPCs with named dollar-tags
- `leanshot/package.json` — @capgo/capacitor-health@^8.5.2 dependency added
- `leanshot/package-lock.json` — lockfile updated (resolved 8.5.2)
- `leanshot/src/lib/native/__mocks__/capgo-capacitor-health.ts` — Health mock: isAvailable/requestAuthorization/readSamples vi.fn stubs + __mock.reset()

## Decisions Made

- Named dollar-quote tags ($purge$, $upsert$) used instead of anonymous $$ to prevent SQL nesting conflicts (per `reference_postgres_dollar_quote_nesting_in_cron_body` project memory).
- Live `supabase db push` intentionally deferred to phase close-out; these are file-only deliverables per `feedback_phase_close_out_db_push_verification` pattern.
- `npm install --legacy-peer-deps --package-lock-only` used (no node_modules written to worktree; gitignored; orchestrator runs full install in main post-merge).
- `sync_interval` validated in both the CHECK constraint and the RPC for defense-in-depth (T-55-02-03).

## Deviations from Plan

None — plan executed exactly as written. The package-legitimacy checkpoint for @capgo/capacitor-health was pre-approved by the orchestrator prior to dispatch.

## Issues Encountered

- Files initially written to the main repo path (`/Users/karstenhaldan/minisite/supabase/migrations/`) instead of the worktree path (`/Users/karstenhaldan/minisite/.claude/worktrees/agent-a161decedc5b05479/supabase/migrations/`) — recovered by cp + rm before staging. No data loss; files moved to correct worktree location before first git add.
- `node_modules` not present in worktree (gitignored, worktree created from older commit) — used main checkout's `node_modules/.bin/tsc` with worktree tsconfig path for typecheck. Typecheck passed with zero errors.

## Known Stubs

None — migrations are schema DDL only (no data); mock defaults are intentional stubs for testing (tests in 55-03/55-04 will override readSamples per-metric via `Health.readSamples.mockImplementation`).

## Threat Flags

No new surface beyond what the plan's threat_model registers. All T-55-02-01 (purge auth guard) and T-55-02-03 (sync_interval validation) mitigations implemented. T-55-02-SC (supply chain) checkpoint was pre-approved by orchestrator.

## Next Phase Readiness

- 55-03 (import mapping + Edge Fn) can now import `@capgo/capacitor-health` and use the mock in unit tests
- 55-04 (consent UI) can reference `healthkit_sync_state` columns and call `upsert_healthkit_state` RPC
- Push-status note: migrations 20280301000001/2/3 are file-only; they MUST be included in phase close-out `supabase db push` step. Add to push-status matrix in CARRY-OVER.md.

---
*Phase: 55-healthkit-two-tunnel-firewall*
*Completed: 2026-05-25*
