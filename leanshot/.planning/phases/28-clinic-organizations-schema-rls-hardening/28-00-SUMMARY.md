---
phase: 28
plan: "00"
subsystem: database/schema
tags: [reconcile, rename, migration, secdef, rls]
dependency_graph:
  requires: []
  provides: [public.organizations, org_status, created_by]
  affects: [28-01, 28-02, 28-03, 28-04, 28-05, 28-06, 28-07]
tech_stack:
  added:
    - "org_status enum (active|suspended|archived)"
  patterns:
    - "ALTER TABLE rename + SECDEF CREATE OR REPLACE in single migration"
key_files:
  created:
    - supabase/migrations/20270601100001_p28_reconcile_orgs_to_organizations.sql
    - scripts/p28-rename-diff.sh
    - tests/sql/p28-rename-verification.test.sql
  modified:
    - leanshot/src/lib/clinic.ts
    - leanshot/src/types/clinic.ts
    - leanshot/src/components/clinic/ClinicWorkspace.tsx
    - leanshot/src/components/clinic/settings/ClinicSettingsPage.tsx
    - leanshot/src/components/clinic/drill-in/ClinicDrillInPage.tsx
    - leanshot/src/components/clinic/settings/AuditTab.test.tsx
    - leanshot/src/components/clinic/settings/ClinicSettingsPage.test.tsx
    - leanshot/src/components/clinic/settings/WorkspaceTab.test.tsx
    - leanshot/src/components/clinic/ClinicWorkspace.test.tsx
    - leanshot/src/components/clinic/drill-in/ClinicDrillInPage.test.tsx
    - leanshot/src/components/dashboard/settings/EditConsentScopeModal.tsx
    - leanshot/src/components/dashboard/settings/EditConsentScopeModal.test.tsx
    - leanshot/src/components/dashboard/settings/sections/ActiveOrganizationsSection.tsx
    - leanshot/src/components/dashboard/settings/sections/ActiveOrganizationsSection.test.tsx
    - leanshot/src/components/layout/WorkspaceSwitcher.tsx
    - leanshot/src/components/layout/WorkspaceSwitcher.test.tsx
decisions:
  - "Rename public.orgs → organizations atomically (single ALTER migration, no data migration)"
  - "CREATE OR REPLACE SECDEF functions to patch audit_logs.table_name 'orgs' string literals"
  - "Patch all embedded join selects orgs(…) → organizations(…) and field accesses"
metrics:
  duration: "12m 4s"
  completed: "2026-05-17T16:57:00Z"
  tasks_completed: 3
  files_changed: 19
---

# Phase 28 Plan 00: RECONCILE (orgs → organizations) Summary

**One-liner:** Single-transaction ALTER TABLE rename of `public.orgs` → `public.organizations` + SECDEF patch + 19-file callsite sweep closing the CONTEXT D-11 landmine before P28 plans 01-07 ship.

---

## Pre-Rename Audit (captured 2026-05-17)

Operator pre-approval: GRANTED via /gsd-manager AskUserQuestion before execution.

| schema | table | approx_rows |
|--------|-------|-------------|
| public | invites | 199 |
| public | memberships | 229 |
| public | orgs | 105 |
| public | role_permissions | 1995 |
| public | roles | 315 |

`public.organizations` did NOT exist pre-migration (verified via `to_regclass('public.orgs')` returning NULL post-rename). `public.consents` and `public.org_audit_logs` not present (expected — net-new in P28).

---

## Migration

**File:** `supabase/migrations/20270601100001_p28_reconcile_orgs_to_organizations.sql`

**Filename regex check:** PASS (14-digit timestamp, no letter suffix).

**Push log:** No `^Skipping` lines. Exit code 0.

**Migration steps in order:**

1. `do $$ begin if not exists (select 1 from pg_type where typname = 'org_status' ...) then create type public.org_status as enum ('active', 'suspended', 'archived'); end if; end $$;`
2. `alter table public.orgs rename to organizations;`
3. `alter table public.organizations rename column owner_user_id to created_by;`
4. `alter table public.organizations add column if not exists status public.org_status not null default 'active';`
5. `alter table public.organizations add column if not exists is_public_listing boolean not null default false;`
6. `alter table public.organizations add column if not exists current_rank_weights_version uuid null;`
7. `create or replace function public.create_org(...)` — Phase 10 hotfix body (42702 fix preserved), `'organizations'` in audit_logs, `public.organizations` in DML.
8. `create or replace function public.update_org(...)` — Phase 9 body, `'organizations'` in audit_logs, `public.organizations` in DML.
9. `create or replace function public.delete_org(...)` — Phase 9 body, `'organizations'` in audit_logs, `public.organizations` in DML.

---

## Post-Rename Verification Results

All checks PASS:

| Check | Expected | Result |
|-------|----------|--------|
| `count(*) from public.organizations` | 105 | **105** |
| `to_regclass('public.orgs')` | NULL | **NULL** |
| `enum_range(NULL::public.org_status)` | active, suspended, archived | **3 values** |
| Columns: status, is_public_listing, current_rank_weights_version, created_by | 4 rows | **4 rows** |
| Column owner_user_id present | 0 rows | **0 rows** |
| FKs pointing at organizations | memberships, invites, roles, role_permissions + audit_logs, subscriptions | **6 FKs confirmed** |
| SECDEF bodies reference 'organizations' | yes | **yes (all 3 functions)** |
| Remaining 'orgs' literal in function bodies | 0 | **0** |

---

## Callsites Patched

**Primary callsites (per plan spec):**

