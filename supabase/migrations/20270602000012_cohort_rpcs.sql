-- Phase 27 Plan 27-02 — Cohort SECDEF RPCs + plpgsql defense-in-depth validator.
--
-- CONTEXT references:
--   - D-05/D-06: rule tree + 15-field allowlist.
--   - D-09: cohort lifecycle (draft → active → archived).
--   - D-21: SECDEF RPC list (cohort_define, cohort_archive — extended here with
--     cohort_set_status per [[feedback_status_machine_transition_owner]]).
--
-- Four functions:
--   1. cohort_validate_rule(p_rule jsonb, p_depth int default 0) — recursive
--      defense-in-depth validator. Walks the jsonb tree, asserts every leaf
--      field is in the hardcoded 15-string allowlist (mirror of TS
--      FIELD_ALLOWLIST), every op is in the 9-op list, every branch op is
--      and|or, and depth stays ≤ 8. Raises 'invalid_rule' (22023) on any
--      violation.
--   2. cohort_define(p_name, p_rule, p_compiled_sql) — admin-gated insert.
--      Validates p_rule via cohort_validate_rule, then persists BOTH the
--      jsonb (for display/edit) AND the TS-translator-emitted compiled_sql.
--      Returns the new cohort_definitions.id (uuid). Inserts with status
--      'draft'. Audit-logged.
--   3. cohort_set_status(p_cohort_id, p_status) — owns draft→active (admin)
--      AND active→archived (superadmin) transitions. Per
--      [[feedback_status_machine_transition_owner]] every enum value needs
--      an owning RPC, else consumer code silently ships dead.
--   4. cohort_archive(p_cohort_id) — superadmin-only thin wrapper calling
--      cohort_set_status(p_cohort_id, 'archived').
--
-- All write functions:
--   - perform set_config('app.suppress_audit', 'on', true) to silence the
--     audit-trigger duplicate per Pattern S3 (we call log_admin_action
--     explicitly).
--   - Call public.log_admin_action(action_name, target_user_id, table_name,
--     row_pk, before, after) from Phase 24.
--   - End with revoke-all + grant-execute-to-authenticated (server gates
--     on is_admin_at_least; RLS is dual-layer per Pattern S1).
--
-- The TS translator (leanshot/src/lib/cohort/rule-tree-to-sql.ts) is the
-- single source of truth for compiled_sql. cohort_validate_rule re-checks the
-- field+op allowlists; it does NOT re-compile SQL (that's the translator's
-- job and Postgres has no general-purpose mirror).

-- ============================================================================
-- 1. cohort_validate_rule — recursive defense-in-depth allowlist walker
-- ============================================================================
create or replace function public.cohort_validate_rule(
  p_rule jsonb,
  p_depth int default 0
)
returns void
language plpgsql
immutable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_op    text;
  v_field text;
  v_child jsonb;
