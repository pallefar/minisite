-- Phase 29 Plan 02 — Task 2
-- Three SECDEF RPCs for the org_patient_invites patient-consent invite flow.
-- Per CONTEXT D-07, D-08 + 28-EXTENSION-CONTRACT §2b Pattern S1.
--
-- ALL RPCs: security definer set search_path = pg_catalog, public, extensions
--           (per [[reference_supabase_migration_gotchas]])
-- Write RPCs: insert directly into audit_logs (not via log_admin_action which
--   requires platform admin role — org admins cannot pass is_admin_at_least check).
--   Direct insert mirrors the Phase 7 column shape used by fn_audit_phi_trigger.
-- Pattern S1 dual-layer: DB-level role re-check inside each function body.
--
-- BREAKING NOTE (D-08 override per RESEARCH §Open Q3 RESOLVED):
--   accept_org_patient_invite commits steps a-e atomically (profiles + consent grants +
--   patient links + invite accepted_at). Magic-link generation via admin.generateLink is
--   Plan 29-05 Edge Function's responsibility — it CANNOT be inside PL/pgSQL (HTTP call
--   cannot participate in a Postgres transaction).
--
-- State machine for org_patient_invites.accepted_at (D-13):
--   NULL + expires_at > now()  → pending  : send_org_patient_invite
--   NULL + expires_at <= now() → expired  : pg_cron cleanup cron (P29 D-13, Plan 29-08)
--   NOT NULL                   → accepted : accept_org_patient_invite

-- =============================================================================
-- RPC 1: send_org_patient_invite
-- =============================================================================
-- Pattern S1: admin role re-check before insert.
-- W-1 anti-enumeration: inserts row REGARDLESS of whether p_patient_email exists
-- in auth.users — identical 200 shape for new vs existing email.
-- Trigger org_patient_invites_validate_scope_trigger fires BEFORE INSERT and validates
-- consent_scope via _validate_consent_scope — no explicit call needed here.
-- =============================================================================
create or replace function public.send_org_patient_invite(
  p_org_id            uuid,
  p_patient_email     text,
  p_consent_scope     jsonb,
  p_invite_token_hash text
) returns table(invite_id uuid, status text)
  language plpgsql
  security definer
  set search_path = pg_catalog, public, extensions
as $$
declare
  v_uid           uuid := auth.uid();
  v_role          public.org_member_role;
  v_invite_id     uuid;
  v_user_id_hash  text;
begin
  -- Unauthenticated guard
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  -- Pattern S1: DB-level admin role re-check
  select role into v_role
  from public.org_members
  where org_id = p_org_id and user_id = v_uid;

  if v_role is null or v_role <> 'admin' then
    raise exception 'admin role required' using errcode = '42501';
  end if;

  -- W-1 invariant: ALWAYS insert regardless of auth.users email existence.
  -- The trigger validates consent_scope shape before commit.
  insert into public.org_patient_invites(
    org_id, patient_email, invite_token_hash, consent_scope, invited_by
  )
  values(
    p_org_id, p_patient_email, p_invite_token_hash, p_consent_scope, v_uid
  )
  returning id into v_invite_id;

  -- Phase 24 audit trail: direct insert into audit_logs (bypasses log_admin_action's
  -- platform-admin check — SECDEF org admin RPCs write directly per Phase 7 pattern).
  v_user_id_hash := encode(
    extensions.digest(v_uid::text, 'sha256'), 'hex'
  );
  insert into public.audit_logs(
    user_id_hash, table_name, action,
    user_id, actor_user_id, action_name, row_pk, after_data, source
  ) values (
    v_user_id_hash, 'org_patient_invites', 'insert',
    v_uid, v_uid, 'send_org_patient_invite', v_invite_id::text,
    jsonb_build_object('org_id', p_org_id, 'patient_email', p_patient_email),
    'rpc'
  );

  return query select v_invite_id, 'sent'::text;
end;
$$;

revoke all on function public.send_org_patient_invite(uuid, text, jsonb, text) from public;
grant execute on function public.send_org_patient_invite(uuid, text, jsonb, text) to authenticated;

-- =============================================================================
-- RPC 2: accept_org_patient_invite_preview
-- =============================================================================
-- Called by the Edge Function (Plan 29-05) before showing the consent screen.
-- Anonymous-accessible: the patient may not yet be authenticated when they click
-- the magic-link. Returns org branding info for the consent UI.
-- Anti-enumeration (W-1): raises identical 'invite not found' (P0002) for both
-- invalid tokens AND expired/already-accepted tokens.
-- STABLE: read-only, no audit needed.
-- =============================================================================
create or replace function public.accept_org_patient_invite_preview(
  p_invite_token_hash text
) returns table(org_name text, org_logo_url text, scope_summary jsonb)
  language plpgsql
  security definer
  stable
  set search_path = pg_catalog, public, extensions
as $$
declare
  v_org_id    uuid;
  v_org_name  text;
  v_logo_url  text;
  v_scope     jsonb;
begin
  -- Find valid pending invite (not expired, not accepted)
  select
    i.org_id,
    o.name,
    coalesce(b.logo_url, ''),
    i.consent_scope
  into
    v_org_id,
    v_org_name,
    v_logo_url,
    v_scope
  from public.org_patient_invites i
  join public.organizations o on o.id = i.org_id
  left join public.org_branding b on b.org_id = i.org_id
  where i.invite_token_hash = p_invite_token_hash
    and i.accepted_at is null
    and i.expires_at > now();

  -- Anti-enumeration: identical error for invalid OR expired tokens (W-1 / T-29-02-04)
  if v_org_id is null then
    raise exception 'invite not found' using errcode = 'P0002';
  end if;

  return query select v_org_name, v_logo_url, v_scope;
end;
$$;

revoke all on function public.accept_org_patient_invite_preview(text) from public;
-- anon: patient may be unauthenticated at preview time
grant execute on function public.accept_org_patient_invite_preview(text) to anon, authenticated;

-- =============================================================================
-- RPC 3: accept_org_patient_invite
-- =============================================================================
-- Single-transaction commit chain (D-08 steps a-e; step f = magic-link is Plan 29-05).
-- Called by the Edge Function after the patient has authenticated or been created.
-- Atomically:
--   a. Validate invite (not accepted, not expired)
--   b. UPDATE profiles.primary_org_id
--   c. INSERT org_consent_grants
--   d. INSERT org_patient_links
--   e. UPDATE org_patient_invites.accepted_at
--   f. Audit log (direct insert, bypasses platform-admin check)
-- =============================================================================
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
begin
  -- a. Validate invite: must be pending (not accepted) and not expired
  select i.id, i.org_id, i.consent_scope, i.invited_by
  into v_invite
  from public.org_patient_invites i
  where i.invite_token_hash = p_invite_token_hash
    and i.accepted_at is null
    and i.expires_at > now();

  if not found then
    raise exception 'invite not found' using errcode = 'P0002';
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
-- authenticated: Edge Function calls this after patient is authenticated (or service_role)
grant execute on function public.accept_org_patient_invite(text, uuid) to authenticated;
