-- Phase 36 Plan 36-01 — REVIEW-02 / V13-3 SECDEF RPCs for review prompt rules.
--
-- CONTEXT references:
--   - D-02: single-condition rules. Admin-only writes via SECDEF (Pattern S1).
--   - B1 fix (plan-checker iter-1): create_review_prompt_rule must populate
--     created_by = auth.uid() on INSERT — column is NOT NULL with NO DEFAULT.
--   - W8 fix: _test_seed_review_prompt_history SECDEF helper for Wave 5 E2E
--     seeding. Gated by `current_setting('app.test_mode', true) = 'true'`.
--   - W8-followup: _test_seed_with_gas wrapper sets the GUC transaction-local
--     then delegates. ONLY callable path from test harness. EXECUTE granted
--     ONLY to service_role.
--
-- Per [[reference_supabase_migration_gotchas]]:
--   - SECURITY DEFINER + SET search_path = public, extensions on every function.
--   - REVOKE from public/anon; GRANT to authenticated for admin RPCs.
--
-- Per [[reference_rpc_auth_uid_vs_service_role_mismatch]]:
--   - These RPCs reference auth.uid() and MUST be called with a forwarded user JWT
--     (anon-key + Authorization header), NOT service-role.
--   - EXCEPT _test_seed_review_prompt_history + _test_seed_with_gas, which are
--     SECDEF gated by the test_mode GUC and granted to service_role only.

begin;

-- ============================================================================
-- create_review_prompt_rule(p_name, p_trigger_event, p_cohort_id, p_active)
-- B1 fix: stamps created_by = auth.uid() (column is NOT NULL).
-- ============================================================================
create or replace function public.create_review_prompt_rule(
  p_name text,
  p_trigger_event text,
  p_cohort_id uuid default null,
  p_active boolean default true
) returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_user_id uuid := auth.uid();
  v_admin_role text;
  v_rule_id uuid;
