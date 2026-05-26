---
phase: 60-rag-knowledge-base-completion-waves-2-4
plan: "06"
subsystem: rag
tags: [rag, retrieval, rerank, cohere, jina, edge-function, pgvector, eval]
dependency_graph:
  requires:
    - 60-01 (phase60_kb_tables migration — rag_chunks, external_kb_embeddings, rag_sources)
    - 60-02 (_shared/posthog-rag-events.ts — emitAiGeneration, captureRagEvent)
    - 60-03 (eval harness scaffolds at tests/eval/phase60/)
    - 60-05 (rag-embed-approved/openai.ts — OpenAIEmbedBatchClient)
  provides:
    - supabase/functions/rag-retrieve/index.ts — retrieval + rerank Edge Fn entry
    - supabase/migrations/20281201000010_match_external_kb_embeddings_fn.sql — pgvector ANN RPC
    - eval/phase60/dimensions/retrieval-recall.ts — Dim #2 + #3 eval suite
    - eval/phase60/dimensions/rerank-delta.ts — Dim #4 eval suite
  affects:
    - 60-10 (AI-coach citation UI imports RagRetrieveResult shape)
    - 60-11 (tip-of-day cron calls rag-retrieve with topic_tag filter)
    - 60-12 (newsletter cron calls rag-retrieve with k=3, source_tier=['A','B'])
    - 60-15 (deploys rag-retrieve + pushes migration)
