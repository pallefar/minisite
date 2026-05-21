-- Phase 40 Plan 40-05 — POLISH-01 / POLISH-04
-- SECDEF RPCs for save_offer_rules admin CRUD:
--   1. save_offer_rule_create  — admin+ creates a rule, returns uuid
--   2. save_offer_rule_update  — admin+ updates a rule (incl. active toggle)
--   3. save_offer_rule_archive — superadmin-only, sets active=false + audit log
--   4. save_offer_rule_reorder — admin+ atomically reassigns priority from ordered array
--
-- Pattern: supabase/migrations/20270602000012_cohort_rpcs.sql lines 139-276 (EXACT analog).
-- SECDEF preamble: language plpgsql security definer set search_path = public, extensions, pg_catalog
-- Auth: auth.uid() null-check (28000) + is_admin_at_least role gate (42501)
-- Audit: set_config('app.suppress_audit','on',true) + log_admin_action(...)
-- Grant: revoke from public; grant execute to authenticated
-- Named dollar-quote tags ($body$) — NEVER bare $$ per project convention.

-- ============================================================================
-- 1. save_offer_rule_create
-- ============================================================================

create or replace function public.save_offer_rule_create(
  p_title             text,
  p_cohort_id         uuid,
  p_tenure_buckets    text[],
  p_reasons           text[],
  p_org_type          text,
  p_offer_type        text,
  p_pause_months      integer,
  p_coupon_id         text,
  p_extension_days    integer,
  p_downgrade_target  text,
  p_priority          integer
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $body$
declare
  v_caller    uuid := auth.uid();
  v_rule_id   uuid;
begin
  -- ── Auth ────────────────────────────────────────────────────────────────────
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not public.is_admin_at_least('admin'::public.admin_role) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- ── Input validation ────────────────────────────────────────────────────────
  if p_title is null or length(trim(p_title)) = 0 then
    raise exception 'invalid_input: title required' using errcode = '22023';
  end if;
  if p_offer_type not in ('pause','discount','extended_trial','downgrade','contact_csm') then
    raise exception 'invalid_input: offer_type not in allowed set' using errcode = '22023';
  end if;
  if p_org_type not in ('any','consumer','clinic') then
    raise exception 'invalid_input: org_type not in allowed set' using errcode = '22023';
  end if;
  if p_offer_type = 'pause' and p_pause_months is not null
     and p_pause_months not in (1, 2, 3) then
    raise exception 'invalid_input: pause_months must be 1, 2, or 3' using errcode = '22023';
  end if;
  if p_offer_type = 'discount' then
    if p_coupon_id is null then
      raise exception 'invalid_input: coupon_id required for discount offer' using errcode = '22023';
    end if;
    if p_coupon_id !~ '^SAVE-(20|25|30)-(2|3)MO$' then
      raise exception 'invalid_input: coupon_id must match catalog regex SAVE-(20|25|30)-(2|3)MO' using errcode = '22023';
    end if;
  end if;
  if p_offer_type = 'extended_trial' and p_extension_days is not null
     and p_extension_days not in (7, 14, 30) then
    raise exception 'invalid_input: extension_days must be 7, 14, or 30' using errcode = '22023';
  end if;
  if p_offer_type = 'downgrade' and p_downgrade_target is not null
     and p_downgrade_target <> 'price_monthly' then
    raise exception 'invalid_input: downgrade_target must be price_monthly' using errcode = '22023';
  end if;

  -- ── Audit suppression + write ────────────────────────────────────────────────
  perform set_config('app.suppress_audit', 'on', true);

  insert into public.save_offer_rules (
    title,
    cohort_id,
    tenure_buckets,
    reasons,
    org_type,
    offer_type,
    pause_months,
    coupon_id,
    extension_days,
    downgrade_target,
    priority,
    created_by
  ) values (
    p_title,
    p_cohort_id,
    coalesce(p_tenure_buckets, '{}'),
    coalesce(p_reasons, '{}'),
    p_org_type,
    p_offer_type,
    p_pause_months,
    p_coupon_id,
    p_extension_days,
    p_downgrade_target,
    coalesce(p_priority, 100),
    v_caller
  )
  returning id into v_rule_id;

  perform public.log_admin_action(
    p_action_name    => 'save_offer_rule_created',
    p_target_user_id => null,
    p_table_name     => 'public.save_offer_rules',
    p_row_pk         => v_rule_id::text,
    p_before         => null,
    p_after          => jsonb_build_object(
                          'title', p_title,
                          'offer_type', p_offer_type,
                          'priority', p_priority
                        )
  );

  return v_rule_id;
end;
$body$;

revoke all on function public.save_offer_rule_create(
  text, uuid, text[], text[], text, text, integer, text, integer, text, integer
) from public;
grant execute on function public.save_offer_rule_create(
  text, uuid, text[], text[], text, text, integer, text, integer, text, integer
) to authenticated;

-- ============================================================================
-- 2. save_offer_rule_update
-- ============================================================================

create or replace function public.save_offer_rule_update(
  p_id                uuid,
  p_title             text,
  p_cohort_id         uuid,
  p_tenure_buckets    text[],
  p_reasons           text[],
  p_org_type          text,
  p_offer_type        text,
  p_pause_months      integer,
  p_coupon_id         text,
  p_extension_days    integer,
  p_downgrade_target  text,
  p_priority          integer,
  p_active            boolean
)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $body$
declare
  v_caller    uuid := auth.uid();
  v_prev_row  public.save_offer_rules%rowtype;
begin
  -- ── Auth ────────────────────────────────────────────────────────────────────
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not public.is_admin_at_least('admin'::public.admin_role) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- ── Input validation ────────────────────────────────────────────────────────
  if p_id is null then
    raise exception 'invalid_input: id required' using errcode = '22023';
  end if;
  if p_title is not null and length(trim(p_title)) = 0 then
    raise exception 'invalid_input: title cannot be empty' using errcode = '22023';
  end if;
  if p_offer_type is not null
     and p_offer_type not in ('pause','discount','extended_trial','downgrade','contact_csm') then
    raise exception 'invalid_input: offer_type not in allowed set' using errcode = '22023';
  end if;
  if p_org_type is not null
     and p_org_type not in ('any','consumer','clinic') then
    raise exception 'invalid_input: org_type not in allowed set' using errcode = '22023';
  end if;
  if p_offer_type = 'discount' and p_coupon_id is not null
     and p_coupon_id !~ '^SAVE-(20|25|30)-(2|3)MO$' then
    raise exception 'invalid_input: coupon_id must match catalog regex SAVE-(20|25|30)-(2|3)MO' using errcode = '22023';
  end if;
  if p_offer_type = 'pause' and p_pause_months is not null
     and p_pause_months not in (1, 2, 3) then
    raise exception 'invalid_input: pause_months must be 1, 2, or 3' using errcode = '22023';
  end if;
  if p_offer_type = 'extended_trial' and p_extension_days is not null
     and p_extension_days not in (7, 14, 30) then
    raise exception 'invalid_input: extension_days must be 7, 14, or 30' using errcode = '22023';
  end if;
  if p_offer_type = 'downgrade' and p_downgrade_target is not null
     and p_downgrade_target <> 'price_monthly' then
    raise exception 'invalid_input: downgrade_target must be price_monthly' using errcode = '22023';
  end if;

  -- ── Fetch existing row ──────────────────────────────────────────────────────
  select * into v_prev_row
    from public.save_offer_rules
    where id = p_id
    for update;

  if not found then
    raise exception 'not_found' using errcode = '22023';
  end if;

  -- ── Audit suppression + write ────────────────────────────────────────────────
  perform set_config('app.suppress_audit', 'on', true);

  update public.save_offer_rules
    set
      title            = coalesce(p_title, title),
      cohort_id        = coalesce(p_cohort_id, cohort_id),
      tenure_buckets   = coalesce(p_tenure_buckets, tenure_buckets),
      reasons          = coalesce(p_reasons, reasons),
      org_type         = coalesce(p_org_type, org_type),
      offer_type       = coalesce(p_offer_type, offer_type),
      pause_months     = coalesce(p_pause_months, pause_months),
      coupon_id        = coalesce(p_coupon_id, coupon_id),
      extension_days   = coalesce(p_extension_days, extension_days),
      downgrade_target = coalesce(p_downgrade_target, downgrade_target),
      priority         = coalesce(p_priority, priority),
      active           = coalesce(p_active, active)
    where id = p_id;

  perform public.log_admin_action(
    p_action_name    => 'save_offer_rule_updated',
    p_target_user_id => null,
    p_table_name     => 'public.save_offer_rules',
    p_row_pk         => p_id::text,
    p_before         => to_jsonb(v_prev_row),
    p_after          => jsonb_build_object(
                          'title', coalesce(p_title, v_prev_row.title),
                          'offer_type', coalesce(p_offer_type, v_prev_row.offer_type),
                          'active', coalesce(p_active, v_prev_row.active)
                        )
  );
end;
$body$;

revoke all on function public.save_offer_rule_update(
  uuid, text, uuid, text[], text[], text, text, integer, text, integer, text, integer, boolean
) from public;
grant execute on function public.save_offer_rule_update(
  uuid, text, uuid, text[], text[], text, text, integer, text, integer, text, integer, boolean
) to authenticated;

-- ============================================================================
-- 3. save_offer_rule_archive — superadmin-only (destructive lifecycle gate)
-- ============================================================================

create or replace function public.save_offer_rule_archive(
  p_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $body$
declare
  v_caller    uuid := auth.uid();
  v_prev_row  public.save_offer_rules%rowtype;
begin
  -- ── Auth — superadmin only (per T-40-05-02 + cohort_set_status destructive precedent) ──
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not public.is_admin_at_least('superadmin'::public.admin_role) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_id is null then
    raise exception 'invalid_input: id required' using errcode = '22023';
  end if;

  -- ── Fetch existing row ──────────────────────────────────────────────────────
  select * into v_prev_row
    from public.save_offer_rules
    where id = p_id
    for update;

  if not found then
    raise exception 'not_found' using errcode = '22023';
  end if;

  -- ── Audit suppression + write ────────────────────────────────────────────────
  perform set_config('app.suppress_audit', 'on', true);

  update public.save_offer_rules
    set active = false
    where id = p_id;

  perform public.log_admin_action(
    p_action_name    => 'save_offer_rule_archived',
    p_target_user_id => null,
    p_table_name     => 'public.save_offer_rules',
    p_row_pk         => p_id::text,
    p_before         => to_jsonb(v_prev_row),
    p_after          => jsonb_build_object('active', false, 'archived', true)
  );
end;
$body$;

revoke all on function public.save_offer_rule_archive(uuid) from public;
grant execute on function public.save_offer_rule_archive(uuid) to authenticated;

-- ============================================================================
-- 4. save_offer_rule_reorder — atomic priority reassignment
-- ============================================================================

create or replace function public.save_offer_rule_reorder(
  p_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $body$
declare
  v_caller    uuid := auth.uid();
  v_unique_ct integer;
begin
  -- ── Auth ────────────────────────────────────────────────────────────────────
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not public.is_admin_at_least('admin'::public.admin_role) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_ids is null or array_length(p_ids, 1) is null then
    raise exception 'invalid_input: p_ids must be a non-empty array' using errcode = '22023';
  end if;

  -- Validate uniqueness: no duplicates in the input array
  select count(distinct u) into v_unique_ct from unnest(p_ids) u;
  if v_unique_ct <> array_length(p_ids, 1) then
    raise exception 'invalid_input: p_ids contains duplicate UUIDs' using errcode = '22023';
  end if;

  -- ── Audit suppression + atomic priority update ────────────────────────────
  perform set_config('app.suppress_audit', 'on', true);

  -- Single UPDATE: assigns priority = 1-based position in the ordered array
  -- array_position returns NULL for IDs not in p_ids (those rows unchanged)
  update public.save_offer_rules
    set priority   = array_position(p_ids, id),
        updated_at = now()
    where id = any(p_ids);

  perform public.log_admin_action(
    p_action_name    => 'save_offer_rule_reordered',
    p_target_user_id => null,
    p_table_name     => 'public.save_offer_rules',
    p_row_pk         => null,
    p_before         => null,
    p_after          => jsonb_build_object('ordered_ids', to_jsonb(p_ids))
  );
end;
$body$;

revoke all on function public.save_offer_rule_reorder(uuid[]) from public;
grant execute on function public.save_offer_rule_reorder(uuid[]) to authenticated;
