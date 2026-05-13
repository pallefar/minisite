---
phase: 10-clinic-operator-surface
plan: 04
subsystem: database
tags: [postgres, supabase, deno, edge-function, rls, audit-logs, rpc, security-definer]

# Dependency graph
requires:
  - phase: 10-clinic-operator-surface
    plan: 01
    provides: audit_logs_action_check extended with section_view + clinic_snapshot_loaded, src/types/snapshot.ts canonical types
  - phase: 09-clinic-b2b-foundations
    provides: has_permission helper, memberships table, permissions/role_permissions, audit_logs schema
  - phase: 08-doctor-read-share
    provides: Phase 8 share/index.ts template (Cache-Control: private, no-store pattern)
provides:
  - log_clinic_view(org_id, target_user_id, section_name) SECURITY DEFINER RPC applied to ytnsipxxmzgaebkqmokp
  - clinic-snapshot Edge Function deployed to ytnsipxxmzgaebkqmokp
  - Cross-tenant impersonation proof in e2e/rls-log-clinic-view.test.ts (5 behaviors, all pass)
  - 14 Deno test assertions in supabase/functions/clinic-snapshot/index.test.ts
affects: [10-clinic-operator-surface/10-07, 10-clinic-operator-surface/10-08]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Cache-Control: private, no-store via BASE_RESPONSE_HEADERS applied to every response status code (mirrors Phase 8 SHARE-03)"
    - "SECURITY DEFINER RPC with photos/data permission split: photos section requires patient_photos.read, all others require patient_data.read"
    - "audit_logs row_id encoding: '{target_user_id}/{section_name}' for HBNR explainability queries"
    - "Edge Function mock-injection pattern via exported handle(req, { admin }) for Deno tests (mirrors clinic-photo pattern)"
    - "consent_scope intersection with permission check: canViewSection = consent_scope[section] === true AND operator has required permission"

key-files:
  created:
    - supabase/migrations/20260901000005_log_clinic_view_rpc.sql
    - supabase/functions/clinic-snapshot/index.ts
    - supabase/functions/clinic-snapshot/cors.ts
    - supabase/functions/clinic-snapshot/deno.json
    - supabase/functions/clinic-snapshot/index.test.ts
    - leanshot/e2e/rls-log-clinic-view.test.ts
  modified: []

key-decisions:
  - "audit_logs INSERT for log_clinic_view uses existing Phase 7 schema columns (user_id, user_id_hash, table_name, row_id, action, actor_type, org_id) — section name encoded in row_id as '{target_user_id}/{section}' since no dedicated metadata column existed at Phase 9 layer. Migration 003 added metadata + target_user_id columns (Plan 10-02); clinic-snapshot Edge Function uses those new columns for its audit row."
  - "OPTIONS preflight returns HTTP 200 (not 204) — HTTP 204 cannot have a body, and Deno's Response throws TypeError for null-body status with body content."
  - "View-only built-in role HAS patient_data.read by default (Phase 9 seed). Behavior 4 test was redesigned to test photos section (requires patient_photos.read which View-only lacks) rather than non-photos section."
  - "clinic-snapshot audit row uses target_user_id + metadata columns from migration 003 (Plan 10-02 added these); best-effort write (failure does not block 200 response)."

patterns-established:
  - "Photos-section permission split: SECURITY DEFINER RPCs and Edge Functions must check patient_photos.read specifically for photos, patient_data.read for all other sections."
  - "Consent-scope intersection: permission_map.canViewSection = consent_scope[section] === true AND operator has role permission — dual gate mandatory."

requirements-completed: [CLINIC-05, CLINIC-07]

# Metrics
duration: 14min
completed: 2026-05-13
---

# Phase 10 Plan 04: clinic-snapshot Edge Function + log_clinic_view RPC Summary

**SECURITY DEFINER per-section audit RPC and JWT-authed operator snapshot Edge Function deployed with Cache-Control: private, no-store on every response and 14 Deno test assertions green**

## Performance

- **Duration:** ~14 min
- **Started:** 2026-05-13T07:42:42Z
- **Completed:** 2026-05-13T07:56:00Z
- **Tasks:** 2 of 2
- **Files modified:** 6

## Accomplishments

