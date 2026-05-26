---
phase: 60-rag-knowledge-base-completion-waves-2-4
plan: 05
type: execute
wave: 1
depends_on: [60-01, 60-02]
files_modified:
  - supabase/functions/rag-embed-approved/index.ts
  - supabase/functions/rag-embed-approved/openai.ts
  - supabase/functions/rag-embed-approved/deno.json
  - supabase/functions/rag-embed-approved/__tests__/openai.test.ts
  - supabase/functions/rag-embed-approved/__tests__/embed-pipeline.test.ts
  - supabase/functions/rag-embed-approved/__tests__/integration.test.ts
autonomous: true
requirements: [RAG-02]
tags: [rag, embeddings, openai, pgvector, edge-fn]
user_setup:
  - service: vercel-ai-gateway
    why: "Routes OpenAI embedding calls through the gateway for unified cost-tracking + failover"
    env_vars:
      - name: AI_GATEWAY_API_KEY_CONSUMER
        source: "Existing Phase 38 secret — verify present via `supabase secrets list --project-ref <ref>`; if missing, mint at Vercel Dashboard → AI Gateway → Tokens"
      - name: AI_GATEWAY_BASE_URL
        source: "Existing — `https://ai-gateway.vercel.sh/v1` per Phase 38 convention"
      - name: OPENAI_EMBED_MODEL
        source: "Existing — `text-embedding-3-small` per Phase 38 + Phase 60 AI-SPEC §4"
must_haves:
  truths:
    - "rag-embed-approved Edge Fn selects approved, non-retracted, non-embedded chunks from `public.rag_chunks` and inserts 1536-dim embeddings into `public.external_kb_embeddings` keyed by `chunk_id` (matches Phase 50 Wave 1 schema)"
    - "Embeddings sourced from OpenAI `text-embedding-3-small` (1536d) via Vercel AI Gateway HTTP — matches existing pgvector(1536) column + HNSW index from `20260519000004_external_kb_embeddings_table.sql`"
    - "Embedding text per chunk = `summary + ' || ' + JSON.stringify(quote_blocks)` (AI-SPEC §4b context-window discipline — NOT `source_text_excerpt`)"
    - "Batch size up to 100 inputs per OpenAI call (API hard-cap); selection LIMIT 500 per Fn invocation"
    - "Retry-with-backoff: 3 attempts at 1s/3s/9s on 5xx + 429, surfacing Retry-After when present"
    - "Idempotent — `INSERT ... ON CONFLICT (chunk_id) DO NOTHING` so re-runs of the same selection window are safe"
    - "Cost telemetry — one PostHog `$ai_generation` event per batch with `model=text-embedding-3-small`, `provider=vercel-ai-gateway`, `input_tokens=usage.total_tokens`, `cost_usd=0.02/1_000_000 * input_tokens`, emitted via 60-02 `_shared/posthog-rag-events.ts`"
    - "POST `/functions/v1/rag-embed-approved` accepts no body (cron-tick) OR `{ chunk_ids: string[] }` for admin manual backfill — both modes share the same per-batch path"
    - "Retracted chunks (`retracted_at IS NOT NULL`) MUST NOT be embedded — WHERE-clause guard + RLS-defense-in-depth"
    - "NO cron schedule registered in this plan — cron migration lives exclusively in 60-15 (Fn-deploy-before-cron-push rule per `[[feedback_fn_deploy_before_cron_db_push]]`)"
    - "Per-Fn `deno.json` ships explicit imports — `supabase functions deploy --import-map` is ignored on CLI v2.101.0+ per `[[reference_supabase_functions_deploy_import_map_flag]]`"
    - "`Deno.serve()` guarded by `if (import.meta.main)` to keep `deno test` runnable per `[[reference_deno_test_top_level_serve_trap]]`"
  artifacts:
    - path: "supabase/functions/rag-embed-approved/openai.ts"
      provides: "OpenAIEmbedBatchClient class — batchEmbed(texts) -> { embeddings, totalTokens }, healthCheck()"
      min_lines: 60
    - path: "supabase/functions/rag-embed-approved/index.ts"
      provides: "Edge Fn handler — selection query, batching loop, INSERT ON CONFLICT, cost emit"
      min_lines: 120
    - path: "supabase/functions/rag-embed-approved/deno.json"
      provides: "Per-Fn import map (npm:@supabase/supabase-js@2, jsr:@std/dotenv, posthog-server, etc.)"
      contains: '"imports"'
    - path: "supabase/functions/rag-embed-approved/__tests__/openai.test.ts"
      provides: "Vitest unit — Gateway response mock, batch ≤100 enforcement, retry-on-429, token usage propagation"
    - path: "supabase/functions/rag-embed-approved/__tests__/embed-pipeline.test.ts"
      provides: "Vitest unit — selection filters (published+non-retracted+missing-embedding), batch size 100, ON CONFLICT semantics, retracted-excluded, cost-event-per-batch"
    - path: "supabase/functions/rag-embed-approved/__tests__/integration.test.ts"
      provides: "Deno integration — seed rag_chunks + invoke handler + assert external_kb_embeddings populated + cost events captured (RED-state until 60-15 Fns are live; gated by `LIVE_DB=true` env)"
  key_links:
    - from: "supabase/functions/rag-embed-approved/index.ts"
      to: "public.rag_chunks JOIN public.external_kb_embeddings"
      via: "SQL selection — published_at IS NOT NULL AND retracted_at IS NULL AND NOT EXISTS embedding"
      pattern: "published_at IS NOT NULL.*NOT EXISTS.*external_kb_embeddings"
    - from: "supabase/functions/rag-embed-approved/index.ts"
      to: "Vercel AI Gateway"
      via: "AI_GATEWAY_BASE_URL + AI_GATEWAY_API_KEY_CONSUMER + OPENAI_EMBED_MODEL"
      pattern: "AI_GATEWAY_BASE_URL"
    - from: "supabase/functions/rag-embed-approved/index.ts"
      to: "supabase/functions/_shared/posthog-rag-events.ts"
      via: "emit$aiGeneration({ model, provider, input_tokens, cost_usd })"
      pattern: "emit.*ai_generation|\\$ai_generation"
