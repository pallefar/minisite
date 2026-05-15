-- Phase 19 Plan 01 — insert_affiliate_impression SQL helper (BL-10 / D-38).
--
-- Server-side impression insert with /24 IP truncation via set_masklen + UA hash + referer
-- truncation. Called from the affiliate-impression Edge Function on /r/{code}/landing render
-- (path shipped in Plan 19-08). SECURITY DEFINER + locked search_path so the function can
-- write to affiliate_impressions despite RLS service-role-insert-only policy.
--
-- SECURITY DEFINER exception (reference_supabase_migration_gotchas Pitfall 2):
--   The function takes ONLY a service_role EXECUTE grant + has an explicit
--   `set search_path = public, pg_temp` to prevent search-path injection. The function body
--   has zero dynamic SQL. This is the documented exception where SECURITY DEFINER is
--   justified — bridging RLS with a hardened server-side write path.
--
-- /24 truncation rationale (D-38): IPv4 /24 retains coarse geographic locality for v1.3
-- fraud-baseline aggregations while eliminating per-device identifiability (256-address bucket).
-- For IPv6 the masklen=24 still applies but the privacy benefit is smaller; planner-decision
-- in 19-08 may elect to truncate v6 separately, but the function signature does not need to
-- change for that.

create or replace function public.insert_affiliate_impression(
  p_affiliate_id uuid,
  p_ip text,
  p_ua_hash text,
  p_referer text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.affiliate_impressions (affiliate_id, ip_24, ua_hash, referer)
  values (
    p_affiliate_id,
    set_masklen(coalesce(nullif(p_ip, ''), '0.0.0.0')::inet, 24),
    p_ua_hash,
    left(coalesce(p_referer, ''), 500)
  );
end
$$;

-- Lock down grants — only service_role may invoke.
revoke all on function public.insert_affiliate_impression(uuid, text, text, text) from public;
grant execute on function public.insert_affiliate_impression(uuid, text, text, text) to service_role;

comment on function public.insert_affiliate_impression(uuid, text, text, text) is
  'BL-10 / D-38: server-side impression insert with /24 IP truncation via set_masklen. '
  'Called from affiliate-impression Edge Function. SECURITY DEFINER with locked search_path so '
  'it can write to affiliate_impressions despite RLS service-role-insert-only policy. '
  'Service-role grant only — no authenticated/anon EXECUTE.';
