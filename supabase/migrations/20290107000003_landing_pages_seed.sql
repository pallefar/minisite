-- Phase 68 Plan 01 — Task 3
-- LAND-04 — seed 3 audience-specific landing pages:
--   /for-doctors, /for-clinics, /for-coaches.
--
-- IMPORTANT — schema divergence vs original plan body:
--   The PLAN.md drafted seeds assuming columns (slug, blocks jsonb, seo jsonb,
--   is_public). The actual `public.landing_pages` schema (per Phase 15
--   migration 20261101000002_page_builder_tables.sql) is different:
--
--     landing_pages columns:
--       id uuid pk, slug text unique, title text, status text ('draft'|'published'),
--       published_revision_id uuid (deferrable FK to landing_page_revisions),
--       seo_title, seo_description, seo_og_image, seo_canonical, seo_schema_type,
--       created_by, created_at, updated_at.
--
--     block_tree (jsonb array of page-builder blocks) lives on
--     `landing_page_revisions(id, page_id, block_tree, ...)` — NOT on
--     landing_pages itself.
--
--   Adjustment: this migration inserts (landing_pages row, revision row) pairs
--   per page and links them via `published_revision_id`. The deferrable FK
--   (added in 20261101000002 migration 03 — same family) is `DEFERRABLE
--   INITIALLY DEFERRED`, so the insert order page→revision→link works within
--   one DO-block transaction.
--
-- SEO JSON-LD: schema.org `Service` type with per-audience `audience`
-- differentiator. Stored as a separate `seo_schema_type` (top-level type marker)
-- AND a JSON-LD object via the page-builder renderer's separate path
-- (Phase 15 ships `src/lib/page-builder/json-ld.ts`). For now we set
-- `seo_schema_type = 'Service'` so the renderer emits Service JSON-LD;
-- the detailed audience-differentiator JSON-LD payload is computed at
-- render time from the page-builder helper, NOT stored verbatim in the seed.
--
-- ${CALENDLY_BOOK_DEMO_URL_PLACEHOLDER} stays as a literal string in the
-- block payload — the runtime renderer resolves it from env at render time
-- (Phase 70 sets VITE_CALENDLY_BOOK_DEMO_URL).
--
-- Idempotency: wrapped in DO-block; outer `exception when undefined_table`
-- handles drift (table may not exist in fresh env). Inner per-slug check
-- uses `on conflict (slug) do nothing` so re-runs don't error.

do $$
declare
  -- Page IDs (deterministic so re-runs are idempotent via on-conflict-do-nothing).
  v_doctor_page_id   uuid;
  v_clinic_page_id   uuid;
  v_coach_page_id    uuid;

  -- Revision IDs.
  v_doctor_rev_id    uuid;
  v_clinic_rev_id    uuid;
  v_coach_rev_id     uuid;

  -- Block trees (page-builder block schema — hero + feature-grid + cta).
  doctor_blocks jsonb := jsonb_build_array(
    jsonb_build_object(
      'type', 'hero',
      'headline', 'Read-only patient data — exactly what you need.',
      'subhead', 'When your GLP-1 patient shares their LeanShot account, you see the full picture: injection log, weight, symptoms, and adherence — without account creation.',
      'cta', jsonb_build_object('label', 'See sample report', 'href', '/sample-doctor-report')
    ),
    jsonb_build_object('type', 'feature-grid', 'features', jsonb_build_array(
      jsonb_build_object('icon', 'eye',          'title', 'Read-share',         'body', 'No login. No account. Just a link from your patient.'),
      jsonb_build_object('icon', 'shield-check', 'title', 'HIPAA-aware',        'body', 'Read-only access with clear data scope boundaries.'),
      jsonb_build_object('icon', 'chart-line',   'title', 'Pharmacology view',  'body', '28d back + 7d projected drug-level curves.')
    )),
    jsonb_build_object('type', 'cta', 'label', 'Get patient-shared access', 'href', '/auth/doctor-invite')
  );

  clinic_blocks jsonb := jsonb_build_array(
    jsonb_build_object(
      'type', 'hero',
      'headline', 'Multi-patient monitoring built for GLP-1 clinics.',
      'subhead', 'Roster, per-patient pricing, HIPAA-BAA, multi-tenant capability. Designed for clinics tracking 50+ patients on GLP-1 / peptide therapy.',
      'cta', jsonb_build_object('label', 'Book a demo', 'href', '${CALENDLY_BOOK_DEMO_URL_PLACEHOLDER}')
    ),
    jsonb_build_object('type', 'feature-grid', 'features', jsonb_build_array(
      jsonb_build_object('icon', 'users',        'title', 'Multi-patient roster', 'body', 'See all your patients in one dashboard with alert badges.'),
      jsonb_build_object('icon', 'shield-check', 'title', 'HIPAA-BAA available',  'body', 'Signed BAA + subprocessor list at /subprocessor-list.'),
      jsonb_build_object('icon', 'tag',          'title', 'Per-patient pricing',  'body', 'Pay per active patient; no seat-based gotchas.')
    )),
    jsonb_build_object('type', 'cta', 'label', 'Book a demo (15 min)', 'href', '${CALENDLY_BOOK_DEMO_URL_PLACEHOLDER}')
  );

  coach_blocks jsonb := jsonb_build_array(
    jsonb_build_object(
      'type', 'hero',
      'headline', 'Manage your wellness cohort with one tool.',
      'subhead', 'Track your coaching clients on GLP-1 / peptides. See adherence, weight, symptoms, energy. One place. Built-in coaching workflows.',
      'cta', jsonb_build_object('label', 'Start free trial', 'href', '/signup?audience=coach')
    ),
    jsonb_build_object('type', 'feature-grid', 'features', jsonb_build_array(
      jsonb_build_object('icon', 'users',          'title', 'Client roster',   'body', 'Up to 50 clients on the free tier.'),
      jsonb_build_object('icon', 'chart-bar',      'title', 'Cohort tracking', 'body', 'Compare progress across your roster, not just individual clients.'),
      jsonb_build_object('icon', 'message-circle', 'title', 'Coach notes',     'body', 'Per-client notes with reminders + check-in cadence.')
    )),
    jsonb_build_object('type', 'cta', 'label', 'Start your free trial', 'href', '/signup?audience=coach')
  );

