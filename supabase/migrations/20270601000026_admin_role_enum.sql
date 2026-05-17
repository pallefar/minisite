-- Phase 24: Admin role enum (3-role model for modular admin shell)
-- Decision ref: D-04
--
-- Creates the `public.admin_role` enum with three values:
--   staff       → helpdesk + read-only modules
--   admin       → adds billing, cohorts, affiliates, settings
--   superadmin  → adds AI, audit log, dangerous actions (impersonate, role change, reset_totp)
--
-- Uses do-block guard because `CREATE TYPE IF NOT EXISTS` is only supported
-- on PostgreSQL >= 16; Supabase runs 15.x on managed projects.
--
-- Idempotent: safe to re-run via `supabase db push`.

do $$
begin
  if not exists (
    select 1 from pg_type
    where typname = 'admin_role' and typnamespace = 'public'::regnamespace
  ) then
    create type public.admin_role as enum ('staff', 'admin', 'superadmin');
  end if;
end $$;
