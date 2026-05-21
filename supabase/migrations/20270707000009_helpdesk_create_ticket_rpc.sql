-- Phase 37 Plan 01 Task 5 — create_ticket_with_first_message RPC
-- Signature consumed by Plan 06 TicketForm:
--   rpc('create_ticket_with_first_message', { p_subject, p_body, p_priority })
--
-- Per CONTEXT D-01: PHI flag is derived SERVER-SIDE from caller's org_members.role.
-- NEVER trust a client-supplied phi value.
-- Per [[reference_supabase_migration_gotchas]]: search_path pinned; revoke from public + anon.

begin;

create or replace function public.create_ticket_with_first_message(
  p_subject text,
  p_body text,
  p_priority text default 'p3'
) returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_user_id uuid := auth.uid();
  v_org_id uuid;
  v_is_clinician boolean := false;
  v_phi boolean;
  v_ticket_id uuid;
begin
  if v_user_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;
  if p_subject is null or length(trim(p_subject)) = 0 or length(p_subject) > 200 then
    raise exception 'invalid_subject' using errcode = '22023';
  end if;
  if p_body is null or length(trim(p_body)) = 0 then
    raise exception 'invalid_body' using errcode = '22023';
  end if;
  if p_priority not in ('p1','p2','p3') then
    raise exception 'invalid_priority' using errcode = '22023';
  end if;

  -- Resolve primary org (D-01)
  select primary_org_id into v_org_id from public.profiles where id = v_user_id;
  if v_org_id is null then
    raise exception 'no_primary_org' using errcode = '42704';
  end if;

  -- Derive PHI flag from caller's role in the primary org.
  -- Clinician roles (owner / clinician / staff) → ticket is PHI by default.
  select exists (
    select 1 from public.org_members om
    where om.user_id = v_user_id
      and om.org_id = v_org_id
      and om.role in ('owner','clinician','staff')
  ) into v_is_clinician;
  v_phi := v_is_clinician;

  insert into public.tickets (user_id, org_id, subject, priority, phi, status, source)
    values (v_user_id, v_org_id, p_subject, p_priority, v_phi, 'open', 'widget')
    returning id into v_ticket_id;

  insert into public.ticket_messages (ticket_id, author_user_id, body, author_kind, via)
    values (v_ticket_id, v_user_id, p_body, 'user', 'widget');

  return v_ticket_id;
end;
$fn$;

revoke execute on function public.create_ticket_with_first_message(text, text, text) from public, anon;
grant execute on function public.create_ticket_with_first_message(text, text, text) to authenticated;

commit;
