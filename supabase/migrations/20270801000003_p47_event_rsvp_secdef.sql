-- Phase 47-03 — SECDEF RPCs for RSVP + join-URL gate.
--
-- Implements D-02 (capacity invariant via SELECT FOR UPDATE),
-- D-05 (client status allow-list excludes 'waitlist' — server-assigned),
-- D-09 (join-URL gate by RSVP status), D-18 (15-min pre-window).
--
-- Memory references (load-bearing):
--   reference_postgres_no_insert_on_conflict_do_delete — branch INSERT … ON CONFLICT DO UPDATE.
--   feedback_rpc_auth_uid_vs_service_role_mismatch — uses auth.uid(); grant to authenticated only.
--   reference_supabase_migration_gotchas — SECDEF needs set search_path = public, extensions.
--   reference_supabase_is_staff_helper — canonical staff guard public.is_staff().
--   feedback_negation_grep_defeated_by_comment_string — rejected alt names kept out of file.

begin;

-- Pre-create event_rsvps table (idempotent) so functions below can reference the type.
-- Full schema (indexes + RLS) ships in 20270801000007_p47_event_rsvps_schema.sql.
-- This CREATE TABLE IF NOT EXISTS is a no-op when that migration runs later.
create table if not exists public.event_rsvps (
  id                uuid        primary key default gen_random_uuid(),
  event_id          uuid        not null references public.events(id) on delete cascade,
  user_id           uuid        not null references auth.users(id) on delete cascade,
  status            text        not null check (status in ('going','maybe','not_going','waitlist')),
  waitlist_position integer,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint event_rsvps_unique unique (event_id, user_id),
  constraint event_rsvps_waitlist_pos_chk
    check ((status = 'waitlist' and waitlist_position is not null)
        or (status <> 'waitlist' and waitlist_position is null))
);

----------------------------------------------------------------------
-- event_rsvp_create — user-initiated RSVP write under SELECT FOR UPDATE.
----------------------------------------------------------------------

create or replace function public.event_rsvp_create(
  p_event_id uuid,
  p_status text  -- one of 'going','maybe','not_going'
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_user_id           uuid := auth.uid();
  v_event             public.events%rowtype;
  v_going_count       integer;
  v_assigned_status   text;
  v_waitlist_position integer;
begin
  if v_user_id is null then
    raise exception 'auth required' using errcode = '42501';
  end if;
  if p_status not in ('going','maybe','not_going') then
    raise exception 'invalid status' using errcode = '22023';
  end if;

  -- Lock the events row for the duration of this transaction (D-02 capacity invariant).
  select * into v_event from public.events where id = p_event_id for update;
  if not found then
    raise exception 'event not found' using errcode = 'P0002';
  end if;

  -- Visibility check (inherited from community_spaces RLS — belt-and-braces).
  if not exists (
    select 1 from public.community_spaces s
     where s.id = v_event.space_id
       and public.can_see_community_space(s.id, v_user_id)
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Capacity check for 'going' requests only.
  if p_status = 'going' then
    select count(*) into v_going_count
      from public.event_rsvps
     where event_id = p_event_id
       and status = 'going'
       and user_id <> v_user_id;
    if v_event.capacity = 0 or v_going_count < v_event.capacity then
      v_assigned_status := 'going';
    else
      -- Waitlist branch — server-assigned (D-05): client cannot request 'waitlist' directly.
      v_assigned_status := 'waitlist';
      select coalesce(max(waitlist_position), 0) + 1 into v_waitlist_position
        from public.event_rsvps
       where event_id = p_event_id and status = 'waitlist';
    end if;
  else
    v_assigned_status := p_status;
  end if;

  -- Branch INSERT vs UPDATE (idempotent on UNIQUE(event_id, user_id)). No DO DELETE — does not exist in Postgres.
  insert into public.event_rsvps (event_id, user_id, status, waitlist_position)
    values (p_event_id, v_user_id, v_assigned_status, v_waitlist_position)
  on conflict (event_id, user_id) do update
    set status            = excluded.status,
        waitlist_position = excluded.waitlist_position,
        updated_at        = now();

  return jsonb_build_object(
    'status',            v_assigned_status,
    'waitlist_position', v_waitlist_position
  );
end;
$fn$;

revoke all on function public.event_rsvp_create(uuid, text) from public;
grant execute on function public.event_rsvp_create(uuid, text) to authenticated;

comment on function public.event_rsvp_create(uuid, text) is
  'P47 D-02/D-05: user-initiated RSVP write; SELECT FOR UPDATE on events row enforces capacity invariant; idempotent on UNIQUE(event_id, user_id); server assigns waitlist status when capacity exhausted. Caller MUST be authenticated user (auth.uid()); not callable from service-role per memory feedback_rpc_auth_uid_vs_service_role_mismatch.';

----------------------------------------------------------------------
-- event_get_join_url — read-only gated join-URL fetch (D-09 + D-18).
----------------------------------------------------------------------

create or replace function public.event_get_join_url(p_event_id uuid) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_user_id uuid := auth.uid();
  v_event   public.events%rowtype;
  v_rsvp    public.event_rsvps%rowtype;
begin
  if v_user_id is null then
    raise exception 'auth required' using errcode = '42501';
  end if;

  select * into v_event from public.events where id = p_event_id;
  if not found then
    raise exception 'event not found' using errcode = 'P0002';
  end if;

  -- Admin bypass: event creator OR staff can preview anytime (D-09 carve-out).
  if v_event.created_by = v_user_id or public.is_staff() then
    return jsonb_build_object('url', v_event.join_url);
  end if;

  -- 15-min pre-window (D-18).
  if now() < v_event.start_at - interval '15 minutes' then
    return jsonb_build_object(
      'error',    'too_early',
      'opens_at', to_char(v_event.start_at - interval '15 minutes', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    );
  end if;
  if now() > v_event.end_at then
    return jsonb_build_object('error', 'event_ended');
  end if;

  -- RSVP=going gate (D-09).
  select * into v_rsvp
    from public.event_rsvps
   where event_id = p_event_id and user_id = v_user_id;
  if not found or v_rsvp.status <> 'going' then
    return jsonb_build_object('error', 'rsvp_required');
  end if;

  return jsonb_build_object('url', v_event.join_url);
end;
$fn$;

revoke all on function public.event_get_join_url(uuid) from public;
grant execute on function public.event_get_join_url(uuid) to authenticated;

comment on function public.event_get_join_url(uuid) is
  'P47 D-09/D-18: returns events.join_url only when caller has rsvp_status=going AND now() within [start_at-15min, end_at]; creator/staff bypass. Caller MUST be authenticated; auth.uid() body requires user JWT.';

commit;
