---
phase: 10-clinic-operator-surface
plan: "03"
subsystem: realtime-broadcast
tags: [realtime, broadcast, triggers, rls, consent-scope, sql, e2e]
dependency_graph:
  requires:
    - 10-01 (audit enum extension + permission seed)
    - Phase 9 realtime.messages RLS (20260801000012)
    - Phase 9 memberships table + consent_scope column
    - Phase 9 has_permission SECURITY DEFINER helper
  provides:
    - broadcast_patient_signal_change SECURITY DEFINER trigger function
    - injections_clinic_broadcast AFTER INSERT trigger
    - weights_clinic_broadcast AFTER INSERT trigger
    - symptoms_clinic_broadcast AFTER INSERT trigger
  affects:
    - 10-06 (ClinicWorkspace subscribes to org: channel for live signal columns)
    - 10-07 (ClinicDrillInPage uses realtime-patched roster row data)
tech_stack:
  added: []
  patterns:
    - SECURITY DEFINER trigger function with realtime.send(jsonb, event, topic, bool)
    - Server-side consent_scope filter via COALESCE(...::bool, false)
    - Vitest live-DB e2e pattern (not Playwright) for realtime channel subscription proofs
key_files:
  created:
    - supabase/migrations/20260901000004_clinic_realtime_broadcast_triggers.sql
    - leanshot/e2e/rls-realtime-clinic-broadcast.test.ts
    - supabase/migrations/20260901000006_fix_create_org_ambiguous_org_id.sql
  modified: []
decisions:
  - Topic format is org:<uuid> (colon) not org-<uuid> (hyphen) — matches Phase 9 realtime.messages RLS policy which parses substring(topic from 5) after the colon
  - realtime.send(jsonb, event, topic, private_bool) confirmed on live DB (not realtime.broadcast)
  - All three tables (injections/weights/symptoms) use created_at — no recorded_at column exists
  - fullConsentScope() required for invite/accept flow; admin setConsentScopeKey() used to patch specific keys for filter tests
metrics:
  duration: "745s (~12 min)"
  completed: "2026-05-13"
  tasks_completed: 1
  files_created: 3
---

# Phase 10 Plan 03: Realtime Broadcast Triggers Summary

SECURITY DEFINER trigger function + 3 AFTER INSERT triggers on injections/weights/symptoms with org-scoped topic broadcast gated server-side by active membership + consent_scope.

## Completed Tasks

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Broadcast trigger migration + cross-tenant + consent_scope spec | f36facb | 2 new + 1 Rule-1 fix |

## Trigger Function Inventory

### `public.broadcast_patient_signal_change()`

- **Language:** plpgsql
- **Security:** SECURITY DEFINER
- **search_path:** `public, extensions, pg_catalog`
- **Argument:** `TG_ARGV[0]` — section name ('injections' | 'weights' | 'symptoms')
- **Payload shape:** `{ event: 'patient_signal_change', user_id: uuid, section: text, changed_at: timestamptz }`
- **Filter:** `memberships.revoked_at IS NULL AND COALESCE((consent_scope ->> section)::bool, false) = true`
- **Topic:** `'org:' || v_org_id::text` (colon format matching Phase 9 RLS)
- **Realtime API:** `realtime.send(payload jsonb, event text, topic text, private boolean)` — 4-arg form confirmed on live DB

### Triggers

| Trigger | Table | Event |
|---------|-------|-------|
| `injections_clinic_broadcast` | `public.injections` | AFTER INSERT |
| `weights_clinic_broadcast` | `public.weights` | AFTER INSERT |
| `symptoms_clinic_broadcast` | `public.symptoms` | AFTER INSERT |

## Per-Test Observations

| Test | Assertion | Result | Latency |
|------|-----------|--------|---------|
| Test 1 — in-org happy path | Broadcast received with correct payload | PASS | ~800ms |
| Test 2 — cross-org isolation | Zero broadcasts for non-member org | PASS | 3s window |
| Test 3 — consent_scope=false | Zero broadcasts when injections=false | PASS | 3s window |
| Test 4 — revoked membership | Zero broadcasts for revoked membership | PASS | 3s window |
| Test 5 — multi-org fan-out | Two orgs each receive their broadcast | PASS | ~1.5s |
| Test 6 — weights table | section='weights' broadcast received | PASS | ~600ms |
| Test 7 — symptoms table | section='symptoms' broadcast received | PASS | ~800ms |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Topic format mismatch (plan says `org-`, Phase 9 RLS uses `org:`)**
- **Found during:** Task 1 — reading Phase 9 `realtime_messages_rls.sql` before authoring
- **Issue:** Plan `<action>` block specifies `'org-' || v_org_id::text` but Phase 9's `realtime.messages` RLS policy parses `'org:%'` prefix (colon) using `substring(topic from 5)`. Using `org-` would send broadcasts to a topic that no subscribe-side RLS policy covers, causing operators to never receive events.
- **Fix:** Used `'org:' || v_org_id::text` in the trigger function to match Phase 9's established format.
- **Files modified:** `supabase/migrations/20260901000004_clinic_realtime_broadcast_triggers.sql`
- **Commit:** f36facb

