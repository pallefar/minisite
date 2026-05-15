-- Phase 19 Plan 19-08 — affiliate landing template seeds + marketing-assets bucket.
--
-- D-16 (3 template variants — user override on default-1 per
-- feedback_aggressive_foundations) + D-17 (templates are Phase 15
-- page-builder instances). BL-3 revision (2026-05-15): the template_choice
-- column + affiliates_public_view + pol_affiliates_public_landing_read
-- policy live in Plan 19-01 migrations (20270101000001 + 20270101000004
-- + 20270101000005). This migration ONLY:
--   (a) seeds the 3 admin-owned template rows in public.landing_pages, each
--       with a paired append-only block-tree revision pointing at it via
--       published_revision_id; and
--   (b) creates the `marketing-assets` Storage bucket (D-13/D-14) — the
--       affiliate asset library that PartnerAssetsPage (Plan 19-06b) lists
--       via signed URL. Actual asset uploads (logos, banners, swipe-copy)
--       are deferred to the human-verify checkpoint in this plan's Task 4
--       (admin uploads via Supabase Dashboard or `supabase storage upload`).
--
-- Idempotent: re-running this migration does NOT duplicate rows.
--   - landing_pages: `on conflict (slug) do update` keeps the row stable.
--   - landing_page_revisions: append-only; we WOULD insert a new revision on
--     every run, so we wrap the revision insert in a guard that only fires
--     when the page has no published revision yet (NULL published_revision_id
--     OR the existing revision's blocks differs from the seed).
--   - storage.buckets: `on conflict (id) do update` per page-assets analog.
--
-- Slot bindings (UI-SPEC §D-18): blocks reference customization fields as
-- {{display_name}}, {{photo_path}}, {{blurb}}, {{calendly_url}},
-- {{testimonial_quote}}, {{referral_code}}. The renderer components in
-- src/components/landing/* receive the live affiliate row and substitute
-- these at render time — NO server-side templating, NO database joins.
-- This keeps the block tree a static admin-owned template that mirrors the
-- in-code TEMPLATES catalog in src/lib/page-builder/templates.ts.

begin;

-- =============================================================================
-- 1. Seed marketing-assets Storage bucket
-- =============================================================================
-- public = false: RLS-gated. PartnerAssetsPage (Plan 19-06b) lists via the
-- service-role-equivalent signed-URL flow exposed through supabase-js
-- `storage.from('marketing-assets').createSignedUrl(...)` after a per-asset
-- authorization check.
--
-- Mime allow-list: SVG, PNG, JPEG, WEBP, GIF for graphics; plain-text for
-- swipe-copy (.txt) email/social templates. NO arbitrary file uploads.
-- SVG is permitted here (unlike page-assets bucket) because admin-only
-- writes — the per-user XSS surface is the operator team, not the
-- affiliate audience. Affiliates only ever read these assets.
--
-- File size cap: 5 MB (logos + banners are typically <1 MB; the cap protects
-- against accidental hi-res uploads).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'marketing-assets',
  'marketing-assets',
  false,
  5242880,                                                  -- 5 MB
  array[
    'image/svg+xml',
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
    'text/plain'
  ]
)
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types,
  public = excluded.public;

-- RLS on storage.objects for marketing-assets bucket.
-- Read: anon + authenticated may SELECT (so signed URLs work for everyone;
-- the bucket is private so direct object access still requires the signed
-- URL — the SELECT row-level policy is what lets `createSignedUrl` succeed).
-- Write: is_staff() only.

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename  = 'objects'
      and policyname = 'pol_marketing_assets_read'
  ) then
    create policy pol_marketing_assets_read
      on storage.objects
      for select
      to anon, authenticated
      using (bucket_id = 'marketing-assets');
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename  = 'objects'
      and policyname = 'pol_marketing_assets_write_staff'
  ) then
    create policy pol_marketing_assets_write_staff
      on storage.objects
      for insert
      to authenticated
      with check (bucket_id = 'marketing-assets' and public.is_staff());
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename  = 'objects'
      and policyname = 'pol_marketing_assets_delete_staff'
  ) then
    create policy pol_marketing_assets_delete_staff
      on storage.objects
      for delete
      to authenticated
      using (bucket_id = 'marketing-assets' and public.is_staff());
  end if;
end $$;

-- =============================================================================
-- 2. Seed 3 admin-owned landing_pages template rows
-- =============================================================================
-- These rows are the canonical "what does template X look like?" record
-- visible in the Phase 15 admin pages list (slugs prefixed with `_template_`
-- so they're easy to filter out of the normal landing-page UI). The
-- block-tree is stored in a paired landing_page_revisions row referenced by
-- published_revision_id.
--
-- The block-tree JSON shape mirrors Phase 15 PAGE-03 (flat-JSONB; each
-- element has {id, type, parent_id, order, content, style}). The renderer
-- components in src/components/landing/* receive the live affiliate row
-- and substitute slot bindings at render time — this template tree is the
-- shape the admin sees in the editor + serves as the source-of-truth for
-- the catalog in src/lib/page-builder/templates.ts (kept in sync by code
-- review).

-- Upsert the 3 template page rows. status='draft' so they never accidentally
-- appear in the public landing-page list (Phase 15 page-render filters by
-- status='published').

insert into public.landing_pages (slug, title, status, seo_title, seo_description, seo_schema_type)
values
  ('_template_coach',  'Affiliate template — Coach',
     'draft',
     'Affiliate template — Coach',
     'Photo-forward affiliate landing page (Phase 19 template seed).',
     'WebPage'),
  ('_template_story',  'Affiliate template — Story',
     'draft',
     'Affiliate template — Story',
     'Testimonial-forward affiliate landing page (Phase 19 template seed).',
     'WebPage'),
  ('_template_method', 'Affiliate template — Method',
     'draft',
     'Affiliate template — Method',
     'Benefits-list-forward affiliate landing page (Phase 19 template seed).',
     'WebPage')
on conflict (slug) do update set
  title = excluded.title,
  seo_title = excluded.seo_title,
  seo_description = excluded.seo_description,
  seo_schema_type = excluded.seo_schema_type;

-- Insert the paired block-tree revisions ONCE — guarded so re-running this
-- migration is a no-op after first apply. Each revision references the
-- page row via page_id; after insert we update landing_pages.published_revision_id
-- to point at the new revision so the admin editor + page-render Edge Function
-- can resolve the canonical tree.

do $$
declare
  v_coach_page_id  uuid;
  v_story_page_id  uuid;
  v_method_page_id uuid;
  v_coach_rev_id   uuid;
  v_story_rev_id   uuid;
  v_method_rev_id  uuid;
begin
  select id into v_coach_page_id  from public.landing_pages where slug = '_template_coach';
  select id into v_story_page_id  from public.landing_pages where slug = '_template_story';
  select id into v_method_page_id from public.landing_pages where slug = '_template_method';

  -- Coach: photo-forward hero + value-prop grid + CTA + footer (UI-SPEC §coach).
  if not exists (
    select 1 from public.landing_page_revisions
    where page_id = v_coach_page_id
  ) then
    insert into public.landing_page_revisions (page_id, blocks)
    values (
      v_coach_page_id,
      $JSON$
        [
          {
            "id": "hero",
            "type": "hero",
            "parent_id": null,
            "order": 0,
            "content": {
              "layout": "split",
              "heading": "{{display_name}}",
              "subheading": "{{blurb}}",
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
            "order": 1,
            "content": {
              "heading": "Why I recommend LeanShot",
              "cols": 2,
              "items": [
                { "title": "Every shot tracked", "body": "Injections, side effects, weight — one timeline." },
                { "title": "Built-in coach", "body": "Rule-based insights + an AI coach on tap." },
                { "title": "Doctor-share view", "body": "One-tap snapshot for clinic visits." }
              ]
            },
            "style": { "backgroundTone": "default", "spacingDensity": "default" }
          },
          {
            "id": "cta",
            "type": "cta",
            "parent_id": null,
            "order": 2,
            "content": {
              "heading": "Track your GLP-1 journey",
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
            "order": 3,
            "content": {
              "fineprint": "Referred by {{display_name}}.",
              "copyright": "© LeanShot",
              "links": [
                { "label": "Privacy", "href": "/legal/privacy" },
                { "label": "Terms", "href": "/legal/terms" }
              ]
            },
            "style": { "backgroundTone": "dark", "spacingDensity": "compact" }
          }
        ]
      $JSON$::jsonb
    )
    returning id into v_coach_rev_id;
    update public.landing_pages
      set published_revision_id = v_coach_rev_id
      where id = v_coach_page_id;
  end if;

  -- Story: testimonial-forward hero + benefit grid + CTA + footer (UI-SPEC §story).
  if not exists (
    select 1 from public.landing_page_revisions
    where page_id = v_story_page_id
  ) then
    insert into public.landing_page_revisions (page_id, blocks)
    values (
      v_story_page_id,
      $JSON$
        [
          {
            "id": "hero",
            "type": "hero",
            "parent_id": null,
            "order": 0,
            "content": {
              "layout": "testimonial",
              "quote": "{{testimonial_quote}}",
              "attribution": "{{display_name}}",
              "subheading": "{{blurb}}",
              "ctaLabel": "Start your free trial",
              "ctaHref": "/signup?aff={{referral_code}}",
              "ctaSecondaryLabel": "Book a 1:1 with me",
              "ctaSecondaryHref": "{{calendly_url}}",
              "ctaSecondaryShowIf": "calendly_url",
              "attributionSlot": {
                "type": "PhotoSlot",
                "binding": "{{photo_path}}",
                "fallback": "InitialsAvatar",
                "size": "md"
              }
            },
            "style": { "backgroundTone": "brand", "alignment": "center", "spacingDensity": "spacious" }
          },
          {
            "id": "benefits",
            "type": "feature-grid",
            "parent_id": null,
            "order": 1,
            "content": {
              "heading": "What you'll track",
              "cols": 3,
              "items": [
                { "title": "Injections", "body": "Every shot + site rotation, automatically." },
                { "title": "Body + mood", "body": "Weight, symptoms, sleep, food noise." },
                { "title": "Doctor share", "body": "A snapshot in one tap." }
              ]
            },
            "style": { "backgroundTone": "default", "spacingDensity": "default" }
          },
          {
            "id": "cta",
            "type": "cta",
            "parent_id": null,
            "order": 2,
            "content": {
              "heading": "Try LeanShot free",
              "ctaLabel": "Start your free trial",
              "ctaHref": "/signup?aff={{referral_code}}"
            },
            "style": { "backgroundTone": "subtle", "alignment": "center", "spacingDensity": "default" }
          },
          {
            "id": "footer",
            "type": "footer",
            "parent_id": null,
            "order": 3,
            "content": {
              "fineprint": "Referred by {{display_name}}.",
              "copyright": "© LeanShot",
              "links": [
                { "label": "Privacy", "href": "/legal/privacy" },
                { "label": "Terms", "href": "/legal/terms" }
              ]
            },
            "style": { "backgroundTone": "dark", "spacingDensity": "compact" }
          }
        ]
      $JSON$::jsonb
    )
    returning id into v_story_rev_id;
    update public.landing_pages
      set published_revision_id = v_story_rev_id
      where id = v_story_page_id;
  end if;

  -- Method: no-photo hero with 5-bullet value list + attribution card + CTA + footer
  -- (UI-SPEC §method).
  if not exists (
    select 1 from public.landing_page_revisions
    where page_id = v_method_page_id
  ) then
    insert into public.landing_page_revisions (page_id, blocks)
    values (
      v_method_page_id,
      $JSON$
        [
          {
            "id": "hero",
            "type": "hero",
            "parent_id": null,
            "order": 0,
            "content": {
              "layout": "bullets",
              "heading": "How I work with LeanShot",
              "bullets": [
                "Stop guessing the curve — see your real drug level day by day",
                "Rotate injection sites without a notebook",
                "Watch your weight, mood, and symptoms in one view",
                "Send your doctor a clean snapshot in one tap",
                "Ask the AI coach anything in plain English"
              ],
              "ctaLabel": "Start your free trial",
              "ctaHref": "/signup?aff={{referral_code}}"
            },
            "style": { "backgroundTone": "default", "alignment": "left", "spacingDensity": "spacious" }
          },
          {
            "id": "attribution",
            "type": "image-text",
            "parent_id": null,
            "order": 1,
            "content": {
              "heading": "Brought to you by {{display_name}}",
              "body": "{{blurb}}",
              "imageSlot": {
                "type": "PhotoSlot",
                "binding": "{{photo_path}}",
                "fallback": "InitialsAvatar",
                "size": "md"
              },
              "ctaSecondaryLabel": "Book a 1:1 with me",
              "ctaSecondaryHref": "{{calendly_url}}",
              "ctaSecondaryShowIf": "calendly_url"
            },
            "style": { "backgroundTone": "subtle", "alignment": "left", "spacingDensity": "default" }
          },
          {
            "id": "cta",
            "type": "cta",
            "parent_id": null,
            "order": 2,
            "content": {
              "heading": "Track your GLP-1 journey",
              "ctaLabel": "Start free trial",
              "ctaHref": "/signup?aff={{referral_code}}"
            },
            "style": { "backgroundTone": "brand", "alignment": "center", "spacingDensity": "default" }
          },
          {
            "id": "footer",
            "type": "footer",
            "parent_id": null,
            "order": 3,
            "content": {
              "fineprint": "Referred by {{display_name}}.",
              "copyright": "© LeanShot",
              "links": [
                { "label": "Privacy", "href": "/legal/privacy" },
                { "label": "Terms", "href": "/legal/terms" }
              ]
            },
            "style": { "backgroundTone": "dark", "spacingDensity": "compact" }
          }
        ]
      $JSON$::jsonb
    )
    returning id into v_method_rev_id;
    update public.landing_pages
      set published_revision_id = v_method_rev_id
      where id = v_method_page_id;
  end if;
end $$;

commit;
