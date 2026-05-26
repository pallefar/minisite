-- Phase 60 Plan 60-06 — match_external_kb_embeddings SECURITY INVOKER RPC.
--
-- Provides pgvector ANN retrieval over external_kb_embeddings (HNSW index).
--
-- SECURITY INVOKER: non-PHI table; RLS already excludes retracted/draft per
-- Phase 50 D-34. INVOKER lets RLS continue to enforce visibility on the join.
--
-- requesting_user_id: accepted for future RLS hook but unused at v1.4 (non-PHI
-- table; all approved chunks are accessible to authenticated callers per Phase 50
-- RLS policy). Documented here for Phase 61+ extension.
--
-- Cosine similarity via pgvector <=> distance operator (HNSW-optimized).
-- ORDER BY distance ASC (nearest-first); similarity = 1 - distance.
--
-- Caller (rag-retrieve Edge Fn) applies tier/freshness reweighting in app layer
-- per Phase 50 D-06/D-29/D-32. RPC returns raw cosine similarity only.
--
-- Cost guardrail: LIMIT match_count — caller passes k*4 capped at 20 per
-- AI-SPEC §4 cost table. RPC does NOT enforce the 20-cap; caller does.
--
-- Idempotent: DROP FUNCTION IF EXISTS + CREATE OR REPLACE.

DROP FUNCTION IF EXISTS public.match_external_kb_embeddings(vector, integer, uuid);

CREATE OR REPLACE FUNCTION public.match_external_kb_embeddings(
  query_embedding     vector(1536),
  match_count         integer default 20,
  requesting_user_id  uuid    default null
)
RETURNS TABLE (
  chunk_id              uuid,
  summary               text,
  quote_blocks          jsonb,
  canonical_url         text,
  scraped_at            timestamptz,
  source_tier           text,
  topic_tag             text,
  freshness_window_days integer,
  source_name           text,
  source_domain         text,
  similarity            double precision
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, extensions
AS $$
  SELECT
    e.chunk_id,
    c.summary,
    c.quote_blocks,
    c.canonical_url,
    c.scraped_at,
    e.source_tier::text,
    e.topic_tag,
    e.freshness_window_days,
    s.name         AS source_name,
    s.domain       AS source_domain,
    1.0 - (e.embedding <=> query_embedding) AS similarity
  FROM public.external_kb_embeddings e
  JOIN public.rag_chunks              c ON c.id = e.chunk_id
  JOIN public.rag_sources             s ON s.id = e.source_id
  WHERE c.retracted_at  IS NULL
    AND c.published_at  IS NOT NULL
  ORDER BY e.embedding <=> query_embedding ASC
  LIMIT match_count;
$$;

COMMENT ON FUNCTION public.match_external_kb_embeddings(vector, integer, uuid) IS
'Phase 60-06: pgvector ANN over external_kb_embeddings.
requesting_user_id reserved for future RLS hook (v1.4 unused — non-PHI table).
Caller (rag-retrieve Edge Fn) applies tier + freshness reweight in app layer
per Phase 50 D-06/D-29/D-32. Cosine similarity computed in SELECT; HNSW index
on (embedding vector_cosine_ops) honors ORDER BY <=> distance.
Excludes retracted (retracted_at IS NOT NULL) and un-curated (published_at IS NULL) chunks.';

GRANT EXECUTE ON FUNCTION public.match_external_kb_embeddings(vector, integer, uuid)
  TO authenticated, anon, service_role;
