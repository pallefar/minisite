-- Phase 34 Plan 34-02 (D-09) — 30-day TTL for orphan anonymous sessions.
--
-- Weekly direct SQL DELETE; no Edge Fn / vault / pg_net call needed.
-- Sibling plan 34-01 ships the `public.anonymous_sessions` table; this cron
-- runs after it is live and is safe to apply earlier (job only fires on the
-- weekly cron tick, and DELETE on an empty table is a no-op).
--
-- Patterns honored (memory references — load-bearing):
--   - [[reference_postgres_dollar_quote_nesting_in_cron_body]]: outer
--     `$cron$ ... $cron$` plus a UNIQUE named inner tag `$anon_ttl$ ... $anon_ttl$`.
--     A bare inner `$$` would silently close the outer quote and crash with
--     "syntax error at or near DECLARE" at apply time. NEVER use bare `$$`
--     inside the cron body.
--   - [[reference_supabase_pg_cron_vault_service_role_pattern]]: not needed
--     here because the cron body is plain SQL — no HTTP / Edge Fn invocation.
--
-- Idempotency: `cron.schedule()` upserts by jobname; the leading DO-block
-- unschedules any pre-existing entry so re-running this migration after a
-- cron-expression change is safe.

create extension if not exists pg_cron;

-- ----------------------------------------------------------------------------
-- Pre-flight: unschedule any pre-existing phase34 job so re-running this
-- migration with adjusted cron expressions is safe.
-- ----------------------------------------------------------------------------
do $unschedule$
declare
  job_name text;
begin
  for job_name in
    select jobname from cron.job
    where jobname in (
      'phase34-anon-session-ttl-weekly'
    )
  loop
    perform cron.unschedule(job_name);
  end loop;
exception when others then
  -- Ignore: cron schema may not be visible to migration role on first apply.
  null;
end $unschedule$;

-- ----------------------------------------------------------------------------
-- phase34-anon-session-ttl-weekly — Sunday 03:00 UTC weekly hygiene.
-- Deletes `anonymous_sessions` rows older than 30 days whose `merged_user_id`
-- is still NULL (i.e. never claimed by a real account). Merged rows are
-- retained because they may still be referenced by downstream artifacts.
-- ----------------------------------------------------------------------------
select cron.schedule(
  'phase34-anon-session-ttl-weekly',
  '0 3 * * 0',   -- Sunday 03:00 UTC weekly
  $cron$
  do $anon_ttl$
  begin
    delete from public.anonymous_sessions
     where last_activity_at < now() - interval '30 days'
       and merged_user_id is null;
  exception when others then
    raise notice 'phase34-anon-session-ttl-weekly: error % — continuing', sqlerrm;
  end;
  $anon_ttl$;
  $cron$
);

comment on extension pg_cron is 'D-09 anonymous session TTL + future phase crons';
