-- Phase 39 Plan 39-01 — pharma_content table.
--
-- CONTEXT references (39-CONTEXT.md):
--   D-05 (safety_category column: 5 NEVER-paywalled categories: overdose,
--   contraindication, FDA black-box, serious adverse-event signals, pregnancy/
--   lactation. Non-null safety_category = always free.),
--   D-06 (phaCheck() helper + ESLint rule + CI grep gate enforce the carveout
--   client-side; safety_category column is the server-side single source of truth).
--
-- Purpose:
--   Catalog of pharmacology content shown in the pharma tab. Free users see
--   `summary` (1-2 sentences); Pro users see `full_content`. Rows with
--   safety_category != null are FREE for everyone regardless of tier (D-05 carveout).
--
-- Writes flow only through Wave-2 SECDEF RPCs (Pattern S2).
-- pharma_content_versions audit log shipped in 20270714000005.

create table if not exists public.pharma_content (
  id               uuid primary key default gen_random_uuid(),
  slug             text not null unique,
  summary          text not null default '',     -- 1-2 sentence free tier
  full_content     text not null default '',     -- Pro tier
  safety_category  text,                          -- D-05: non-null = always free
                                                  -- allowed values: overdose, contraindication,
                                                  -- fda_black_box, adverse_event_signal,
                                                  -- pregnancy_lactation
  created_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint pharma_content_safety_category_chk
    check (safety_category is null or safety_category in (
      'overdose', 'contraindication', 'fda_black_box',
      'adverse_event_signal', 'pregnancy_lactation'
    ))
);

comment on table public.pharma_content is
  'Phase 39 D-05/D-06: pharma copy catalog. safety_category non-null = ALWAYS '
  'free for all tiers (regulatory carveout). phaCheck() helper + ESLint + CI '
  'grep gate enforce client-side; this column is the server-side single source.';

comment on column public.pharma_content.safety_category is
  'D-05: when non-null, this row is FREE for all tiers (overdose, '
  'contraindication, FDA black-box, serious adverse-event, pregnancy/lactation). '
  'PaywallGate + phaCheck() consult this column to short-circuit paywall logic.';

create index if not exists pharma_content_safety_category_idx
  on public.pharma_content (safety_category) where safety_category is not null;

alter table public.pharma_content enable row level security;

-- SELECT: any authenticated user can read pharma content (paywall enforcement
-- lives in the React layer via PaywallGate consulting tier_effective + safety_category).
create policy pol_pharma_content_authenticated_select
  on public.pharma_content
  for select
  to authenticated
  using (true);

-- NO INSERT/UPDATE/DELETE policies — Pattern S2: SECDEF RPC writes only
-- (with paired pharma_content_versions append in 20270714000005).
