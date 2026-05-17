-- Phase 28 Plan 04 Task 2 — SECDEF Vault reader for realtime channel secret.
--
-- `public.get_realtime_secret()` is an INTERNAL helper called only by
-- `realtime_topic_authorized` (migration 100016). It reads the 32-byte hex
-- Vault secret and returns the decrypted string.
--
-- Security grants (Pitfall 3 per RESEARCH §Pitfall 3):
--   REVOKE execute from public / authenticated / anon
--   GRANT execute to supabase_realtime_admin ONLY
--
-- The `supabase_realtime_admin` role is the internal role that Supabase
-- Realtime uses when evaluating channel-auth callbacks (RLS policies on
-- realtime.messages). Granting to any broader role would expose the raw
-- Vault secret to queries made by untrusted callers.
--
-- search_path includes `vault` so `vault.decrypted_secrets` resolves without
-- schema-qualification inside the function body.

create or replace function public.get_realtime_secret()
  returns text
  language sql
  stable
  security definer
  set search_path = pg_catalog, vault, public, extensions
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name = 'org_realtime_channel_secret'
  limit 1;
$$;

-- Revoke the default PUBLIC execute privilege that PostgreSQL grants to
-- all functions. We want ZERO default callers.
revoke execute on function public.get_realtime_secret() from public;
revoke execute on function public.get_realtime_secret() from authenticated;
revoke execute on function public.get_realtime_secret() from anon;

-- Grant only to the Realtime internal role (RLS policy evaluation context).
grant execute on function public.get_realtime_secret() to supabase_realtime_admin;

-- Also grant to `service_role` so integration tests and runbook automation
-- can call the function without impersonating the realtime role.
grant execute on function public.get_realtime_secret() to service_role;
