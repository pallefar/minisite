-- Phase 22 plan 01 — D-01: shorten account-delete soft-delete window 30d → 7d.
-- Analog: supabase/migrations/20260601000013_finalize_account_deletions_cron.sql:23-78
-- Pitfalls applied: Pitfall 1 (IMMUTABLE-safe predicate form `initiated_at + interval '7 days' <= now()`),
--                   Pitfall 2 (strict 14-digit timestamp filename).
--
-- This resolves Critical Conflict #2 (Phase 7 30-day vs P22 7-day soft-delete) per CONTEXT D-01.
-- Strategy: unschedule the existing 'finalize-account-deletions' job + re-schedule with the
-- new predicate, AND rewrite the `run_finalize_account_deletions_cron_now()` test-hook so
-- e2e tests using back-dated `initiated_at` keep working.
--
-- Note (RESEARCH §Runtime State Inventory): any existing rows back-dated >7 days will finalize
-- on the next cron tick after deploy — acceptable per production state (near-zero pending rows).
-- Newly-initiated deletions all use the 7d window via Phase 7's initiate_account_deletion()
-- since that RPC stores `initiated_at = now()` (no interval baked in).

create extension if not exists pg_cron;

-- Drop the Phase 7 30-day cron so we can re-register with the 7-day predicate.
select cron.unschedule('finalize-account-deletions')
  where exists (select 1 from cron.job where jobname = 'finalize-account-deletions');

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
         where initiated_at + interval '7 days' <= now()
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

-- Update the test-hook to match: back-dating `initiated_at` to `now() - interval '8 days'`
-- now reproduces a finalizable row instead of the previous 31-day requirement.
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
     where initiated_at + interval '7 days' <= now()
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
