/**
 * Phase 60 eval harness — RAG Edge Fn HTTP client.
 *
 * Calls deployed rag-retrieve / rag-synthesize / rag-tip-of-day-generate
 * Supabase Edge Fns. Reads EVAL_BASE_URL + EVAL_SERVICE_KEY env vars.
 *
 * Throws typed `EvalFnAbsentError` on 404 so tests can:
 *   - In RED state: catch and call expect(false).toBe(true) with a clear message
 *   - In GREEN state (post 60-04..07): assert `.resolves.toMatchObject(...)` normally
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Environment resolution
// ---------------------------------------------------------------------------

export interface EvalEnv {
  baseUrl: string;
  serviceKey: string;
}

function resolveEnv(): EvalEnv {
  return {
    baseUrl: process.env['EVAL_BASE_URL'] ?? '',
    serviceKey: process.env['EVAL_SERVICE_KEY'] ?? '',
  };
}

// Warn once per Vitest run when EVAL_BASE_URL is unset outside CI.
let _warnedAboutMissingUrl = false;

function maybeWarnMissingUrl(env: EvalEnv): void {
  if (!env.baseUrl && !_warnedAboutMissingUrl && process.env['CI'] !== 'true') {
    _warnedAboutMissingUrl = true;
    process.stderr.write(
      '[phase60-eval] EVAL_BASE_URL unset — all RAG calls will RED with EvalFnAbsentError (expected before 60-04..07 ship)\n',
    );
  }
}

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/**
 * Thrown when the Edge Fn returns 404 or when EVAL_BASE_URL is empty.
 * Signals "function not yet deployed" — the contracted RED state for this plan.
 */
export class EvalFnAbsentError extends Error {
  public readonly fnName: string;
  public readonly url: string;
  public readonly statusCode: number | null;

  constructor(fnName: string, url: string, statusCode: number | null) {
    super(
      statusCode === null
        ? `EvalFnAbsentError: EVAL_BASE_URL is not set — ${fnName} cannot be called (pre-60-04..07 RED state)`
        : `EvalFnAbsentError: ${fnName} returned ${statusCode} at ${url} — function not yet deployed`,
    );
    this.name = 'EvalFnAbsentError';
    this.fnName = fnName;
    this.url = url;
    this.statusCode = statusCode;
  }
}

// ---------------------------------------------------------------------------
// CitedAnswer schema (mirrors AI-SPEC §4 CitedAnswerSchema)
// ---------------------------------------------------------------------------

export const CitationSchema = z.object({
  chunk_id: z.string(),
  verbatim_quote: z.string(),
  char_offset_start: z.number().int().nonnegative(),
  char_offset_end: z.number().int().nonnegative(),
  source_url: z.string(),
  source_tier: z.enum(['A', 'B', 'C', 'D', 'E', 'F']),
  evidence_date: z.string(),
  stale_evidence: z.boolean().optional(),
});

export const CitedAnswerSchema = z.object({
  answer_markdown: z.string(),
  citations: z.array(CitationSchema),
  refusal_reason: z
    .enum(['out_of_corpus', 'pharma_02_carveout', 'ai04_fence_breach'])
    .nullable()
    .optional(),
  rerank_provider: z.enum(['cohere', 'jina', 'none']).optional(),
  rerank_degraded: z.boolean().optional(),
  cost_usd: z.number().optional(),
});

export type Citation = z.infer<typeof CitationSchema>;
export type CitedAnswer = z.infer<typeof CitedAnswerSchema>;

// Retrieve chunk shape
export const ChunkResultSchema = z.object({
  chunk_id: z.string(),
  cosine: z.number(),
  rerank_score: z.number().optional(),
  source_tier: z.string(),
});

export const RetrieveResponseSchema = z.object({
  chunks: z.array(ChunkResultSchema),
});

export type ChunkResult = z.infer<typeof ChunkResultSchema>;

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

async function postToFn<T>(
  fnName: string,
  body: Record<string, unknown>,
  responseSchema: z.ZodType<T>,
): Promise<T> {
  const env = resolveEnv();
  maybeWarnMissingUrl(env);

  if (!env.baseUrl) {
    throw new EvalFnAbsentError(fnName, '(EVAL_BASE_URL unset)', null);
  }

  const url = `${env.baseUrl}/${fnName}`;
  let response: Response;

  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.serviceKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err: unknown) {
    throw new Error(
      `[rag-client] Network error calling ${fnName} at ${url}: ${(err as Error).message}`,
    );
  }

  if (response.status === 404) {
    throw new EvalFnAbsentError(fnName, url, 404);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '(no body)');
    throw new Error(
      `[rag-client] ${fnName} returned ${response.status} at ${url}: ${text.slice(0, 200)}`,
    );
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch (err: unknown) {
    throw new Error(
      `[rag-client] ${fnName} returned non-JSON response: ${(err as Error).message}`,
    );
  }

  const result = responseSchema.safeParse(json);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `[rag-client] ${fnName} response failed schema validation:\n${issues}`,
    );
  }

  return result.data;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Calls the `rag-retrieve` Edge Fn (ships in plan 60-06).
 *
 * Throws `EvalFnAbsentError` when EVAL_BASE_URL is unset or the Fn returns 404.
 */
export async function callRagRetrieve(
  query: string,
  opts?: { k?: number; rerankProvider?: 'cohere' | 'jina' },
): Promise<{ chunks: ChunkResult[] }> {
  return postToFn(
    'rag-retrieve',
    { query, k: opts?.k ?? 10, rerank_provider: opts?.rerankProvider },
    RetrieveResponseSchema,
  );
}

/**
 * Calls the `rag-synthesize` Edge Fn (ships in plan 60-06).
 *
 * Throws `EvalFnAbsentError` when EVAL_BASE_URL is unset or the Fn returns 404.
 */
export async function callRagSynthesize(
  query: string,
  opts?: { userContext?: { meds: string[]; conditions: string[] } },
): Promise<CitedAnswer> {
  return postToFn(
    'rag-synthesize',
    { query, user_context: opts?.userContext },
    CitedAnswerSchema,
  );
}

/**
 * Calls the `rag-tip-of-day-generate` Edge Fn (ships in plan 60-11).
 *
 * Throws `EvalFnAbsentError` when EVAL_BASE_URL is unset or the Fn returns 404.
 */
export async function callRagTipOfDay(): Promise<CitedAnswer> {
  return postToFn('rag-tip-of-day-generate', {}, CitedAnswerSchema);
}
