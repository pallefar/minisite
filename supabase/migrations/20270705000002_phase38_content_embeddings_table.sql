-- Phase 38 Plan 01 — content_embeddings table (RECOMMEND-01).
--
-- Stores OpenAI text-embedding-3-small (1536-dim) embeddings keyed by content_id.
-- See 38-RESEARCH.md §Code Examples for column rationale.
--
-- Trust boundaries:
--   - T-38-02: RLS enabled; super-admin SELECT + service_role bypass.
--   - No direct caller SELECT — consumers go through match_content_embeddings RPC.
--
-- Idempotency:
--   - create table if not exists
--   - alter table ... add column if not exists (defensive for re-application)

-- ----------------------------------------------------------------------------
-- 1. Minimal `public.content` shim (created IF NOT EXISTS to unblock Phase 38).
--    Downstream phases own enrichment (KB articles, blog posts, etc.).
-- ----------------------------------------------------------------------------
create table if not exists public.content (
  id                  uuid primary key default gen_random_uuid(),
  kind                text,
  title               text,
  body_md             text,
  published_at        timestamptz,
  deleted_at          timestamptz,
  visible_to_user_id  uuid references auth.users(id) on delete cascade,
  org_id              uuid,
  updated_at          timestamptz not null default now(),
  created_at          timestamptz not null default now()
);

alter table public.content enable row level security;

-- Permissive baseline policy: authenticated users see non-deleted public rows
-- and any row explicitly visible to them. Service_role bypasses RLS.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'content' and policyname = 'content_select_visible') then
    create policy content_select_visible on public.content
      for select
      to authenticated
      using (
        deleted_at is null
        and (visible_to_user_id is null or visible_to_user_id = auth.uid())
      );
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 2. content_embeddings table
-- ----------------------------------------------------------------------------
create table if not exists public.content_embeddings (
  content_id          uuid primary key references public.content(id) on delete cascade,
  embedding           vector(1536) not null,
  body_sha256         text not null,
  last_embedded_at    timestamptz not null default now(),
  stale               boolean not null default false,
  embedding_model_id  text not null default 'openai/text-embedding-3-small'
);

comment on table public.content_embeddings is
  'Phase 38 — OpenAI text-embedding-3-small vectors per content row. stale=true forces re-embed (set by content_stale_on_update trigger).';

alter table public.content_embeddings enable row level security;

-- ----------------------------------------------------------------------------
-- 3. RLS policies — super-admin SELECT + service_role bypass.
--    No direct authenticated SELECT — recommender callers go through
--    match_content_embeddings RPC (SECURITY INVOKER + requesting_user_id guard).
-- ----------------------------------------------------------------------------
do $$
begin
  -- Super-admin (staff with is_staff = true) can read all rows.
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'content_embeddings' and policyname = 'content_embeddings_super_admin_all') then
    create policy content_embeddings_super_admin_all on public.content_embeddings
      for all
      to authenticated
      using (
        exists (
          select 1 from public.profiles p
          where p.id = auth.uid() and p.is_staff = true
        )
      )
      with check (
        exists (
          select 1 from public.profiles p
          where p.id = auth.uid() and p.is_staff = true
        )
      );
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 4. Supporting indexes (HNSW index is in 20270705000003).
-- ----------------------------------------------------------------------------
create index if not exists content_embeddings_stale_idx
  on public.content_embeddings (stale)
  where stale = true;

create index if not exists content_embeddings_last_embedded_idx
  on public.content_embeddings (last_embedded_at desc);
