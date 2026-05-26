/**
 * handler.test.ts — Vitest unit tests for protocol-ai-assist handler.
 *
 * Phase 61 Plan 03. Task 1 (RED → GREEN cycle).
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
// Mock @supabase/supabase-js
// ──────────────────────────────────────────────────────────────────────────────

const mockInsertSelect = vi.fn();
const mockInsert = vi.fn(() => ({ select: mockInsertSelect }));
const mockGte = vi.fn();
const mockEq = vi.fn(() => ({ gte: mockGte }));
const mockSelect = vi.fn(() => ({ eq: mockEq }));
const mockFrom = vi.fn(() => ({
  select: mockSelect,
  insert: mockInsert,
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: mockFrom,
  })),
}));

// ──────────────────────────────────────────────────────────────────────────────
// Mock _shared helpers
// ──────────────────────────────────────────────────────────────────────────────

const mockEmitAiGeneration = vi.fn();
const mockShutdownPostHog = vi.fn();
vi.mock('../../_shared/posthog-rag-events.ts', () => ({
  emitAiGeneration: (...args: unknown[]) => mockEmitAiGeneration(...args),
  shutdownPostHog: (...args: unknown[]) => mockShutdownPostHog(...args),
}));

const mockSendSlackGuardrailAlert = vi.fn();
vi.mock('../../_shared/slack-guardrail-alert.ts', () => ({
  sendSlackGuardrailAlert: (...args: unknown[]) => mockSendSlackGuardrailAlert(...args),
}));

// isPharma02GatedTopic returns true for 'cabergoline' (mock for tests)
const mockIsPharma02GatedTopic = vi.fn((compound: string) => compound === 'cabergoline');
vi.mock('../../_shared/pharma-02-carveout.ts', () => ({
  isPharma02GatedTopic: (compound: string) => mockIsPharma02GatedTopic(compound),
}));

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

function makeBaseDeps(overrides: Partial<HandlerDeps> = {}): HandlerDeps {
  // Default: rate limit not exceeded (count = 0)
  mockGte.mockResolvedValue({ count: 0, data: [], error: null });
  mockInsertSelect.mockResolvedValue({ data: [{ id: 'log-row-1' }], error: null });

  return {
    openrouterApiKey: 'sk-or-test-valid-key',
    supabaseUrl: 'http://localhost:54321',
    supabaseServiceKey: 'test-service-key',
    posthogKey: undefined,
    slackWebhookUrl: undefined,
    fetchImpl: vi.fn(),
    ragRetrieve: vi.fn(),
    now: () => new Date('2026-05-26T10:00:00Z'),
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
    refused: false,
    refusal_reason: null,
  }));
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

describe('handleAiAssist', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset default mock implementations
    mockGte.mockResolvedValue({ count: 0, data: [], error: null });
    mockInsertSelect.mockResolvedValue({ data: [{ id: 'log-row-1' }], error: null });
  });

  it('T1: returns refusal when RAG chunks are empty (no OpenRouter call)', async () => {
    const deps = makeBaseDeps({
      ragRetrieve: vi.fn().mockResolvedValue({ chunks: [], refused: false, refusal_reason: null, trace_id: 'trace-1', reranker_provider: 'none', embed_cost_usd: 0, rerank_cost_usd: 0 }),
      fetchImpl: vi.fn(),
    });
    const req = makeBaseRequest();

    const result = await handleAiAssist(req, deps);

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      refusal: true,
      dose_mg: 0,
      monitoring: [],
      cited_chunk_ids: [],
    });
    expect((result.body as { refusal_reason?: string }).refusal_reason).toMatch(/no.*evidence/i);
    expect(deps.fetchImpl).not.toHaveBeenCalled();
  });

  it('T2: returns refusal for PHARMA-02 gated compound (no OpenRouter call)', async () => {
    const deps = makeBaseDeps({
      ragRetrieve: vi.fn().mockResolvedValue({ chunks: makeRagChunks(2), refused: false, refusal_reason: null, trace_id: 'trace-2', reranker_provider: 'none', embed_cost_usd: 0, rerank_cost_usd: 0 }),
      fetchImpl: vi.fn(),
    });
    const req = makeBaseRequest({ compound: 'cabergoline' });

    const result = await handleAiAssist(req, deps);

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ refusal: true });
    expect((result.body as { refusal_reason?: string }).refusal_reason).toMatch(/gated|carveout/i);
    expect(deps.fetchImpl).not.toHaveBeenCalled();
  });

  it('T3: returns 429 when actor_id has hit daily rate limit (no INSERT, no OpenRouter)', async () => {
    // Simulate rate limit exceeded: count = 50
    mockGte.mockResolvedValue({ count: 50, data: [], error: null });

    const deps = makeBaseDeps({
      ragRetrieve: vi.fn(),
      fetchImpl: vi.fn(),
    });
    const req = makeBaseRequest();

    const result = await handleAiAssist(req, deps);

    expect(result.status).toBe(429);
    expect((result.body as { error: string }).error).toBe('rate_limit_exceeded');
    expect((result.body as { resets_at: string }).resets_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    // No INSERT should have been called
    expect(mockInsert).not.toHaveBeenCalled();
    // No OpenRouter call
    expect(deps.fetchImpl).not.toHaveBeenCalled();
    // ragRetrieve should NOT have been called
    expect(deps.ragRetrieve).not.toHaveBeenCalled();
  });

  it('T4: success path — inserts log row and emits PostHog with correct vendor/model', async () => {
    const chunks = makeRagChunks(3);
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
    });

    const deps = makeBaseDeps({
      ragRetrieve: vi.fn().mockResolvedValue({
        chunks,
        refused: false,
        refusal_reason: null,
        trace_id: 'trace-4',
        reranker_provider: 'none',
        embed_cost_usd: 0,
        rerank_cost_usd: 0,
      }),
      fetchImpl: mockFetch,
    });
    const req = makeBaseRequest();

    const result = await handleAiAssist(req, deps);

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
    expect(mockInsert).toHaveBeenCalledTimes(1);

    // emitAiGeneration called once with correct vendor/model
    expect(mockEmitAiGeneration).toHaveBeenCalledTimes(1);
    const emitCall = mockEmitAiGeneration.mock.calls[0][0] as {
      userId: string;
      properties: { vendor_field: string; model: string };
    };
    expect(emitCall.userId).toBe(ACTOR_ID);
    expect(emitCall.properties.vendor_field).toBe('openrouter_anthropic');
    expect(emitCall.properties.model).toBe('openrouter/anthropic/claude-sonnet-4-5');
  });

  it('T5: returns 503 and calls Slack when OPENROUTER_API_KEY is missing or placeholder', async () => {
    const deps = makeBaseDeps({
      openrouterApiKey: 'placeholder-key',
      ragRetrieve: vi.fn(),
      fetchImpl: vi.fn(),
      slackWebhookUrl: 'https://hooks.slack.com/services/test',
    });
    const req = makeBaseRequest();

    const result = await handleAiAssist(req, deps);

    expect(result.status).toBe(503);
    expect((result.body as { error: string }).error).toBe('service_unavailable');
    expect((result.body as { reason: string }).reason).toMatch(/api.*key/i);
    // Slack should have been called with regulatory severity
    expect(mockSendSlackGuardrailAlert).toHaveBeenCalledTimes(1);
    const slackCall = mockSendSlackGuardrailAlert.mock.calls[0];
    expect(slackCall[0]).toBe('regulatory');
    expect(slackCall[1].severity).toBe('P1');
  });

  it('T6: server-side refusal override when OpenRouter returns cited_chunk_ids: []', async () => {
    const chunks = makeRagChunks(2);
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
    });

    const deps = makeBaseDeps({
      ragRetrieve: vi.fn().mockResolvedValue({
        chunks,
        refused: false,
        refusal_reason: null,
        trace_id: 'trace-6',
        reranker_provider: 'none',
        embed_cost_usd: 0,
        rerank_cost_usd: 0,
      }),
      fetchImpl: mockFetch,
    });
    const req = makeBaseRequest();

    const result = await handleAiAssist(req, deps);

    expect(result.status).toBe(200);
    const body = result.body as { refusal: boolean; refusal_reason?: string; cited_chunk_ids: string[] };
    expect(body.refusal).toBe(true);
    expect(body.refusal_reason).toMatch(/no qualifying evidence/i);
    expect(body.cited_chunk_ids).toHaveLength(0);
    // INSERT still happens with refusal=true
    expect(mockInsert).toHaveBeenCalledTimes(1);
  });
});
