-- Phase 10 Plan 10-03 (Rule 1 auto-fix) — resolve PL/pgSQL 42702 ambiguity
-- in create_org() and accept_invite_existing() introduced when
-- audit_logs.metadata/target_user_id were added by migration
-- 20260901000003_rank_org_patients_rpc.sql, causing PostgreSQL to recompile
-- both functions and detect that bare `org_id` in their WHERE clauses is
-- ambiguous between:
--   (a) the RETURNS TABLE output column `org_id uuid` (implicit PL/pgSQL variable)
--   (b) the `public.roles.org_id` column referenced in the SELECT WHERE clauses.
--
-- Fix: qualify `org_id` with table aliases (`r.org_id`) in all WHERE clauses
-- inside these functions.  All other logic is preserved verbatim from Phase 9
-- (migration 20260801000011_clinic_rpcs.sql).
--
-- SECURITY DEFINER + search_path retained exactly as Phase 9.

-- ─── 1. create_org — qualify `org_id` in roles lookup WHERE clause ────────────

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
  -- Use table alias `r` to disambiguate `r.org_id` from the RETURNS TABLE output
  -- variable `org_id` (PL/pgSQL 42702 — "could refer to either a variable or column").
  select r.id into v_owner_role_id
  from public.roles r
  where r.org_id = v_id and r.name = 'Owner' and r.is_system = true;

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

-- ─── 2. accept_invite_existing — qualify `org_id` in roles lookup WHERE ──────
-- Same 42702 pattern: RETURNS TABLE(membership_id uuid, org_id uuid) + unqualified
-- `org_id` in the SELECT WHERE clause referencing public.roles.org_id.

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
  -- Use table alias `r` to disambiguate `r.org_id` from the RETURNS TABLE
  -- output variable `org_id` (PL/pgSQL 42702).
  select r.id into v_default_role_id
  from public.roles r
  where r.org_id = v_invite.org_id and r.name = 'View-only' and r.is_system = true;

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

-- ─── 3. accept_invite_new — same 42702 fix (identical body to #2) ─────────────

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

  -- Use table alias `r` to disambiguate `r.org_id` from the RETURNS TABLE
  -- output variable `org_id` (PL/pgSQL 42702).
  select r.id into v_default_role_id
  from public.roles r
  where r.org_id = v_invite.org_id and r.name = 'View-only' and r.is_system = true;

  -- Pitfall #8 invariant: UNIQUE(user_id, org_id) WHERE revoked_at IS NULL
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