### Task 1: log_clinic_view RPC + Cross-Tenant pgTAP Spec

- Authored `supabase/migrations/20260901000005_log_clinic_view_rpc.sql`:
  - SECURITY DEFINER `log_clinic_view(p_org_id, p_target_user_id, p_section_name)` with `set search_path = public, extensions, pg_catalog`
  - Photos section gates on `patient_photos.read`; all other sections gate on `patient_data.read`
  - Raises `access_denied` when caller lacks the required permission (covers cross-tenant org case)
  - Raises `patient_not_in_org` when target patient has no active membership
  - INSERTs to `audit_logs` with `action='section_view'`, `actor_type='org_member'`, `row_id='{target_user_id}/{section}'`
  - Migration applied to `ytnsipxxmzgaebkqmokp`
- Authored `e2e/rls-log-clinic-view.test.ts`:
  - 5-behavior cross-tenant impersonation proof (happy path, cross-tenant org, cross-tenant patient, photos permission gating, photos vs non-photos split)
  - All 5 assertions pass against the live DB

### Task 2: clinic-snapshot Edge Function + Deno Tests

- Authored `supabase/functions/clinic-snapshot/index.ts`:
  - 4-step D-04 auth gate: JWT → active membership → has_permission(patient_data.read) → patient consent_scope
  - `permission_map` computed as intersection of operator role permissions and patient consent_scope
  - Per-section data fetching: omits sections where consent_scope[section]=false
  - `ai_history` structurally excluded (never queried — T-10-04-04)
  - Audit row with action='clinic_snapshot_loaded' (best-effort, uses target_user_id + metadata columns)
  - Returns `SnapshotData` with `viewer_context='clinic'`, `org_id`, `permission_map`, `consent_scope`
- Authored `supabase/functions/clinic-snapshot/cors.ts`:
  - Wildcard ACAO (JWT auth gate, no cookies)
  - `BASE_RESPONSE_HEADERS` includes `Cache-Control: private, no-store` for every response status code
- Authored `supabase/functions/clinic-snapshot/deno.json`: mirror of clinic-photo pattern
- Authored `supabase/functions/clinic-snapshot/index.test.ts`:
  - 14 Deno tests covering all auth paths, consent gating, permission_map, ai_history exclusion
  - All 14 pass: `deno test --allow-all` green
- Edge Function deployed to `ytnsipxxmzgaebkqmokp`

## Task Commits

1. **Task 1: log_clinic_view RPC + cross-tenant RLS proof** — `7b5e8c5` (feat)
2. **Task 2: clinic-snapshot Edge Function + Deno tests** — `ea28abc` (feat)

## Files Created/Modified

- `supabase/migrations/20260901000005_log_clinic_view_rpc.sql` — SECURITY DEFINER log_clinic_view with 2-gate permission + patient check + audit INSERT
- `leanshot/e2e/rls-log-clinic-view.test.ts` — 5-behavior cross-tenant impersonation proof
- `supabase/functions/clinic-snapshot/index.ts` — operator snapshot Edge Function with 4-step JWT auth gate
- `supabase/functions/clinic-snapshot/cors.ts` — CORS + BASE_RESPONSE_HEADERS with Cache-Control: private, no-store
- `supabase/functions/clinic-snapshot/deno.json` — Deno task config
- `supabase/functions/clinic-snapshot/index.test.ts` — 14 Deno test assertions

## Decisions Made

- **audit_logs column layout:** log_clinic_view uses Phase 7 schema (user_id, row_id, table_name) because the `metadata` and `target_user_id` columns did not exist in Phase 7/9 baseline. Migration 003 (Plan 10-02 sibling executor) added those columns. The clinic-snapshot Edge Function uses them since it runs after migration 003 is applied.
- **VIEW-ONLY has patient_data.read:** The Phase 9 seed gives View-only `patient_data.read` (org.read + members.list + patient_data.read). The e2e test was revised to test photos permission split (photos section requires patient_photos.read, which View-only lacks) rather than non-photos section denial.
- **OPTIONS returns 200, not 204:** HTTP 204 No Content cannot carry a body. Deno's Fetch API throws TypeError for 204 with body. Used 200 matching the clinic-photo precedent.
- **Consent-scope + permission intersection:** `canViewSection = consent_scope[section] === true AND operator_has_permission`. Both gates must pass. A consent withdrawal overrides the operator's role permission.

