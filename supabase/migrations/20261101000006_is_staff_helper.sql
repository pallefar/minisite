-- Phase 15 Plan 01 — `public.is_staff()` SECURITY DEFINER helper.
--
-- This helper is consumed by every RLS policy in migration 07 (page_builder_rls)
-- and migration 09 (page_assets_storage_rls), plus by Edge Functions in plans
-- 15-04 / 15-07 / 15-08. It MUST exist BEFORE any CREATE POLICY that calls it
-- (planner-iter1 anti-pattern: helper before forward-ref). Lexicographic
-- migration ordering encodes this: 06_helper → 07_rls.
--
-- Hardening (T-15-01-01 mitigation):
--   - SECURITY DEFINER — runs as the function owner; auth.uid() is the only
--     identity source. A non-staff JWT cannot pose as staff by manipulating
--     the call site.
--   - SET search_path = public, extensions, pg_catalog (RESEARCH Pitfall 2).
--     Prevents a malicious schema (e.g. a search-path injection) from
--     shadowing `public.profiles` with an attacker-controlled table.
--   - STABLE — Postgres caches the result within a single query, so RLS
--     evaluation does NOT do N+1 SELECTs across the queried rows (T-15-01-10).
--   - coalesce(..., false) — a missing profiles row (or anon caller with
--     no auth.uid()) evaluates to false. anon receives false; authenticated
--     receives the row's is_staff or false.
--   - LANGUAGE sql — small, no side effects, no exception handling needed.

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public, extensions, pg_catalog
as $$
  select coalesce(
    (select is_staff from public.profiles where id = auth.uid() limit 1),
    false
  );
$$;

revoke all on function public.is_staff() from public;
grant execute on function public.is_staff() to authenticated, anon;
