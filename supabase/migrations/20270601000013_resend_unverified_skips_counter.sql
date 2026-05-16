-- Phase 22 plan 01 — D-03: counter table + increment RPC for Resend domain unverified-skips.
-- Analog: supabase/migrations/20260512000001_rate_limit_counters.sql (counter-table + atomic-increment RPC)
-- Pitfalls applied: idempotent (`create table if not exists`, `on conflict do nothing`),
--                   service_role-only grant on the RPC (no cross-tenant write surface).
--
-- D-03 contract: every lifecycle Edge Function runs the resend-domain-health-check at startup.
-- When app.leanshot.app status != 'verified', the helper logs a structured warning AND calls
-- increment_resend_domain_unverified_skips() so we can monitor the gated-send count without
-- touching Sentry. Cutover at vendor verify: zero code changes; the health check passes on next
-- invocation and sends start succeeding silently.
--
-- The keyed counter table is shared by future runtime metrics (one row per metric key); this
-- migration only seeds the resend-skips row.

create table if not exists public.email_send_counters (
  key text primary key,
  value bigint not null default 0,
  updated_at timestamptz not null default now()
);

insert into public.email_send_counters (key, value)
values ('resend_domain_unverified_skips', 0)
on conflict (key) do nothing;

create or replace function public.increment_resend_domain_unverified_skips()
returns void
language sql
security definer
set search_path = public, pg_catalog
as $$
  update public.email_send_counters
     set value = value + 1,
         updated_at = now()
   where key = 'resend_domain_unverified_skips';
$$;

revoke all on function public.increment_resend_domain_unverified_skips() from public;
grant execute on function public.increment_resend_domain_unverified_skips() to service_role;
