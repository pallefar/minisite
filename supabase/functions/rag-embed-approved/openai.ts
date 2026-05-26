/**
 * openai.ts — OpenAI batch-embed client for rag-embed-approved Edge Function.
 *
 * Phase 60 Plan 60-05.
 *
 * Override (2026-05-26): routes via OpenRouter instead of direct OpenAI / Vercel AI Gateway.
 *   Base URL: https://openrouter.ai/api/v1/embeddings
 *   Auth:     Authorization: Bearer ${OPENROUTER_API_KEY}
 *   Model:    openai/text-embedding-3-small (OpenRouter provider-prefixed; 1536-dim preserved)
 *   Headers:  HTTP-Referer: https://leanshot.app, X-Title: LeanShot
 *
 * Class: OpenAIEmbedBatchClient
 *   - batchEmbed(texts): { embeddings, totalTokens }
 *   - healthCheck(): { ok, latencyMs?, reason? }
 *
 * Typed errors:
 *   - OpenAIEmbedConfigError   — missing OPENROUTER_API_KEY
 *   - OpenAIEmbedBatchSizeError — texts.length > 100
 *   - OpenAIEmbedResponseError  — malformed response (data.length mismatch)
 *   - OpenAIEmbedError          — retry exhausted (has attempts, lastStatus, lastBody)
 *
 * Security: bearer token NEVER appears in error messages or logs.
 *
 * T-60-05-01: error messages NEVER include the Bearer token.
 * T-60-05-07: 3-attempt backoff, Retry-After honored, max per-batch wait ≤ 30s per attempt.
 */

const OPENROUTER_EMBEDDINGS_URL = 'https://openrouter.ai/api/v1/embeddings';
const OPENROUTER_MODEL = 'openai/text-embedding-3-small';
const MAX_BATCH_SIZE = 100;
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = [1_000, 3_000, 9_000] as const;
const MAX_RETRY_AFTER_MS = 30_000;

// ──────────────────────────────────────────────────────────────────────────────
// Typed error classes
// ──────────────────────────────────────────────────────────────────────────────

/** Thrown when a required environment variable is absent at client construction. */
export class OpenAIEmbedConfigError extends Error {
  constructor(public readonly missingKey: string) {
    super(`[rag-embed-approved] Missing required env var: ${missingKey}`);
    this.name = 'OpenAIEmbedConfigError';
  }
}

/** Thrown synchronously when texts.length > 100 (OpenAI API hard-cap). */
export class OpenAIEmbedBatchSizeError extends Error {
  constructor(public readonly count: number) {
    super(
      `[rag-embed-approved] Batch size ${count} exceeds maximum of ${MAX_BATCH_SIZE}. Split into smaller batches.`,
    );
    this.name = 'OpenAIEmbedBatchSizeError';
  }
}

/** Thrown when the API response does not match the expected shape. */
export class OpenAIEmbedResponseError extends Error {
  constructor(message: string) {
    super(`[rag-embed-approved] Response error: ${message}`);
    this.name = 'OpenAIEmbedResponseError';
  }
}

