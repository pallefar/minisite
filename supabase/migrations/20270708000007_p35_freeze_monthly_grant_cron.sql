-- Phase 35 Plan 35-02 (GAME-03) — monthly freeze-token grant cron + grant_monthly_freeze_tokens SECDEF.
--
-- Job: phase35-freeze-monthly-grant
-- Schedule: 15 0 1 * * (1st of month at 00:15 UTC — avoids midnight pile-up)
--
-- grant_monthly_freeze_tokens():
--   - Inserts +1 delta row for every active profile.
--   - Uses v_month_key = 'YYYY-MM' as source_ref.
--   - ON CONFLICT DO NOTHING on the UNIQUE INDEX (user_id, reason, source_ref) prevents
--     double-grant on cron retry (idempotency).
--   - D-08 max-stockpile (3) is enforced at READ time by freeze_tokens_remaining() clamp.
--     Overflow rows ARE inserted (for audit trail) but don't count toward usable balance.
--     A raise notice warns when a user is already at cap.
--   - Per-user exception block prevents one failure from aborting the batch.
--
-- Dollar-quote pattern (LOAD-BEARING — memory reference_postgres_dollar_quote_nesting_in_cron_body):
--   Outer: $cron$ ... $cron$
--   Inner DO block: $grant$ ... $grant$
--   Function body: $body$ ... $body$

-- ============================================================================
-- grant_monthly_freeze_tokens — SECDEF batch grant helper
-- ============================================================================

create or replace function public.grant_monthly_freeze_tokens()
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $body$
declare
  r           record;
  v_month_key text;
begin
  v_month_key := to_char(now() at time zone 'UTC', 'YYYY-MM');

  for r in
    select id as user_id from public.profiles where id is not null
  loop
    begin
      -- D-08: grant +1 free monthly.
      -- UNIQUE INDEX on (user_id, reason, source_ref) WHERE reason IN ('monthly_grant',...)
      -- prevents double-grant on cron retry (ON CONFLICT DO NOTHING = idempotent).
      insert into public.freeze_tokens_ledger (user_id, delta, reason, source_ref)
      values (r.user_id, 1, 'monthly_grant', v_month_key)
      on conflict (user_id, reason, source_ref) where reason in ('monthly_grant','auto_apply','challenge_reward')
      do nothing;

      -- D-08 max stockpile 3: enforced by freeze_tokens_remaining() at read time.
      -- Log a notice if user is already at or over cap (overflow rows still inserted for audit).
      if (select coalesce(sum(delta), 0) from public.freeze_tokens_ledger where user_id = r.user_id) > 3 then
        raise notice 'phase35-freeze-monthly-grant: user % already at cap — grant logged for audit, balance clamped to 3', r.user_id;
      end if;

    exception when others then
      raise notice 'phase35-freeze-monthly-grant: user % error % — continuing', r.user_id, sqlerrm;
    end;
  end loop;
end;
$body$;

comment on function public.grant_monthly_freeze_tokens() is
  'Phase 35 D-08 — monthly +1 freeze token grant for all profiles. '
  'Idempotent via UNIQUE INDEX + ON CONFLICT DO NOTHING on (user_id, monthly_grant, YYYY-MM). '
  'Overflow rows are inserted for audit trail but clamped to 3 at read time.';

revoke all on function public.grant_monthly_freeze_tokens() from public;
grant execute on function public.grant_monthly_freeze_tokens() to service_role;

-- ============================================================================
-- Pre-flight unschedule — idempotent re-apply
-- ============================================================================

do $unschedule$
declare
  job_name text;
begin
  for job_name in
    select jobname from cron.job
    where jobname in ('phase35-freeze-monthly-grant')
  loop
    perform cron.unschedule(job_name);
  end loop;
exception when others then
  null;
end $unschedule$;

-- ============================================================================
-- phase35-freeze-monthly-grant — 1st of month, 00:15 UTC
-- ============================================================================

select cron.schedule(
  'phase35-freeze-monthly-grant',
  '15 0 1 * *',
  $cron$
  do $grant$
  begin
    perform public.grant_monthly_freeze_tokens();
  exception when others then
    raise notice 'phase35-freeze-monthly-grant: outer error % — continuing', sqlerrm;
  end $grant$;
  $cron$
);
