-- Phase 61 Plan 01 — Protocol schema: 6 tables + ENUM + indexes + RLS policies
-- =============================================================================
--
-- Creates the DB schema foundation for the admin protocol creator:
--   1. ENUM: public.protocol_review_state
--   2. public.protocols          — row-per-version immutable versioning (PK: id, version)
--   3. public.protocol_steps     — per-week titration steps (FK → protocols)
--   4. public.protocol_evidence  — RAG-cited evidence per step (FK → protocol_steps ON DELETE CASCADE)
--   5. public.protocol_review_log — append-only audit trail
--   6. public.patient_protocol_assignment — clinician → patient protocol assignment
--   7. public.admin_ai_assist_log — rate-limit + audit for AI-assist calls
--
-- RLS enforcement:
--   - Staff tables: using (public.is_staff()) — mirrors Phase 60 RLS pattern
--   - Patient table: auth.uid() = patient_id (own-row select) + staff write
--   - Public published select: review_state = 'published' for authenticated users
--
-- Idempotent: enum created via DO-block, tables via IF NOT EXISTS,
--             policies via CREATE POLICY IF NOT EXISTS (Postgres 15+),
--             trigger function via CREATE OR REPLACE.
--
-- Per [[reference_supabase_is_staff_helper]] — uses public.is_staff() directly.
-- Per CONTEXT.md D-CTX-01 — monitoring is text[], not a lookup table.
-- Per RESEARCH.md Pattern 3 — composite PK (id, version) enables row-per-version.
-- Per RESEARCH.md Pitfall 2 — base_slug separate from slug to avoid version collision.
-- Per RESEARCH.md Pitfall 6 — protocol_evidence.step_id ON DELETE CASCADE.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. tg_set_updated_at — reusable trigger function
--    CREATE OR REPLACE so it's safe to run in any order / re-run.
-- ---------------------------------------------------------------------------

create or replace function public.tg_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 1. ENUM: public.protocol_review_state
--    Guard: DO block checks pg_type before creating to stay idempotent.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_type
    where typname = 'protocol_review_state'
      and typnamespace = 'public'::regnamespace
  ) then
    create type public.protocol_review_state as enum (
      'draft',
      'in_review',
      'published',
      'archived'
    );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. public.protocols — version-immutable history
--    Composite PK (id, version) per PROTOCOL-05.
--    base_slug stores slug WITHOUT '-vN' suffix; slug is computed stored column.
--    audience is text[] — subset of ['B2C', 'clinic'].
-- ---------------------------------------------------------------------------

create table if not exists public.protocols (
  id              uuid          not null default gen_random_uuid(),
  version         int           not null default 1,
  name            text          not null,
  compound        text          not null,
  audience        text[]        not null default '{}',
  base_slug       text          not null,
  slug            text          generated always as (base_slug || '-v' || version::text) stored,
  review_state    public.protocol_review_state not null default 'draft',
  created_by      uuid          references auth.users(id) on delete set null,
  reviewed_by     uuid          references auth.users(id) on delete set null,
  published_at    timestamptz,
  reviewed_at     timestamptz,
  created_at      timestamptz   not null default now(),
  updated_at      timestamptz   not null default now(),
  primary key (id, version)
);

-- updated_at trigger on protocols
do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'set_updated_at_on_protocols'
      and tgrelid = 'public.protocols'::regclass
  ) then
    create trigger set_updated_at_on_protocols
      before update on public.protocols
      for each row execute function public.tg_set_updated_at();
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. public.protocol_steps — per-week titration steps
--    Composite FK (protocol_id, protocol_version) → protocols(id, version).
--    UNIQUE(protocol_id, protocol_version, week) enforces one-row-per-week.
--    frequency CHECK validates the 4-value ProtocolFrequency enum.
-- ---------------------------------------------------------------------------

create table if not exists public.protocol_steps (
  id               uuid     not null default gen_random_uuid() primary key,
  protocol_id      uuid     not null,
  protocol_version int      not null,
  week             int      not null,
  dose_mg          numeric  not null,
  frequency        text     not null,
  cron_string      text,
  monitoring       text[]   not null default '{}',
  constraint fk_protocol_steps_protocol
    foreign key (protocol_id, protocol_version)
    references public.protocols (id, version)
    on delete cascade,
  constraint uq_protocol_steps_week
    unique (protocol_id, protocol_version, week),
  constraint chk_protocol_steps_frequency
    check (frequency in ('daily', 'weekly', 'bi-weekly', 'custom-cron'))
);

-- ---------------------------------------------------------------------------
-- 4. public.protocol_evidence — RAG-cited evidence per step
--    step_id NOT NULL and ON DELETE CASCADE (RESEARCH.md Pitfall 6).
--    rag_source_id has NO FK — RAG chunks may be retracted; preserve audit trail.
-- ---------------------------------------------------------------------------

