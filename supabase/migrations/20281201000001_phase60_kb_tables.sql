-- Phase 60 Plan 60-01 — data-layer foundation (file 1-of-3): 4 new tables
-- ============================================================================
--
-- TASK 1 PINNED FINDINGS (verified 2026-05-26):
--   - Migration head:      20280401000007_ad_placements_authenticated_select.sql
--   - Timestamp series:    20281201000001/02/03 — strictly AFTER head (safe)
--   - rag_chunks.created_by: ABSENT — this migration ADDS the column via ALTER TABLE
--   - research_tips category: NOT present in any migration — first appearance here
--   - Tables (federated_sources, federated_source_cache, newsletter_subscribers,
--     kb_chunk_rejections): ALL NEW — zero prior references in supabase/migrations/
--   - Phase 50 rag_newsletter_subscriptions table EXISTS at 20260519000008 —
--     stores per-user frequency prefs (user_id NOT NULL, frequency, tags_followed).
--     Phase 60 newsletter_subscribers is the OPT-IN ROSTER (email as natural key,
--     user_id nullable for guest marketing-form subscribers, unsubscribe_token for
--     RFC 8058 1-click). BOTH tables coexist; Phase 60 newsletter sender reads
--     newsletter_subscribers WHERE opted_in=true.
--
-- Tables created here:
--   1. public.federated_sources         — per-source toggle/config (3 rows seeded)
--   2. public.federated_source_cache    — 24h TTL cache keyed by (source_name, cache_key)
--   3. public.newsletter_subscribers    — Phase 60 opt-in roster (RFC 8058 unsubscribe)
--   4. public.kb_chunk_rejections       — insert-only audit log (CONTEXT.md D-rejection-audit)
--
-- Also extends rag_chunks with created_by uuid column (2-person rule requires it).
--
-- Idempotent: all CREATE TABLE / ALTER TABLE / triggers guarded by IF NOT EXISTS or
-- ON CONFLICT DO NOTHING.
--
-- Downstream: 60-07 federated adapters use federated_source_cache ON CONFLICT DO UPDATE;
--             60-12 uses newsletter_subscribers anon SELECT + unsubscribe_token pattern;
--             60-02 RPC migration uses kb_chunk_rejections for audit writes.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Extend rag_chunks: add created_by (2-person rule requires it; per TASK 1 absent)
-- ---------------------------------------------------------------------------
--
-- NOTE: created_by is nullable. Pre-Phase-60 rows already in the table have
-- created_by IS NULL. The approve_rag_chunk RPC (20281201000002) guards:
--   if v_created_by is not null and v_created_by = auth.uid()
-- so pre-Phase-60 NULL rows bypass the 2-person rule (exempt — those were
-- imported before the rule existed). All new chunks ingested in Phase 60+
-- will have created_by populated by the scraper/adapter Edge Fn.

alter table public.rag_chunks
  add column if not exists created_by uuid references auth.users(id);

create index if not exists rag_chunks_created_by_idx
  on public.rag_chunks (created_by);

comment on column public.rag_chunks.created_by is
  'Phase 60: scrape/federated-fetch actor. 2-person rule guard in approve_rag_chunk '
  'requires auth.uid() <> created_by. Pre-Phase-60 rows are NULL — those bypass the '
  'rule per this migration header note (exempt: ingested before the rule existed).';

-- ---------------------------------------------------------------------------
-- 1. public.federated_sources
--    Per-source toggle + config for PubMed / OpenFDA / DailyMed adapters.
--    RAG-06: auto_tier_a=true means federated chunks land source_tier=''A'' but
--    STILL require admin review (PHARMA-02 carveout).
-- ---------------------------------------------------------------------------

create table if not exists public.federated_sources (
  name              text primary key
                      check (name in ('pubmed', 'openfda', 'dailymed')),
  enabled           boolean      not null default false,
  auto_tier_a       boolean      not null default true,
  sync_cron         text         not null default '0 3 * * *',
  last_sync_at      timestamptz,
  last_error        text,
  last_error_at     timestamptz,
  created_at        timestamptz  not null default now(),
  updated_at        timestamptz  not null default now()
);

-- Trigger: keep updated_at in sync (reuse Phase 50 tg_set_updated_at pattern)
do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'trg_federated_sources_updated_at'
  ) then
    create trigger trg_federated_sources_updated_at
      before update on public.federated_sources
      for each row execute function public.tg_set_updated_at();
  end if;
