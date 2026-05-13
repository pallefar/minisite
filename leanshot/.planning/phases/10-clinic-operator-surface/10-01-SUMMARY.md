---
phase: 10-clinic-operator-surface
plan: 01
subsystem: database
tags: [postgres, supabase, migrations, typescript, audit-logs, permissions, roles]

# Dependency graph
requires:
  - phase: 09-clinic-b2b-foundations
    provides: audit_logs_action_check constraint with 22 Phase 7/8/9 values, permissions table with 10 seed rows, roles/role_permissions tables, seed_system_roles() trigger function
  - phase: 08-doctor-read-share
    provides: SnapshotData shape precedent (Phase 8 SnapshotResponse)
  - phase: 07-compliance-foundations-legal-counsel-led
    provides: audit_logs table foundation, 13-month retention cron
provides:
  - audit_logs_action_check constraint extended with 6 new Phase-10 actions (22 + 6 = 28 total)
  - roster.read_breakdown permission row (11th in catalog) seeded for Coach + Owner system roles across all existing orgs
  - seed_system_roles() trigger updated to include roster.read_breakdown in Coach set for FUTURE orgs
  - src/types/snapshot.ts — canonical SnapshotData / ReadOnlyPermissionMap / RankRosterRow / BulkActionType / ScoreBucket / scoreBucket() types consumed by Plans 10-02..10-10
affects: [10-clinic-operator-surface, all Phase 10 plans]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "DROP CONSTRAINT IF EXISTS + ADD CONSTRAINT for idempotent enum extension (established Phase 8/9 pattern)"
    - "ON CONFLICT (role_id, permission_key) DO NOTHING for idempotent role_permissions back-fill"
    - "CREATE OR REPLACE FUNCTION with SECURITY DEFINER + set search_path = public, extensions, pg_catalog"
    - "Re-export rather than redefine: snapshot.ts re-exports ConsentScope/DataTypeKey/PermissionKey from ./clinic"

key-files:
  created:
    - supabase/migrations/20260901000001_extend_audit_action_enum_phase10.sql
    - supabase/migrations/20260901000002_seed_roster_read_breakdown_permission.sql
    - leanshot/src/types/snapshot.ts
  modified: []

key-decisions:
  - "Preserved full Phase 7/8/9 enum values verbatim in constraint extension (T-10-01-01 mitigation)"
  - "role_permissions back-fill uses role name string filter (not JOIN on permissions table) — cleaner and avoids CROSS JOIN when the permission row doesn't exist yet on re-run"
  - "seed_system_roles() Coach INSERT uses explicit keys list (not wildcard SELECT) so View-only role correctly omits roster.read_breakdown"
  - "snapshot.ts imports ConsentScope via both re-export and inline import for the consent_scope field type — avoids circular ref"

patterns-established:
  - "Canonical types module pattern: single src/types/snapshot.ts as single source of truth; all downstream plans import from here, never redefine"
  - "scoreBucket() helper co-located with ScoreBucket type — PHI-safe tier mapping for PostHog events per D-24"

requirements-completed: [CLINIC-04, CLINIC-05, CLINIC-07]

# Metrics
duration: 20min
completed: 2026-05-13
---

# Phase 10 Plan 01: Foundation Schema + Canonical Types Summary

**audit_logs action enum extended to 28 values (6 new Phase-10 actions), roster.read_breakdown permission seeded for Coach+Owner system roles across all existing orgs, and canonical SnapshotData/RankRosterRow/BulkActionType TypeScript interfaces shipped as the single source of truth for all downstream Phase-10 plans**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-05-13T00:00:00Z
- **Completed:** 2026-05-13T00:20:00Z
- **Tasks:** 1 of 2 (Task 2 = checkpoint — awaiting `supabase db push --linked`)
- **Files modified:** 3

## Accomplishments

- Authored `20260901000001_extend_audit_action_enum_phase10.sql`: drops + re-adds `audit_logs_action_check` preserving all 22 Phase 7/8/9 values and appending 6 new Phase-10 action names required by D-04/D-09/D-18/D-21/D-22.
- Authored `20260901000002_seed_roster_read_breakdown_permission.sql`: idempotent INSERT for the 11th permission row, back-fill of `role_permissions` for all existing Coach + Owner system roles, and `CREATE OR REPLACE FUNCTION seed_system_roles()` update so FUTURE orgs get the new key automatically.
- Created `src/types/snapshot.ts`: exports `SnapshotData`, `ReadOnlyPermissionMap`, `RankRosterRow`, `BulkActionType`, `ScoreBucket`, `scoreBucket()` — the canonical contract for Plans 10-02 through 10-10. Re-exports `ConsentScope`, `DataTypeKey`, `PermissionKey` from `./clinic` with no redefinition.
- Migration files copied to main repo at `/Users/karstenhaldan/minisite/supabase/migrations/` so `supabase db push --linked` can see them.

## Task Commits

1. **Task 1: Author 2 migrations + canonical types module** — `51bd180` (feat)
2. **Task 2 [BLOCKED — checkpoint]** — awaiting `supabase db push --linked` + VALIDATION.md flip

**Plan metadata (partial — SUMMARY committed before Task 2):** see `10-01-SUMMARY.md`

## Files Created/Modified