/** Thrown after all retry attempts are exhausted. Never includes the Bearer token. */
export class OpenAIEmbedError extends Error {
  constructor(
    public readonly attempts: number,
    public readonly lastStatus: number,
    public readonly lastBody: string,
  ) {
    super(
      `[rag-embed-approved] Embedding failed after ${attempts} attempt(s). Last status: ${lastStatus}`,
    );
    this.name = 'OpenAIEmbedError';
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Client options
// ──────────────────────────────────────────────────────────────────────────────

export interface OpenAIEmbedBatchClientOptions {
  /** Injectable fetch (defaults to global fetch; injected in tests). */
  fetchImpl?: typeof fetch;
  /** Injectable env map (defaults to Deno.env; used in Node/Vitest tests). */
  env?: Record<string, string | undefined>;
  /** Injectable sleep (defaults to real setTimeout; used in tests with fake timers). */
  sleepImpl?: (ms: number) => Promise<void>;
}

// ──────────────────────────────────────────────────────────────────────────────
// Client
// ──────────────────────────────────────────────────────────────────────────────

export class OpenAIEmbedBatchClient {
  private readonly fetchImpl: typeof fetch;
  private readonly apiKey: string;
  private readonly sleepImpl: (ms: number) => Promise<void>;

  constructor(opts: OpenAIEmbedBatchClientOptions = {}) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleepImpl = opts.sleepImpl ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

    // Resolve env from injected map or Deno.env.
    const get = (key: string): string | undefined => {
      if (opts.env) return opts.env[key];
      // Deno.env is available in the Edge Fn runtime.
      // In Node/Vitest test environment, env is always injected via opts.env.
      try {
        // deno-lint-ignore no-explicit-any
        return (globalThis as any).Deno?.env?.get(key) as string | undefined;
      } catch {
        return undefined;
      }
    };

    const apiKey = get('OPENROUTER_API_KEY');
    if (!apiKey) {
      throw new OpenAIEmbedConfigError('OPENROUTER_API_KEY');
    }
    this.apiKey = apiKey;
  }

  /**
   * Embed a batch of texts via OpenRouter → OpenAI text-embedding-3-small.
   *
   * @param texts - Array of strings to embed. Must be 1..100 in length.
   * @returns { embeddings: number[][], totalTokens: number }
   * @throws OpenAIEmbedBatchSizeError when texts.length > 100
   * @throws OpenAIEmbedError after 3 failed attempts on 5xx / 429
   */
  async batchEmbed(
    texts: string[],
  ): Promise<{ embeddings: number[][]; totalTokens: number }> {
    // Short-circuit for empty input.
    if (texts.length === 0) {
      return { embeddings: [], totalTokens: 0 };
    }

    // Hard-cap enforcement.
    if (texts.length > MAX_BATCH_SIZE) {
      throw new OpenAIEmbedBatchSizeError(texts.length);
    }

    let lastStatus = 0;
    let lastBody = '';

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      let res: Response;

      try {
        res = await this.fetchImpl(OPENROUTER_EMBEDDINGS_URL, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://leanshot.app',
            'X-Title': 'LeanShot',
          },
          body: JSON.stringify({
            model: OPENROUTER_MODEL,
            input: texts,
          }),
        });
      } catch (networkErr) {
        // Network error (fetch itself threw) — treat as transient.
        lastStatus = 0;
        lastBody = networkErr instanceof Error ? networkErr.message : String(networkErr);
        if (attempt < MAX_RETRIES) {
          await this.sleepImpl(BASE_BACKOFF_MS[attempt - 1] ?? 9_000);
          continue;
        }
        throw new OpenAIEmbedError(attempt, 0, lastBody);
      }

      lastStatus = res.status;

      // 429: honor Retry-After header.
      if (res.status === 429 && attempt < MAX_RETRIES) {
        const retryAfterHeader = res.headers.get('Retry-After') ?? '1';
        const retryAfterMs = Math.min(
          Math.max(parseInt(retryAfterHeader, 10) || 1, 1) * 1_000,
          MAX_RETRY_AFTER_MS,
        );
        // Drain the body to free the connection.
        try {
          await res.body?.cancel();
        } catch {
          // ignore
        }
        await this.sleepImpl(retryAfterMs);
        continue;
      }

      // 5xx: backoff and retry.
      if (res.status >= 500 && attempt < MAX_RETRIES) {
        try {
          lastBody = (await res.text()).slice(0, 200);
        } catch {
          lastBody = '';
        }
        await this.sleepImpl(BASE_BACKOFF_MS[attempt - 1] ?? 9_000);
        continue;
      }

      // 4xx other than 429: fail immediately (no retry).
      if (!res.ok) {
        try {
          lastBody = (await res.text()).slice(0, 200);
        } catch {
          lastBody = '';
        }
        throw new OpenAIEmbedError(attempt, res.status, lastBody);
      }

      // 2xx: parse response.
      let json: unknown;
      try {
        json = await res.json();
      } catch (parseErr) {
        throw new OpenAIEmbedResponseError(
          `JSON parse failed: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
        );
      }

      const data = (json as Record<string, unknown>)?.data;
      if (!Array.isArray(data)) {
        throw new OpenAIEmbedResponseError('response missing `data` array');
      }
      if (data.length !== texts.length) {
        throw new OpenAIEmbedResponseError(
          `expected ${texts.length} embeddings, got ${data.length}`,
        );
      }

      const embeddings: number[][] = data.map(
        (item: unknown, idx: number) => {
          const emb = (item as Record<string, unknown>)?.embedding;
          if (!Array.isArray(emb)) {
            throw new OpenAIEmbedResponseError(
              `data[${idx}].embedding is not an array`,
            );
          }
          return emb as number[];
        },
      );

      const usage = (json as Record<string, unknown>)?.usage as
        | Record<string, unknown>
        | undefined;
      const totalTokens =
        typeof usage?.total_tokens === 'number'
          ? (usage.total_tokens as number)
          : typeof usage?.prompt_tokens === 'number'
          ? (usage.prompt_tokens as number)
          : 0;

      return { embeddings, totalTokens };
    }

    // All attempts exhausted (5xx path that didn't throw inside the loop).
    throw new OpenAIEmbedError(MAX_RETRIES, lastStatus, lastBody);
  }

  /**
   * Health check — embeds a single "ok" string and returns latency.
   */
  async healthCheck(): Promise<{ ok: boolean; latencyMs?: number; reason?: string }> {
    const t0 = Date.now();
    try {
      await this.batchEmbed(['ok']);
      return { ok: true, latencyMs: Date.now() - t0 };
    } catch (err) {
      return {
        ok: false,
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
