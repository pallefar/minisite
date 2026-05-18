-- Phase 50 Plan 50-02: 8 SECURITY DEFINER admin RPCs + telemetry rollup function.
--
-- Every RPC:
--   * SECURITY DEFINER + `set search_path = extensions, public, pg_temp`
--     (per [[reference_supabase_migration_gotchas]] pitfall 2).
--   * Starts with `if not public._rag_is_super() then raise exception 'not_authorized'
--     using errcode = '42501'; end if;` (D-12 super-admin gate).
--   * Calls `public.log_admin_action(...)` defensively (wrapped in a BEGIN/EXCEPTION
--     block keyed on `undefined_function` so Phase 24 ship-order does not break us).
--   * Uses `set_config('app.suppress_audit', 'true', true)` ONLY on rag_topics writes,
--     because the rag_topic_audit trigger already captures before/after JSONB — without
--     suppression we'd get double-audit (trigger + log_admin_action).
--
-- Telemetry function:
--   public.rag_topic_telemetry_7d() — returns one row per active topic with placeholder
--   zero columns for rag_hits/tip_impressions/tip_clicks/newsletter_inclusions until
--   Plan 50-08 wires server-side capture. Tier-mix columns are computed today from
--   rag_chunks.source_tier (D-11 honest contract).
--
-- Idempotent: all CREATE OR REPLACE.

-- ---------------------------------------------------------------------------
-- 1. rag_topic_create(p_query, p_tag, p_posture, p_cadence) RETURNS uuid
-- ---------------------------------------------------------------------------

create or replace function public.rag_topic_create(
  p_query text,
  p_tag text,
  p_posture text default 'curated',
  p_cadence text default 'weekly'
)
returns uuid
language plpgsql
security definer
set search_path = extensions, public, pg_temp
as $$
declare
  v_id uuid;
begin
  if not public._rag_is_super() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  -- Suppress audit trigger so log_admin_action is the sole audit row, plus
  -- the rag_topic_audit trigger row (intentional — D-14 dedicated table).
  -- We DO NOT suppress rag_topic_audit; it is the spec source of truth.
  insert into public.rag_topics (query, tag, posture, cadence, created_by, last_edited_by)
  values (
    p_query,
    p_tag,
    p_posture::public.rag_topic_posture,
    p_cadence::public.rag_topic_cadence,
    auth.uid(),
    auth.uid()
  )
  returning id into v_id;

  begin
    perform public.log_admin_action(
      p_action_name    => 'rag_topic_create',
      p_target_user_id => null,
      p_table_name     => 'rag_topics',
      p_row_pk         => v_id::text,
      p_before         => null,
      p_after          => jsonb_build_object('query', p_query, 'tag', p_tag,
                                             'posture', p_posture, 'cadence', p_cadence)
    );
  exception
    when undefined_function then null;
    when undefined_object   then null;
  end;

  return v_id;
end
$$;

