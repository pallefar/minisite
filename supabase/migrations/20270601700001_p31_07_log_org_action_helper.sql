-- =============================================================================
-- Plan 31-07 (verification gap closure) — log_org_action() audit helper
-- =============================================================================
-- Closes both gsd-verifier BLOCKERs (2026-05-18):
--   (1) change_member_role  — broken 2-arg log_admin_action call (overload doesn't exist)
--   (2) save_org_branding   — admin-gate rejection (org-owners aren't system admins)
-- Plus a third undiscovered case the verifier missed:
--   (3) activate_onboarding_flow_version — same 2-arg signature bug as change_member_role
--
-- Phase 24's log_admin_action gates on is_admin_at_least('staff'::admin_role).
-- That gate is correct for SYSTEM admin actions but wrong for ORG-OWNER actions:
-- a clinic owner authenticated via the public site is NOT a system admin and
-- gets 42501 from log_admin_action, rolling back the entire SECDEF transaction.
--
-- Fix: NEW log_org_action() that gates on get_caller_role(p_org_id) IS NOT NULL
-- (i.e., the caller is a member of the org). Writes to the EXISTING audit_logs
-- table (audit_logs.org_id column was added by Phase 28; audit_actor_type enum
-- already has the 'org_member' value — Phase 24 anticipated this split).
--
-- Then CREATE OR REPLACE the 4 P31 SECDEFs to use the new helper:
--   - save_org_branding
--   - save_org_onboarding_flow  (drops the now-unnecessary EXCEPTION wrap)
--   - activate_onboarding_flow_version  (fixes signature bug too)
--   - change_member_role  (fixes signature bug too)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. NEW SECDEF: log_org_action — org-scoped audit, gated on org membership
-- -----------------------------------------------------------------------------
create or replace function public.log_org_action(
  p_org_id          uuid,
  p_action_name     text,
  p_target_user_id  uuid    default null,
  p_table_name      text    default null,
  p_row_pk          text    default null,
  p_before          jsonb   default null,
  p_after           jsonb   default null
)
returns uuid
language plpgsql
security definer
set search_path to 'extensions', 'public', 'pg_temp'
as $$
declare
  v_id          uuid;
  v_actor_role  public.org_member_role;
begin
  -- Caller must be authenticated.
  if auth.uid() is null then
    raise exception 'log_org_action: caller is not authenticated'
      using errcode = '42501';
  end if;

  -- Caller must be a member of the org (any role). The CALLING SECDEF is
  -- responsible for the per-action permission gate; this function just enforces
  -- the org-membership boundary so non-members can't write audit rows for orgs
  -- they don't belong to.
  v_actor_role := public.get_caller_role(p_org_id);
  if v_actor_role is null then
    raise exception 'log_org_action: caller is not a member of org %', p_org_id
      using errcode = '42501';
  end if;

  insert into public.audit_logs (
    actor_user_id,
    actor_type,
    target_user_id,
    org_id,
    action_name,
    table_name,
    row_pk,
    before_data,
    after_data,
    source,
    metadata
  ) values (
    auth.uid(),
    'org_member'::public.audit_actor_type,
    p_target_user_id,
    p_org_id,
    p_action_name,
    p_table_name,
    p_row_pk,
    p_before,
    p_after,
    'rpc',
    jsonb_build_object('actor_role', v_actor_role::text)
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.log_org_action(uuid, text, uuid, text, text, jsonb, jsonb) from public;
grant execute on function public.log_org_action(uuid, text, uuid, text, text, jsonb, jsonb) to authenticated, service_role;

comment on function public.log_org_action(uuid, text, uuid, text, text, jsonb, jsonb)
  is 'P31-07: org-scoped audit helper. Gates on org membership (any role), not system admin role. Use from any SECDEF whose caller is a clinic org_member. Writes to audit_logs with actor_type=org_member and metadata.actor_role populated.';


-- -----------------------------------------------------------------------------
-- 2. CREATE OR REPLACE save_org_branding — swap log_admin_action → log_org_action
-- -----------------------------------------------------------------------------
create or replace function public.save_org_branding(p_org_id uuid, p_tokens jsonb)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'extensions'
as $$
declare
  v_role           public.org_member_role;
  v_logo_url       text;
  v_favicon_url    text;
  v_primary_color  text;
  v_accent_color   text;
  v_bg_color       text;
  v_text_color     text;
  v_heading_font   text;
  v_body_font      text;
  v_radius_scale   text;
  v_support_email  text;
begin
  v_role := public.get_caller_role(p_org_id);

  if not public.has_permission(v_role, 'branding.edit') then
    raise exception 'insufficient_privilege' using errcode = '42501';
  end if;

  v_logo_url      := p_tokens->>'logo_url';
  v_favicon_url   := p_tokens->>'favicon_url';
  v_primary_color := p_tokens->>'primary_color';
  v_accent_color  := p_tokens->>'accent_color';
  v_bg_color      := p_tokens->>'bg_color';
  v_text_color    := p_tokens->>'text_color';
  v_heading_font  := p_tokens->>'heading_font';
  v_body_font     := p_tokens->>'body_font';
  v_radius_scale  := p_tokens->>'radius_scale';
  v_support_email := p_tokens->>'support_email';

  if v_primary_color is not null and not public._is_valid_oklch(v_primary_color) then
    raise exception 'INVALID_OKLCH_FORMAT' using errcode = '22023', detail = 'primary_color';
  end if;
  if v_accent_color is not null and not public._is_valid_oklch(v_accent_color) then
    raise exception 'INVALID_OKLCH_FORMAT' using errcode = '22023', detail = 'accent_color';
  end if;
  if v_bg_color is not null and not public._is_valid_oklch(v_bg_color) then
    raise exception 'INVALID_OKLCH_FORMAT' using errcode = '22023', detail = 'bg_color';
  end if;
  if v_text_color is not null and not public._is_valid_oklch(v_text_color) then
    raise exception 'INVALID_OKLCH_FORMAT' using errcode = '22023', detail = 'text_color';
  end if;

  if v_radius_scale is not null and v_radius_scale not in ('sm', 'md', 'lg', 'xl') then
    raise exception 'INVALID_RADIUS_SCALE' using errcode = '22023', detail = 'radius_scale';
  end if;

  if v_heading_font is not null and v_heading_font not in (
    'Inter', 'Fraunces', 'JetBrains Mono', 'Lora', 'IBM Plex Sans'
  ) then
    raise exception 'INVALID_FONT_FAMILY' using errcode = '22023', detail = 'heading_font';
  end if;
  if v_body_font is not null and v_body_font not in (
    'Inter', 'Fraunces', 'JetBrains Mono', 'Lora', 'IBM Plex Sans'
  ) then
    raise exception 'INVALID_FONT_FAMILY' using errcode = '22023', detail = 'body_font';
  end if;

  if v_text_color is not null and v_bg_color is not null
     and public._compute_wcag_contrast(v_text_color, v_bg_color) < 4.5
  then
    raise exception 'CONTRAST_TEXT_BG_FAIL' using errcode = '22023';
  end if;

  if v_primary_color is not null and v_bg_color is not null
     and public._compute_wcag_contrast(v_primary_color, v_bg_color) < 3.0
  then
    raise exception 'CONTRAST_PRIMARY_BG_FAIL' using errcode = '22023';
  end if;

  insert into public.org_branding (
    org_id, logo_url, favicon_url, primary_color, accent_color, bg_color,
    text_color, heading_font, body_font, radius_scale, support_email, updated_at
  ) values (
    p_org_id, v_logo_url, v_favicon_url, v_primary_color, v_accent_color, v_bg_color,
    v_text_color, v_heading_font, v_body_font, v_radius_scale, v_support_email, now()
  )
  on conflict (org_id) do update set
    logo_url      = excluded.logo_url,
    favicon_url   = excluded.favicon_url,
    primary_color = excluded.primary_color,
    accent_color  = excluded.accent_color,
    bg_color      = excluded.bg_color,
    text_color    = excluded.text_color,
    heading_font  = excluded.heading_font,
    body_font     = excluded.body_font,
    radius_scale  = excluded.radius_scale,
    support_email = excluded.support_email,
    updated_at    = now()
  where org_branding.org_id = excluded.org_id;

  -- AUDIT: was log_admin_action (admin_role gate rejected org-owners → 42501);
  -- now log_org_action (org-member gate).
  perform public.log_org_action(
    p_org_id,
    'org_branding.update',
    p_org_id,                  -- p_target_user_id (resource id)
    'org_branding',
    p_org_id::text,
    null,
    jsonb_build_object(
      'org_id',         p_org_id,
      'changed_fields', (select array_agg(k) from jsonb_object_keys(p_tokens) as k)
    )
  );
end;
$$;


-- -----------------------------------------------------------------------------
-- 3. CREATE OR REPLACE save_org_onboarding_flow — swap to log_org_action;
--    drop the now-unnecessary EXCEPTION wrap from 31-06.
-- -----------------------------------------------------------------------------
create or replace function public.save_org_onboarding_flow(p_org_id uuid, p_steps jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'extensions'
as $$
declare
  v_next_version int;
  v_new_id       uuid;
begin
  if not public.has_permission(public.get_caller_role(p_org_id), 'onboarding.edit') then
    raise exception using errcode = '42501', message = 'insufficient_privilege';
  end if;

  perform public._validate_onboarding_steps(p_steps);

  perform pg_advisory_xact_lock(hashtext('org_onboarding_flow:' || p_org_id::text));

  select coalesce(max(version), 0) + 1
    into v_next_version
    from public.org_onboarding_flows
   where org_id = p_org_id;

  update public.org_onboarding_flows
     set is_active = false
   where org_id = p_org_id
     and is_active = true;

  insert into public.org_onboarding_flows (org_id, steps, version, is_active, created_by)
  values (p_org_id, p_steps, v_next_version, true, auth.uid())
  returning id into v_new_id;

  -- AUDIT: clean call (no more EXCEPTION wrap — log_org_action does not 42501
  -- on org-owner callers like log_admin_action did).
  perform public.log_org_action(
    p_org_id,
    'org_onboarding_flow.save',
    null::uuid,
    'org_onboarding_flows',
    v_new_id::text,
    null,
    jsonb_build_object(
      'org_id',  p_org_id,
      'flow_id', v_new_id,
      'version', v_next_version
    )
  );

  return v_new_id;
end;
$$;


-- -----------------------------------------------------------------------------
-- 4. CREATE OR REPLACE activate_onboarding_flow_version — fix 2-arg signature
--    bug (verifier missed this one) + swap to log_org_action
-- -----------------------------------------------------------------------------
create or replace function public.activate_onboarding_flow_version(p_org_id uuid, p_flow_id uuid)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'extensions'
as $$
declare
  v_already_active boolean;
begin
  if not public.has_permission(public.get_caller_role(p_org_id), 'onboarding.edit') then
    raise exception 'insufficient_privilege' using errcode = '42501', message = 'insufficient_privilege';
  end if;

  if not exists (
    select 1 from public.org_onboarding_flows
     where id = p_flow_id and org_id = p_org_id
  ) then
    raise exception 'FLOW_NOT_IN_ORG' using errcode = 'P0001', message = 'FLOW_NOT_IN_ORG';
  end if;

  select is_active into v_already_active
    from public.org_onboarding_flows
   where id = p_flow_id;

  if v_already_active then
    return;
  end if;

  perform 1 from public.org_onboarding_flows
   where (id = p_flow_id or (org_id = p_org_id and is_active = true))
   for update;

  update public.org_onboarding_flows
     set is_active = false
   where org_id = p_org_id
     and is_active = true
     and id <> p_flow_id;

  update public.org_onboarding_flows
     set is_active = true
   where id = p_flow_id;

  -- AUDIT: was broken 2-arg log_admin_action(action, jsonb) — that overload
  -- doesn't exist; runtime threw 42883 aborting the entire SECDEF. Fix: use
  -- 7-arg log_org_action with correct slot mapping.
  perform public.log_org_action(
    p_org_id,
    'org_onboarding_flow.activate_version',
    null::uuid,
    'org_onboarding_flows',
    p_flow_id::text,
    null,
    jsonb_build_object('org_id', p_org_id, 'flow_id', p_flow_id)
  );
end;
$$;


-- -----------------------------------------------------------------------------
-- 5. CREATE OR REPLACE change_member_role — fix 2-arg signature bug + swap to
--    log_org_action (closes verifier BLOCKER #1)
-- -----------------------------------------------------------------------------
create or replace function public.change_member_role(p_org_id uuid, p_user_id uuid, p_role public.org_member_role)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'extensions'
as $$
declare
  v_current_role public.org_member_role;
  v_owner_count  int;
begin
  if not public.has_permission(public.get_caller_role(p_org_id), 'members.role.edit') then
    raise exception 'insufficient_privilege' using errcode = 'P0001', message = 'caller lacks members.role.edit';
  end if;

  select role into v_current_role
    from public.org_members
   where org_id = p_org_id
     and user_id = p_user_id;

  if v_current_role is null then
    raise exception 'NOT_MEMBER' using errcode = 'P0001';
  end if;

  if v_current_role = 'owner' and p_role <> 'owner' then
    select count(*) into v_owner_count
      from public.org_members
     where org_id = p_org_id
       and role = 'owner';

    if v_owner_count <= 1 then
      raise exception 'LAST_OWNER_DEMOTE_DENIED' using errcode = 'P0001';
    end if;
  end if;

  update public.org_members
     set role = p_role
   where org_id = p_org_id
     and user_id = p_user_id;

  -- AUDIT: was broken 2-arg log_admin_action(action, jsonb) — that overload
  -- doesn't exist; runtime threw 42883 → rollback. Fix: use 7-arg log_org_action.
  perform public.log_org_action(
    p_org_id,
    'org_member.role_changed',
    p_user_id,                 -- p_target_user_id = the user whose role changed
    'org_members',
    p_user_id::text,
    jsonb_build_object('old_role', v_current_role::text),
    jsonb_build_object('new_role', p_role::text)
  );
end;
$$;
