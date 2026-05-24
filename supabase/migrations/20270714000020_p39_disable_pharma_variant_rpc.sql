-- Phase 39 Plan 39-08 — disable_pharma_variant SECDEF RPC.
--
-- CONTEXT references (39-CONTEXT.md):
--   D-03 (pharma kill thresholds — admin-driven counterpart to the auto kill-scan)
--   D-04 (single Slack channel #growth-experiments via vault decrypted_secrets)
--   D-12 (admin_audit_log row written for every variant disable)
--   PHARMA-04 (1-click reversibility flow; admin can disable a variant from
--     the Pharma admin tab and traffic returns to control immediately).
--
-- STRIDE register (39-08-PLAN.md <threat_model>):
--   T-39-08-03 Tampering: idempotent — re-running on an already-archived
--     variant is a no-op (returns null audit_id) so a double-click cannot
--     write two audit rows or refire Slack.
--   T-39-08-04 Repudiation: admin_audit_log row written + Slack alert posted
--     BEFORE the function returns (Slack is fire-and-forget via pg_net so
--     does not block the response).
--   T-39-08-05 Spoofing: is_admin_at_least('admin') gate at top of body.
--
-- Pattern memory:
--   - [[reference_supabase_migration_gotchas]]: SECURITY DEFINER requires
--     `set search_path = extensions, public, pg_temp`.
--   - [[reference_supabase_pg_cron_vault_service_role_pattern]]: net.http_post
--     + vault.decrypted_secrets bearer pattern verbatim from
--     20270714000015_p39_kill_scan_functions.sql.
--   - admin_audit_log table created in 20270714000017_p39_admin_ship_below_95_rpc.sql
--     (Plan 39-07). Reused here for variant_disable action.
--
-- Pattern S2: only this SECDEF RPC + service_role can write variant_config
-- archived_at — table has admin-RLS for SELECT but no UPDATE policy.

create or replace function public.disable_pharma_variant(
  p_variant_id uuid,
  p_reason     text
)
returns uuid
language plpgsql
security definer
set search_path = extensions, public, pg_temp
as $$
declare
  v_actor_id        uuid;
  v_audit_id        uuid;
  v_already_archived boolean;
  v_secret          text;
begin
  -- T-39-08-05 Spoofing gate.
  if not public.is_admin_at_least('admin'::public.admin_role) then
    raise exception 'forbidden_not_admin'
      using errcode = '42501',
            hint = 'disable_pharma_variant requires admin role.';
  end if;

  if p_variant_id is null then
    raise exception 'invalid_variant_id'
      using errcode = '22023',
            hint = 'p_variant_id must not be null.';
  end if;

  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'reason_required'
      using errcode = '22023',
            hint = 'p_reason must be a non-empty string (D-12 audit hygiene).';
  end if;

  -- T-39-08-03 Tampering: row lock + idempotency probe. SELECT FOR UPDATE so a
  -- concurrent call observes the new archived_at on its own re-check.
  select (archived_at is not null)
    into v_already_archived
    from public.variant_config
   where id = p_variant_id
     and surface = 'pharma'
   for update;

  if v_already_archived is null then
    raise exception 'pharma_variant_not_found'
      using errcode = 'P0002',
            hint = 'p_variant_id does not match an active pharma variant_config row.';
  end if;

  if v_already_archived then
    -- Idempotent no-op: skip the update, audit row, and Slack call.
    raise notice 'disable_pharma_variant: variant % already archived; no-op', p_variant_id;
    return null;
  end if;

  v_actor_id := auth.uid();

  -- Flip archived_at — traffic falls back to control on next assignment.
  update public.variant_config
     set archived_at = now()
   where id = p_variant_id
     and surface = 'pharma'
     and archived_at is null;

  -- T-39-08-04 Repudiation: append audit row BEFORE returning.
  insert into public.admin_audit_log (actor_id, action, context)
  values (
    v_actor_id,
    'pharma_disable',
    jsonb_build_object(
      'variant_id', p_variant_id,
      'reason',     p_reason
    )
  )
  returning id into v_audit_id;

  -- D-04 Slack alert via vault decrypted_secrets (pattern verbatim from
  -- 20270714000015_p39_kill_scan_functions.sql). Failure to alert MUST NOT
  -- block the disable (T-39-08-07 accepted residual).
  begin
    select decrypted_secret into v_secret
      from vault.decrypted_secrets
     where name = 'service_role_key'
     limit 1;
    if v_secret is not null then
      perform net.http_post(
        url := 'https://ytnsipxxmzgaebkqmokp.supabase.co/functions/v1/slack-alert-experiments',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || v_secret,
          'Content-Type', 'application/json'
        ),
        body := jsonb_build_object(
          'kind', 'variant_kill',
          'variant_id', p_variant_id::text,
          'message', format('Pharma variant %s manually disabled by admin (PHARMA-04)', p_variant_id),
          'context', jsonb_build_object(
            'reason', p_reason,
            'actor_id', v_actor_id::text,
            'trigger', 'admin_disable_pharma_variant'
          )
        ),
        timeout_milliseconds := 30000
      );
    end if;
  exception when others then
    raise notice 'disable_pharma_variant: slack alert failed: %', sqlerrm;
  end;

  return v_audit_id;
end;
$$;

comment on function public.disable_pharma_variant(uuid, text) is
  'Phase 39 PHARMA-04 + T-39-08-03/04/05: admin-only SECDEF RPC for the 1-click '
  'pharma variant disable flow. Sets variant_config.archived_at, appends '
  'admin_audit_log row with action=pharma_disable, posts to slack-alert-experiments '
  'with kind=variant_kill via vault decrypted_secrets. Idempotent: a no-op '
  'returning NULL when the variant is already archived. Returns the new '
  'admin_audit_log row id on successful disable.';

revoke all on function public.disable_pharma_variant(uuid, text) from public;
grant execute on function public.disable_pharma_variant(uuid, text)
  to authenticated;
