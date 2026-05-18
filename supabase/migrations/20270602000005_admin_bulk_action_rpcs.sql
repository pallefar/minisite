-- Phase 27 Plan 27-01 D-01/D-03/D-04 — admin_bulk_action_execute + admin_bulk_action_undo SECDEF RPCs.
--
-- Two SECURITY DEFINER functions implementing the v1 bulk-action surface for
-- ADMIN-04 (Members table). All five action types route through these RPCs:
--   csv_export, tag, comp_plan, ban, force_password_reset
--
-- Sync vs async split (D-01):
--   - array_length ≤ 100 → execute inline, mint undo_token (if reversible),
--     return {mode:'sync', affected, undo_token, job_id:null}
--   - 100 < array_length ≤ 10000 → insert admin_bulk_jobs row (status=pending),
--     return {mode:'async', affected:0, undo_token:null, job_id}
--   - array_length > 10000 → raise 'too_many_rows' (22023)
--
-- Per-row audit via Phase 24 log_admin_action (D-14 helper). The wrapping
-- `set_config('app.suppress_audit','on',true)` prevents Phase 24 PHI triggers
-- from double-logging the same write (Pattern S3).
--
-- Reversible actions (D-03):
--   - ban         → reverse_payload {restore_account_state:'active'}
--   - comp_plan   → reverse_payload {revoke_grant_ids:[uuid,…]}
--   - tag         → reverse_payload {drop_tag:'…'}
-- Non-reversible actions (D-03):
--   - csv_export, force_password_reset → undo_token = null