begin
  if p_depth > 8 then
    raise exception 'invalid_rule: depth_exceeded' using errcode = '22023';
  end if;
  if jsonb_typeof(p_rule) <> 'object' then
    raise exception 'invalid_rule: not_object' using errcode = '22023';
  end if;

  v_op := p_rule->>'op';
  if v_op is null then
    raise exception 'invalid_rule: missing_op' using errcode = '22023';
  end if;

  -- Branch node: op IN ('and','or'); children must be a non-empty array.
  if v_op = 'and' or v_op = 'or' then
    if jsonb_typeof(p_rule->'children') <> 'array' then
      raise exception 'invalid_rule: branch_children_not_array'
        using errcode = '22023';
    end if;
    if jsonb_array_length(p_rule->'children') = 0 then
      raise exception 'invalid_rule: branch_children_empty'
        using errcode = '22023';
    end if;
    if jsonb_array_length(p_rule->'children') > 50 then
      raise exception 'invalid_rule: branch_children_overflow'
        using errcode = '22023';
    end if;
    for v_child in select * from jsonb_array_elements(p_rule->'children')
    loop
      perform public.cohort_validate_rule(v_child, p_depth + 1);
    end loop;
    return;
  end if;

  -- Leaf node: op must be one of the 9; field must be in the 15-string allowlist.
  if v_op not in (
    '=', '!=', '>', '<', '>=', '<=',
    'in', 'is_null', 'is_not_null'
  ) then
    raise exception 'invalid_rule: bad_leaf_op' using errcode = '22023';
  end if;

  v_field := p_rule->>'field';
  if v_field is null then
    raise exception 'invalid_rule: missing_field' using errcode = '22023';
  end if;

  -- Hardcoded mirror of leanshot/src/lib/cohort/field-allowlist.ts (Layer #3).
  if v_field not in (
    'tier',
    'role',
    'days_since_signup',
    'days_since_last_login',
    'total_paid_amount_cents',
    'active_streak_days',
    'has_active_subscription',
    'signup_source',
    'country',
    'language',
    'has_org',
    'has_completed_onboarding',
    'is_affiliate',
    'anomaly_flagged',
    'account_state'
  ) then
    raise exception 'invalid_rule: field_not_allowed' using errcode = '22023';
  end if;
end;
$$;

comment on function public.cohort_validate_rule(jsonb, int) is
  'Phase 27 Plan 27-02: defense-in-depth layer #3 — re-checks the JSONB rule '
  'tree shape against the hardcoded 15-field allowlist + 9-op list + '
  'MAX_DEPTH=8 + MAX_CHILDREN=50. Mirrors TS ruleTreeSchema. Does NOT compile '
  'SQL (translator is single source of truth for compiled_sql). Mitigates '
  'threats T-27-02-02 (field-bypass) and T-27-02-03 (depth-DoS).';

-- ============================================================================
-- 2. cohort_define — admin-gated insert with audit
-- ============================================================================
create or replace function public.cohort_define(
  p_name         text,
  p_rule         jsonb,
  p_compiled_sql text
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_caller    uuid := auth.uid();
  v_cohort_id uuid;
begin
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not public.is_admin_at_least('admin'::public.admin_role) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  if p_compiled_sql is null or length(trim(p_compiled_sql)) = 0 then
    raise exception 'invalid_compiled_sql' using errcode = '22023';
  end if;

  -- Defense-in-depth: re-validate the jsonb shape (layer #3).
  perform public.cohort_validate_rule(p_rule, 0);

  -- Suppress the audit-trigger duplicate; we'll call log_admin_action below.
  perform set_config('app.suppress_audit', 'on', true);

  insert into public.cohort_definitions (name, rule, compiled_sql, status, created_by)
  values (p_name, p_rule, p_compiled_sql, 'draft', v_caller)
  returning id into v_cohort_id;

  perform public.log_admin_action(
    p_action_name    => 'cohort_defined',
    p_target_user_id => null,
    p_table_name     => 'public.cohort_definitions',
    p_row_pk         => v_cohort_id::text,
    p_before         => null,
    p_after          => jsonb_build_object(
                          'name', p_name,
                          'rule', p_rule,
                          'status', 'draft'
                        )
  );

  return v_cohort_id;
end;
$$;

revoke all on function public.cohort_define(text, jsonb, text) from public;
grant execute on function public.cohort_define(text, jsonb, text) to authenticated;

-- ============================================================================
-- 3. cohort_set_status — owns the status state machine
-- ============================================================================
-- draft → active : admin
-- active → archived : superadmin (D-21 destructive-lifecycle gate)
-- archived → * : forbidden (terminal)
create or replace function public.cohort_set_status(
  p_cohort_id uuid,
  p_status    text
)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_caller     uuid := auth.uid();
  v_prev_row   public.cohort_definitions%rowtype;
  v_before     jsonb;
  v_after      jsonb;
begin
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_status not in ('draft', 'active', 'archived') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;

  -- Superadmin-only for transitions TO archived (per D-21 destructive gate +
  -- threat T-27-02-04 mitigation).
  if p_status = 'archived' then
    if not public.is_admin_at_least('superadmin'::public.admin_role) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
  else
    if not public.is_admin_at_least('admin'::public.admin_role) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
  end if;

  select * into v_prev_row
    from public.cohort_definitions
    where id = p_cohort_id
    for update;
  if not found then
    raise exception 'not_found' using errcode = '22023';
  end if;

  -- Disallow leaving 'archived' (terminal).
  if v_prev_row.status = 'archived' and p_status <> 'archived' then
    raise exception 'invalid_transition: archived_is_terminal'
      using errcode = '22023';
  end if;

  -- Idempotent no-op if already in target status.
  if v_prev_row.status = p_status then
    return;
  end if;

  v_before := to_jsonb(v_prev_row);

  perform set_config('app.suppress_audit', 'on', true);

  update public.cohort_definitions
    set status = p_status
    where id = p_cohort_id
    returning to_jsonb(public.cohort_definitions.*) into v_after;

  perform public.log_admin_action(
    p_action_name    => 'cohort_status_changed',
    p_target_user_id => null,
    p_table_name     => 'public.cohort_definitions',
    p_row_pk         => p_cohort_id::text,
    p_before         => v_before,
    p_after          => v_after
  );
end;
$$;

revoke all on function public.cohort_set_status(uuid, text) from public;
grant execute on function public.cohort_set_status(uuid, text) to authenticated;

-- ============================================================================
-- 4. cohort_archive — superadmin-only thin wrapper
-- ============================================================================
create or replace function public.cohort_archive(p_cohort_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not public.is_admin_at_least('superadmin'::public.admin_role) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Delegates to cohort_set_status — single audit-log call path; only
  -- 'cohort_archived' action_name distinguishes this wrapper invocation.
  perform public.cohort_set_status(p_cohort_id, 'archived');

  -- Override the action_name on the most recent audit log entry for this row
  -- so observers can distinguish wrapper vs direct cohort_set_status calls.
  -- (Append-only audit_logs — we write a NEW row tagged 'cohort_archived'
  --  rather than mutating the previous one.)
  perform set_config('app.suppress_audit', 'on', true);
  perform public.log_admin_action(
    p_action_name    => 'cohort_archived',
    p_target_user_id => null,
    p_table_name     => 'public.cohort_definitions',
    p_row_pk         => p_cohort_id::text,
    p_before         => null,
    p_after          => jsonb_build_object('status', 'archived', 'via', 'cohort_archive')
  );
end;
$$;

revoke all on function public.cohort_archive(uuid) from public;
grant execute on function public.cohort_archive(uuid) to authenticated;
