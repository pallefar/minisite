---
phase: 60-rag-knowledge-base-completion-waves-2-4
plan: 06
type: execute
wave: 1
depends_on: [60-01, 60-02, 60-03, 60-05]
files_modified:
  - supabase/functions/rag-retrieve/index.ts
  - supabase/functions/rag-retrieve/merge.ts
  - supabase/functions/rag-retrieve/cohere-rerank.ts
  - supabase/functions/rag-retrieve/jina-rerank.ts
  - supabase/functions/rag-retrieve/refusal.ts
  - supabase/functions/rag-retrieve/deno.json
  - supabase/functions/rag-retrieve/__tests__/merge.test.ts
  - supabase/functions/rag-retrieve/__tests__/cohere-rerank.test.ts
  - supabase/functions/rag-retrieve/__tests__/jina-rerank.test.ts
  - supabase/functions/rag-retrieve/__tests__/refusal.test.ts
  - supabase/functions/rag-retrieve/__tests__/integration.test.ts
  - supabase/migrations/20281201000010_match_external_kb_embeddings_fn.sql
  - eval/phase60/dimensions/rerank-delta.ts
  - eval/phase60/dimensions/retrieval-recall.ts
autonomous: true
requirements: [RAG-04, RAG-05]
tags: [rag, retrieval, rerank, cohere, jina, edge-function]
user_setup:
  - service: cohere
    why: "Cross-encoder rerank v3.5 — biomedical precision primary path per AI-SPEC §2 Soft Lock-In"
    env_vars:
      - name: COHERE_API_KEY
        source: "Cohere Dashboard → API Keys → Production key"
        set_via: "supabase secrets set COHERE_API_KEY=<key> --project-ref <ref>"
  - service: jina
    why: "Reranker v2 fallback (env-flag swap; required at MVP to keep Soft Lock-In contract)"
    env_vars:
      - name: JINA_API_KEY
        source: "Jina AI Dashboard → API Keys"
        set_via: "supabase secrets set JINA_API_KEY=<key> --project-ref <ref>"
  - service: provider-switch
    why: "Env-flag selects primary reranker per AI-SPEC §2"
    env_vars:
      - name: RAG_RERANKER_PROVIDER
        source: "Set to 'cohere' (default) or 'jina'; absence treated as 'cohere'"
        set_via: "supabase secrets set RAG_RERANKER_PROVIDER=cohere --project-ref <ref>"

must_haves:
  truths:
    - "`rag-retrieve` Edge Fn accepts POST {query, k?=3, filters?:{topic_tag?, source_tier?[]}} and returns {results: top-3, count, rerank_provider, rerank_degraded?, refusal?}"
    - "Out-of-corpus refusal fires BEFORE LLM/rerank cost when max(cosine) < 0.65 (AI-SPEC §3 G3 + §6 G3)"
    - "Post-rerank relevance refusal fires when max(rerank_score) < 0.5 (AI-SPEC §6 G4)"
    - "Cohere Rerank v3.5 is the primary path when RAG_RERANKER_PROVIDER=cohere (or unset); Jina Reranker v2 fires when RAG_RERANKER_PROVIDER=jina (AI-SPEC §2)"
    - "Top-N=20 rerank cap enforced — over-fetch cosine top-(k*4) capped at 20 documents fed to reranker, cost guardrail ≤$0.002/query (AI-SPEC §4 cost table)"
    - "Tier reweight: A × 1.2, B × 1.0, C × 0.85 applied to raw cosine BEFORE rerank stage selects candidates (Phase 50 D-06 + D-29)"
    - "Freshness de-rank: chunks where (now − scraped_at) > freshness_window_days get raw_score × 0.5 + stale=true flag (Phase 50 D-32)"
    - "Retracted chunks excluded via WHERE c.retracted_at IS NULL (defense-in-depth alongside RLS)"
    - "Eval suite `--suite=rerank-delta` computes precision@5 + recall@5 + MRR for (raw cosine top-5) vs (rerank top-5) on the 40-example gold-set; gate fails build when delta < +0.10 absolute on precision@5 (AI-SPEC §5 Dim #4 + success criterion #3)"
    - "Eval suite `--suite=retrieval` computes recall@5 ≥ 0.80, recall@10 ≥ 0.92, MRR ≥ 0.65 (AI-SPEC §5 Dim #2 + #3)"
    - "Every Cohere/Jina call emits $ai_generation PostHog event with usage_total_cost via 60-02 posthog-rag-events helper"
    - "Every refusal emits rag_refusal_emitted with refusal_reason ∈ {'out_of_corpus', 'post_rerank_low_relevance'}"
    - "All API keys (COHERE_API_KEY, JINA_API_KEY) read from Deno.env.get() at request time — never logged, never echoed in responses"
    - "`Deno.serve()` guarded by `if (import.meta.main)` per [[reference_deno_test_top_level_serve_trap]] so deno test does not bind ports"
    - "Per-fn `deno.json` ships explicit npm: imports per [[reference_supabase_functions_deploy_import_map_flag]] (CLI v2.101.0+ ignores --import-map)"
  artifacts:
    - path: "supabase/functions/rag-retrieve/index.ts"
      provides: "Edge Fn entry: embed query → pgvector ANN via match_external_kb_embeddings RPC → tier/freshness reweight → top-N=20 cap → rerank (env-flag) → top-3 + refusal gates"
      contains: "Deno.serve handler under import.meta.main; POST {query, k, filters}; SSE-free JSON response"
    - path: "supabase/functions/rag-retrieve/merge.ts"
      provides: "Pure functions: applyTierBoost, isStale, applyFreshnessDeRank, rankAndTrim — REUSED VERBATIM from 50-07 Task 3 contract (tier weights A=1.2/B=1.0/C=0.85; stale=true when (now−scraped_at)>freshness_window_days; raw × 0.5 when stale)"
    - path: "supabase/functions/rag-retrieve/cohere-rerank.ts"
      provides: "CohereRerankClient class — wraps npm:cohere-ai@^7 CohereClient.rerank({model:'rerank-v3.5', topN, returnDocuments:false}); 3-attempt expo backoff on 5xx/429; sub-200ms p50; emits $ai_generation with action='rerank_cohere'"
    - path: "supabase/functions/rag-retrieve/jina-rerank.ts"
      provides: "JinaRerankClient class — REST POST https://api.jina.ai/v1/rerank model='jina-reranker-v2-base-multilingual'; same return shape as Cohere wrapper; 3-attempt expo backoff; emits $ai_generation with action='rerank_jina'"
    - path: "supabase/functions/rag-retrieve/refusal.ts"
      provides: "Refusal builders — outOfCorpusRefusal(maxCosine) returns {refused:true, refusal_reason:'out_of_corpus', results:[]}; postRerankRefusal(maxScore) returns {refused:true, refusal_reason:'post_rerank_low_relevance', results:[]}; emits rag_refusal_emitted via 60-02 posthog helper"
    - path: "supabase/functions/rag-retrieve/deno.json"
      provides: "Per-fn import map: ai, @ai-sdk/openai, cohere-ai, zod, @supabase/supabase-js — explicit npm: pins (CLI v2.101.0+ ignores --import-map per [[reference_supabase_functions_deploy_import_map_flag]])"
    - path: "supabase/migrations/20281201000010_match_external_kb_embeddings_fn.sql"
      provides: "SECURITY INVOKER RPC match_external_kb_embeddings(query_embedding vector(1536), match_count int, requesting_user_id uuid default null) returning chunk metadata + (1 - (embedding <=> query_embedding)) as similarity; ORDER BY embedding <=> query_embedding LIMIT match_count; uses HNSW index; excludes c.retracted_at NOT NULL"
    - path: "eval/phase60/dimensions/rerank-delta.ts"
      provides: "Suite implementation for `--suite=rerank-delta`: replays gold-set through raw-cosine-only vs rerank pipelines; computes precision@5 / recall@5 / MRR for each; asserts rerank precision@5 − cosine precision@5 ≥ +0.10; bootstrap 95% CI"
    - path: "eval/phase60/dimensions/retrieval-recall.ts"
      provides: "Suite implementation for `--suite=retrieval`: computes recall@5, recall@10, MRR vs gold-set labeled relevant_chunk_ids; per topic_tag + per source_tier breakdown"
  key_links:
    - from: "supabase/functions/rag-retrieve/index.ts"
      to: "match_external_kb_embeddings RPC (migration 20281201000010)"
      via: "supabase.rpc('match_external_kb_embeddings', {query_embedding, match_count: k*4})"
      pattern: "supabase\\.rpc\\('match_external_kb_embeddings'"
    - from: "supabase/functions/rag-retrieve/index.ts"
      to: "RAG_RERANKER_PROVIDER env-flag branch"
      via: "Deno.env.get('RAG_RERANKER_PROVIDER') === 'jina' ? jinaClient : cohereClient"
      pattern: "RAG_RERANKER_PROVIDER"
    - from: "supabase/functions/rag-retrieve/cohere-rerank.ts"
      to: "60-02 posthog-rag-events.ts emitAiGeneration"
      via: "import from ../_shared/posthog-rag-events.ts"
      pattern: "emitAiGeneration.*rerank_cohere"
    - from: "supabase/functions/rag-retrieve/refusal.ts"
      to: "60-02 posthog-rag-events.ts emitRagRefusal"
      via: "import from ../_shared/posthog-rag-events.ts"
      pattern: "rag_refusal_emitted"
    - from: "eval/phase60/dimensions/rerank-delta.ts"
      to: "eval/phase60/gold-set.jsonl (60-03 fixture)"
      via: "fs read + JSON.parse per line"
      pattern: "gold-set\\.jsonl"
    - from: "60-10 src/lib/rag/retrieve-client.ts (downstream)"
      to: "supabase.functions.invoke('rag-retrieve', {body})"
      via: "Wave 2 AI-coach citation UI consumes top-3 from this Fn"
      pattern: "functions\\.invoke\\('rag-retrieve'"
