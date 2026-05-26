---
phase: 61-admin-protocol-creator
plan: 01
type: execute
wave: 0
depends_on: []
files_modified:
  - supabase/migrations/20260526000001_protocol_tables.sql
  - supabase/migrations/20260526000003_protocol_seed_data.sql
  - src/types/protocols.ts
autonomous: true
requirements:
  - PROTOCOL-01
  - PROTOCOL-05
must_haves:
  truths:
    - "`protocols` table exists with row-per-version primary key (id, version) and review_state ENUM"
    - "`protocol_steps`, `protocol_evidence`, `protocol_review_log`, `patient_protocol_assignment`, `admin_ai_assist_log` tables exist with correct columns, constraints, and indexes"
    - "RLS policies enforce `is_staff()` on staff tables and `auth.uid() = patient_id` on patient-facing tables"
    - "3 reference protocols (Tirzepatide 12-wk, Retatrutide 16-wk, GHRP-2 sleep stack) seeded as draft rows"
    - "Shared TS type module `src/types/protocols.ts` exports `Protocol`, `ProtocolStep`, `ProtocolEvidence`, `ProtocolReviewState`, `PatientProtocolAssignment`, `AiAssistResponse`, `AdminAiAssistLogRow`"
  artifacts:
    - path: "supabase/migrations/20260526000001_protocol_tables.sql"
      provides: "6 tables + ENUM + indexes + RLS policies + seed data link"
      contains: "create table public.protocols"
    - path: "supabase/migrations/20260526000003_protocol_seed_data.sql"
      provides: "3 reference protocol seed rows + step rows"
      contains: "insert into public.protocols"
    - path: "src/types/protocols.ts"
      provides: "TS contracts consumed by all Wave 1 plans"
      exports: ["Protocol", "ProtocolStep", "ProtocolEvidence", "ProtocolReviewState", "PatientProtocolAssignment", "AdminAiAssistLogRow", "AiAssistRequest", "AiAssistResponse"]
  key_links:
    - from: "protocol_evidence.step_id"
      to: "protocol_steps.id"
      via: "ON DELETE CASCADE foreign key"
      pattern: "references public\\.protocol_steps.*on delete cascade"
    - from: "patient_protocol_assignment"
      to: "auth.uid() = patient_id"
      via: "RLS policy on patient-facing table"
      pattern: "auth\\.uid\\(\\) = patient_id"
    - from: "protocols, protocol_steps, protocol_evidence, protocol_review_log, admin_ai_assist_log"
      to: "public.is_staff()"
      via: "RLS policy"
      pattern: "using \\(public\\.is_staff\\(\\)\\)"
---

<objective>
Create the DB schema foundation for Phase 61: 6 tables, ENUM, indexes, RLS policies, computed slug, 3 reference protocol seed rows, and the shared TS type module that Wave 1 plans consume.

Purpose: Establishes immutable contracts that Wave 1 admin UI, clinic adopt flow, patient prefill, KB shortcode, and Edge Fn all depend on. Row-per-version primary key enables PROTOCOL-05 versioning + rollback. RLS enforces 2-person review at storage layer (Layer 1 of the 3-layer invariant).

Output: 2 migration files + 1 TS type module. After this plan, `supabase db push --linked` MAY be run by close-out (Plan 08), but Wave 1 plans only need the files to exist on disk for type imports + RPC reference compilation.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@/Users/karstenhaldan/minisite/leanshot/.planning/PROJECT.md
@/Users/karstenhaldan/minisite/leanshot/.planning/ROADMAP.md
@/Users/karstenhaldan/minisite/leanshot/.planning/STATE.md
@/Users/karstenhaldan/minisite/leanshot/.planning/phases/61-admin-protocol-creator/61-CONTEXT.md
@/Users/karstenhaldan/minisite/leanshot/.planning/phases/61-admin-protocol-creator/61-RESEARCH.md
@/Users/karstenhaldan/minisite/leanshot/.planning/phases/61-admin-protocol-creator/61-PATTERNS.md