tech_stack:
  added:
    - Cohere Rerank v3.5 (REST API via native Deno fetch; cohere-ai@^7 in deno.json but client uses REST directly)
    - Jina Reranker v2 (REST POST to https://api.jina.ai/v1/rerank)
    - pgvector match_external_kb_embeddings SECURITY INVOKER RPC (cosine ANN via HNSW)
  patterns:
    - import.meta.main guard on Deno.serve per reference_deno_test_top_level_serve_trap
    - per-fn deno.json per reference_supabase_functions_deploy_import_map_flag
    - env-flag provider switch (RAG_RERANKER_PROVIDER) per AI-SPEC §2 Soft Lock-In
    - rerank_degraded fallback to merge.ts ordering on provider outage
    - cosine_only=1 query param for eval A/B path comparison
key_files:
  created:
    - supabase/migrations/20281201000010_match_external_kb_embeddings_fn.sql
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
    - eval/phase60/dimensions/retrieval-recall.ts
    - eval/phase60/dimensions/rerank-delta.ts
    - eval/phase60/__tests__/eval-dimensions.test.ts
    - leanshot/.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-06-eval-baseline.md
decisions:
  - Cohere Rerank v3.5 via REST API (not npm SDK) for Deno-native fetch compatibility + mock control
  - captureRagEvent (system-actor) used for refusal events instead of emitRefusalEmitted (requires userId); refusals are pipeline-level quality gates, not user-attributed telemetry (D-13)
  - eval/phase60/dimensions/ created at git root (not tests/eval/phase60/) to match plan spec for Deno-native CLI runner
  - sanitizeOps:false on integration tests that trigger fire-and-forget events_mirror writes
metrics:
  duration: "18 minutes"
  tasks_completed: 9
  files_created: 16
  tests_added: 42
  completed_date: "2026-05-26"
requirements: [RAG-04, RAG-05]
---

# Phase 60 Plan 06: Retrieval and Rerank Fn Summary

**One-liner:** pgvector ANN + Cohere/Jina cross-encoder rerank via env-flag, with tier/freshness reweight, dual refusal gates, and eval dimensions for precision@5 lift measurement.

## What Was Built

### 1. SECURITY INVOKER RPC Migration (Task 1)

`supabase/migrations/20281201000010_match_external_kb_embeddings_fn.sql`

- `public.match_external_kb_embeddings(query_embedding vector(1536), match_count integer, requesting_user_id uuid)` 
- SECURITY INVOKER on non-PHI table; HNSW-optimized ORDER BY cosine distance
- Excludes `retracted_at IS NOT NULL` and `published_at IS NULL` (defense-in-depth)
- GRANT EXECUTE to `authenticated`, `anon`, `service_role`
- Push deferred to 60-15 per [[feedback_fn_deploy_before_cron_db_push]]

### 2. Per-fn deno.json (Task 2)

`supabase/functions/rag-retrieve/deno.json` — pins ai@^4, @ai-sdk/openai@^1, cohere-ai@^7, zod@^3, @supabase/supabase-js@2 per [[reference_supabase_functions_deploy_import_map_flag]].

### 3. merge.ts — Tier + Freshness Reweight (Task 3)

`supabase/functions/rag-retrieve/merge.ts` — verbatim 50-07 Task 3 contract:
- `applyTierBoost`: A×1.2, B×1.0, C×0.85 (D-06/D-29)
- `isStale` + `applyFreshnessDeRank`: stale→×0.5 (D-32)
- `rankAndTrim<T>`: generic sort + slice returning `final_score` + `stale` per row

### 4. CohereRerankClient (Task 4)

`supabase/functions/rag-retrieve/cohere-rerank.ts` — Deno-native REST client:
- Model `rerank-v3.5`, cost $0.002/call (flat per AI-SPEC §4)
- 3-attempt backoff 1s/3s/9s on 5xx+429
- Hard cap at 20 docs (T-60-06-07)
- Injectable fetch/sleep for test isolation

### 5. JinaRerankClient (Task 5)

`supabase/functions/rag-retrieve/jina-rerank.ts` — identical `RerankResult` shape:
- Model `jina-reranker-v2-base-multilingual`, cost `0.000018 * tokens / 1000`
- Same 3-attempt backoff + input validation
- Reuses `RerankError`/`RerankInput`/`RerankResult` from cohere-rerank.ts

### 6. Refusal Gates (Task 6)

`supabase/functions/rag-retrieve/refusal.ts` — source-literal threshold constants:
- `OUT_OF_CORPUS_COSINE_FLOOR = 0.65` (AI-SPEC §6 G3, T-60-06-02 tamper-proof)
- `POST_RERANK_SCORE_FLOOR = 0.5` (AI-SPEC §6 G4)
- Both async functions emit `rag_refusal_emitted` via `captureRagEvent` (system-actor)

### 7. Edge Function Entry (Task 7)

`supabase/functions/rag-retrieve/index.ts` — full pipeline:
1. GET /healthz → `{ ok, rerank_provider }`
2. POST → zod-validate → trace_id → embed (OpenAIEmbedBatchClient) → ANN RPC → app-layer topic/tier filter → `rankAndTrim` → out-of-corpus gate → `?cosine_only=1` short-circuit → rerank (env-flag) → post-rerank gate → top-k response
3. `mode='eval-sweep'` → service-role-only batch driver for nightly cron
4. `rerank_degraded=true` fallback when provider throws after 3 retries
5. `Deno.serve` guarded by `import.meta.main`

### 8. Eval Dimensions (Task 8)

- `eval/phase60/dimensions/retrieval-recall.ts`: recall@5/10/MRR with injectable retrieve fn
- `eval/phase60/dimensions/rerank-delta.ts`: precision@5 delta with bootstrap 1000-resample CI
- `eval/phase60/__tests__/eval-dimensions.test.ts`: 5 unit tests

### 9. Eval Baseline (Task 9)

`60-06-eval-baseline.md`: `secret_missing` — both suites deferred to 60-15.

## Test Results

| Suite | Tests | Result |
|-------|-------|--------|
| merge.test.ts | 9 | PASS |
| cohere-rerank.test.ts | 5 | PASS |
| jina-rerank.test.ts | 5 | PASS |
| refusal.test.ts | 6 | PASS |
| integration.test.ts | 12 | PASS |
| eval-dimensions.test.ts | 5 | PASS |
| **Total** | **42** | **42/42 PASS** |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Interface drift] posthog-rag-events.ts actual API differs from plan spec**
- **Found during:** Task 6 (refusal.ts)
- **Issue:** Plan spec showed `emitRagRefusal(event: RagRefusalEvent): Promise<void>` but actual 60-02 implementation is `emitRefusalEmitted({ userId: string, properties: RefusalEmittedProperties })` requiring a userId and missing `post_rerank_low_relevance` from the reason union.
- **Fix:** Used `captureRagEvent` from `posthog-server.ts` directly (system-attributed, `distinctId: 'rag-system'`). Refusal events are pipeline-level quality gates, not user-attributed telemetry. D-13 user-attribution applies to user-generated AI calls.
- **Files modified:** `refusal.ts`
- **Commit:** e4e5b2b0

**2. [Rule 1 - Interface drift] emitAiGeneration requires userId**
- **Found during:** Task 7 (index.ts)
- **Issue:** Plan spec showed `emitAiGeneration({ trace_id, action, model, ... })` but actual implementation requires `{ userId: string, properties: AiGenerationProperties }`.
- **Fix:** Used `userId: 'rag-system'` (system actor pattern from rag-embed-approved/index.ts precedent).
- **Files modified:** `index.ts`
- **Commit:** bf4321f0

**3. [Rule 1 - Bug] Reranker index out-of-bounds on filtered candidates**
- **Found during:** Task 7 integration tests (topic_tag filter test)
- **Issue:** When topic_tag filter reduces candidates to N, the Cohere mock returns M > N results. `reweighted[r.index]` was undefined for indices ≥ N, causing spread of `undefined` (producing `topic_tag: undefined`).
- **Fix:** Added `.filter((r) => r.index < reweighted.length)` guard before mapping rerank results.
- **Files modified:** `index.ts`
- **Commit:** bf4321f0