begin
  -- ----------------------------------------------------------------------
  -- /for-doctors
  -- ----------------------------------------------------------------------
  insert into public.landing_pages (
    slug, title, status,
    seo_title, seo_description, seo_schema_type,
    created_at, updated_at
  )
  values (
    '/for-doctors',
    'LeanShot for Doctors',
    'published',
    'LeanShot for Doctors — Read-only Patient Data',
    'View your GLP-1 patient''s injection log, weight, and adherence via secure read-share. No account required.',
    'Service',
    now(), now()
  )
  on conflict (slug) do nothing
  returning id into v_doctor_page_id;

  -- If the page already existed, look up its id so we can still link a revision
  -- (in case a previous partial run inserted the page but not the revision).
  if v_doctor_page_id is null then
    select id into v_doctor_page_id from public.landing_pages where slug = '/for-doctors';
  end if;

  -- Insert revision only if no revision currently exists for this page.
  if v_doctor_page_id is not null
     and not exists (select 1 from public.landing_page_revisions where page_id = v_doctor_page_id) then
    insert into public.landing_page_revisions (page_id, block_tree, created_at)
    values (v_doctor_page_id, doctor_blocks, now())
    returning id into v_doctor_rev_id;

    update public.landing_pages
      set published_revision_id = v_doctor_rev_id, updated_at = now()
    where id = v_doctor_page_id;
  end if;

  -- ----------------------------------------------------------------------
  -- /for-clinics
  -- ----------------------------------------------------------------------
  insert into public.landing_pages (
    slug, title, status,
    seo_title, seo_description, seo_schema_type,
    created_at, updated_at
  )
  values (
    '/for-clinics',
    'LeanShot for Clinics',
    'published',
    'LeanShot for Clinics — GLP-1 Patient Monitoring',
    'Multi-patient GLP-1 monitoring with HIPAA-BAA + per-patient pricing.',
    'Service',
    now(), now()
  )
  on conflict (slug) do nothing
  returning id into v_clinic_page_id;

  if v_clinic_page_id is null then
    select id into v_clinic_page_id from public.landing_pages where slug = '/for-clinics';
  end if;

  if v_clinic_page_id is not null
     and not exists (select 1 from public.landing_page_revisions where page_id = v_clinic_page_id) then
    insert into public.landing_page_revisions (page_id, block_tree, created_at)
    values (v_clinic_page_id, clinic_blocks, now())
    returning id into v_clinic_rev_id;

    update public.landing_pages
      set published_revision_id = v_clinic_rev_id, updated_at = now()
    where id = v_clinic_page_id;
  end if;

  -- ----------------------------------------------------------------------
  -- /for-coaches
  -- ----------------------------------------------------------------------
  insert into public.landing_pages (
    slug, title, status,
    seo_title, seo_description, seo_schema_type,
    created_at, updated_at
  )
  values (
    '/for-coaches',
    'LeanShot for Coaches',
    'published',
    'LeanShot for Coaches — Wellness Cohort Tracking',
    'Manage your GLP-1 / peptide coaching clients with adherence + cohort tracking.',
    'Service',
    now(), now()
  )
  on conflict (slug) do nothing
  returning id into v_coach_page_id;

  if v_coach_page_id is null then
    select id into v_coach_page_id from public.landing_pages where slug = '/for-coaches';
  end if;

  if v_coach_page_id is not null
     and not exists (select 1 from public.landing_page_revisions where page_id = v_coach_page_id) then
    insert into public.landing_page_revisions (page_id, block_tree, created_at)
    values (v_coach_page_id, coach_blocks, now())
    returning id into v_coach_rev_id;

    update public.landing_pages
      set published_revision_id = v_coach_rev_id, updated_at = now()
    where id = v_coach_page_id;
  end if;

exception when undefined_table then
  raise notice 'public.landing_pages or public.landing_page_revisions does not exist on this database (drift); skipping audience landing seed';
end $$;
