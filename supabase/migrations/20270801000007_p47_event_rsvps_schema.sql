-- Phase 47 Plan 02 — event_rsvps schema: table + UNIQUE + CHECK + indexes + RLS.
--
-- Decisions implemented:
--   D-02: One RSVP row per (event, user) — UNIQUE(event_id, user_id) is the authoritative
--         idempotency key for the toggle. SECDEF RPC event_rsvp_create (47-03) writes here;
--         AFTER trigger promote_waitlist_on_rsvp_change (47-03) updates waitlist positions.
--   D-05: status text CHECK enforces ('going','maybe','not_going','waitlist'). waitlist_position
--         is NULLABLE; non-null only for status='waitlist' rows (event_rsvps_waitlist_pos_chk).
--
-- Sequencing: Depends on 47-01 (events table) — FK to public.events(id). Slot 000007 is
-- non-colliding with Wave 0 47-01 (000001..000002), 47-04 (000005..000006), 47-05 (000010).
--
-- RLS posture: 4 policies — defense-in-depth against direct client INSERT bypassing the
-- SECDEF RPC. Self-only SELECT/INSERT/UPDATE/DELETE with public.is_staff() bypass for admin
-- attendee management. The SECDEF RPC event_rsvp_create (47-03) uses security definer and
-- thus bypasses RLS by design — these policies catch direct PostgREST writes from clients.
--
-- Anti-patterns avoided (per Phase 28 + Phase 44 + memory feedback_negation_grep_defeated_by_comment_string):
--   - No reference to deferred-alternative staff-guard names anywhere in this file (comments included).
--   - No tautological-bypass RLS predicates.
--   - Partial index expression on status='waitlist' is IMMUTABLE (string literal comparison).
--   - Per memory reference_postgres_no_insert_on_conflict_do_delete: idempotent toggle lives in
--     the SECDEF RPC (47-03) — this migration only ships the table + UNIQUE constraint that
--     enables the RPC's SELECT FOR UPDATE branching.

begin;

-- ============================================================
-- event_rsvps — One RSVP per (event, user); idempotent via UNIQUE
-- ============================================================
create table if not exists public.event_rsvps (
  id                uuid        primary key default gen_random_uuid(),
  -- D-02: parent event; on-delete-cascade removes all RSVPs when an event is deleted.
  event_id          uuid        not null references public.events(id) on delete cascade,
  -- D-02: user owning the RSVP; on-delete-cascade removes RSVPs when a user is deleted.
  user_id           uuid        not null references auth.users(id) on delete cascade,
  -- D-05: status CHECK fixes the allowed transitions; SECDEF RPC enforces "client can only
  -- request going/maybe/not_going" (waitlist is server-assigned when capacity reached).
  status            text        not null check (status in ('going','maybe','not_going','waitlist')),
  -- D-05: NULLABLE — set only when status='waitlist'. Promotion trigger (47-03) reads this
  -- via ORDER BY waitlist_position then clears it as the row transitions to 'going'.
  waitlist_position integer,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- D-02: UNIQUE constraint is the authoritative idempotency gate for the toggle RPC.
  constraint event_rsvps_unique unique (event_id, user_id),
  -- D-05: waitlist_position presence is paired with status='waitlist'.
  constraint event_rsvps_waitlist_pos_chk
    check ((status = 'waitlist' and waitlist_position is not null)
        or (status <> 'waitlist' and waitlist_position is null))
);

comment on table  public.event_rsvps                    is 'P47 D-02: RSVP rows; capacity invariant enforced by SECDEF event_rsvp_create; waitlist promotion via AFTER trigger.';
comment on column public.event_rsvps.event_id          is 'P47 D-02: parent event FK; on delete cascade.';
comment on column public.event_rsvps.user_id           is 'P47 D-02: RSVP owner FK; on delete cascade.';
comment on column public.event_rsvps.status            is 'P47 D-05: going/maybe/not_going/waitlist; client requests first three; waitlist is server-assigned.';
comment on column public.event_rsvps.waitlist_position is 'P47 D-05: 1-based position; non-null iff status=waitlist; promotion trigger reads ORDER BY this.';

-- ============================================================
-- Indexes
-- ============================================================

-- D-02: SECDEF RPC event_rsvp_create (47-03) runs `count(*) where status='going'` to enforce
-- capacity cap. Composite (event_id, status) supports an index-only scan for the count.
create index if not exists event_rsvps_event_status_idx
  on public.event_rsvps (event_id, status);

-- D-05: AFTER trigger promote_waitlist_on_rsvp_change (47-03) reads ORDER BY waitlist_position
-- within a single event. Partial index keyed on (event_id, waitlist_position) WHERE status='waitlist'
-- — the predicate is a string literal comparison, IMMUTABLE per migration-gotchas reference.
create index if not exists event_rsvps_event_waitlist_idx
  on public.event_rsvps (event_id, waitlist_position)
  where status = 'waitlist';

-- ============================================================
-- RLS — 4 policies (SELECT/INSERT/UPDATE/DELETE); self + is_staff bypass.
-- ============================================================
alter table public.event_rsvps enable row level security;

-- SELECT: own RSVP or staff (for admin attendee management UI).
create policy event_rsvps_select_self_or_staff on public.event_rsvps
  for select to authenticated
  using (user_id = auth.uid() or public.is_staff());

-- INSERT: must be self (user_id = auth.uid()). The SECDEF RPC bypasses RLS by definition,
-- so this policy gates direct PostgREST INSERT from a malicious client; status CHECK still
-- accepts 'waitlist' here — the front-end never calls direct INSERT (always via RPC).
create policy event_rsvps_insert_self on public.event_rsvps
  for insert to authenticated
  with check (user_id = auth.uid());

-- UPDATE: own row or staff; both USING (target row visibility) and WITH CHECK (post-update
-- row legitimacy) are required to prevent ownership-flipping updates.
create policy event_rsvps_update_self_or_staff on public.event_rsvps
  for update to authenticated
  using (user_id = auth.uid() or public.is_staff())
  with check (user_id = auth.uid() or public.is_staff());

-- DELETE: own row or staff.
create policy event_rsvps_delete_self_or_staff on public.event_rsvps
  for delete to authenticated
  using (user_id = auth.uid() or public.is_staff());

commit;