# Existing reference migration (verbatim analog for SECDEF + RLS pattern):
@/Users/karstenhaldan/minisite/supabase/migrations/20281201000002_phase60_secdef_rpcs.sql

# is_staff() helper used by all admin RLS policies:
@/Users/karstenhaldan/minisite/supabase/migrations/20261101000006_is_staff_helper.sql

<interfaces>
<!-- TS type contracts to export from src/types/protocols.ts -->
<!-- These are CONSUMED by Plans 04, 05, 06, 07 (Wave 1) and 03 (Edge Fn) -->

export type ProtocolReviewState = 'draft' | 'in_review' | 'published' | 'archived';

export type ProtocolFrequency = 'daily' | 'weekly' | 'bi-weekly' | 'custom-cron';

export type ProtocolMonitoringKey = 'weight' | 'glucose' | 'bp' | 'mood' | 'gi-symptoms';

export interface Protocol {
  id: string;            // uuid
  version: number;       // int, monotonic per id
  name: string;
  compound: string;
  audience: string[];    // ['B2C', 'clinic'] subset
  base_slug: string;     // slug WITHOUT version suffix (for /protocols/<slug> public route)
  slug: string;          // computed: base_slug + '-v' + version
  review_state: ProtocolReviewState;
  created_by: string | null;
  reviewed_by: string | null;
  published_at: string | null;  // ISO timestamptz
  reviewed_at: string | null;
  created_at: string;
}

export interface ProtocolStep {
  id: string;
  protocol_id: string;
  protocol_version: number;
  week: number;
  dose_mg: number;
  frequency: ProtocolFrequency;
  cron_string: string | null;  // populated only when frequency='custom-cron'
  monitoring: ProtocolMonitoringKey[];
}

export interface ProtocolEvidence {
  id: string;
  protocol_id: string;
  step_id: string;             // NOT NULL — step-level granularity mandatory
  citation_text: string;
  rag_source_id: string;       // references rag-curated chunk
  verbatim_quote: string;
  created_at: string;
}

export interface ProtocolReviewLogRow {
  id: string;
  protocol_id: string;
  version: number;
  actor: string;
  action: 'submitted_for_review' | 'published' | 'archived' | 'rolled_back' | 'retracted';
  at: string;
}

export interface PatientProtocolAssignment {
  patient_id: string;
  protocol_id: string;
  version: number;
  started_at: string;
}

export interface AdminAiAssistLogRow {
  id: string;
  actor_id: string;
  protocol_id: string | null;
  step_week: number | null;
  compound: string;
  refusal: boolean;
  cited_chunk_count: number;
  created_at: string;
}

export interface AiAssistRequest {
  protocol_id: string | null;  // null = new draft, no row yet
  step_week: number;
  compound: string;
  prior_steps_context: string;
}

export interface AiAssistResponse {
  dose_mg: number;
  monitoring: ProtocolMonitoringKey[];
  cited_chunk_ids: string[];
  refusal: boolean;
  refusal_reason?: string;
}
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Write protocols schema migration + shared TS types</name>
  <files>supabase/migrations/20260526000001_protocol_tables.sql, src/types/protocols.ts</files>
  <action>
Create `supabase/migrations/20260526000001_protocol_tables.sql` containing (relative to git root `/Users/karstenhaldan/minisite/`):

1. `create type public.protocol_review_state as enum ('draft', 'in_review', 'published', 'archived');` (guarded by `do $$ ... if not exists ...`).

2. `create table public.protocols` with columns per the interfaces block above. Composite primary key `(id, version)` per PROTOCOL-05 (row-per-version pattern per RESEARCH.md Pattern 3). Add `base_slug` text column (slug WITHOUT version suffix) per RESEARCH.md Pitfall 2 (slug collision). Add `slug` generated column: `slug text generated always as (base_slug || '-v' || version::text) stored`. Default `id = gen_random_uuid()`, `version = 1`, `review_state = 'draft'`, `audience = '{}'`, `created_at = now()`. Foreign keys `created_by`/`reviewed_by` reference `auth.users(id) on delete set null`. Add `updated_at timestamptz not null default now()`.