**2. [Rule 1 - Bug] PL/pgSQL 42702 ambiguous `org_id` in create_org/accept_invite_existing/accept_invite_new**
- **Found during:** Task 1 — running live e2e tests, saw `column reference "org_id" is ambiguous` from `create_org`
- **Issue:** When migration 10-02 (`rank_org_patients_rpc.sql`) added `audit_logs.metadata` and `audit_logs.target_user_id` columns, PostgreSQL invalidated and recompiled the affected functions. During recompilation, the bare `org_id` in `WHERE org_id = ...` inside `create_org` and the accept_invite functions was found ambiguous — both the RETURNS TABLE output variable `org_id` and the `public.roles.org_id` table column match.
- **Fix:** Added migration `20260901000006_fix_create_org_ambiguous_org_id.sql` that re-emits all three functions with table-qualified column references (`r.org_id` instead of bare `org_id` in WHERE clauses). All logic is semantically identical to Phase 9's `clinic_rpcs.sql`.
- **Files modified:** `supabase/migrations/20260901000006_fix_create_org_ambiguous_org_id.sql` (new migration)
- **Commit:** f36facb
- **Regression verified:** `rls-memberships.test.ts` passes again (1/1 live tests).

**3. [Rule 1 - Bug] realtime.send() vs realtime.broadcast() API mismatch**
- **Found during:** Task 1 — pre-authoring check `\df realtime.*` on live DB
- **Issue:** RESEARCH.md architecture skeleton uses `realtime.broadcast(topic, payload)` (2-arg) but the plan `<action>` block correctly specifies `realtime.send(payload, event, topic, private)` (4-arg). DB query confirmed only `realtime.send(jsonb, text, text, boolean)` exists.
- **Fix:** Used `realtime.send()` as specified in the plan `<action>` block.
- **Commit:** f36facb

**4. [Rule 1 - Bug] Test insert functions missing user_id (RLS violation)**
- **Found during:** Task 1 — first live-DB test run
- **Issue:** `insertInjection/Weight/Symptom` helpers didn't include `user_id` in the INSERT payload. The RLS `with check (auth.uid() = user_id)` requires the user_id to match the JWT.
- **Fix:** Added `user_id` parameter to all three insert helpers and updated call sites.
- **Commit:** f36facb

**5. [Rule 1 - Bug] Test consent_scope validation failure (consent_scope_missing_key: photos)**
- **Found during:** Task 1 — second live-DB test run after org_id fix
- **Issue:** Test was passing partial consent scopes `{ injections: true, weights: false, symptoms: false }` but the `_validate_consent_scope` function (Phase 9) requires all 10 keys. Tests couldn't create memberships.
- **Fix:** All invite/accept flows now use `fullConsentScope()`, and tests that need a specific key set to false use `setConsentScopeKey()` (admin read-modify-write helper) to patch only the relevant key post-creation.
- **Commit:** f36facb

## Threat Surface Scan

No new RLS surfaces beyond those in the plan's threat_model:
- T-10-03-01 (patient_id to wrong org channel) — mitigated by memberships JOIN
- T-10-03-02 (broadcast despite consent_scope=false) — mitigated by COALESCE gate, tested
- T-10-03-03 (DoS from high-frequency inserts) — accepted

## Known Stubs

None.

## Self-Check: PASSED

- [x] `supabase/migrations/20260901000004_clinic_realtime_broadcast_triggers.sql` exists in worktree
- [x] `leanshot/e2e/rls-realtime-clinic-broadcast.test.ts` exists in worktree
- [x] `supabase/migrations/20260901000006_fix_create_org_ambiguous_org_id.sql` exists in worktree
- [x] Commit f36facb exists
- [x] All 3 triggers present in `pg_trigger` on live DB
- [x] `broadcast_patient_signal_change` function present in `pg_proc`
- [x] All 7 live-DB e2e tests pass (8/8 total including static gate)
- [x] rls-memberships.test.ts passes (regression check for Rule 1 fix)
