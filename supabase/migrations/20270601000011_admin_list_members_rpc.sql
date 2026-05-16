-- Phase 22 plan 01 — ADMIN-01: server-paginated members table RPC.
-- Analog: supabase/migrations/20260901000003_rank_org_patients_rpc.sql (SECURITY DEFINER + is_staff gate + LIMIT/OFFSET)
-- Cross-phase contract: JOIN to public.tier_effective view (Phase 19 — 20270101000004) NOT raw
--                       subscriptions.status, so P16 RC plug-in (Plan 16-06) requires zero changes here.
-- Pitfalls applied: Pitfall 3 (uses pre-existing 'permission_denied' enum + is_staff helper),
--                   Pitfall 4 (no audit-trigger interaction; pure read RPC).
--
-- Returns one row per registered user with:
--   email, tier, signup_date, last_active_at, clinic_name, country, stripe_status, user_id
-- Tier derivation per D-04: tier_effective.has_active=true → 'paid'; has_past_due → 'past_due';
--                           membership in any clinic org → 'clinic_seat'; else 'free'.

create or replace function public.admin_list_members(
  p_search text default null,
  p_tier text default null,
  p_page int default 1,
  p_size int default 50
)
returns table (
  user_id uuid,
  email text,
  tier text,
  signup_date timestamptz,
  last_active_at timestamptz,
  clinic_name text,
  country text,
  stripe_status text
)
language plpgsql
security definer
set search_path = public, auth, extensions, pg_catalog
as $$
declare
  v_caller uuid := auth.uid();
  v_offset int;
begin
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not public.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_size < 1 or p_size > 200 then
    raise exception 'invalid_size' using errcode = '22023';
  end if;
  if p_page < 1 then
    raise exception 'invalid_page' using errcode = '22023';
  end if;
  if p_tier is not null and p_tier not in ('free', 'paid', 'clinic_seat', 'past_due') then
    raise exception 'invalid_tier' using errcode = '22023';
  end if;

  v_offset := (p_page - 1) * p_size;

  return query
  with base as (
    select
      u.id as user_id,
      u.email::text as email,
      u.created_at as signup_date,
      u.last_sign_in_at as last_active_at,
      coalesce(u.raw_user_meta_data ->> 'country', null) as country,
      te.has_active as te_active,
      te.has_past_due as te_past_due,
      te.winning_provider as stripe_status_src,
      (
        select o.name
          from public.memberships m
          join public.orgs o on o.id = m.org_id
         where m.user_id = u.id and m.revoked_at is null
         order by m.created_at asc
         limit 1
      ) as clinic_name
    from auth.users u
    left join public.tier_effective te on te.user_id = u.id
  ),
  tiered as (
    select
      b.*,
      case
        when b.te_active is true then 'paid'
        when b.te_past_due is true then 'past_due'
        when b.clinic_name is not null then 'clinic_seat'
        else 'free'
      end as derived_tier,
      case
        when b.te_active is true then 'active'
        when b.te_past_due is true then 'past_due'
        else 'none'
      end as derived_stripe_status
    from base b
  )
  select
    t.user_id,
    t.email,
    t.derived_tier as tier,
    t.signup_date,
    t.last_active_at,
    t.clinic_name,
    t.country,
    t.derived_stripe_status as stripe_status
  from tiered t
  where (p_search is null or t.email ilike '%' || p_search || '%')
    and (p_tier is null or t.derived_tier = p_tier)
  order by t.signup_date desc, t.user_id asc
  offset v_offset
  limit p_size;
end;
$$;

revoke all on function public.admin_list_members(text, text, int, int) from public;
grant execute on function public.admin_list_members(text, text, int, int) to authenticated;
