-- Phase 28 Plan 01 — Task 1 (migration 9/11)
-- send_org_invite + revoke_org_invite + accept_org_invite SECDEF RPCs.
-- Per CONTEXT D-13 + plan Task 1 action item 9.
--
-- ALL: security definer set search_path = pg_catalog, public, extensions
--      (per [[reference_supabase_migration_gotchas]])
-- ALL: call Phase 24 log_admin_action for audit trail (T-28-01-05)
-- ALL: Pattern S1 dual-layer — DB-side role check inside function body
--
-- W-1 anti-enumeration invariant (T-28-01-02 + addendum A2):
--   send_org_invite returns identical {invite_id, token} shape regardless
--   of whether p_email exists in auth.users. No branching on email existence.
--
-- org_invites status state machine (per [[feedback_status_machine_transition_owner]]):
--   (none)  → pending   : send_org_invite
--   pending → accepted  : accept_org_invite
--   pending → revoked   : revoke_org_invite
--   pending → expired   : pg_cron (migration 20270601100018)

-- =============================================================================
-- send_org_invite
-- =============================================================================
create or replace function public.send_org_invite(
  p_org_id    uuid,
  p_email     text,
  p_role      public.org_member_role
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_uid       uuid := auth.uid();
  v_invite_id uuid;
  v_token     text;
  v_token_hash text;
begin
  -- Pattern S1 dual-layer: role gate inside function body.
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  if not exists (
    select 1 from public.org_members
    where org_id = p_org_id
      and user_id = v_uid
      and role = 'admin'
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Generate a random 32-byte token (hex-encoded = 64 chars) and compute SHA-256 hash.
  -- pgcrypto: gen_random_bytes → encode(..., 'hex') for the raw token;
  --           digest(..., 'sha256') → encode(..., 'hex') for the hash.
  -- This mirrors Phase 9 makeInviteTokenHash (crypto.subtle SHA-256 over hex token).
  v_token      := encode(extensions.gen_random_bytes(32), 'hex');
  v_token_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');

  -- Insert the invite row. W-1: we do NOT check whether p_email exists in
  -- auth.users before inserting — the row is always created regardless.
  insert into public.org_invites (org_id, email, invited_role, invite_token_hash, created_by)
  values (p_org_id, p_email, p_role, v_token_hash, v_uid)
  returning id into v_invite_id;

  -- Audit trail per T-28-01-05.
  perform public.log_admin_action(
    'org_invite_sent',
    p_org_id,
    jsonb_build_object('invite_id', v_invite_id, 'role', p_role::text)
  );

  -- Return identical shape regardless of email existence (W-1 invariant).
  return jsonb_build_object('invite_id', v_invite_id, 'token', v_token);
end;
$$;

revoke all on function public.send_org_invite(uuid, text, public.org_member_role) from public;
grant execute on function public.send_org_invite(uuid, text, public.org_member_role) to authenticated;

-- =============================================================================
-- revoke_org_invite
-- =============================================================================
create or replace function public.revoke_org_invite(
  p_invite_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_uid    uuid := auth.uid();
  v_org_id uuid;
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  -- Resolve org_id from invite.
  select org_id into v_org_id
  from public.org_invites
  where id = p_invite_id;

  if v_org_id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  -- Pattern S1: caller must be admin of the invite's org.
  if not exists (
    select 1 from public.org_members
    where org_id = v_org_id
      and user_id = v_uid
      and role = 'admin'
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Flip status to 'revoked' — only pending invites can be revoked.
  update public.org_invites
  set status = 'revoked', revoked_at = now()
  where id = p_invite_id
    and status = 'pending';

  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  -- Audit trail per T-28-01-05.
  perform public.log_admin_action(
    'org_invite_revoked',
    v_org_id,
    jsonb_build_object('invite_id', p_invite_id)
  );
end;
$$;

revoke all on function public.revoke_org_invite(uuid) from public;
grant execute on function public.revoke_org_invite(uuid) to authenticated;

-- =============================================================================
-- accept_org_invite
-- =============================================================================
-- Token-gated (not role-gated). The token IS the auth.
-- W-1 invariant: returns generic error code 42501 if token doesn't match.
-- Atomically: inserts org_members row + sets invite.status='accepted'.
-- =============================================================================
create or replace function public.accept_org_invite(
  p_token text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_uid        uuid := auth.uid();
  v_token_hash text;
  v_invite     record;
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  -- Recompute hash from raw token (SHA-256 via pgcrypto).
  v_token_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');

  -- Find matching pending invite that hasn't expired.
  select id, org_id, invited_role, email
  into v_invite
  from public.org_invites
  where invite_token_hash = v_token_hash
    and status = 'pending'
    and expires_at > now();

  -- W-1: use generic 42501 if token doesn't match (no timing leak).
  if not found then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Atomically insert into org_members (upsert on conflict to handle re-acceptance).
  insert into public.org_members (org_id, user_id, role)
  values (v_invite.org_id, v_uid, v_invite.invited_role)
  on conflict (org_id, user_id) do update
    set role = excluded.role,
        joined_at = now();

  -- Flip invite status.
  update public.org_invites
  set status = 'accepted', accepted_at = now()
  where id = v_invite.id;

  -- Audit trail.
  perform public.log_admin_action(
    'org_invite_accepted',
    v_invite.org_id,
    jsonb_build_object('invite_id', v_invite.id, 'user_id', v_uid)
  );

  return jsonb_build_object('org_id', v_invite.org_id, 'role', v_invite.invited_role::text);
end;
$$;

revoke all on function public.accept_org_invite(text) from public;
grant execute on function public.accept_org_invite(text) to authenticated;
