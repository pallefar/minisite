-- Phase 26 Plan 05 — Admin tier RPCs (5 SECDEF functions).
-- AFFTIER-01 admin grant + AFFTIER-05 anomaly review surfaces.
--
-- All 5 functions:
--   - SECURITY DEFINER with `set search_path = public, pg_catalog` (locked)
--   - Gate on `is_admin_at_least('superadmin'::public.admin_role)` per Phase 24 D-04
--   - Suppress trigger-side audit via `set_config('app.suppress_audit', 'on', true)`
--     and INSERT directly into audit_logs (source='rpc') for explicit row-PK pinning
--   - action_name is FREE TEXT in Phase 24 audit_logs — no CHECK extension needed
--
-- Decision refs: Phase 26 D-04 (superadmin gate), D-11 (anomaly review tab),
-- D-14 (Gold→Lifetime grant + 7-day reverse window), Pitfall 5 (DUAL reverse-gate:
-- BOTH no-recurring-payout AND <7d window must hold).

-- ============================================================================
-- 1. admin_grant_lifetime — Gold -> Lifetime per D-14
-- ============================================================================
create or replace function public.admin_grant_lifetime(p_affiliate_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_caller uuid := auth.uid();
  v_prev_tier text;
  v_target uuid;
begin
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not public.is_admin_at_least('superadmin'::public.admin_role) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select tier, user_id into v_prev_tier, v_target
    from public.affiliates
   where id = p_affiliate_id
   for update;

  if v_prev_tier is null then
    raise exception 'affiliate_not_found' using errcode = '22023';
  end if;
  if v_prev_tier = 'lifetime' then
    return;  -- idempotent
  end if;
  if v_prev_tier <> 'gold' then
    raise exception 'must_be_gold_first' using errcode = '22023';
  end if;

  perform set_config('app.suppress_audit', 'on', true);
  update public.affiliates
     set tier = 'lifetime',
         tier_promoted_at = now(),
         tier_grantor_user_id = v_caller
   where id = p_affiliate_id;

  insert into public.audit_logs
    (actor_user_id, target_user_id, action_name, table_name, row_pk,
     before_data, after_data, source)
  values
    (v_caller, v_target, 'affiliate_tier_granted',
     'public.affiliates', p_affiliate_id::text,
     jsonb_build_object('tier', v_prev_tier),
     jsonb_build_object('tier', 'lifetime', 'grantor', v_caller),
     'rpc');
end;
$$;
revoke all on function public.admin_grant_lifetime(uuid) from public;
grant execute on function public.admin_grant_lifetime(uuid) to authenticated;

-- ============================================================================
-- 2. admin_reverse_lifetime_grant — per D-14 + Pitfall 5 DUAL gate
-- ============================================================================
-- Pitfall 5: BOTH gates must hold for reverse to succeed.
--   (a) NO row in affiliate_lifetime_recurring_payments for this affiliate, AND
--   (b) (now() - tier_promoted_at) < 7 days.
-- Either failure raises `cannot_reverse_lifetime` — state corruption guard.
create or replace function public.admin_reverse_lifetime_grant(p_affiliate_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_caller uuid := auth.uid();
  v_tier text;
  v_promoted_at timestamptz;
  v_has_payout boolean;
  v_target uuid;
begin
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not public.is_admin_at_least('superadmin'::public.admin_role) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select tier, tier_promoted_at, user_id
    into v_tier, v_promoted_at, v_target
    from public.affiliates
   where id = p_affiliate_id
   for update;

  if v_tier is null then
    raise exception 'affiliate_not_found' using errcode = '22023';
  end if;
  if v_tier <> 'lifetime' then
    raise exception 'not_lifetime' using errcode = '22023';
  end if;

  select exists (
    select 1
      from public.affiliate_lifetime_recurring_payments
     where affiliate_id = p_affiliate_id
  ) into v_has_payout;

  if v_has_payout or (now() - v_promoted_at) > interval '7 days' then
    raise exception 'cannot_reverse_lifetime: payout already shipped or window expired'
      using errcode = '22023';
  end if;

  perform set_config('app.suppress_audit', 'on', true);
  update public.affiliates
     set tier = 'gold',
         tier_promoted_at = null,
         tier_grantor_user_id = null
   where id = p_affiliate_id;

  insert into public.audit_logs
    (actor_user_id, target_user_id, action_name, table_name, row_pk,
     before_data, after_data, source)
  values
    (v_caller, v_target, 'affiliate_tier_grant_reversed',
     'public.affiliates', p_affiliate_id::text,
     jsonb_build_object('tier', 'lifetime', 'promoted_at', v_promoted_at),
     jsonb_build_object('tier', 'gold'),
     'rpc');
end;
$$;
revoke all on function public.admin_reverse_lifetime_grant(uuid) from public;
grant execute on function public.admin_reverse_lifetime_grant(uuid) to authenticated;

-- ============================================================================
-- 3. admin_freeze_affiliate — per D-04
-- ============================================================================
create or replace function public.admin_freeze_affiliate(p_affiliate_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_caller uuid := auth.uid();
  v_prev_frozen timestamptz;
  v_target uuid;
begin
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not public.is_admin_at_least('superadmin'::public.admin_role) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'reason_required' using errcode = '22023';
  end if;

  select frozen_at, user_id into v_prev_frozen, v_target
    from public.affiliates
   where id = p_affiliate_id
   for update;

  if v_target is null then
    raise exception 'affiliate_not_found' using errcode = '22023';
  end if;
  if v_prev_frozen is not null then
    return;  -- idempotent: already frozen
  end if;

  perform set_config('app.suppress_audit', 'on', true);
  update public.affiliates
     set frozen_at = now(),
         freeze_reason = p_reason
   where id = p_affiliate_id;

  insert into public.audit_logs
    (actor_user_id, target_user_id, action_name, table_name, row_pk,
     before_data, after_data, source)
  values
    (v_caller, v_target, 'affiliate_tier_frozen',
     'public.affiliates', p_affiliate_id::text,
     jsonb_build_object('frozen_at', null),
     jsonb_build_object('frozen_at', now(), 'reason', p_reason),
     'rpc');
end;
$$;
revoke all on function public.admin_freeze_affiliate(uuid, text) from public;
grant execute on function public.admin_freeze_affiliate(uuid, text) to authenticated;

-- ============================================================================
-- 4. admin_unfreeze_affiliate
-- ============================================================================
create or replace function public.admin_unfreeze_affiliate(p_affiliate_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_caller uuid := auth.uid();
  v_prev_frozen timestamptz;
  v_target uuid;
begin
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not public.is_admin_at_least('superadmin'::public.admin_role) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select frozen_at, user_id into v_prev_frozen, v_target
    from public.affiliates
   where id = p_affiliate_id
   for update;

  if v_target is null then
    raise exception 'affiliate_not_found' using errcode = '22023';
  end if;
  if v_prev_frozen is null then
    return;  -- idempotent: not frozen
  end if;

  perform set_config('app.suppress_audit', 'on', true);
  update public.affiliates
     set frozen_at = null,
         freeze_reason = null
   where id = p_affiliate_id;

  insert into public.audit_logs
    (actor_user_id, target_user_id, action_name, table_name, row_pk,
     before_data, after_data, source)
  values
    (v_caller, v_target, 'affiliate_tier_unfrozen',
     'public.affiliates', p_affiliate_id::text,
     jsonb_build_object('frozen_at', v_prev_frozen),
     jsonb_build_object('frozen_at', null),
     'rpc');
end;
$$;
revoke all on function public.admin_unfreeze_affiliate(uuid) from public;
grant execute on function public.admin_unfreeze_affiliate(uuid) to authenticated;

-- ============================================================================
-- 5. admin_anomaly_review_decision
-- ============================================================================
-- On 'fraud_confirmed' ALSO writes affiliate_fraud_signals(signal_type='manual')
-- so Plan 26-07 claw-back path can correlate at next refund/chargeback event.
create or replace function public.admin_anomaly_review_decision(
  p_conversion_id uuid,
  p_decision text
)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_caller uuid := auth.uid();
  v_affiliate_id uuid;
  v_z numeric;
  v_action text;
  v_target uuid;
begin
  if v_caller is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not public.is_admin_at_least('superadmin'::public.admin_role) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_decision not in ('clear', 'fraud_confirmed') then
    raise exception 'invalid_decision' using errcode = '22023';
  end if;

  select affiliate_id, anomaly_z_score
    into v_affiliate_id, v_z
    from public.affiliate_conversions
   where id = p_conversion_id
     and anomaly_flagged = true
   for update;

  if v_affiliate_id is null then
    raise exception 'conversion_not_found_or_not_flagged' using errcode = '22023';
  end if;

  -- Derive the affiliate-owning user for the audit row's target_user_id.
  select user_id into v_target
    from public.affiliates
   where id = v_affiliate_id;

  perform set_config('app.suppress_audit', 'on', true);
  update public.affiliate_conversions
     set anomaly_review_decision = p_decision,
         anomaly_reviewed_at = now()
   where id = p_conversion_id;

  v_action := case p_decision
    when 'clear' then 'affiliate_anomaly_cleared'
    when 'fraud_confirmed' then 'affiliate_anomaly_fraud_confirmed'
  end;

  insert into public.audit_logs
    (actor_user_id, target_user_id, action_name, table_name, row_pk,
     before_data, after_data, source)
  values
    (v_caller, v_target, v_action,
     'public.affiliate_conversions', p_conversion_id::text,
     jsonb_build_object('anomaly_review_decision', null, 'z_score', v_z),
     jsonb_build_object('anomaly_review_decision', p_decision),
     'rpc');

  -- On fraud_confirmed: ALSO write fraud_signals row so claw-back/freeze paths
  -- can correlate (Plan 26-07 webhook handler at next refund/chargeback event).
  if p_decision = 'fraud_confirmed' then
    insert into public.affiliate_fraud_signals
      (affiliate_id, conversion_id, signal_type, payload,
       reviewed_at, decision, reviewer_user_id)
    values
      (v_affiliate_id, p_conversion_id, 'manual',
       jsonb_build_object(
         'kind', 'manual',
         'reporter_user_id', v_caller,
         'note', 'admin_anomaly_review_decision=fraud_confirmed',
         'z_score', v_z
       ),
       now(), 'fraud_confirmed', v_caller);
  end if;
end;
$$;
revoke all on function public.admin_anomaly_review_decision(uuid, text) from public;
grant execute on function public.admin_anomaly_review_decision(uuid, text) to authenticated;
