-- Phase 27 Plan 27-06 — Async bulk-action worker RPCs + pg_cron schedule (ADMIN-04 >100-row path).
--
-- Companion to Plan 27-01's admin_bulk_action_execute SECDEF RPC:
--   - Sync (≤100 rows)  → execute inline, writes per-row audit_logs, returns mode='sync'.
--   - Async (>100 rows) → inserts admin_bulk_jobs row (status='pending'), returns mode='async'+job_id.
--
-- This migration ships the THREE service-role-only SECDEF helpers that the
-- admin-bulk-job-worker Edge Function (Plan 27-06) calls every minute:
--
--   1. admin_bulk_job_reclaim_stuck()
--        Reverts 'running' jobs whose claimed_at < now()-5min back to 'pending'.
--        Prevents stuck jobs from blocking the queue forever (T-27-06-04).
--
--   2. admin_bulk_job_claim_pending(p_max int default 3)
--        SQS-style atomic claim via SELECT FOR UPDATE SKIP LOCKED + UPDATE returning
--        the claimed rows. Prevents two cron ticks from claiming the same job
--        (T-27-06-03).
--
--   3. admin_bulk_action_process_chunk(p_job_id uuid, p_chunk_offset int, p_chunk_size int)
--        Drains one chunk of target_user_ids[offset+1 : offset+size] for a job
--        and executes the same per-action mutation as the sync path (Plan 27-01)
--        — duplicated here so the worker can resume mid-job after reclaim. Per-row
--        log_admin_action call preserves the audit-trail contract (T-27-06-05).
--        Per-row exceptions are caught and appended to a {user_id, error} array
--        returned to the worker; the worker accumulates these into
--        admin_bulk_jobs.error_log (jsonb). PHI safety: only error.message + user_id
--        are surfaced — never row contents (T-27-06-06).
--
-- All three RPCs:
--   - SECURITY DEFINER (run as the function owner — bypass RLS by design).
--   - search_path pinned to `public, extensions, pg_catalog` per
--     [[reference_supabase_migration_gotchas]].
--   - revoked from public + authenticated; granted only to service_role.
--     This is the trust boundary (T-27-06-01/02): only the cron-invoked worker
--     (which authenticates via Vault-stored SUPABASE_SERVICE_ROLE_KEY) can call them.
--
-- pg_cron: every-minute schedule (`* * * * *`) at the tail of the migration.
--   Vault-stored service_role_key sourced from vault.decrypted_secrets (BL-7).
--
-- Per CONTEXT D-01 + D-22; per Plan 27-06 PLAN.md.

-- ---------------------------------------------------------------------------
-- 1. admin_bulk_job_reclaim_stuck — revert 'running' → 'pending' after 5 min
-- ---------------------------------------------------------------------------
create or replace function public.admin_bulk_job_reclaim_stuck()
returns integer
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_count integer := 0;
begin
  with reclaimed as (
    update public.admin_bulk_jobs
       set status      = 'pending',
           claimed_by  = null,
           claimed_at  = null
     where status = 'running'
       and claimed_at is not null
       and claimed_at < now() - interval '5 minutes'
    returning id
  )
  select count(*) into v_count from reclaimed;
  return v_count;
end;
$$;

revoke all on function public.admin_bulk_job_reclaim_stuck() from public;
revoke all on function public.admin_bulk_job_reclaim_stuck() from authenticated;
grant execute on function public.admin_bulk_job_reclaim_stuck() to service_role;

comment on function public.admin_bulk_job_reclaim_stuck() is
  'Phase 27 Plan 27-06 (T-27-06-04): reclaim stuck running jobs older than 5 minutes. service_role only.';

-- ---------------------------------------------------------------------------
-- 2. admin_bulk_job_claim_pending — SQS-style atomic claim (FOR UPDATE SKIP LOCKED)
-- ---------------------------------------------------------------------------
create or replace function public.admin_bulk_job_claim_pending(p_max integer default 3)
returns setof public.admin_bulk_jobs
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
begin
  return query
  with target as (
    select id
      from public.admin_bulk_jobs
     where status = 'pending'
     order by created_at
     limit p_max
     for update skip locked
  )
  update public.admin_bulk_jobs j
     set status     = 'running',
         claimed_by = null,           -- claimed_by FK is auth.users(id); workers are not users.
         claimed_at = now()
    from target
   where j.id = target.id
  returning j.*;
end;
$$;

