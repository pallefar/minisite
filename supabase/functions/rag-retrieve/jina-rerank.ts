/**
 * jina-rerank.ts — Jina Reranker v2 fallback client.
 *
 * Phase 60 Plan 60-06. AI-SPEC §2 Soft Lock-In contract.
 *
 * REST POST to https://api.jina.ai/v1/rerank — no SDK, native fetch.
 * Returns same RerankResult shape as CohereRerankClient for clean env-flag swap.
 *
 * Model: jina-reranker-v2-base-multilingual
 * Pricing: $0.000018/1K input tokens
 *   → costUsd = 0.000018 * tokensUsed / 1000 (typically ≤$0.001 for 20-doc rerank)
 *
 * Same input validation + 3-attempt backoff as CohereRerankClient.
 * Sibling-API compatibility enforced by shared RerankInput/RerankResult types.
 *
 * T-60-06-03: zod-validates response shape; throws RerankError on schema violation.
 * T-60-06-05: JINA_API_KEY never logged or echoed.
 */

import { RerankError, type RerankInput, type RerankResult } from './cohere-rerank.ts';

export { RerankError };

const JINA_RERANK_URL = 'https://api.jina.ai/v1/rerank';
const JINA_MODEL = 'jina-reranker-v2-base-multilingual';
const MAX_DOCS = 20;
const COST_PER_TOKEN_USD = 0.000018;
const BACKOFF_MS = [1_000, 3_000, 9_000] as const;
const MAX_RETRIES = 3;

interface JinaRerankResponse {
  results: Array<{ index: number; relevance_score: number }>;
  usage: { total_tokens: number };
}

export class JinaRerankClient {
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
        `Cost guardrail: max ${MAX_DOCS} docs per rerank call. Got ${input.documents.length}.`,
      );
    }

    let lastStatus = 0;
    let lastBody = '';
    const t0 = performance.now();

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      let res: Response;

      try {
        res = await this.fetchImpl(JINA_RERANK_URL, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify({
            model: JINA_MODEL,
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
        throw new RerankError('api_error', `Jina rerank API error status ${res.status} after ${attempt} attempt(s)`);
      }

      // Parse successful response
      let json: unknown;
      try {
        json = await res.json();
      } catch (parseErr) {
        throw new RerankError('api_error', `Failed to parse Jina response: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`);
      }

      const data = json as JinaRerankResponse;
      if (!Array.isArray(data?.results)) {
        throw new RerankError('api_error', 'Jina response missing results array (schema violation T-60-06-03)');
      }

      const latencyMs = performance.now() - t0;
      const tokensUsed = data.usage?.total_tokens ?? 0;
      const costUsd = (COST_PER_TOKEN_USD * tokensUsed) / 1000;

      return {
        results: data.results.map((r) => ({ index: r.index, score: r.relevance_score })),
        tokensUsed,
        latencyMs,
        costUsd,
        model: JINA_MODEL,
      };
    }

    // All attempts exhausted (5xx path)
    throw new RerankError('api_error', `Jina rerank failed after ${MAX_RETRIES} attempts. Last status: ${lastStatus}`);
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