3. `create table public.protocol_steps` with columns matching `ProtocolStep` interface. Primary key `(id)`, default `id = gen_random_uuid()`. Foreign key `(protocol_id, protocol_version)` references `public.protocols(id, version) on delete cascade`. Add `unique (protocol_id, protocol_version, week)`. `monitoring text[] not null default '{}'`. `cron_string text null`. `frequency` validated via CHECK constraint accepting only the 4 ProtocolFrequency values.

4. `create table public.protocol_evidence` with columns matching `ProtocolEvidence` interface. `step_id uuid not null references public.protocol_steps(id) on delete cascade` per RESEARCH.md Pitfall 6. `rag_source_id uuid not null` (no FK — RAG chunks may be retracted; preserve audit). `citation_text text not null`, `verbatim_quote text not null`.

5. `create table public.protocol_review_log` (append-only audit). Columns: `id uuid pk default gen_random_uuid()`, `protocol_id uuid not null`, `version int not null`, `actor uuid references auth.users(id)`, `action text not null check (action in ('submitted_for_review','published','archived','rolled_back','retracted'))`, `at timestamptz not null default now()`.

6. `create table public.patient_protocol_assignment` per `PatientProtocolAssignment` interface. Primary key `(patient_id, protocol_id)` per RESEARCH.md Pitfall 3 (idempotency on re-assign). `patient_id uuid not null references auth.users(id) on delete cascade`. `version int not null`, `started_at timestamptz not null default now()`.

7. `create table public.admin_ai_assist_log` for rate limiting. Columns: `id uuid pk default gen_random_uuid()`, `actor_id uuid not null references auth.users(id) on delete cascade`, `protocol_id uuid null`, `step_week int null`, `compound text not null`, `refusal boolean not null default false`, `cited_chunk_count int not null default 0`, `created_at timestamptz not null default now()`. Add index `(actor_id, created_at desc)` to support the per-day count query in Plan 03 (Pitfall 4: use `date_trunc('day', now() at time zone 'UTC')`).

8. Indexes:
   - `protocols (review_state)` partial index `where review_state in ('in_review', 'published')`
   - `protocols (base_slug, version desc) where review_state = 'published'` — supports /protocols/<slug> latest-published lookup
   - `protocol_steps (protocol_id, protocol_version, week)`
   - `protocol_evidence (step_id)`
   - `protocol_review_log (protocol_id, at desc)`

9. Enable RLS on all 6 tables: `alter table public.<name> enable row level security;`

10. RLS policies:
    - Staff tables (`protocols`, `protocol_steps`, `protocol_evidence`, `protocol_review_log`, `admin_ai_assist_log`): `create policy "staff_all" on public.<name> for all to authenticated using (public.is_staff()) with check (public.is_staff());`
    - Patient table (`patient_protocol_assignment`): two policies — `create policy "own_select" ... for select using (auth.uid() = patient_id);` AND `create policy "staff_write" ... for all to authenticated using (public.is_staff()) with check (public.is_staff());`
    - Public read for published protocols (consumer-surface `/protocols/<slug>` per UI-SPEC Surface 8): `create policy "public_published_select" on public.protocols for select to authenticated using (review_state = 'published');` AND mirror on `protocol_steps` + `protocol_evidence` (join through `protocols` via subselect: `using (exists (select 1 from public.protocols p where p.id = protocol_id and p.review_state = 'published'))`).

11. `tg_set_updated_at` trigger on `protocols` to bump `updated_at` on every UPDATE (reuse existing helper if present in earlier migrations; if not, inline `create or replace function public.tg_set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;`).

