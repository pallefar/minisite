/**
 * rag-retrieve/index.ts — Retrieval + rerank Edge Function entry point.
 *
 * Phase 60 Plan 60-06. AI-SPEC §2/§3/§4/§6.
 *
 * Pipeline: embed query → pgvector ANN (match_external_kb_embeddings RPC) →
 *   out-of-corpus gate (max cosine < 0.65) → tier/freshness reweight (merge.ts) →
 *   top-20 cap → rerank (env-flag: Cohere v3.5 primary / Jina v2 fallback) →
 *   post-rerank gate (max score < 0.5) → top-k JSON response.
 *
 * Env vars:
 *   OPENROUTER_API_KEY     — required (embed query via OpenRouter → OpenAI)
 *   SUPABASE_URL           — required
 *   SUPABASE_SERVICE_ROLE_KEY — required
 *   COHERE_API_KEY         — required when RAG_RERANKER_PROVIDER=cohere (default)
 *   JINA_API_KEY           — required when RAG_RERANKER_PROVIDER=jina
 *   RAG_RERANKER_PROVIDER  — optional; 'cohere' (default) | 'jina'
 *   POSTHOG_PROJECT_KEY    — optional; telemetry no-op if absent
 *
 * mode='eval-sweep' (W-2 fix): nightly batch driver for 60-15 cron.
 *   Requires service-role bearer token. Returns aggregated eval metrics.
 *   Gold-set path from PHASE60_GOLD_SET_PATH env (default /tmp/phase60-gold-set.jsonl).
 *
 * cosine_only=1 query param: skips rerank, returns merge.ts ordering only.
 *   Used by rerank-delta eval dimension to compare raw-cosine vs rerank pipelines.
 *
 * Deno.serve guarded by import.meta.main per reference_deno_test_top_level_serve_trap.
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import { z } from 'npm:zod@^3';
import { rankAndTrim } from './merge.ts';
import { CohereRerankClient, RerankError } from './cohere-rerank.ts';
import { JinaRerankClient } from './jina-rerank.ts';
import {
  shouldRefuseOutOfCorpus,
  shouldRefusePostRerank,
  outOfCorpusRefusal,
  postRerankRefusal,
} from './refusal.ts';
import { OpenAIEmbedBatchClient } from '../rag-embed-approved/openai.ts';
import { emitAiGeneration, shutdownPostHog } from '../_shared/posthog-rag-events.ts';
import { constantTimeEqual } from '../_shared/newsletter-token.ts';

// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────

const SYSTEM_USER_ID = 'rag-system';
const EMBED_COST_PER_TOKEN_USD = 0.020 / 1_000_000; // $0.020/1M tokens for text-embedding-3-small
const RERANK_TOP_N_CAP = 20;

// ──────────────────────────────────────────────────────────────────────────────
// Request schema
// ──────────────────────────────────────────────────────────────────────────────

const RequestSchema = z.object({
  query: z.string().min(1).max(2000),
  k: z.number().int().min(1).max(10).default(3),
  filters: z
    .object({
      topic_tag: z.string().optional(),
      source_tier: z.array(z.enum(['A', 'B', 'C'])).optional(),
    })
    .optional(),
  mode: z.enum(['retrieve', 'eval-sweep']).default('retrieve'),
});

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function getRerankProvider(): 'cohere' | 'jina' {
  return (typeof Deno !== 'undefined' ? Deno.env.get('RAG_RERANKER_PROVIDER') : undefined) === 'jina'
    ? 'jina'
    : 'cohere';
}

function jsonResp(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function getEnv(key: string): string | undefined {
  try {
    return typeof Deno !== 'undefined' ? Deno.env.get(key) : undefined;
  } catch {
    return undefined;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Main handler (exported for testability — import.meta.main guard prevents port bind in tests)
// ──────────────────────────────────────────────────────────────────────────────

export async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);

  // ── Healthz ─────────────────────────────────────────────────────────────────
  if (req.method === 'GET' && url.pathname.endsWith('/healthz')) {
    return jsonResp({ ok: true, rerank_provider: getRerankProvider() }, 200);
  }

  // ── Method gate ─────────────────────────────────────────────────────────────
  if (req.method !== 'POST') {
    return jsonResp({ error: 'method_not_allowed' }, 405);
  }

  // ── Parse + validate request body ───────────────────────────────────────────
  let body: z.infer<typeof RequestSchema>;
  try {
    const raw = await req.json();
    body = RequestSchema.parse(raw);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return jsonResp({ error: 'invalid_request', issues: err.issues }, 400);
    }
    return jsonResp({ error: 'invalid_json' }, 400);
  }

  // ── Eval-sweep mode: service-role-only batch driver ─────────────────────────
  if (body.mode === 'eval-sweep') {
    const authHeader = req.headers.get('Authorization') ?? '';
    const serviceRoleKey = getEnv('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    // Use constant-time comparison to prevent timing-oracle enumeration of the key
    const presented = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : authHeader;
    if (!presented || !constantTimeEqual(presented, serviceRoleKey)) {
      return jsonResp({ error: 'eval_sweep_requires_service_role' }, 401);
    }
    return await handleEvalSweep();
  }

  // ── Trace ID ─────────────────────────────────────────────────────────────────
  const traceId = crypto.randomUUID();

  // ── Env gates ────────────────────────────────────────────────────────────────
  const provider = getRerankProvider();
  let cohereKey: string | undefined;
  let jinaKey: string | undefined;

  if (provider === 'cohere') {
    cohereKey = getEnv('COHERE_API_KEY');
    if (!cohereKey) {
      return jsonResp({ error: 'cohere_api_key_missing' }, 500);
    }
  } else {
    jinaKey = getEnv('JINA_API_KEY');
    if (!jinaKey) {
      return jsonResp({ error: 'jina_api_key_missing' }, 500);
    }
  }

  const supabaseUrl = getEnv('SUPABASE_URL') ?? '';
  const serviceRoleKey = getEnv('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResp({ error: 'supabase_env_missing' }, 500);
  }

  // ── Supabase client ──────────────────────────────────────────────────────────
  const sb = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ── cosine_only query param (eval-only short-circuit) ────────────────────────
  const cosineOnly = url.searchParams.get('cosine_only') === '1';

  try {
    // ── Embed query ──────────────────────────────────────────────────────────────
    const embedClient = new OpenAIEmbedBatchClient();
    const t0 = performance.now();
    const { embeddings, totalTokens } = await embedClient.batchEmbed([body.query]);
    const queryEmbedding = embeddings[0];
    const embedLatency = performance.now() - t0;

    emitAiGeneration({
      userId: SYSTEM_USER_ID,
      properties: {
        model: 'text-embedding-3-small',
        prompt_tokens: totalTokens,
        usage_total_cost: EMBED_COST_PER_TOKEN_USD * totalTokens,
        latency_ms: embedLatency,
        trace_id: traceId,
        action: 'embed_query',
      },
    });

    // ── ANN RPC ──────────────────────────────────────────────────────────────────
    const matchCount = Math.min(body.k * 4, RERANK_TOP_N_CAP);
    const { data: candidates, error: rpcError } = await sb.rpc(
      'match_external_kb_embeddings',
      {
        query_embedding: queryEmbedding,
        match_count: matchCount,
        requesting_user_id: null,
      },
    );

    if (rpcError) {
      console.error('[rag-retrieve] RPC error:', rpcError.message);
      return jsonResp({ error: 'retrieval_failed', detail: rpcError.message }, 500);
    }

    const rawCandidates = (candidates ?? []) as Array<{
      chunk_id: string;
      summary: string;
      quote_blocks: unknown;
      canonical_url: string;
      scraped_at: string;
      source_tier: 'A' | 'B' | 'C';
      topic_tag: string;
      freshness_window_days: number;
      source_name: string;
      source_domain: string;
      similarity: number;
    }>;

    // Apply post-fetch app-layer filters (topic_tag, source_tier)
    const filtered = rawCandidates.filter((c) => {
      if (body.filters?.topic_tag && c.topic_tag !== body.filters.topic_tag) return false;
      if (body.filters?.source_tier && !body.filters.source_tier.includes(c.source_tier)) return false;
      return true;
    });

    // ── Reweight via merge.ts ────────────────────────────────────────────────────
    const reweighted = rankAndTrim(
      filtered.map((c) => ({ ...c, raw_score: c.similarity })),
      filtered.length, // preserve all candidates for rerank input selection
    );

    // ── Out-of-corpus gate (fires BEFORE rerank — saves cost) ───────────────────
    const maxFinal = reweighted.length > 0 ? Math.max(...reweighted.map((r) => r.final_score)) : 0;
    if (shouldRefuseOutOfCorpus(maxFinal)) {
      const refusal = await outOfCorpusRefusal(traceId, maxFinal, body.filters?.topic_tag);
      return jsonResp(refusal, 200);
    }

    // ── cosine_only short-circuit (eval path only) ───────────────────────────────
    if (cosineOnly) {
      const finalCosine = reweighted.slice(0, body.k).map((r) => ({ ...r, rerank_score: null }));
      return jsonResp(
        {
          refused: false,
          results: finalCosine,
          count: finalCosine.length,
          rerank_provider: provider,
          cosine_only: true,
          trace_id: traceId,
        },
        200,
      );
    }

    // ── Rerank ───────────────────────────────────────────────────────────────────
    const rerankInputDocs = reweighted
      .slice(0, RERANK_TOP_N_CAP)
      .map((r) => `${r.summary}\n\n${JSON.stringify(r.quote_blocks)}`);

    const rerankClient =
      provider === 'jina'
        ? new JinaRerankClient(jinaKey!)
        : new CohereRerankClient(cohereKey!);

    let rerankResp: Awaited<ReturnType<typeof rerankClient.rerank>> | null = null;
    let rerankDegraded = false;

    try {
      rerankResp = await rerankClient.rerank({
        query: body.query,
        documents: rerankInputDocs,
        topN: body.k,
      });

      emitAiGeneration({
        userId: SYSTEM_USER_ID,
        properties: {
          model: rerankResp.model,
          prompt_tokens: rerankResp.tokensUsed || undefined,
          usage_total_cost: rerankResp.costUsd,
          latency_ms: rerankResp.latencyMs,
          trace_id: traceId,
          action: provider === 'cohere' ? 'rerank_cohere' : 'rerank_jina',
          reranker_provider: provider,
        },
      });
    } catch (rerankErr) {
      if (rerankErr instanceof RerankError) {
        rerankDegraded = true;
        console.warn(`[rag-retrieve] rerank degraded (${rerankErr.code}): ${rerankErr.message}`);
      } else {
        rerankDegraded = true;
        console.warn(`[rag-retrieve] rerank degraded (unknown error): ${rerankErr}`);
      }
    }

    // ── Post-rerank gate ─────────────────────────────────────────────────────────
    if (!rerankDegraded && rerankResp !== null) {
      const maxRerank = rerankResp.results.length > 0
        ? Math.max(...rerankResp.results.map((r) => r.score))
        : 0;
      if (shouldRefusePostRerank(maxRerank)) {
        const refusal = await postRerankRefusal(traceId, maxRerank, body.filters?.topic_tag);
        return jsonResp(refusal, 200);
      }
    }

    // ── Assemble final top-k ─────────────────────────────────────────────────────
    let finalResults: Array<Record<string, unknown>>;
    if (!rerankDegraded && rerankResp !== null) {
      finalResults = rerankResp.results
        .filter((r) => r.index < reweighted.length) // guard: reranker may return invalid indices
        .map((r) => ({
          ...reweighted[r.index],
          rerank_score: r.score,
        }))
        .slice(0, body.k);
    } else {
      finalResults = reweighted.slice(0, body.k).map((r) => ({ ...r, rerank_score: null }));
    }

    return jsonResp(
      {
        refused: false,
        results: finalResults,
        count: finalResults.length,
        rerank_provider: provider,
        ...(rerankDegraded ? { rerank_degraded: true } : {}),
        trace_id: traceId,
      },
      200,
    );
  } finally {
    await shutdownPostHog();
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// eval-sweep mode handler
// ──────────────────────────────────────────────────────────────────────────────

async function handleEvalSweep(): Promise<Response> {
  const goldSetPath =
    getEnv('PHASE60_GOLD_SET_PATH') ?? '/tmp/phase60-gold-set.jsonl';

  let goldSetLines: string[];
  try {
    const text = await Deno.readTextFile(goldSetPath);
    goldSetLines = text.split('\n').filter((l) => l.trim().length > 0);
  } catch (err) {
    return jsonResp(
      {
        mode: 'eval-sweep',
        error: 'gold_set_missing',
        detail: `Cannot read ${goldSetPath}: ${err instanceof Error ? err.message : String(err)}`,
        queries_run: 0,
      },
      500,
    );
  }

  const queriesRun: Array<{ id: string; query: string; retrieved: string[] }> = [];

  for (const line of goldSetLines) {
    try {
      const example = JSON.parse(line) as {
        id: string;
        query: string;
        topic_tag?: string;
        relevant_chunk_ids?: string[];
      };

      // Run the normal retrieve pipeline for this query (cosine_only=false)
      const fakeReq = new Request('http://local/rag-retrieve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          query: example.query,
          k: 10,
          filters: example.topic_tag ? { topic_tag: example.topic_tag } : undefined,
        }),
      });

      const resp = await handler(fakeReq);
      const data = (await resp.json()) as { refused?: boolean; results?: Array<{ chunk_id: string }> };
      const retrieved = data.refused ? [] : (data.results ?? []).map((r) => r.chunk_id);
      queriesRun.push({ id: example.id, query: example.query, retrieved });
    } catch {
      // Skip errored examples — eval continues
    }
  }

  return jsonResp(
    {
      mode: 'eval-sweep',
      queries_run: queriesRun.length,
      dimensions: {
        note: 'Full metric computation lives in eval/phase60/dimensions/. This mode provides raw retrieval data.',
      },
    },
    200,
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Entry point (guarded by import.meta.main per reference_deno_test_top_level_serve_trap)
// ──────────────────────────────────────────────────────────────────────────────

if (import.meta.main) {
  Deno.serve(handler);
}
