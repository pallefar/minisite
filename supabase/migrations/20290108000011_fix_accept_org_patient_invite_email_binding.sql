-- ---------------------------------------------------------------------------
-- SECURITY FIX: accept_org_patient_invite must bind the invite ONLY to the
-- account whose email matches the invite's bound patient_email.
--
-- Bug (release-readiness review #10, HIGH/security): the RPC is granted to
-- `authenticated` (directly callable, bypassing the clinic-patient-invite Edge
-- Function) and never checked that p_patient_user_id's email equals the
-- invite's patient_email. Any authenticated user could call it with a valid
-- invite token + their OWN user id and hijack the clinic relationship +
-- org_consent_grants bound to someone else's invite.
--
-- Fix: fetch the invite's patient_email, look up the accepting user's email
-- from auth.users, and raise 'invite email mismatch' (42501) when they differ.
-- The Edge Function adds a parallel pre-check (defense-in-depth) but THIS is the
-- authoritative boundary because the RPC is client-callable.
--
-- Idempotent CREATE OR REPLACE; behavior is otherwise identical to
-- 20270601200004_org_patient_invite_rpcs.sql.
-- ---------------------------------------------------------------------------

create or replace function public.accept_org_patient_invite(
  p_invite_token_hash text,
  p_patient_user_id   uuid
) returns table(org_id uuid, status text)
  language plpgsql
  security definer
  set search_path = pg_catalog, public, extensions
as $$
declare
  v_invite            record;
  v_consent_grant_id  uuid;
  v_user_id_hash      text;
  v_accepting_email   text;
begin
  -- a. Validate invite: must be pending (not accepted) and not expired.
  --    Also pull patient_email for the identity-binding check below.
  select i.id, i.org_id, i.consent_scope, i.invited_by, i.patient_email
  into v_invite
  from public.org_patient_invites i
  where i.invite_token_hash = p_invite_token_hash
    and i.accepted_at is null
    and i.expires_at > now();

  if not found then
    raise exception 'invite not found' using errcode = 'P0002';
  end if;

  -- a2. SECURITY: the accepting account's email MUST match the invite's bound
  -- patient_email. Without this, a holder of a valid token could bind the org
  -- relationship + consent grants to an arbitrary account. Compare
  -- case-insensitively against auth.users.email (SECDEF owner can read auth).
  select lower(u.email) into v_accepting_email
  from auth.users u
  where u.id = p_patient_user_id;

  if v_accepting_email is null
     or v_accepting_email is distinct from lower(v_invite.patient_email) then
    raise exception 'invite email mismatch' using errcode = '42501';
  end if;

  -- b. Set profiles.primary_org_id (per D-09)
  update public.profiles
  set primary_org_id = v_invite.org_id
  where id = p_patient_user_id;

  -- c. Insert org_consent_grants row
  insert into public.org_consent_grants(
    org_id, patient_user_id, scope, granted_at, granted_via
  )
  values(
    v_invite.org_id, p_patient_user_id, v_invite.consent_scope, now(), 'invite'
  )
  returning id into v_consent_grant_id;

  -- d. Insert org_patient_links row
  insert into public.org_patient_links(
    org_id, patient_user_id, linked_by, linked_at, consent_grant_id
  )
  values(
    v_invite.org_id, p_patient_user_id, v_invite.invited_by, now(), v_consent_grant_id
  );

  -- e. Mark invite as accepted
  update public.org_patient_invites
  set accepted_at = now()
  where id = v_invite.id;

  -- f. Audit log (direct insert — bypasses log_admin_action platform-admin check)
  v_user_id_hash := encode(
    extensions.digest(coalesce(p_patient_user_id::text, 'accept_org_patient_invite'), 'sha256'),
    'hex'
  );
  insert into public.audit_logs(
    user_id_hash, table_name, action,
    user_id, actor_user_id, action_name, row_pk, after_data, source
  ) values (
    v_user_id_hash, 'org_patient_invites', 'update',
    p_patient_user_id, p_patient_user_id,
    'accept_org_patient_invite', v_invite.id::text,
    jsonb_build_object(
      'patient_user_id', p_patient_user_id,
      'org_id', v_invite.org_id
    ),
    'rpc'
  );

  return query select v_invite.org_id, 'accepted'::text;
end;
$$;

revoke all on function public.accept_org_patient_invite(text, uuid) from public;
grant execute on function public.accept_org_patient_invite(text, uuid) to authenticated;