revoke all on function public.rag_topic_create(text, text, text, text) from public;
grant execute on function public.rag_topic_create(text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. rag_topic_update(p_topic_id, p_query, p_tag, p_posture, p_cadence) RETURNS void
-- ---------------------------------------------------------------------------

create or replace function public.rag_topic_update(
  p_topic_id uuid,
  p_query text,
  p_tag text,
  p_posture text,
  p_cadence text
)
returns void
language plpgsql
security definer
set search_path = extensions, public, pg_temp
as $$
declare
  v_before jsonb;
begin
  if not public._rag_is_super() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select to_jsonb(t) into v_before from public.rag_topics t where t.id = p_topic_id;
  if v_before is null then
    raise exception 'topic_not_found' using errcode = 'P0002';
  end if;

  update public.rag_topics
     set query   = p_query,
         tag     = p_tag,
         posture = p_posture::public.rag_topic_posture,
         cadence = p_cadence::public.rag_topic_cadence,
         last_edited_by = auth.uid()
   where id = p_topic_id;

  begin
    perform public.log_admin_action(
      p_action_name    => 'rag_topic_update',
      p_target_user_id => null,
      p_table_name     => 'rag_topics',
      p_row_pk         => p_topic_id::text,
      p_before         => v_before,
      p_after          => jsonb_build_object('query', p_query, 'tag', p_tag,
                                             'posture', p_posture, 'cadence', p_cadence)
    );
  exception
    when undefined_function then null;
    when undefined_object   then null;
  end;
end
$$;

revoke all on function public.rag_topic_update(uuid, text, text, text, text) from public;
grant execute on function public.rag_topic_update(uuid, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. rag_topic_soft_delete(p_topic_id) RETURNS void
-- ---------------------------------------------------------------------------

create or replace function public.rag_topic_soft_delete(p_topic_id uuid)
returns void
language plpgsql
security definer
set search_path = extensions, public, pg_temp
as $$
begin
  if not public._rag_is_super() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  update public.rag_topics
     set deleted_at = now(),
         last_edited_by = auth.uid()
   where id = p_topic_id
     and deleted_at is null;

  if not found then
    raise exception 'topic_not_found_or_already_deleted' using errcode = 'P0002';
  end if;

  begin
    perform public.log_admin_action(
      p_action_name    => 'rag_topic_soft_delete',
      p_target_user_id => null,
      p_table_name     => 'rag_topics',
      p_row_pk         => p_topic_id::text,
      p_before         => null,
      p_after          => jsonb_build_object('deleted_at', now())
    );
  exception
    when undefined_function then null;
    when undefined_object   then null;
  end;
end
$$;

revoke all on function public.rag_topic_soft_delete(uuid) from public;
grant execute on function public.rag_topic_soft_delete(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. rag_topic_restore(p_topic_id) RETURNS void
-- ---------------------------------------------------------------------------

create or replace function public.rag_topic_restore(p_topic_id uuid)
returns void
language plpgsql
security definer
set search_path = extensions, public, pg_temp
as $$
begin
  if not public._rag_is_super() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  update public.rag_topics
     set deleted_at = null,
         last_edited_by = auth.uid()
   where id = p_topic_id
     and deleted_at is not null;

  if not found then
    raise exception 'topic_not_found_or_not_deleted' using errcode = 'P0002';
  end if;

  begin
    perform public.log_admin_action(
      p_action_name    => 'rag_topic_restore',
      p_target_user_id => null,
      p_table_name     => 'rag_topics',
      p_row_pk         => p_topic_id::text,
      p_before         => null,
      p_after          => jsonb_build_object('deleted_at', null)
    );
  exception
    when undefined_function then null;
    when undefined_object   then null;
  end;
end
$$;

revoke all on function public.rag_topic_restore(uuid) from public;
grant execute on function public.rag_topic_restore(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. rag_source_create(p_name, p_domain, p_tier, p_freshness_window_days) RETURNS uuid
-- ---------------------------------------------------------------------------

create or replace function public.rag_source_create(
  p_name text,
  p_domain text,
  p_tier text,
  p_freshness_window_days int
)
returns uuid
language plpgsql
security definer
set search_path = extensions, public, pg_temp
as $$
declare
  v_id uuid;
begin
  if not public._rag_is_super() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  insert into public.rag_sources (name, domain, tier, freshness_window_days)
  values (p_name, p_domain, p_tier::public.rag_source_tier, p_freshness_window_days)
  returning id into v_id;

  begin
    perform public.log_admin_action(
      p_action_name    => 'rag_source_create',
      p_target_user_id => null,
      p_table_name     => 'rag_sources',
      p_row_pk         => v_id::text,
      p_before         => null,
      p_after          => jsonb_build_object('name', p_name, 'domain', p_domain,
                                             'tier', p_tier,
                                             'freshness_window_days', p_freshness_window_days)
    );
  exception
    when undefined_function then null;
    when undefined_object   then null;
  end;

  return v_id;
end
$$;

revoke all on function public.rag_source_create(text, text, text, int) from public;
grant execute on function public.rag_source_create(text, text, text, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. rag_source_update_tier(p_source_id, p_new_tier) RETURNS void
-- ---------------------------------------------------------------------------

create or replace function public.rag_source_update_tier(
  p_source_id uuid,
  p_new_tier text
)
returns void
language plpgsql
security definer
set search_path = extensions, public, pg_temp
as $$
declare
  v_prev_tier public.rag_source_tier;
begin
  if not public._rag_is_super() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select tier into v_prev_tier from public.rag_sources where id = p_source_id;
  if v_prev_tier is null then
    raise exception 'source_not_found' using errcode = 'P0002';
  end if;

  update public.rag_sources
     set tier = p_new_tier::public.rag_source_tier
   where id = p_source_id;

  begin
    perform public.log_admin_action(
      p_action_name    => 'rag_source_update_tier',
      p_target_user_id => null,
      p_table_name     => 'rag_sources',
      p_row_pk         => p_source_id::text,
      p_before         => jsonb_build_object('tier', v_prev_tier),
      p_after          => jsonb_build_object('tier', p_new_tier)
    );
  exception
    when undefined_function then null;
    when undefined_object   then null;
  end;
end
$$;

revoke all on function public.rag_source_update_tier(uuid, text) from public;
grant execute on function public.rag_source_update_tier(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. rag_source_pause(p_source_id, p_reason) RETURNS void
-- ---------------------------------------------------------------------------

create or replace function public.rag_source_pause(
  p_source_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = extensions, public, pg_temp
as $$
begin
  if not public._rag_is_super() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  update public.rag_sources
     set paused_at = now(),
         paused_reason = p_reason,
         health = 'paused'::public.rag_source_health
   where id = p_source_id;

  if not found then
    raise exception 'source_not_found' using errcode = 'P0002';
  end if;

  begin
    perform public.log_admin_action(
      p_action_name    => 'rag_source_pause',
      p_target_user_id => null,
      p_table_name     => 'rag_sources',
      p_row_pk         => p_source_id::text,
      p_before         => null,
      p_after          => jsonb_build_object('paused_at', now(),
                                             'paused_reason', p_reason,
                                             'health', 'paused')
    );
  exception
    when undefined_function then null;
    when undefined_object   then null;
  end;
end
$$;

revoke all on function public.rag_source_pause(uuid, text) from public;
grant execute on function public.rag_source_pause(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. rag_source_resume(p_source_id) RETURNS void
-- ---------------------------------------------------------------------------

create or replace function public.rag_source_resume(p_source_id uuid)
returns void
language plpgsql
security definer
set search_path = extensions, public, pg_temp
as $$
begin
  if not public._rag_is_super() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  update public.rag_sources
     set paused_at = null,
         paused_reason = null,
         health = 'ok'::public.rag_source_health,
         consecutive_failures = 0
   where id = p_source_id;

  if not found then
    raise exception 'source_not_found' using errcode = 'P0002';
  end if;

  begin
    perform public.log_admin_action(
      p_action_name    => 'rag_source_resume',
      p_target_user_id => null,
      p_table_name     => 'rag_sources',
      p_row_pk         => p_source_id::text,
      p_before         => null,
      p_after          => jsonb_build_object('paused_at', null,
                                             'health', 'ok',
                                             'consecutive_failures', 0)
    );
  exception
    when undefined_function then null;
    when undefined_object   then null;
  end;
end
$$;

revoke all on function public.rag_source_resume(uuid) from public;
grant execute on function public.rag_source_resume(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Telemetry rollup: rag_topic_telemetry_7d()
--
-- One row per active (non-deleted) topic. tier_a/b/c counts come from
-- rag_chunks.source_tier on PUBLISHED chunks. rag_hits/tip_*/newsletter_*
-- columns are placeholders returning 0 until Plan 50-08 lands server-side
-- event capture (D-11 honest contract: surface exists today; values arrive
-- when the producers land).
-- ---------------------------------------------------------------------------

create or replace function public.rag_topic_telemetry_7d()
returns table(
  topic_id uuid,
  tag text,
  docs_ingested bigint,
  rag_hits_7d bigint,
  tip_impressions_7d bigint,
  tip_clicks_7d bigint,
  newsletter_inclusions_7d bigint,
  tier_a_count bigint,
  tier_b_count bigint,
  tier_c_count bigint
)
language sql
stable
security definer
set search_path = extensions, public, pg_temp
as $$
  select
    t.id                                                                as topic_id,
    t.tag                                                               as tag,
    count(c.id)                                                         as docs_ingested,
    0::bigint                                                           as rag_hits_7d,
    0::bigint                                                           as tip_impressions_7d,
    0::bigint                                                           as tip_clicks_7d,
    0::bigint                                                           as newsletter_inclusions_7d,
    count(c.id) filter (where c.source_tier = 'A'::public.rag_source_tier) as tier_a_count,
    count(c.id) filter (where c.source_tier = 'B'::public.rag_source_tier) as tier_b_count,
    count(c.id) filter (where c.source_tier = 'C'::public.rag_source_tier) as tier_c_count
  from public.rag_topics t
  left join public.rag_chunks c
    on c.topic_id = t.id
   and c.published_at is not null
  where t.deleted_at is null
  group by t.id, t.tag;
$$;

revoke all on function public.rag_topic_telemetry_7d() from public;
grant execute on function public.rag_topic_telemetry_7d() to authenticated;