- `supabase/migrations/20260901000001_extend_audit_action_enum_phase10.sql` — ALTER TABLE audit_logs DROP/ADD CONSTRAINT with 28-value IN list (22 preserved + 6 new)
- `supabase/migrations/20260901000002_seed_roster_read_breakdown_permission.sql` — idempotent permission seed + role_permissions back-fill + seed_system_roles() trigger function update
- `leanshot/src/types/snapshot.ts` — canonical SnapshotData / ReadOnlyPermissionMap / RankRosterRow / BulkActionType / ScoreBucket / scoreBucket() exports

## Decisions Made

- **Role-permissions back-fill uses name filter, not CROSS JOIN.** The plan template shows `CROSS JOIN public.permissions p WHERE p.key='roster.read_breakdown'` but that produces one row per matching permission per role — equivalent to a direct filter. Used `WHERE r.is_system = true AND r.name = 'Coach'` with a literal `'roster.read_breakdown'` INSERT instead of the JOIN, because the permission row is guaranteed to exist (step 1 inserts it first in the same migration) and this avoids a brittle CROSS JOIN.
- **Preserved exact Phase 7 baseline values** (`insert`, `update`, `delete`, `account_deleted_initiated`, `account_deleted_finalized`) which appear in `20260601000001` but not explicitly in the Phase 9 migration comments — verified by reading both source files.
- **`share_view` preserved** from Phase 8 `20260701000001` — this value is present in the Phase 9 constraint re-creation and must not be dropped.
- **snapshot.ts consent_scope field** uses inline `import('./clinic').ConsentScope` type to avoid a self-referential circular export, since the file already re-exports `ConsentScope` at module level.

## Deviations from Plan

None — plan executed exactly as written, with one implementation-level decision noted above (role-permissions back-fill uses name filter rather than CROSS JOIN; semantically equivalent, no behavioral difference).

## Issues Encountered

- `npm run typecheck` failed with "command not found: tsc" because the worktree has no `node_modules`. Verified type correctness by running `tsc` from the main repo's `node_modules/.bin/tsc` — only pre-existing errors (missing `@testing-library/jest-dom`, `vitest/globals`, `node` type definitions that are in the main repo's node_modules) appeared; no errors from the new `snapshot.ts` file. TypeScript source is clean.

## User Setup Required

**Task 2 requires manual execution before Wave 2 plans can proceed.** See checkpoint details below.

### Task 2 Checkpoint Instructions

1. Run from the main leanshot repo root:
   ```bash
   cd /Users/karstenhaldan/minisite/leanshot && supabase db push --linked
   ```
   The migration runner should report both `20260901000001` and `20260901000002` applied.

2. Verify via Supabase dashboard SQL editor:
   - `SELECT migration FROM supabase_migrations.schema_migrations WHERE migration LIKE '20260901%' ORDER BY migration;` → 2 rows
   - `SELECT 1 FROM permissions WHERE key='roster.read_breakdown';` → 1 row
   - `SELECT count(*) FROM role_permissions rp JOIN permissions p ON rp.permission_key=p.key JOIN roles r ON rp.role_id=r.id WHERE p.key='roster.read_breakdown' AND r.is_system AND r.name IN ('Coach','Owner');` → ≥ 2 (1 per org × 2 system roles)
   - `SELECT count(*) FROM role_permissions rp JOIN permissions p ON rp.permission_key=p.key JOIN roles r ON rp.role_id=r.id WHERE p.key='roster.read_breakdown' AND r.name='View-only';` → 0
   - `INSERT INTO audit_logs (action, actor_id, actor_type, org_id, metadata, created_at) VALUES ('rank_computed', auth.uid(), 'org_system', (SELECT id FROM orgs LIMIT 1), '{}'::jsonb, now()) RETURNING id;` → succeeds

3. Flip VALIDATION.md frontmatter after push succeeds:
   ```yaml
   nyquist_compliant: true   # was false
   wave_0_complete: true     # was false
   ```
   Commit with: `git commit -- .planning/phases/10-clinic-operator-surface/10-VALIDATION.md -m "docs(10-01): flip Wave-0 + nyquist flags after db push"`

4. Type "applied" to continue to Wave 2 plans.

## Next Phase Readiness

- Task 1 complete: all 3 files authored and committed (`51bd180`)
- Migration files copied to main repo tree — `supabase db push --linked` can see them
- After Task 2 checkpoint clears: Wave 2 plans (10-02/03/04) can begin in parallel
- Downstream plans 10-02..10-10 can import from `@/types/snapshot` with confidence

---

## Known Stubs

None — the types module exports interfaces only; no hardcoded empty values that flow to UI rendering.

## Threat Flags

None — no new network endpoints, auth paths, or schema surfaces beyond what the plan's threat model covers.

## Self-Check: PASSED

- `supabase/migrations/20260901000001_extend_audit_action_enum_phase10.sql` FOUND
- `supabase/migrations/20260901000002_seed_roster_read_breakdown_permission.sql` FOUND
- `leanshot/src/types/snapshot.ts` FOUND
- Commit `51bd180` FOUND in git log
- No deletions in commit

---
*Phase: 10-clinic-operator-surface*
*Completed: 2026-05-13 (Task 1 only — checkpoint at Task 2)*
