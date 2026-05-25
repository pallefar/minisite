---
phase: 47-m4-events-calendar-zoom-reminders-recording
plan: 03
subsystem: events
tags: [supabase, secdef, rls, postgres, triggers, waitlist, idempotency]
requires:
  - 47-01 (events table — public.events.{id,space_id,start_at,end_at,capacity,join_url,created_by})
  - 47-02 (event_rsvps table — UNIQUE(event_id,user_id), status enum, waitlist_position)
  - public.is_staff()        # canonical staff guard (memory reference_supabase_is_staff_helper)
  - public.can_see_community_space(uuid, uuid)  # Phase 44 visibility helper
provides:
  - public.event_rsvp_create(uuid, text) -> jsonb           # SECDEF, authenticated-only
  - public.event_get_join_url(uuid) -> jsonb                # SECDEF, authenticated-only
  - public.promote_waitlist_on_rsvp_change() -> trigger     # SECDEF, no caller grant
  - public.trg_promote_waitlist_on_rsvp_change              # AFTER UPDATE OR DELETE on event_rsvps
  - public.event_reminder_sent                              # idempotent dedup table
  - public.event_promotion_queue                            # drain-once fan-out queue
affects:
  - public.event_rsvps   # trigger fires on UPDATE/DELETE
tech-stack:
  added:
    - postgres advisory lock pattern (SELECT FOR UPDATE on events row for capacity invariant)
    - FOR UPDATE SKIP LOCKED head-of-queue pattern for waitlist FIFO promotion
  patterns:
    - SECDEF + set search_path = public, extensions (per reference_supabase_migration_gotchas)
    - INSERT … ON CONFLICT (…) DO UPDATE branch (idempotent upsert; never DO DELETE — does not exist in Postgres)
    - RLS-enabled tables with NO public policies → service-role-only access
    - partial index on `WHERE drained_at IS NULL` for hot fan-out scan
key-files:
  created:
    - supabase/migrations/20270801000003_p47_event_rsvp_secdef.sql
    - supabase/migrations/20270801000004_p47_waitlist_promotion_trigger.sql
    - supabase/migrations/20270801000008_p47_event_reminder_sent_and_queue.sql
  modified: []
decisions:
  - "event_rsvp_create granted to authenticated only — auth.uid() body requires user JWT; service-role caller (Edge cron) cannot use this RPC. Per memory feedback_rpc_auth_uid_vs_service_role_mismatch. Documented in function comment + threat register T-47-14 (accept)."
  - "Waitlist promotion uses FOR UPDATE SKIP LOCKED on head-of-queue SELECT. Concurrent cancellations race to lock the same waitlist row; SKIP LOCKED guarantees at most one promoter wins per slot — eliminates double-promotion (T-47-11)."
  - "promote_waitlist_on_rsvp_change() trigger body MUST NOT reference auth.uid() — it fires under user context (RSVP cancel) AND service-role drain context (queue cleanup). Inline IMPORTANT comment in function body enforces this for future edits."
  - "event_promotion_queue INSERT uses ON CONFLICT (event_id, user_id) DO NOTHING — defensive against cascading trigger fires where the SKIP-LOCKED guarantee gets violated by an unforeseen race; UNIQUE constraint is the authoritative dedup."
  - "Both tracking tables (event_reminder_sent, event_promotion_queue) ship with RLS enabled but ZERO policies — net effect: authenticated callers cannot SELECT/INSERT/UPDATE/DELETE; only service_role bypasses RLS for fan-out writes."
  - "event_get_join_url returns structured JSON for non-success cases ({error:'too_early',opens_at}, {error:'event_ended'}, {error:'rsvp_required'}) rather than raising — UI can render specific friendly messaging without a try/catch fork per error code."
  - "Migration timestamps 000003, 000004, 000008 — chosen to slot cleanly into Phase 47's existing 000001/000002 (47-01), 000005/000006 (47-04), 000007 (47-02), 000010 (47-05) sequence with room to grow at 000009 for un-scheduled fixes."
metrics:
  duration_sec: 158
  duration_min: 3
  tasks_completed: 3
  files_created: 3
  files_modified: 0
  completed_date: 2026-05-24
---

# Phase 47 Plan 03: Capacity/Waitlist Invariant + Join-URL Gate Summary

3 SECDEF SQL migrations owning the events atomic-invariant kernel: `event_rsvp_create` (capacity check via SELECT FOR UPDATE), `event_get_join_url` (15-min pre-window + RSVP gate), `promote_waitlist_on_rsvp_change()` AFTER trigger (FOR UPDATE SKIP LOCKED FIFO promotion), and the `event_reminder_sent` + `event_promotion_queue` tracking tables.