Then create `src/types/protocols.ts` with EXACTLY the interfaces shown in the `<interfaces>` block above (verbatim — no additions). Add JSDoc comment headers per `src/types/` convention. Re-export from `src/types/index.ts` barrel by appending `export * from './protocols';` if barrel exists; if not, leave barrel unchanged.

Constraints:
  - Migration MUST be idempotent via `create type ... if not exists` (use DO-block for ENUM), `create table if not exists`, `create policy if not exists` (Postgres 15+).
  - All SQL lowercase keywords per existing migration convention (verified in `20281201000002_phase60_secdef_rpcs.sql`).
  - Do NOT push to remote — Plan 08 handles `supabase db push --linked` at close-out per `feedback_phase_close_out_db_push_verification`.
  - per CONTEXT.md D-CTX-01 monitoring is `text[]` not lookup table.
  - per UI-SPEC Surface 2 frequency is the 4-value enum (validated by CHECK constraint).
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite && test -f supabase/migrations/20260526000001_protocol_tables.sql && test -f leanshot/src/types/protocols.ts && grep -q "create table.*public.protocols" supabase/migrations/20260526000001_protocol_tables.sql && grep -q "protocol_review_state" supabase/migrations/20260526000001_protocol_tables.sql && grep -q "auth.uid() = patient_id" supabase/migrations/20260526000001_protocol_tables.sql && grep -q "public.is_staff()" supabase/migrations/20260526000001_protocol_tables.sql && grep -q "on delete cascade" supabase/migrations/20260526000001_protocol_tables.sql && grep -q "ProtocolReviewState" leanshot/src/types/protocols.ts && grep -q "AiAssistResponse" leanshot/src/types/protocols.ts && cd leanshot && npx tsc -p tsconfig.app.json --noEmit 2>&1 | grep -v "^$" | (! grep -E "src/types/protocols\\.ts.*error")</automated>
  </verify>
  <done>Migration file syntactically valid SQL (no `psql` parse required — grep gates above prove structure); TS type file compiles under strict mode; `src/types/protocols.ts` exports all 9 interfaces; no TypeScript errors introduced in protocols.ts.</done>
</task>

<task type="auto">
  <name>Task 2: Write protocol seed data migration</name>
  <files>supabase/migrations/20260526000003_protocol_seed_data.sql</files>
  <action>
Create `supabase/migrations/20260526000003_protocol_seed_data.sql` at `/Users/karstenhaldan/minisite/supabase/migrations/` per CONTEXT.md Specifics section — 3 reference protocols (draft state):

1. **Tirzepatide 12-week titration** — compound='tirzepatide', audience='{B2C,clinic}', name='Tirzepatide 12-week titration', base_slug='tirzepatide-12-week-titration'. 6 steps: week 1=2.5mg, week 5=5mg, week 9=7.5mg, week 13=10mg, week 17=12.5mg, week 21=15mg. All frequency='weekly', monitoring={weight,gi-symptoms}.

2. **Retatrutide 16-week stack** — compound='retatrutide', audience='{B2C,clinic}', name='Retatrutide 16-week stack', base_slug='retatrutide-16-week-stack'. 4 steps: week 1=2mg, week 5=4mg, week 9=6mg, week 13=8mg. All frequency='weekly', monitoring={weight,glucose,gi-symptoms}.

3. **GHRP-2 sleep stack** — compound='ghrp-2', audience='{clinic}' (B2C explicitly excluded per CONTEXT.md), name='GHRP-2 sleep stack', base_slug='ghrp-2-sleep-stack'. 1 step: week 1=200mcg (encoded as `dose_mg=0.2`), frequency='daily', monitoring={mood}.

Use literal UUIDs (hardcode 3 protocol UUIDs) so seed is idempotent across re-runs:
- Tirzepatide: '00000000-0000-0000-0000-000000000061'
- Retatrutide: '00000000-0000-0000-0000-000000000062'
- GHRP-2: '00000000-0000-0000-0000-000000000063'

