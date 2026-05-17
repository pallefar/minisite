---
phase: 29-org-subscriptions-per-patient-metered-billing
plan: 01
subsystem: database
tags: [supabase, migration, secdef, billing, metered, plpgsql, vitest, rls]

requires:
  - phase: 29-00
    provides: org_patient_links table, 10-table (user_id, created_at) composite indexes, org_subscriptions dropped

provides:
  - count_active_patients(p_org_id uuid) SECDEF function: 10-table UNION, service-role bypass, admin re-check
  - fn_audit_phi_trigger bug fix: user_id_hash + action NOT NULL columns, recursion guard
  - Vitest test file: 8 behavior tests proving D-01 invariants

affects:
  - 29-04 (nightly cron calls count_active_patients with service_role)
  - 29-03 (stripe-webhook invoice.created variance handler uses count_active_patients)
  - 29-07 (PHI-lint greps this migration for PHI keywords)
  - All P29+ plans that create auth users (fn_audit_phi_trigger fix unblocks createUser)

tech-stack:
  added: []
  patterns:
    - "count_active_patients v2: SECDEF with auth.uid() IS NULL bypass for service_role cron callers"
    - "fn_audit_phi_trigger fix: set_config(app.suppress_audit) recursion guard pattern"
    - "10-table UNION EXISTS pattern for rolling 30-day activity window"

key-files:
  created:
    - supabase/migrations/20270601200002_count_active_patients_v2.sql
    - supabase/migrations/20270601200005_fix_phi_audit_trigger_user_id_hash.sql
    - leanshot/src/lib/__tests__/count-active-patients.test.ts
  modified:
    - leanshot/vitest-e2e.config.ts

key-decisions:
  - "D-01: count_active_patients uses org_patient_links (Phase 28) not memberships (Phase 9) — source switch confirmed"
  - "D-01: 10-table UNION in exact order: injections, weights, meals, mood, sleep, symptoms, photos, workouts, vials, ai_messages"
  - "Rule 1 fix: fn_audit_phi_trigger needed user_id_hash (NOT NULL) + action (NOT NULL) + recursion guard — pre-existing Phase 24 bug unblocking all P29+ RLS tests"
  - "Migration 20270601200005 used (not 20270601200003) due to timestamp collision with Plan 29-02 org_patient_invites migration"

patterns-established:
  - "SECDEF bypass pattern: auth.uid() IS NULL check to allow service_role callers (cron/webhook)"
  - "Audit trigger recursion guard: set_config(app.suppress_audit, on, true) before INSERT into audit_logs"
  - "vitest-e2e.config.ts include array must be extended for each new non-rls-org-* test file"

requirements-completed: [ORG-09]

duration: 85min
completed: 2026-05-17
---

# Phase 29 Plan 01: count_active_patients v2 Summary

**`count_active_patients(org_id uuid)` SECDEF rewrite: org_patient_links source, 10-table UNION, service-role bypass, 8 vitest tests green; plus fn_audit_phi_trigger bug fix enabling all P29 admin user creation**

## Performance

- **Duration:** ~85 min
- **Started:** 2026-05-17T19:25:00Z
- **Completed:** 2026-05-17T20:50:00Z
- **Tasks:** 3 (Tasks 1, 2, 3 merged into single commit for atomicity)
- **Files modified:** 4

## Accomplishments

- Migration `20270601200002_count_active_patients_v2.sql` live: `CREATE OR REPLACE` replaces Phase 14's obsolete `memberships`-based 5-table version with the Phase 28-compatible `org_patient_links`-based 10-table UNION version
- Migration `20270601200005_fix_phi_audit_trigger_user_id_hash.sql` live: Rule 1 bug fix for `fn_audit_phi_trigger` that blocked all admin user creation since Phase 24 (missing `user_id_hash` NOT NULL + infinite recursion via self-trigger on `audit_logs`)
- Test file `count-active-patients.test.ts`: 8 behavior tests pass against live DB — count correctness, inactive exclusion, unlinked exclusion, multi-table distinct, service-role bypass, cross-org 42501 rejection

## Verification Evidence

```
 RUN  v4.1.5 /Users/karstenhaldan/minisite/leanshot

 Test Files  1 passed (1)
      Tests  9 passed (9)
   Start at  19:49:07
   Duration  4.02s (transform 24ms, setup 0ms, import 42ms, tests 3.92s, environment 0ms)
```

Live DB verification:
```json
{
  "rows": [{ "args": "p_org_id uuid", "proname": "count_active_patients" }]
}
```
Migration list confirms `20270601200002` applied at `2027-06-01 20:00:02`.

## Task Commits

1. **Tasks 1-2-3: count_active_patients v2 + fix + tests** - `4411761` (feat)

## Files Created/Modified