## What Was Built

### Task 1 — `event_rsvp_create` + `event_get_join_url` SECDEF RPCs
**Commit:** `88dac405`  
**File:** `supabase/migrations/20270801000003_p47_event_rsvp_secdef.sql`

- `event_rsvp_create(p_event_id uuid, p_status text)` returns `jsonb` `{status, waitlist_position}`.
  - Raises `42501` if `auth.uid()` is NULL.
  - Raises `22023` if `p_status NOT IN ('going','maybe','not_going')` (client cannot request 'waitlist' — server-assigned per D-05).
  - Raises `P0002` if event not found.
  - Locks the events row via `SELECT … FOR UPDATE` (capacity invariant T-47-09).
  - Visibility check via `public.can_see_community_space(space_id, user_id)` (Phase 44 helper) — belt-and-braces over RLS.
  - Capacity logic: `capacity=0` → unlimited 'going'; else `going_count<capacity` → 'going'; else 'waitlist' with `max(waitlist_position)+1`.
  - Idempotent upsert via `ON CONFLICT (event_id, user_id) DO UPDATE`.
- `event_get_join_url(p_event_id uuid)` returns `jsonb` `{url}` or `{error: <code>, ...}`:
  - Creator OR `public.is_staff()` bypasses all gates (preview anytime).
  - `now() < start_at - interval '15 minutes'` → `{error:'too_early', opens_at:<ISO>}` (D-18).
  - `now() > end_at` → `{error:'event_ended'}`.
  - No RSVP row OR `status<>'going'` → `{error:'rsvp_required'}` (D-09).
  - Otherwise returns `events.join_url`.
- Both: SECURITY DEFINER, `set search_path = public, extensions`, `revoke all from public`, `grant execute to authenticated` (never `service_role`).

### Task 2 — `promote_waitlist_on_rsvp_change` trigger fn + AFTER trigger
**Commit:** `28f277cf`  
**File:** `supabase/migrations/20270801000004_p47_waitlist_promotion_trigger.sql`

- Trigger fn `public.promote_waitlist_on_rsvp_change()` returns trigger.
  - UPDATE: promotes only when `OLD.status='going' AND NEW.status<>'going'`.
  - DELETE: promotes only when `OLD.status='going'`.
- Capacity guard: `v_capacity <> 0 AND v_going_count >= v_capacity` → return without promoting (handles unlimited correctly + defends against cascading-trigger race).
- Head-of-waitlist SELECT: `ORDER BY waitlist_position ASC NULLS LAST LIMIT 1 FOR UPDATE SKIP LOCKED` — D-03 + Pitfall 5; eliminates double-promotion under concurrent cancels (T-47-11).
- On promotion: UPDATE waitlist row to `status='going', waitlist_position=NULL`, INSERT `event_promotion_queue` row (`ON CONFLICT DO NOTHING`).
- Inline `-- IMPORTANT: this SECDEF trigger fn must NOT reference auth.uid() …` comment locks the no-auth-uid rule for future edits.
- `CREATE TRIGGER trg_promote_waitlist_on_rsvp_change AFTER UPDATE OR DELETE ON public.event_rsvps FOR EACH ROW`.
- `DROP TRIGGER IF EXISTS` first → idempotent re-apply.

### Task 3 — `event_reminder_sent` + `event_promotion_queue` tables
**Commit:** `ba9fb6a3`  
**File:** `supabase/migrations/20270801000008_p47_event_reminder_sent_and_queue.sql`

- `event_reminder_sent`: `(id uuid PK, event_id uuid FK events CASCADE, user_id uuid FK auth.users CASCADE, kind text CHECK in ('1d','1h','promotion'), sent_at timestamptz)` + `UNIQUE(event_id, user_id, kind)` (D-10 dedup key) + `(event_id)` index.
- `event_promotion_queue`: `(id uuid PK, event_id uuid FK events CASCADE, user_id uuid FK auth.users CASCADE, promoted_at timestamptz, drained_at timestamptz)` + `UNIQUE(event_id, user_id)` (D-03 drain-once) + partial index `(event_id, user_id) WHERE drained_at IS NULL` (fan-out hot path).
- Both: RLS enabled, NO public policies → authenticated callers blocked; service_role bypasses RLS for fan-out writes.

## Acceptance Criteria — All Gates Pass