| File | Line | Change |
|------|------|--------|
| `leanshot/src/lib/clinic.ts` | 469 | `.from('orgs')` → `.from('organizations')` |
| `leanshot/src/components/clinic/ClinicWorkspace.tsx` | 100 | `.from('orgs')` → `.from('organizations')`, `owner_user_id` → `created_by` in select |
| `leanshot/src/components/clinic/settings/ClinicSettingsPage.tsx` | 108 | `.from('orgs')` → `.from('organizations')`, `owner_user_id` → `created_by` in select |
| `leanshot/src/components/clinic/drill-in/ClinicDrillInPage.tsx` | 144 | `.from('orgs')` → `.from('organizations')`, `owner_user_id` → `created_by` in select |
| `leanshot/src/components/clinic/settings/AuditTab.test.tsx` | 132 | `if (table === 'orgs')` → `if (table === 'organizations')` |

**Deviation Rule 2 — auto-added critical patches (embedded joins + field renames):**

Supabase embedded join syntax `orgs(id, name, ...)` in `.select()` strings returns the key `orgs` in the response object. After table rename, this becomes `organizations`. Failing to patch these would silently break WorkspaceSwitcher (operator context grouping) and ActiveOrganizationsSection (consent management), with no TypeScript error at build time (dynamically typed join keys).

| File | Change |
|------|--------|
| `leanshot/src/components/layout/WorkspaceSwitcher.tsx` | `orgs(…)` → `organizations(…)` in select; `MembershipJoined.orgs` → `.organizations`; `m.orgs` → `m.organizations`; `org.owner_user_id` → `org.created_by` |
| `leanshot/src/components/dashboard/settings/sections/ActiveOrganizationsSection.tsx` | `orgs(…)` → `organizations(…)` in select; `Row.orgs` → `.organizations`; all `row.orgs.*` → `row.organizations.*` accesses (8 references) |
| `leanshot/src/components/dashboard/settings/EditConsentScopeModal.tsx` | `MembershipWithOrg.orgs` → `.organizations`; `membership.orgs.name` → `.organizations.name` |
| `leanshot/src/types/clinic.ts` | `Org.owner_user_id` → `created_by` |

**Test fixture updates (owner_user_id → created_by, orgs key → organizations):**

`ClinicWorkspace.test.tsx`, `ClinicDrillInPage.test.tsx`, `WorkspaceTab.test.tsx`, `ClinicSettingsPage.test.tsx`, `AuditTab.test.tsx`, `WorkspaceSwitcher.test.tsx`, `ActiveOrganizationsSection.test.tsx`, `EditConsentScopeModal.test.tsx`

---

## Phase 9 RLS Regression Sweep

Run: `npx vitest run src/lib/clinic.test.ts src/lib/clinic-permissions.test.ts`

Result: **51/51 tests pass** — Phase 9 cross-tenant isolation preserved post-rename.

All clinic + workspace + settings tests (23 files, 238 tests): **PASS**. 2 pre-existing skips unchanged.

TypeScript check: `tsc -p tsconfig.app.json --noEmit` → **exit 0**.
Vite build: **success** (clinic-settings-Cw6B25le.js 45.67 kB).

---

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Embedded join callsites not in original plan spec**
- **Found during:** Task 2 (callsite sweep)
- **Issue:** Plan spec listed 4 `.from('orgs')` callsites but grep revealed 2 additional embedded join references in `WorkspaceSwitcher.tsx` and `ActiveOrganizationsSection.tsx` using `orgs(id, ...)` in `.select()` strings. These would silently break operator context switching and patient consent management without TypeScript errors.
- **Fix:** Patched embedded join strings, typed interface property keys, and all field accesses to use `organizations` and `created_by`.
- **Files modified:** `WorkspaceSwitcher.tsx`, `ActiveOrganizationsSection.tsx`, `EditConsentScopeModal.tsx`, `types/clinic.ts`, plus 8 test fixture files.
- **Commit:** 781a005

**2. [Rule 2 - Missing Critical] `owner_user_id` column references in select strings not in plan spec**
- **Found during:** Task 2 (callsite sweep)
- **Issue:** The column rename `owner_user_id` → `created_by` required updating select strings that explicitly fetched that column. Plan spec noted the rename but didn't list the select string updates.
- **Fix:** Updated select strings in 3 clinic components + `WorkspaceSwitcher.tsx` to use `created_by`.
- **Commit:** 781a005

---

## Rollback Path (if needed post-deploy)

If rollback is required, create a new migration:
```sql
-- Rollback migration (do NOT run unless instructed)
alter table public.organizations rename to orgs;
alter table public.orgs rename column created_by to owner_user_id;
alter table public.orgs drop column if exists status;
alter table public.orgs drop column if exists is_public_listing;
alter table public.orgs drop column if exists current_rank_weights_version;
drop type if exists public.org_status;
-- Restore Phase 10 hotfix create_org body (re-run 20260901000006_fix_create_org_ambiguous_org_id.sql)
-- Restore Phase 9 update_org and delete_org bodies (re-run 20260801000011_clinic_rpcs.sql)
```
Then revert the 19 src/ file changes via `git revert 781a005` and push.

---

## Known Stubs

None — this is a schema rename plan with no UI stubs.

---

## Self-Check: PASSED

- Migration file exists: FOUND `/Users/karstenhaldan/minisite/supabase/migrations/20270601100001_p28_reconcile_orgs_to_organizations.sql`
- pg_dump diff script exists: FOUND `scripts/p28-rename-diff.sh`
- Verification SQL exists: FOUND `tests/sql/p28-rename-verification.test.sql`
- Task commit 781a005: FOUND
- `public.organizations` has 105 rows: VERIFIED
- `public.orgs` returns NULL: VERIFIED
- TSC exit 0: VERIFIED
- 238 test passes (23 files): VERIFIED
