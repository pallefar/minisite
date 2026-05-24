-- Phase 47-03 — Waitlist FIFO promotion trigger.
--
-- Implements D-03: when a 'going' slot vacates (UPDATE going->non-going OR DELETE of going),
-- promote head of waitlist using FOR UPDATE SKIP LOCKED so concurrent cancels do not
-- double-promote a single seat.
--
-- Memory references (load-bearing):
--   reference_supabase_migration_gotchas — SECDEF needs set search_path = public, extensions.
--   reference_postgres_dollar_quote_nesting_in_cron_body — standalone file (no cron nesting),
--     single $fn$ tag is safe.
--   feedback_rpc_auth_uid_vs_service_role_mismatch — fires under multiple roles; MUST NOT
--     reference auth.uid() in body.

begin;

create or replace function public.promote_waitlist_on_rsvp_change()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_event_id     uuid;
  v_capacity     integer;
  v_going_count  integer;
  v_head_user_id uuid;
  v_head_rsvp_id uuid;
begin
  -- IMPORTANT: this SECDEF trigger fn must NOT reference auth.uid() — fires under multiple
  -- roles (user INSERT/UPDATE/DELETE on event_rsvps, plus service-role drain on
  -- event_promotion_queue). Per memory feedback_rpc_auth_uid_vs_service_role_mismatch.

  -- Determine which event was affected.
  v_event_id := coalesce(old.event_id, new.event_id);

  -- Only promote when a 'going' slot was vacated.
  if tg_op = 'UPDATE' then
    if old.status = 'going' and new.status <> 'going' then
      null;  -- proceed
    else
      return coalesce(new, old);
    end if;
  elsif tg_op = 'DELETE' then
    if old.status <> 'going' then
      return old;  -- non-going row deleted: nothing to promote
    end if;
  end if;

  -- Read capacity (lock event row briefly).
  select capacity into v_capacity from public.events where id = v_event_id for update;
  select count(*) into v_going_count
    from public.event_rsvps
   where event_id = v_event_id and status = 'going';

  -- Defensive capacity guard: handles capacity=0 (unlimited) correctly, AND guards against
  -- cascading triggers firing before the row count settles.
  if v_capacity <> 0 and v_going_count >= v_capacity then
    return coalesce(new, old);
  end if;

  -- Promote head of waitlist. FOR UPDATE SKIP LOCKED: concurrent triggers skip the row this
  -- one locks → eliminates double-promotion under concurrent cancellations (D-03 + Pitfall 5).
  select id, user_id
    into v_head_rsvp_id, v_head_user_id
    from public.event_rsvps
   where event_id = v_event_id and status = 'waitlist'
   order by waitlist_position asc nulls last
   limit 1
   for update skip locked;

  if v_head_rsvp_id is not null then
    update public.event_rsvps
       set status            = 'going',
           waitlist_position = null,
           updated_at        = now()
     where id = v_head_rsvp_id;

    -- Idempotent enqueue for fan-out notify; UNIQUE(event_id, user_id) on the queue table
    -- absorbs the defensive double-insert if a sibling trigger raced past the SKIP LOCKED.
    insert into public.event_promotion_queue (event_id, user_id, promoted_at)
      values (v_event_id, v_head_user_id, now())
    on conflict (event_id, user_id) do nothing;
  end if;

  return coalesce(new, old);
end;
$fn$;

comment on function public.promote_waitlist_on_rsvp_change() is
  'P47 D-03: AFTER UPDATE/DELETE trigger on event_rsvps; promotes head-of-waitlist via FOR UPDATE SKIP LOCKED when a going slot vacates; enqueues event_promotion_queue row for fan-out notify.';

drop trigger if exists trg_promote_waitlist_on_rsvp_change on public.event_rsvps;
create trigger trg_promote_waitlist_on_rsvp_change
  after update or delete on public.event_rsvps
  for each row
  execute function public.promote_waitlist_on_rsvp_change();

commit;
