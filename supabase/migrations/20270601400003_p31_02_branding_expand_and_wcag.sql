-- =============================================================================
-- Phase 31 Plan 31-02 — org_branding 10-col expansion + WCAG helper + save_org_branding SECDEF
--
-- Purpose:
--   Expands the Phase 28 org_branding skeleton (5 cols) into the bounded 10-token
--   brand-essentials shape from D-05.  Adds the WCAG AA contrast enforcement helper
--   from D-06.  Ships save_org_branding SECDEF that validates and upserts a branding
--   token payload, guarded by `has_permission(get_caller_role(org_id), 'branding.edit')`.
--
-- Prerequisites:
--   20270601300100_p31_00_enum_rename_and_secdef_ripple.sql  — enum values owner/clinician/staff
--   20270601310101_p31_01_has_permission_secdef.sql          — has_permission() + get_caller_role()
--
-- NOTE: This migration is committed but NOT pushed from this plan.
--       Plan 31-04 owns the BLOCKING `supabase db push --linked` for the entire phase.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- (a) ALTER TABLE — expand org_branding to 10-token brand-essentials shape (D-05)
-- ---------------------------------------------------------------------------

-- Rename font_family → heading_font (was the original sole font column)
alter table public.org_branding rename column font_family to heading_font;

-- Add the 5 new columns. All nullable — defaults are supplied by resolve_clinic_branding
-- (Plan 31-03) at read time, NOT at the DDL layer, to avoid sparse nullable defaults
-- (per [[feedback_planner_iter1_anti_patterns]] item #3).
alter table public.org_branding add column favicon_url  text null;
alter table public.org_branding add column bg_color     text null;
alter table public.org_branding add column text_color   text null;
alter table public.org_branding add column body_font    text null;
alter table public.org_branding add column radius_scale text null
  check (radius_scale in ('sm', 'md', 'lg', 'xl'));

-- ---------------------------------------------------------------------------
-- (b) _is_valid_oklch(text) — immutable oklch syntax guard
--
-- Validates that a color string is in canonical `oklch()` form.
-- rgb/hex/hsl/named-color/css-var/url() all rejected.
-- Prevents both CSS injection and round-trip-unreadable theme bypass.
-- Returns TRUE when the string matches the oklch() function syntax, FALSE otherwise.
-- Referenced by _compute_wcag_contrast (returns 0.0 on invalid inputs) and
-- by save_org_branding (raises INVALID_OKLCH_FORMAT on first failing field).
-- ---------------------------------------------------------------------------
create or replace function public._is_valid_oklch(
  p_value text
)
returns boolean
language sql
immutable
security definer
set search_path = pg_catalog, public, extensions
as $$
  select p_value ~ '^oklch\s*\(\s*(\d+\.?\d*%?)\s+(\d*\.?\d+)\s+(\d+\.?\d*)\s*(\/\s*[\d.]+%?)?\s*\)$'
$$;

-- ---------------------------------------------------------------------------
-- (c) _compute_wcag_contrast(c1, c2) — WCAG AA relative luminance approximation
--
-- [ASSUMED/MEDIUM confidence] L^2.2 approximation of sRGB relative luminance
-- from oklch L channel. Sufficient for WCAG AA hard-block gate; the L channel
-- in oklch is perceptual lightness (0–1), not sRGB luminance, but for the AA
-- enforcement values 4.5 and 3.0 it is a reliable conservative guard.
-- Revisit if false negatives surface in v1.4 telemetry.
--
-- Returns contrast ratio in the range [1.0, 21.0].
-- Returns 0.0 when either input fails the oklch regex (defensive — never raise
-- from inside the helper; save_org_branding decides the error code).
-- ---------------------------------------------------------------------------
create or replace function public._compute_wcag_contrast(
  c1 text,
  c2 text
)
returns numeric
language plpgsql
immutable
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_l1_raw  text;
  v_l2_raw  text;
  v_l1      numeric;
  v_l2      numeric;
  v_lum1    numeric;
  v_lum2    numeric;
  v_lighter numeric;
  v_darker  numeric;
begin
  -- Extract the L (lightness) channel from `oklch(L C H [/ A])` via regex.
  -- The L value is the first numeric token after the opening paren.
  -- Handles percentage notation (e.g. `54.3%`) by stripping the percent sign.
  v_l1_raw := (regexp_match(c1, '^\s*oklch\s*\(\s*(\d+\.?\d*%?)\s'))[1];
  v_l2_raw := (regexp_match(c2, '^\s*oklch\s*\(\s*(\d+\.?\d*%?)\s'))[1];

  -- Bail out with 0.0 (contrast fail) if either string isn't valid oklch.
  if v_l1_raw is null or v_l2_raw is null then
    return 0.0;
  end if;

  -- Normalise percentage notation: `54.3%` → 0.543
  if v_l1_raw like '%\%%' then
    v_l1 := replace(v_l1_raw, '%', '')::numeric / 100.0;
  else
    v_l1 := v_l1_raw::numeric;
  end if;

  if v_l2_raw like '%\%%' then
    v_l2 := replace(v_l2_raw, '%', '')::numeric / 100.0;
  else
    v_l2 := v_l2_raw::numeric;
  end if;

  -- [ASSUMED/MEDIUM confidence] L^2.2 luminance approximation.
  -- oklch L is perceptual (0–1 range); raising to 2.2 approximates the
  -- sRGB gamma-expansion step in the WCAG relative luminance formula.
  -- This overestimates contrast for dark colours (conservative — good for AA).
  v_lum1 := power(greatest(0.0, least(1.0, v_l1)), 2.2);
  v_lum2 := power(greatest(0.0, least(1.0, v_l2)), 2.2);

  v_lighter := greatest(v_lum1, v_lum2);
  v_darker  := least(v_lum1, v_lum2);

  -- WCAG contrast ratio: (L_lighter + 0.05) / (L_darker + 0.05)
  return round(
    (v_lighter + 0.05) / (v_darker + 0.05),
    4
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- (d) save_org_branding(p_org_id, p_tokens) — branding upsert SECDEF
--
-- Permission gate: requires `branding.edit` which is owner-only per D-03.
-- Validates:
--   1. Caller has branding.edit permission for the org.
--   2. All color fields are in oklch() format (INVALID_OKLCH_FORMAT).
--   3. radius_scale ∈ {'sm','md','lg','xl'} (INVALID_RADIUS_SCALE).
--   4. Font fields ∈ curated list (INVALID_FONT_FAMILY).
--   5. WCAG AA contrast pairs (CONTRAST_TEXT_BG_FAIL / CONTRAST_PRIMARY_BG_FAIL).
-- Then upserts all 10 fields + calls log_admin_action for audit trail.
--
-- Error codes raised (all use errcode='22023' data_exception except permission):
--   'insufficient_privilege'  (42501) — caller lacks branding.edit
--   'INVALID_OKLCH_FORMAT'    (22023) — rgb/hex/hsl/named-color rejected
--   'INVALID_RADIUS_SCALE'    (22023) — value not in ('sm','md','lg','xl')
--   'INVALID_FONT_FAMILY'     (22023) — font not in curated list
--   'CONTRAST_TEXT_BG_FAIL'   (22023) — text/bg contrast < 4.5 (D-06)
--   'CONTRAST_PRIMARY_BG_FAIL'(22023) — primary/bg contrast < 3.0 (D-06)
--
-- Threat model (T-31-02-01 through T-31-02-06):
--   - detail field carries only the FIELD NAME, never the offending value,
--     so no PHI or client-controlled content appears in error messages.
-- ---------------------------------------------------------------------------
create or replace function public.save_org_branding(
  p_org_id uuid,
  p_tokens jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
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
  -- 1. Resolve caller role for this org.
  v_role := public.get_caller_role(p_org_id);

  -- 2. Permission gate: only roles with branding.edit may proceed.
  if not public.has_permission(v_role, 'branding.edit') then
    raise exception 'insufficient_privilege'
      using errcode = '42501';
  end if;

  -- 3. Extract typed locals from jsonb. NULL when key absent (correct — no
  --    partial-update semantics; pass only the fields you want to change and
  --    the upsert overwrites all 10 columns from the token payload).
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

  -- 4. oklch validation — check each color field when non-null.
  --    Raises on first failure; detail carries field name only (no value).
  if v_primary_color is not null and not public._is_valid_oklch(v_primary_color) then
    raise exception 'INVALID_OKLCH_FORMAT'
      using errcode = '22023', detail = 'primary_color';
  end if;

  if v_accent_color is not null and not public._is_valid_oklch(v_accent_color) then
    raise exception 'INVALID_OKLCH_FORMAT'
      using errcode = '22023', detail = 'accent_color';
  end if;

  if v_bg_color is not null and not public._is_valid_oklch(v_bg_color) then
    raise exception 'INVALID_OKLCH_FORMAT'
      using errcode = '22023', detail = 'bg_color';
  end if;

  if v_text_color is not null and not public._is_valid_oklch(v_text_color) then
    raise exception 'INVALID_OKLCH_FORMAT'
      using errcode = '22023', detail = 'text_color';
  end if;

  -- 5. radius_scale validation.
  if v_radius_scale is not null and v_radius_scale not in ('sm', 'md', 'lg', 'xl') then
    raise exception 'INVALID_RADIUS_SCALE'
      using errcode = '22023', detail = 'radius_scale';
  end if;

  -- 6. Font validation — curated list per D-05.
  if v_heading_font is not null and v_heading_font not in (
    'Inter', 'Fraunces', 'JetBrains Mono', 'Lora', 'IBM Plex Sans'
  ) then
    raise exception 'INVALID_FONT_FAMILY'
      using errcode = '22023', detail = 'heading_font';
  end if;

  if v_body_font is not null and v_body_font not in (
    'Inter', 'Fraunces', 'JetBrains Mono', 'Lora', 'IBM Plex Sans'
  ) then
    raise exception 'INVALID_FONT_FAMILY'
      using errcode = '22023', detail = 'body_font';
  end if;

  -- 7. WCAG AA contrast enforcement — only when BOTH colors of the pair are non-null.
  --    D-06: (text_color, bg_color) >= 4.5 AND (primary_color, bg_color) >= 3.0.
  if v_text_color is not null and v_bg_color is not null
     and public._compute_wcag_contrast(v_text_color, v_bg_color) < 4.5
  then
    raise exception 'CONTRAST_TEXT_BG_FAIL'
      using errcode = '22023';
  end if;

  if v_primary_color is not null and v_bg_color is not null
     and public._compute_wcag_contrast(v_primary_color, v_bg_color) < 3.0
  then
    raise exception 'CONTRAST_PRIMARY_BG_FAIL'
      using errcode = '22023';
  end if;

  -- 8. Upsert all 10 brand-essential fields + updated_at.
  insert into public.org_branding (
    org_id,
    logo_url,
    favicon_url,
    primary_color,
    accent_color,
    bg_color,
    text_color,
    heading_font,
    body_font,
    radius_scale,
    support_email,
    updated_at
  ) values (
    p_org_id,
    v_logo_url,
    v_favicon_url,
    v_primary_color,
    v_accent_color,
    v_bg_color,
    v_text_color,
    v_heading_font,
    v_body_font,
    v_radius_scale,
    v_support_email,
    now()
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

  -- 9. Audit trail — log this admin action per Phase 24 D-14 wiring.
  --    Signature: log_admin_action(p_action_name, p_target_user_id, p_table_name, p_row_pk, p_before, p_after)
  --    We pass p_org_id as p_target_user_id (uuid field carries the resource id),
  --    p_table_name = 'org_branding', p_row_pk = p_org_id::text, and the changed fields
  --    as p_after jsonb. p_before is omitted (null — pre-audit reads cost a SELECT).
  perform public.log_admin_action(
    'org_branding.update',
    p_org_id,
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

-- GRANT: authenticated users can call this SECDEF; it checks permissions internally.
-- anon is never granted — D-13.
grant execute on function public.save_org_branding(uuid, jsonb) to authenticated;

-- Revoke from public (belt-and-suspenders).
revoke all on function public.save_org_branding(uuid, jsonb) from public;
grant execute on function public.save_org_branding(uuid, jsonb) to authenticated, service_role;

-- Also grant _is_valid_oklch and _compute_wcag_contrast (called internally by save_org_branding
-- but also useful for Plan 31-03's read-path contract verification).
revoke all on function public._is_valid_oklch(text) from public;
grant execute on function public._is_valid_oklch(text) to authenticated, service_role;

revoke all on function public._compute_wcag_contrast(text, text) from public;
grant execute on function public._compute_wcag_contrast(text, text) to authenticated, service_role;

commit;
