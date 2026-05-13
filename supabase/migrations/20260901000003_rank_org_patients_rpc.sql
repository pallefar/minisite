-- Phase 10 Plan 10-02 — rank_org_patients SECURITY DEFINER RPC.
--
-- T-10-02-01 (Information disclosure): Operator A in Org 1 calling
-- rank_org_patients(org_2_id) MUST raise 'access_denied'. Mitigation:
-- has_permission gate + cross-tenant RLS impersonation proof in
-- e2e/rls-rank-org-patients.test.ts.
--
-- T-10-02-02 (Tampering / SQL injection via p_sort_column + p_sort_direction):
-- Whitelist validation before EXECUTE format() composition; %I for identifier
-- auto-quoting.
--
-- SCHEMA EXTENSIONS in this migration (required for rank/threshold audit rows):
--   1. audit_actor_type enum → add 'org_system' for system-initiated rank events.
--   2. audit_logs.metadata jsonb — stores patient_count, weights_snapshot, score.
--   3. audit_logs.target_user_id uuid — per-patient threshold rows reference the
--      patient. On delete set null to survive user deletion.
--
-- Memory `reference_supabase_migration_gotchas.md` checklist:
--   (1) Partial-index expressions must be IMMUTABLE — no now()/current_* in WHERE.
--   (2) SECURITY DEFINER functions need `extensions` in search_path for digest().
--   (3) DELETE on storage.objects needs GUC — N/A in this migration.
--   (4) Cascade DELETE crossing audit_logs: threshold rows reference target_user_id
--       ON DELETE SET NULL so cascade from user deletion does not break.
--
-- NOTE on 55P04 ("unsafe use of new value of enum type"): the ALTER TYPE ADD VALUE
-- statements below are in the same transaction as CREATE FUNCTION, which stores the
-- function body as a string literal (not a typed value). The 55P04 error only fires
-- when the new enum value is used in a typed expression in the SAME transaction
-- (e.g., a DEFAULT, CHECK, or partial-index WHERE clause). Since these function
-- bodies reference 'org_system' only inside string literals (PL/pgSQL code), the
-- migration is safe to run as a single transaction.

-- =============================================================================
-- 1. Extend audit_actor_type enum with 'org_system'
--    (system-initiated ranking events, not tied to a specific operator)
-- =============================================================================
alter type public.audit_actor_type add value if not exists 'org_system';

-- =============================================================================
-- 2. Add audit_logs.metadata jsonb (stores structured event payload)
--    and audit_logs.target_user_id uuid (per-patient threshold events).
--    Both are nullable — pre-Phase-10 rows carry null.
-- =============================================================================
alter table public.audit_logs
  add column if not exists metadata jsonb;

alter table public.audit_logs
  add column if not exists target_user_id uuid
    references auth.users(id) on delete set null;

-- Partial index for per-patient threshold queries
-- (D-19 patient mirror: show threshold events for target_user_id in a given org).
-- IMMUTABLE-safe: column-vs-literal comparison only (no now()/current_*).
create index if not exists audit_logs_target_user_org_idx
  on public.audit_logs (target_user_id, org_id, timestamp desc)
  where target_user_id is not null;

