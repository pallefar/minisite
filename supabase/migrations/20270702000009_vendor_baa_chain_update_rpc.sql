-- =============================================================================
-- Phase 25 Plan 25-09 — SECDEF RPCs for vendor_baa_chain status transitions.
-- Closes HIPAA-12 (status-writer ownership) + HIPAA-13 (audit trail).
--
-- Rationale: Plan 25-01 revoked UPDATE on vendor_baa_chain from service_role
-- (Pattern S2). All status transitions therefore MUST go through SECURITY DEFINER
-- functions that enforce role checks and write audit rows.
--
-- Per [[feedback_status_machine_transition_owner]]:
--   'signed'  — vendor_baa_chain_update (superadmin UI via Plan 25-09 ComplianceModule)
--   'expired' — vendor_baa_chain_set_expired (baa-expiry-check cron Edge Fn)
--
-- Per Phase 24 audit_logs column shape (verified):
--   id, created_at, actor_user_id, target_user_id, action_name, table_name,
--   row_pk, before_data, after_data, org_id, source
--   constraint: source in ('rpc', 'trigger')
--   INSERT revoked from authenticated, anon, service_role — only SECDEF may insert.
--
-- Pattern S7: SECURITY DEFINER + set search_path = public, extensions, pg_catalog.
-- Pattern S3: PII-safe error codes only (no user data in raise messages).
-- RESEARCH Pitfall 5: explicit search_path prevents privilege escalation.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. vendor_baa_chain_update
--    Superadmin-only. Called from Plan 25-09 AdminCompliancePage edit-status
--    modal. Validates superadmin role, updates status='signed' + BAA dates,
--    and writes an audit_logs row.
-- ---------------------------------------------------------------------------
create or replace function public.vendor_baa_chain_update(
  p_vendor_name text,
  p_signed_at   timestamptz,
  p_expiry_at   timestamptz
) returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_actor uuid := auth.uid();
  v_role  text;
begin
  -- Pattern S3: auth checks first; no leakage of business data in error path.
  if v_actor is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select admin_role::text into v_role
    from public.profiles
   where id = v_actor;

  if v_role is null or v_role != 'superadmin' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Input validation.
  if p_vendor_name is null or trim(p_vendor_name) = '' then
    raise exception 'vendor_name_required' using errcode = '22023';
  end if;
  if p_signed_at is null then
    raise exception 'signed_at_required' using errcode = '22023';
  end if;
  if p_expiry_at is null then
    raise exception 'expiry_at_required' using errcode = '22023';
  end if;
  if p_expiry_at <= p_signed_at then
    raise exception 'expiry_must_be_after_signed_at' using errcode = '22023';
  end if;

  -- Status transition: pending|expired → signed.
  update public.vendor_baa_chain
     set status        = 'signed',
         baa_signed_at = p_signed_at,
         baa_expiry_at = p_expiry_at,
         updated_at    = now()
   where vendor_name = p_vendor_name;

  if not found then
    raise exception 'vendor_not_found' using errcode = 'P0002';
  end if;

  -- Audit trail (SECDEF required — Phase 24 revoked INSERT from service_role).
  insert into public.audit_logs (
    actor_user_id, target_user_id, action_name,
    table_name, row_pk, after_data, source
  )
  values (
    v_actor,
    null,
    'vendor_baa_signed',
    'vendor_baa_chain',
    p_vendor_name,
    jsonb_build_object(
      'vendor_name', p_vendor_name,
      'signed_at',   p_signed_at,
      'expiry_at',   p_expiry_at
    ),
    'rpc'
  );
end;
$$;

-- Grant: authenticated role (superadmin check is inside the function).
revoke all on function public.vendor_baa_chain_update(text, timestamptz, timestamptz) from public;
grant execute on function public.vendor_baa_chain_update(text, timestamptz, timestamptz) to authenticated;


-- ---------------------------------------------------------------------------
-- 2. vendor_baa_chain_set_expired
--    Service-role-callable from baa-expiry-check cron Edge Fn.
--    Flips status → 'expired' only when current status = 'signed' (idempotent).
--    Writes audit_logs row on actual state change.
-- ---------------------------------------------------------------------------
create or replace function public.vendor_baa_chain_set_expired(p_vendor_name text)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_changed boolean := false;
begin
  update public.vendor_baa_chain
     set status     = 'expired',
         updated_at = now()
   where vendor_name = p_vendor_name
     and status      = 'signed';

  if found then
    v_changed := true;
  end if;

  if v_changed then
    insert into public.audit_logs (
      actor_user_id, target_user_id, action_name,
      table_name, row_pk, after_data, source
    )
    values (
      null,
      null,
      'vendor_baa_set_expired',
      'vendor_baa_chain',
      p_vendor_name,
      jsonb_build_object('vendor_name', p_vendor_name),
      'rpc'
    );
  end if;
end;
$$;

revoke all on function public.vendor_baa_chain_set_expired(text) from public;
grant execute on function public.vendor_baa_chain_set_expired(text) to service_role;


-- ---------------------------------------------------------------------------
-- 3. log_vendor_baa_event
--    Generic SECDEF audit writer for cron Edge Fns.
--
--    Phase 24 revoked INSERT on audit_logs from service_role. The cron Edge Fns
--    (baa-expiry-check, subprocessor-diff) run as service_role and must route
--    audit row writes through this SECDEF function.
--
--    Called for:
--      action_name = 'vendor_baa_expiry_warning'  — expiry bucket alert
--      action_name = 'subprocessor_changed'       — new hash detected
--      action_name = 'subprocessor_fetch_failed'  — HTTP error on vendor URL
--
--    T-25-09-E1 note: service_role has broad write access generally; this
--    function scopes writes to vendor_baa_chain rows only (table_name is the
--    p_vendor_name's parent table). Blast radius is bounded by audit_logs
--    append-only policy (no UPDATE/DELETE from Phase 24).
-- ---------------------------------------------------------------------------
create or replace function public.log_vendor_baa_event(
  p_vendor_name text,
  p_action_name text,
  p_payload     jsonb
) returns void
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
begin
  -- Validate action names to prevent arbitrary audit log pollution.
  if p_action_name not in (
    'vendor_baa_expiry_warning',
    'subprocessor_changed',
    'subprocessor_fetch_failed'
  ) then
    raise exception 'invalid_action_name' using errcode = '22023';
  end if;

  insert into public.audit_logs (
    actor_user_id, target_user_id, action_name,
    table_name, row_pk, after_data, source
  )
  values (
    null,
    null,
    p_action_name,
    'vendor_baa_chain',
    p_vendor_name,
    p_payload,
    'rpc'
  );
end;
$$;

revoke all on function public.log_vendor_baa_event(text, text, jsonb) from public;
grant execute on function public.log_vendor_baa_event(text, text, jsonb) to service_role;