## Deviations from Plan

### Auto-Fixed Issues

**1. [Rule 1 - Bug] HTTP 204 with body causes TypeError in Deno**
- **Found during:** Task 2 Deno test run (OPTIONS preflight test)
- **Issue:** `new Response('ok', { status: 204, headers: ... })` throws `TypeError: Response with null body status cannot have body` in Deno's Fetch implementation. HTTP 204 is a null-body status.
- **Fix:** Changed OPTIONS preflight from `{ status: 204 }` to `{ status: 200 }` matching Phase 9 `clinic-photo` precedent.
- **Files modified:** `supabase/functions/clinic-snapshot/index.ts`

**2. [Rule 1 - Bug] audit_logs column schema mismatch**
- **Found during:** Task 1 migration authoring
- **Issue:** The PLAN's SQL skeleton uses `actor_id`, `target_user_id`, `metadata`, `created_at` column names, but the actual Phase 7 audit_logs schema uses `user_id`, `user_id_hash`, `table_name`, `row_id`, `action`, `actor_type`, `org_id`, `timestamp`.
- **Fix:** Used the actual Phase 7 schema column names in the log_clinic_view INSERT; encoded section info in `row_id` as `'{target_user_id}/{section}'`.
- **Files modified:** `supabase/migrations/20260901000005_log_clinic_view_rpc.sql`

**3. [Rule 1 - Bug] View-only role has patient_data.read (test scenario wrong)**
- **Found during:** Task 1 e2e test run
- **Issue:** Phase 9 seed gives View-only `patient_data.read` (per `20260801000010_seed_system_roles_trigger.sql` comment: "View-only — org.read + members.list + patient_data.read"). Test Behavior 4 asserting "operator without patient_data.read" would fail against View-only.
- **Fix:** Redesigned Behavior 4 to test photos section (photos requires `patient_photos.read` which View-only lacks) and added a positive control showing View-only CAN call non-photos sections.
- **Files modified:** `leanshot/e2e/rls-log-clinic-view.test.ts`

## Threat Model Coverage (from 10-04-PLAN.md)

| Threat ID | Status | Mitigation Applied |
|-----------|--------|--------------------|
| T-10-04-01 (consent_scope sections) | MITIGATED | per-section omission in Edge Function + Deno test 7 asserts photos absent when consent_scope.photos=false |
| T-10-04-02 (audit row cross-tenant) | MITIGATED | RPC checks patient membership BEFORE INSERT; e2e test behavior 3 proves patient_not_in_org fires |
| T-10-04-03 (CDN caching) | MITIGATED | BASE_RESPONSE_HEADERS always includes Cache-Control: private, no-store; Deno tests 1-4 and 9 assert header |
| T-10-04-04 (ai_history leak) | MITIGATED | ai_history never queried in Edge Function; Deno test 10 asserts key absent in response body |
| T-10-04-05 (JWT logged) | MITIGATED | JWT used only for admin.auth.getUser() → never logged, never in response body |

## Known Stubs

None — no hardcoded empty values or placeholder text that flows to UI rendering. The Edge Function returns real data from the live DB.

## Threat Flags

None — no new network endpoints or auth paths beyond what the plan's threat model covers.

## Self-Check: PASSED

- `supabase/migrations/20260901000005_log_clinic_view_rpc.sql` FOUND
- `supabase/functions/clinic-snapshot/index.ts` FOUND
- `supabase/functions/clinic-snapshot/cors.ts` FOUND
- `supabase/functions/clinic-snapshot/deno.json` FOUND
- `supabase/functions/clinic-snapshot/index.test.ts` FOUND
- `leanshot/e2e/rls-log-clinic-view.test.ts` FOUND
- Commit `7b5e8c5` FOUND in git log
- Commit `ea28abc` FOUND in git log
- No deletions in either commit
- Deno tests: 14/14 pass
- e2e cross-tenant tests: 2/2 pass (5 behaviors)
- Migration applied to ytnsipxxmzgaebkqmokp
- Edge Function deployed to ytnsipxxmzgaebkqmokp

---
*Phase: 10-clinic-operator-surface*
*Completed: 2026-05-13*