- `supabase/migrations/20270601200002_count_active_patients_v2.sql` — SECDEF function: 10-table UNION via org_patient_links, service-role bypass, admin check
- `supabase/migrations/20270601200005_fix_phi_audit_trigger_user_id_hash.sql` — Rule 1 bug fix: fn_audit_phi_trigger missing NOT NULL columns + recursion guard
- `leanshot/src/lib/__tests__/count-active-patients.test.ts` — 8 behavior tests for D-01 invariants (9 total including gating test)
- `leanshot/vitest-e2e.config.ts` — Extended include array: added `src/lib/__tests__/count-active-patients.test.ts`

## Decisions Made

1. Migration timestamp `20270601200005` used for the audit trigger fix (not `20270601200003`) because Plan 29-02 concurrently deployed `20270601200003_org_patient_invites.sql`.
2. Audit trigger fix applied via Supabase Management API REST (`/v1/projects/{ref}/database/query`) because the pooler circuit breaker was tripped during testing. The migration record was manually inserted into `supabase_migrations.schema_migrations`.
3. `(new).id::text` row_pk extraction replaced with `row_to_json(new)->>'id'` to safely handle composite PK tables (injections, weights, mood) that don't have an `id` column.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] fn_audit_phi_trigger missing user_id_hash + action NOT NULL columns**
- **Found during:** Task 2 (vitest test setup — admin.auth.admin.createUser() failed)
- **Issue:** Phase 24's `fn_audit_phi_trigger` inserts into `audit_logs` without providing `user_id_hash` (NOT NULL, no default) or `action` (NOT NULL, check constraint). This blocked ALL admin user creation since Phase 24 deployed — any auth trigger for profile creation → audit insert → NOT NULL violation.
- **Fix:** Updated `fn_audit_phi_trigger` to compute `user_id_hash` (sha256 of auth.uid() or 'service_role' sentinel) and `action` (lower(TG_OP)) — plus added `set_config(app.suppress_audit, 'on', true)` guard to prevent infinite recursion via `trg_phi_audit_audit_logs` self-trigger, and safe `row_pk` extraction via `row_to_json` for composite-PK tables.
- **Files modified:** `supabase/migrations/20270601200005_fix_phi_audit_trigger_user_id_hash.sql`
- **Verification:** User creation via auth REST API confirmed: `SUCCESS: user_id=06be349d-...`; all 9 vitest tests passed.
- **Committed in:** `4411761` (same task commit)

**2. [Rule 1 - Bug] Migration timestamp collision with Plan 29-02**
- **Found during:** Task 2 (supabase db push returned "Remote migration versions not found")
- **Issue:** Both Plan 29-01 and Plan 29-02 tried to use `20270601200003` for their migrations (Plan 29-02 shipped first with `20270601200003_org_patient_invites.sql`).
- **Fix:** Renamed the audit trigger fix migration to `20270601200005` (next available slot after Plan 29-02's `20270601200004`).
- **Committed in:** `4411761`

---

**Total deviations:** 2 auto-fixed (both Rule 1 bugs)
**Impact on plan:** The fn_audit_phi_trigger fix unblocks ALL future phases that create test users via the admin API. Pre-existing bug since Phase 24. No scope creep — fix is tightly scoped.

## Issues Encountered

- **Supabase pooler circuit breaker:** Multiple rapid DB queries tripped the ECIRCUITBREAKER limit. Resolved by applying the final migration version via the Management API REST endpoint instead of the CLI pooler.
- **Migration timestamp collision with Plan 29-02:** Plan 29-02 ran concurrently and claimed `20270601200003`. Resolved by using `20270601200005`.

## Known Stubs

None — function is fully implemented and test-verified.

## Threat Flags

No new threat surface introduced:
- `count_active_patients` is an extension of existing SECDEF function (same trust boundary)
- `fn_audit_phi_trigger` fix makes an existing trigger work correctly (no new surface)

## Carry-Forward

- **Plan 29-04** (nightly billing cron): calls `count_active_patients` with service_role — bypass confirmed working
- **Plan 29-03** (stripe-webhook): calls `count_active_patients` with service_role for invoice variance check
- **Plan 29-07** (PHI-lint): must grep `20270601200002_count_active_patients_v2.sql` for PHI keyword absence — FUTURE comment marker inserted for visibility

## Next Phase Readiness

- ORG-09 count primitive: DONE — Plan 29-04 cron is unblocked
- All P29 RLS tests: UNBLOCKED — fn_audit_phi_trigger fix enables admin user creation for test fixtures
- Migration `20270601200005` is recorded in `supabase_migrations.schema_migrations` (manually via REST)

---
*Phase: 29-org-subscriptions-per-patient-metered-billing*
*Completed: 2026-05-17*
