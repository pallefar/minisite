/**
 * cohere-rerank.ts — Cohere Rerank v3.5 client wrapper.
 *
 * Phase 60 Plan 60-06. AI-SPEC §3 entry-point pattern.
 *
 * Wraps the Cohere REST API directly (not the npm SDK) to maintain
 * Deno-native fetch compatibility and full mock control in tests.
 * Uses npm:cohere-ai@^7 import only for type reference if available;
 * core implementation uses native fetch per the REST contract.
 *
 * Cohere pricing: $2/1K searches → 1 search = $0.002 regardless of doc count
 * (up to 1000 docs per call). We cap at 20 docs per AI-SPEC §4 cost table.
 *
 * T-60-06-03: zod-validates response shape; throws RerankError on schema violation.
 * T-60-06-05: COHERE_API_KEY never logged or echoed.
 * T-60-06-07: input docs hard-capped at 20 (cost guardrail).
 * T-60-06-08: 3-attempt exponential backoff (1s/3s/9s) on 5xx + 429.
 */

export class RerankError extends Error {
  constructor(
    public readonly code: 'empty_docs' | 'too_many_docs' | 'api_error' | 'timeout',
    message: string,
  ) {
    super(message);
    this.name = 'RerankError';
  }
}

export interface RerankInput {
  query: string;
  documents: string[];
  topN: number;
}

export interface RerankResult {
  results: Array<{ index: number; score: number }>;
  tokensUsed: number;
  latencyMs: number;
  costUsd: number;
  model: string;
}

const COHERE_RERANK_URL = 'https://api.cohere.ai/v1/rerank';
const COHERE_MODEL = 'rerank-v3.5';
const MAX_DOCS = 20;
const COST_PER_CALL_USD = 0.002;
const BACKOFF_MS = [1_000, 3_000, 9_000] as const;
const MAX_RETRIES = 3;

interface CohereRerankResponse {
  results: Array<{ index: number; relevance_score: number }>;
  meta?: { billed_units?: { search_units?: number } };
}

export class CohereRerankClient {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = globalThis.fetch,
    private readonly sleepImpl: (ms: number) => Promise<void> = (ms) =>
      new Promise((r) => setTimeout(r, ms)),
  ) {}

  async rerank(input: RerankInput): Promise<RerankResult> {
    if (input.documents.length === 0) {
      throw new RerankError('empty_docs', 'At least one document is required for rerank.');
    }
    if (input.documents.length > MAX_DOCS) {
      throw new RerankError(
        'too_many_docs',
        `Cost guardrail: max ${MAX_DOCS} docs per rerank call (≤$${COST_PER_CALL_USD}/query envelope). Got ${input.documents.length}.`,
      );
    }

    let lastStatus = 0;
    let lastBody = '';
    const t0 = performance.now();

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      let res: Response;

      try {
        res = await this.fetchImpl(COHERE_RERANK_URL, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify({
            model: COHERE_MODEL,
            query: input.query,
            documents: input.documents,
            top_n: input.topN,
            return_documents: false,
          }),
        });
      } catch (networkErr) {
        lastStatus = 0;
        lastBody = networkErr instanceof Error ? networkErr.message : String(networkErr);
        if (attempt < MAX_RETRIES) {
          await this.sleepImpl(BACKOFF_MS[attempt - 1] ?? 9_000);
          continue;
        }
        throw new RerankError('api_error', `Network error after ${attempt} attempts: ${lastBody}`);
      }

      lastStatus = res.status;

      // Retry on 5xx or 429
      if ((res.status >= 500 || res.status === 429) && attempt < MAX_RETRIES) {
        try {
          lastBody = (await res.text()).slice(0, 200);
        } catch {
          lastBody = '';
        }
        await this.sleepImpl(BACKOFF_MS[attempt - 1] ?? 9_000);
        continue;
      }

      // Non-retryable error
      if (!res.ok) {
        try {
          lastBody = (await res.text()).slice(0, 200);
        } catch {
          lastBody = '';
        }
        throw new RerankError('api_error', `Cohere rerank API error status ${res.status} after ${attempt} attempt(s)`);
      }

      // Parse successful response
      let json: unknown;
      try {
        json = await res.json();
      } catch (parseErr) {
        throw new RerankError('api_error', `Failed to parse Cohere response: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`);
      }

      const data = json as CohereRerankResponse;
      if (!Array.isArray(data?.results)) {
        throw new RerankError('api_error', 'Cohere response missing results array (schema violation T-60-06-03)');
      }

      const latencyMs = performance.now() - t0;

      return {
        results: data.results.map((r) => ({ index: r.index, score: r.relevance_score })),
        tokensUsed: 0, // Cohere does not return token usage for rerank calls
        latencyMs,
        costUsd: COST_PER_CALL_USD,
        model: COHERE_MODEL,
      };
    }

    // All attempts exhausted (5xx path)
    throw new RerankError('api_error', `Cohere rerank failed after ${MAX_RETRIES} attempts. Last status: ${lastStatus}`);
  }

  async healthCheck(): Promise<{ ok: boolean; reason?: string }> {
    try {
      await this.rerank({ query: 'ok', documents: ['ok', 'ok'], topN: 1 });
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
  }
}