end $$;

-- Seed: 3 canonical sources disabled by default (operator enables via admin toggle)
-- on conflict (name) do nothing — idempotent; re-running migration is a no-op (T-60-01-08)
insert into public.federated_sources (name, enabled, auto_tier_a, sync_cron)
values
  ('pubmed',   false, true, '0 3 * * *'),
  ('openfda',  false, true, '0 3 * * *'),
  ('dailymed', false, true, '0 3 * * *')
on conflict (name) do nothing;

alter table public.federated_sources enable row level security;

-- Staff can read + write (enable/disable sources, inspect last_sync_at / last_error)
create policy federated_sources_staff_all
  on public.federated_sources
  for all
  using (public.is_staff())
  with check (public.is_staff());

comment on table public.federated_sources is
  'Phase 60 (60-01): per-source toggle + config for PubMed/OpenFDA/DailyMed adapters. '
  'auto_tier_a=true → federated chunks land source_tier=A but still need admin review. '
  'No anon access; staff-only RLS. Cron registration deferred to 60-15.';

-- ---------------------------------------------------------------------------
-- 2. public.federated_source_cache
--    24h TTL lookup cache for adapter Edge Fns (60-07).
--    UNIQUE (source_name, cache_key) enables idempotent ON CONFLICT DO UPDATE writes.
--    T-60-01-05 mitigation: UNIQUE constraint prevents stale payload co-existence.
-- ---------------------------------------------------------------------------

create table if not exists public.federated_source_cache (
  id          uuid        primary key default gen_random_uuid(),
  source_name text        not null
                references public.federated_sources(name) on delete cascade,
  cache_key   text        not null,
  payload     jsonb       not null,
  fetched_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  updated_at  timestamptz not null default now(),

  -- ON CONFLICT (source_name, cache_key) DO UPDATE — used by 60-07 adapter Fns
  constraint federated_source_cache_uq unique (source_name, cache_key)
);

-- Index on expires_at for purge queries (now() not allowed in partial index predicate).
create index if not exists federated_source_cache_expired_idx
  on public.federated_source_cache (expires_at)
  where expires_at is not null;

-- Trigger: keep updated_at in sync
do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'trg_federated_source_cache_updated_at'
  ) then
    create trigger trg_federated_source_cache_updated_at
      before update on public.federated_source_cache
      for each row execute function public.tg_set_updated_at();
  end if;
end $$;

alter table public.federated_source_cache enable row level security;

-- Staff can read (for diagnostics); adapter Fns write via service_role (bypasses RLS)
create policy federated_source_cache_staff_read
  on public.federated_source_cache
  for select
  using (public.is_staff());

comment on table public.federated_source_cache is
  'Phase 60 (60-01): 24h TTL cache for federated adapter Fns (60-07). '
  'UNIQUE (source_name, cache_key) — 60-07 Fns upsert via ON CONFLICT DO UPDATE. '
  'Writes go through service_role; staff SELECT for diagnostics. '
  'Nightly purge of expired rows registered in 60-15.';

-- ---------------------------------------------------------------------------
-- 3. public.newsletter_subscribers
--    Phase 60 opt-in roster for RFC 8058 1-click unsubscribe.
--    Distinct from Phase 50 rag_newsletter_subscriptions (per-user freq prefs).
--    T-60-01-06 mitigation: 256-bit unsubscribe_token for token-bearer RLS pattern.
--    RAG-08: default opted_in=false (CAN-SPAM affirmative consent required).
-- ---------------------------------------------------------------------------

create table if not exists public.newsletter_subscribers (
  id                uuid        primary key default gen_random_uuid(),
  user_id           uuid        references auth.users(id) on delete cascade,
  -- user_id nullable: guest subscribers via marketing form have no account
  email             text        not null,
  opted_in          boolean     not null default false,
  unsubscribe_token text        not null
                      default encode(extensions.gen_random_bytes(32), 'base64'),
  -- Note: standard base64 (not base64url). Stored in DB only.
  -- 60-12 Edge Fn does URL-safe encoding at email-render time when embedding
  -- the unsubscribe link. Token stays inside DB + Edge Fn boundary.
  opted_in_at       timestamptz,
  opted_out_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint newsletter_subscribers_email_uq unique (email)
);

-- Trigger: keep updated_at in sync
do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'trg_newsletter_subscribers_updated_at'
  ) then
    create trigger trg_newsletter_subscribers_updated_at
      before update on public.newsletter_subscribers
      for each row execute function public.tg_set_updated_at();
  end if;