---

<objective>
Ship the retrieval + rerank Edge Function for the citation-grounded RAG pipeline. Embeds query (OpenAI via 60-05 wrapper) → pgvector ANN over `external_kb_embeddings` (HNSW, k×4 over-fetch capped at 20) → tier + freshness reweight (Phase 50 D-06 + D-32 carried forward verbatim) → out-of-corpus refusal when max(cosine) < 0.65 (saves all downstream cost) → env-flag-selected cross-encoder rerank (Cohere Rerank v3.5 primary / Jina Reranker v2 fallback per AI-SPEC §2 Soft Lock-In) → post-rerank refusal when max(score) < 0.5 → returns top-3 to caller.

Foundation for Wave 2 (60-10 AI-coach citation UI), Wave 2 (60-11 tip-of-day generator), Wave 3 (60-12 newsletter generator). Eval suite `--suite=rerank-delta` enforces ≥+0.10 absolute precision@5 lift over raw cosine per AI-SPEC §5 Dim #4 + success criterion #3.

Purpose: without this Fn, the entire RAG synthesis path is dead. Without the rerank-delta evaluation gate, we cannot verify that the Cohere/Jina cost is paying its way (the alternative is a clean swap to raw cosine retrieval). Without the env-flag, we have lock-in on a single vendor.

Output: 1 Edge Fn (5 source files + deno.json) + 1 SECURITY INVOKER RPC migration + 5 vitest/Deno test suites + 2 eval-dimension implementations.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-CONTEXT.md
@.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-AI-SPEC.md
@.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-PLAN-OUTLINE.md
@.planning/phases/50-admin-curated-rag-knowledge-base-peptide-topic-research-scra/50-07-PLAN.md
@supabase/migrations/20260519000004_external_kb_embeddings_table.sql

<interfaces>
<!-- Contracts the executor must use directly. Do NOT explore the codebase for these. -->

From 60-01 migration `20281201000001_phase60_kb_tables.sql` (Wave 0 already landed):
```sql
-- Phase 50 schema reused verbatim — these columns are stable on rag_chunks + external_kb_embeddings:
-- rag_chunks: id uuid PK, summary text, quote_blocks jsonb, source_text_excerpt text,
--   topic_id uuid, source_id uuid, source_tier text CHECK IN ('A','B','C'), topic_tag text,
--   scraped_at timestamptz, published_at timestamptz, retracted_at timestamptz
-- external_kb_embeddings: chunk_id uuid PK FK→rag_chunks(id), embedding vector(1536),
--   topic_id uuid, source_id uuid, source_tier text, topic_tag text,
--   freshness_window_days int (denormalized from rag_sources for read-path speed)
-- rag_sources: id uuid PK, name text, domain text, freshness_window_days int
-- HNSW index: CREATE INDEX external_kb_embeddings_embedding_hnsw_idx ON external_kb_embeddings
--   USING hnsw (embedding vector_cosine_ops); — already shipped Phase 50 Wave 1
```

From 60-02 shared helpers (Wave 0 already landed):
```typescript
// supabase/functions/_shared/posthog-rag-events.ts
export interface AiGenerationEvent {
  trace_id: string;
  action: 'rerank_cohere' | 'rerank_jina' | 'embed_query' | /* ... */;
  model: string;
  prompt_tokens?: number;
  completion_tokens?: number;
  usage_total_cost: number;
  latency_ms: number;
  error?: string;
}
export function emitAiGeneration(event: AiGenerationEvent): Promise<void>;

export interface RagRefusalEvent {
  trace_id: string;
  refusal_reason: 'out_of_corpus' | 'post_rerank_low_relevance' | 'pharma_02_carveout' | 'safety';
  max_cosine?: number;
  max_rerank_score?: number;
  topic_tag?: string;
}
export function emitRagRefusal(event: RagRefusalEvent): Promise<void>;
```

From 60-05 OpenAI embed wrapper (Wave 1 dependency — declared in depends_on):
```typescript
// supabase/functions/rag-embed-approved/openai.ts (exported for reuse)
export class OpenAIEmbedClient {
  constructor(gatewayToken: string);
  embedBatch(texts: string[]): Promise<{ embeddings: number[][]; totalTokens: number }>;
  healthCheck(): Promise<{ ok: boolean; reason?: string }>;
}
```
**60-06 imports this client** (single-text mode: `embedBatch([query])`) — DO NOT instantiate a parallel OpenAI client in this Fn. Reuses Vercel AI Gateway routing + cost-tracking + failover decisions made in 60-05.

From 60-03 gold-set fixture (Wave 0 already landed):
```jsonl
// eval/phase60/gold-set.jsonl — one example per line:
// { "id":"q-001", "query":"...", "topic_tag":"glp1_titration",
//   "relevant_chunk_ids":["uuid-1","uuid-2"], "user_context":null,
//   "expected_refusal":null }
```

From 60-03 harness entry point (Wave 0 already landed):
```typescript
// eval/phase60/run.ts — CLI dispatcher:
//   --suite=rerank-delta  → dynamically imports eval/phase60/dimensions/rerank-delta.ts
//   --suite=retrieval     → dynamically imports eval/phase60/dimensions/retrieval-recall.ts
// Each dimension module exports default async function run(args): Promise<{ pass: boolean; metrics: Record<string, number>; failures: string[] }>
```

From Vercel AI SDK + Cohere TS SDK (per AI-SPEC §3):
```typescript
// npm:cohere-ai@^7
import { CohereClient } from 'cohere-ai';
const cohere = new CohereClient({ token: Deno.env.get('COHERE_API_KEY')! });
const resp = await cohere.rerank({
  model: 'rerank-v3.5',
  query: 'user query',
  documents: ['doc1 text', 'doc2 text', ...],  // string[] OR { text: string }[]
  topN: 3,
  returnDocuments: false,  // we already have the docs; return indexes + scores only
});
// resp.results: Array<{ index: number; relevanceScore: number }>
```

