-- Phase 38 Plan 38-09 — pg_cron schedules for the AI recommender / digest / winback / soft-delete cleanup.
--
-- Jobs registered (4):
--   1. phase38-weekly-digest-hourly-fanout (0 * * * *) — per-user-timezone Sunday 09:00 LOCAL fan-out with 6h dedup.
--   2. phase38-embed-content-nightly       (0 3 * * *) — HTTP invoke embed-content-nightly Edge Fn.
--   3. phase38-winback-scorer-nightly      (0 4 * * *) — HTTP invoke winback-scorer Edge Fn (Plan 38-07, ships in same wave).
--   4. phase38-softdelete-cleanup-daily    (0 5 * * *) — direct SQL: SELECT public.cleanup_content_embeddings_soft_deleted().
--
-- Patterns honored (memory references — load-bearing):
--   - [[reference_supabase_pg_cron_vault_service_role_pattern]]: vault.decrypted_secrets row name='service_role_key'
--     + hardcoded URL `https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/<name>` (NO `current_setting('app.*')` GUC).
--   - [[reference_postgres_dollar_quote_nesting_in_cron_body]]: outer `$cron$ ... $cron$` plus UNIQUE inner named tags
--     (`$digest$`, `$embed$`, `$winback$`, `$cleanup$`). A bare inner `$$` would silently close the outer quote
--     and crash with "syntax error at or near DECLARE" at apply time.
--
-- Idempotency: cron.schedule() upserts by jobname; the leading DO-block unschedules any pre-existing entry so
-- re-running this migration after a cron-expression change is safe.
--
-- pg_cron + pg_net are already enabled from Phase 19/22; the `create extension if not exists` calls are guards.
-- Project ref `ytnsipxxmzgaebkqmokp` is the LeanShot Supabase project (memory: reference_supabase_project).

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ----------------------------------------------------------------------------
-- Pre-flight: unschedule any pre-existing phase38 jobs so re-running this
-- migration with adjusted cron expressions is safe.
-- ----------------------------------------------------------------------------
do $unschedule$
declare
  job_name text;
begin
  for job_name in
    select jobname from cron.job
    where jobname in (
      'phase38-weekly-digest-hourly-fanout',
      'phase38-embed-content-nightly',
      'phase38-winback-scorer-nightly',
      'phase38-softdelete-cleanup-daily'
    )
  loop
    perform cron.unschedule(job_name);
  end loop;
exception when others then
  -- Ignore: cron schema may not be visible to migration role on first apply.
  null;
end $unschedule$;

-- ----------------------------------------------------------------------------
-- 1. weekly-digest-hourly-fanout — per-user-timezone Sunday 09:00 LOCAL fan-out.
--    Runs every hour; selects opted-in profiles whose local time is currently
--    Sunday 09:00 and have not been sent a digest in the last 6 hours (dedup).
--    For each match, fires net.http_post to the weekly-digest Edge Fn body={user_id}.
-- ----------------------------------------------------------------------------
select cron.schedule(
  'phase38-weekly-digest-hourly-fanout',
  '0 * * * *',
  $cron$
  do $digest$
  declare
    rec record;
    fn_url constant text := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/weekly-digest';
    service_key text;
  begin
    select decrypted_secret
      into service_key
      from vault.decrypted_secrets
     where name = 'service_role_key'
     limit 1;

    if service_key is null then
      raise notice 'phase38-weekly-digest-hourly-fanout: service_role_key vault entry missing — skipping fan-out';
      return;
    end if;

    for rec in
      select p.id as user_id
        from public.profiles p
       where exists (
               select 1
                 from public.user_preferences up
                where up.user_id = p.id
                  and up.weekly_digest_opt_in = true
             )
         and extract(dow  from (now() at time zone coalesce(p.timezone, 'UTC'))) = 0
         and extract(hour from (now() at time zone coalesce(p.timezone, 'UTC'))) = 9
         and not exists (
               select 1
                 from public.weekly_digest_sends wds
                where wds.user_id = p.id
                  and wds.sent_at > now() - interval '6 hours'
             )
    loop
      perform net.http_post(
        url := fn_url,
        body := jsonb_build_object('user_id', rec.user_id),
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || service_key,
          'Content-Type', 'application/json'
        ),
        timeout_milliseconds := 60000
      );
    end loop;
  end;
  $digest$;
  $cron$
);

-- ----------------------------------------------------------------------------
-- 2. embed-content-nightly — nightly batch embed of stale / new content rows.
-- ----------------------------------------------------------------------------
select cron.schedule(
  'phase38-embed-content-nightly',
  '0 3 * * *',
  $cron$
  do $embed$
  declare
    fn_url constant text := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/embed-content-nightly';
    service_key text;
  begin
    select decrypted_secret
      into service_key
      from vault.decrypted_secrets
     where name = 'service_role_key'
     limit 1;

    if service_key is null then
      raise notice 'phase38-embed-content-nightly: service_role_key vault entry missing — skipping';
      return;
    end if;

    perform net.http_post(
      url := fn_url,
      body := '{}'::jsonb,
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || service_key,
        'Content-Type', 'application/json'
      ),
      timeout_milliseconds := 600000
    );
  end;
  $embed$;
  $cron$
);

-- ----------------------------------------------------------------------------
-- 3. winback-scorer-nightly — nightly score of dormant users for win-back digest.
--    NOTE: winback-scorer Edge Fn ships in Plan 38-07 (same wave). Until that
--    deploys the cron fires + net.http_post returns 404; the cron job entry
--    itself is still registered correctly (verified by Task 1 done criterion).
-- ----------------------------------------------------------------------------
select cron.schedule(
  'phase38-winback-scorer-nightly',
  '0 4 * * *',
  $cron$
  do $winback$
  declare
    fn_url constant text := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/winback-scorer';
    service_key text;
  begin
    select decrypted_secret
      into service_key
      from vault.decrypted_secrets
     where name = 'service_role_key'
     limit 1;

    if service_key is null then
      raise notice 'phase38-winback-scorer-nightly: service_role_key vault entry missing — skipping';
      return;
    end if;

    perform net.http_post(
      url := fn_url,
      body := '{}'::jsonb,
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || service_key,
        'Content-Type', 'application/json'
      ),
      timeout_milliseconds := 600000
    );
  end;
  $winback$;
  $cron$
);

-- ----------------------------------------------------------------------------
-- 4. softdelete-cleanup-daily — direct SQL cleanup of content_embeddings rows
--    whose parent content row was soft-deleted >7 days ago (D-19 cascade).
--    Plan 38-01 migration 20270705000011 created the function.
-- ----------------------------------------------------------------------------
select cron.schedule(
  'phase38-softdelete-cleanup-daily',
  '0 5 * * *',
  $cron$
  do $cleanup$
  begin
    perform public.cleanup_content_embeddings_soft_deleted();
  exception when others then
    raise notice 'phase38-softdelete-cleanup-daily: cleanup raised % — continuing', sqlerrm;
  end;
  $cleanup$;
  $cron$
);
