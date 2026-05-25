-- Phase 58 Plan 04 Task 3 — KB articles ES content seed (CONTENT-ONLY)
--
-- IMPORTANT: This migration is CONTENT-ONLY. The ES schema already ships
-- in Phase 37 (20270707000001_helpdesk_schema.sql):
--   • kb_articles.title_es (text)
--   • kb_articles.body_es (text)
--   • kb_articles.locale_set (text[] default array['en'])
--   • search_kb_articles(p_locale text default 'en') SECDEF RPC (20270707000006)
--   • search_vector_es GENERATED STORED tsvector (20270707000005)
--
-- This migration MUST NOT contain:
--   • ALTER TABLE ... ADD COLUMN
--   • CREATE INDEX
--   • CREATE OR REPLACE FUNCTION search_kb
--   • CREATE TABLE
--
-- Strategy (WR-01 fix — slug-targeted idempotent upsert):
--   Per-slug INSERT ... ON CONFLICT (coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid), slug)
--   DO UPDATE SET title_es=..., body_es=..., locale_set=...
--   Conflict target mirrors the unique index kb_articles_org_slug_idx defined in
--   20270707000001_helpdesk_schema.sql:
--     create unique index kb_articles_org_slug_idx
--       on public.kb_articles (coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid), slug);
--
--   This is safe to re-run regardless of whether any global article exists.
--   If the slug row exists → DO UPDATE overwrites ES fields only (EN content unchanged).
--   If the slug row does not exist → INSERT creates the full row.
--
-- Clinical terms in ES body text are flagged signoff-pending per T-58-02:
--   'inyección', 'dosis', 'titulación', 'náusea', 'GLP-1'
-- These are recorded in docs/clinical-glossary.md (created by Plan 58-01).
-- Human sign-off deferred to Phase 70 per threat model T-58-02 transfer.

begin;

-- ============================================================
-- Slug 1: injection-site-rotation
-- ============================================================
insert into public.kb_articles (
  id,
  org_id,
  slug,
  title,
  body,
  title_es,
  body_es,
  locale_set,
  published_at,
  published_version,
  created_at,
  updated_at
) values (
  '11111111-0000-0000-0000-000000000001'::uuid,
  null,
  'injection-site-rotation',
  'How injection-site rotation works',
  $$Rotating your injection sites (e.g. abdomen, thigh, upper arm) reduces the risk of lipohypertrophy — fatty tissue thickening that can impair drug absorption. Aim to leave at least one week between injections at the exact same spot. LeanShot marks recently-used sites to help you visualise your rotation pattern.$$,
  'Cómo funciona la rotación del sitio de inyección',
  $$La rotación de los sitios de inyección (por ejemplo, abdomen, muslo, parte superior del brazo) reduce el riesgo de lipohipertrofia — el engrosamiento del tejido graso que puede alterar la absorción del medicamento. El objetivo es dejar al menos una semana entre inyecciones en el mismo punto exacto. LeanShot marca los sitios utilizados recientemente para ayudarle a visualizar su patrón de rotación.$$,
  array['en', 'es'],
  now(),
  1,
  now(),
  now()
)
on conflict (coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid), slug)
do update set
  title_es   = excluded.title_es,
  body_es    = excluded.body_es,
  locale_set = excluded.locale_set,
  updated_at = now();

-- ============================================================
-- Slug 2: reading-your-med-level-curve
-- ============================================================
insert into public.kb_articles (
  id,
  org_id,
  slug,
  title,
  body,
  title_es,
  body_es,
  locale_set,
  published_at,
  published_version,
  created_at,
  updated_at
) values (
  '11111111-0000-0000-0000-000000000002'::uuid,
  null,
  'reading-your-med-level-curve',
  'Reading your medication-level curve',
  $$The medication-level curve shows the estimated GLP-1 concentration in your body over time, based on known pharmacokinetics for your drug and your dose logs. The level rises after each injection and falls gradually as the drug clears (half-life ~7 days for semaglutide, ~5 days for tirzepatide). Stay within the therapeutic window by following your prescribed dosing schedule and logging each injection on time.$$,
  'Cómo interpretar su curva de nivel de medicamento',
  $$La curva de nivel de medicamento muestra la concentración estimada del GLP-1 en su organismo a lo largo del tiempo, basándose en la farmacocinética conocida de su medicamento y sus registros de dosis. El nivel sube tras cada inyección y desciende gradualmente a medida que el medicamento se elimina (vida media de ~7 días para el semaglutide, ~5 días para el tirzepatide). Manténgase en la ventana terapéutica siguiendo su pauta de dosificación prescrita y registrando cada inyección a tiempo.$$,
  array['en', 'es'],
  now(),
  1,
  now(),
  now()
)
on conflict (coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid), slug)
do update set
  title_es   = excluded.title_es,
  body_es    = excluded.body_es,
  locale_set = excluded.locale_set,
  updated_at = now();

-- ============================================================
-- Slug 3: what-to-do-about-nausea
-- ============================================================
insert into public.kb_articles (
  id,
  org_id,
  slug,
  title,
  body,
  title_es,
  body_es,
  locale_set,
  published_at,
  published_version,
  created_at,
  updated_at
) values (
  '11111111-0000-0000-0000-000000000003'::uuid,
  null,
  'what-to-do-about-nausea',
  'What to do about nausea',
  $$Nausea is the most common side-effect at the start of GLP-1 therapy, especially during the titration phase. Strategies that can help: eat small, frequent portions; avoid fatty or spicy foods; stay hydrated; and take your injection at the same time of day. If nausea is severe or persistent, speak with your prescriber — pausing the dose escalation may be needed.$$,
  'Qué hacer ante las náuseas',
  $$Las náuseas son el efecto secundario más frecuente al inicio del tratamiento con GLP-1, especialmente durante la fase de titulación. Estrategias que pueden ayudar: comer porciones pequeñas y frecuentes, evitar alimentos grasos o picantes, mantenerse hidratado y tomar la inyección a la misma hora del día. Si las náuseas son graves o persistentes, consulte con su prescriptor — podría ser necesario pausar la escalada de dosis.$$,
  array['en', 'es'],
  now(),
  1,
  now(),
  now()
)
on conflict (coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid), slug)
do update set
  title_es   = excluded.title_es,
  body_es    = excluded.body_es,
  locale_set = excluded.locale_set,
  updated_at = now();

commit;
