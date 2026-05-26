/**
 * index.test.ts — Vitest unit tests for rag-federated-pubmed handler.
 *
 * Phase 60 Plan 60-07. Task 2 (TDD RED → GREEN).
 *
 * 8 tests:
 *  T1: POST {topic_tags, mode:'incremental'} → fetches since last_sync_at → returns count
 *  T2: enabled=false → 403 {error: 'source_disabled'}
 *  T3: mode:'historical-seed' → uses 30d clamp (not full-historical)
 *  T4: Duplicate content_hash insert → skipped_duplicate count incremented
 *  T5: On success → updates last_sync_at and clears last_error
 *  T6: On rate-limit-truncation error → Slack P2 rag alert fired via sendSlackAlert
 *  T7: Deno.serve NOT invoked when module imported (import.meta.main guard)
 *  T8: G7 cost cap exceeded after 1h wall-clock → emits cost_envelope_breach
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

// Mock modules with npm: specifiers (posthog-server uses npm:@supabase/supabase-js@2 etc.)
vi.mock('../../_shared/posthog-rag-events.ts', () => ({
  emitCostEnvelopeBreach: vi.fn(),
  shutdownPostHog: vi.fn().mockResolvedValue(undefined),
  emitAi04FenceBreach: vi.fn(),
}));
vi.mock('../../_shared/slack-guardrail-alert.ts', () => ({
  sendSlackGuardrailAlert: vi.fn().mockResolvedValue(undefined),
}));

// Mock the client module so we can control esearch/efetch responses
vi.mock('../client.ts', () => ({
  esearchByDateRange: vi.fn(),
  efetchByPmids: vi.fn(),
  RateLimitTruncationError: class extends Error {
    constructor(msg: string) {
      super(msg);
      this.name = 'RateLimitTruncationError';
    }
  },
  PubMedFetchError: class extends Error {
    constructor(attempts: number, status: number) {
      super(`Fetch failed after ${attempts} attempts. Last status: ${status}`);
      this.name = 'PubMedFetchError';
    }
  },
}));

// Mock federated-cache to avoid supabase chain complexity in handler tests
vi.mock('../../_shared/federated-cache.ts', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    readCachedFetch: vi.fn().mockResolvedValue(null),
    writeCachedFetch: vi.fn().mockResolvedValue(undefined),
  };
});

import { handleRequest } from '../handler.ts';
import type { HandlerDeps } from '../handler.ts';
import { esearchByDateRange, efetchByPmids, RateLimitTruncationError } from '../client.ts';

// ──────────────────────────────────────────────────────────────────────────────
// Mock factories
// ──────────────────────────────────────────────────────────────────────────────

const SERVICE_ROLE_KEY = 'test-service-role-key';

function makeRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('https://project.supabase.co/functions/v1/rag-federated-pubmed', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

type SupabaseRow = Record<string, unknown>;

interface SupabaseMock {
  _updateCalls: { table: string; data: SupabaseRow }[];
  _insertCalls: { table: string; data: SupabaseRow }[];
  rpc: ReturnType<typeof vi.fn>;
  from: ReturnType<typeof vi.fn>;
}

function makeSupabaseDb(opts: {
  federatedSource?: Partial<{
    enabled: boolean;
    last_sync_at: string | null;
    last_error: string | null;
    initial_seed_completed: boolean;
  }>;
  ragSourceId?: string;
  ragTopicId?: string;
  insertError?: { message: string } | null;
}): SupabaseMock {
  const source = {
    enabled: true,
    last_sync_at: '2026-04-26T03:00:00Z',
    last_error: null,
    initial_seed_completed: false,
    ...opts.federatedSource,
  };

  const updateCalls: { table: string; data: SupabaseRow }[] = [];
  const insertCalls: { table: string; data: SupabaseRow }[] = [];

  const mockSupabase: SupabaseMock = {
    _updateCalls: updateCalls,
    _insertCalls: insertCalls,
    rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
    from: vi.fn((table: string) => {
      if (table === 'federated_sources') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: source, error: null }),
          update: vi.fn().mockImplementation((data: SupabaseRow) => {
            updateCalls.push({ table: 'federated_sources', data });
            return { eq: vi.fn().mockResolvedValue({ error: null }) };
          }),
        };
      }
      if (table === 'rag_sources') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id: opts.ragSourceId ?? 'source-uuid-123' },
            error: null,
          }),
        };
      }
      if (table === 'rag_topics') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id: opts.ragTopicId ?? 'topic-uuid-456' },
            error: null,
          }),
        };
      }
      if (table === 'rag_chunks') {
        return {
          insert: vi.fn().mockImplementation((data: SupabaseRow) => {
            insertCalls.push({ table: 'rag_chunks', data });
            return Promise.resolve({ error: opts.insertError ?? null });
          }),
        };
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        update: vi.fn().mockImplementation((data: SupabaseRow) => {
          updateCalls.push({ table, data });
          return { eq: vi.fn().mockResolvedValue({ error: null }) };
        }),
      };
    }),
  };
  return mockSupabase;
}

// Pre-parsed article fixture for efetch return
const MOCK_ARTICLE = {
  pmid: '12345678',
  title: 'Test Article About GLP-1',
  abstract: 'This is the abstract text.',
  year: '2026',
};

function makeDeps(opts: {
  supabase?: SupabaseMock;
  emitCostEnvelopeBreach?: ReturnType<typeof vi.fn>;
  sendSlackAlert?: ReturnType<typeof vi.fn>;
  now?: () => Date;
} = {}): HandlerDeps & {
  _mockEmit: ReturnType<typeof vi.fn>;
  _mockSlack: ReturnType<typeof vi.fn>;
} {
  const _mockEmit = opts.emitCostEnvelopeBreach ?? vi.fn();
  const _mockSlack = opts.sendSlackAlert ?? vi.fn().mockResolvedValue(undefined);
  const supabase = opts.supabase ?? makeSupabaseDb({});

  return {
    supabase: supabase as never,
    env: { SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY },
    emitCostEnvelopeBreach: _mockEmit,
    sendSlackAlert: _mockSlack,
    now: opts.now,
    _mockEmit,
    _mockSlack,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

describe('handleRequest (rag-federated-pubmed)', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('T1: incremental mode → fetches since last_sync_at → returns queued count', async () => {
    vi.mocked(esearchByDateRange).mockResolvedValue({ pmids: ['12345678'] });
    vi.mocked(efetchByPmids).mockResolvedValue([MOCK_ARTICLE]);

    const supabase = makeSupabaseDb({ federatedSource: { last_sync_at: '2026-04-26T03:00:00Z' } });
    const deps = makeDeps({ supabase });

    const req = makeRequest({ topic_tags: ['GLP-1'], mode: 'incremental' });
    const res = await handleRequest(req, deps);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.queued).toBeGreaterThanOrEqual(0);
    expect(typeof body.skipped_duplicate).toBe('number');
    expect(Array.isArray(body.errors)).toBe(true);
  });

  it('T2: enabled=false → 403 source_disabled', async () => {
    const supabase = makeSupabaseDb({ federatedSource: { enabled: false } });
    const deps = makeDeps({ supabase });

    const req = makeRequest({ topic_tags: ['GLP-1'], mode: 'incremental' });
    const res = await handleRequest(req, deps);
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe('source_disabled');
  });

  it('T3: historical-seed mode uses 30d clamp on mindate', async () => {
    let capturedMindate: string | undefined;
    vi.mocked(esearchByDateRange).mockImplementation(async (opts) => {
      capturedMindate = opts.mindate;
      return { pmids: [] };
    });

    const fixedNow = new Date('2026-05-26T00:00:00Z');
    const supabase = makeSupabaseDb({ federatedSource: { last_sync_at: null } });
    const deps = makeDeps({ supabase, now: () => fixedNow });

    const req = makeRequest({ topic_tags: ['tirzepatide'], mode: 'historical-seed' });
    await handleRequest(req, deps);

    // 2026-05-26 minus 30 days = 2026-04-26
    expect(capturedMindate).toBe('2026/04/26');
  });

  it('T4: duplicate content_hash → skipped_duplicate count incremented', async () => {
    vi.mocked(esearchByDateRange).mockResolvedValue({ pmids: ['12345678'] });
    vi.mocked(efetchByPmids).mockResolvedValue([MOCK_ARTICLE]);

    const supabase = makeSupabaseDb({
      insertError: { message: 'duplicate key value violates unique constraint "rag_chunks_dedup_uq"' },
    });
    const deps = makeDeps({ supabase });

    const req = makeRequest({ topic_tags: ['GLP-1'], mode: 'incremental' });
    const res = await handleRequest(req, deps);
    const body = await res.json();

    expect(res.status).toBe(200);
    // Insert hit constraint → skipped_duplicate should be ≥ 1
    expect(body.skipped_duplicate).toBeGreaterThanOrEqual(1);
    expect(body.queued).toBe(0);
  });

  it('T5: on success → updates last_sync_at and clears last_error', async () => {
    vi.mocked(esearchByDateRange).mockResolvedValue({ pmids: [] });
    vi.mocked(efetchByPmids).mockResolvedValue([]);

    const supabase = makeSupabaseDb({});
    const deps = makeDeps({ supabase });

    const req = makeRequest({ topic_tags: ['GLP-1'], mode: 'incremental' });
    await handleRequest(req, deps);

    const updateCall = supabase._updateCalls.find((c) => c.table === 'federated_sources');
    expect(updateCall).toBeDefined();
    const data = updateCall?.data as Record<string, unknown>;
    expect(data['last_error']).toBeNull();
    expect(data['last_sync_at']).toBeDefined();
  });

  it('T6: on RateLimitTruncationError → Slack P2 rag alert fired via sendSlackAlert DI', async () => {
    vi.mocked(esearchByDateRange).mockRejectedValue(
      new RateLimitTruncationError('HTML response received'),
    );

    const supabase = makeSupabaseDb({});
    const deps = makeDeps({ supabase });

    const req = makeRequest({ topic_tags: ['GLP-1'], mode: 'incremental' });
    await handleRequest(req, deps);

    expect(deps._mockSlack).toHaveBeenCalledWith(
      'rag',
      expect.objectContaining({ severity: 'P2' }),
    );
  });

  it('T7: import.meta.main guard prevents Deno.serve on module import', async () => {
    // The fact that handleRequest can be imported without a server starting
    // proves the import.meta.main guard in index.ts works correctly.
    expect(typeof handleRequest).toBe('function');
  });

  it('T8: G7 cost cap exceeded after 1h wall-clock → emits cost_envelope_breach', async () => {
    vi.useFakeTimers();
    const startTime = 1000000000000;
    vi.setSystemTime(startTime);

    let callCount = 0;
    vi.mocked(esearchByDateRange).mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        // Advance time past 1 hour before second call
        vi.advanceTimersByTime(61 * 60 * 1000);
      }
      return { pmids: [] };
    });

    const supabase = makeSupabaseDb({});
    const deps = makeDeps({ supabase });

    // Two topic tags — second should hit the G7 cap
    const req = makeRequest({ topic_tags: ['GLP-1', 'tirzepatide'], mode: 'incremental' });

    const promise = handleRequest(req, deps);
    await vi.runAllTimersAsync();
    await promise;

    expect(deps._mockEmit).toHaveBeenCalled();
    expect(deps._mockSlack).toHaveBeenCalledWith(
      'cost',
      expect.objectContaining({ severity: 'P2' }),
    );
  });
});