-- =============================================================================
-- 3. compute_weight_trend(user_id) → 'up' | 'down' | 'flat'
--    Helper used by rank_org_patients signal computation.
--    SECURITY DEFINER so the main RPC can read patient weights without
--    exposing raw weight values to the operator's RLS context.
-- =============================================================================
create or replace function public.compute_weight_trend(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_recent numeric;
  v_older numeric;
begin
  -- Most recent weight
  select weight_kg into v_recent
  from public.weights
  where user_id = p_user_id
  order by recorded_at desc
  limit 1;

  -- Average of the 2nd and 3rd most recent weights
  select avg(weight_kg) into v_older
  from (
    select weight_kg
    from public.weights
    where user_id = p_user_id
    order by recorded_at desc
    offset 1 limit 2
  ) sub;

  if v_recent is null or v_older is null then
    return 'flat';
  end if;

  if v_recent > v_older + 0.3 then
    return 'up';
  elsif v_recent < v_older - 0.3 then
    return 'down';
  else
    return 'flat';
  end if;
end;
$$;

revoke all on function public.compute_weight_trend(uuid) from public;
grant execute on function public.compute_weight_trend(uuid) to authenticated;

-- =============================================================================
-- 4. rank_org_patients — main SECURITY DEFINER RPC
--
-- Returns TABLE matching RankRosterRow shape (src/types/snapshot.ts):
--   user_id uuid, display_name text, score smallint, breakdown jsonb,
--   last_injection_at timestamptz, weight_trend_arrow text,
--   recent_symptom_severity smallint, days_since_injection int,
--   missed_dose_flag bool
--
-- Score weights (mirror Phase 3 pickFocus/generateInsights priority order):
--   missed_dose (28) > symptom_severity (severity × 5, max 25) >
--   weight_trend_reversal (15) > days_since_injection (linear × 1, capped 20) >
--   streak_break (12 if days > 7)
-- =============================================================================
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
  v_caller_uid uuid := auth.uid();
  v_patient_count int := 0;
  v_sql_sort_col text;

begin
  -- -------------------------------------------------------------------------
  -- 1. Permission gate (D-01 — T-10-02-01 mitigation)
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
  -- 3. Build per-patient signal CTE + scored result set via EXECUTE format()
  --    (dynamic ORDER BY requires format; %I auto-quotes the column identifier,
  --    %s for the whitelisted direction string — safe after whitelist above).
  --    Threshold-crossing detection requires the full score set, so we compute
  --    all patients first, write audit rows, then return paginated results.
  -- -------------------------------------------------------------------------

  -- Step 3a: materialize full scored set into a temp table for threshold comparison
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
        -- last_injection_at: NULL if consent_scope.injections=false
        case when (p.consent_scope ->> 'injections')::bool then
          (select max(i.created_at) from public.injections i where i.user_id = p.user_id)
        else null end as last_injection_at,
        -- weight_trend_arrow via helper (SECURITY DEFINER reads patient weights)
        case when (p.consent_scope ->> 'weights')::bool then
          public.compute_weight_trend(p.user_id)
        else 'flat' end as weight_trend_arrow,
        -- recent_symptom_severity: max severity in last 7 days (0 if no consent)
        case when (p.consent_scope ->> 'symptoms')::bool then
          coalesce(
            (select max(s.severity)::smallint
             from public.symptoms s
             where s.user_id = p.user_id
               and s.recorded_at > now() - interval '7 days'),
            0::smallint
          )
        else 0::smallint end as recent_symptom_severity,
        -- days_since_injection: 999 sentinel when no consent or no injection ever
        case when (p.consent_scope ->> 'injections')::bool then
          coalesce(
            extract(day from (now() - (
              select max(i.created_at) from public.injections i where i.user_id = p.user_id
            )))::int,
            999
          )
        else 999 end as days_since_injection,
        -- missed_dose_flag: days > 14 (sentinel 999 means never injected → not flagged)
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
        -- Score 0-100: weights mirror Phase 3 pickFocus/generateInsights priority order
        least(100, greatest(0,
          (case when s.missed_dose_flag then 28 else 0 end)
          + (s.recent_symptom_severity * 5)
          + (case when s.weight_trend_arrow = 'down' then 15 else 0 end)
          + least(20, case when s.days_since_injection < 999 then s.days_since_injection else 0 end)
          + (case when s.days_since_injection > 7 and s.days_since_injection < 999 then 12 else 0 end)
        ))::smallint as score,
        jsonb_build_object(
          'missed_dose',
            case when s.missed_dose_flag then 28 else 0 end,
          'symptom_severity',
            s.recent_symptom_severity * 5,
          'weight_trend_reversal',
            case when s.weight_trend_arrow = 'down' then 15 else 0 end,
          'days_since_injection',
            least(20, case when s.days_since_injection < 999 then s.days_since_injection else 0 end),
          'streak_break',
            case when s.days_since_injection > 7 and s.days_since_injection < 999 then 12 else 0 end
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
    p_org_id
  );

  get diagnostics v_patient_count = row_count;

  -- -------------------------------------------------------------------------
  -- 4. Audit row for the rank computation (D-18)
  --    ONE row per call: actor_type='org_system', action='rank_computed'.
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
        'missed_dose', 28,
        'symptom_severity_per_unit', 5,
        'weight_trend_reversal', 15,
        'days_since_injection_max', 20,
        'streak_break', 12
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
  -- 5. Threshold-crossing detection (D-18)
  --    For each patient in current scores, compare against their last
  --    rank_threshold_crossed event for this org.
  --    - If current score >= 70 and last_direction was 'down' (or no prior event):
  --        insert row with direction='up'
  --    - If current score < 70 and last_direction was 'up':
  --        insert row with direction='down'
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
    -- Most recent threshold event for this patient in this org
    select metadata ->> 'direction' as last_dir
    from public.audit_logs
    where action = 'rank_threshold_crossed'
      and org_id = p_org_id
      and target_user_id = cs.r_user_id
    order by timestamp desc
    limit 1
  ) prior on true
  where
    -- Score crossed UP into high: current >= 70 and either no prior event or last was 'down'
    (cs.r_score >= 70 and (prior.last_dir is null or prior.last_dir = 'down'))
    -- Score crossed DOWN out of high: current < 70 and last was 'up'
    or (cs.r_score < 70 and prior.last_dir = 'up');

  -- -------------------------------------------------------------------------
  -- 6. Return paginated sorted result set (D-06)
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