create table if not exists public.protocol_evidence (
  id              uuid        not null default gen_random_uuid() primary key,
  protocol_id     uuid        not null,
  step_id         uuid        not null references public.protocol_steps(id) on delete cascade,
  citation_text   text        not null,
  rag_source_id   uuid        not null,
  verbatim_quote  text        not null,
  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 5. public.protocol_review_log — append-only audit trail
--    Append-only: no UPDATE, no DELETE via RLS (staff_all allows all, but by
--    convention RPCs only INSERT; plan 02 SECDEF RPCs enforce this).
-- ---------------------------------------------------------------------------

create table if not exists public.protocol_review_log (
  id          uuid        not null default gen_random_uuid() primary key,
  protocol_id uuid        not null,
  version     int         not null,
  actor       uuid        references auth.users(id),
  action      text        not null,
  at          timestamptz not null default now(),
  constraint chk_review_log_action
    check (action in (
      'submitted_for_review',
      'published',
      'archived',
      'rolled_back',
      'retracted'
    ))
);

-- ---------------------------------------------------------------------------
-- 6. public.patient_protocol_assignment — clinician assigns protocol to patient
--    PK (patient_id, protocol_id) — idempotency on re-assign (RESEARCH.md Pitfall 3).
--    ON CONFLICT in assign_protocol_to_patient SECDEF updates version on re-assign.
-- ---------------------------------------------------------------------------

create table if not exists public.patient_protocol_assignment (
  patient_id   uuid        not null references auth.users(id) on delete cascade,
  protocol_id  uuid        not null,
  version      int         not null,
  started_at   timestamptz not null default now(),
  primary key (patient_id, protocol_id)
);

-- ---------------------------------------------------------------------------
-- 7. public.admin_ai_assist_log — rate-limit + audit for AI-assist calls
--    Index on (actor_id, created_at desc) supports per-day count query.
--    Rate-limit query uses date_trunc('day', now() AT TIME ZONE 'UTC')
--    (RESEARCH.md Pitfall 4 — avoids CURRENT_DATE midnight boundary race).
-- ---------------------------------------------------------------------------

create table if not exists public.admin_ai_assist_log (
  id                uuid        not null default gen_random_uuid() primary key,
  actor_id          uuid        not null references auth.users(id) on delete cascade,
  protocol_id       uuid,
  step_week         int,
  compound          text        not null,
  refusal           boolean     not null default false,
  cited_chunk_count int         not null default 0,
  created_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 8. Indexes
-- ---------------------------------------------------------------------------

-- protocols: partial index for active state lookup
create index if not exists idx_protocols_active_state
  on public.protocols (review_state)
  where review_state in ('in_review', 'published');

-- protocols: slug lookup index — supports /protocols/<slug> latest-published resolution
create index if not exists idx_protocols_published_slug
  on public.protocols (base_slug, version desc)
  where review_state = 'published';

-- protocol_steps: FK + ordering index
create index if not exists idx_protocol_steps_protocol
  on public.protocol_steps (protocol_id, protocol_version, week);

-- protocol_evidence: step lookup
create index if not exists idx_protocol_evidence_step
  on public.protocol_evidence (step_id);

-- protocol_review_log: audit lookup ordered by time
create index if not exists idx_protocol_review_log_protocol
  on public.protocol_review_log (protocol_id, at desc);

-- admin_ai_assist_log: per-day rate-limit count query
create index if not exists idx_admin_ai_assist_log_actor_date
  on public.admin_ai_assist_log (actor_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 9. Enable RLS on all 6 tables
-- ---------------------------------------------------------------------------

alter table public.protocols                  enable row level security;
alter table public.protocol_steps             enable row level security;
alter table public.protocol_evidence          enable row level security;
alter table public.protocol_review_log        enable row level security;
alter table public.patient_protocol_assignment enable row level security;
alter table public.admin_ai_assist_log        enable row level security;

-- ---------------------------------------------------------------------------
-- 10. RLS policies
-- ---------------------------------------------------------------------------

-- --- public.protocols ---

-- Staff: full access
create policy if not exists "staff_all"
  on public.protocols
  for all
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- Public: authenticated users can SELECT published protocols
-- (for /protocols/<slug> consumer surface — auth-gated, published-only)
create policy if not exists "public_published_select"
  on public.protocols
  for select
  to authenticated
  using (review_state = 'published');

-- --- public.protocol_steps ---

-- Staff: full access
create policy if not exists "staff_all"
  on public.protocol_steps
  for all
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- Public: authenticated users can SELECT steps for published protocols
create policy if not exists "public_published_select"
  on public.protocol_steps
  for select
  to authenticated
  using (
    exists (
      select 1 from public.protocols p
      where p.id = protocol_id
        and p.version = protocol_version
        and p.review_state = 'published'
    )
  );

-- --- public.protocol_evidence ---

-- Staff: full access
create policy if not exists "staff_all"
  on public.protocol_evidence
  for all
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- Public: authenticated users can SELECT evidence for published protocol steps
create policy if not exists "public_published_select"
  on public.protocol_evidence
  for select
  to authenticated
  using (
    exists (
      select 1 from public.protocol_steps s
      join public.protocols p on p.id = s.protocol_id
        and p.version = s.protocol_version
      where s.id = step_id
        and p.review_state = 'published'
    )
  );

-- --- public.protocol_review_log ---

-- Staff: full access (RPCs enforce append-only by never calling DELETE/UPDATE)
create policy if not exists "staff_all"
  on public.protocol_review_log
  for all
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- --- public.patient_protocol_assignment ---

-- Patient: own-row select only
create policy if not exists "own_select"
  on public.patient_protocol_assignment
  for select
  to authenticated
  using (auth.uid() = patient_id);

-- Staff: full access (write assignments via SECDEF assign_protocol_to_patient RPC)
create policy if not exists "staff_write"
  on public.patient_protocol_assignment
  for all
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- --- public.admin_ai_assist_log ---

-- Staff: full access (INSERT via Edge Fn service-role bypasses RLS;
--   this policy supports any direct admin queries for audit review)
create policy if not exists "staff_all"
  on public.admin_ai_assist_log
  for all
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());
