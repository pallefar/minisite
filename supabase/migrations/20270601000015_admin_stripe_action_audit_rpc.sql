-- Phase 22 plan 01 — ADMIN-04 (D-05): SECURITY DEFINER RPCs to inline-write Stripe-action audit rows.
-- Analog: supabase/migrations/20260901000005_log_clinic_view_rpc.sql (SECURITY DEFINER audit-write)
-- Pitfalls applied: Pitfall 3 (uses enum values added in File 02 in a separate migration),
--                   Pitfall 4 (app.suppress_audit GUC inside each function body).
--
-- These three RPCs are called by the admin-stripe-action Edge Function (Plan 22-03) AFTER the
-- Stripe SDK succeeds, ensuring the audit row exists even if the Stripe webhook delivery is
-- delayed or fails. Without this inline write, admin actions would only audit when the webhook
-- catches up — operationally awkward.

-- =============================================================================
-- admin_log_refund — record refund_issued event after Stripe `refunds.create` succeeds
-- =============================================================================
create or replace function public.admin_log_refund(
  p_target_user_id uuid,
  p_charge_id text,
  p_amount_cents int,
  p_reason text
)
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
  if not public.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_amount_cents <= 0 then
    raise exception 'invalid_amount' using errcode = '22023';
  end if;

  perform set_config('app.suppress_audit', 'true', true);

  insert into public.audit_logs (
    user_id, user_id_hash, table_name, row_id, action, target_user_id, metadata
  ) values (
    v_caller,
    encode(digest(v_caller::text, 'sha256'), 'hex'),
    'stripe.charges',
    p_charge_id,
    'refund_issued',
    p_target_user_id,
    jsonb_build_object(
      'charge_id', p_charge_id,
      'amount_cents', p_amount_cents,
      'reason', p_reason
    )
  );
end;
$$;

revoke all on function public.admin_log_refund(uuid, text, int, text) from public;
grant execute on function public.admin_log_refund(uuid, text, int, text) to authenticated;

-- =============================================================================
-- admin_log_subscription_canceled — record subscription_canceled_admin event
-- =============================================================================
create or replace function public.admin_log_subscription_canceled(
  p_target_user_id uuid,
  p_subscription_id text
)
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
  if not public.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  perform set_config('app.suppress_audit', 'true', true);

  insert into public.audit_logs (
    user_id, user_id_hash, table_name, row_id, action, target_user_id, metadata
  ) values (
    v_caller,
    encode(digest(v_caller::text, 'sha256'), 'hex'),
    'stripe.subscriptions',
    p_subscription_id,
    'subscription_canceled_admin',
    p_target_user_id,
    jsonb_build_object('subscription_id', p_subscription_id)
  );
end;
$$;

revoke all on function public.admin_log_subscription_canceled(uuid, text) from public;
grant execute on function public.admin_log_subscription_canceled(uuid, text) to authenticated;

-- =============================================================================
-- admin_log_subscription_comped — record subscription_comped event with trial_end metadata
-- =============================================================================
create or replace function public.admin_log_subscription_comped(
  p_target_user_id uuid,
  p_subscription_id text,
  p_trial_end timestamptz
)
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
  if not public.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  perform set_config('app.suppress_audit', 'true', true);

  insert into public.audit_logs (
    user_id, user_id_hash, table_name, row_id, action, target_user_id, metadata
  ) values (
    v_caller,
    encode(digest(v_caller::text, 'sha256'), 'hex'),
    'stripe.subscriptions',
    p_subscription_id,
    'subscription_comped',
    p_target_user_id,
    jsonb_build_object(
      'subscription_id', p_subscription_id,
      'trial_end', p_trial_end
    )
  );
end;
$$;

revoke all on function public.admin_log_subscription_comped(uuid, text, timestamptz) from public;
grant execute on function public.admin_log_subscription_comped(uuid, text, timestamptz) to authenticated;
