-- Phase 38 Plan 01 — HNSW vector index on content_embeddings.embedding.
--
-- Parameters (CONTEXT D-15 + RESEARCH §pgvector Pitfall #2):
--   - m = 16              — graph fanout per layer (pgvector default).
--   - ef_construction = 64 — build-time accuracy/speed knob.
--
-- Operator class: vector_cosine_ops (cosine similarity is the right metric
-- for OpenAI embeddings; the model produces normalized vectors so cosine
-- distance and dot product yield identical ordering, but cosine_ops is the
-- canonical choice for clarity).
--
-- Idempotency: `create index if not exists`.

create index if not exists content_embeddings_hnsw_cos
  on public.content_embeddings
  using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

comment on index public.content_embeddings_hnsw_cos is
  'Phase 38 — HNSW index for cosine ANN. Query-time ef_search tuned per-call via SET LOCAL.';
