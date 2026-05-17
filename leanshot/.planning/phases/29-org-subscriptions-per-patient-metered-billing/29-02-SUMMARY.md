---
phase: 29
plan: "02"
subsystem: database
tags: [supabase, migration, rls, secdef, invites, org-patient]
dependency_graph:
  requires: ["29-00", "28-01"]
  provides: ["org_patient_invites table", "send_org_patient_invite SECDEF", "accept_org_patient_invite_preview SECDEF", "accept_org_patient_invite SECDEF", "ORG_SCOPED_TABLES updated"]
  affects: ["29-05 (clinic-patient-invite Edge Function)"]
tech_stack:
  added: ["_is_org_admin SECDEF helper (org_members RLS recursion fix)"]
  patterns: ["Pattern S1 dual-layer", "W-1 anti-enumeration", "EXTENSION-CONTRACT §2 RLS template", "direct audit_logs insert (not log_admin_action for org-admin RPCs)"]
key_files:
  created:
    - supabase/migrations/20270601200003_org_patient_invites.sql
    - supabase/migrations/20270601200004_org_patient_invite_rpcs.sql
    - leanshot/src/lib/__tests__/rls-org-patient-invites.test.ts
  modified:
    - supabase/functions/_shared/with-org-scope.ts
decisions:
  - "on delete restrict (not cascade) per EXTENSION-CONTRACT §4"
  - "direct audit_logs insert bypasses log_admin_action (which requires platform admin role — org admins are not platform admins)"
  - "_is_org_admin SECDEF helper avoids org_members infinite recursion (42P17) in RLS policies"
  - "citext -> text for patient_email (citext extension not installed on project DB)"
  - "magic-link generation excluded from accept_org_patient_invite per RESEARCH §Open Q3 RESOLVED"
metrics:
  duration: "31 minutes"
  completed: "2026-05-17"
  tasks: 3
  files: 4
---

# Phase 29 Plan 02: org_patient_invites + 3 SECDEF RPCs + cross-tenant RLS proof Summary

**One-liner:** Patient-consent invite table (`org_patient_invites`) + 3 SECDEF RPCs (send + preview + accept) + cross-tenant RLS proof test proving BLOCKER R1 from 28-EXTENSION-CONTRACT.

## Objective

Ship the DB layer for ORG-10 patient invite flow: new `org_patient_invites` table, three SECDEF RPCs for the invite lifecycle, and the cross-tenant isolation proof test required by Phase 28 EXTENSION-CONTRACT §3b BLOCKER R1.

## What Shipped

### Task 1 — org_patient_invites table migration + ORG_SCOPED_TABLES

Migration `20270601200003_org_patient_invites.sql`:
- `org_patient_invites` table with `org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT` (EXTENSION-CONTRACT §4)
- 3 indexes: `org_id_idx` (hot path), `token_hash_idx` (preview lookup), partial unique `pending_unique_idx (org_id, patient_email) WHERE accepted_at IS NULL`
- BEFORE INSERT/UPDATE trigger calling `_validate_consent_scope` for Phase 9 shape validation
- RLS: `enable` + `force`, SELECT policy via `_is_org_admin` SECDEF helper (no INSERT/UPDATE/DELETE for authenticated)
- `_is_org_admin(p_org_id uuid, p_user_id uuid) returns boolean` SECDEF helper created to avoid `org_members` self-referential RLS infinite recursion (42P17)

`supabase/functions/_shared/with-org-scope.ts`:
- Appended `'org_patient_invites'` to `ORG_SCOPED_TABLES` (BLOCKER R2 satisfied)

### Task 2 — 3 SECDEF RPCs

Migration `20270601200004_org_patient_invite_rpcs.sql`:

**send_org_patient_invite(p_org_id, p_patient_email, p_consent_scope, p_invite_token_hash)**
- Pattern S1: admin role re-check before insert
- W-1: unconditional INSERT regardless of whether email exists in auth.users
- Direct `audit_logs` INSERT (see deviation notes below)

**accept_org_patient_invite_preview(p_invite_token_hash)**
- STABLE, SECURITY DEFINER
- Granted to `anon, authenticated` (patient may not be authed yet)
- Returns `{org_name, org_logo_url, scope_summary}` or raises P0002 for invalid/expired tokens (anti-enumeration)

