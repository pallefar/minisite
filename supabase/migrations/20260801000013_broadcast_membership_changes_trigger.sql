-- Phase 9 Plan 09-01 — broadcast trigger on memberships INSERT/UPDATE/DELETE.
--
-- D-10 Layer 1 — Realtime broadcast as the UX overlay. On every
-- memberships row change, fire realtime.broadcast_changes() to BOTH:
--   - 'org:<org_id>'  — operator's roster subscribes here
--   - 'user:<user_id>' — patient's Active-orgs tab subscribes here
--
-- realtime.broadcast_changes() takes the trigger context (tg_op,
-- tg_table_name, tg_table_schema, NEW, OLD) and fans out a message to
-- the named topic. The realtime.messages RLS (20260801000012) authorizes
-- subscribers per topic prefix.

create or replace function public.broadcast_membership_changes()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_record record;
begin
  v_record := coalesce(new, old);

  -- Org-scoped topic — operator surface.
  perform realtime.broadcast_changes(
    'org:' || v_record.org_id::text,
    tg_op,
    tg_op,
    tg_table_name,
    tg_table_schema,
    new,
    old
  );

  -- User-scoped topic — patient surface.
  perform realtime.broadcast_changes(
    'user:' || v_record.user_id::text,
    tg_op,
    tg_op,
    tg_table_name,
    tg_table_schema,
    new,
    old
  );

  return null;
end;
$$;

drop trigger if exists memberships_broadcast_trigger on public.memberships;
create trigger memberships_broadcast_trigger
  after insert or update or delete on public.memberships
  for each row execute function public.broadcast_membership_changes();
