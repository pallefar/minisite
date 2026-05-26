/**
 * rag-retrieve.ts — Typed server-to-server HTTP client for the rag-retrieve Edge Fn.
 *
 * Phase 60 Plan 60-02. AI-SPEC §3 + §4 envelope contract.
 *
 * Provides `retrieveRagChunks({ query, k?, userJwt?, filters? })` for downstream
 * Edge Functions (rag-synthesize, rag-tip-of-day-generate, rag-newsletter-sender).
 * Consumers MUST NOT hand-roll the fetch boilerplate; import this helper instead.
 *
 * NOTE: This helper does NOT emit `$ai_generation` to PostHog. Callers MUST do
 * that with their own trace_id to avoid double-counting cost telemetry per
 * AI-SPEC §7. Import `emitAiGeneration` from `_shared/posthog-rag-events.ts`.
 *
 * Auth: When `req.userJwt` is provided, it is forwarded in the Authorization header
 * (user-attributed call — downstream Fn validates auth.uid()). When omitted,
 * `SUPABASE_SERVICE_ROLE_KEY` is used (server-to-server / cron context). Both absent
 * → throw `RagRetrieveNetworkError` immediately (anonymous calls are impossible per
 * T-60-02-01 threat model).
 *
 * Retry: 1 retry on 5xx with exponential backoff (250ms → 500ms). No retry on 4xx.
 * Timeout: 8s `AbortSignal.timeout` per attempt.
 *
 * Refusal: `result.refused === true` is a VALID response (AI-SPEC §6 G3/G4). This
 * helper returns the parsed result as-is; the caller decides how to handle it.
 *
 * Schema enforcement: Zod parses every response. Schema violation → `RagRetrieveSchemaError`.
 * The `.refine()` rule enforces refused ⇔ refusal_reason populated (AI-SPEC §4 line 471).
 */

import { z } from 'npm:zod@^3';

// ──────────────────────────────────────────────────────────────────────────────
// Custom error classes
// ──────────────────────────────────────────────────────────────────────────────

/** Thrown when a network error, timeout, or 4xx/5xx-after-retries occurs. */
export class RagRetrieveNetworkError extends Error {
  readonly cause: unknown;
  readonly attempts: number;

  constructor(message: string, options: { cause: unknown; attempts: number }) {
    super(message);
    this.name = 'RagRetrieveNetworkError';
    this.cause = options.cause;
    this.attempts = options.attempts;
  }
}

/** Thrown when the response body does not match the expected Zod schema. */
export class RagRetrieveSchemaError extends Error {
  readonly issues: z.ZodIssue[];
  readonly rawBody: string;

