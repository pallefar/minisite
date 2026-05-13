-- Phase 9 Plan 09-01 — clinic SECURITY DEFINER RPC suite.
--
-- All 16 RPCs follow the Phase 7 SECURITY DEFINER template:
--   - language plpgsql + security definer
--   - set search_path = public, extensions, pg_catalog (memory gotcha #2)
--   - revoke all from public; grant execute to authenticated (or service_role
--     for log_clinic_event)
--   - Inline INSERT to audit_logs for every state-changing action
--
-- Permission gating: every gated RPC calls public.has_permission(uid, org_id,
-- 'permission.key') and raises '42501' on failure. This is the single
-- authorization primitive across the entire clinic surface.
--
-- Audit row pattern: each insert mirrors the Phase 7 column shape
--   (user_id, user_id_hash, table_name, row_id, action, actor_type, org_id)
-- with actor_type='org_operator' for operator-side writes and 'org_member'
-- for patient-side writes (consent edits, self-revoke, accept-invite).
--
-- delete_org applies BOTH cascade-safety GUCs from memory
-- `reference_supabase_migration_gotchas.md`:
--   - app.suppress_audit (gotcha #4) — silences the audit_trigger() fires
--     on cascade DELETEs of memberships/invites/roles/role_permissions.
--   - storage.allow_delete_query (gotcha #3) — allows the inline
--     `delete from storage.objects ...` for the org-logo file.
--
-- Anti-enumeration (D-02): send_invite never branches on auth.users
-- existence. The /clinic-invite/lookup Edge Function (Plan 09-06) does
-- the lookup at acceptance time only.

-- =============================================================================
-- 1. create_org
-- =============================================================================
create or replace function public.create_org(
  p_name text,
  p_slug text,
  p_description text,
  p_website_url text
)
returns table (org_id uuid, slug text)
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_owner_role_id uuid;
begin
  if v_uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;

  insert into public.orgs (slug, name, description, website_url, owner_user_id)
  values (p_slug, p_name, p_description, p_website_url, v_uid)
  returning id into v_id;

  -- Trigger seeds 3 system roles for v_id (AFTER INSERT FOR EACH ROW fires inline).
  select id into v_owner_role_id
  from public.roles
  where org_id = v_id and name = 'Owner' and is_system = true;

  insert into public.memberships (user_id, org_id, role_id, accepted_at)
  values (v_uid, v_id, v_owner_role_id, now());

  insert into public.audit_logs
    (user_id, user_id_hash, table_name, row_id, action, actor_type, org_id)
  values (
    v_uid,
    encode(digest(v_uid::text, 'sha256'), 'hex'),
    'orgs',
    v_id::text,
    'org_create',
    'org_operator',
    v_id
  );

  return query select v_id, p_slug;
exception
  when unique_violation then
    raise exception 'slug_taken' using errcode = '23505';
end;
$$;
revoke all on function public.create_org(text, text, text, text) from public;
grant execute on function public.create_org(text, text, text, text) to authenticated;

-- =============================================================================
-- 2. update_org
-- =============================================================================
create or replace function public.update_org(
  p_org_id uuid,
  p_name text,
  p_description text,
  p_website_url text,
  p_logo_storage_path text
)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  if not public.has_permission(v_uid, p_org_id, 'org.update') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update public.orgs
  set name = coalesce(p_name, name),
      description = p_description,
      website_url = p_website_url,
      logo_storage_path = p_logo_storage_path
  where id = p_org_id;

  insert into public.audit_logs
    (user_id, user_id_hash, table_name, row_id, action, actor_type, org_id)
  values (
    v_uid,
    encode(digest(v_uid::text, 'sha256'), 'hex'),
    'orgs',
    p_org_id::text,
    'org_update',
    'org_operator',
    p_org_id
  );
end;
$$;
revoke all on function public.update_org(uuid, text, text, text, text) from public;
grant execute on function public.update_org(uuid, text, text, text, text) to authenticated;

-- =============================================================================
-- 3. delete_org (cascade-safe via dual GUCs)
-- =============================================================================
create or replace function public.delete_org(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  if not public.has_permission(v_uid, p_org_id, 'org.delete') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Skeleton audit row written BEFORE cascade so we always have the trace
  -- even though audit_logs.org_id is set null by the cascade FK.
  insert into public.audit_logs
    (user_id, user_id_hash, table_name, row_id, action, actor_type, org_id)
  values (
    v_uid,
    encode(digest(v_uid::text, 'sha256'), 'hex'),
    'orgs',
    p_org_id::text,
    'org_delete',
    'org_operator',
    p_org_id
  );

  -- gotcha #4: suppress the audit_trigger() per-row fires on cascade DELETEs.
  perform set_config('app.suppress_audit', 'true', true);
  -- gotcha #3: allow direct DELETE on storage.objects for the org-logo cleanup.
  perform set_config('storage.allow_delete_query', 'true', true);

  -- Best-effort logo cleanup. The Storage RLS DELETE policy
  -- (objects_delete_org_logos) is satisfied because we bypass via the GUC.
  delete from storage.objects
  where bucket_id = 'org-logos'
    and (storage.foldername(name))[1] = p_org_id::text;

  -- Cascades memberships, invites, roles, role_permissions via FKs.
  delete from public.orgs where id = p_org_id;
end;
$$;
revoke all on function public.delete_org(uuid) from public;
grant execute on function public.delete_org(uuid) to authenticated;

-- =============================================================================
-- 4. send_invite (D-02 anti-enumeration; D-17 7-day expiry)
-- =============================================================================
create or replace function public.send_invite(
  p_email text,
  p_org_id uuid,
  p_invite_token_hash text,
  p_requested_scope jsonb
)
returns table (invite_id uuid)
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  if not public.has_permission(v_uid, p_org_id, 'members.invite') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- D-02: NO auth.users lookup here. The Edge Function at /clinic-invite/lookup
  -- (Plan 09-06) does that at acceptance time.

  insert into public.invites
    (email, org_id, invited_by, invite_token_hash, requested_scope, expires_at)
  values (
    lower(p_email),
    p_org_id,
    v_uid,
    p_invite_token_hash,
    coalesce(p_requested_scope, '{}'::jsonb),
    now() + interval '7 days'
  )
  returning id into v_id;

  insert into public.audit_logs
    (user_id, user_id_hash, table_name, row_id, action, actor_type, org_id)
  values (
    v_uid,
    encode(digest(v_uid::text, 'sha256'), 'hex'),
    'invites',
    v_id::text,
    'membership_invite_sent',
    'org_operator',
    p_org_id
  );

  return query select v_id;
end;
$$;
revoke all on function public.send_invite(text, uuid, text, jsonb) from public;
grant execute on function public.send_invite(text, uuid, text, jsonb) to authenticated;

-- =============================================================================
-- 5. cancel_invite
-- =============================================================================
create or replace function public.cancel_invite(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_uid uuid := auth.uid();
  v_invite record;
begin
  if v_uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;

  select * into v_invite from public.invites where id = p_invite_id;
  if v_invite.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if not public.has_permission(v_uid, v_invite.org_id, 'members.invite') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  -- Idempotent — already-consumed invites are no-ops.
  if v_invite.consumed_at is not null then return; end if;

  update public.invites
  set rejected_at = now(),
      consumed_at = now()
  where id = p_invite_id;

  insert into public.audit_logs
    (user_id, user_id_hash, table_name, row_id, action, actor_type, org_id)
  values (
    v_uid,
    encode(digest(v_uid::text, 'sha256'), 'hex'),
    'invites',
    p_invite_id::text,
    'membership_invite_canceled',
    'org_operator',
    v_invite.org_id
  );
end;
$$;
revoke all on function public.cancel_invite(uuid) from public;
grant execute on function public.cancel_invite(uuid) to authenticated;

-- =============================================================================
-- Internal helper: validate ConsentScope jsonb shape (10-key strict).
-- Mirrors src/types/clinic.ts isConsentScope.
-- =============================================================================
create or replace function public._validate_consent_scope(p_scope jsonb)
returns void
language plpgsql
immutable
set search_path = public, extensions, pg_catalog
as $$
declare
  v_keys text[] := array[
    'injections','weights','photos','symptoms','meals',
    'workouts','supplements','mood','sleep','doctor_report'
  ];
  k text;
begin
  if jsonb_typeof(p_scope) <> 'object' then
    raise exception 'consent_scope_must_be_object' using errcode = '22023';
  end if;
  -- Reject extras: every key in the object must be a known data type.
  if exists (
    select 1 from jsonb_object_keys(p_scope) ko(k)
    where not (ko.k = any(v_keys))
  ) then
    raise exception 'consent_scope_unknown_key' using errcode = '22023';
  end if;
  -- Require all 10 keys, each boolean.
  foreach k in array v_keys loop
    if not (p_scope ? k) then
      raise exception 'consent_scope_missing_key: %', k using errcode = '22023';
    end if;
    if jsonb_typeof(p_scope -> k) <> 'boolean' then
      raise exception 'consent_scope_non_boolean_value: %', k using errcode = '22023';
    end if;
  end loop;
end;
$$;

-- =============================================================================
-- 6. accept_invite_existing (Pitfall #8: existing user accepts; D-18 freeze)
-- =============================================================================
create or replace function public.accept_invite_existing(
  p_invite_token_hash text,
  p_consent_scope jsonb
)
returns table (membership_id uuid, org_id uuid)
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_uid uuid := auth.uid();
  v_invite record;
  v_default_role_id uuid;
  v_membership_id uuid;
  v_user_email text;
begin
  if v_uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  perform public._validate_consent_scope(p_consent_scope);

  select email into v_user_email from auth.users where id = v_uid;

  select * into v_invite
  from public.invites
  where invite_token_hash = p_invite_token_hash
    and accepted_at is null
    and rejected_at is null
    and expires_at > now()
  for update;

  if v_invite.id is null then
    raise exception 'invite_not_found_or_used' using errcode = 'P0002';
  end if;
  if lower(v_invite.email) <> lower(v_user_email) then
    raise exception 'invite_email_mismatch' using errcode = '42501';
  end if;

  -- Default role = View-only (operator promotes post-accept if desired).
  select id into v_default_role_id
  from public.roles
  where org_id = v_invite.org_id and name = 'View-only' and is_system = true;

  -- Pitfall #8 invariant: UNIQUE(user_id, org_id) WHERE revoked_at IS NULL
  -- enforces one active membership per (user, org). A second accept for the
  -- same pair surfaces as 23505 unique_violation here.
  insert into public.memberships
    (user_id, org_id, role_id, consent_scope, invited_from_invite_id, accepted_at)
  values (
    v_uid, v_invite.org_id, v_default_role_id, p_consent_scope, v_invite.id, now()
  )
  returning id into v_membership_id;

  -- D-18: freeze the consent_scope_at_acceptance snapshot.
  update public.invites
  set accepted_at = now(),
      consumed_at = now(),
      consent_scope_at_acceptance = p_consent_scope
  where id = v_invite.id;

  insert into public.audit_logs
    (user_id, user_id_hash, table_name, row_id, action, actor_type, org_id)
  values (
    v_uid,
    encode(digest(v_uid::text, 'sha256'), 'hex'),
    'memberships',
    v_membership_id::text,
    'membership_invite_accepted',
    'org_member',
    v_invite.org_id
  );

  return query select v_membership_id, v_invite.org_id;
end;
$$;
revoke all on function public.accept_invite_existing(text, jsonb) from public;
grant execute on function public.accept_invite_existing(text, jsonb) to authenticated;

-- =============================================================================
-- 7. accept_invite_new (Pitfall #8: new user accepts; identical body to #6)
-- =============================================================================
create or replace function public.accept_invite_new(
  p_invite_token_hash text,
  p_consent_scope jsonb
)
returns table (membership_id uuid, org_id uuid)
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_uid uuid := auth.uid();
  v_invite record;
  v_default_role_id uuid;
  v_membership_id uuid;
  v_user_email text;
begin
  -- Body is intentionally identical to accept_invite_existing — the
  -- branching happens in the Edge Function (Plan 09-06) which directs
  -- "no-auth-user-yet" callers through Supabase signUp first. By the
  -- time this RPC runs, auth.uid() is non-null. The single-identity
  -- invariant is enforced by the same UNIQUE partial index.
  if v_uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  perform public._validate_consent_scope(p_consent_scope);

  select email into v_user_email from auth.users where id = v_uid;

  select * into v_invite
  from public.invites
  where invite_token_hash = p_invite_token_hash
    and accepted_at is null
    and rejected_at is null
    and expires_at > now()
  for update;

  if v_invite.id is null then
    raise exception 'invite_not_found_or_used' using errcode = 'P0002';
  end if;
  if lower(v_invite.email) <> lower(v_user_email) then
    raise exception 'invite_email_mismatch' using errcode = '42501';
  end if;

  select id into v_default_role_id
  from public.roles
  where org_id = v_invite.org_id and name = 'View-only' and is_system = true;

  insert into public.memberships
    (user_id, org_id, role_id, consent_scope, invited_from_invite_id, accepted_at)
  values (
    v_uid, v_invite.org_id, v_default_role_id, p_consent_scope, v_invite.id, now()
  )
  returning id into v_membership_id;

  update public.invites
  set accepted_at = now(),
      consumed_at = now(),
      consent_scope_at_acceptance = p_consent_scope
  where id = v_invite.id;

  insert into public.audit_logs
    (user_id, user_id_hash, table_name, row_id, action, actor_type, org_id)
  values (
    v_uid,
    encode(digest(v_uid::text, 'sha256'), 'hex'),
    'memberships',
    v_membership_id::text,
    'membership_invite_accepted',
    'org_member',
    v_invite.org_id
  );

  return query select v_membership_id, v_invite.org_id;
end;
$$;
revoke all on function public.accept_invite_new(text, jsonb) from public;
grant execute on function public.accept_invite_new(text, jsonb) to authenticated;

-- =============================================================================
-- 8. reject_invite
-- =============================================================================
create or replace function public.reject_invite(p_invite_token_hash text)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_uid uuid := auth.uid();
  v_invite record;
  v_user_email text;
begin
  if v_uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;

  select email into v_user_email from auth.users where id = v_uid;

  select * into v_invite
  from public.invites
  where invite_token_hash = p_invite_token_hash
    and accepted_at is null
    and rejected_at is null
  for update;

  if v_invite.id is null then
    raise exception 'invite_not_found_or_used' using errcode = 'P0002';
  end if;
  if lower(v_invite.email) <> lower(v_user_email) then
    raise exception 'invite_email_mismatch' using errcode = '42501';
  end if;

  update public.invites
  set rejected_at = now(),
      consumed_at = now()
  where id = v_invite.id;

  insert into public.audit_logs
    (user_id, user_id_hash, table_name, row_id, action, actor_type, org_id)
  values (
    v_uid,
    encode(digest(v_uid::text, 'sha256'), 'hex'),
    'invites',
    v_invite.id::text,
    'membership_invite_rejected',
    'org_member',
    v_invite.org_id
  );
end;
$$;
revoke all on function public.reject_invite(text) from public;
grant execute on function public.reject_invite(text) to authenticated;

-- =============================================================================
-- 9. revoke_membership (D-10 Layer 2 source-of-truth)
-- =============================================================================
create or replace function public.revoke_membership(p_membership_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_uid uuid := auth.uid();
  v_membership record;
  v_can_revoke_self boolean;
  v_can_revoke_other boolean;
begin
  if v_uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;

  select * into v_membership from public.memberships where id = p_membership_id;
  if v_membership.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if v_membership.revoked_at is not null then return; end if;  -- idempotent

  v_can_revoke_self := (v_membership.user_id = v_uid);
  v_can_revoke_other := public.has_permission(v_uid, v_membership.org_id, 'members.revoke');
  if not (v_can_revoke_self or v_can_revoke_other) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update public.memberships set revoked_at = now() where id = p_membership_id;

  insert into public.audit_logs
    (user_id, user_id_hash, table_name, row_id, action, actor_type, org_id)
  values (
    v_uid,
    encode(digest(v_uid::text, 'sha256'), 'hex'),
    'memberships',
    p_membership_id::text,
    'membership_revoked',
    case when v_can_revoke_self then 'org_member' else 'org_operator' end,
    v_membership.org_id
  );
end;
$$;
revoke all on function public.revoke_membership(uuid) from public;
grant execute on function public.revoke_membership(uuid) to authenticated;

-- =============================================================================
-- 10. update_consent_scope (patient-only)
-- =============================================================================
create or replace function public.update_consent_scope(
  p_membership_id uuid,
  p_consent_scope jsonb
)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_uid uuid := auth.uid();
  v_membership record;
begin
  if v_uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  perform public._validate_consent_scope(p_consent_scope);

  select * into v_membership from public.memberships where id = p_membership_id;
  if v_membership.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if v_membership.user_id <> v_uid then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_membership.revoked_at is not null then
    raise exception 'membership_revoked' using errcode = '42501';
  end if;

  update public.memberships
  set consent_scope = p_consent_scope,
      last_scope_changed_at = now()
  where id = p_membership_id;

  insert into public.audit_logs
    (user_id, user_id_hash, table_name, row_id, action, actor_type, org_id)
  values (
    v_uid,
    encode(digest(v_uid::text, 'sha256'), 'hex'),
    'memberships',
    p_membership_id::text,
    'membership_scope_updated',
    'org_member',
    v_membership.org_id
  );
end;
$$;
revoke all on function public.update_consent_scope(uuid, jsonb) from public;
grant execute on function public.update_consent_scope(uuid, jsonb) to authenticated;

-- =============================================================================
-- 11. update_member_role (operator only; gated on roles.manage)
-- =============================================================================
create or replace function public.update_member_role(
  p_membership_id uuid,
  p_role_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_uid uuid := auth.uid();
  v_membership record;
  v_role record;
begin
  if v_uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;

  select * into v_membership from public.memberships where id = p_membership_id;
  if v_membership.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if not public.has_permission(v_uid, v_membership.org_id, 'roles.manage') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_role from public.roles where id = p_role_id;
  if v_role.id is null then raise exception 'role_not_found' using errcode = 'P0002'; end if;
  if v_role.org_id <> v_membership.org_id then
    raise exception 'role_org_mismatch' using errcode = '42501';
  end if;

  update public.memberships
  set role_id = p_role_id
  where id = p_membership_id;

  insert into public.audit_logs
    (user_id, user_id_hash, table_name, row_id, action, actor_type, org_id)
  values (
    v_uid,
    encode(digest(v_uid::text, 'sha256'), 'hex'),
    'memberships',
    p_membership_id::text,
    'membership_role_changed',
    'org_operator',
    v_membership.org_id
  );
end;
$$;
revoke all on function public.update_member_role(uuid, uuid) from public;
grant execute on function public.update_member_role(uuid, uuid) to authenticated;

-- =============================================================================
-- 12. create_role (operator; gated on roles.manage)
-- =============================================================================
create or replace function public.create_role(
  p_org_id uuid,
  p_name text,
  p_description text,
  p_permission_keys text[]
)
returns table (role_id uuid)
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_key text;
begin
  if v_uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  if not public.has_permission(v_uid, p_org_id, 'roles.manage') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  insert into public.roles (org_id, name, description, is_system)
  values (p_org_id, p_name, p_description, false)
  returning id into v_id;

  if p_permission_keys is not null then
    foreach v_key in array p_permission_keys loop
      insert into public.role_permissions (role_id, permission_key)
      values (v_id, v_key)
      on conflict do nothing;
    end loop;
  end if;

  insert into public.audit_logs
    (user_id, user_id_hash, table_name, row_id, action, actor_type, org_id)
  values (
    v_uid,
    encode(digest(v_uid::text, 'sha256'), 'hex'),
    'roles',
    v_id::text,
    'role_create',
    'org_operator',
    p_org_id
  );

  return query select v_id;
end;
$$;
revoke all on function public.create_role(uuid, text, text, text[]) from public;
grant execute on function public.create_role(uuid, text, text, text[]) to authenticated;

-- =============================================================================
-- 13. update_role (operator; gated on roles.manage; blocks is_system)
-- =============================================================================
create or replace function public.update_role(
  p_role_id uuid,
  p_name text,
  p_description text,
  p_permission_keys text[]
)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_uid uuid := auth.uid();
  v_role record;
  v_key text;
begin
  if v_uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;

  select * into v_role from public.roles where id = p_role_id;
  if v_role.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if not public.has_permission(v_uid, v_role.org_id, 'roles.manage') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_role.is_system then
    raise exception 'system_role_immutable' using errcode = '42501';
  end if;

  update public.roles
  set name = coalesce(p_name, name),
      description = p_description
  where id = p_role_id;

  if p_permission_keys is not null then
    delete from public.role_permissions where role_id = p_role_id;
    foreach v_key in array p_permission_keys loop
      insert into public.role_permissions (role_id, permission_key)
      values (p_role_id, v_key)
      on conflict do nothing;
    end loop;
  end if;

  insert into public.audit_logs
    (user_id, user_id_hash, table_name, row_id, action, actor_type, org_id)
  values (
    v_uid,
    encode(digest(v_uid::text, 'sha256'), 'hex'),
    'roles',
    p_role_id::text,
    'role_update',
    'org_operator',
    v_role.org_id
  );
end;
$$;
revoke all on function public.update_role(uuid, text, text, text[]) from public;
grant execute on function public.update_role(uuid, text, text, text[]) to authenticated;

-- =============================================================================
-- 14. delete_role (operator; reassigns affected memberships to View-only)
-- =============================================================================
create or replace function public.delete_role(p_role_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_uid uuid := auth.uid();
  v_role record;
  v_viewonly_id uuid;
begin
  if v_uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;

  select * into v_role from public.roles where id = p_role_id;
  if v_role.id is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if not public.has_permission(v_uid, v_role.org_id, 'roles.manage') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_role.is_system then
    raise exception 'system_role_immutable' using errcode = '42501';
  end if;

  -- Reassign any active memberships using this role back to View-only.
  select id into v_viewonly_id
  from public.roles
  where org_id = v_role.org_id and name = 'View-only' and is_system = true;

  if v_viewonly_id is null then
    -- Defensive — should never happen since the trigger seeds View-only on every
    -- org row insert. Surface as an explicit error rather than orphaning.
    raise exception 'view_only_role_missing' using errcode = 'P0001';
  end if;

  update public.memberships
  set role_id = v_viewonly_id
  where role_id = p_role_id;

  -- Now safe to delete the role (cascade clears role_permissions).
  delete from public.roles where id = p_role_id;

  insert into public.audit_logs
    (user_id, user_id_hash, table_name, row_id, action, actor_type, org_id)
  values (
    v_uid,
    encode(digest(v_uid::text, 'sha256'), 'hex'),
    'roles',
    p_role_id::text,
    'role_delete',
    'org_operator',
    v_role.org_id
  );
end;
$$;
revoke all on function public.delete_role(uuid) from public;
grant execute on function public.delete_role(uuid) to authenticated;

-- =============================================================================
-- 15. log_clinic_event (generic audit-writer for Edge Functions)
-- =============================================================================
create or replace function public.log_clinic_event(
  p_actor_type text,
  p_action text,
  p_org_id uuid,
  p_target_user_id uuid,
  p_row_id text
)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_uid uuid := coalesce(auth.uid(), p_target_user_id);
begin
  -- Generic audit writer; Edge Functions call this AFTER their own
  -- per-request gate evaluation. Caller supplies the actor_type and
  -- action; we validate the actor_type cast against the enum and let the
  -- action CHECK constraint validate the action value.
  insert into public.audit_logs
    (user_id, user_id_hash, table_name, row_id, action, actor_type, org_id)
  values (
    v_uid,
    encode(digest(coalesce(v_uid, p_target_user_id, '00000000-0000-0000-0000-000000000000'::uuid)::text, 'sha256'), 'hex'),
    case when p_action = 'clinic_photo_view' then 'photos' else 'clinic_event' end,
    p_row_id,
    p_action,
    p_actor_type::public.audit_actor_type,
    p_org_id
  );
end;
$$;
revoke all on function public.log_clinic_event(text, text, uuid, uuid, text) from public;
-- Edge Functions call this with the service-role key; grant to service_role.
grant execute on function public.log_clinic_event(text, text, uuid, uuid, text) to service_role;

-- =============================================================================
-- 16. list_org_members (B-4 fix per plan-checker iter 1)
-- =============================================================================
create or replace function public.list_org_members(p_org_id uuid)
returns table (
  user_id uuid,
  email text,
  role_id uuid,
  joined_at timestamptz,
  revoked_at timestamptz
)
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
stable
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'unauthenticated' using errcode = '28000'; end if;
  if not public.has_permission(v_uid, p_org_id, 'members.list') then
    -- Per project pattern: gated SELECT-style RPCs return empty rather than
    -- raising. RLS-style silent-deny matches the operator UI's expected UX
    -- (they get an empty roster, not a 403 modal).
    return;
  end if;

  return query
  select
    m.user_id,
    -- Privacy minimization: mask the local-part of the email for accepted
    -- members (operator already knows the patient via the invite they
    -- created; the masked variant is shown in the roster for non-operator
    -- members with members.list — e.g. Coach role).
    case
      when m.accepted_at is not null
        then substring(u.email for 2) || '…@' || split_part(u.email, '@', 2)
      else u.email
    end as email,
    m.role_id,
    m.joined_at,
    m.revoked_at
  from public.memberships m
  join auth.users u on u.id = m.user_id
  where m.org_id = p_org_id;
end;
$$;
revoke all on function public.list_org_members(uuid) from public;
grant execute on function public.list_org_members(uuid) to authenticated;