begin
  if v_user_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  -- Pattern S1 server-side admin re-check.
  select admin_role into v_admin_role from public.profiles where id = v_user_id;
  if v_admin_role is null or v_admin_role not in ('admin','superadmin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Input validation.
  if p_name is null or length(trim(p_name)) = 0 or length(p_name) > 60 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  if p_trigger_event is null or length(trim(p_trigger_event)) = 0 then
    raise exception 'invalid_trigger_event' using errcode = '22023';
  end if;

  -- B1 fix: explicit created_by = auth.uid() since the column is NOT NULL
  -- and has no DEFAULT (server-stamped attribution per T-36-01).
  insert into public.review_prompt_rules (name, trigger_event, cohort_id, active, created_by)
    values (p_name, p_trigger_event, p_cohort_id, coalesce(p_active, true), v_user_id)
    returning id into v_rule_id;

  return v_rule_id;
end;
$fn$;

revoke execute on function public.create_review_prompt_rule(text, text, uuid, boolean) from public, anon;
grant  execute on function public.create_review_prompt_rule(text, text, uuid, boolean) to authenticated;

-- ============================================================================
-- update_review_prompt_rule(p_id, p_name, p_trigger_event, p_cohort_id, p_active)
-- ============================================================================
create or replace function public.update_review_prompt_rule(
  p_id uuid,
  p_name text,
  p_trigger_event text,
  p_cohort_id uuid,
  p_active boolean
) returns void
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_user_id uuid := auth.uid();
  v_admin_role text;
begin
  if v_user_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;
  select admin_role into v_admin_role from public.profiles where id = v_user_id;
  if v_admin_role is null or v_admin_role not in ('admin','superadmin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_id is null then
    raise exception 'invalid_id' using errcode = '22023';
  end if;
  if p_name is null or length(trim(p_name)) = 0 or length(p_name) > 60 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  if p_trigger_event is null or length(trim(p_trigger_event)) = 0 then
    raise exception 'invalid_trigger_event' using errcode = '22023';
  end if;

  update public.review_prompt_rules
     set name = p_name,
         trigger_event = p_trigger_event,
         cohort_id = p_cohort_id,
         active = coalesce(p_active, active),
         updated_at = now()
   where id = p_id;
end;
$fn$;

revoke execute on function public.update_review_prompt_rule(uuid, text, text, uuid, boolean) from public, anon;
grant  execute on function public.update_review_prompt_rule(uuid, text, text, uuid, boolean) to authenticated;

-- ============================================================================
-- delete_review_prompt_rule(p_id)
-- history.rule_id ON DELETE SET NULL preserves audit trail.
-- ============================================================================
create or replace function public.delete_review_prompt_rule(
  p_id uuid
) returns void
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_user_id uuid := auth.uid();
  v_admin_role text;
begin
  if v_user_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;
  select admin_role into v_admin_role from public.profiles where id = v_user_id;
  if v_admin_role is null or v_admin_role not in ('admin','superadmin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_id is null then
    raise exception 'invalid_id' using errcode = '22023';
  end if;
  delete from public.review_prompt_rules where id = p_id;
end;
$fn$;

revoke execute on function public.delete_review_prompt_rule(uuid) from public, anon;
grant  execute on function public.delete_review_prompt_rule(uuid) to authenticated;

-- ============================================================================
-- list_review_prompt_rules() — admin list path (SELECT denied directly).
-- ============================================================================
create or replace function public.list_review_prompt_rules()
returns setof public.review_prompt_rules
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_user_id uuid := auth.uid();
  v_admin_role text;
begin
  if v_user_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;
  select admin_role into v_admin_role from public.profiles where id = v_user_id;
  if v_admin_role is null or v_admin_role not in ('admin','superadmin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select * from public.review_prompt_rules order by created_at desc;
end;
$fn$;

revoke execute on function public.list_review_prompt_rules() from public, anon;
grant  execute on function public.list_review_prompt_rules() to authenticated;

-- ============================================================================
-- list_review_cta_catalog() — admin list path (catalog is also SELECT-able by
-- any authenticated user for the modal, but admin module uses this for table view).
-- ============================================================================
create or replace function public.list_review_cta_catalog()
returns setof public.review_cta_catalog
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_user_id uuid := auth.uid();
  v_admin_role text;
begin
  if v_user_id is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;
  select admin_role into v_admin_role from public.profiles where id = v_user_id;
  if v_admin_role is null or v_admin_role not in ('admin','superadmin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select * from public.review_cta_catalog order by slug;
end;
$fn$;

revoke execute on function public.list_review_cta_catalog() from public, anon;
grant  execute on function public.list_review_cta_catalog() to authenticated;

-- ============================================================================
-- _test_seed_review_prompt_history — W8 test-mode-gated seed helper.
-- Bare helper. NEVER called directly by clients (W8-followup contract).
-- Gated by app.test_mode GUC. EXECUTE granted only to service_role.
-- ============================================================================
create or replace function public._test_seed_review_prompt_history(
  p_user_id uuid,
  p_rule_id uuid,
  p_fired_at timestamptz,
  p_rating_value int,
  p_copy_variant text default null
) returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_id uuid;
begin
  -- Production-call safety: GUC gate. Without the wrapper having set this
  -- transaction-local, ANY caller (even service_role) gets 'forbidden'.
  if current_setting('app.test_mode', true) is distinct from 'true' then
    raise exception 'forbidden — test_mode GUC not set' using errcode = '42501';
  end if;

  insert into public.review_prompt_history (user_id, rule_id, fired_at, rating_value, copy_variant)
    values (p_user_id, p_rule_id, p_fired_at, p_rating_value, p_copy_variant)
    returning id into v_id;
  return v_id;
end;
$fn$;

-- Service-role-only EXECUTE on the bare helper. NOT authenticated, NOT anon, NOT PUBLIC.
REVOKE EXECUTE ON FUNCTION public._test_seed_review_prompt_history(uuid, uuid, timestamptz, int, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._test_seed_review_prompt_history(uuid, uuid, timestamptz, int, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public._test_seed_review_prompt_history(uuid, uuid, timestamptz, int, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public._test_seed_review_prompt_history(uuid, uuid, timestamptz, int, text) TO service_role;

-- ============================================================================
-- _test_seed_with_gas — W8-followup wrapper.
-- SECDEF. Sets app.test_mode='true' TRANSACTION-LOCAL (third arg true)
-- then delegates to the bare helper. EXECUTE granted ONLY to service_role.
-- This is the SOLE callable path for test-harness seeding (Wave 5 with-test-mode.ts).
-- After the function returns, the caller's session has NO persistent GUC change
-- (transaction-local scope dies at function-call frame end).
-- ============================================================================
create or replace function public._test_seed_with_gas(
  p_user_id uuid,
  p_rule_id uuid,
  p_fired_at timestamptz,
  p_rating_value smallint,
  p_copy_variant text default null
) returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_id uuid;
begin
  -- Third arg `true` = transaction-local scope. GUC does NOT persist past this
  -- function-call frame on the calling session. Per T-36-34 mitigation.
  perform set_config('app.test_mode', 'true', true);
  v_id := public._test_seed_review_prompt_history(
    p_user_id,
    p_rule_id,
    p_fired_at,
    p_rating_value::int,
    p_copy_variant
  );
  return v_id;
end;
$fn$;

-- Service-role-only EXECUTE — explicit REVOKEs + single GRANT per W8-followup contract.
REVOKE EXECUTE ON FUNCTION public._test_seed_with_gas(uuid, uuid, timestamptz, smallint, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._test_seed_with_gas(uuid, uuid, timestamptz, smallint, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public._test_seed_with_gas(uuid, uuid, timestamptz, smallint, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public._test_seed_with_gas(uuid, uuid, timestamptz, smallint, text) TO service_role;

commit;