  constructor(message: string, options: { issues: z.ZodIssue[]; rawBody: string }) {
    super(message);
    this.name = 'RagRetrieveSchemaError';
    this.issues = options.issues;
    this.rawBody = options.rawBody;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Zod schemas (mirrors AI-SPEC §3 + §4 interfaces exactly)
// ──────────────────────────────────────────────────────────────────────────────

const RagRetrievedChunkSchema = z.object({
  chunk_id: z.string().uuid(),
  source_id: z.string().uuid(),
  source_type: z.enum([
    'fda_label',
    'peer_reviewed',
    'leanshot_research',
    'community',
    'pubmed',
    'openfda',
    'dailymed',
  ]),
  tier: z.enum(['A', 'B', 'C']),
  topic_tag: z.string(),
  source_text_excerpt: z.string(),
  summary: z.string(),
  similarity: z.number().min(0).max(1),
  rerank_score: z.number().nullable(),
  evidence_date: z.string(),
  freshness_reweight_applied: z.boolean(),
  public_visibility: z.boolean(),
});

const RagRetrieveResultSchema = z
  .object({
    refused: z.boolean(),
    refusal_reason: z
      .enum(['out_of_corpus', 'pharma_02_carveout', 'safety'])
      .nullable(),
    chunks: z.array(RagRetrievedChunkSchema),
    trace_id: z.string(),
    reranker_provider: z.enum(['cohere', 'jina', 'none']),
    embed_cost_usd: z.number(),
    rerank_cost_usd: z.number(),
  })
  .refine(
    (r) => r.refused === (r.refusal_reason !== null),
    { message: 'refused ⇔ refusal_reason populated (AI-SPEC §4 line 471)' },
  );

// ──────────────────────────────────────────────────────────────────────────────
// Exported TypeScript types (inferred from Zod schemas)
// ──────────────────────────────────────────────────────────────────────────────

/** A single retrieved + reranked chunk (AI-SPEC §3/§4). */
export type RagRetrievedChunk = z.infer<typeof RagRetrievedChunkSchema>;

/** Full envelope returned by the rag-retrieve Edge Fn (AI-SPEC §3). */
export type RagRetrieveResult = z.infer<typeof RagRetrieveResultSchema>;

/** Request parameters for `retrieveRagChunks`. k defaults to 8. */
export interface RagRetrieveRequest {
  query: string;
  /** Number of chunks to retrieve. Defaults to 8 (AI-SPEC §3 line 284 + §3 line 547). */
  k?: number;
  /** User JWT for user-attributed calls. When omitted, SUPABASE_SERVICE_ROLE_KEY is used. */
  userJwt?: string;
  filters?: {
    topic_tag?: string;
    source_type?: RagRetrievedChunk['source_type'];
    surface?: 'coach' | 'tip_of_day' | 'newsletter' | 'public_knowledge_hub';
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Helper: exponential sleep
// ──────────────────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ──────────────────────────────────────────────────────────────────────────────
// Primary export
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Retrieve RAG chunks from the deployed `rag-retrieve` Edge Function.
 *
 * POSTs to `${SUPABASE_URL}/functions/v1/rag-retrieve` with typed body.
 * Retries once on 5xx (250ms backoff). 8s timeout per attempt.
 * Refusal responses are returned as-is (not thrown) — callers handle them.
 *
 * NOTE: Does NOT emit `$ai_generation` to PostHog — callers MUST do that
 * with their own trace_id to avoid double-counting cost telemetry (AI-SPEC §7).
 *
 * @throws {RagRetrieveNetworkError} On network/timeout/4xx/5xx-after-retries.
 * @throws {RagRetrieveSchemaError} On response body schema violation.
 */
export async function retrieveRagChunks(req: RagRetrieveRequest): Promise<RagRetrieveResult> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  if (!supabaseUrl) {
    throw new RagRetrieveNetworkError('SUPABASE_URL missing', { cause: null, attempts: 0 });
  }

  const token = req.userJwt ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!token) {
    throw new RagRetrieveNetworkError(
      'No auth token available: userJwt not provided and SUPABASE_SERVICE_ROLE_KEY missing',
      { cause: null, attempts: 0 },
    );
  }

  const body = {
    query: req.query,
    k: req.k ?? 8,
    filters: req.filters ?? {},
  };

  const endpoint = `${supabaseUrl}/functions/v1/rag-retrieve`;
  let attempt = 1;
  const maxAttempts = 2; // 1 retry

  while (attempt <= maxAttempts) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
      });

      if (res.ok) {
        let rawBody = '';
        try {
          rawBody = await res.text();
        } catch (err) {
          throw new RagRetrieveNetworkError('Failed to read response body', {
            cause: err,
            attempts: attempt,
          });
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(rawBody);
        } catch (err) {
          throw new RagRetrieveSchemaError('Response body is not valid JSON', {
            issues: [],
            rawBody: rawBody.slice(0, 500),
          });
        }

        const result = RagRetrieveResultSchema.safeParse(parsed);
        if (!result.success) {
          throw new RagRetrieveSchemaError('Response schema validation failed', {
            issues: result.error.issues,
            rawBody: rawBody.slice(0, 500),
          });
        }

        return result.data;
      }

      if (res.status >= 400 && res.status < 500) {
        // 4xx — non-retryable client error
        let errBody = '';
        try {
          errBody = await res.text();
        } catch {
          // ignore
        }
        throw new RagRetrieveNetworkError(
          `non-retryable client error: HTTP ${res.status}`,
          { cause: { status: res.status, body: errBody.slice(0, 200) }, attempts: attempt },
        );
      }

      // 5xx — retryable server error
      if (attempt < maxAttempts) {
        await sleep(250 * attempt ** 2);
        attempt++;
        continue;
      }

      // 5xx on final attempt
      let errBody = '';
      try {
        errBody = await res.text();
      } catch {
        // ignore
      }
      throw new RagRetrieveNetworkError(
        `upstream 5xx after ${attempt} attempt(s)`,
        { cause: { status: res.status, body: errBody.slice(0, 200) }, attempts: attempt },
      );
    } catch (err) {
      // Re-throw our own errors immediately
      if (err instanceof RagRetrieveNetworkError || err instanceof RagRetrieveSchemaError) {
        throw err;
      }

      // Convert AbortError (timeout) → RagRetrieveNetworkError
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new RagRetrieveNetworkError('Request timed out (8s)', {
          cause: err,
          attempts: attempt,
        });
      }

      // Other network errors — if we have retries left, retry
      if (attempt < maxAttempts) {
        await sleep(250 * attempt ** 2);
        attempt++;
        continue;
      }

      throw new RagRetrieveNetworkError('Fetch failed after retries', {
        cause: err,
        attempts: attempt,
      });
    }
  }

  // Should not reach here, but TypeScript needs a return
  throw new RagRetrieveNetworkError('Unexpected exit from retry loop', {
    cause: null,
    attempts: maxAttempts,
  });
}