end $$;

alter table public.newsletter_subscribers enable row level security;

-- Authenticated user can view their own subscription row
create policy newsletter_subscribers_owner_select
  on public.newsletter_subscribers
  for select
  to authenticated
  using (auth.uid() = user_id);

-- Anon SELECT for RFC 8058 1-click unsubscribe (browser-fetches-stored-token pattern):
-- The 60-12 Edge Fn fetches the row by matching unsubscribe_token = $1 via anon RPC.
-- Combined with the 256-bit unguessable token this enables the pattern without
-- exposing PII to mass-scrape — an attacker would need the token to read the row.
-- Per [[feedback_rls_stored_token_verification_pattern]].
create policy newsletter_subscribers_token_anon_select
  on public.newsletter_subscribers
  for select
  to anon
  using (true);

comment on policy newsletter_subscribers_token_anon_select
  on public.newsletter_subscribers is
  'RFC 8058 1-click unsubscribe: anon SELECT enabled; 60-12 Edge Fn filters by '
  'unsubscribe_token. Token is 256-bit (gen_random_bytes(32)) — unguessable. '
  'Mass-scrape protection: token required to identify row. '
  'See [[feedback_rls_stored_token_verification_pattern]].';

-- Staff oversight: read + write (manage subscription roster, handle GDPR requests)
create policy newsletter_subscribers_staff_all
  on public.newsletter_subscribers
  for all
  using (public.is_staff())
  with check (public.is_staff());

-- Note: INSERT / UPDATE for opt-in/opt-out flows go through service_role from
-- 60-12 sender Edge Fn. No client-side write policy (prevents self-modification).

comment on table public.newsletter_subscribers is
  'Phase 60 (60-01): opt-in roster for weekly Research Newsletter (RAG-08). '
  'Distinct from Phase 50 rag_newsletter_subscriptions (per-user freq prefs). '
  'Both coexist. Phase 60 sender reads newsletter_subscribers WHERE opted_in=true. '
  'CAN-SPAM: default opted_in=false. RFC 8058: unsubscribe_token for 1-click. '
  '60-12 Edge Fn owns subscribe/unsubscribe writes via service_role.';

-- ---------------------------------------------------------------------------
-- 4. public.kb_chunk_rejections
--    Insert-only audit log for rejected rag_chunks (CONTEXT.md D-rejection-audit).
--    T-60-01-03 disposition: accept (RLS denies UPDATE/DELETE to authenticated).
--    Columns: (chunk_id, reason, notes, actor_id, at)
-- ---------------------------------------------------------------------------

create table if not exists public.kb_chunk_rejections (
  id       uuid                    primary key default gen_random_uuid(),
  chunk_id uuid                    not null
               references public.rag_chunks(id) on delete cascade,
  reason   public.rag_reject_reason not null,
  notes    text,
  actor_id uuid                    not null references auth.users(id),
  at       timestamptz             not null default now()
);

-- Index for 30-day rolling rejection count per chunk (D-16 trust-downgrade signal)
create index if not exists kb_chunk_rejections_chunk_id_idx
  on public.kb_chunk_rejections (chunk_id);

-- Index for chronological listing in /admin/rag/sources review panel
create index if not exists kb_chunk_rejections_at_idx
  on public.kb_chunk_rejections (at desc);

alter table public.kb_chunk_rejections enable row level security;

-- Staff can SELECT the audit log
create policy kb_chunk_rejections_staff_select
  on public.kb_chunk_rejections
  for select
  using (public.is_staff());

-- Staff INSERT: actor_id MUST match caller (prevents forging audit entries)
create policy kb_chunk_rejections_staff_insert
  on public.kb_chunk_rejections
  for insert
  with check (public.is_staff() and auth.uid() = actor_id);

-- NO UPDATE / DELETE policy for authenticated — insert-only audit log.
-- Only service_role can delete (out-of-scope GDPR purge — T-60-01-03 accept).

comment on table public.kb_chunk_rejections is
  'Phase 60 (60-01): insert-only audit log for rejected rag_chunks. '
  'Written by reject_rag_chunk RPC (20281201000002). No authenticated UPDATE/DELETE. '
  'actor_id = auth.uid() enforced by INSERT policy. D-rejection-audit per CONTEXT.md.';

-- end migration 20281201000001