**accept_org_patient_invite(p_invite_token_hash, p_patient_user_id)**
- Single-transaction commit chain (steps a-e):
  - (a) validate invite (not accepted, not expired)
  - (b) UPDATE profiles.primary_org_id
  - (c) INSERT org_consent_grants (scope + granted_via='invite')
  - (d) INSERT org_patient_links
  - (e) UPDATE invite.accepted_at = now()
  - (f) audit INSERT into audit_logs
- Magic-link NOT included (Plan 29-05 Edge Function's responsibility per RESEARCH §Open Q3)

### Task 3 — Cross-tenant RLS proof test

`leanshot/src/lib/__tests__/rls-org-patient-invites.test.ts`:
- File-scoped `TEST_SLUG_PREFIX = makeSlugPrefix(path.basename(__filename))`
- ES256-compat fixture via `createTwoOrgsTwoUsers`
- All 8 tests pass:
  - T3: User A cannot SELECT org_patient_invites of Org Y → 0 rows, no error
  - T4: User A cannot INSERT into Org Y → error (RLS denies)
  - T5a: User A cannot UPDATE Org Y rows → 0 rows affected, data unchanged
  - T5b: User A cannot DELETE Org Y rows → 0 rows affected, row persists
  - T3b: User A CAN SELECT org_patient_invites of Org X (own org) → ≥1 row
  - T6: non-admin calling send_org_patient_invite raises 42501
  - T7: W-1 — identical {invite_id, status:'sent'} for existing AND new email
  - Gating check: always passes

## Verification Evidence

### Post-push probe output

```
table_exists=true, policy_count=1 (SELECT only), index_count=4, rls_enabled=true, rls_forced=true
rpc_count=3 (send_org_patient_invite, accept_org_patient_invite_preview, accept_org_patient_invite)
search_path=pg_catalog, public, extensions on all 3 SECDEFs
```

### Vitest test output

```
Tests  8 passed (8)
Duration: 3.28s
```

## Decisions Honored

- **D-06 (CONTEXT override):** `on delete restrict` per EXTENSION-CONTRACT §4 (NOT cascade) — preserves audit trail
- **D-07:** send RPC delivers invite via token hash; Resend email is Plan 29-05's responsibility
- **D-08 (BREAKING NOTE):** accept RPC commits steps a-e atomically; magic-link via `admin.generateLink` is Plan 29-05's responsibility (cannot be in PL/pgSQL)
- **D-13:** `accepted_at` state machine: NULL+expires>now (pending), NULL+expires<=now (expired by query), NOT NULL (accepted)
- **EXTENSION-CONTRACT §4:** on delete restrict on org_id FK
- **EXTENSION-CONTRACT §2:** SECDEF + Pattern S1 + force RLS
- **EXTENSION-CONTRACT §5:** ORG_SCOPED_TABLES updated
- **EXTENSION-CONTRACT §8:** consent_scope validated via Phase 9 `_validate_consent_scope` trigger

## Carry-Forward to Plan 29-05

- Plan 29-05 (Edge Function `clinic-patient-invite/send`) consumes `send_org_patient_invite` RPC
- Plan 29-05 calls `accept_org_patient_invite_preview` + `accept_org_patient_invite` in the accept flow
- Plan 29-05 is responsible for `admin.generateLink` magic-link generation AFTER `accept_org_patient_invite` commits

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] citext -> text for patient_email column**
- **Found during:** Task 1 migration push
- **Issue:** `citext` type not installed on the project DB (`CREATE EXTENSION IF NOT EXISTS citext` not in this DB)
- **Fix:** Changed `patient_email citext NOT NULL` to `patient_email text NOT NULL` (matches pattern used by `org_invites.email`)
- **Files modified:** `supabase/migrations/20270601200003_org_patient_invites.sql`

