-- Phase 49 Plan 05 — pg_cron hourly fan-out for community digests (D-10, D-11, D-20).
-- References:
--   reference_postgres_dollar_quote_nesting_in_cron_body
--     -> outer $cron$ + inner $daily$/$weekly$/$unschedule$ named tags; tags MUST be unique
--        vs sibling cron migrations to avoid silent quote closure.
--   reference_supabase_pg_cron_vault_service_role_pattern
--     -> read service_role_key from vault.decrypted_secrets; hardcoded function URL.
--
-- Jobs registered:
--   phase49-community-daily-digest-hourly-fanout  ('5 * * * *')
--   phase49-community-weekly-digest-hourly-fanout ('15 * * * *')
--
-- Per-user TZ predicate: extract(hour from now() at p.timezone) = 9 (D-20).
-- Weekly adds extract(dow) = 0 (Sunday). Dedup via public.digest_send_log lookback.

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $unschedule$
declare job_name text;
begin
  for job_name in
    select jobname from cron.job
     where jobname in (
       'phase49-community-daily-digest-hourly-fanout',
       'phase49-community-weekly-digest-hourly-fanout'
     )
  loop
    perform cron.unschedule(job_name);
  end loop;
exception when others then null;
end $unschedule$;

-- DAILY fan-out: minute 5 each hour; predicate hour=9 in user TZ; 20h dedup window.
select cron.schedule(
  'phase49-community-daily-digest-hourly-fanout',
  '5 * * * *',
  $cron$
  do $daily$
  declare
    rec record;
    fn_url constant text := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/community-daily-digest';
    service_key text;
  begin
    select decrypted_secret into service_key
      from vault.decrypted_secrets where name = 'service_role_key' limit 1;
    if service_key is null then
      raise notice 'phase49-community-daily-digest-hourly-fanout: service_role_key missing';
      return;
    end if;
    for rec in
      select p.id as user_id
        from public.profiles p
       where extract(hour from (now() at time zone coalesce(p.timezone, 'UTC'))) = 9
         and not exists (
           select 1 from public.digest_send_log dsl
            where dsl.user_id = p.id and dsl.kind = 'daily'
              and dsl.sent_at > now() - interval '20 hours'
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
  $daily$;
  $cron$
);

-- WEEKLY fan-out: minute 15 each hour; predicate dow=0 (Sunday) + hour=9 in user TZ; 6-day dedup window.
select cron.schedule(
  'phase49-community-weekly-digest-hourly-fanout',
  '15 * * * *',
  $cron$
  do $weekly$
  declare
    rec record;
    fn_url constant text := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/community-weekly-digest';
    service_key text;
  begin
    select decrypted_secret into service_key
      from vault.decrypted_secrets where name = 'service_role_key' limit 1;
    if service_key is null then
      raise notice 'phase49-community-weekly-digest-hourly-fanout: service_role_key missing';
      return;
    end if;
    for rec in
      select p.id as user_id
        from public.profiles p
       where extract(dow  from (now() at time zone coalesce(p.timezone, 'UTC'))) = 0
         and extract(hour from (now() at time zone coalesce(p.timezone, 'UTC'))) = 9
         and not exists (
           select 1 from public.digest_send_log dsl
            where dsl.user_id = p.id and dsl.kind = 'weekly'
              and dsl.sent_at > now() - interval '6 days'
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
  $weekly$;
  $cron$
);
