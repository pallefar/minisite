/**
 * openai.test.ts — Vitest unit tests for OpenAIEmbedBatchClient.
 *
 * Phase 60 Plan 60-05. Task 1 (RED phase).
 *
 * Override (2026-05-26): routes via OpenRouter instead of direct OpenAI / Vercel AI Gateway.
 * Endpoint: https://openrouter.ai/api/v1/embeddings
 * Auth:     Authorization: Bearer ${OPENROUTER_API_KEY}
 * Model:    openai/text-embedding-3-small
 *
 * Tests:
 *  T1: batchEmbed posts to OpenRouter endpoint with correct headers + body, returns embeddings.
 *  T2: batchEmbed throws synchronously when texts.length > 100 (OpenAI hard-cap).
 *  T3: batchEmbed([]) short-circuits — no HTTP call, returns empty result.
 *  T4: On 429 with Retry-After:2, waits ≥1.8s then retries; succeeds on attempt 2.
 *  T5: On 503, backs off 3× and surfaces OpenAIEmbedError with attempts === 3.
 *  T6: Missing OPENROUTER_API_KEY throws OpenAIEmbedConfigError before HTTP call.
 *  T7: healthCheck() returns { ok: true, latencyMs: number } on success; { ok: false, reason } on failure.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OpenAIEmbedBatchClient,
  OpenAIEmbedBatchSizeError,
  OpenAIEmbedConfigError,
  OpenAIEmbedError,
} from '../openai.ts';

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function makeEmbeddingResponse(count = 1, dim = 1536): Response {
  const data = Array.from({ length: count }, (_, i) => ({
    embedding: Array.from({ length: dim }, () => 0.01),
    index: i,
  }));
  return new Response(
    JSON.stringify({
      data,
      usage: { prompt_tokens: count * 50, total_tokens: count * 50 },
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    },
  );
}

function makeClient(fetchImpl: typeof fetch, envOverrides: Record<string, string | undefined> = {}) {
  // Build env: start with defaults, then apply overrides (undefined = remove key).
  const env: Record<string, string> = {
    OPENROUTER_API_KEY: 'test-openrouter-key',
  };
  for (const [k, v] of Object.entries(envOverrides)) {
    if (v === undefined) {
      delete env[k];
    } else {
      env[k] = v;
    }
  }
  return new OpenAIEmbedBatchClient({ fetchImpl, env });
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

describe('OpenAIEmbedBatchClient', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('T1: posts to OpenRouter endpoint with correct auth + body, returns embeddings', async () => {
    const captured: { url: string; init: RequestInit }[] = [];
    const mockFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      captured.push({ url: String(url), init: init ?? {} });
      return makeEmbeddingResponse(2);
    });

    const client = makeClient(mockFetch as unknown as typeof fetch);
    const result = await client.batchEmbed(['text one', 'text two']);

    expect(mockFetch).toHaveBeenCalledOnce();
    expect(captured[0]!.url).toBe('https://openrouter.ai/api/v1/embeddings');
    const body = JSON.parse(captured[0]!.init.body as string) as Record<string, unknown>;
    expect(body.model).toBe('openai/text-embedding-3-small');
    expect(body.input).toEqual(['text one', 'text two']);
    const headers = captured[0]!.init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer test-openrouter-key');
    expect(headers['HTTP-Referer']).toBe('https://leanshot.app');
    expect(headers['X-Title']).toBe('LeanShot');
    expect(result.embeddings).toHaveLength(2);
    expect(result.embeddings[0]).toHaveLength(1536);
    expect(result.totalTokens).toBe(100);
  });

  it('T2: throws OpenAIEmbedBatchSizeError synchronously when texts.length > 100', async () => {
    const mockFetch = vi.fn();
    const client = makeClient(mockFetch as unknown as typeof fetch);
    const texts = Array.from({ length: 101 }, (_, i) => `text ${i}`);

    await expect(client.batchEmbed(texts)).rejects.toBeInstanceOf(OpenAIEmbedBatchSizeError);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('T3: batchEmbed([]) short-circuits without HTTP call', async () => {
    const mockFetch = vi.fn();
    const client = makeClient(mockFetch as unknown as typeof fetch);
    const result = await client.batchEmbed([]);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.embeddings).toEqual([]);
    expect(result.totalTokens).toBe(0);
  });

  it('T4: on 429 with Retry-After:2, waits ≥1.8s then retries; succeeds on attempt 2', async () => {
    vi.useRealTimers();
    let callCount = 0;
    const mockFetch = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        return new Response('rate limited', {
          status: 429,
          headers: { 'Retry-After': '2' },
        });
      }
      return makeEmbeddingResponse(1);
    });

    // Track sleep calls with a spy so we can verify the Retry-After delay.
    const sleepCalls: number[] = [];
    const client = new OpenAIEmbedBatchClient({
      fetchImpl: mockFetch as unknown as typeof fetch,
      env: { OPENROUTER_API_KEY: 'test-key' },
      sleepImpl: (ms: number) => {
        sleepCalls.push(ms);
        return Promise.resolve(); // instant in tests
      },
    });

    const result = await client.batchEmbed(['test']);

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result.embeddings).toHaveLength(1);
    // The sleep should have been called with ≥ 1800ms (Retry-After: 2 = 2000ms, clamped ≤ 30s)
    expect(sleepCalls.length).toBe(1);
    expect(sleepCalls[0]).toBeGreaterThanOrEqual(1800);
  });

  it('T5: on 503, backs off 3× and surfaces OpenAIEmbedError with attempts === 3', async () => {
    vi.useRealTimers(); // Use real timers; override sleepImpl to be instant.
    const mockFetch = vi.fn(async () =>
      new Response('service unavailable', { status: 503 })
    );

    // Inject instant sleep so the test doesn't wait real backoff times.
    const client = new OpenAIEmbedBatchClient({
      fetchImpl: mockFetch as unknown as typeof fetch,
      env: { OPENROUTER_API_KEY: 'test-key' },
      sleepImpl: () => Promise.resolve(),
    });

    await expect(client.batchEmbed(['test'])).rejects.toSatisfy((err: unknown) => {
      return err instanceof OpenAIEmbedError && (err as OpenAIEmbedError).attempts === 3;
    });
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('T6: missing OPENROUTER_API_KEY throws OpenAIEmbedConfigError before HTTP call', async () => {
    const mockFetch = vi.fn();
    expect(
      () => makeClient(mockFetch as unknown as typeof fetch, { OPENROUTER_API_KEY: undefined }),
    ).toThrow(OpenAIEmbedConfigError);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('T7: healthCheck() returns { ok: true, latencyMs: number } on success', async () => {
    const mockFetch = vi.fn(async () => makeEmbeddingResponse(1));
    const client = makeClient(mockFetch as unknown as typeof fetch);
    const result = await client.healthCheck();

    expect(result.ok).toBe(true);
    expect(typeof result.latencyMs).toBe('number');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('T7b: healthCheck() returns { ok: false, reason } on failure', async () => {
    vi.useRealTimers();
    const mockFetch = vi.fn(async () => new Response('error', { status: 500 }));
    // Use instant sleep so the test doesn't wait real backoff times.
    const client = new OpenAIEmbedBatchClient({
      fetchImpl: mockFetch as unknown as typeof fetch,
      env: { OPENROUTER_API_KEY: 'test-key' },
      sleepImpl: () => Promise.resolve(),
    });

    const result = await client.healthCheck();

    expect(result.ok).toBe(false);
    expect(typeof result.reason).toBe('string');
  });
});
