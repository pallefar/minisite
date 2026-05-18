-- Phase 26 Plan 26-04 (AFFTIER-06) — gold landing-template seed + view extension.
--
-- Two concerns, one migration (per plan output spec):
--
-- (1) Recreate `public.affiliates_public_view` adding the `tier` column so
--     `AffiliateLandingResolver` can route Gold partners to LandingTemplateGold
--     irrespective of the row's legacy `template_choice`. Without this, the
--     resolver's `tier === 'gold' ? 'gold' : template_choice` derivation is
--     dead code — Pitfall 6 (silent fallback) would mask the routing bug in
--     production.
--
-- (2) Seed a 4th admin-owned landing_pages template row (`_template_gold`)
--     mirroring the Coach/Story/Method pattern from
--     20270101000010_affiliate_landing_template_seeds.sql so the Phase 15
--     page-builder admin UI lists the Gold premium variant as a selectable
--     template. The block tree is single-variant per D-12 (shared "premium"
--     theme across ALL Gold partners; per-partner branding deferred to v1.5).
--
-- Idempotent:
--   - View uses CREATE OR REPLACE so re-runs are safe.
--   - landing_pages upsert keyed on slug; landing_page_revisions guarded by
--     existence check so re-running doesn't append duplicate revisions.
--
-- Dependencies (assumed already applied):
--   - 20270101000004_tier_effective_view.sql — original view definition
--   - 20270701000001_affiliate_tier_schema.sql — `affiliates.tier` column
--     (Plan 26-01); MUST be applied before this migration or the view recreate
--     will fail on the `tier` column reference.
--
-- Cross-phase contract: This migration RECREATES affiliates_public_view; any
-- prior consumer that bound by ordinal position would break. All consumers
-- in tree reference columns by name (AffiliateLandingResolver.tsx `.select()`).

begin;

-- =============================================================================
-- 1. Recreate affiliates_public_view with `tier` exposed
-- =============================================================================
-- Mirrors the original column ordering from 20270101000004 + appends `tier`
-- so existing positional consumers (if any — there are none in tree) would
-- still see the same first 8 columns in the same order.
--
-- security_invoker=true is preserved so caller-side RLS still applies:
-- the anon visitor only sees rows allowed by pol_affiliates_public_landing_read
-- (status='approved' gate) in 20270101000006_affiliate_rls.sql.

create or replace view public.affiliates_public_view
  with (security_invoker = true)
as
select
  id,
  display_name,
  photo_path,
  blurb,
  calendly_url,
  testimonial_quote,
  template_choice,
  referral_code,
  tier
from public.affiliates
where status = 'approved';

comment on view public.affiliates_public_view is
  'AFF-09 / BL-3 + AFFTIER-06: public-readable approved-affiliate slice for '
  '/r/{code}/landing. Phase 26 26-04 adds `tier` so the client-side resolver '
  'can route Gold partners to the premium template variant. '
  'security_invoker=true so per-row RLS via pol_affiliates_public_landing_read '
  'is honored even though the view itself filters status=''approved''.';

grant select on public.affiliates_public_view to anon, authenticated;

-- =============================================================================
-- 2. Seed `_template_gold` landing_pages row + paired published revision
-- =============================================================================
-- Mirrors 20270101000010_affiliate_landing_template_seeds.sql pattern exactly.
-- status='draft' so the Gold template never accidentally surfaces in the
-- public landing-page list (Phase 15 page-render filters by status='published').
--
-- The block tree is a SINGLE shared "premium" variant per D-12. Per-partner
-- branding (custom hero copy, logo, color override) is explicitly deferred to
-- v1.5. The slot bindings ({{display_name}}, {{blurb}}, {{referral_code}}) are
-- substituted at render time by LandingTemplateGold.tsx, mirroring the existing
-- Coach/Story/Method substitution contract.

insert into public.landing_pages
  (slug, title, status, seo_title, seo_description, seo_schema_type)
