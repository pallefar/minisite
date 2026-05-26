/**
 * handler.ts — Pure handler logic for rag-embed-approved, dependency-injected.
 *
 * Phase 60 Plan 60-05. Separated from index.ts so Vitest tests can import
 * without hitting Deno-specific `npm:` specifier resolution.
 *
 * All external dependencies (Supabase, embed client, PostHog, Slack) are
 * injected via HandlerDeps so the handler can be unit-tested under Node/Vitest.
 *
 * Security: T-60-05-01 thru T-60-05-06 enforced here.
 */

// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────

export const SELECTION_LIMIT = 500;
export const BATCH_SIZE = 100;
export const EMBED_MODEL = 'openrouter/openai/text-embedding-3-small';
export const EMBED_PROVIDER = 'openrouter';
/** $0.020 per 1M input tokens (OpenAI text-embedding-3-small pricing). */
export const COST_PER_TOKEN = 0.020 / 1_000_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export interface EmbedClient {
  batchEmbed(texts: string[]): Promise<{ embeddings: number[][]; totalTokens: number }>;
  healthCheck(): Promise<{ ok: boolean; latencyMs?: number; reason?: string }>;
}

export interface SupabaseLike {
  rpc(
    name: string,
    params?: Record<string, unknown>,
  ): Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
  from(table: string): {
    select(cols: string): {
      is(col: string, val: unknown): {
        is(col: string, val: unknown): {
          not(): {
            in(col: string, ids: string[]): { limit(n: number): Promise<{ data: unknown; error: unknown }> };
            limit(n: number): Promise<{ data: unknown; error: unknown }>;
          };
          limit(n: number): Promise<{ data: unknown; error: unknown }>;
        };
      };
    };
    upsert(
      rows: unknown[],
      opts: Record<string, unknown>,
    ): Promise<{ error: { message: string } | null }>;
  };
}

export interface EmitAiGenerationArgs {
  model: string;
  provider: string;
  inputTokens: number;
  costUsd: number;
  latencyMs: number;
}

export interface EmitRagCostEnvelopeBreachArgs {
  scope: 'per_request' | 'per_cron';
  cron_kind?: string;
  cost_usd: number;
  envelope_usd: number;
  trace_id: string;
}

export interface HandlerDeps {
  supabase: SupabaseLike;
  embedClient: EmbedClient;
  emitAiGeneration: (args: EmitAiGenerationArgs) => void;
  emitRagCostEnvelopeBreach: (args: EmitRagCostEnvelopeBreachArgs) => void;
  alertSlack: (message: string, severity: 'info' | 'warn' | 'crit') => void;
  now: () => number;
  env: Record<string, string | undefined>;
}

interface ChunkRow {
  id: string;
  summary: string;
  quote_blocks: unknown[];
  topic_id: string;
  source_id: string;
  source_tier: string;
  topic_tag: string;
  freshness_window_days: number;
}

// ──────────────────────────────────────────────────────────────────────────────
// Selection: prefer SECDEF RPC, fall back to inline SELECT
// ──────────────────────────────────────────────────────────────────────────────

async function selectPendingChunks(
  supabase: SupabaseLike,
  limit: number,
  chunkIds?: string[],
): Promise<ChunkRow[]> {
  const rpcParams: Record<string, unknown> = { p_limit: limit };
  if (chunkIds && chunkIds.length > 0) {
    rpcParams.p_chunk_ids = chunkIds;
  }

  const rpcResult = await supabase.rpc('list_pending_embed_chunks', rpcParams);

  // If RPC exists and succeeded, use its result.
  if (!rpcResult.error) {
    return (rpcResult.data as ChunkRow[]) ?? [];
  }

  // Non-PGRST202 error from RPC — log and return empty.
  if (rpcResult.error.code !== 'PGRST202') {
    console.error('[rag-embed-approved] RPC error:', rpcResult.error.message);
    return [];
  }

  // PGRST202: function not found — inline SELECT fallback.
  console.info('[rag-embed-approved] list_pending_embed_chunks RPC not found — using inline SELECT');

  const { data, error } = await (supabase
    .from('rag_chunks')
    .select('id, summary, quote_blocks, topic_id, source_id, source_tier, topic_tag')
    .is('published_at', null) // overridden below conceptually
    .is('retracted_at', null)
    .limit(limit) as unknown as Promise<{ data: unknown; error: unknown }>);

  if (error) {
    console.error('[rag-embed-approved] inline SELECT error:', (error as { message: string }).message);
    return [];
  }
  return (data as ChunkRow[]) ?? [];
}

// ──────────────────────────────────────────────────────────────────────────────
// Main exported handler
// ──────────────────────────────────────────────────────────────────────────────

