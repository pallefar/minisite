-- Phase 28 Plan 03 — Custom Access Token Hook for app_metadata.org_ids
-- Per addendum A3 (preferred over D-09 trigger) + research §Pattern 3 + §Pitfall 4.
-- Index on org_members(user_id) lives in migration 20270601100004 (Plan 01) — load-bearing for hook latency.
-- SECURITY DEFINER + explicit search_path per [[reference_supabase_migration_gotchas]].

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_user_id uuid;
  v_org_ids jsonb;
  v_claims  jsonb;
begin
  v_user_id := (event ->> 'user_id')::uuid;
  v_claims  := event -> 'claims';

  -- Fetch org_ids ordered by last_active_at desc nulls last (most-recently-active org first).
  -- Uses org_members_user_id_idx (migration 20270601100004) for sub-millisecond lookup.
  select coalesce(
    jsonb_agg(om.org_id::text order by om.last_active_at desc nulls last),
    '[]'::jsonb
  )
    into v_org_ids
  from public.org_members om
  where om.user_id = v_user_id;

  -- Ensure app_metadata key exists before patching (claims may arrive without it).
  if jsonb_typeof(v_claims -> 'app_metadata') is null then
    v_claims := jsonb_set(v_claims, '{app_metadata}', '{}'::jsonb);
  end if;

  -- Inject sorted org_ids array into app_metadata.org_ids.
  v_claims := jsonb_set(v_claims, '{app_metadata,org_ids}', v_org_ids);

  return jsonb_build_object('claims', v_claims);
end;
$$;

-- Grant execute ONLY to supabase_auth_admin (the Auth service role that invokes hooks).
-- Revoke from all other roles to prevent privilege escalation (T-28-03-01).
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;
