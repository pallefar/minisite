-- Phase 30 Plan 05 — Fix rank_org_patients: symptoms.recorded_at → symptoms.created_at
--
-- Root cause: 20270601300005_p30_weighted_rank_org_patients.sql referenced
-- s.recorded_at in the DYNAMIC SQL format() string (line 162) but the symptoms
-- table only has created_at (not recorded_at). This caused 42703 on every
-- rank_org_patients invocation. Rule 1 auto-fix.
--
-- Fix: replace recorded_at with created_at in the symptoms subquery inside the
-- EXECUTE format() block. Only the one-line change is applied; all other
-- function behavior is preserved exactly.
--
-- Note: also validates that the function compiled without error after migration.

begin;

create or replace function public.rank_org_patients(
  p_org_id uuid,
  p_sort_column text default 'score',
  p_sort_direction text default 'desc',
  p_offset int default 0,
  p_limit int default 50
)
returns table (
  user_id uuid,
  display_name text,
  score smallint,
  breakdown jsonb,
  last_injection_at timestamptz,
  weight_trend_arrow text,
  recent_symptom_severity smallint,
  days_since_injection int,
  missed_dose_flag bool
)
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_caller_uid          uuid := auth.uid();
  v_patient_count       int  := 0;
  v_sql_sort_col        text;

  -- Phase 30 D-04 extension: weighted scoring scalars
  -- NULL org_settings.ranking_weights → use Phase 10 hardcoded defaults
  v_weights             jsonb;
  v_w_dose_adherence    numeric; -- default 28 (missed dose flag points)
  v_w_symptom_severity  numeric; -- default 5 (points per severity unit)
  v_w_weight_loss       numeric; -- default 15 (weight trend reversal flag points)
  v_w_days_injection    numeric; -- default 20 (max points for days_since_injection)
  v_w_streak_break      numeric; -- default 12 (streak break flag points)

