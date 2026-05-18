-- =============================================================================
-- Plan 31-03: Public SECDEF resolve_clinic_branding(p_slug text) returns jsonb
--
-- Purpose: Return the brand-token blob for a given clinic slug so that
-- main.tsx can apply CSS custom properties on <html> BEFORE React mounts
-- (zero-FOUT first-paint white-label per D-07, ORG-11).
--
-- PHI safety: This function ONLY reads from `organizations` (slug, name, id,
-- updated_at) and `org_branding` (logo_url, favicon_url, logo_alt_text,
-- primary_color, accent_color, bg_color, text_color, heading_font, body_font,
-- radius_scale, updated_at). It NEVER reads from patient_*, org_patient_links,
-- clinician_alerts, org_consent_grants, or any other patient-data table.
--
-- Anon grant rationale: Anonymous visitors on /clinic/{slug} are NOT
-- authenticated. The anon grant is MANDATORY; without it the pre-mount fetch
-- in main.tsx receives a "permission denied" 403 and falls back to LeanShot
-- defaults, breaking the white-label first-paint guarantee (Pitfall 3).
--
-- Null-on-bad-slug contract: When no organization row matches p_slug, the
-- function returns SQL NULL (jsonb). The caller (brand-tokens.ts) treats null
-- as "use LeanShot defaults" — no error thrown, no console noise.
--
-- SECURITY DEFINER + explicit search_path per [[reference_supabase_migration_gotchas]].
-- =============================================================================

create or replace function public.resolve_clinic_branding(p_slug text)
  returns jsonb
  language sql
  security definer
  stable
  set search_path = pg_catalog, public, extensions
as $$
  select case
    when not exists (
      select 1 from public.organizations where slug = p_slug
    )
    then null::jsonb
    else (
      select jsonb_build_object(
        'org_id',        o.id,
        'slug',          o.slug,
        'name',          o.name,
        'logo_url',      b.logo_url,
        'favicon_url',   b.favicon_url,
        'logo_alt_text', coalesce(b.logo_alt_text, o.name),
        'primary_color', b.primary_color,
        'accent_color',  b.accent_color,
        'bg_color',      b.bg_color,
        'text_color',    b.text_color,
        'heading_font',  b.heading_font,
        'body_font',     b.body_font,
        'radius_scale',  b.radius_scale,
        'updated_at',    greatest(o.updated_at, coalesce(b.updated_at, '1970-01-01'::timestamptz))
      )
      from public.organizations o
      left join public.org_branding b on b.org_id = o.id
      where o.slug = p_slug
    )
  end;
$$;

-- Grant EXECUTE to both anon (unauthenticated first-paint visitors) and
-- authenticated (returning clinic users). Without the anon grant, main.tsx's
-- pre-mount fetch returns 403 "permission denied" and the white-label first
-- paint breaks (Pitfall 3 in 31-RESEARCH.md).
grant execute on function public.resolve_clinic_branding(text) to anon, authenticated;