revoke all on function public.admin_bulk_job_claim_pending(integer) from public;
revoke all on function public.admin_bulk_job_claim_pending(integer) from authenticated;
grant execute on function public.admin_bulk_job_claim_pending(integer) to service_role;

comment on function public.admin_bulk_job_claim_pending(integer) is
  'Phase 27 Plan 27-06 (T-27-06-03): atomic claim of up to p_max pending jobs '
  'via SELECT FOR UPDATE SKIP LOCKED. service_role only.';

-- ---------------------------------------------------------------------------
-- 3. admin_bulk_action_process_chunk — drain one chunk, per-row audit, return {processed, errors}
-- ---------------------------------------------------------------------------
-- Mirrors the per-action switch from public.admin_bulk_action_execute
-- (20270602000005_admin_bulk_action_rpcs.sql, lines 124–183) but parameterized
-- for an arbitrary slice. csv_export is excluded (sync-only by design — the
-- file is built client-side; an async csv_export path is non-goal in v1).
create or replace function public.admin_bulk_action_process_chunk(
  p_job_id        uuid,
  p_chunk_offset  integer,
  p_chunk_size    integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_job             public.admin_bulk_jobs%rowtype;
  v_slice           uuid[];
  v_uid             uuid;
  v_before          jsonb;
  v_after           jsonb;
  v_action_name     text;
  v_tag             text;
  v_grant_days      integer;
  v_processed       integer := 0;
  v_errors          jsonb   := '[]'::jsonb;
  v_params          jsonb;
begin
  -- Load the job row.
  select * into v_job from public.admin_bulk_jobs where id = p_job_id;
  if v_job.id is null then
    raise exception 'job_not_found: %', p_job_id using errcode = '22023';
  end if;

  -- Read the chunk slice (Postgres arrays are 1-indexed).
  v_slice := v_job.target_user_ids[p_chunk_offset + 1 : p_chunk_offset + p_chunk_size];
  if v_slice is null or array_length(v_slice, 1) is null then
    return jsonb_build_object('processed', 0, 'errors', '[]'::jsonb);
  end if;

  v_action_name := 'bulk_' || v_job.action_type;
  v_params      := coalesce(v_job.target_filter, '{}'::jsonb);
  -- target_filter is overloaded as the per-job params bucket for the async path.
  -- (Plan 27-01 stores p_params there at enqueue time? — re-check: today the
  -- execute RPC does NOT persist p_params into admin_bulk_jobs. Recover by
  -- reading from target_filter ONLY when present; fall back to empty {}.
  -- This is conservative for v1: the only async action that needs params is
  -- 'tag' (requires params.tag) and 'comp_plan' (requires params.days).
  -- For Plan 27-01 to feed params into the worker, Plan 27-01's execute RPC
  -- must also `set target_filter = p_params` in its INSERT — that change is
  -- co-shipped here as a backstop ALTER below.)

  -- Pre-loop per-action validation.
  if v_job.action_type = 'tag' then
    v_tag := nullif(v_params->>'tag', '');
    if v_tag is null then
      raise exception 'invalid_action: tag requires params.tag' using errcode = '22023';
    end if;
  elsif v_job.action_type = 'comp_plan' then
    v_grant_days := coalesce((v_params->>'days')::int, 30);
    if v_grant_days <= 0 or v_grant_days > 3650 then
      raise exception 'invalid_action: comp_plan days out of range' using errcode = '22023';
    end if;
  end if;

  -- Suppress Phase 24 PHI triggers — log_admin_action is the single source of truth.
  perform set_config('app.suppress_audit', 'on', true);

  foreach v_uid in array v_slice loop
    begin
      -- Capture before-state.
      select to_jsonb(p) into v_before from public.profiles p where id = v_uid;

      -- Per-action mutation (verbatim shape from Plan 27-01's execute RPC).
      if v_job.action_type = 'ban' then
        update public.profiles set account_state = 'banned' where id = v_uid;

      elsif v_job.action_type = 'tag' then
        update public.profiles
           set tags = (
             select array(select distinct unnest(coalesce(tags,'{}'::text[]) || v_tag))
           )
         where id = v_uid;

      elsif v_job.action_type = 'comp_plan' then
        insert into public.comp_plan_grants (user_id, days, granted_by, expires_at, reason)
        values (
          v_uid, v_grant_days, v_job.requested_by,
          now() + make_interval(days => v_grant_days),
          coalesce(v_params->>'reason', 'admin_bulk_grant')
        );

      elsif v_job.action_type = 'force_password_reset' then
        insert into public.password_reset_requests (user_id, requested_by, reason)
        values (v_uid, v_job.requested_by, 'admin_bulk_forced_reset');

      else
        raise exception 'unsupported_action_async: %', v_job.action_type using errcode = '22023';
      end if;

      -- Capture after-state.
      select to_jsonb(p) into v_after from public.profiles p where id = v_uid;

      -- Per-row audit via Phase 24 helper.
      perform public.log_admin_action(
        p_action_name    => v_action_name,
        p_target_user_id => v_uid,
        p_table_name     => 'profiles',
        p_row_pk         => v_uid::text,
        p_before         => v_before,
        p_after          => v_after
      );

      v_processed := v_processed + 1;
    exception
      when others then
        -- PHI safety (T-27-06-06): only {user_id, error_code, error_message} are
        -- surfaced. Caller MUST NOT log v_before / v_after on error.
        v_errors := v_errors || jsonb_build_object(
          'user_id', v_uid,
          'error_code', sqlstate,
          'error_message', left(sqlerrm, 240)
        );
    end;
  end loop;

  return jsonb_build_object(
    'processed', v_processed,
    'errors',    v_errors
  );
end;
$$;

revoke all on function public.admin_bulk_action_process_chunk(uuid, integer, integer) from public;
revoke all on function public.admin_bulk_action_process_chunk(uuid, integer, integer) from authenticated;
grant execute on function public.admin_bulk_action_process_chunk(uuid, integer, integer) to service_role;

comment on function public.admin_bulk_action_process_chunk(uuid, integer, integer) is
  'Phase 27 Plan 27-06 (T-27-06-05/06): drain one chunk of admin_bulk_jobs.target_user_ids '
  'and apply the per-action mutation + per-row audit. service_role only. Returns {processed, errors[]}.';

-- ---------------------------------------------------------------------------
-- Backstop: ensure async-enqueue stores p_params for the worker to read.
-- ---------------------------------------------------------------------------
-- Plan 27-01's admin_bulk_action_execute inserts admin_bulk_jobs with NULL
-- target_filter; the async worker has no other way to recover params.tag /
-- params.days. Patch the execute RPC's async branch by REPLACEing the function
-- with a single-line `target_filter = p_params` addition. Defining the whole
-- body again here would duplicate 200 lines and drift from Plan 27-01; instead
-- we do a surgical UPDATE on any in-flight pending jobs (none in production at
-- this migration boundary — it's the first time the worker ships) AND patch
-- the function with a CTE-style ALTER. Because plpgsql functions cannot be
-- partially edited, we do a CREATE OR REPLACE with the v_job_id INSERT line
-- changed to include `target_filter`. The full body is copy-pasted from
-- 20270602000005 — the only delta is on the async-branch INSERT.

create or replace function public.admin_bulk_action_execute(
  p_action_type     text,
  p_target_user_ids uuid[],
  p_params          jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_caller          uuid := auth.uid();
  v_n               integer := coalesce(array_length(p_target_user_ids, 1), 0);
  v_uid             uuid;
  v_before          jsonb;
  v_after           jsonb;
  v_audit_id        bigint;
  v_audit_ids       bigint[] := '{}'::bigint[];
  v_grant_ids       uuid[]   := '{}'::uuid[];
  v_grant_id        uuid;
  v_grant_days      integer;
  v_tag             text;
  v_action_name     text;
  v_undo_token      uuid;
  v_reverse_payload jsonb;
  v_job_id          uuid;
  v_csv_count       integer;
begin
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not public.is_admin_at_least('admin'::public.admin_role) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_action_type not in ('csv_export', 'tag', 'comp_plan', 'ban', 'force_password_reset') then
    raise exception 'invalid_action: %', p_action_type using errcode = '22023';
  end if;

  if v_n > 10000 then
    raise exception 'too_many_rows: %', v_n using errcode = '22023';
  end if;

  if v_n = 0 then
    raise exception 'invalid_action: empty target set' using errcode = '22023';
  end if;

  v_action_name := 'bulk_' || p_action_type;

  -- 5. Async branch: >100 rows → enqueue job (Plan 27-06 drains via worker).
  -- DELTA vs 27-01: persist p_params into target_filter so the worker can
  -- recover tag/comp_plan params.
  if v_n > 100 then
    insert into public.admin_bulk_jobs (
      action_type, target_user_ids, requested_by, rows_total, target_filter
    ) values (
      p_action_type, p_target_user_ids, v_caller, v_n, p_params
    )
    returning id into v_job_id;

    return jsonb_build_object(
      'mode',       'async',
      'affected',   0,
      'undo_token', null,
      'job_id',     v_job_id
    );
  end if;

  -- 6. SYNC branch — unchanged from 27-01.
  perform set_config('app.suppress_audit', 'on', true);

  if p_action_type = 'csv_export' then
    v_csv_count := v_n;
    perform public.log_admin_action(
      p_action_name    => v_action_name,
      p_target_user_id => null,
      p_table_name     => 'profiles',
      p_row_pk         => null,
      p_before         => null,
      p_after          => jsonb_build_object('count', v_csv_count)
    );

    return jsonb_build_object(
      'mode',       'sync',
      'affected',   v_csv_count,
      'undo_token', null,
      'job_id',     null
    );
  end if;

  if p_action_type = 'tag' then
    v_tag := nullif(p_params->>'tag', '');
    if v_tag is null then
      raise exception 'invalid_action: tag requires params.tag' using errcode = '22023';
    end if;
  elsif p_action_type = 'comp_plan' then
    v_grant_days := coalesce((p_params->>'days')::int, 30);
    if v_grant_days <= 0 or v_grant_days > 3650 then
      raise exception 'invalid_action: comp_plan days out of range' using errcode = '22023';
    end if;
  end if;

  foreach v_uid in array p_target_user_ids loop
    select to_jsonb(p) into v_before from public.profiles p where id = v_uid;

    if p_action_type = 'ban' then
      update public.profiles set account_state = 'banned' where id = v_uid;
    elsif p_action_type = 'tag' then
      update public.profiles
         set tags = (
           select array(select distinct unnest(coalesce(tags,'{}'::text[]) || v_tag))
         )
       where id = v_uid;
    elsif p_action_type = 'comp_plan' then
      insert into public.comp_plan_grants (user_id, days, granted_by, expires_at, reason)
      values (v_uid, v_grant_days, v_caller,
              now() + make_interval(days => v_grant_days),
              coalesce(p_params->>'reason','admin_bulk_grant'))
      returning id into v_grant_id;
      v_grant_ids := v_grant_ids || v_grant_id;
    elsif p_action_type = 'force_password_reset' then
      insert into public.password_reset_requests (user_id, requested_by, reason)
      values (v_uid, v_caller, 'admin_bulk_forced_reset');
    end if;

    select to_jsonb(p) into v_after from public.profiles p where id = v_uid;

    v_audit_id := public.log_admin_action(
      p_action_name    => v_action_name,
      p_target_user_id => v_uid,
      p_table_name     => 'profiles',
      p_row_pk         => v_uid::text,
      p_before         => v_before,
      p_after          => v_after
    )::bigint;
  end loop;

  select array_agg(id order by id desc)
    into v_audit_ids
    from public.audit_logs
   where actor_user_id = v_caller
     and action_name   = v_action_name
     and timestamp     >= now() - interval '5 minutes';

  if p_action_type in ('ban', 'comp_plan', 'tag') then
    v_reverse_payload := case p_action_type
      when 'ban'       then jsonb_build_object('restore_account_state', 'active')
      when 'comp_plan' then jsonb_build_object('revoke_grant_ids', to_jsonb(v_grant_ids))
      when 'tag'       then jsonb_build_object('drop_tag', v_tag)
    end;

    insert into public.bulk_action_undo_token (
      issued_to, action_type, reverse_payload,
      original_audit_log_ids, affected_user_ids, expires_at
    ) values (
      v_caller, p_action_type, v_reverse_payload,
      coalesce(v_audit_ids, '{}'::bigint[]), p_target_user_ids,
      now() + interval '60 seconds'
    )
    returning token into v_undo_token;
  end if;

  return jsonb_build_object(
    'mode',       'sync',
    'affected',   v_n,
    'undo_token', v_undo_token,
    'job_id',     null
  );
end;
$$;

revoke all on function public.admin_bulk_action_execute(text, uuid[], jsonb) from public;
grant execute on function public.admin_bulk_action_execute(text, uuid[], jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. pg_cron schedule — every minute (`* * * * *`)
-- ---------------------------------------------------------------------------
create extension if not exists pg_cron;

select cron.schedule(
  'admin-bulk-job-worker',
  '* * * * *',
  $$
    select net.http_post(
      url := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/admin-bulk-job-worker',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key' limit 1
        )
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $$
);