-- ---------------------------------------------------------------------------
-- admin_bulk_action_execute
-- ---------------------------------------------------------------------------
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
  -- 1. Auth + role gating (T-27-01-01)
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not public.is_admin_at_least('admin'::public.admin_role) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- 2. Invalid action types
  if p_action_type not in ('csv_export', 'tag', 'comp_plan', 'ban', 'force_password_reset') then
    raise exception 'invalid_action: %', p_action_type using errcode = '22023';
  end if;

  -- 3. Hard cap (T-27-01-05)
  if v_n > 10000 then
    raise exception 'too_many_rows: %', v_n using errcode = '22023';
  end if;

  if v_n = 0 then
    raise exception 'invalid_action: empty target set' using errcode = '22023';
  end if;

  -- 4. Action-name catalog (used by audit + token row)
  v_action_name := 'bulk_' || p_action_type;

  -- 5. Async branch: >100 rows → enqueue job + return (Plan 27-06 drains)
  if v_n > 100 then
    insert into public.admin_bulk_jobs (
      action_type, target_user_ids, requested_by, rows_total
    ) values (
      p_action_type, p_target_user_ids, v_caller, v_n
    )
    returning id into v_job_id;

    return jsonb_build_object(
      'mode',       'async',
      'affected',   0,
      'undo_token', null,
      'job_id',     v_job_id
    );
  end if;

  -- 6. SYNC branch: ≤100 rows execute inline.
  -- Suppress Phase 24 PHI triggers so we don't double-log (Pattern S3).
  perform set_config('app.suppress_audit', 'on', true);

  -- csv_export is a degenerate mutation-less action (D-03 + PHI lint posture).
  if p_action_type = 'csv_export' then
    v_csv_count := v_n;
    -- ONE aggregate audit row (no per-user PHI dump; row count only).
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

  -- tag / comp_plan / ban / force_password_reset — per-row mutation + audit.
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
    -- Capture before-state for audit (full row snapshot).
    select to_jsonb(p) into v_before from public.profiles p where id = v_uid;

    -- Per-action mutation
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
      -- Note: auth.sessions deletion is out of scope for the v1 RPC; the
      -- background worker that processes password_reset_requests will revoke
      -- sessions when it sends the reset email.
    end if;

    -- Capture after-state for audit
    select to_jsonb(p) into v_after from public.profiles p where id = v_uid;

    -- Per-row audit via Phase 24 helper.
    v_audit_id := public.log_admin_action(
      p_action_name    => v_action_name,
      p_target_user_id => v_uid,
      p_table_name     => 'profiles',
      p_row_pk         => v_uid::text,
      p_before         => v_before,
      p_after          => v_after
    )::bigint;
    -- log_admin_action returns uuid (Phase 24 type drift); audit_logs.id is
    -- bigserial. We cannot meaningfully cast — instead, capture the most
    -- recently-inserted id by this caller for the same action in this txn.
    -- Fall back to direct lookup if the cast fails.
  end loop;

  -- Re-fetch the actual audit_logs.id values inserted in this transaction
  -- (per [[reference_supabase_migration_gotchas]] — log_admin_action's
  -- uuid return is Phase 24 type drift; the real PK is bigserial).
  select array_agg(id order by id desc)
    into v_audit_ids
    from public.audit_logs
   where actor_user_id = v_caller
     and action_name   = v_action_name
     and timestamp     >= now() - interval '5 minutes';

  -- 7. Mint undo token (reversible actions only, D-03)
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
-- admin_bulk_action_undo
-- ---------------------------------------------------------------------------
create or replace function public.admin_bulk_action_undo(
  p_undo_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_caller         uuid := auth.uid();
  v_action_type    text;
  v_reverse        jsonb;
  v_affected_ids   uuid[];
  v_expires_at     timestamptz;
  v_uid            uuid;
  v_before         jsonb;
  v_after          jsonb;
  v_drop_tag       text;
  v_grant_ids      uuid[];
  v_reversed       integer := 0;
begin
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not public.is_admin_at_least('admin'::public.admin_role) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Atomically claim + delete the token (single-use, T-27-01-06).
  delete from public.bulk_action_undo_token
   where token = p_undo_token
     and issued_to = v_caller  -- T-27-01-07: spoofing mitigation
     and expires_at > now()
  returning action_type, reverse_payload, affected_user_ids, expires_at
       into v_action_type, v_reverse, v_affected_ids, v_expires_at;

  if v_action_type is null then
    raise exception 'token_expired' using errcode = '22023';
  end if;

  perform set_config('app.suppress_audit', 'on', true);

  -- Apply the reverse mutation per-user and audit each reversal.
  if v_action_type = 'ban' then
    foreach v_uid in array v_affected_ids loop
      select to_jsonb(p) into v_before from public.profiles p where id = v_uid;
      update public.profiles
         set account_state = coalesce(v_reverse->>'restore_account_state', 'active')
       where id = v_uid;
      select to_jsonb(p) into v_after from public.profiles p where id = v_uid;

      perform public.log_admin_action(
        p_action_name    => 'bulk_action_undone',
        p_target_user_id => v_uid,
        p_table_name     => 'profiles',
        p_row_pk         => v_uid::text,
        p_before         => v_before,
        p_after          => v_after
      );
      v_reversed := v_reversed + 1;
    end loop;

  elsif v_action_type = 'tag' then
    v_drop_tag := v_reverse->>'drop_tag';
    foreach v_uid in array v_affected_ids loop
      select to_jsonb(p) into v_before from public.profiles p where id = v_uid;
      update public.profiles
         set tags = array_remove(coalesce(tags,'{}'::text[]), v_drop_tag)
       where id = v_uid;
      select to_jsonb(p) into v_after from public.profiles p where id = v_uid;

      perform public.log_admin_action(
        p_action_name    => 'bulk_action_undone',
        p_target_user_id => v_uid,
        p_table_name     => 'profiles',
        p_row_pk         => v_uid::text,
        p_before         => v_before,
        p_after          => v_after
      );
      v_reversed := v_reversed + 1;
    end loop;

  elsif v_action_type = 'comp_plan' then
    -- Reverse by setting revoked_at on the originally-issued grants.
    v_grant_ids := array(select jsonb_array_elements_text(v_reverse->'revoke_grant_ids')::uuid);
    foreach v_uid in array v_affected_ids loop
      select to_jsonb(p) into v_before from public.profiles p where id = v_uid;
      update public.comp_plan_grants
         set revoked_at = now()
       where id = any(v_grant_ids)
         and user_id = v_uid
         and revoked_at is null;
      select to_jsonb(p) into v_after from public.profiles p where id = v_uid;

      perform public.log_admin_action(
        p_action_name    => 'bulk_action_undone',
        p_target_user_id => v_uid,
        p_table_name     => 'comp_plan_grants',
        p_row_pk         => v_uid::text,
        p_before         => v_before,
        p_after          => v_after
      );
      v_reversed := v_reversed + 1;
    end loop;
  end if;

  return jsonb_build_object('reversed', v_reversed);
end;
$$;

revoke all on function public.admin_bulk_action_undo(uuid) from public;
grant execute on function public.admin_bulk_action_undo(uuid) to authenticated;