---

<objective>
Ship the approved-chunk embedding pipeline as the Phase 60 Wave 1 Edge Function `rag-embed-approved`. Selects approved, non-retracted, non-embedded chunks from `public.rag_chunks` (Phase 50 schema), embeds them in batches of 100 via OpenAI `text-embedding-3-small` (1536-dim) through the Vercel AI Gateway, and inserts into `public.external_kb_embeddings` (existing pgvector(1536) + HNSW index from Phase 50 Wave 1). Idempotent via `ON CONFLICT (chunk_id) DO NOTHING`. Emits per-batch cost telemetry via 60-02's shared PostHog `$ai_generation` helper. NO cron schedule in this plan — cron registration is the sole responsibility of 60-15 (Fn-deploy-before-cron-push ordering rule).

Purpose: without this Edge Fn, approved chunks are dead data and `external_kb_embeddings` stays empty — `rag-retrieve` (60-06) has nothing to ANN-search against, and the entire Phase 60 retrieval/synthesis chain collapses. RAG-02 maps here.
Output: 1 Edge Fn (3 source files + per-Fn deno.json) + 3 vitest/Deno test files. Deployed (but un-cron-scheduled) at end of plan.
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
@.planning/phases/50-admin-curated-rag-knowledge-base-peptide-topic-research-scra/50-07-PLAN.md
@supabase/migrations/20260519000003_rag_chunks_table.sql
@supabase/migrations/20260519000004_external_kb_embeddings_table.sql
@supabase/functions/_shared/openai-embed.ts
@supabase/functions/_shared/posthog-server.ts

<interfaces>
<!-- Concrete contracts the executor consumes — extracted from migrations + sibling plans. -->
<!-- Do NOT re-explore the codebase to discover these; use them directly. -->

From `supabase/migrations/20260519000003_rag_chunks_table.sql` — `public.rag_chunks` columns this Fn reads:
- `id uuid primary key`
- `topic_id uuid not null references rag_topics(id)`
- `source_id uuid not null references rag_sources(id)`
- `source_text_excerpt text not null` (NOT embedded — too noisy)
- `summary text not null` (PART of embed input)
- `quote_blocks jsonb default '[]'::jsonb` (PART of embed input)
- `topic_tag text not null`
- `source_tier public.rag_source_tier not null` (enum 'A' | 'B' | 'C')
- `published_at timestamptz` (null = not published; non-null = approved)
- `retracted_at timestamptz` (null = active; non-null = retracted, MUST skip)
- `status` (constraint: retracted ⇔ retracted_at populated)

From `supabase/migrations/20260519000004_external_kb_embeddings_table.sql` — target write columns:
- `chunk_id uuid not null references rag_chunks(id) on delete cascade` (UNIQUE — drives ON CONFLICT)
- `embedding vector(1536) not null`
- `topic_id uuid`, `source_id uuid`, `topic_tag text`, `source_tier rag_source_tier`, `freshness_window_days int` (denormalized from rag_chunks JOIN rag_sources for fast filter)
- HNSW index `external_kb_embeddings_hnsw` on `embedding vector_cosine_ops`
- Tag/tier btree on `(topic_tag, source_tier)`

