-- Phase 35 Plan 35-02 (GAME-02) — hourly UTC streak evaluation cron, gated to 02:00 user-local.
--
-- Job: phase35-streak-evaluate-hourly
-- Schedule: 5 * * * * (minute 5 of every hour — avoids pile-up with cohort rebuild at 7,22,37,52
--           and leaderboard refresh at 12,27,42,57)
--
-- Per-user 02:00-local gate: evaluates only users for whom EXTRACT(HOUR FROM now() AT TIME ZONE p.timezone) = 2.
-- This ensures each user's streak is evaluated exactly once per UTC day at their local 02:00,
-- and never during their active waking hours.
--
-- DST safety: evaluate_streak_for_user is idempotent on last_eval_date — double-fire on DST
-- fall-back (when 01:00 local occurs twice) is harmless (Pitfall 2 from RESEARCH).
--
-- Per-user exception block: one user's error does not abort the entire batch.
--
-- Dollar-quote pattern (LOAD-BEARING — memory reference_postgres_dollar_quote_nesting_in_cron_body):
--   Outer: $cron$ ... $cron$
--   Inner DO block: $streak$ ... $streak$
--   A bare inner $$ would silently close the outer quote → syntax error at apply time.

create extension if not exists pg_cron;

-- ============================================================================
-- Pre-flight unschedule — idempotent re-apply (cron.schedule upserts by jobname,
-- but expression edits need an explicit unschedule first).
-- ============================================================================

do $unschedule$
declare
  job_name text;
begin
  for job_name in
    select jobname from cron.job
    where jobname in ('phase35-streak-evaluate-hourly')
  loop
    perform cron.unschedule(job_name);
  end loop;
exception when others then
  -- cron schema may not yet be visible to migration role on first apply.
  null;
end $unschedule$;

-- ============================================================================
-- phase35-streak-evaluate-hourly — 02:00 local-time streak evaluation
-- ============================================================================

select cron.schedule(
  'phase35-streak-evaluate-hourly',
  '5 * * * *',
  $cron$
  do $streak$
  declare
    r record;
  begin
    for r in
      select p.id as user_id
        from public.profiles p
       where p.timezone is not null
         and extract(hour from (now() at time zone p.timezone)) = 2
    loop
      begin
        perform public.evaluate_streak_for_user(r.user_id);
      exception when others then
        raise notice 'phase35-streak-evaluate-hourly: user % error % — continuing', r.user_id, sqlerrm;
      end;
    end loop;
  exception when others then
    raise notice 'phase35-streak-evaluate-hourly: outer loop error % — continuing', sqlerrm;
  end $streak$;
  $cron$
);

comment on extension pg_cron is 'Used by phase35-streak-evaluate-hourly (D-07) and other phase crons.';
