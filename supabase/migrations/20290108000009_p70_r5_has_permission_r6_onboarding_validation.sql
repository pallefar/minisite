-- Plan 70-07 cascade-47 — R5 (extend has_permission) + R6 (restore org onboarding
-- mandatory-step validation), per user decisions 2026-05-30.
--
-- R5: public.has_permission() SECDEF only knew 12 owner perms, but the TS
-- ROLE_PERMISSIONS matrix (src/lib/org.ts) added 6 OWNER-only keys
-- (onboarding.ship_winner, onboarding.edit_draft, admin.gamification.read/
-- challenges.write/freeze_tokens.grant/cohorts.enable_leaderboard). role-matrix-sync
-- asserts owner→true for them. Add the 6 to the owner branch (clinician/staff
-- unchanged — they don't have these in the TS matrix either).
--
-- R6: Phase 34 (20270706000002) widened the SHARED _validate_onboarding_steps to a
-- pure shape-guard, dropping the org mandatory-step (medication + consent) and
-- custom-on-locked-step validation. That regressed org onboarding (save_org_onboarding_flow
-- could persist flows missing mandatory steps). But consumer flows
-- (save_consumer_onboarding_flow) legitimately use the D-16 step types with no
-- medication/consent, so the validation can't simply be restored on the shared function.
-- Fix: restore the ORG contract on _validate_onboarding_steps (keep the merged 16-type
-- allowlist so org D-16 flows still type-check, but re-add mandatory + custom-on-locked),
-- and give the consumer path its own pure shape-guard (_validate_consumer_onboarding_steps).
-- Repoint save_consumer_onboarding_flow at the consumer guard.

-- ── R5: has_permission — add the 6 owner-only keys ───────────────────────────
create or replace function public.has_permission(
  p_role public.org_member_role,
  p_perm text
)
returns boolean
language sql
immutable
security definer
set search_path = pg_catalog, public, extensions
as $$
  select case p_role
    when 'owner' then p_perm = any(array[
      'members.invite',
      'members.revoke',
      'members.list',
      'members.role.edit',
      'settings.edit',
      'branding.edit',
      'onboarding.edit',
      'roster.view',
      'roster.thresholds.edit',
      'alerts.ack',
      'alerts.snooze',
      'billing.view',
      -- Phase 70-07 R5 — sync with src/lib/org.ts ROLE_PERMISSIONS.owner (owner-only).
      'onboarding.ship_winner',
      'onboarding.edit_draft',
      'admin.gamification.read',
      'admin.gamification.challenges.write',
      'admin.gamification.freeze_tokens.grant',
      'admin.gamification.cohorts.enable_leaderboard'
    ])
    when 'clinician' then p_perm = any(array[
      'members.list',
      'roster.view',
      'alerts.ack',
      'alerts.snooze'
    ])
    when 'staff' then p_perm = any(array[
      'members.list',
      'roster.view'
    ])
    else false
  end
$$;

-- ── R6: ORG validator — restore mandatory + custom-on-locked (keep 16-type allowlist) ──
create or replace function public._validate_onboarding_steps(
  p_steps jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_step            jsonb;
  v_type            text;
  v_has_medication  boolean := false;
  v_has_consent     boolean := false;
begin
  if jsonb_typeof(p_steps) is distinct from 'array' then
    raise exception using errcode = 'P0001', message = 'INVALID_STEPS_NOT_ARRAY';
  end if;

  for v_step in select * from jsonb_array_elements(p_steps) loop
    v_type := v_step ->> 'type';

    -- Merged P31 org + P34 consumer D-16 allowlist (keep — org flows may use D-16 types).
    if v_type is null or v_type not in (
      'welcome', 'intro_card', 'medication', 'goals',
      'body_stats', 'consent', 'doctor_invite', 'tour',
      'text', 'single-select', 'multi-select', 'scale',
      'weight', 'date', 'nps', 'custom-component'
    ) then
      raise exception using errcode = 'P0001', message = 'UNKNOWN_STEP_TYPE';
    end if;

    -- Phase 70-07 R6 — restore: custom only on the editable types (welcome, intro_card).
    if (v_step ? 'custom') and v_type not in ('welcome', 'intro_card') then
      raise exception using errcode = 'P0001', message = 'INVALID_CUSTOM_ON_LOCKED_STEP';
    end if;

    if v_type = 'medication' then v_has_medication := true; end if;
    if v_type = 'consent'    then v_has_consent    := true; end if;
  end loop;

  -- Phase 70-07 R6 — restore: org flows MUST include the mandatory medication + consent steps.
  if not v_has_medication or not v_has_consent then
    raise exception using errcode = 'P0001', message = 'MISSING_MANDATORY_STEP';
  end if;
end;
$$;

comment on function public._validate_onboarding_steps(jsonb) is
  'P31 + P70-07 R6: ORG onboarding validator. Merged 16-type allowlist; custom only on welcome/intro_card; medication + consent mandatory. Used by save_org_onboarding_flow. Consumer flows use _validate_consumer_onboarding_steps.';

-- ── R6: CONSUMER validator — pure shape-guard (the P34 contract) ─────────────
create or replace function public._validate_consumer_onboarding_steps(
  p_steps jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_step jsonb;
  v_type text;
begin
  if jsonb_typeof(p_steps) is distinct from 'array' then
    raise exception using errcode = 'P0001', message = 'INVALID_STEPS_NOT_ARRAY';
  end if;

  for v_step in select * from jsonb_array_elements(p_steps) loop
    v_type := v_step ->> 'type';
    if v_type is null or v_type not in (
      'welcome', 'intro_card', 'medication', 'goals',
      'body_stats', 'consent', 'doctor_invite', 'tour',
      'text', 'single-select', 'multi-select', 'scale',
      'weight', 'date', 'nps', 'custom-component'
    ) then
      raise exception using errcode = 'P0001', message = 'UNKNOWN_STEP_TYPE';
    end if;
  end loop;
end;
$$;

comment on function public._validate_consumer_onboarding_steps(jsonb) is
  'P70-07 R6: CONSUMER onboarding shape-guard (no mandatory/locked rules — consumer flows use free-form D-16 step types). Split out of _validate_onboarding_steps when R6 restored the org mandatory-step validation.';

grant execute on function public._validate_consumer_onboarding_steps(jsonb) to authenticated;

-- ── R6: repoint save_consumer_onboarding_flow at the consumer guard ──────────
create or replace function public.save_consumer_onboarding_flow(
  p_steps jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_actor_role  text;
  v_next_version int;
  v_new_id      uuid;
begin
  if auth.uid() is null then
    raise exception 'forbidden_not_authenticated' using errcode = '42501';
  end if;

  select admin_role::text
    into v_actor_role
    from public.profiles
   where id = auth.uid();

  if v_actor_role is distinct from 'superadmin' then
    raise exception 'forbidden_not_superadmin' using errcode = '42501';
  end if;

  -- Phase 70-07 R6 — consumer shape-guard (NOT the org mandatory-step validator).
  perform public._validate_consumer_onboarding_steps(p_steps);

  perform pg_advisory_xact_lock(hashtext('consumer_onboarding_flow'));

  select coalesce(max(version), 0) + 1
    into v_next_version
    from public.onboarding_flows;

  update public.onboarding_flows
     set is_active = false
   where is_active = true;

  insert into public.onboarding_flows (config, version, is_active, created_by)
  values (p_steps, v_next_version, true, auth.uid())
  returning id into v_new_id;

  begin
    perform public.log_admin_action(
      p_action_name    => 'consumer_onboarding_flow.save',
      p_target_user_id => null,
      p_table_name     => 'onboarding_flows',
      p_row_pk         => v_new_id::text,
      p_before         => null,
      p_after          => jsonb_build_object(
                            'flow_id', v_new_id,
                            'version', v_next_version
                          )
    );
  exception
    when undefined_function then null;
    when undefined_object   then null;
  end;

  return v_new_id;
end;
$$;