From sibling plan 60-01 (assumed shipped by Wave 0):
- Migration `20281201000002_phase60_secdef_rpcs.sql` adds `public.list_pending_embed_chunks(p_limit int)` SECDEF RPC returning rows joined with `rag_sources.freshness_window_days` — this Fn calls that RPC instead of inlining the JOIN (decouples from RLS on rag_sources).
- If 60-01 elects to keep the JOIN inline at execute-time (planner discretion), this Fn falls back to a parameterized SQL query via `supabase.from('rag_chunks').select(...)` with explicit JOIN — acceptable per 60-01 surface contract.

From sibling plan 60-02 (assumed shipped by Wave 0):
- `supabase/functions/_shared/posthog-rag-events.ts` exports:
  - `emitAiGeneration(opts: { distinctId?: string; model: string; provider: string; inputTokens: number; outputTokens?: number; costUsd: number; latencyMs: number; promptContext?: Record<string, unknown> }): Promise<void>`
  - `emitRagCostEnvelopeBreach(opts: { ... }): Promise<void>` (envelope guardrail; not called by this Fn unless `RAG_DAILY_BUDGET_USD` exceeded)
- `supabase/functions/_shared/slack-guardrail-alert.ts` exports `alertSlack(message: string, severity: 'info'|'warn'|'crit')` — called once per Fn invocation that breaches per-batch cost guard.

From `supabase/functions/_shared/openai-embed.ts` (Phase 38 existing — single-text only):
- Existing single-text `embed(text, opts)` reads `AI_GATEWAY_API_KEY_CONSUMER`, `AI_GATEWAY_BASE_URL`, `OPENAI_EMBED_MODEL`.
- Phase 60 reuses the SAME env var names (do NOT introduce parallel `OPENAI_API_KEY` / `VERCEL_AI_GATEWAY_TOKEN` keys — the outline header drift is corrected here).
- New `OpenAIEmbedBatchClient` lives next to the Fn (NOT in `_shared/`) because Phase 60 is its only caller; pre-embed refusal scrub from `_shared/openai-embed.ts` is NOT applied (chunk content is admin-curated, not user-context).

Vercel AI Gateway endpoint (per AI-SPEC §3):
- URL: `${AI_GATEWAY_BASE_URL}/openai/v1/embeddings` (resolves to `https://ai-gateway.vercel.sh/v1/openai/v1/embeddings`)
- Method: POST
- Headers: `Authorization: Bearer ${AI_GATEWAY_API_KEY_CONSUMER}`, `Content-Type: application/json`
- Body: `{ "model": "text-embedding-3-small", "input": string[], "dimensions": 1536 }`
- Response: `{ data: [{ embedding: number[] }], usage: { prompt_tokens, total_tokens } }`
- Pricing: $0.020 / 1,000,000 input tokens (`text-embedding-3-small`)
</interfaces>