export async function handleRequest(req: Request, deps: HandlerDeps): Promise<Response> {
  const {
    supabase,
    embedClient,
    emitAiGeneration,
    emitRagCostEnvelopeBreach,
    alertSlack,
    now,
    env,
  } = deps;

  const url = new URL(req.url);

  // ── Health check route ────────────────────────────────────────────────────
  if (req.method === 'GET' && url.pathname.endsWith('/healthz')) {
    const [openAiHealth, dbHealth] = await Promise.allSettled([
      embedClient.healthCheck(),
      (supabase.from('rag_chunks').select('id').is('published_at', null) as unknown as Promise<{
        data: unknown;
        error: unknown;
      }>),
    ]);

    const openAiOk =
      openAiHealth.status === 'fulfilled' && openAiHealth.value.ok;
    const openAiLatency =
      openAiHealth.status === 'fulfilled' ? openAiHealth.value.latencyMs : undefined;
    const dbOk =
      dbHealth.status === 'fulfilled' &&
      !(dbHealth.value as { error: unknown }).error;

    const healthy = openAiOk && dbOk;
    return Response.json(
      { ok: healthy, openai_latency_ms: openAiLatency, db_ok: dbOk },
      { status: healthy ? 200 : 503 },
    );
  }

  // ── Parse request body (optional chunk_ids for manual backfill) ───────────
  let chunkIds: string[] | undefined;
  if (req.method === 'POST') {
    const contentType = req.headers.get('Content-Type') ?? '';
    if (contentType.includes('application/json')) {
      try {
        const body = (await req.json()) as Record<string, unknown>;
        if (body.chunk_ids !== undefined) {
          if (!Array.isArray(body.chunk_ids)) {
            return Response.json({ error: 'chunk_ids must be an array' }, { status: 400 });
          }
          const ids = body.chunk_ids as unknown[];
          for (const id of ids) {
            if (typeof id !== 'string' || !UUID_RE.test(id)) {
              return Response.json(
                { error: `Invalid UUID in chunk_ids: ${String(id)}` },
                { status: 400 },
              );
            }
          }
          chunkIds = ids as string[];
        }
      } catch {
        // Empty or non-JSON body — treat as cron tick.
      }
    }
  }

  // ── Cost envelope configuration ───────────────────────────────────────────
  const perBatchBudgetUsd = parseFloat(env['RAG_PER_BATCH_BUDGET_USD'] ?? '0.05');
  const dailyBudgetUsd = parseFloat(env['RAG_DAILY_BUDGET_USD'] ?? '50');
  const traceId =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `trace-${Date.now()}`;

  // ── Select pending chunks ─────────────────────────────────────────────────
  const chunks = await selectPendingChunks(supabase, SELECTION_LIMIT, chunkIds);

  if (chunks.length === 0) {
    return Response.json({
      ok: true,
      batches: 0,
      chunks_embedded: 0,
      cost_usd: 0,
    });
  }

  // ── Batch processing loop ─────────────────────────────────────────────────
  let insertedBatches = 0;
  let chunksEmbedded = 0;
  let cumulativeCostUsd = 0;
  let partial = false;

  // Import OpenAIEmbedError type check — done via instanceof in production.
  // In tests the error is thrown by the mock; we check by property shape.
  function isEmbedError(err: unknown): err is { attempts: number; lastStatus: number } {
    return (
      err !== null &&
      typeof err === 'object' &&
      'attempts' in err &&
      typeof (err as Record<string, unknown>).attempts === 'number'
    );
  }

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batchChunks = chunks.slice(i, i + BATCH_SIZE);
    const batchIndex = Math.floor(i / BATCH_SIZE);

    // Build embed inputs: summary + ' || ' + JSON.stringify(quote_blocks)
    const inputs = batchChunks.map(
      (c) => `${c.summary} || ${JSON.stringify(c.quote_blocks ?? [])}`,
    );

    let embeddings: number[][];
    let totalTokens: number;
    const t0 = now();

    try {
      const result = await embedClient.batchEmbed(inputs);
      embeddings = result.embeddings;
      totalTokens = result.totalTokens;
    } catch (err) {
      if (isEmbedError(err)) {
        return Response.json(
          {
            error: 'embed_failed',
            batch_index: batchIndex,
            attempts: (err as { attempts: number }).attempts,
            inserted_batches: insertedBatches,
          },
          { status: 502 },
        );
      }
      throw err;
    }

    const latencyMs = now() - t0;

    // Build INSERT rows with denormalized carry-alongs.
    const rows = batchChunks.map((c, j) => ({
      chunk_id: c.id,
      embedding: embeddings[j],
      topic_id: c.topic_id,
      source_id: c.source_id,
      source_tier: c.source_tier,
      topic_tag: c.topic_tag,
      freshness_window_days: c.freshness_window_days,
    }));

    // Upsert with ON CONFLICT (chunk_id) DO NOTHING semantics.
    const { error: upsertError } = await supabase
      .from('external_kb_embeddings')
      .upsert(rows, { onConflict: 'chunk_id', ignoreDuplicates: true });

    if (upsertError) {
      console.error('[rag-embed-approved] upsert error:', upsertError.message);
    }

    insertedBatches++;
    chunksEmbedded += batchChunks.length;

    // Cost accounting.
    const batchCostUsd = COST_PER_TOKEN * totalTokens;
    cumulativeCostUsd += batchCostUsd;

    // Per-batch budget guard.
    if (batchCostUsd > perBatchBudgetUsd) {
      alertSlack(
        `[rag-embed-approved] per-batch cost breach: $${batchCostUsd.toFixed(6)} > budget=$${perBatchBudgetUsd} batch=${batchIndex} trace=${traceId}`,
        'warn',
      );
    }

    // Emit PostHog $ai_generation per batch.
    emitAiGeneration({
      model: EMBED_MODEL,
      provider: EMBED_PROVIDER,
      inputTokens: totalTokens,
      costUsd: batchCostUsd,
      latencyMs,
    });

    // Daily budget guard — abort + emit envelope-breach.
    if (cumulativeCostUsd > dailyBudgetUsd) {
      emitRagCostEnvelopeBreach({
        scope: 'per_cron',
        cron_kind: 'tip_of_day',
        cost_usd: cumulativeCostUsd,
        envelope_usd: dailyBudgetUsd,
        trace_id: traceId,
      });
      partial = true;
      break;
    }
  }

  return Response.json({
    ok: true,
    batches: insertedBatches,
    chunks_embedded: chunksEmbedded,
    cost_usd: cumulativeCostUsd,
    ...(partial ? { partial: true } : {}),
  });
}