**2. [Rule 1 - Bug] log_admin_action incompatible with org-admin callers**
- **Found during:** Task 3 test run (T7 test)
- **Issue:** `log_admin_action` Phase 24 function checks `is_admin_at_least('staff')` which requires PLATFORM admin role. Org admins are NOT platform admins. Calling `log_admin_action` from an org-admin's SECDEF context raises "caller is not admin". This is a pre-existing design conflict — P28's `send_org_invite` has the same broken pattern.
- **Fix:** Changed write RPCs to insert directly into `audit_logs` (matching `fn_audit_phi_trigger` column pattern: `user_id_hash`, `table_name`, `action`, `user_id`, `actor_user_id`, `action_name`, `row_pk`, `after_data`, `source`). SECDEF bypasses RLS on `audit_logs`.
- **Files modified:** `supabase/migrations/20270601200004_org_patient_invite_rpcs.sql`

**3. [Rule 1 - Bug] org_members self-referential RLS policy causes infinite recursion (42P17)**
- **Found during:** Task 3 test run (T3, T5a, T5b, T3b tests)
- **Issue:** The `org_members` SELECT policy references `org_members` itself via `EXISTS (SELECT 1 FROM org_members om2 WHERE ...)`. When `org_patient_invites`' RLS policy queries `org_members`, Postgres 17 triggers infinite recursion detection (42P17). This is a pre-existing P28 bug affecting ALL org_* RLS policies — `rls-org-members.test.ts` and `rls-org-invites.test.ts` also fail with the same error.
- **Fix:** Introduced `_is_org_admin(p_org_id uuid, p_user_id uuid) returns boolean` SECURITY DEFINER helper function. When called from a policy, SECDEF bypasses `org_members`' own RLS → no recursion. Updated `org_patient_invites` SELECT policy to use this helper. NOTE: This fix only applies to `org_patient_invites`; other P28 tables still have the recursion bug.
- **Files modified:** `supabase/migrations/20270601200003_org_patient_invites.sql` (inline fix applied directly, also pushed via db query)

### Pre-existing Bugs NOT in Scope (logged for future fix)

The following pre-existing bugs were discovered but are OUT OF SCOPE for this plan (not caused by Plan 29-02 changes):
- `org_members` self-referential RLS causing 42P17 on all other P28 org_* tables (`rls-org-members.test.ts`, `rls-org-invites.test.ts`, `rls-org-settings.test.ts`, etc.)
- `send_org_invite` in P28 migration `20270601100012` calls `log_admin_action` with wrong arg types

These are deferred to a dedicated fix plan or Phase 29 cleanup.

## BLOCKER STATUS (28-EXTENSION-CONTRACT)

- **BLOCKER R1** (cross-tenant RLS proof test): SATISFIED — all T3/T4/T5a/T5b/T3b/T6/T7 pass
- **BLOCKER R2** (ORG_SCOPED_TABLES update): SATISFIED — `'org_patient_invites'` in set
- **BLOCKER R3** (SECDEF RPCs for all writes): SATISFIED — 3 SECDEFs shipped
- **BLOCKER R4** (audit invariant): SATISFIED — both write RPCs insert to audit_logs
- **BLOCKER R5** (search_path locked): SATISFIED — all SECDEFs have `set search_path = pg_catalog, public, extensions`

## Threat Surface Scan

No new security-relevant surfaces beyond those in the plan's `<threat_model>`. Mitigations T-29-02-01 through T-29-02-06 all implemented as specified:
- T-29-02-01: Cross-tenant SELECT denied (T3 proves) ✓
- T-29-02-02: Non-admin raise 42501 (T6 proves) ✓
- T-29-02-03: W-1 anti-enumeration for email existence (T7 proves) ✓
- T-29-02-04: Token hash 256-bit + uniform error for invalid/expired ✓
- T-29-02-05: Audit trail in audit_logs for both write RPCs ✓
- T-29-02-06: consent_scope validated by trigger (BEFORE INSERT) ✓

## Self-Check: PASSED

- `supabase/migrations/20270601200003_org_patient_invites.sql` — EXISTS ✓
- `supabase/migrations/20270601200004_org_patient_invite_rpcs.sql` — EXISTS ✓
- `supabase/functions/_shared/with-org-scope.ts` — `org_patient_invites` in ORG_SCOPED_TABLES ✓
- `leanshot/src/lib/__tests__/rls-org-patient-invites.test.ts` — EXISTS ✓
- Live DB: table exists, policy_count=1, rls_forced=true, 3 RPCs with search_path locked ✓
- Test suite: 8/8 pass ✓