Jina Reranker v2 REST contract (per https://api.jina.ai/v1/rerank):
```typescript
// POST https://api.jina.ai/v1/rerank
// Headers: Authorization: Bearer <JINA_API_KEY>, Content-Type: application/json
// Body: { model: 'jina-reranker-v2-base-multilingual', query: string, documents: string[], top_n: number, return_documents: false }
// Response: { results: Array<{ index: number; relevance_score: number }>, usage: { total_tokens: number } }
```
</interfaces>

<reuse_targets>
**Direct reuse from 50-07 Tasks 3-4** (per [[feedback_planner_prompt_explicit_reuse_targets]]):

1. **`supabase/functions/rag-retrieve/merge.ts`** — REUSE Task 3 signature contract VERBATIM:
   - `applyTierBoost(score: number, tier: 'A'|'B'|'C'): number` — A: ×1.2, B: ×1.0, C: ×0.85
   - `isStale(scrapedAt: string, freshnessWindowDays: number): boolean` — `(Date.now() − new Date(scrapedAt).getTime()) / 86_400_000 > freshnessWindowDays`
   - `applyFreshnessDeRank(score: number, scrapedAt: string, freshnessWindowDays: number): number` — stale: ×0.5; else unchanged
   - `rankAndTrim(results: Array<{...}>, k: number): Array<typeof results[number] & { final_score: number; stale: boolean }>`

2. **`supabase/functions/rag-retrieve/index.ts` retrieval SELECT** — REUSE Task 4 SELECT contract:
   - `SELECT e.chunk_id, c.summary, c.quote_blocks, c.canonical_url, c.scraped_at, e.source_tier, e.topic_tag, e.freshness_window_days, s.name AS source_name, s.domain AS source_domain, 1 − (e.embedding <=> $1::vector) AS raw_score FROM public.external_kb_embeddings e JOIN public.rag_chunks c ON c.id = e.chunk_id JOIN public.rag_sources s ON s.id = e.source_id WHERE c.retracted_at IS NULL AND ($2::text IS NULL OR e.topic_tag = $2) AND ($3::text[] IS NULL OR e.source_tier = ANY($3)) ORDER BY e.embedding <=> $1::vector LIMIT LEAST($4::int * 4, 20);`
   - Bind order: queryEmbedding, topic_tag_or_null, source_tier_array_or_null, k.
   - NEW vs 50-07: `LIMIT LEAST($4::int * 4, 20)` — caps Cohere/Jina input at 20 docs (cost guardrail $0.002/query envelope per AI-SPEC §4 cost table).

**NEW extensions (no 50-07 precedent — author fresh per AI-SPEC §2/§3/§5):**

3. **Cohere Rerank v3.5 wrapper** — `cohere-rerank.ts`. AI-SPEC §3 entry-point pattern.
4. **Jina Reranker v2 fallback** — `jina-rerank.ts`. AI-SPEC §2 Soft Lock-In contract.
5. **Env-flag switch** — `RAG_RERANKER_PROVIDER` env-var branch in `index.ts`. Default `cohere`.
6. **Refusal gates** — `refusal.ts`. AI-SPEC §6 G3 (max cosine < 0.65) + G4 (max rerank < 0.5).
7. **Rerank-delta eval** — `eval/phase60/dimensions/rerank-delta.ts`. AI-SPEC §5 Dim #4 success criterion #3.
8. **Retrieval-recall eval** — `eval/phase60/dimensions/retrieval-recall.ts`. AI-SPEC §5 Dim #2 + #3.
</reuse_targets>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Write match_external_kb_embeddings SECURITY INVOKER RPC migration</name>
  <files>supabase/migrations/20281201000010_match_external_kb_embeddings_fn.sql</files>
  <read_first>supabase/migrations/20260519000004_external_kb_embeddings_table.sql, supabase/migrations/20270705000004_phase38_match_content_embeddings_fn.sql</read_first>
  <behavior>
    - Function `public.match_external_kb_embeddings(query_embedding vector(1536), match_count integer default 20, requesting_user_id uuid default null)` exists
    - Returns columns: chunk_id uuid, summary text, quote_blocks jsonb, canonical_url text, scraped_at timestamptz, source_tier text, topic_tag text, freshness_window_days int, source_name text, source_domain text, similarity float8
    - Excludes chunks WHERE c.retracted_at IS NOT NULL
    - Excludes chunks WHERE c.published_at IS NULL (un-curated drafts never returned)
    - ORDER BY e.embedding <=> query_embedding ASC (cosine distance — HNSW-optimized)
    - similarity computed as `1 - (e.embedding <=> query_embedding)`
    - LIMIT match_count (caller caps at k*4, hard ceiling 20 enforced at Edge Fn layer)
    - SECURITY INVOKER (NOT SECURITY DEFINER) — non-PHI table; RLS already excludes retracted/draft per Phase 50 D-34
    - requesting_user_id param accepted for future RLS hook but unused at v1.4 (documented in function comment)
    - Idempotent: DROP FUNCTION IF EXISTS at top
  </behavior>
  <action>
    Author `supabase/migrations/20281201000010_match_external_kb_embeddings_fn.sql`:
    - `DROP FUNCTION IF EXISTS public.match_external_kb_embeddings(vector, integer, uuid);`
    - `CREATE OR REPLACE FUNCTION public.match_external_kb_embeddings(query_embedding vector(1536), match_count integer default 20, requesting_user_id uuid default null)`
    - `RETURNS TABLE (chunk_id uuid, summary text, quote_blocks jsonb, canonical_url text, scraped_at timestamptz, source_tier text, topic_tag text, freshness_window_days integer, source_name text, source_domain text, similarity double precision)`
    - `LANGUAGE sql STABLE SECURITY INVOKER`
    - `AS $$ SELECT e.chunk_id, c.summary, c.quote_blocks, c.canonical_url, c.scraped_at, e.source_tier, e.topic_tag, e.freshness_window_days, s.name, s.domain, 1 - (e.embedding <=> query_embedding) FROM public.external_kb_embeddings e JOIN public.rag_chunks c ON c.id = e.chunk_id JOIN public.rag_sources s ON s.id = e.source_id WHERE c.retracted_at IS NULL AND c.published_at IS NOT NULL ORDER BY e.embedding <=> query_embedding LIMIT match_count; $$;`
    - `COMMENT ON FUNCTION public.match_external_kb_embeddings IS 'Phase 60: pgvector ANN over external_kb_embeddings. requesting_user_id reserved for future RLS hook (v1.4 unused — non-PHI table). Caller (rag-retrieve Edge Fn) applies tier + freshness reweight in app layer per Phase 50 D-06/D-29/D-32. Cosine similarity computed in select; HNSW index honors embedding <=> query_embedding distance.';`
    - `GRANT EXECUTE ON FUNCTION public.match_external_kb_embeddings(vector, integer, uuid) TO authenticated, anon, service_role;`
    - Verify via `supabase db push --linked --dry-run` shows new function in plan output.
    Note: this migration ships in Wave 1 but `supabase db push` is DEFERRED to 60-15 per [[feedback_fn_deploy_before_cron_db_push]] phase-close-out ordering. Wave 1 tests run against `supabase db reset` local stack.
  </action>
  <verify>
    <automated>bash -c "cd /Users/karstenhaldan/minisite && supabase db reset --linked=false 2>&1 | tail -5 && psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c \"SELECT pg_get_function_identity_arguments(oid) FROM pg_proc WHERE proname='match_external_kb_embeddings';\" | grep -q 'query_embedding vector,'</automated>
  </verify>
  <done>
    - Migration file exists; `supabase db reset` applies it cleanly.
    - Function signature `match_external_kb_embeddings(query_embedding vector, match_count integer, requesting_user_id uuid)` returns expected column shape.
    - SECURITY INVOKER (verifiable via `\df+ public.match_external_kb_embeddings` → "Security: invoker").
    - Excludes retracted + unpublished chunks.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Author per-fn deno.json import map</name>
  <files>supabase/functions/rag-retrieve/deno.json</files>
  <read_first>supabase/functions/rag-scrape-runner/deno.json</read_first>
  <behavior>
    - `deno.json` exists at `supabase/functions/rag-retrieve/deno.json`
    - `imports` block pins: ai@^4, @ai-sdk/openai@^1, cohere-ai@^7, zod@^3, @supabase/supabase-js@2
    - `tasks` block has `test: "deno test --no-check --allow-env --allow-net ."`
    - `lint.rules.tags: ["recommended"]`
    - `deno check` passes on this file (valid JSON)
  </behavior>
  <action>
    Author `supabase/functions/rag-retrieve/deno.json`:
    ```json
    {
      "tasks": {
        "test": "deno test --no-check --allow-env --allow-net ."
      },
      "imports": {
        "ai": "npm:ai@^4",
        "@ai-sdk/openai": "npm:@ai-sdk/openai@^1",
        "cohere-ai": "npm:cohere-ai@^7",
        "zod": "npm:zod@^3",
        "@supabase/supabase-js": "npm:@supabase/supabase-js@2"
      },
      "lint": { "rules": { "tags": ["recommended"] } }
    }
    ```
    Per [[reference_supabase_functions_deploy_import_map_flag]]: CLI v2.101.0+ ignores `--import-map`. Every new Phase 60 Fn ships its own deno.json with explicit imports. 60-15 phase close-out `supabase functions deploy rag-retrieve --project-ref <ref>` reads this file automatically — no flags needed.
  </action>
  <verify>
    <automated>bash -c "cd /Users/karstenhaldan/minisite && cat supabase/functions/rag-retrieve/deno.json | python3 -c 'import json,sys; d=json.load(sys.stdin); assert \"cohere-ai\" in d[\"imports\"]; assert \"npm:ai@\" in d[\"imports\"][\"ai\"]; print(\"OK\")'"</automated>
  </verify>
  <done>
    - File exists; valid JSON; contains the 5 required npm: pins; `tasks.test` includes --no-check + --allow-env + --allow-net.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Write merge.ts (REUSE 50-07 Task 3 contract verbatim)</name>
  <files>supabase/functions/rag-retrieve/merge.ts, supabase/functions/rag-retrieve/__tests__/merge.test.ts</files>
  <read_first>.planning/phases/50-admin-curated-rag-knowledge-base-peptide-topic-research-scra/50-07-PLAN.md (Task 3)</read_first>
  <behavior>
    - `applyTierBoost(0.5, 'A')` returns `0.6` (× 1.2)
    - `applyTierBoost(0.5, 'B')` returns `0.5` (× 1.0)
    - `applyTierBoost(0.5, 'C')` returns `0.425` (× 0.85)
    - `isStale(now, 180)` returns `false`
    - `isStale(date 365 days ago, 180)` returns `true`
    - `applyFreshnessDeRank(0.8, stale_date, 180)` returns `0.4` (× 0.5)
    - `applyFreshnessDeRank(0.8, today, 180)` returns `0.8` (unchanged)
    - `rankAndTrim([{ raw_score, source_tier, scraped_at, freshness_window_days, ... }], k=3)` returns 3 items sorted by `final_score` DESC with `stale` boolean per item
    - Combined behavior: Tier-A chunk scraped 400 days ago with freshness_window_days=180 → final_score = raw × 1.2 × 0.5 = raw × 0.6, stale=true
  </behavior>
  <action>
    Author `supabase/functions/rag-retrieve/merge.ts` per 50-07 Task 3 signatures (REUSE VERBATIM — preserves Phase 50 D-06 + D-29 + D-32 contracts):
    - `export function applyTierBoost(score: number, tier: 'A'|'B'|'C'): number` — switch on tier, return score × {1.2, 1.0, 0.85}.
    - `export function isStale(scrapedAt: string, freshnessWindowDays: number): boolean` — `(Date.now() − new Date(scrapedAt).getTime()) / 86_400_000 > freshnessWindowDays`.
    - `export function applyFreshnessDeRank(score: number, scrapedAt: string, freshnessWindowDays: number): number` — `isStale(...) ? score * 0.5 : score`.
    - `export function rankAndTrim<T extends { raw_score: number; source_tier: 'A'|'B'|'C'; scraped_at: string; freshness_window_days: number }>(results: T[], k: number): Array<T & { final_score: number; stale: boolean }>` — for each row: compute `boosted = applyTierBoost(raw_score, source_tier)`, `derranked = applyFreshnessDeRank(boosted, scraped_at, freshness_window_days)`, `stale = isStale(scraped_at, freshness_window_days)`; sort by final_score DESC; slice 0..k.

    Author `__tests__/merge.test.ts` with the 8 cases from `<behavior>` above using `Deno.test`. Use static dates relative to a frozen `Date.now()` mock (or compute via `Date.now() - 400 * 86_400_000`). All numeric assertions use `Math.abs(a - b) < 1e-9` to avoid float-equality false negatives.
  </action>
  <verify>
    <automated>bash -c "cd /Users/karstenhaldan/minisite && $HOME/.deno/bin/deno test --no-check --allow-env supabase/functions/rag-retrieve/__tests__/merge.test.ts"</automated>
  </verify>
  <done>
    - All 8+ test cases pass.
    - Pure functions (no I/O, no Date.now() side-effect outside isStale's documented closure on now).
    - Tier weights match D-06: A=1.2, B=1.0, C=0.85.
    - Stale × 0.5 matches D-32.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 4: Write cohere-rerank.ts (Cohere Rerank v3.5 client)</name>
  <files>supabase/functions/rag-retrieve/cohere-rerank.ts, supabase/functions/rag-retrieve/__tests__/cohere-rerank.test.ts</files>
  <read_first>supabase/functions/rag-retrieve/deno.json, .planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-AI-SPEC.md (§3 entry-point + §4 cost table)</read_first>
  <behavior>
    - `new CohereRerankClient(apiKey).rerank({ query, documents, topN })` returns `{ results: Array<{ index: number; score: number }>; tokensUsed: number; latencyMs: number }`
    - Calls `npm:cohere-ai` `CohereClient.rerank({ model: 'rerank-v3.5', query, documents, topN, returnDocuments: false })`
    - Throws RerankError on input validation failure: documents.length === 0 or documents.length > 20 (cost guardrail)
    - 3-attempt exponential backoff (1s/3s/9s) on 5xx + 429 — succeeds on 2nd attempt in test mock
    - `healthCheck()` runs a 2-doc dummy rerank to validate API key + connectivity
    - Per-call cost computed as `0.002` USD flat (Cohere bills $2/1K searches; 1 call = 1 search regardless of doc count up to 1000 — confirm in cohere-rerank.ts comment)
    - On success, the caller's expected pattern is to call `emitAiGeneration({ action: 'rerank_cohere', usage_total_cost: 0.002, latency_ms, model: 'rerank-v3.5', ... })` — but the CLIENT itself does NOT emit (separation of concerns: client returns latency + cost-data; index.ts emits)
  </behavior>
  <action>
    Author `supabase/functions/rag-retrieve/cohere-rerank.ts`:
    - `import { CohereClient } from 'cohere-ai';`
    - `export class RerankError extends Error { constructor(public code: 'empty_docs' | 'too_many_docs' | 'api_error' | 'timeout', message: string) { super(message); } }`
    - `export interface RerankInput { query: string; documents: string[]; topN: number; }`
    - `export interface RerankResult { results: Array<{ index: number; score: number }>; tokensUsed: number; latencyMs: number; costUsd: number; model: string; }`
    - `export class CohereRerankClient { constructor(private apiKey: string) { ... } }`
    - Method `rerank(input: RerankInput): Promise<RerankResult>`:
      - Validate: `if (input.documents.length === 0) throw new RerankError('empty_docs', ...)`
      - Validate: `if (input.documents.length > 20) throw new RerankError('too_many_docs', 'Cost guardrail: max 20 docs per rerank call (≤$0.002/query envelope)')`
      - 3-attempt backoff loop: `try { call } catch (e) { if (status >= 500 || status === 429) sleep 1s/3s/9s; else throw }`
      - Each call: `const c = new CohereClient({ token: this.apiKey }); const t0 = performance.now(); const resp = await c.rerank({ model: 'rerank-v3.5', query, documents, topN, returnDocuments: false }); const latencyMs = performance.now() - t0;`
      - Map response: `resp.results.map(r => ({ index: r.index, score: r.relevanceScore }))`
      - Return `{ results, tokensUsed: 0 /* Cohere does not return token usage for rerank */, latencyMs, costUsd: 0.002, model: 'rerank-v3.5' }`
    - Method `healthCheck(): Promise<{ ok: boolean; reason?: string }>` — run `this.rerank({ query: 'ok', documents: ['ok', 'ok'], topN: 1 })`, return `{ ok: true }` on success.

    Author `__tests__/cohere-rerank.test.ts` with Deno `MockFetch` (or manual `globalThis.fetch` override):
    - `Deno.test('throws empty_docs on 0 documents')` — assert `RerankError` with `code: 'empty_docs'`.
    - `Deno.test('throws too_many_docs on 21 documents')` — assert `RerankError` with `code: 'too_many_docs'`.
    - `Deno.test('returns results + cost 0.002 on success')` — mock fetch returns `{ results: [{ index: 0, relevance_score: 0.92 }] }`; assert `costUsd === 0.002`, `model === 'rerank-v3.5'`.
    - `Deno.test('retries 3× with backoff on 429')` — mock returns 429, 429, 200; assert call count 3 + final success.
    - `Deno.test('throws after 3 failed attempts')` — mock returns 500, 500, 500; assert throws after 3 attempts with code `'api_error'`.
  </action>
  <verify>
    <automated>bash -c "cd /Users/karstenhaldan/minisite && $HOME/.deno/bin/deno test --no-check --allow-env --allow-net supabase/functions/rag-retrieve/__tests__/cohere-rerank.test.ts"</automated>
  </verify>
  <done>
    - 5 test cases pass.
    - Input validation enforces ≤20 docs (cost guardrail per AI-SPEC §4).
    - 3-attempt backoff on transient failures.
    - Model pinned `rerank-v3.5` (NOT `rerank-english-v3.0` — biomedical precision per AI-SPEC §4).
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 5: Write jina-rerank.ts (Jina Reranker v2 fallback client)</name>
  <files>supabase/functions/rag-retrieve/jina-rerank.ts, supabase/functions/rag-retrieve/__tests__/jina-rerank.test.ts</files>
  <read_first>supabase/functions/rag-retrieve/cohere-rerank.ts</read_first>
  <behavior>
    - `new JinaRerankClient(apiKey).rerank({ query, documents, topN })` returns same shape as Cohere `RerankResult` (sibling-API compatibility — enables clean env-flag swap in index.ts)
    - POST `https://api.jina.ai/v1/rerank` with `Authorization: Bearer <apiKey>` header
    - Body: `{ model: 'jina-reranker-v2-base-multilingual', query, documents, top_n, return_documents: false }`
    - Response shape: `{ results: Array<{ index: number; relevance_score: number }>; usage: { total_tokens: number } }`
    - Cost: 0.000018 USD per 1K input tokens (Jina pricing); compute as `0.000018 * usage.total_tokens / 1000` (typical: ≤$0.001 per 20-doc rerank — under Cohere envelope, hence "fallback" lock-in cost is acceptable per AI-SPEC §2)
    - Same input validation: empty_docs error on 0, too_many_docs on >20
    - Same 3-attempt backoff on 5xx/429
  </behavior>
  <action>
    Author `supabase/functions/rag-retrieve/jina-rerank.ts`:
    - Reuse the `RerankError`, `RerankInput`, `RerankResult` types from cohere-rerank.ts (`import { RerankError, type RerankInput, type RerankResult } from './cohere-rerank.ts';`).
    - `export class JinaRerankClient { constructor(private apiKey: string) {} }`
    - Method `rerank(input: RerankInput): Promise<RerankResult>`:
      - Validate inputs (same as Cohere): empty_docs / too_many_docs.
      - POST `https://api.jina.ai/v1/rerank` with native `fetch` (no SDK needed — REST is trivial):
        - Headers: `Authorization: Bearer ${apiKey}`, `Content-Type: application/json`
        - Body: `JSON.stringify({ model: 'jina-reranker-v2-base-multilingual', query: input.query, documents: input.documents, top_n: input.topN, return_documents: false })`
      - 3-attempt backoff on `resp.status >= 500 || resp.status === 429`.
      - Map response: `{ results: data.results.map(r => ({ index: r.index, score: r.relevance_score })), tokensUsed: data.usage.total_tokens, latencyMs, costUsd: 0.000018 * data.usage.total_tokens / 1000, model: 'jina-reranker-v2-base-multilingual' }`
    - Method `healthCheck()` same as Cohere — 2-doc dummy.

    Author `__tests__/jina-rerank.test.ts` mirroring cohere-rerank.test.ts:
    - `Deno.test('throws empty_docs on 0 documents')`
    - `Deno.test('throws too_many_docs on 21 documents')`
    - `Deno.test('returns results + cost computed from tokens on success')` — mock returns `{ results: [{ index: 0, relevance_score: 0.88 }], usage: { total_tokens: 500 } }`; assert `costUsd ≈ 0.000009`, `model === 'jina-reranker-v2-base-multilingual'`.
    - `Deno.test('retries 3× with backoff on 503')`
    - `Deno.test('returns same-shaped RerankResult as Cohere (sibling-API compat)')` — type-level assertion: import both clients, assert their `.rerank()` return Promise<RerankResult> with same RerankResult shape (compile-time check via `const _: RerankResult = await jinaClient.rerank(...);`).
  </action>
  <verify>
    <automated>bash -c "cd /Users/karstenhaldan/minisite && $HOME/.deno/bin/deno test --no-check --allow-env --allow-net supabase/functions/rag-retrieve/__tests__/jina-rerank.test.ts"</automated>
  </verify>
  <done>
    - 5 test cases pass.
    - Same RerankResult shape as Cohere client (env-flag swap is type-safe).
    - Model pinned `jina-reranker-v2-base-multilingual`.
    - Token-based cost computation works.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 6: Write refusal.ts (out-of-corpus + post-rerank-low-relevance gates)</name>
  <files>supabase/functions/rag-retrieve/refusal.ts, supabase/functions/rag-retrieve/__tests__/refusal.test.ts</files>
  <read_first>supabase/functions/_shared/posthog-rag-events.ts</read_first>
  <behavior>
    - `outOfCorpusRefusal(traceId, maxCosine, topicTag?)` returns `{ refused: true, refusal_reason: 'out_of_corpus', max_cosine: number, results: [], count: 0 }`
    - `postRerankRefusal(traceId, maxRerankScore, topicTag?)` returns `{ refused: true, refusal_reason: 'post_rerank_low_relevance', max_rerank_score: number, results: [], count: 0 }`
    - Both functions emit `rag_refusal_emitted` PostHog event via `emitRagRefusal` from 60-02 helper (async; await before return)
    - Threshold constants exported: `OUT_OF_CORPUS_COSINE_FLOOR = 0.65`, `POST_RERANK_SCORE_FLOOR = 0.5` (per AI-SPEC §6 G3 + G4)
    - Helper `shouldRefuseOutOfCorpus(maxCosine: number): boolean` returns `maxCosine < OUT_OF_CORPUS_COSINE_FLOOR`
    - Helper `shouldRefusePostRerank(maxScore: number): boolean` returns `maxScore < POST_RERANK_SCORE_FLOOR`
  </behavior>
  <action>
    Author `supabase/functions/rag-retrieve/refusal.ts`:
    - `import { emitRagRefusal } from '../_shared/posthog-rag-events.ts';`
    - `export const OUT_OF_CORPUS_COSINE_FLOOR = 0.65;`
    - `export const POST_RERANK_SCORE_FLOOR = 0.5;`
    - `export function shouldRefuseOutOfCorpus(maxCosine: number): boolean { return maxCosine < OUT_OF_CORPUS_COSINE_FLOOR; }`
    - `export function shouldRefusePostRerank(maxScore: number): boolean { return maxScore < POST_RERANK_SCORE_FLOOR; }`
    - `export interface RetrieveRefusalResponse { refused: true; refusal_reason: 'out_of_corpus' | 'post_rerank_low_relevance'; max_cosine?: number; max_rerank_score?: number; results: []; count: 0; }`
    - `export async function outOfCorpusRefusal(traceId: string, maxCosine: number, topicTag?: string): Promise<RetrieveRefusalResponse> { await emitRagRefusal({ trace_id: traceId, refusal_reason: 'out_of_corpus', max_cosine: maxCosine, topic_tag: topicTag }); return { refused: true, refusal_reason: 'out_of_corpus', max_cosine: maxCosine, results: [], count: 0 }; }`
    - `export async function postRerankRefusal(traceId: string, maxRerankScore: number, topicTag?: string): Promise<RetrieveRefusalResponse> { await emitRagRefusal({ trace_id: traceId, refusal_reason: 'post_rerank_low_relevance', max_rerank_score: maxRerankScore, topic_tag: topicTag }); return { refused: true, refusal_reason: 'post_rerank_low_relevance', max_rerank_score: maxRerankScore, results: [], count: 0 }; }`

    Author `__tests__/refusal.test.ts` with mocked emitRagRefusal:
    - `Deno.test('shouldRefuseOutOfCorpus returns true at 0.64')` and `Deno.test('... returns false at 0.65')` — boundary tests.
    - `Deno.test('shouldRefusePostRerank returns true at 0.49')` and `Deno.test('... returns false at 0.5')`.
    - `Deno.test('outOfCorpusRefusal emits rag_refusal_emitted and returns shaped response')` — stub `emitRagRefusal` via module-level mock; assert called once with `refusal_reason: 'out_of_corpus'` and the returned object matches the schema.
    - `Deno.test('postRerankRefusal emits with refusal_reason post_rerank_low_relevance')`.
  </action>
  <verify>
    <automated>bash -c "cd /Users/karstenhaldan/minisite && $HOME/.deno/bin/deno test --no-check --allow-env supabase/functions/rag-retrieve/__tests__/refusal.test.ts"</automated>
  </verify>
  <done>
    - 6 test cases pass.
    - Thresholds 0.65 / 0.5 exported as named constants (not magic numbers).
    - Both refusal paths emit `rag_refusal_emitted` PostHog event with correct `refusal_reason`.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 7: Write rag-retrieve Edge Function entry (index.ts) — embed → ANN → rerank → refusal gates</name>
  <files>supabase/functions/rag-retrieve/index.ts, supabase/functions/rag-retrieve/__tests__/integration.test.ts</files>
  <read_first>supabase/functions/rag-retrieve/merge.ts, supabase/functions/rag-retrieve/cohere-rerank.ts, supabase/functions/rag-retrieve/jina-rerank.ts, supabase/functions/rag-retrieve/refusal.ts, supabase/functions/rag-embed-approved/openai.ts, supabase/functions/_shared/posthog-rag-events.ts</read_first>
  <behavior>
    - POST with `{ query: string, k?: number, filters?: { topic_tag?: string, source_tier?: ('A'|'B'|'C')[] }, mode?: 'retrieve' | 'eval-sweep' }`; default `k = 3`, default `mode='retrieve'`
    - `mode='eval-sweep'` branch (Warning W-2 fix from plan-checker iter-1): operates as a nightly batch driver invoked by 60-15's `phase60_eval_nightly` cron. Reads gold-set fixture path from `Deno.env.get('PHASE60_GOLD_SET_PATH')` (default `/tmp/phase60-gold-set.jsonl` — operator stages via 60-03 harness pre-cron), iterates each gold-set query through the normal retrieve pipeline, computes recall@5 + MRR + rerank-delta per dimension, emits `$ai_evaluation` PostHog events per query via `_shared/posthog-rag-events.ts`, returns aggregated `{ mode: 'eval-sweep', queries_run: N, dimensions: {...} }` summary. Service-role bearer required (cron-only); reject `mode='eval-sweep'` POSTs lacking service-role auth with 401.
    - GET `/healthz` returns `{ ok: true, rerank_provider: 'cohere'|'jina' }`
    - Pipeline order: input parse → trace_id mint → embed query → RPC match_external_kb_embeddings → out-of-corpus gate → tier/freshness reweight via rankAndTrim → top-N=20 cap for rerank input → rerank (env-flag) → post-rerank gate → slice to top-k → emit AI generation events → return JSON
    - `RAG_RERANKER_PROVIDER=jina` → uses JinaRerankClient; otherwise CohereRerankClient
    - `RAG_RERANKER_PROVIDER=cohere` and COHERE_API_KEY missing → returns 500 with `error: 'cohere_api_key_missing'` (fail-fast, NOT silent fallback to Jina — operator must explicitly set provider)
    - Out-of-corpus: max(reweighted_score) < 0.65 → refusal response BEFORE rerank call (saves cost)
    - Post-rerank: max(rerank.score) < 0.5 → refusal response
    - Success response: `{ refused: false, results: Array<{chunk_id, summary, quote_blocks, canonical_url, scraped_at, source_tier, topic_tag, source_name, source_domain, raw_score, final_score, rerank_score, stale}>, count, rerank_provider, rerank_degraded?, trace_id }`
    - `rerank_degraded: true` flag set when env-flag was 'cohere' but Cohere threw after 3 retries → falls back to ordering by `final_score` (post-reweight) without rerank. JINA fallback applies only via explicit env-flag swap, NOT auto-flip per AI-SPEC §6 G4 + F4 design (auto-flip is OFFLINE-only nightly decision per AI-SPEC §5 Dim #4)
    - Emits `$ai_generation` events: one for `action='embed_query'` (cost from OpenAI usage), one for `action='rerank_cohere'` or `action='rerank_jina'` (cost from client return)
    - All env-var reads via `Deno.env.get()`; missing required vars return 500 with structured error
    - `Deno.serve()` wrapped: `if (import.meta.main) Deno.serve(handler);` per [[reference_deno_test_top_level_serve_trap]]
    - Exports `handler` function for test consumption (named export — `export async function handler(req: Request): Promise<Response>`)
  </behavior>
  <action>
    Author `supabase/functions/rag-retrieve/index.ts`:

    ```
    Imports:
    - 'jsr:@std/dotenv/load'
    - createClient from '@supabase/supabase-js'
    - z from 'zod'
    - applyTierBoost, rankAndTrim from './merge.ts'
    - CohereRerankClient, RerankError from './cohere-rerank.ts'
    - JinaRerankClient from './jina-rerank.ts'
    - outOfCorpusRefusal, postRerankRefusal, shouldRefuseOutOfCorpus, shouldRefusePostRerank from './refusal.ts'
    - OpenAIEmbedClient from '../rag-embed-approved/openai.ts'
    - emitAiGeneration from '../_shared/posthog-rag-events.ts'
    ```

    Top-of-file: zod schema for request body
    - `const RequestSchema = z.object({ query: z.string().min(1).max(2000), k: z.number().int().min(1).max(10).default(3), filters: z.object({ topic_tag: z.string().optional(), source_tier: z.array(z.enum(['A','B','C'])).optional() }).optional() });`

    `export async function handler(req: Request): Promise<Response>`:
    1. **Healthz**: if `req.method === 'GET' && new URL(req.url).pathname.endsWith('/healthz')` → return JSON `{ ok: true, rerank_provider: getRerankProvider() }`.
    2. **Method gate**: `if (req.method !== 'POST')` → 405.
    3. **Parse**: `const body = RequestSchema.parse(await req.json())`; on ZodError → 400 with structured `{ error: 'invalid_request', issues }`.
    4. **Trace ID**: `const traceId = crypto.randomUUID();`
    5. **Env gates**:
       - `const gatewayToken = Deno.env.get('AI_GATEWAY_TOKEN')` — required.
       - `const provider = getRerankProvider();` (helper: `Deno.env.get('RAG_RERANKER_PROVIDER') === 'jina' ? 'jina' : 'cohere'`)
       - If `provider === 'cohere'`: `const cohereKey = Deno.env.get('COHERE_API_KEY')` — if missing → 500 `{ error: 'cohere_api_key_missing' }`.
       - If `provider === 'jina'`: `const jinaKey = Deno.env.get('JINA_API_KEY')` — if missing → 500.
    6. **Supabase client**: `const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });`
    7. **Embed query**: `const embed = new OpenAIEmbedClient(gatewayToken); const t0 = performance.now(); const { embeddings, totalTokens } = await embed.embedBatch([body.query]); const queryEmbedding = embeddings[0]; const embedLatency = performance.now() - t0;`
       - Emit: `await emitAiGeneration({ trace_id: traceId, action: 'embed_query', model: 'text-embedding-3-small', prompt_tokens: totalTokens, usage_total_cost: 0.020 / 1_000_000 * totalTokens, latency_ms: embedLatency });`
    8. **ANN RPC**: `const { data: candidates, error } = await sb.rpc('match_external_kb_embeddings', { query_embedding: queryEmbedding, match_count: Math.min(body.k * 4, 20), requesting_user_id: null });` — on error → 500 `{ error: 'retrieval_failed' }`. Apply post-fetch filters (topic_tag / source_tier) in app layer (RPC does ORDER+LIMIT by cosine; filters reduce candidate set).
    9. **Reweight via merge.ts**: `const reweighted = rankAndTrim(candidates.map(c => ({ ...c, raw_score: c.similarity })), candidates.length);` — preserves all candidates, applies tier+freshness, sorts.
    10. **Out-of-corpus gate**: `const maxFinal = Math.max(0, ...reweighted.map(r => r.final_score)); if (shouldRefuseOutOfCorpus(maxFinal)) return jsonResp(await outOfCorpusRefusal(traceId, maxFinal, body.filters?.topic_tag), 200);`
    11. **Rerank**: `const rerankInput = reweighted.slice(0, 20).map(r => `${r.summary}\n\n${JSON.stringify(r.quote_blocks)}`); const rerankClient = provider === 'jina' ? new JinaRerankClient(jinaKey!) : new CohereRerankClient(cohereKey!);`
        - Wrap in try/catch: `let rerankResp; let rerankDegraded = false; try { rerankResp = await rerankClient.rerank({ query: body.query, documents: rerankInput, topN: body.k }); } catch (e) { rerankDegraded = true; }`
        - On success emit: `await emitAiGeneration({ trace_id: traceId, action: provider === 'cohere' ? 'rerank_cohere' : 'rerank_jina', model: rerankResp.model, usage_total_cost: rerankResp.costUsd, latency_ms: rerankResp.latencyMs, prompt_tokens: rerankResp.tokensUsed || undefined });`
    12. **Post-rerank gate** (skip if degraded):
        - If `!rerankDegraded`: `const maxRerank = Math.max(0, ...rerankResp!.results.map(r => r.score)); if (shouldRefusePostRerank(maxRerank)) return jsonResp(await postRerankRefusal(traceId, maxRerank, body.filters?.topic_tag), 200);`
    13. **Assemble final top-k**:
        - If `!rerankDegraded`: `const final = rerankResp!.results.map(r => ({ ...reweighted[r.index], rerank_score: r.score })).slice(0, body.k);`
        - If `rerankDegraded`: `const final = reweighted.slice(0, body.k).map(r => ({ ...r, rerank_score: null }));`
    14. **Response**: `return jsonResp({ refused: false, results: final, count: final.length, rerank_provider: provider, rerank_degraded: rerankDegraded || undefined, trace_id: traceId }, 200);`
    15. Helper `function jsonResp(body, status) { return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }); }`
    16. Helper `function getRerankProvider(): 'cohere' | 'jina' { return Deno.env.get('RAG_RERANKER_PROVIDER') === 'jina' ? 'jina' : 'cohere'; }`

    Bottom of file: `if (import.meta.main) { Deno.serve(handler); }` — guard per [[reference_deno_test_top_level_serve_trap]] so tests can import `handler` without binding ports.

    Author `__tests__/integration.test.ts` with mocked Supabase client + mocked OpenAI client + mocked Cohere/Jina clients:
    - `Deno.test('healthz returns rerank_provider')`
    - `Deno.test('rejects non-POST with 405')`
    - `Deno.test('rejects invalid body with 400')`
    - `Deno.test('returns 500 when COHERE_API_KEY missing and provider=cohere')`
    - `Deno.test('end-to-end: embed → ANN → rerank → top-3 returned')` — mock embeddings, mock 8 candidates with reweighted scores ranging 0.7-0.95, mock Cohere returning top-3; assert response shape includes rerank_score + final_score + stale per chunk.
    - `Deno.test('out-of-corpus refusal when max(final_score) < 0.65')` — mock 5 candidates all below 0.6 raw similarity; assert refusal response with `refusal_reason: 'out_of_corpus'`, no rerank call made.
    - `Deno.test('post-rerank refusal when max rerank score < 0.5')` — mock high-cosine candidates but Cohere returns all scores < 0.5; assert refusal response with `refusal_reason: 'post_rerank_low_relevance'`.
    - `Deno.test('env-flag swap: RAG_RERANKER_PROVIDER=jina uses Jina client')` — `Deno.env.set('RAG_RERANKER_PROVIDER', 'jina')`; assert response `rerank_provider === 'jina'`.
    - `Deno.test('rerank_degraded=true when Cohere throws 3× — falls back to merge.ts ordering')` — assert response includes `rerank_degraded: true` and `rerank_score: null` on each result.
    - `Deno.test('top-20 cap: 25 candidates returned by RPC → only 20 passed to rerank')` — assert mock rerank received exactly 20 documents (cost guardrail).
    - `Deno.test('topic_tag filter narrows results')` — assert RPC called with filter constraint applied either via SQL or post-filter in app layer.
  </action>
  <verify>
    <automated>bash -c "cd /Users/karstenhaldan/minisite && $HOME/.deno/bin/deno test --no-check --allow-env --allow-net supabase/functions/rag-retrieve/__tests__/integration.test.ts"</automated>
  </verify>
  <done>
    - 11 integration test cases pass.
    - `Deno.serve` guarded by `import.meta.main` — `deno test` of this file does NOT bind a port.
    - Env-flag `RAG_RERANKER_PROVIDER` switches between Cohere and Jina without code branches outside `getRerankProvider()`.
    - Out-of-corpus refusal fires BEFORE any rerank call (cost guardrail).
    - Top-N=20 cap enforced.
    - `rerank_degraded: true` fallback ships when Cohere throws — synthesis pipeline still gets ranked results from merge.ts.
    - All API keys read from `Deno.env.get()` — `grep -i "cohere.*api.*key\|jina.*api.*key" supabase/functions/rag-retrieve/index.ts | grep -v 'Deno.env.get'` returns nothing (no hardcoded keys).
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 8: Write retrieval-recall + rerank-delta eval dimensions</name>
  <files>eval/phase60/dimensions/retrieval-recall.ts, eval/phase60/dimensions/rerank-delta.ts</files>
  <read_first>eval/phase60/run.ts, eval/phase60/gold-set.jsonl, supabase/functions/rag-retrieve/index.ts</read_first>
  <behavior>
    - `retrieval-recall.ts` exports `default async function run(args): Promise<{ pass: boolean; metrics: Record<string, number>; failures: string[] }>`:
      - Loads `eval/phase60/gold-set.jsonl` (40 examples).
      - For each query: invoke rag-retrieve Fn locally (via `supabase functions serve` OR direct handler import); compute `recall@5`, `recall@10`, `MRR` against `relevant_chunk_ids`.
      - Aggregate: `recall_at_5_mean`, `recall_at_10_mean`, `mrr_mean`. Also per-topic_tag breakdown.
      - PASS: `recall_at_5_mean >= 0.80` AND `recall_at_10_mean >= 0.92` AND `mrr_mean >= 0.65` per AI-SPEC §5 Dim #2 + #3.
      - Emits `$ai_evaluation` PostHog event per dimension with score.
    - `rerank-delta.ts` exports `default async function run(args)`:
      - Loads same gold-set.
      - For each query: runs TWO paths — (a) raw-cosine-only top-5 (skip rerank entirely; sort by final_score from merge.ts only), (b) full pipeline with rerank → top-5.
      - Computes `precision@5` for each path: `|relevant_chunk_ids ∩ retrieved_top_5| / 5`.
      - Aggregate delta: `delta_p5 = mean(rerank_p5) - mean(cosine_p5)`. Bootstrap 1000 resamples for 95% CI.
      - PASS: `delta_p5 >= +0.10` per AI-SPEC §5 Dim #4 + success criterion #3.
      - Also reports `mrr_delta` and `recall_at_5_delta` for diagnostic.
      - Emits `$ai_evaluation` PostHog event with score = delta_p5.
    - Both dimensions accept `args.provider: 'cohere' | 'jina'` (defaults to env-flag) so the A/B harness can compare Cohere vs Jina vs raw cosine in three-way fan-out (F4 daily nightly per AI-SPEC §F4).
    - Both dimensions write a per-query failure trace to `failures: string[]` when an example fails its rubric (for human review).
  </behavior>
  <action>
    Author `eval/phase60/dimensions/retrieval-recall.ts`:
    - `import { handler } from '../../../supabase/functions/rag-retrieve/index.ts';` (import handler directly — `import.meta.main` guard makes this safe).
    - `import { readGoldSet, postEvalEvent, type GoldExample } from '../lib.ts';` (60-03 shared eval lib — assume exists per outline).
    - `export default async function run(args: { provider?: 'cohere' | 'jina'; suite?: string }): Promise<{ pass: boolean; metrics: Record<string, number>; failures: string[] }>`
    - Body:
      1. Load gold-set.
      2. For each example: call `handler(new Request('http://local/', { method: 'POST', body: JSON.stringify({ query: ex.query, k: 10, filters: ex.topic_tag ? { topic_tag: ex.topic_tag } : undefined }) }))`; parse JSON.
      3. Compute per-example: `recall@5 = |relevant ∩ retrieved[0..5]| / |relevant|`; same for `recall@10`; `MRR = 1 / (1-based-rank-of-first-relevant)` (0 if no relevant in top-10).
      4. Aggregate. Group by topic_tag for per-tag report.
      5. Emit `$ai_evaluation` event per metric.
      6. PASS check: thresholds above.
      7. Return `{ pass, metrics: { recall_at_5_mean, recall_at_10_mean, mrr_mean, ...per_topic }, failures }`.

    Author `eval/phase60/dimensions/rerank-delta.ts`:
    - Same import + signature.
    - For each example: run TWO pipelines:
      - Path A (cosine-only): set `Deno.env.set('RAG_RERANKER_PROVIDER', '__cosine_only')` (handle this sentinel in index.ts as "skip rerank entirely" — small edit: in `getRerankProvider()` return `'cosine_only'` and short-circuit the rerank step). ACTUALLY simpler: introduce a `?cosine_only=1` query-string in the test path. **Use the second approach** — append `?cosine_only=1` to the Request URL; handler checks `new URL(req.url).searchParams.get('cosine_only') === '1'` and skips rerank, returns top-k from `reweighted` ordering directly. Add this branch to `index.ts` Task 7 IF not already present (back-edit acceptable since same task author).
      - Path B (full rerank): default pipeline.
    - Compute `precision@5` per path per example: `|relevant ∩ retrieved[0..5]| / 5`.
    - Aggregate `delta_p5 = mean(B.p5) - mean(A.p5)`. Bootstrap 1000 resamples → 95% CI on delta.
    - PASS: delta_p5 ≥ +0.10 (per AI-SPEC §5 Dim #4).
    - Emit `$ai_evaluation` with `score: delta_p5`, `metadata: { ci_low, ci_high, provider }`.
    - Return `{ pass, metrics: { delta_p5, delta_mrr, delta_recall_at_5, cohere_p5_mean, cosine_p5_mean, ci_low, ci_high }, failures }`.

    **Back-edit to Task 7's index.ts**: add `cosine_only` query-string short-circuit. After step 11 (rerank input prep), check `const cosineOnly = new URL(req.url).searchParams.get('cosine_only') === '1';` — if true, skip steps 11-13 rerank block, set `final = reweighted.slice(0, body.k).map(r => ({ ...r, rerank_score: null }))`, set `rerankDegraded = false`, response includes `cosine_only: true`. Document in Task 7 acceptance criteria.

    Tests embedded in `__tests__/eval-dimensions.test.ts` (one file, two suites):
    - `Deno.test('retrieval-recall: pass on synthetic gold-set with high-overlap mock retrieval')` — inject mock that returns gold relevant_chunk_ids in top-3; assert recall@5 = 1.0, MRR = 1.0.
    - `Deno.test('retrieval-recall: fail when recall_at_5_mean < 0.80')` — mock returns irrelevant chunks; assert pass=false.
    - `Deno.test('rerank-delta: pass when rerank lifts precision@5 by ≥0.10')` — synthesize cosine-path returning 1/5 relevant, rerank-path returning 3/5 relevant; assert delta = +0.4, pass=true.
    - `Deno.test('rerank-delta: fail when rerank lift < 0.10')` — both paths return same chunks; assert delta ≈ 0, pass=false.
    - `Deno.test('rerank-delta: bootstrap CI computed')` — assert `ci_low < delta_p5 < ci_high`.
  </action>
  <verify>
    <automated>bash -c "cd /Users/karstenhaldan/minisite && $HOME/.deno/bin/deno test --no-check --allow-env --allow-net --allow-read eval/phase60/__tests__/eval-dimensions.test.ts"</automated>
  </verify>
  <done>
    - 5 test cases pass.
    - Both dimensions importable by `eval/phase60/run.ts --suite=retrieval` and `--suite=rerank-delta`.
    - `cosine_only` short-circuit branch added to `index.ts` and verified by Task 7 integration test (back-edit acceptance: rerun `deno test supabase/functions/rag-retrieve/__tests__/integration.test.ts` after edit → still green).
    - PostHog `$ai_evaluation` events emitted per metric.
  </done>
</task>

<task type="auto" tdd="false">
  <name>Task 9: Run rerank-delta + retrieval suites on local stack — CI gate validation</name>
  <files>(no new files — runs existing harness)</files>
  <action>
    Execute the eval harness against the local Supabase stack to validate the entire 60-06 deliverable end-to-end.

    Pre-flight:
    - `supabase db reset --linked=false` (re-applies all Phase 60 migrations including Task 1's RPC).
    - Seed `external_kb_embeddings` with the 40 gold-set examples' canonical chunks: `psql -f eval/phase60/seed-gold-corpus.sql` (assume 60-03 ships this seed script; if not, planner adds a TODO note here for 60-03 follow-up — but per outline 60-03 ships the harness, so the seed is implicit).
    - Set local env:
      - `export COHERE_API_KEY=$(supabase secrets get COHERE_API_KEY --project-ref <ref> 2>/dev/null || echo "test_mode")` — use stub if running offline.
      - `export RAG_RERANKER_PROVIDER=cohere`
      - `export AI_GATEWAY_TOKEN=$(supabase secrets get AI_GATEWAY_TOKEN --project-ref <ref>)`

    Run:
    - `cd leanshot && deno run --allow-all eval/phase60/run.ts --suite=retrieval` — gate: must pass.
    - `cd leanshot && deno run --allow-all eval/phase60/run.ts --suite=rerank-delta` — gate: must pass (delta_p5 ≥ +0.10).
    - Capture output to `.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-06-eval-baseline.md` for reviewer audit.

    If the local stack lacks operator-set secrets (COHERE_API_KEY / AI_GATEWAY_TOKEN), document this in the eval baseline as "automated-verify-only at sequential-on-main; live evidence deferred to 60-15 close-out" per [[feedback_spike_accept_deploy_evidence_defer_runtime_verify]]. In that case Task 9 acceptance = harness scaffolding runs and reports clear "secret missing" diagnostic, NOT a pass-on-real-API. Phase 60 success criterion #3 (+0.10 delta) gets re-checked at 60-15 close-out with live secrets.
  </action>
  <verify>
    <automated>bash -c "cd /Users/karstenhaldan/minisite/leanshot && test -f .planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-06-eval-baseline.md && grep -E '(suite=retrieval|suite=rerank-delta).*(pass|secret_missing)' .planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-06-eval-baseline.md"</automated>
  </verify>
  <done>
    - Eval baseline file exists.
    - Retrieval suite either PASS or documents "secret_missing — deferred to 60-15" with full diagnostic.
    - Rerank-delta suite same: PASS with delta_p5 ≥ +0.10 OR documented deferral.
    - Output captured for code reviewer audit at 60-06 SUMMARY time.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Browser → rag-retrieve Edge Fn | Untrusted POST body (`query`, `filters`); zod-validated at entry |
| rag-retrieve Edge Fn → Postgres RPC | Service-role JWT; RPC is SECURITY INVOKER on non-PHI table |
| rag-retrieve Edge Fn → OpenAI (via Vercel AI Gateway) | Outbound; uses gateway token; user query embedded — NEVER persisted into corpus |
| rag-retrieve Edge Fn → Cohere API | Outbound; bearer COHERE_API_KEY; documents = chunk summaries (already curated/approved) |
| rag-retrieve Edge Fn → Jina API | Outbound; bearer JINA_API_KEY; same payload shape as Cohere |
| Edge Fn → PostHog | Outbound observability; trace_id only — no PII per AI-04 fence (user_context never reaches retrieve Fn; that's the synthesis-fn's responsibility) |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-60-06-01 | Spoofing | POST body `filters.source_tier` | mitigate | zod enum-validates `('A'\|'B'\|'C')[]`; PostgREST array param is parameterized — no SQL injection vector |
| T-60-06-02 | Tampering | Refusal threshold env vars (RAG_RERANKER_PROVIDER) | mitigate | thresholds (0.65, 0.5) are SOURCE-LITERAL CONSTANTS in refusal.ts — NOT env-overridable. Env-flag only swaps provider, not gates. Threshold tampering would require code change + deploy review |
| T-60-06-03 | Tampering | Cohere/Jina API response | mitigate | zod-validate response shape at client level; throw RerankError on schema violation → fail-closed to `rerank_degraded: true` (merge.ts ordering preserved). NEVER trust unvalidated upstream JSON |
| T-60-06-04 | Repudiation | Refusal events | mitigate | every refusal emits `rag_refusal_emitted` with trace_id + max_cosine/max_rerank_score → PostHog audit trail per AI-SPEC §F2 |
| T-60-06-05 | Information Disclosure | COHERE_API_KEY / JINA_API_KEY exposure | mitigate | keys read ONLY via `Deno.env.get()`; never logged; never echoed in error responses (errors return `{ error: 'cohere_api_key_missing' }` — string code, not the key value). PostHog `$ai_generation` events do NOT include API keys. CI grep check on `index.ts` for `Deno.env.get` wrapping |
| T-60-06-06 | Information Disclosure | Retracted chunk leak | mitigate | RPC `WHERE c.retracted_at IS NULL AND c.published_at IS NOT NULL` (Task 1); RLS on rag_chunks already excludes; **defense in depth**: Edge Fn handler does NOT trust client to filter — RPC owns the gate. Tested in integration.test.ts |
| T-60-06-07 | Denial of Service | Top-N rerank cap | mitigate | input docs hard-capped at 20 in BOTH Cohere wrapper (RerankError on >20) AND RPC layer (`LIMIT LEAST($4::int * 4, 20)`); k itself zod-capped at 10. Per-query cost envelope $0.002 (rerank) + $0.00001 (embed) = ~$0.0021 per call. Budget cap G6 in AI-SPEC §6 fires at 10-call rolling mean |
| T-60-06-08 | Denial of Service | Cohere/Jina rate-limit cascade | mitigate | 3-attempt exponential backoff (1s/3s/9s) per client; `rerank_degraded` fallback to merge.ts ordering preserves response on full provider outage. AI-SPEC §F4 nightly A/B identifies sustained Cohere outage → operator flips RAG_RERANKER_PROVIDER=jina via supabase secrets set |
| T-60-06-09 | Denial of Service | Embed-call abuse | accept | OpenAI text-embedding-3-small at $0.020/1M tokens, typical query ~50 tokens = $0.000001/call. Even 100K malicious queries/day = $0.10 — below all alerting envelopes. Browser-side Phase 4 anonymous-JWT auth + Edge Middleware rate-limit (Phase 13) provide upstream throttle |
| T-60-06-10 | Elevation of Privilege | RPC SECURITY INVOKER vs DEFINER | mitigate | RPC declared SECURITY INVOKER explicitly (Task 1); non-PHI table; no auth.uid() in body. Verified at migration time: `\df+ public.match_external_kb_embeddings` → "Security: invoker" |
| T-60-06-11 | Tampering | Refusal-bypass via threshold tuning attack | mitigate | thresholds are source-literal constants; any change requires PR + code review. Eval suite `--suite=refusal` (in 60-03 + 60-04 scope) would detect lowered floor as missed-refusal regression. Belt-and-suspenders: Task 6 tests assert exact threshold values (0.65, 0.5) |
| T-60-06-SC | Tampering | npm package installs (cohere-ai@^7) | mitigate | RESEARCH.md `## Package Legitimacy Audit` declares cohere-ai as `[VERIFIED]` (Cohere official SDK, weekly downloads 50K+, GitHub cohere-ai/cohere-typescript). Jina has no SDK — REST direct, no install. ai@^4, @ai-sdk/openai@^1 already in package.json from 60-05; @supabase/supabase-js, zod already shipped. NO new `[ASSUMED]` or `[SUS]` installs — auto-approval path. (If RESEARCH.md audit table is missing for cohere-ai, fallback policy: treat as `[ASSUMED]` and add a `checkpoint:human-verify` task before deploy. Verify at execute time.) |
</threat_model>

<verification>
- All 5 unit/integration test suites green: `deno test --no-check --allow-env --allow-net supabase/functions/rag-retrieve/**/*.test.ts`
- RPC migration applies cleanly: `supabase db reset --linked=false` succeeds; `\df+ public.match_external_kb_embeddings` shows SECURITY INVOKER + correct return shape
- `deno check supabase/functions/rag-retrieve/*.ts` passes — no type errors
- Healthz works locally: `curl http://localhost:54321/functions/v1/rag-retrieve/healthz` returns `{ ok: true, rerank_provider: "cohere" }` (or jina based on env)
- Env-flag swap works: set `RAG_RERANKER_PROVIDER=jina` → integration test confirms Jina client invoked
- Cost guardrail: hard-cap at 20 docs to rerank — `grep -E 'LIMIT.*LEAST.*20|documents.length > 20' supabase/functions/rag-retrieve/ -r` returns ≥2 hits (RPC + cohere wrapper + jina wrapper)
- Refusal gates: integration test confirms out-of-corpus fires BEFORE rerank call (mock rerank call count = 0 when max cosine < 0.65)
- No hardcoded API keys: `grep -v '^[[:space:]]*\(\/\/\|#\)' supabase/functions/rag-retrieve/*.ts | grep -iE 'COHERE_API_KEY|JINA_API_KEY' | grep -v "Deno.env.get"` returns nothing
- Eval baseline file generated at `.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-06-eval-baseline.md` with retrieval + rerank-delta suite outputs (pass OR deferred-to-60-15 documentation)
- TypeScript build: `cd leanshot && npx tsc -p tsconfig.app.json --noEmit` — no NEW errors introduced (baseline tracked per phase)
- Vitest gate: no vitest changes in this plan (all tests are Deno) — `npx vitest run --config vite.config.ts` no-net-new per [[reference_vitest_4_projects_config_masks_default]]
</verification>

<success_criteria>
- `rag-retrieve` Edge Fn is fully implemented, locally tested, and ready for 60-15 deploy step
- Env-flag `RAG_RERANKER_PROVIDER` cleanly swaps Cohere ↔ Jina without code branches outside `getRerankProvider()`
- Out-of-corpus refusal (max cosine < 0.65) fires BEFORE rerank call — saves Cohere/Jina cost on unsupported queries
- Post-rerank refusal (max rerank score < 0.5) fires before returning to caller
- Top-N=20 rerank cap enforced (cost envelope ≤ $0.002/query)
- Tier reweight (A=1.2, B=1.0, C=0.85) + freshness de-rank (×0.5 when stale) carried forward from Phase 50 D-06/D-29/D-32 verbatim
- Eval dimensions `--suite=retrieval` (recall@5≥0.80, recall@10≥0.92, MRR≥0.65) and `--suite=rerank-delta` (delta_p5≥+0.10) implemented and runnable via 60-03 harness
- All threat-register T-60-06-XX threats mitigated with verifiable code/test evidence
- Plan ships within sequential-on-main execution envelope (this Wave 1 plan; one plan at a time on main per STATE.md lesson)
</success_criteria>

<output>
On completion, create `.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-06-retrieval-and-rerank-fn-SUMMARY.md` capturing:
- Files created/modified (per `files_modified` frontmatter)
- Migration ID and verification command output
- Eval baseline result (PASS or deferred-to-60-15 with diagnostic)
- Operator env-var checklist for 60-15 close-out: COHERE_API_KEY, JINA_API_KEY, RAG_RERANKER_PROVIDER
- Cross-plan handoffs:
  - 60-10 imports response shape for AI-coach citation UI (top-3 results, rerank_score, stale flag)
  - 60-11 calls rag-retrieve from tip-of-day cron-generation Fn (top-1 mode with topic_tag filter)
  - 60-12 calls rag-retrieve from newsletter cron (k=3, source_tier=['A','B'])
  - 60-15 deploys this Fn atomically alongside 8 other Phase 60 Fns BEFORE cron migration push
</output>
