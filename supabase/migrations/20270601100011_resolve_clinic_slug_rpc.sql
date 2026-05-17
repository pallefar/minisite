-- Phase 28 Plan 06 — ORG-07 path-based routing RPC.
-- Anti-enumeration: non-existent slug AND existing-slug-no-relationship
-- both return {state:'not_found'}. Identical JSON byte output per T5.
--
-- Constant-cost path: single index lookup on organizations.slug +
-- single join on org_members + single lookup on auth.users + single lookup
-- on org_invites. The function always performs all lookups in the happy path;
-- for the not_found branches after the first check, Postgres early-returns
-- inside the IF block (sub-ms per research §D — timing dominated by network).
--
-- Security: SECURITY DEFINER set search_path = pg_catalog, public, extensions
-- (per [[reference_supabase_migration_gotchas]]).
-- Grants: revoke from public/anon; grant to authenticated only (auth.uid() context required).
--
-- Anti-enumeration invariants (CONTEXT D-19 + ORG-07):
--   resolve_clinic_slug('does-not-exist')        → { state: 'not_found' }
--   resolve_clinic_slug('real-slug-no-member')   → { state: 'not_found' }  ← IDENTICAL
--   resolve_clinic_slug('real-slug-with-member') → { state: 'member', ... }
--   resolve_clinic_slug('real-slug-pending-invite-for-caller-email') → { state: 'pending_invite', ... }

create or replace function public.resolve_clinic_slug(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_org_id   uuid;
  v_org_slug text;
  v_org_name text;
  v_role     text;
  v_email    text;
  v_invite_id   uuid;
  v_invite_role text;
  v_invite_exp  timestamptz;
begin
  -- Step 1: look up the org by slug (single index scan on organizations.slug).
  select id, slug, name
    into v_org_id, v_org_slug, v_org_name
    from public.organizations
   where slug = p_slug
   limit 1;

  if v_org_id is null then
    -- Slug does not exist — anti-enumeration: return not_found.
    return jsonb_build_object('state', 'not_found');
  end if;

  -- Step 2: check if caller is a member of this org.
  select om.role::text
    into v_role
    from public.org_members om
   where om.org_id = v_org_id
     and om.user_id = auth.uid()
   limit 1;

  if v_role is not null then
    return jsonb_build_object(
      'state',       'member',
      'org_summary', jsonb_build_object(
        'id',   v_org_id,
        'slug', v_org_slug,
        'name', v_org_name,
        'role', v_role
      )
    );
  end if;

  -- Step 3: resolve caller's email (needed for invite lookup).
  select au.email::text
    into v_email
    from auth.users au
   where au.id = auth.uid()
   limit 1;

  if v_email is null then
    -- Unauthenticated / email not found — anti-enumeration: not_found.
    return jsonb_build_object('state', 'not_found');
  end if;

  -- Step 4: check for a pending, non-expired org_invite for caller's email.
  select oi.id, oi.invited_role::text, oi.expires_at
    into v_invite_id, v_invite_role, v_invite_exp
    from public.org_invites oi
   where oi.org_id    = v_org_id
     and oi.email     = v_email::citext
     and oi.status    = 'pending'
     and oi.expires_at > now()
   limit 1;

  if v_invite_id is not null then
    return jsonb_build_object(
      'state',          'pending_invite',
      'invite_summary', jsonb_build_object(
        'invite_id',  v_invite_id,
        'role',       v_invite_role,
        'expires_at', v_invite_exp
      )
    );
  end if;

  -- Slug exists but caller has no relationship — anti-enumeration: not_found.
  -- IDENTICAL response shape to the non-existent-slug branch above.
  return jsonb_build_object('state', 'not_found');
end;
$$;

-- Revoke execute from public and anon roles (auth.uid() context required).
revoke execute on function public.resolve_clinic_slug(text) from public, anon;

-- Grant execute to authenticated users only.
grant execute on function public.resolve_clinic_slug(text) to authenticated;

comment on function public.resolve_clinic_slug(text) is
  'Phase 28 Plan 06 — ORG-07 anti-enumeration RPC. Returns member|pending_invite|not_found. '
  'not_found is returned for BOTH non-existent slugs AND existing-slug-with-no-caller-relationship '
  '(per CONTEXT D-19). Requires authenticated caller (auth.uid() context).';