begin
  -- -------------------------------------------------------------------------
  -- 1. Permission gate (T-10-02-01 mitigation — unchanged from Phase 10)
  -- -------------------------------------------------------------------------
  if not public.has_permission(v_caller_uid, p_org_id, 'patient_data.read') then
    raise exception 'access_denied';
  end if;

  -- -------------------------------------------------------------------------
  -- 2. Validate sort params (whitelist — T-10-02-02 SQL injection mitigation)
  -- -------------------------------------------------------------------------
  if p_sort_column not in (
    'score', 'name', 'last_dose', 'weight_trend',
    'symptom_severity', 'days_since_injection', 'missed_dose_flag'
  ) then
    raise exception 'invalid_sort_column';
  end if;

  if p_sort_direction not in ('asc', 'desc') then
    raise exception 'invalid_sort_direction';
  end if;

  if p_limit < 1 or p_limit > 200 then
    raise exception 'invalid_limit';
  end if;

  -- Map the user-facing sort column name to the SQL column name.
  v_sql_sort_col := case p_sort_column
    when 'score'               then 'score'
    when 'name'                then 'display_name'
    when 'last_dose'           then 'last_injection_at'
    when 'weight_trend'        then 'weight_trend_arrow'
    when 'symptom_severity'    then 'recent_symptom_severity'
    when 'days_since_injection' then 'days_since_injection'
    when 'missed_dose_flag'    then 'missed_dose_flag'
  end;

  -- -------------------------------------------------------------------------
  -- Phase 30 D-04: Read org_settings.ranking_weights with NULL-fallback
  -- RESEARCH Pitfall 3: extract into scalar variables before EXECUTE block
  -- -------------------------------------------------------------------------
  select ranking_weights into v_weights
  from public.org_settings
  where org_id = p_org_id;
  -- v_weights IS NULL when: (a) no org_settings row, (b) ranking_weights IS NULL

  -- Compute scalar weights with Phase 10 hardcoded defaults as fallback
  v_w_dose_adherence   := coalesce((v_weights->>'dose_adherence')::numeric * 100,   28);
  v_w_symptom_severity := coalesce((v_weights->>'symptoms')::numeric       * 25,     5);
  v_w_weight_loss      := coalesce((v_weights->>'weight_loss')::numeric    * 100,   15);
  v_w_days_injection   := coalesce((v_weights->>'activity')::numeric       * 100,   20);
  v_w_streak_break     := 12; -- no direct mapping; kept at baseline

  -- When v_weights IS NULL, all 4 coalesce() calls return the hardcoded defaults,
  -- preserving exact Phase 10 behavior for non-clinic users and unconfigured clinics.

  -- -------------------------------------------------------------------------
  -- 3. Materialize full scored set into temp table for threshold comparison
  -- -------------------------------------------------------------------------

  create temp table _rank_current_scores (
    r_user_id uuid not null,
    r_score smallint not null,
    r_breakdown jsonb not null,
    r_display_name text,
    r_last_injection_at timestamptz,
    r_weight_trend_arrow text,
    r_recent_symptom_severity smallint,
    r_days_since_injection int,
    r_missed_dose_flag bool
  ) on commit drop;

  execute format(
    $sql$
    insert into _rank_current_scores
    with patients as (
      select
        m.user_id,
        coalesce(u.raw_user_meta_data ->> 'display_name', 'Patient') as display_name,
        m.consent_scope
      from public.memberships m
      join auth.users u on u.id = m.user_id
      where m.org_id = %L
        and m.revoked_at is null
    ),
    signals as (
      select
        p.user_id,
        p.display_name,
        case when (p.consent_scope ->> 'injections')::bool then
          (select max(i.created_at) from public.injections i where i.user_id = p.user_id)
        else null end as last_injection_at,
        case when (p.consent_scope ->> 'weights')::bool then
          public.compute_weight_trend(p.user_id)
        else 'flat' end as weight_trend_arrow,
        case when (p.consent_scope ->> 'symptoms')::bool then
          coalesce(
            (select max(s.severity)::smallint
             from public.symptoms s
             where s.user_id = p.user_id
               and s.created_at > now() - interval '7 days'),
            0::smallint
          )
        else 0::smallint end as recent_symptom_severity,
        case when (p.consent_scope ->> 'injections')::bool then
          coalesce(
            extract(day from (now() - (
              select max(i.created_at) from public.injections i where i.user_id = p.user_id
            )))::int,
            999
          )
        else 999 end as days_since_injection,
        case when (p.consent_scope ->> 'injections')::bool then
          coalesce(
            extract(day from (now() - (
              select max(i.created_at) from public.injections i where i.user_id = p.user_id
            )))::int,
            0
          ) > 14
        else false end as missed_dose_flag
      from patients p
    ),
    scored as (
      select
        s.user_id,
        s.display_name,
        s.last_injection_at,
        s.weight_trend_arrow,
        s.recent_symptom_severity,
        s.days_since_injection,
        s.missed_dose_flag,
        -- Phase 30 weighted scoring (Phase 10 defaults when v_weights IS NULL via scalar fallback)
        least(100, greatest(0,
          (case when s.missed_dose_flag then %L::numeric else 0 end)
          + (s.recent_symptom_severity * %L::numeric)
          + (case when s.weight_trend_arrow = 'down' then %L::numeric else 0 end)
          + least(%L::numeric, case when s.days_since_injection < 999 then s.days_since_injection else 0 end)
          + (case when s.days_since_injection > 7 and s.days_since_injection < 999 then %L::numeric else 0 end)
        ))::smallint as score,
        jsonb_build_object(
          'missed_dose',
            case when s.missed_dose_flag then %L::numeric else 0 end,
          'symptom_severity',
            s.recent_symptom_severity * %L::numeric,
          'weight_trend_reversal',
            case when s.weight_trend_arrow = 'down' then %L::numeric else 0 end,
          'days_since_injection',
            least(%L::numeric, case when s.days_since_injection < 999 then s.days_since_injection else 0 end),
          'streak_break',
            case when s.days_since_injection > 7 and s.days_since_injection < 999 then %L::numeric else 0 end
        ) as breakdown
      from signals s
    )
    select
      scored.user_id,
      scored.score,
      scored.breakdown,
      scored.display_name,
      scored.last_injection_at,
      scored.weight_trend_arrow,
      scored.recent_symptom_severity,
      scored.days_since_injection,
      scored.missed_dose_flag
    from scored
    $sql$,
    p_org_id,
    -- Score weights (passed as %L literals per Pitfall 3)
    v_w_dose_adherence,   -- missed_dose score contribution
    v_w_symptom_severity, -- symptom_severity multiplier
    v_w_weight_loss,      -- weight_trend_reversal score contribution
    v_w_days_injection,   -- days_since_injection cap
    v_w_streak_break,     -- streak_break score contribution
    -- Breakdown weights (same scalars for consistent JSON output)
    v_w_dose_adherence,
    v_w_symptom_severity,
    v_w_weight_loss,
    v_w_days_injection,
    v_w_streak_break
  );

  get diagnostics v_patient_count = row_count;

  -- -------------------------------------------------------------------------
  -- 4. Audit row for the rank computation (D-18 — unchanged from Phase 10)
  -- -------------------------------------------------------------------------
  insert into public.audit_logs (
    user_id,
    user_id_hash,
    table_name,
    row_id,
    action,
    actor_type,
    org_id,
    metadata,
    timestamp
  )
  values (
    v_caller_uid,
    encode(digest(coalesce(v_caller_uid, '00000000-0000-0000-0000-000000000000'::uuid)::text, 'sha256'), 'hex'),
    'rank_org_patients',
    p_org_id::text,
    'rank_computed',
    'org_system',
    p_org_id,
    jsonb_build_object(
      'patient_count', v_patient_count,
      'weights_snapshot', jsonb_build_object(
        'dose_adherence', v_w_dose_adherence,
        'symptom_severity_per_unit', v_w_symptom_severity,
        'weight_trend_reversal', v_w_weight_loss,
        'days_since_injection_max', v_w_days_injection,
        'streak_break', v_w_streak_break,
        'source', case when v_weights is null then 'hardcoded_defaults' else 'org_settings' end
      ),
      'top_3_score_buckets', (
        select jsonb_agg(jsonb_build_object('bucket', bucket, 'count', cnt))
        from (
          select
            case
              when r_score >= 70 then 'high'
              when r_score >= 30 then 'mid'
              else 'low'
            end as bucket,
            count(*) as cnt
          from _rank_current_scores
          group by 1
          order by cnt desc
          limit 3
        ) bc
      )
    ),
    now()
  );

  -- -------------------------------------------------------------------------
  -- 5. Threshold-crossing detection (D-18 — unchanged from Phase 10)
  -- -------------------------------------------------------------------------
  insert into public.audit_logs (
    user_id,
    user_id_hash,
    table_name,
    row_id,
    action,
    actor_type,
    org_id,
    target_user_id,
    metadata,
    timestamp
  )
  select
    v_caller_uid,
    encode(digest(coalesce(v_caller_uid, '00000000-0000-0000-0000-000000000000'::uuid)::text, 'sha256'), 'hex'),
    'rank_org_patients',
    cs.r_user_id::text,
    'rank_threshold_crossed',
    'org_system',
    p_org_id,
    cs.r_user_id,
    jsonb_build_object(
      'score', cs.r_score,
      'breakdown_snapshot', cs.r_breakdown,
      'threshold_crossed', 70,
      'direction',
        case when cs.r_score >= 70 then 'up' else 'down' end
    ),
    now()
  from _rank_current_scores cs
  left join lateral (
    select metadata ->> 'direction' as last_dir
    from public.audit_logs
    where action = 'rank_threshold_crossed'
      and org_id = p_org_id
      and target_user_id = cs.r_user_id
    order by timestamp desc
    limit 1
  ) prior on true
  where
    (cs.r_score >= 70 and (prior.last_dir is null or prior.last_dir = 'down'))
    or (cs.r_score < 70 and prior.last_dir = 'up');

  -- -------------------------------------------------------------------------
  -- 6. Return paginated sorted result set (shape identical to Phase 10)
  -- -------------------------------------------------------------------------
  return query execute format(
    $q$
    select
      r_user_id,
      r_display_name,
      r_score,
      r_breakdown,
      r_last_injection_at,
      r_weight_trend_arrow,
      r_recent_symptom_severity,
      r_days_since_injection,
      r_missed_dose_flag
    from _rank_current_scores
    order by %I %s nulls last, r_user_id asc
    offset %L limit %L
    $q$,
    case v_sql_sort_col
      when 'score'               then 'r_score'
      when 'display_name'        then 'r_display_name'
      when 'last_injection_at'   then 'r_last_injection_at'
      when 'weight_trend_arrow'  then 'r_weight_trend_arrow'
      when 'recent_symptom_severity' then 'r_recent_symptom_severity'
      when 'days_since_injection' then 'r_days_since_injection'
      when 'missed_dose_flag'    then 'r_missed_dose_flag'
    end,
    p_sort_direction,
    p_offset,
    p_limit
  );
end;
$$;

revoke all on function public.rank_org_patients(uuid, text, text, int, int) from public;
grant execute on function public.rank_org_patients(uuid, text, text, int, int) to authenticated;

commit;
