-- Phase 60 Plan 60-13 — Extend rag_chunks for public /knowledge hub
-- ============================================================================
--
-- 60-01 plan notes: "Phase 60 60-01 adds this column if not present —
-- assume present; reuse else add via 60-01 migration extension". Since
-- 60-01 did not add these, this migration adds them as a 60-13 extension.
--
-- Columns added:
--   1. title text — human-readable title for hub display (H1, JSON-LD headline)
--   2. slug text — URL-safe identifier for /knowledge/<topic>/<slug> routing
--   3. public_visibility boolean — controls sitemap inclusion + noindex meta
--
-- The slug UNIQUE constraint is per (topic_tag, slug) — the same slug value
-- may appear under different topics (e.g. each topic can have its own
-- 'overview' article). This matches the URL scheme /knowledge/<topic>/<slug>.
--
-- public_visibility defaults to TRUE so existing published chunks are
-- indexable by default. Admins set to FALSE to suppress from sitemap + add
-- noindex meta without retracting the chunk.
--
-- Idempotent: all ALTER TABLE steps guarded by column-existence check or
-- IF NOT EXISTS.

-- ---------------------------------------------------------------------------
-- 1. title column (display title for hub, JSON-LD headline)
-- ---------------------------------------------------------------------------

alter table public.rag_chunks
  add column if not exists title text;

comment on column public.rag_chunks.title is
  'Phase 60-13: human-readable display title for the public /knowledge hub. '
  'Used as JSON-LD headline, og:title, and H1. Null = fall back to first '
  'line of summary. Populated by admin review queue UI (60-08) or scraper.';

-- ---------------------------------------------------------------------------
-- 2. slug column (URL-safe, unique per topic_tag)
-- ---------------------------------------------------------------------------

alter table public.rag_chunks
  add column if not exists slug text;

-- Unique per topic_tag — same slug OK across different topics.
create unique index if not exists rag_chunks_topic_slug_unique
  on public.rag_chunks (topic_tag, slug)
  where slug is not null;

comment on column public.rag_chunks.slug is
  'Phase 60-13: URL-safe slug for /knowledge/<topic_tag>/<slug> routing. '
  'Format: ^[a-z0-9-]+$, max 128 chars. RESERVED values blocked by API '
  'layer (RESERVED_SLUGS in src/lib/knowledge/topics.ts). Unique per '
  'topic_tag. Backfill from lower(regexp_replace(title, ''[^a-z0-9]+'', ''-'', ''g'')) '
  'when title is set. Null chunks are excluded from sitemap + /knowledge routing.';

-- Backfill slug from title for any existing rows that have a title
-- (defensive — currently no rows should have title set without slug)
update public.rag_chunks
  set slug = lower(regexp_replace(
    coalesce(title, summary),
    '[^a-z0-9]+', '-', 'g'
  ))
  where slug is null
    and (title is not null or summary is not null)
    and status = 'published';

-- ---------------------------------------------------------------------------
-- 3. public_visibility column
-- ---------------------------------------------------------------------------

alter table public.rag_chunks
  add column if not exists public_visibility boolean not null default true;

comment on column public.rag_chunks.public_visibility is
  'Phase 60-13: when TRUE, chunk is included in public sitemap.xml and detail '
  'page does NOT emit noindex meta. When FALSE, sitemap excludes this chunk '
  'and detail page adds <meta name=robots content=noindex,nofollow>. '
  'RLS anon SELECT policy enforces status=published AND retracted_at IS NULL '
  'AND public_visibility=true (T-60-13-INFO-1 mitigation layer 3).';

-- Index for sitemap query + hub API (status=published + visibility filter)
create index if not exists rag_chunks_public_hub_idx
  on public.rag_chunks (topic_tag, status, public_visibility, published_at desc)
  where status = 'published' and retracted_at is null and public_visibility = true;

-- ---------------------------------------------------------------------------
-- RLS: extend anon SELECT to include public_visibility=true check
-- ---------------------------------------------------------------------------
-- The existing anon SELECT RLS at 20260519000009_rag_rls_policies.sql
-- should already allow public reads; we add a check here to enforce the
-- public_visibility gate at DB level (T-60-13-INFO-1 layer 3).
-- NOTE: if the existing policy already has a WHERE clause, this helper
-- policy adds an additional layer. If the existing policy is permissive,
-- this CHECK is the enforcement.

-- Drop and recreate the anon-read policy to include public_visibility gate
-- (idempotent: DROP IF EXISTS + CREATE)
drop policy if exists "anon_read_published_chunks" on public.rag_chunks;

create policy "anon_read_published_chunks"
  on public.rag_chunks
  for select
  to anon
  using (
    status = 'published'
    and retracted_at is null
    and public_visibility = true
  );
