-- Phase 50: external_kb_embeddings — separate vector store for admin-curated RAG per D-28/D-29/D-34
--
-- This table is INTENTIONALLY SEPARATE from content_embeddings (Phase 38).
-- Reason: external_kb is non-PHI (no user_id/patient_id/chat_history); separation
-- lets us bulk-purge / re-embed without touching user-owned vectors and lets the
-- retrieval Edge Fn route queries to the appropriate index.
--
-- Schema invariants (D-34): no PHI columns. Carry-along columns are limited to
-- chunk_id, source_id, topic_id, topic_tag, source_tier, freshness_window_days.
--
-- Idempotent.

create extension if not exists vector;

create table if not exists public.external_kb_embeddings (
  id uuid primary key default gen_random_uuid(),
  chunk_id uuid not null references public.rag_chunks(id) on delete cascade,
  embedding vector(1536) not null,
  topic_id uuid not null references public.rag_topics(id),
  source_id uuid not null references public.rag_sources(id),
  source_tier public.rag_source_tier not null,
  topic_tag text not null,
  freshness_window_days int not null,
  embedded_at timestamptz not null default now()
);

-- One embedding per chunk (re-embeds delete + re-insert; or use ON CONFLICT in upsert path)
create unique index if not exists external_kb_embeddings_chunk_uq
  on public.external_kb_embeddings (chunk_id);

-- HNSW index for ANN cosine retrieval per D-28
-- (m=16, ef_construction=64 mirror pgvector defaults / content_embeddings shape)
create index if not exists external_kb_embeddings_hnsw
  on public.external_kb_embeddings
  using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

-- Supporting BTREE for tag + tier filtering before ANN
create index if not exists external_kb_embeddings_tag_tier
  on public.external_kb_embeddings (topic_tag, source_tier);

alter table public.external_kb_embeddings enable row level security;
