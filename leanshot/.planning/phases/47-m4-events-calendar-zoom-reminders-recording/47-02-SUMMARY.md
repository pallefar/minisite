---
phase: 47-m4-events-calendar-zoom-reminders-recording
plan: 02
subsystem: events
tags: [events, rsvp, capacity, waitlist, rls, schema]
status: complete
requires:
  - 47-01 (events table — FK target for event_rsvps.event_id)
provides:
  - event_rsvps table (UNIQUE(event_id, user_id) — idempotency key for SECDEF RPC)
  - status text CHECK ('going','maybe','not_going','waitlist') (D-05)
  - waitlist_position NULLABLE column + paired CHECK (event_rsvps_waitlist_pos_chk)
  - 4 RLS policies (self + public.is_staff() bypass) for defense-in-depth
  - indexes (event_id, status) and partial (event_id, waitlist_position) WHERE status='waitlist'
affects:
  - 47-03 (event_rsvp_create SECDEF RPC + promote_waitlist_on_rsvp_change AFTER trigger — writes here)
  - 47-05 (cron + 14 RED test scaffolds — supabase/functions/__tests__/event_rsvp_create.test.ts targets this table)
tech_stack:
  added: []
  patterns:
    - "Phase 44 community_reactions UNIQUE-driven idempotent toggle (reused for event_rsvps)"
    - "public.is_staff() RLS guard (reference_supabase_is_staff_helper)"
    - "Partial index with IMMUTABLE string-literal predicate (reference_supabase_migration_gotchas)"
key_files:
  created:
    - supabase/migrations/20270801000007_p47_event_rsvps_schema.sql
  modified: []
decisions:
  - "Implements D-02 (one RSVP per (event, user); UNIQUE drives RPC idempotency)"
  - "Implements D-05 (status CHECK + waitlist_position paired with status='waitlist')"
  - "RLS ships now even though SECDEF RPC bypasses it (defense-in-depth vs direct PostgREST INSERT)"
  - "Migration slot 000007 chosen (Wave 0 gaps: 000003-000004 also free; picked 000007 per plan frontmatter)"
metrics:
  duration: ~10min
  completed: 2026-05-24
  tasks_completed: 1
  files_created: 1
  files_modified: 0
---

# Phase 47 Plan 02: event_rsvps Schema Summary

Ships the `public.event_rsvps` table with the `UNIQUE(event_id, user_id)` constraint that anchors the entire RSVP flow (idempotent toggle in 47-03, capacity invariant via `count(*) WHERE status='going'`, waitlist promotion via AFTER trigger), plus the `status` CHECK and paired `waitlist_position` constraint that lock down the state machine before any RPC is wired.

## What Shipped

- **`supabase/migrations/20270801000007_p47_event_rsvps_schema.sql`** — 104 lines, single migration wrapped in `begin; … commit;`.
  - Table `public.event_rsvps` with columns: `id`, `event_id`, `user_id`, `status`, `waitlist_position`, `created_at`, `updated_at`.
  - `UNIQUE(event_id, user_id)` — the idempotency key for `event_rsvp_create` (47-03).
  - `CHECK (status in ('going','maybe','not_going','waitlist'))` — D-05.
  - Paired CHECK: `waitlist_position` non-null iff `status='waitlist'`.
  - FK to `public.events(id)` and `auth.users(id)` both `on delete cascade`.
  - Two indexes: `(event_id, status)` for capacity counts; partial `(event_id, waitlist_position) WHERE status='waitlist'` for trigger ORDER BY (predicate IMMUTABLE per `reference_supabase_migration_gotchas`).
  - 4 RLS policies (SELECT/INSERT/UPDATE/DELETE) — self-only (`user_id = auth.uid()`) with `public.is_staff()` bypass for admin attendee management.

## Acceptance Criteria — All PASS

| Check | Expected | Actual |
| ----- | -------- | ------ |
| Filename `^[0-9]{14}_.*\.sql$` | match | PASS |
| `unique (event_id, user_id)` (non-comment) | 1 | 1 |
| `check (status in ('going','maybe','not_going','waitlist'))` (non-comment) | 1 | 1 |
| `enable row level security` (non-comment) | 1 | 1 |
| `staff_users` references (non-comment) | 0 | 0 |
| `create table if not exists public.event_rsvps` | 1 | 1 |
| `public.is_staff()` references | ≥1 | 4 |
| FK `references public.events(id) on delete cascade` | 1 | 1 |
| FK `references auth.users(id) on delete cascade` | 1 | 1 |
| `create policy event_rsvps_*` | 4 | 4 |

## Threat Mitigations (from plan threat_model)

- **T-47-06 (client writes `status='waitlist'` directly):** Defense-in-depth via `event_rsvps_insert_self` policy + SECDEF RPC (47-03) as the only client callsite shipped in 47-10. Table-level `status` CHECK accepts 'waitlist' (server-write path) but client code does not bypass the RPC.
- **T-47-07 (non-self RSVP forgery):** RLS `with check (user_id = auth.uid())` on INSERT.
- **T-47-08 (non-staff cancels another user's RSVP):** RLS DELETE `using (user_id = auth.uid() or public.is_staff())`.

## Deviations from Plan

None — plan executed exactly as written. Migration slot 000007 chosen per plan frontmatter lock; all greps shaped per `<acceptance_criteria>`.

## Commits

| Task | Hash | Message |
| ---- | ---- | ------- |
| 1 | `ec44893d` | feat(47-02): event_rsvps table + UNIQUE(event_id, user_id) + status CHECK + RLS |

## Downstream Dependencies (next plans)

- **47-03** — `event_rsvp_create` SECDEF RPC + `promote_waitlist_on_rsvp_change` AFTER trigger; both write to `public.event_rsvps`. UNIQUE constraint is what makes the RPC idempotent via `SELECT FOR UPDATE` + branch INSERT/DELETE (per `reference_postgres_no_insert_on_conflict_do_delete`).
- **47-05** — Wave 0 RED test scaffolds (`supabase/functions/__tests__/event_rsvp_create.test.ts`) target this table; GREEN expected in Wave 3 after `supabase db push --linked`.

## Self-Check: PASSED

- File exists: `supabase/migrations/20270801000007_p47_event_rsvps_schema.sql` — FOUND.
- Commit exists: `ec44893d` — FOUND in worktree HEAD.
