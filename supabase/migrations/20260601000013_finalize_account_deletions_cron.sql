-- Phase 7 D-03 T+30 cron registration. Plan 07-07 / COMPL-06.
--
-- Mirrors the Phase 4 anon-cleanup pattern (20260512000002_anon_cleanup_pg_cron.sql).
-- Schedule cadence:
--   03:00 UTC — cleanup-anon-users      (Phase 4)
--   04:00 UTC — finalize-account-deletions (this migration) ←
--   05:00 UTC — cleanup-audit-logs      (Phase 7 07-08)
-- One-hour offsets keep the daily compute spread out on free-tier.
--
-- STRIDE register:
--   T-07-07-D1 DoS (mass-delete burst): chunked finalize, max 50 rows per
--     tick (`for update skip locked` + `limit 50`). 24h cadence + 50/tick
--     cap = ~1500 finalizes/month worst-case, comfortably within free-tier
--     compute. `finalize_attempts < 5` partial-index filter keeps stuck
--     rows from blocking the queue forever — they get surfaced to ops at
--     attempt 5 and excluded from subsequent scans.
--   T-07-07-D2 DoS (single-row hang): inner per-row begin/exception block
--     swallows per-finalize failures; finalize_attempts has already been
--     incremented inside finalize_account_deletion's own exception handler.

create extension if not exists pg_cron;

select cron.schedule(
  'finalize-account-deletions',
  '0 4 * * *',
  $$
    do $body$
    declare
      v_uid uuid;
    begin
      for v_uid in
        select user_id from public.pending_account_deletions
         where initiated_at + interval '30 days' <= now()
           and finalize_attempts < 5
         order by initiated_at
         limit 50
         for update skip locked
      loop
        begin
          perform public.finalize_account_deletion(v_uid);
        exception when others then
          -- Already logged + counter incremented inside the fn; continue loop.
          null;
        end;
      end loop;
    end
    $body$;
  $$
);

-- Test hook for the e2e spec — wraps the same chunked iteration in a
-- service-role-only RPC so the spec can simulate the T+30 tick without
-- waiting 30 days. Back-dating `initiated_at` to `now() - interval '31 days'`
-- on a row then calling this function reproduces the cron tick exactly.
--
-- T-07-07-E2: no grants to authenticated/anon — service_role only.
create or replace function public.run_finalize_account_deletions_cron_now()
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_uid uuid;
begin
  for v_uid in
    select user_id from public.pending_account_deletions
     where initiated_at + interval '30 days' <= now()
     limit 50
  loop
    begin
      perform public.finalize_account_deletion(v_uid);
    exception when others then
      null;
    end;
  end loop;
end;
$$;

revoke all on function public.run_finalize_account_deletions_cron_now() from public;
-- Service-role only (no grant to authenticated/anon).