<reuse_targets>
<!-- Explicit per [[feedback_planner_prompt_explicit_reuse_targets]] — name the analog files. -->
- REUSE Phase 50 50-07-PLAN.md Task 1 verbatim where applicable: `supabase/functions/rag-embed-approved/openai.ts` — same `OpenAIEmbedClient` class shape, same hard-cap 100, same 3-attempt backoff. Adapt: rename to `OpenAIEmbedBatchClient` (so the existing `_shared/openai-embed.ts` `embed()` single-text helper is not shadowed), point at `AI_GATEWAY_API_KEY_CONSUMER` (Phase 38 convention), emit Bearer header.
- REUSE Phase 50 50-07-PLAN.md Task 2 verbatim where applicable: `supabase/functions/rag-embed-approved/index.ts` — selection query, batching loop, `INSERT ... ON CONFLICT (chunk_id) DO NOTHING`. Adapt: swap `gateOrThrow` + `logVendorCost` for 60-02's `emitAiGeneration` (PostHog `$ai_generation` event); guard `Deno.serve` under `import.meta.main`; ship per-Fn `deno.json`.
- DO NOT REUSE Phase 50 50-07-PLAN.md Task 5 (embed cron migration) — Phase 60 cron registration is owned exclusively by 60-15 per `[[feedback_fn_deploy_before_cron_db_push]]`.
</reuse_targets>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: OpenAI batch-embed client</name>
  <files>supabase/functions/rag-embed-approved/openai.ts, supabase/functions/rag-embed-approved/deno.json, supabase/functions/rag-embed-approved/__tests__/openai.test.ts</files>
  <read_first>supabase/functions/_shared/openai-embed.ts, .planning/phases/50-admin-curated-rag-knowledge-base-peptide-topic-research-scra/50-07-PLAN.md (Task 1)</read_first>
  <behavior>
    - Test 1: `batchEmbed(texts: string[])` posts to `${AI_GATEWAY_BASE_URL}/openai/v1/embeddings` with `Authorization: Bearer ${AI_GATEWAY_API_KEY_CONSUMER}`, body `{ model: 'text-embedding-3-small', input: texts, dimensions: 1536 }`, and returns `{ embeddings, totalTokens }`.
    - Test 2: `batchEmbed(texts)` throws synchronously when `texts.length > 100` (OpenAI API hard-cap).
    - Test 3: `batchEmbed([])` short-circuits to `{ embeddings: [], totalTokens: 0 }` without HTTP call.
    - Test 4: On HTTP 429 with `Retry-After: 2` header, client waits ≥1.8s then retries; succeeds on attempt 2; total attempts ≤3.
    - Test 5: On HTTP 503, client backs off 1s/3s/9s and surfaces a typed `OpenAIEmbedError` after 3 failures (asserts `error.attempts === 3`).
    - Test 6: Missing `AI_GATEWAY_API_KEY_CONSUMER` or `AI_GATEWAY_BASE_URL` env throws a clear configuration error before any HTTP call.
    - Test 7: `healthCheck()` calls `batchEmbed(['ok'])` and returns `{ ok: true, latencyMs: number }` on success; `{ ok: false, reason: string }` on failure.
  </behavior>
  <action>
    Write `supabase/functions/rag-embed-approved/openai.ts`:
    - `export class OpenAIEmbedBatchClient` with a private `fetchImpl` (defaults to global `fetch`; injected in tests).
    - Constructor reads env vars at instantiation: `AI_GATEWAY_BASE_URL`, `AI_GATEWAY_API_KEY_CONSUMER`, `OPENAI_EMBED_MODEL` (default `'text-embedding-3-small'` if env missing — but log a warn-once if missing because operator setup is supposed to provide it). Throw a typed `OpenAIEmbedConfigError` with the missing key name if base URL or API key absent.
    - Method `async batchEmbed(texts: string[]): Promise<{ embeddings: number[][]; totalTokens: number }>`:
      - Empty input short-circuit per Test 3.
      - Throw `OpenAIEmbedBatchSizeError` with message naming the over-cap count when `texts.length > 100`.
      - 3-attempt loop with sleeps `1000ms / 3000ms / 9000ms`. On 429 honor `Retry-After` header (seconds), clamped to ≤30s. On 5xx use base sleep schedule. On 4xx other than 429: throw immediately.
      - Body: `{ model: this.model, input: texts, dimensions: 1536 }`.
      - Response parse: `data` array maps to `embedding` arrays; `usage.total_tokens` becomes `totalTokens`. Validate `data.length === texts.length` and throw `OpenAIEmbedResponseError` if mismatched.
      - Throw `OpenAIEmbedError` after final attempt with `{ attempts, lastStatus, lastBody }` shape.
    - Method `async healthCheck(): Promise<{ ok: boolean; latencyMs?: number; reason?: string }>` — wraps `batchEmbed(['ok'])` in `performance.now()` deltas; catch and return reason on failure.
    - Export typed error subclasses (`OpenAIEmbedConfigError`, `OpenAIEmbedBatchSizeError`, `OpenAIEmbedResponseError`, `OpenAIEmbedError`) so the Fn entry can distinguish retry-exhausted from misconfigured.

    Write `supabase/functions/rag-embed-approved/deno.json`:
    - Tasks: `{ "test": "deno test --no-check --allow-env --allow-net ." }`.
    - Imports: `@supabase/supabase-js` → `npm:@supabase/supabase-js@^2.105`, `posthog-rag-events` → `../_shared/posthog-rag-events.ts`, `slack-guardrail-alert` → `../_shared/slack-guardrail-alert.ts`, `std/dotenv` → `jsr:@std/dotenv/load`, `zod` → `npm:zod@^3`.
    - Lint rules: `{ "rules": { "tags": ["recommended"] } }`.

    Write `supabase/functions/rag-embed-approved/__tests__/openai.test.ts` (vitest — runs under Node via `vite.config.ts`; mocks `fetch` directly):
    - Use `vi.fn()` for fetch injection through the client constructor (`new OpenAIEmbedBatchClient({ fetchImpl: mockFetch })`).
    - Cover all 7 behaviors above. Tests run with `npx vitest run --config vite.config.ts` (per `[[reference_vitest_4_projects_config_masks_default]]`).
  </action>
  <verify>
    <automated>bash -c "cd leanshot && (test -f node_modules/.bin/vitest || npm install --ignore-scripts) && npx vitest run --config vite.config.ts supabase/functions/rag-embed-approved/__tests__/openai.test.ts && $HOME/.deno/bin/deno check --no-check supabase/functions/rag-embed-approved/openai.ts"</automated>
  </verify>
  <done>
    - `openai.ts` exports `OpenAIEmbedBatchClient` + 4 typed error subclasses; deno check passes.
    - All 7 vitest cases green; no real network calls (fetch mocked).
    - `deno.json` present with explicit imports map (no reliance on repo-root `import_map.json`).
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: rag-embed-approved Edge Function handler</name>
  <files>supabase/functions/rag-embed-approved/index.ts, supabase/functions/rag-embed-approved/__tests__/embed-pipeline.test.ts</files>
  <read_first>supabase/functions/rag-embed-approved/openai.ts, supabase/migrations/20260519000003_rag_chunks_table.sql, supabase/migrations/20260519000004_external_kb_embeddings_table.sql, supabase/functions/_shared/posthog-server.ts, .planning/phases/50-admin-curated-rag-knowledge-base-peptide-topic-research-scra/50-07-PLAN.md (Task 2)</read_first>
  <behavior>
    - Test 1: Handler with no body (cron-tick) selects up to 500 candidates matching `published_at IS NOT NULL AND retracted_at IS NULL AND NOT EXISTS (SELECT 1 FROM external_kb_embeddings WHERE chunk_id = rag_chunks.id)` joined with `rag_sources` for `freshness_window_days`.
    - Test 2: Handler with body `{ chunk_ids: ['uuid-1','uuid-2'] }` restricts the candidate set to those IDs only (still applying published/non-retracted/no-embedding filter); responds 400 if any ID is non-uuid.
    - Test 3: Batching — 250 candidates produces exactly 3 OpenAI calls (sizes 100/100/50) and 3 INSERT batches; per-call inputs are `summary + ' || ' + JSON.stringify(quote_blocks)`.
    - Test 4: Retracted chunks (with `retracted_at` non-null) are NOT embedded even if `chunk_ids` body forces them — selection re-filters.
    - Test 5: INSERT uses `ON CONFLICT (chunk_id) DO NOTHING` — second invocation over same candidates writes zero new rows AND does NOT re-call OpenAI (selection filter excludes already-embedded chunks).
    - Test 6: One `emitAiGeneration` call per batch with `provider='vercel-ai-gateway'`, `model='text-embedding-3-small'`, `inputTokens=usage.total_tokens`, `costUsd = 0.020 / 1_000_000 * inputTokens`, `latencyMs > 0`.
    - Test 7: When `OpenAIEmbedError` after retries propagates, handler returns 502 with `{ error: 'embed_failed', batch_index, attempts }`; partial batches already inserted are NOT rolled back (each batch is its own transaction-of-one); response includes `inserted_batches: N` so the cron can observe partial progress.
    - Test 8: GET `/healthz` returns `{ ok: boolean, openai_latency_ms?: number, db_ok: boolean }` with HTTP 200 when both healthy, HTTP 503 when either fails.
    - Test 9: When per-batch cost exceeds `RAG_PER_BATCH_BUDGET_USD` (default `0.05`), handler calls `alertSlack('embed batch cost breach...', 'warn')` once and continues; when daily-sum exceeds `RAG_DAILY_BUDGET_USD` (default `50`), handler aborts the run AND emits `emitRagCostEnvelopeBreach`.
    - Test 10: `Deno.serve` is invoked ONLY when `import.meta.main` is true; importing the module from a test does NOT bind a port (validated by importing in a vitest test without crash).
  </behavior>
  <action>
    Write `supabase/functions/rag-embed-approved/index.ts`:
    - Exports for tests: `export async function handleRequest(req: Request, deps: HandlerDeps): Promise<Response>` where `HandlerDeps` is `{ supabase, embedClient, emitAiGeneration, emitRagCostEnvelopeBreach, alertSlack, now: () => number }`. Production wiring builds `deps` from env + `OpenAIEmbedBatchClient` + 60-02 shared helpers.
    - Service-role Supabase client (autoRefreshToken:false, persistSession:false) — this is a cron-callable + admin-callable Fn; no JWT user context required (writing curated KB data, not PHI).
    - Selection query: prefer SECDEF RPC `public.list_pending_embed_chunks(p_limit int, p_chunk_ids uuid[] default null)` if 60-01 ships it (check by calling and falling back to inline SELECT on `PGRST202` "function not found"). Inline fallback:
      ```sql
      SELECT c.id, c.summary, c.quote_blocks, c.topic_id, c.source_id,
             c.source_tier, c.topic_tag, s.freshness_window_days
      FROM public.rag_chunks c
      JOIN public.rag_sources s ON s.id = c.source_id
      WHERE c.published_at IS NOT NULL
        AND c.retracted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.external_kb_embeddings e WHERE e.chunk_id = c.id
        )
        AND ($1::uuid[] IS NULL OR c.id = ANY($1::uuid[]))
      ORDER BY c.published_at ASC
      LIMIT $2;
      ```
    - Build embed input per chunk: `chunk.summary + ' || ' + JSON.stringify(chunk.quote_blocks ?? [])`.
    - Loop in slices of 100 chunks:
      1. Call `embedClient.batchEmbed(inputs)`; capture `{ embeddings, totalTokens }` + wall-clock latency.
      2. Build INSERT rows: `chunks.map((c, i) => ({ chunk_id: c.id, embedding: embeddings[i], topic_id: c.topic_id, source_id: c.source_id, source_tier: c.source_tier, topic_tag: c.topic_tag, freshness_window_days: c.freshness_window_days }))`.
      3. `await supabase.from('external_kb_embeddings').upsert(rows, { onConflict: 'chunk_id', ignoreDuplicates: true })`.
      4. Compute `costUsd = (0.020 / 1_000_000) * totalTokens`; check per-batch budget (env `RAG_PER_BATCH_BUDGET_USD`, default 0.05); on breach call `alertSlack(...)` once. Track `cumulativeCostUsd`; if it exceeds `RAG_DAILY_BUDGET_USD` (default 50), call `emitRagCostEnvelopeBreach` and break the loop (return 200 with partial-progress payload).
      5. `await emitAiGeneration({ model: 'text-embedding-3-small', provider: 'vercel-ai-gateway', inputTokens: totalTokens, costUsd, latencyMs })`.
    - Health route: if `req.method === 'GET' && new URL(req.url).pathname.endsWith('/healthz')` return health-check JSON per Test 8.
    - Response: `{ ok: true, batches: insertedBatches, chunks_embedded: total, cost_usd: cumulativeCostUsd, partial?: boolean }`.
    - At file bottom: `if (import.meta.main) Deno.serve((req) => handleRequest(req, buildProdDeps()));` — port bind ONLY when run as entrypoint (per `[[reference_deno_test_top_level_serve_trap]]`).

    Write `supabase/functions/rag-embed-approved/__tests__/embed-pipeline.test.ts` (vitest):
    - Construct fake `supabase` (object with `.rpc()`, `.from().select()`, `.from().upsert()` returning preconfigured rows).
    - Construct fake `embedClient` with deterministic `batchEmbed` returning `embeddings: texts.map(() => Array(1536).fill(0.01))`, `totalTokens: texts.length * 50`.
    - Capture `emitAiGeneration` / `emitRagCostEnvelopeBreach` / `alertSlack` invocations as `vi.fn()`.
    - Cover all 10 behaviors above. Use fake clock for cost-breach test.
  </action>
  <verify>
    <automated>bash -c "cd leanshot && npx vitest run --config vite.config.ts supabase/functions/rag-embed-approved/__tests__/embed-pipeline.test.ts && $HOME/.deno/bin/deno check --no-check supabase/functions/rag-embed-approved/index.ts"</automated>
  </verify>
  <done>
    - `index.ts` exports `handleRequest` for testability; `Deno.serve` guarded by `import.meta.main`.
    - 10/10 vitest cases green.
    - Selection query joins rag_sources, filters published+non-retracted+no-embedding.
    - Upsert uses `onConflict: 'chunk_id'` + `ignoreDuplicates: true`.
    - Cost emitted per batch via 60-02 helper.
    - deno check passes.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Deploy + Deno integration test (live-DB gated)</name>
  <files>supabase/functions/rag-embed-approved/__tests__/integration.test.ts</files>
  <read_first>supabase/functions/rag-embed-approved/index.ts, supabase/migrations/20260519000003_rag_chunks_table.sql</read_first>
  <behavior>
    - Test 1: `Deno.test` skipped when `LIVE_DB !== 'true'` — emits a `console.info` and returns; this keeps CI green while still letting the operator run live verification at phase close.
    - Test 2 (live): seed two `rag_chunks` rows with `published_at = now()`, `retracted_at IS NULL`, distinct content_hash; invoke `handleRequest` with a mocked-Gateway `embedClient`; assert `external_kb_embeddings` gains 2 rows keyed by the seeded chunk IDs; assert `embedding` length === 1536 in DB.
    - Test 3 (live): re-invoke handler with same seed (no changes); assert ZERO new rows inserted AND zero new OpenAI calls observed (selection filter excludes already-embedded chunks).
    - Test 4 (live): seed a third chunk, mark it `retracted_at = now()`; invoke handler; assert third chunk has NO embedding row.
    - Test 5 (live): cleanup — DELETE the seeded chunks AND their cascaded embeddings; verify table count unchanged from pre-test baseline.
  </behavior>
  <action>
    Write `supabase/functions/rag-embed-approved/__tests__/integration.test.ts` (Deno test):
    - Top-of-file gate: `if (Deno.env.get('LIVE_DB') !== 'true') { console.info('skip integration: LIVE_DB unset'); Deno.exit(0); }` — emit-and-exit pattern (so CI runs the file without failure).
    - Import `handleRequest` from `../index.ts` and a real `createClient` from `npm:@supabase/supabase-js@2` using `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` from env.
    - Build a deterministic stub `embedClient` (real DB writes, mocked Gateway) so the test doesn't burn OpenAI credit on every CI tick.
    - Seed via `supabase.from('rag_chunks').insert([...])` with valid `topic_id` + `source_id` foreign keys (look up the first existing row in each table; if either is empty fail the test with a clear "Phase 50 Wave 1 seed data missing" message — does NOT auto-create FK targets).
    - Each assertion uses `Deno.test` step. Cleanup runs in a `finally`.
    - Deploy command (operator-runnable, NOT in `<automated>` because deploy requires Supabase access token):
      ```
      supabase functions deploy rag-embed-approved --no-verify-jwt --linked --project-ref <ref>
      ```
      Document this in the SUMMARY at phase close — deployment of all 9 Phase 60 Fns is the responsibility of 60-15 per the BLOCKING-deploy-then-cron-push ordering rule.
  </action>
  <verify>
    <automated>bash -c "cd leanshot && $HOME/.deno/bin/deno test --no-check --allow-env --allow-net supabase/functions/rag-embed-approved/__tests__/integration.test.ts 2>&1 | tee /tmp/rag-embed-int.log; grep -qE 'skip integration: LIVE_DB unset|ok \\| 5 passed' /tmp/rag-embed-int.log"</automated>
  </verify>
  <done>
    - Integration file present; LIVE_DB-gated skip emits expected log under default `LIVE_DB` (unset).
    - File deno-checks clean.
    - No `Deno.serve` import side-effect (file imports `handleRequest`, not the module's top-level `serve()` block — verified by Test 10 in Task 2 already).
    - Deploy step is documented for 60-15 (NOT executed here — Phase 60 ordering rule).
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Edge Fn → Vercel AI Gateway | Outbound network — credential `AI_GATEWAY_API_KEY_CONSUMER` carries embed-call authorization; gateway proxies to OpenAI |
| Edge Fn → Supabase Postgres | Service-role JWT — bypasses RLS for write into `external_kb_embeddings`; read from `rag_chunks` |
| Cron → Edge Fn (later, in 60-15) | Out of scope here; the Fn deploys with `--no-verify-jwt` so any caller knowing the URL can trigger an embed; mitigated by `--no-verify-jwt` + admin-only URL + per-batch + daily cost envelope guardrail |
| Admin → Edge Fn (backfill mode) | `{chunk_ids}` body input — untrusted UUID list crossing into SQL parameter binding |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-60-05-01 | Information Disclosure | `AI_GATEWAY_API_KEY_CONSUMER` exposed in logs / error messages | mitigate | `openai.ts` error messages NEVER include the Bearer token; structured logs strip `Authorization` header before serialization; key only read at client construction, never re-logged. |
| T-60-05-02 | Information Disclosure | PII / PHI leak via embedding text into OpenAI | mitigate | Embed input = `summary + ' || ' + JSON.stringify(quote_blocks)` — both fields are admin-curated KB content per PHARMA-02 carveout (no `user_context`, no `<user_data>` fence content, no patient identifiers). `source_text_excerpt` is NOT embedded (would include scraped HTML that COULD contain author-identifying metadata). Pre-embed refusal scrub from `_shared/openai-embed.ts` does NOT apply (chunk content is admin-vetted). Documented in SUMMARY. |
| T-60-05-03 | Tampering | SQL injection via `chunk_ids` body parameter | mitigate | Body parsed with zod `z.object({ chunk_ids: z.array(z.string().uuid()).max(500).optional() })` BEFORE SQL binding; reject with 400 on parse failure. Parameterized query uses `$1::uuid[]` binding via supabase-js, never string-concatenation. |
| T-60-05-04 | Denial of Service / Cost-Runaway | Adversary / cron-bug triggers unbounded embedding cost | mitigate | Three layers: (a) per-Fn-invocation LIMIT 500 chunks at selection time; (b) per-batch cost guard (`RAG_PER_BATCH_BUDGET_USD`, default $0.05) → Slack warn; (c) cumulative-per-run daily cost guard (`RAG_DAILY_BUDGET_USD`, default $50) → emit `emitRagCostEnvelopeBreach` + abort run. Cron schedule (60-15) sets frequency every 5 minutes — bounded burn under guardrails. |
| T-60-05-05 | Tampering | Embedding model swap / dimension drift | mitigate | `OPENAI_EMBED_MODEL` env explicit (default `text-embedding-3-small`); body posts `dimensions: 1536` explicit. INSERT into `vector(1536)` column rejects any other dimension — DB-level dimension check is fail-safe. Test 6 in Task 2 asserts the dimension is propagated. |
| T-60-05-06 | Repudiation | "Who embedded this chunk?" / "What did embedding cost?" not auditable | mitigate | Every batch emits a PostHog `$ai_generation` event with `model`, `provider`, `inputTokens`, `costUsd`, `latencyMs`, batch-size, chunk_ids list (truncated to 100). 60-14 cost dashboard reads these events. |
| T-60-05-07 | Denial of Service | Gateway 429 / 503 cascading retry storm | mitigate | 3-attempt backoff with `Retry-After` honor; total max wait per batch ≤13s; on exhaustion abort batch with 502 (next cron tick at +5min retries selection — the un-embedded chunks remain queued). |
| T-60-05-08 | Tampering / Spoofing | Cron invokes Fn before it's deployed | accept | NOT this plan's risk — Phase 60 ordering rule `[[feedback_fn_deploy_before_cron_db_push]]` makes 60-15 sole owner of cron registration AFTER Fn deploy. 60-05 deploys the Fn (manually or via 60-15); no cron exists at end of this plan. |
| T-60-05-SC | Tampering | Supply-chain — npm: imports `npm:@supabase/supabase-js@2` + `npm:zod@3` resolved by Deno at deploy | mitigate | Versions pinned at `^2.105` (supabase-js — existing project usage), `^3` (zod — existing usage). No new packages introduced beyond what the project already uses. No `[ASSUMED]` / `[SUS]` packages per RESEARCH.md Package Legitimacy Audit (none new). |

ASVS L1 dispositions: T-60-05-01 / -02 / -03 / -04 / -05 are blocked-on-mitigation; -06 is auditability (must-have for cost dashboard); -07 / -08 / -SC are accept/transfer where bounded.
</threat_model>

<verification>
- `npx vitest run --config vite.config.ts supabase/functions/rag-embed-approved/__tests__/` reports all 17 test cases green (7 openai + 10 embed-pipeline).
- `$HOME/.deno/bin/deno check --no-check supabase/functions/rag-embed-approved/{openai,index}.ts` reports zero type errors.
- `$HOME/.deno/bin/deno test --no-check --allow-env --allow-net supabase/functions/rag-embed-approved/__tests__/integration.test.ts` exits 0 with the `LIVE_DB unset` skip message under CI defaults; rerunnable with `LIVE_DB=true` against `--linked` Supabase for operator validation.
- Grep gate: `grep -c "import.meta.main" supabase/functions/rag-embed-approved/index.ts` returns ≥1 (per `[[reference_deno_test_top_level_serve_trap]]`).
- Grep gate: `grep -E "^import|^from" supabase/functions/rag-embed-approved/index.ts | grep -v '^#' | grep -c 'posthog-rag-events'` returns ≥1 (uses 60-02 shared helper).
- NO cron schedule introduced — `find supabase/migrations -name "*phase60*embed*cron*"` returns empty (cron is 60-15's exclusive responsibility).
- Deploy verification: deferred to 60-15 (BLOCKING task) per Phase 60 ordering rule. This plan's "done" is code + tests landed on `main`.
</verification>

<success_criteria>
- 1 Edge Fn (`rag-embed-approved`) shipped to `supabase/functions/rag-embed-approved/`: `openai.ts`, `index.ts`, `deno.json`, `__tests__/{openai,embed-pipeline,integration}.test.ts`.
- `OpenAIEmbedBatchClient` enforces ≤100 batch, 3-attempt backoff, Retry-After honor, configuration validation.
- Handler selects published + non-retracted + no-embedding chunks; embeds in slices of 100; upserts with `ON CONFLICT (chunk_id) DO NOTHING`; emits one `emitAiGeneration` event per batch.
- Per-batch + daily cost guardrails wired (Slack warn at $0.05/batch breach; abort + PostHog envelope-breach event at $50/day breach).
- `Deno.serve` guarded by `import.meta.main`.
- Per-Fn `deno.json` with explicit imports map (no reliance on repo-root `import_map.json`).
- All vitest tests green; deno check green; integration test skip-or-pass under CI.
- NO cron migration in this plan (60-15 owns).
</success_criteria>

<output>
Create `.planning/phases/60-rag-knowledge-base-completion-waves-2-4/60-05-SUMMARY.md` when done — capture:
- Files created (with line counts).
- Test outcomes (vitest pass count; deno check status; integration skip vs live-pass).
- Env vars consumed (`AI_GATEWAY_API_KEY_CONSUMER`, `AI_GATEWAY_BASE_URL`, `OPENAI_EMBED_MODEL`, `RAG_PER_BATCH_BUDGET_USD`, `RAG_DAILY_BUDGET_USD`).
- Deploy status: NOT deployed in this plan — handed off to 60-15 atomic-deploy step per Phase 60 ordering rule.
- Carry-overs / risks / open questions for 60-06 (rag-retrieve consumes the same `external_kb_embeddings` rows this Fn writes; schema is unchanged).
</output>
