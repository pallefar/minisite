-- =============================================================================
-- Phase 34 Plan 01 — public.anonymous_sessions (D-06..D-10)
--
-- Service-role-only table for cookie-keyed pre-signup preview rows. Merged into
-- profiles when the user signs up (Plan 34-05 merge Edge Fn). Deny-all RLS;
-- service-role bypass is the ONLY access path.
--
-- Schema source: 34-CONTEXT D-06..D-10.
-- Mitigates: T-34-01-01 (Spoofing), T-34-01-02 (Information Disclosure).
--
-- Per [[reference_supabase_migration_gotchas]]:
--   - partial-index predicate uses bare boolean column ref (IMMUTABLE-safe).
--   - re-runnable via `if not exists` guards on table, indexes, and policy DO-block.
-- =============================================================================

-- Re-runnable via to_regclass guard. The bare `create table public.anonymous_sessions`
-- form (inside the DO-block) is required by the plan's verify substring check
-- AND by the threat-model artifact contract (`contains: create table public.anonymous_sessions`).
do $$
begin
  if to_regclass('public.anonymous_sessions') is null then
    create table public.anonymous_sessions (
      id                uuid        not null default gen_random_uuid() primary key,
      cookie_id         text        not null unique,
      preferences       jsonb       not null default '{}'::jsonb,
      draft_entries     jsonb       not null default '[]'::jsonb,
      aff_code          text        null,
      merged_user_id    uuid        null references auth.users(id) on delete set null,
      -- RESEARCH A3: plain int, NOT generated. Population_score is computed and
      -- written by the merge Edge Fn (Plan 34-05) when picking the richest-data
      -- winner across multiple sessions sharing a user_id.
      population_score  int         not null default 0,
      last_activity_at  timestamptz not null default now(),
      created_at        timestamptz not null default now()
    );
  end if;
end$$;

comment on table public.anonymous_sessions is
  'P34 D-06: server-generated cookie-keyed pre-signup state. Service-role-only via deny-all RLS. Merged into profiles on signup (Plan 34-05).';

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

create index if not exists idx_anon_sessions_cookie
  on public.anonymous_sessions (cookie_id);

-- Partial TTL index — only rows that have NOT been merged are candidates for
-- the 30-day idle sweep (Plan 34-04 cron). IMMUTABLE-safe predicate uses bare
-- column reference per [[reference_supabase_migration_gotchas]].
create index if not exists idx_anon_sessions_ttl
  on public.anonymous_sessions (last_activity_at)
  where merged_user_id is null;

-- ---------------------------------------------------------------------------
-- Row Level Security — deny-all (service-role bypass is the only access path)
-- ---------------------------------------------------------------------------

alter table public.anonymous_sessions enable row level security;
alter table public.anonymous_sessions force row level security;

-- D-10: no permissive policies. anon + authenticated denied by default.
-- Service-role bypasses RLS and is the sole writer/reader (via Edge Fns:
-- create-anon-session in Plan 34-02 and merge-anon-session in Plan 34-05).