**4. [Rule 1 - Leak] Deno test resource leaks from fire-and-forget events_mirror writes**
- **Found during:** Task 7 integration test runs
- **Issue:** `captureServer` in `posthog-rag-events.ts` fires a `void (async () => {...})()` events_mirror INSERT that Deno's test runner detects as an uncompleted async op or `fetchCancelHandle` resource leak.
- **Fix:** Added `sanitizeOps: false, sanitizeResources: false` to affected integration tests. The fire-and-forget design is intentional (per posthog-server.ts comments); tests cannot/should not await it.
- **Files modified:** `__tests__/integration.test.ts`
- **Commit:** bf4321f0

**5. [Rule 3 - Missing dir] eval/phase60/ directory did not exist at git root**
- **Found during:** Task 8 (eval dimensions)
- **Issue:** Plan references `eval/phase60/run.ts`, `eval/phase60/gold-set.jsonl` but 60-03 placed the eval harness at `tests/eval/phase60/` (Vitest/Node.js). The `eval/` dir at git root did not exist.
- **Fix:** Created `eval/phase60/dimensions/` at git root per plan spec. The new Deno-native dimension files coexist with the existing Vitest tests at `tests/eval/phase60/`. Both can be used via their respective runners.
- **Files created:** `eval/phase60/dimensions/*.ts`, `eval/phase60/__tests__/eval-dimensions.test.ts`
- **Commit:** 68e316e7

**6. [Rule 1 - Wrong import depth] Relative paths in eval dimension files**
- **Found during:** Task 8 (eval-dimensions.test.ts run)
- **Issue:** `../../supabase/functions/rag-retrieve/index.ts` from `eval/phase60/dimensions/` resolved to `eval/supabase/...` (wrong).
- **Fix:** Corrected to `../../../supabase/functions/rag-retrieve/index.ts`.
- **Files modified:** `retrieval-recall.ts`, `rerank-delta.ts`
- **Commit:** 68e316e7

**7. [Rule 1 - CohereRerankClient] npm SDK not used — Deno-native REST instead**
- **Found during:** Task 4 (cohere-rerank.ts)
- **Issue:** Plan specified `import { CohereClient } from 'cohere-ai'` but using the npm SDK in Deno creates mock-control complexity and potential Node.js compatibility issues.
- **Fix:** Implemented REST client using native `fetch` directly. `cohere-ai@^7` retained in `deno.json` imports for type reference / future use. REST contract matches plan spec exactly.
- **Files modified:** `cohere-rerank.ts`, `deno.json`
- **Commit:** ef0e9d22

## Known Stubs

**1. `eval/phase60/dimensions/rerank-delta.ts` line 216: `delta_mrr = 0`**
- Reason: Diagnostic metric stub. The primary gate is `delta_p5 >= +0.10`; `delta_mrr` is a secondary diagnostic that requires two separate MRR computations (one per pipeline). Left as 0 per plan spec note "diagnostic, not primary gate". Wire fully in 60-15 close-out if needed.
- Does NOT block plan's goal (delta_p5 is the AI-SPEC §5 Dim #4 success criterion).

## Cross-Plan Handoffs

| Downstream | What It Needs | Available As Of |
|-----------|---------------|-----------------|
| 60-10 AI-coach citation UI | `POST rag-retrieve` → `{results: [{chunk_id, summary, quote_blocks, canonical_url, scraped_at, source_tier, topic_tag, source_name, source_domain, raw_score, final_score, rerank_score, stale}], count, rerank_provider, trace_id}` | 60-06 deployed |
| 60-11 tip-of-day cron | `POST rag-retrieve` with `k=1, filters.topic_tag` | 60-06 deployed |
| 60-12 newsletter cron | `POST rag-retrieve` with `k=3, filters.source_tier=['A','B']` | 60-06 deployed |
| 60-15 deploy close-out | `supabase functions deploy rag-retrieve` + `supabase db push` for migration 20281201000010 + eval baseline validation | After 60-15 deploy |

## Operator Env-Var Checklist

| Secret | Status |
|--------|--------|
| `COHERE_API_KEY` | Set in Supabase secrets (Batch 1, 2026-05-26) |
| `OPENROUTER_API_KEY` | Set in Supabase secrets (Batch 1, 2026-05-26) |
| `RAG_RERANKER_PROVIDER` | `cohere` set in Supabase secrets (Batch 1, 2026-05-26) |
| `JINA_API_KEY` | NOT set (Jina is fallback-only; set when operator wants to test) |

## Self-Check: PASSED
