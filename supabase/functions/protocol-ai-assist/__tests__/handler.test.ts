/**
 * handler.test.ts — Vitest unit tests for protocol-ai-assist handler.
 *
 * Phase 61 Plan 03. Task 1 (RED → GREEN cycle).
 *
 * Handler uses full dependency injection (no Deno.* or npm: imports at module
 * level) so these tests run under Vitest without Deno runtime.
 *
 * Tests:
 *  T1: Zero RAG chunks → refusal: true, no OpenRouter call.
 *  T2: PHARMA-02 gated compound → refusal: true, no OpenRouter call.
 *  T3: Rate limit hit (count ≥ 50) → 429, no INSERT, no OpenRouter call.
 *  T4: Success path → dose_mg/monitoring/cited_chunk_ids, INSERT into log, emitAiGeneration called.
 *  T5: Missing/placeholder OPENROUTER_API_KEY → 503 + Slack webhook called.
 *  T6: OpenRouter returns cited_chunk_ids: [] → server-side override forces refusal: true.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleAiAssist, type HandlerDeps, type HandlerRequest } from '../handler';

// ──────────────────────────────────────────────────────────────────────────────
// Mock Supabase client factory (duck-typed, no npm: import needed)
// ──────────────────────────────────────────────────────────────────────────────

function makeSupabaseMock(rateLimitCount = 0) {
  const mockInsertSelect = vi.fn().mockResolvedValue({ data: [{ id: 'log-row-1' }], error: null });
  const mockInsert = vi.fn().mockReturnValue({ select: mockInsertSelect });

  const mockGte = vi.fn().mockResolvedValue({
    count: rateLimitCount,
    data: [],
    error: null,
  });
  const mockEq = vi.fn().mockReturnValue({ gte: mockGte });
  const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
  const mockFrom = vi.fn().mockReturnValue({
    select: mockSelect,
    insert: mockInsert,
  });

  return {
    sb: { from: mockFrom },
    mocks: { mockInsert, mockInsertSelect, mockGte, mockEq, mockSelect, mockFrom },
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────────────────────────────────────────

const ACTOR_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const CHUNK_ID_1 = '11111111-1111-1111-1111-111111111111';
const CHUNK_ID_2 = '22222222-2222-2222-2222-222222222222';

function makeBaseRequest(overrides: Partial<HandlerRequest> = {}): HandlerRequest {
  return {
    protocol_id: null,
    step_week: 2,
    compound: 'semaglutide',
    prior_steps_context: '[]',
    actor_id: ACTOR_ID,
    ...overrides,
  };
}

function makeRagChunks(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    chunk_id: i === 0 ? CHUNK_ID_1 : CHUNK_ID_2,
    text: `RAG chunk ${i + 1} content about semaglutide dosing`,
    source_id: `src-${i}`,
    source_type: 'fda_label' as const,
    tier: 'A' as const,
    topic_tag: 'glp1-dosing',
    source_text_excerpt: `Excerpt ${i + 1}`,
    summary: `Summary ${i + 1}`,
    similarity: 0.9 - i * 0.1,
    rerank_score: null,
    evidence_date: '2025-01-01',
    freshness_reweight_applied: false,
    public_visibility: true,
  }));
}

function makeRagResult(n: number) {
  return {
    refused: false,
    refusal_reason: null,
    chunks: makeRagChunks(n),
    trace_id: crypto.randomUUID(),
    reranker_provider: 'none',
    embed_cost_usd: 0,
    rerank_cost_usd: 0,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

describe('handleAiAssist', () => {
  it('T1: returns refusal when RAG chunks are empty (no OpenRouter call)', async () => {
    const { sb } = makeSupabaseMock(0);
    const mockFetch = vi.fn();
    const mockEmit = vi.fn();

    const deps: HandlerDeps = {
      openrouterApiKey: 'sk-or-test-valid-key',
      supabaseUrl: 'http://localhost:54321',
      supabaseServiceKey: 'test-service-key',
      supabaseClient: sb,
      fetchImpl: mockFetch,
      ragRetrieve: vi.fn().mockResolvedValue(makeRagResult(0)),
      emitAiGenerationFn: mockEmit,
      isPharma02GatedTopicFn: () => false,
      now: () => new Date('2026-05-26T10:00:00Z'),
    };

    const result = await handleAiAssist(makeBaseRequest(), deps);

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      refusal: true,
      dose_mg: 0,
      monitoring: [],
      cited_chunk_ids: [],
    });
    expect((result.body as { refusal_reason?: string }).refusal_reason).toMatch(/no.*evidence/i);
    // No OpenRouter call when no chunks
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('T2: returns refusal for PHARMA-02 gated compound (no OpenRouter call)', async () => {
    const { sb, mocks } = makeSupabaseMock(0);
    const mockFetch = vi.fn();

    const deps: HandlerDeps = {
      openrouterApiKey: 'sk-or-test-valid-key',
      supabaseUrl: 'http://localhost:54321',
      supabaseServiceKey: 'test-service-key',
      supabaseClient: sb,
      fetchImpl: mockFetch,
      ragRetrieve: vi.fn().mockResolvedValue(makeRagResult(2)),
      isPharma02GatedTopicFn: (compound: string) => compound === 'cabergoline',
      now: () => new Date('2026-05-26T10:00:00Z'),
    };

    const result = await handleAiAssist(makeBaseRequest({ compound: 'cabergoline' }), deps);

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ refusal: true });
    expect((result.body as { refusal_reason?: string }).refusal_reason).toMatch(/gated|carveout/i);
    // No OpenRouter call
    expect(mockFetch).not.toHaveBeenCalled();
    // INSERT was called for audit log
    expect(mocks.mockInsert).toHaveBeenCalledTimes(1);
  });

  it('T3: returns 429 when actor_id has hit daily rate limit (no INSERT, no OpenRouter)', async () => {
    const { sb, mocks } = makeSupabaseMock(50); // count = 50 → rate limit hit
    const mockFetch = vi.fn();
    const mockRag = vi.fn();

    const deps: HandlerDeps = {
      openrouterApiKey: 'sk-or-test-valid-key',
      supabaseUrl: 'http://localhost:54321',
      supabaseServiceKey: 'test-service-key',
      supabaseClient: sb,
      fetchImpl: mockFetch,
      ragRetrieve: mockRag,
      isPharma02GatedTopicFn: () => false,
      now: () => new Date('2026-05-26T10:00:00Z'),
    };

    const result = await handleAiAssist(makeBaseRequest(), deps);

    expect(result.status).toBe(429);
    expect((result.body as { error: string }).error).toBe('rate_limit_exceeded');
    // resets_at must be midnight UTC tomorrow
    const resetsAt = new Date((result.body as { resets_at: string }).resets_at);
    expect(resetsAt.getUTCHours()).toBe(0);
    expect(resetsAt.getUTCMinutes()).toBe(0);
    // No INSERT (rate-limit doesn't log)
    expect(mocks.mockInsert).not.toHaveBeenCalled();
    // No OpenRouter call
    expect(mockFetch).not.toHaveBeenCalled();
    // RAG retrieve NOT called (rate limit checked first)
    expect(mockRag).not.toHaveBeenCalled();
  });

  it('T4: success path — inserts log row and emits PostHog with correct vendor/model', async () => {
    const { sb, mocks } = makeSupabaseMock(0);
    const mockEmit = vi.fn();
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                dose_mg: 5,
                monitoring: ['weight', 'glucose'],
                cited_chunk_ids: [CHUNK_ID_1, CHUNK_ID_2],
              }),
            },
          },
        ],
        usage: { prompt_tokens: 150, completion_tokens: 50 },
      }),
      text: async () => '',
    });

    const deps: HandlerDeps = {
      openrouterApiKey: 'sk-or-test-valid-key',
      supabaseUrl: 'http://localhost:54321',
      supabaseServiceKey: 'test-service-key',
      supabaseClient: sb,
      fetchImpl: mockFetch,
      ragRetrieve: vi.fn().mockResolvedValue(makeRagResult(3)),
      emitAiGenerationFn: mockEmit,
      isPharma02GatedTopicFn: () => false,
      now: () => new Date('2026-05-26T10:00:00Z'),
    };

    const result = await handleAiAssist(makeBaseRequest(), deps);

    expect(result.status).toBe(200);
    const body = result.body as {
      dose_mg: number;
      monitoring: string[];
      cited_chunk_ids: string[];
      refusal: boolean;
    };
    expect(body.dose_mg).toBe(5);
    expect(body.monitoring).toContain('weight');
    expect(body.cited_chunk_ids).toContain(CHUNK_ID_1);
    expect(body.refusal).toBe(false);

    // INSERT into admin_ai_assist_log
    expect(mocks.mockInsert).toHaveBeenCalledTimes(1);

    // emitAiGeneration called once with correct vendor/model
    expect(mockEmit).toHaveBeenCalledTimes(1);
    const emitCall = mockEmit.mock.calls[0][0] as {
      userId: string;
      properties: { vendor_field: string; model: string };
    };
    expect(emitCall.userId).toBe(ACTOR_ID);
    expect(emitCall.properties.vendor_field).toBe('openrouter_anthropic');
    expect(emitCall.properties.model).toBe('openrouter/anthropic/claude-sonnet-4-5');
  });

  it('T5: returns 503 and calls Slack when OPENROUTER_API_KEY is missing or placeholder', async () => {
    const { sb } = makeSupabaseMock(0);
    const mockFetch = vi.fn();
    const mockSlack = vi.fn().mockResolvedValue(undefined);

    const deps: HandlerDeps = {
      openrouterApiKey: 'placeholder-key',
      supabaseUrl: 'http://localhost:54321',
      supabaseServiceKey: 'test-service-key',
      supabaseClient: sb,
      fetchImpl: mockFetch,
      ragRetrieve: vi.fn(),
      sendSlackAlertFn: mockSlack,
      now: () => new Date('2026-05-26T10:00:00Z'),
    };

    const result = await handleAiAssist(makeBaseRequest(), deps);

    expect(result.status).toBe(503);
    expect((result.body as { error: string }).error).toBe('service_unavailable');
    expect((result.body as { reason: string }).reason).toMatch(/api.*key|key.*missing|placeholder/i);

    // Slack should have been called with regulatory channel and P1 severity
    expect(mockSlack).toHaveBeenCalledTimes(1);
    const slackCall = mockSlack.mock.calls[0] as [string, { severity: string }];
    expect(slackCall[0]).toBe('regulatory');
    expect(slackCall[1].severity).toBe('P1');
  });

  it('T6: server-side refusal override when OpenRouter returns cited_chunk_ids: []', async () => {
    const { sb, mocks } = makeSupabaseMock(0);
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                dose_mg: 10,
                monitoring: ['bp'],
                cited_chunk_ids: [],  // model failed to cite
              }),
            },
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 30 },
      }),
      text: async () => '',
    });

    const deps: HandlerDeps = {
      openrouterApiKey: 'sk-or-test-valid-key',
      supabaseUrl: 'http://localhost:54321',
      supabaseServiceKey: 'test-service-key',
      supabaseClient: sb,
      fetchImpl: mockFetch,
      ragRetrieve: vi.fn().mockResolvedValue(makeRagResult(2)),
      isPharma02GatedTopicFn: () => false,
      now: () => new Date('2026-05-26T10:00:00Z'),
    };

    const result = await handleAiAssist(makeBaseRequest(), deps);

    expect(result.status).toBe(200);
    const body = result.body as { refusal: boolean; refusal_reason?: string; cited_chunk_ids: string[] };
    expect(body.refusal).toBe(true);
    expect(body.refusal_reason).toMatch(/no qualifying evidence/i);
    expect(body.cited_chunk_ids).toHaveLength(0);
    // INSERT still happens with refusal=true
    expect(mocks.mockInsert).toHaveBeenCalledTimes(1);
  });
});