| Gate | Expected | Actual |
|------|----------|--------|
| All 3 files exist | yes | yes |
| F1 `for update` (case-insensitive) | ≥1 | 2 |
| F1 `auth.uid()` | ≥2 | 4 |
| F1 `on conflict do delete` | 0 | 0 |
| F1 grant `event_rsvp_create(uuid, text) to authenticated` | 1 | 1 |
| F1 grant `event_rsvp_create … to service_role` | 0 | 0 |
| F2 `for update skip locked` (case-insensitive) | ≥1 | 3 |
| F3 `unique (event_id, user_id, kind)` | 1 | 1 |
| F3 `check (kind in ('1d','1h','promotion'))` | 1 | 1 (confirmed via direct grep) |
| All 3 files `begin; … commit;` | yes | yes |
| `staff_users` refs in any file | 0 | 0 |

## Decisions Made

See frontmatter `decisions:` block. The four load-bearing ones:

1. **`event_rsvp_create` is authenticated-only, never service_role** — per memory `feedback_rpc_auth_uid_vs_service_role_mismatch`; body uses `auth.uid()` which is NULL under service-role calls.
2. **`FOR UPDATE SKIP LOCKED` for head-of-waitlist** — eliminates double-promotion (T-47-11); locks the candidate row so concurrent triggers skip past it.
3. **Trigger fn body MUST NOT use `auth.uid()`** — fires under both user and service-role contexts; inline IMPORTANT comment enforces the rule for future maintainers.
4. **Tracking tables are RLS-enabled-with-zero-policies** — denies all authenticated access; service_role bypasses RLS by Supabase platform invariant; fan-out Fn (47-04) and drain Fn write under service_role.

## Deviations from Plan

None — plan executed exactly as written. All `<acceptance_criteria>` gates pass without modification. The single inline `-- IMPORTANT:` comment containing the substring `auth.uid()` in migration 04 is mandated by the plan `<action>` block; the verify block for that task does not grep for `auth.uid()`.

## Authentication Gates

None encountered. Pure migration-file authoring; no Supabase/Edge interaction.

## Deferred Issues

- **`supabase db push --linked`** — NOT executed per executor prompt instruction ("Do NOT run `supabase db push`"). Will be pushed at Phase 47 close-out via the standard wave flow.
- **Wave 0 RED tests** (`tests/integration/event-rsvp-capacity-race.test.ts`, `waitlist-fifo-promotion.test.ts`, `waitlist-concurrent-cancel.test.ts`) shipped by 47-05 will remain RED locally until `db push --linked` lands; GREEN in Wave 3 close-out.

## Known Stubs

None. All three migrations are production-shape.

## Threat Flags

None. All net-new surface (two SECDEF RPCs + one trigger + two service-role tables) is enumerated in the plan's `<threat_model>` (T-47-09..T-47-14) with `mitigate` dispositions that are implemented:

- T-47-09 (capacity race) → `SELECT FROM events WHERE id=p_event_id FOR UPDATE` in `event_rsvp_create`.
- T-47-10 (client requests 'waitlist') → `RAISE EXCEPTION USING ERRCODE = '22023'` if `p_status NOT IN ('going','maybe','not_going')`.
- T-47-11 (concurrent cancel double-promotion) → `FOR UPDATE SKIP LOCKED` on waitlist head SELECT.
- T-47-12 (non-RSVP'd user reads join_url) → `event_get_join_url` returns `{error:'rsvp_required'}` if `v_rsvp.status<>'going'`.
- T-47-13 (pre-event link-sharing) → `event_get_join_url` returns `{error:'too_early', opens_at:...}` when `now() < start_at - 15min`.
- T-47-14 (service_role calls event_rsvp_create) → accepted; mitigation is the `revoke all from public; grant execute to authenticated` line — service_role is not in the grant list.

## Commits

| Hash | Type | Description |
|------|------|-------------|
| `88dac405` | feat | event_rsvp_create + event_get_join_url SECDEF RPCs |
| `28f277cf` | feat | waitlist FIFO promotion trigger with FOR UPDATE SKIP LOCKED |
| `ba9fb6a3` | feat | event_reminder_sent + event_promotion_queue tables |

## Self-Check: PASSED

- `supabase/migrations/20270801000003_p47_event_rsvp_secdef.sql` FOUND
- `supabase/migrations/20270801000004_p47_waitlist_promotion_trigger.sql` FOUND
- `supabase/migrations/20270801000008_p47_event_reminder_sent_and_queue.sql` FOUND
- Commit `88dac405` FOUND in git log
- Commit `28f277cf` FOUND in git log
- Commit `ba9fb6a3` FOUND in git log
