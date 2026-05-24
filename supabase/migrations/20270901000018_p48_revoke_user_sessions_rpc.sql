-- Phase 48 Plan 09 — revoke_user_sessions SECDEF RPC.
--
-- D-15 CORRECTED 2026-05-23 (iter-1 W1 fix): the ban-enforcement Edge Fn
-- (Plan 48-09) needs to DELETE rows from auth.sessions + auth.refresh_tokens
-- to revoke all sessions for a banned user. Direct supabase-js
-- .schema('auth').from() is NOT guaranteed to reach auth.* tables because
-- PostgREST exposes only public + graphql_public schemas by default.
-- Funnel the DML through the trusted `public` schema via this SECDEF
-- function, which IS PostgREST-reachable via supabase-js .rpc().
--
-- A10 spike (RESEARCH 2026-05-23) confirmed service-role has DML permission
-- on auth.sessions + auth.refresh_tokens. SECDEF + service_role-only grant
-- restricts the public surface — only the ban-enforcement Fn (with the
-- service-role bearer) can invoke this RPC.
--
-- Idempotent: DELETE on already-absent rows returns 0 rows (no error).
--
-- Per reference_postgres_dollar_quote_nesting_in_cron_body — file is
-- standalone (not nested inside cron.schedule), single $fn$ tag is safe.

begin;

create or replace function public.revoke_user_sessions(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $fn$
begin
  delete from auth.sessions       where user_id = p_user_id;
  delete from auth.refresh_tokens where user_id = p_user_id;
end;
$fn$;

comment on function public.revoke_user_sessions(uuid) is
  'P48 D-15 CORRECTED: revoke all sessions+refresh tokens for a user. SECDEF + service_role-only grant; called from ban-enforcement Edge Fn via PostgREST rpc(). Funnels auth.* DML through trusted public schema (per iter-1 W1 fix — PostgREST exposes only public by default).';

revoke all     on function public.revoke_user_sessions(uuid) from public, authenticated, anon;
grant execute  on function public.revoke_user_sessions(uuid) to service_role;

commit;
