# Phase 37 Plan-Check Iter-3

**Iteration:** 3 of 3 (revision gate — final)
**Date:** 2026-05-21
**Checker focus:** NEW-B-01 + NEW-B-02 closed? No new blockers? Migration manifest consistent?

---

## NEW-B-01 (Plan 01 missing Task 5) — CLOSED

Task 5 added to 37-01. Migration slot 9 (`20270707000009_helpdesk_create_ticket_rpc.sql`) declared in `files_modified`, `must_haves.truths`, and `<done>`. Verify block grep-asserts file existence, SECDEF, `set search_path`, revoke, grant, and `primary_org_id`. Signature matches Plan 06 Task 3 call site. CLOSED.

## NEW-B-02 (Plan 06 conditional collision risk) — CLOSED

Plan 06 Task 3 no longer contains a fallback migration block. The action now explicitly states Plan 01 owns slot 9 unconditionally and the frontend only calls `supabase.rpc('create_ticket_with_first_message', ...)`. CLOSED.

---

## NEW BLOCKER INTRODUCED BY ITER-2 FIX

**B-01 [task_completeness] Priority enum mismatch in Plan 01 Task 5 inline SQL**

The RPC body in Plan 01 Task 5 validates: `if p_priority not in ('p1','p2','p3','p4')`. The schema CHECK (Task 1) is `priority in ('p1','p2','p3')`. The RPC will pass `'p4'` to the INSERT and the DB will throw a CHECK constraint violation at runtime. The allowed set must be `('p1','p2','p3')` — identical to the schema enum.

- Plan: 37-01
- Task: 5
- Severity: BLOCKER
- Fix: Change `not in ('p1','p2','p3','p4')` to `not in ('p1','p2','p3')` in the inline RPC SQL.

---

## Migration Manifest — CONSISTENT

| Slot | File | Owning Plan |
|------|------|-------------|
| 1 | 20270707000001_helpdesk_schema.sql | 37-01 |
| 2 | 20270707000002_helpdesk_rls_policies.sql | 37-01 |
| 3 | 20270707000003_helpdesk_secdef_rpcs.sql | 37-01 |
| 4 | 20270707000004_helpdesk_seed_macros.sql | 37-01 |
| 5 | 20270707000005_helpdesk_fts_index.sql | 37-02 |
| 6 | 20270707000006_helpdesk_search_kb_fn.sql | 37-02 |
| 7 | 20270707000007_helpdesk_pg_cron.sql | 37-02 |
| 8 | 20270707000008_helpdesk_sla_breach_state.sql | 37-05 |
| 9 | 20270707000009_helpdesk_create_ticket_rpc.sql | 37-01 |
| 10 | 20270707000010_helpdesk_admin_rpcs.sql | 37-08 |

No collisions. No gaps. 10 migrations across 4 plans.

---

## Carried Warnings (unchanged from iter-2)

- W-05: Plan 06 scope 20 files / 4 tasks — deliberate, accepted.
- W-06: Plan 05 `try_record_sla_breach` shared-file choreography — same plan, lower risk.
- W-10: D-09 macro suggestions partial — accepted.

---

## Verdict

**BLOCKERS: 1** (priority enum `'p4'` in Task 5 RPC must be removed — one-line fix)
**WARNINGS: 3** (carried, deliberate)
**READY FOR EXECUTE: NO** — fix B-01 then execute without re-verify.
