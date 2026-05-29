-- Plan 70-07 cascade-43 — remote-DB reconciliation (R3e): org RPCs pass org_id as
-- audit target_user_id (23503 FK) + send_org_invite uses a non-existent
-- log_admin_action arity (42883).
--
-- Root (see 70-07-UNIT-DRIFT-ROOTCAUSE.md): audit_logs.target_user_id has an FK to
-- auth.users(id) (20270601000028). Two org SECDEFs feed it an ORG id, not a user id:
--   * save_org_branding: log_org_action(p_org_id, 'org_branding.update', p_org_id, …)
--     — 3rd arg is p_target_user_id = p_org_id → `23503 Key (target_user_id)=(<org>) is
--     not present in table "users"`.
--   * send_org_invite: still on the pre-log_org_action path — calls
--     log_admin_action('org_invite_sent', p_org_id, jsonb) — a 3-arg form with no
--     matching overload → `42883 function log_admin_action(unknown, uuid, jsonb) does
--     not exist`; it ALSO passes p_org_id where a user id belongs.
-- Both were masked behind the earlier audit failures (cascades 39-42) and surfaced now
-- that the audit insert otherwise succeeds.
--
-- Fix: branding/invite audit rows aren't about a TARGET USER, so target_user_id must be
-- NULL (it's nullable). save_org_branding → pass null. send_org_invite → swap to the
-- 7-arg log_org_action (correct arity, membership-gated — the caller is an org owner)
-- with null target. Bodies are otherwise byte-faithful to their current definitions
-- (20270601700001 / 20270601300100); only the audit call changed.

-- ── save_org_branding: target_user_id p_org_id → null ────────────────────────
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

  -- Phase 70-07 R3e: target_user_id was p_org_id → 23503 (FK to auth.users). A branding
  -- update has no target USER; pass null.
  perform public.log_org_action(
    p_org_id,
    'org_branding.update',
    null,                      -- p_target_user_id (was p_org_id → FK violation)
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

-- ── send_org_invite: 3-arg log_admin_action → 7-arg log_org_action, null target ──
create or replace function public.send_org_invite(
  p_org_id    uuid,
  p_email     text,
  p_role      public.org_member_role
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_uid        uuid := auth.uid();
  v_invite_id  uuid;
  v_token      text;
  v_token_hash text;
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  if not exists (
    select 1 from public.org_members
    where org_id = p_org_id
      and user_id = v_uid
      and role = 'owner'
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_token      := encode(extensions.gen_random_bytes(32), 'hex');
  v_token_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');

  insert into public.org_invites (org_id, email, invited_role, invite_token_hash, created_by)
  values (p_org_id, p_email, p_role, v_token_hash, v_uid)
  returning id into v_invite_id;

  -- Phase 70-07 R3e: was log_admin_action('org_invite_sent', p_org_id, jsonb) — a 3-arg
  -- form with no overload (42883) that also fed p_org_id where a user id belongs (23503).
  -- Use the 7-arg org helper with a null target user.
  perform public.log_org_action(
    p_org_id,
    'org_invite_sent',
    null,                      -- p_target_user_id
    'org_invites',
    v_invite_id::text,
    null,
    jsonb_build_object('invite_id', v_invite_id, 'role', p_role::text)
  );

  return jsonb_build_object('invite_id', v_invite_id, 'token', v_token);
end;
$$;