Use `INSERT ... ON CONFLICT (id, version) DO NOTHING` for protocols; `INSERT ... ON CONFLICT (protocol_id, protocol_version, week) DO NOTHING` for steps.

No evidence rows seeded — admin must attach RAG evidence post-Phase 60 retrieval (PROTOCOL-03).

All 3 seeded as `review_state = 'draft'`, `created_by = null` (system-seeded; not user-created), `version = 1`.
  </action>
  <verify>
    <automated>cd /Users/karstenhaldan/minisite && test -f supabase/migrations/20260526000003_protocol_seed_data.sql && grep -c "insert into public.protocols" supabase/migrations/20260526000003_protocol_seed_data.sql | grep -v '^0$' && grep -q "tirzepatide" supabase/migrations/20260526000003_protocol_seed_data.sql && grep -q "retatrutide" supabase/migrations/20260526000003_protocol_seed_data.sql && grep -q "ghrp-2" supabase/migrations/20260526000003_protocol_seed_data.sql && grep -q "on conflict" supabase/migrations/20260526000003_protocol_seed_data.sql</automated>
  </verify>
  <done>Seed migration exists with all 3 reference protocols + at least 11 step rows (6+4+1); idempotent via ON CONFLICT.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| public.protocols → /protocols/<slug> public route | Authenticated patient/clinician can SELECT published protocols only |
| public.protocols → admin UI | Staff-only via is_staff() RLS |
| public.patient_protocol_assignment → patient surface | Patient sees only their own row via auth.uid() = patient_id |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-61-01-01 | Information disclosure | `/protocols/<slug>` public route | mitigate | RLS policy `review_state = 'published'`; non-published rows return 404 (RLS hides them entirely) |
| T-61-01-02 | Elevation of privilege | patient_protocol_assignment cross-tenant read | mitigate | RLS `auth.uid() = patient_id` blocks cross-patient SELECT |
| T-61-01-03 | Tampering | Direct UPDATE on protocols bypassing publish_protocol RPC | mitigate | Staff-only RLS + plan 02 SECDEF RPC as the only authorized state-transition path; admin clients use service_role only via Edge Fns, never browser |
| T-61-01-04 | Information disclosure | Slug enumeration to discover unpublished protocols | mitigate | UUID-derived slugs (non-sequential); RLS filters to published-only for non-staff |
</threat_model>

<verification>
- Migration files exist at canonical paths under `supabase/migrations/`
- `src/types/protocols.ts` exports all 9 interfaces declared in `<interfaces>` block
- `npx tsc -p tsconfig.app.json --noEmit` shows no NEW errors attributable to `src/types/protocols.ts`
- Schema review (manual): every staff table has `using (public.is_staff())` RLS policy; patient table has `auth.uid() = patient_id`; published-only public select policy present on `protocols`
- Seed migration uses `ON CONFLICT DO NOTHING` (idempotent)
- No `supabase db push` executed in this plan (deferred to Plan 08 close-out)
</verification>

<success_criteria>
- [ ] `supabase/migrations/20260526000001_protocol_tables.sql` exists with 6 tables, 1 ENUM, RLS policies, indexes, computed slug
- [ ] `supabase/migrations/20260526000003_protocol_seed_data.sql` exists with 3 seeded protocols + 11 step rows
- [ ] `src/types/protocols.ts` exists exporting 9 interfaces; `tsc --noEmit` shows no new errors in that file
- [ ] Every audit + state-transition concern (PROTOCOL-04, PROTOCOL-05) has a DB-layer enforcement seat ready for Plan 02 SECDEF RPCs
</success_criteria>

<output>
Create `.planning/phases/61-admin-protocol-creator/61-01-SUMMARY.md` when done documenting: files created, schema decisions (composite PK, base_slug separation), RLS surface, seed protocol IDs.
</output>
