-- Phase 28 Plan 01 — Task 1 (migration 10/11)
-- link_org_patient SECDEF RPC.
-- Per CONTEXT D-17 + plan Task 1 action item 10.
--
-- security definer set search_path = pg_catalog, public, extensions
-- Pattern S1 dual-layer: caller must be admin or staff of p_org_id
-- Requires accepted org_consent_grants row for (p_org_id, p_patient_user_id)
-- Calls Phase 24 log_admin_action per T-28-01-05.

create or replace function public.link_org_patient(
  p_org_id            uuid,
  p_patient_user_id   uuid,
  p_consent_grant_id  uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_uid   uuid := auth.uid();
  v_link_id uuid;
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  -- Pattern S1: caller must be admin or staff of this org.
  if not exists (
    select 1 from public.org_members
    where org_id = p_org_id
      and user_id = v_uid
      and role in ('admin', 'staff')
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Verify consent grant exists, is for the right org+patient, and is not revoked.
  if not exists (
    select 1 from public.org_consent_grants
    where id = p_consent_grant_id
      and org_id = p_org_id
      and patient_user_id = p_patient_user_id
      and revoked_at is null
  ) then
    raise exception 'invalid_consent_grant' using errcode = 'P0002';
  end if;

  -- Insert the link row.
  insert into public.org_patient_links (org_id, patient_user_id, linked_by, consent_grant_id)
  values (p_org_id, p_patient_user_id, v_uid, p_consent_grant_id)
  returning id into v_link_id;

  -- Audit trail per T-28-01-05.
  perform public.log_admin_action(
    'org_patient_linked',
    p_org_id,
    jsonb_build_object(
      'link_id', v_link_id,
      'patient_user_id', p_patient_user_id,
      'consent_grant_id', p_consent_grant_id
    )
  );

  return jsonb_build_object('link_id', v_link_id);
end;
$$;

revoke all on function public.link_org_patient(uuid, uuid, uuid) from public;
grant execute on function public.link_org_patient(uuid, uuid, uuid) to authenticated;
