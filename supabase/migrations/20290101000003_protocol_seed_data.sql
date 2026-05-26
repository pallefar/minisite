-- Phase 61 Plan 01 — Protocol reference seed data
-- =============================================================================
--
-- Seeds 3 reference protocols in 'draft' state for QA + clinician demo:
--   1. Tirzepatide 12-week titration (B2C + clinic audience)
--   2. Retatrutide 16-week stack    (B2C + clinic audience)
--   3. GHRP-2 sleep stack           (clinic-only — B2C explicitly excluded)
--
-- Hardcoded UUIDs for idempotency on re-run:
--   Tirzepatide: 00000000-0000-0000-0000-000000000061
--   Retatrutide: 00000000-0000-0000-0000-000000000062
--   GHRP-2:      00000000-0000-0000-0000-000000000063
--
-- Idempotent:
--   - INSERT INTO protocols ... ON CONFLICT (id, version) DO NOTHING
--   - INSERT INTO protocol_steps ... ON CONFLICT (protocol_id, protocol_version, week) DO NOTHING
--
-- No evidence rows seeded — admin must attach RAG evidence post-Phase 60 retrieval
-- (requirement PROTOCOL-03; depends on Phase 60 RAG infrastructure).
--
-- Per CONTEXT.md Specifics section — exact compounds, audiences, and step dosing.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tirzepatide 12-week titration
--    audience: B2C + clinic
--    6 steps: weeks 1, 5, 9, 13, 17, 21 (standard GLP-1 titration schedule)
-- ---------------------------------------------------------------------------

insert into public.protocols
  (id, version, name, compound, audience, base_slug, review_state, created_by)
values
  (
    '00000000-0000-0000-0000-000000000061',
    1,
    'Tirzepatide 12-week titration',
    'tirzepatide',
    '{B2C,clinic}',
    'tirzepatide-12-week-titration',
    'draft',
    null
  )
on conflict (id, version) do nothing;

insert into public.protocol_steps
  (protocol_id, protocol_version, week, dose_mg, frequency, monitoring)
values
  ('00000000-0000-0000-0000-000000000061', 1,  1,  2.5, 'weekly', '{weight,gi-symptoms}'),
  ('00000000-0000-0000-0000-000000000061', 1,  5,  5.0, 'weekly', '{weight,gi-symptoms}'),
  ('00000000-0000-0000-0000-000000000061', 1,  9,  7.5, 'weekly', '{weight,gi-symptoms}'),
  ('00000000-0000-0000-0000-000000000061', 1, 13, 10.0, 'weekly', '{weight,gi-symptoms}'),
  ('00000000-0000-0000-0000-000000000061', 1, 17, 12.5, 'weekly', '{weight,gi-symptoms}'),
  ('00000000-0000-0000-0000-000000000061', 1, 21, 15.0, 'weekly', '{weight,gi-symptoms}')
on conflict (protocol_id, protocol_version, week) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Retatrutide 16-week stack
--    audience: B2C + clinic
--    4 steps: weeks 1, 5, 9, 13
-- ---------------------------------------------------------------------------

insert into public.protocols
  (id, version, name, compound, audience, base_slug, review_state, created_by)
values
  (
    '00000000-0000-0000-0000-000000000062',
    1,
    'Retatrutide 16-week stack',
    'retatrutide',
    '{B2C,clinic}',
    'retatrutide-16-week-stack',
    'draft',
    null
  )
on conflict (id, version) do nothing;

insert into public.protocol_steps
  (protocol_id, protocol_version, week, dose_mg, frequency, monitoring)
values
  ('00000000-0000-0000-0000-000000000062', 1,  1, 2.0, 'weekly', '{weight,glucose,gi-symptoms}'),
  ('00000000-0000-0000-0000-000000000062', 1,  5, 4.0, 'weekly', '{weight,glucose,gi-symptoms}'),
  ('00000000-0000-0000-0000-000000000062', 1,  9, 6.0, 'weekly', '{weight,glucose,gi-symptoms}'),
  ('00000000-0000-0000-0000-000000000062', 1, 13, 8.0, 'weekly', '{weight,glucose,gi-symptoms}')
on conflict (protocol_id, protocol_version, week) do nothing;

-- ---------------------------------------------------------------------------
-- 3. GHRP-2 sleep stack
--    audience: clinic ONLY — B2C explicitly excluded per CONTEXT.md
--    1 step: week 1, 200mcg encoded as 0.2mg, frequency=daily, monitoring=mood
-- ---------------------------------------------------------------------------

insert into public.protocols
  (id, version, name, compound, audience, base_slug, review_state, created_by)
values
  (
    '00000000-0000-0000-0000-000000000063',
    1,
    'GHRP-2 sleep stack',
    'ghrp-2',
    '{clinic}',
    'ghrp-2-sleep-stack',
    'draft',
    null
  )
on conflict (id, version) do nothing;

insert into public.protocol_steps
  (protocol_id, protocol_version, week, dose_mg, frequency, monitoring)
values
  ('00000000-0000-0000-0000-000000000063', 1, 1, 0.2, 'daily', '{mood}')
on conflict (protocol_id, protocol_version, week) do nothing;