values (
  '_template_gold',
  'Affiliate template — Gold (Premium)',
  'draft',
  'Affiliate template — Gold (Premium)',
  'Shared premium-theme variant for Gold-tier affiliates (Phase 26 AFFTIER-06).',
  'WebPage'
)
on conflict (slug) do update set
  title           = excluded.title,
  seo_title       = excluded.seo_title,
  seo_description = excluded.seo_description,
  seo_schema_type = excluded.seo_schema_type;

do $$
declare
  v_gold_page_id uuid;
  v_gold_rev_id  uuid;
begin
  select id into v_gold_page_id
    from public.landing_pages
    where slug = '_template_gold';

  if not exists (
    select 1 from public.landing_page_revisions
    where page_id = v_gold_page_id
  ) then
    insert into public.landing_page_revisions (page_id, blocks)
    values (
      v_gold_page_id,
      $JSON$
        [
          {
            "id": "premium-badge",
            "type": "badge",
            "parent_id": null,
            "order": 0,
            "content": {
              "label": "Premium partner — {{referral_code}}",
              "icon": "star"
            },
            "style": { "backgroundTone": "subtle", "alignment": "left", "spacingDensity": "compact" }
          },
          {
            "id": "hero",
            "type": "hero",
            "parent_id": null,
            "order": 1,
            "content": {
              "layout": "split",
              "heading": "Track your GLP-1 journey with a premium partner.",
              "subheading": "Clinical-grade tracking, AI coach, and share-with-doctor reports — backed by {{display_name}}, a verified premium partner.",
              "body": "{{blurb}}",
              "ctaLabel": "Start your free trial",
              "ctaHref": "/signup?aff={{referral_code}}",
              "ctaSecondaryLabel": "Book a 1:1 with me",
              "ctaSecondaryHref": "{{calendly_url}}",
              "ctaSecondaryShowIf": "calendly_url",
              "leftSlot": {
                "type": "PhotoSlot",
                "binding": "{{photo_path}}",
                "fallback": "InitialsAvatar",
                "size": "lg"
              }
            },
            "style": { "backgroundTone": "brand", "alignment": "left", "spacingDensity": "spacious" }
          },
          {
            "id": "values",
            "type": "feature-grid",
            "parent_id": null,
            "order": 2,
            "content": {
              "heading": "Why premium partners pick LeanShot",
              "cols": 3,
              "items": [
                { "title": "Clinical-grade tracking", "body": "Drug-level curves, site rotation, weight, mood — one premium timeline." },
                { "title": "AI coach + concierge",   "body": "Always-on guidance from your premium partner plus an AI coach you can ask anything." },
                { "title": "Doctor-share report",    "body": "One-tap clinical snapshot polished for your provider visits." }
              ]
            },
            "style": { "backgroundTone": "default", "spacingDensity": "default" }
          },
          {
            "id": "cta",
            "type": "cta",
            "parent_id": null,
            "order": 3,
            "content": {
              "heading": "Ready for the premium tier?",
              "body": "Free to start. Your data stays local — sync only when you're ready.",
              "ctaLabel": "Start free trial",
              "ctaHref": "/signup?aff={{referral_code}}"
            },
            "style": { "backgroundTone": "brand", "alignment": "center", "spacingDensity": "default" }
          },
          {
            "id": "footer",
            "type": "footer",
            "parent_id": null,
            "order": 4,
            "content": {
              "fineprint": "Referred by {{display_name}}.",
              "copyright": "© LeanShot",
              "links": [
                { "label": "Privacy", "href": "/legal/privacy" },
                { "label": "Terms",   "href": "/legal/terms" }
              ]
            },
            "style": { "backgroundTone": "dark", "spacingDensity": "compact" }
          }
        ]
      $JSON$::jsonb
    )
    returning id into v_gold_rev_id;

    update public.landing_pages
      set published_revision_id = v_gold_rev_id
      where id = v_gold_page_id;
  end if;
end $$;

commit;
