---
phase: 61-admin-protocol-creator
plan: "02"
subsystem: supabase/migrations
tags:
  - secdef
  - state-machine
  - 2-person-review
  - protocol
  - rls
  - plpgsql
dependency_graph:
  requires:
    - 61-01-db-tables-rls  # tables + ENUM + indexes must exist before functions compile
  provides:
    - publish_protocol RPC (PROTOCOL-04 2-person rule DB layer)
    - submit_protocol_for_review RPC
    - rollback_protocol RPC (PROTOCOL-05)
    - archive_protocol RPC
    - assign_protocol_to_patient RPC (PROTOCOL-06)
    - get_protocol_by_slug RPC (public route + Edge Fn)
    - list_admin_ai_assist_usage_today RPC (rate-limit pre-check)
  affects:
    - 61-03-protocol-ai-assist-fn  # calls list_admin_ai_assist_usage_today
    - 61-04-admin-core-ui          # calls submit_protocol_for_review, archive_protocol
    - 61-05-admin-editor-ui        # calls publish_protocol, rollback_protocol
    - 61-06-clinic-adopt-flow      # calls assign_protocol_to_patient
    - 61-07-patient-kb-public      # calls get_protocol_by_slug
tech_stack:
  added: []
  patterns:
    - SECURITY DEFINER + SET search_path = public, extensions, pg_catalog
    - FOR UPDATE row lock before state read (concurrency safety)
    - SELF_REVIEW_REJECTED exception pattern (2-person rule DB layer)
    - ON CONFLICT (patient_id, protocol_id) DO UPDATE (idempotent re-assign)
    - date_trunc('day', now() at time zone 'UTC') UTC-day boundary
key_files:
  created:
    - supabase/migrations/20260526000002_protocol_secdef_rpcs.sql
  modified: []
decisions:
  - "get_protocol_by_slug has NO staff guard — authenticated users can call; SECDEF bypasses RLS so published filter is applied explicitly in WHERE clause"
  - "assign_protocol_to_patient does NOT use FOR UPDATE — assignment is not a protocol state transition; no race condition risk on the patient_protocol_assignment table"
  - "rollback_protocol requires target version to be 'archived' (not just any non-published state) — only previously-published-then-archived versions qualify for rollback"
  - "archive_protocol accepts any state → archived — no precondition check needed; simpler contract for UI"
  - "Audit INSERT happens inside each function body (before return) per audit-row-is-truth invariant"
  - "BEGIN/COMMIT wraps whole file for atomic installation"
metrics:
  duration: "2m"
  completed: "2026-05-26T16:52:31Z"
  tasks_completed: 1
  tasks_total: 1
  files_created: 1
  files_modified: 0
---

# Phase 61 Plan 02: SECDEF RPCs Summary

**One-liner:** 7 SECDEF RPCs implementing the protocol state machine with FOR UPDATE concurrency safety, SELF_REVIEW_REJECTED 2-person rule enforcement, and UTC-day rate-limit counter.

## What Was Built

Created `supabase/migrations/20260526000002_protocol_secdef_rpcs.sql` containing 7 SECURITY DEFINER RPCs that own every protocol state transition. No state change is reachable except through these functions (PROTOCOL-04 enforcement at DB layer).

### RPC Signatures

```sql
-- State machine RPCs (staff-only):
public.submit_protocol_for_review(p_protocol_id uuid, p_version int) returns void
public.publish_protocol(p_protocol_id uuid, p_version int) returns void
public.rollback_protocol(p_protocol_id uuid, p_target_version int) returns void
public.archive_protocol(p_protocol_id uuid, p_version int) returns void

-- Clinician adopt flow (staff-only):
public.assign_protocol_to_patient(p_protocol_id uuid, p_version int, p_patient_id uuid) returns void

-- Public route + Edge Fn (authenticated, no staff guard):
public.get_protocol_by_slug(p_base_slug text)
  returns table (id, version, name, compound, audience, slug, base_slug, published_at, steps jsonb, evidence jsonb)

-- Rate-limit support (staff-only):
public.list_admin_ai_assist_usage_today() returns int
```

### 2-Person Rule Mechanism (PROTOCOL-04)

`publish_protocol` enforces the 2-person rule at the DB layer:

```sql
if v_created_by is not null and v_created_by = auth.uid() then
  raise exception 'SELF_REVIEW_REJECTED: publisher (%) cannot equal creator (%)',
    auth.uid(), v_created_by
    using errcode = '42501';
end if;
```

The literal substring `SELF_REVIEW_REJECTED` is consumed by the admin UI (Plan 05) to render the toast: "Another admin must review this protocol before publish." This is Layer 1 of the 3-layer invariant:
- Layer 1 (this file): DB SECDEF guard
- Layer 2 (Plan 05): Publish button fully removed from DOM when `currentUserId === created_by`
- Layer 3 (Plan 08): CI eval asserts 42501 errcode when caller == creator

### Concurrency Safety Pattern

Every state-mutating RPC uses `FOR UPDATE` before the state check:

```sql
select review_state into v_state from public.protocols
where id = p_protocol_id and version = p_version
for update;
```

This prevents concurrent double-publish/double-submit races (T-61-02-02 mitigation).

### Rollback Pattern (PROTOCOL-05)

`rollback_protocol` validates the target is `archived` (only previously-published-then-archived versions qualify), archives the current published version, then re-publishes the target. Writes `rolled_back` audit row.

### get_protocol_by_slug

Returns the latest published version with aggregated `steps` (JSON array ordered by week) and `evidence` (JSON array joined through protocol_steps). No staff guard — authenticated users can call. SECDEF bypasses RLS so the `review_state = 'published'` filter is enforced explicitly in the WHERE clause.

## Deviations from Plan

None — plan executed exactly as written.

The migration mirrors the `approve_rag_chunk` shape verbatim (SECURITY DEFINER + SET search_path = public, extensions, pg_catalog + FOR UPDATE + staff guard + state precondition + UPDATE + audit INSERT + REVOKE/GRANT).

## Threat Mitigations Applied

| Threat ID | Mitigation |
|-----------|------------|
| T-61-02-01 | publish_protocol RAISES 'SELF_REVIEW_REJECTED' when auth.uid() = created_by; errcode '42501' |
| T-61-02-02 | FOR UPDATE row lock on every state-read precedes state-mutation in 4 of 7 RPCs |
| T-61-02-04 | ON CONFLICT (patient_id, protocol_id) DO UPDATE makes patient assignment idempotent |

## Known Stubs

None — this plan ships only SQL. No UI or TypeScript stubs.

## Threat Flags

None — no new network endpoints, auth paths, or schema changes beyond what the plan declared.

## Self-Check: PASSED

- `/Users/karstenhaldan/minisite/.claude/worktrees/agent-a9e540387ed390af7/supabase/migrations/20260526000002_protocol_secdef_rpcs.sql` — FOUND
- Commit `69dcaa2a` — verified in git log
- 7 `create or replace function public.` declarations — verified
- 7 `security definer` — verified
- 7 `grant execute on function ... to authenticated` — verified
- `SELF_REVIEW_REJECTED` in publish_protocol body — verified
- `FOR UPDATE` in 4 state-mutating functions — verified
- `ON CONFLICT (patient_id, protocol_id)` in assign_protocol_to_patient — verified
- `date_trunc('day', now() at time zone 'UTC')` in list_admin_ai_assist_usage_today — verified
- `get_protocol_by_slug` has NO is_staff() guard — verified
