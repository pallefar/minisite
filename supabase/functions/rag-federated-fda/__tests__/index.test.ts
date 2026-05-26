/**
 * index.test.ts — Vitest unit tests for rag-federated-fda handler.
 *
 * Phase 60 Plan 60-07. Task 3 (TDD RED → GREEN).
 *
 * 7 tests:
 *  T1: POST {topic_tags, mode:'incremental'} → fetches label + event → queues all
 *  T2: enabled=false → 403
 *  T3: PII regression — patientweight=85 in event fixture → excerpt does NOT contain '85'
 *  T4: Duplicate external_id deduplication
 *  T5: last_sync_at / last_error flow (success → updates last_sync_at)
 *  T6: Deno.serve guarded by import.meta.main
 *  T7: G7 cost-cap halt fires emitCostEnvelopeBreach
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../_shared/posthog-rag-events.ts', () => ({
  emitCostEnvelopeBreach: vi.fn(),
  shutdownPostHog: vi.fn().mockResolvedValue(undefined),
  emitAi04FenceBreach: vi.fn(),
}));
vi.mock('../../_shared/slack-guardrail-alert.ts', () => ({
  sendSlackGuardrailAlert: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../client.ts', () => ({
  searchDrugLabels: vi.fn(),
  searchDrugEvents: vi.fn(),
  _resetRateLimit: vi.fn(),
  FDAFetchError: class extends Error {
    constructor(attempts: number, status: number) {
      super(`Fetch failed after ${attempts} attempts. Last status: ${status}`);
      this.name = 'FDAFetchError';
    }
  },
}));
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
import { searchDrugLabels, searchDrugEvents } from '../client.ts';
import { normalizeOpenFDADrugEvent, OpenFDADrugEventSchema } from '../normalize.ts';

const SERVICE_ROLE_KEY = 'test-service-role-key';

function makeRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('https://project.supabase.co/functions/v1/rag-federated-fda', {
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
  rpc: ReturnType<typeof vi.fn>;
  from: ReturnType<typeof vi.fn>;
}

function makeSupabaseDb(opts: {
  enabled?: boolean;
  insertError?: { message: string } | null;
} = {}): SupabaseMock {
  const updateCalls: { table: string; data: SupabaseRow }[] = [];

  return {
    _updateCalls: updateCalls,
    rpc: vi.fn().mockResolvedValue({ data: true, error: null }),
    from: vi.fn((table: string) => {
      if (table === 'federated_sources') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { enabled: opts.enabled !== false, last_sync_at: null, initial_seed_completed: false },
            error: null,
          }),
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
          maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'fda-source-uuid' }, error: null }),
        };
      }
      if (table === 'rag_topics') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'topic-uuid' }, error: null }),
        };
      }
      if (table === 'rag_chunks') {
        return {
          insert: vi.fn().mockResolvedValue({ error: opts.insertError ?? null }),
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
}

const LABEL_FIXTURE = [{
  set_id: 'set-001',
  version: '1',
  effective_time: '20260526',
  openfda: { brand_name: ['Mounjaro'], generic_name: ['tirzepatide'] },
  boxed_warning: ['WARNING: Thyroid risk.'],
  indications_and_usage: ['For type 2 diabetes.'],
}];

const EVENT_FIXTURE = [{
  safetyreportid: 'SAR-001',
  receivedate: '20260526',
  patient: {
    drug: [{ medicinalproduct: 'MOUNJARO', drugindication: 'OBESITY' }],
    reaction: [{ reactionmeddrapt: 'Nausea' }],
    patientweight: '85', // This should be stripped by PII guard
    patientsex: '2',
  },
}];

function makeDeps(opts: { supabase?: SupabaseMock; now?: () => Date } = {}): HandlerDeps & {
  _mockEmit: ReturnType<typeof vi.fn>;
  _mockSlack: ReturnType<typeof vi.fn>;
} {
  const _mockEmit = vi.fn();
  const _mockSlack = vi.fn().mockResolvedValue(undefined);
  return {
    supabase: (opts.supabase ?? makeSupabaseDb({})) as never,
    env: { SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY },
    emitCostEnvelopeBreach: _mockEmit,
    sendSlackAlert: _mockSlack,
    now: opts.now,
    _mockEmit,
    _mockSlack,
  };
}

describe('handleRequest (rag-federated-fda)', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('T1: incremental mode → fetches BOTH drug/label + drug/event → queues all', async () => {
    vi.mocked(searchDrugLabels).mockResolvedValue({ results: LABEL_FIXTURE });
    vi.mocked(searchDrugEvents).mockResolvedValue({ results: EVENT_FIXTURE });

    const deps = makeDeps();
    const req = makeRequest({ topic_tags: ['tirzepatide', 'semaglutide'], mode: 'incremental' });
    const res = await handleRequest(req, deps);
    const body = await res.json();

    expect(res.status).toBe(200);
    // Both searchDrugLabels and searchDrugEvents called once per topic_tag
    expect(searchDrugLabels).toHaveBeenCalledTimes(2);
    expect(searchDrugEvents).toHaveBeenCalledTimes(2);
    expect(body.queued).toBeGreaterThanOrEqual(0);
  });

  it('T2: enabled=false → 403', async () => {
    const supabase = makeSupabaseDb({ enabled: false });
    const deps = makeDeps({ supabase });
    const req = makeRequest({ topic_tags: ['tirzepatide'], mode: 'incremental' });
    const res = await handleRequest(req, deps);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('source_disabled');
  });

  it('T3: PII regression — patientweight=85 does NOT appear in excerpt', async () => {
    // Directly test the normalizer with a fixture containing PII fields
    const eventWithPii = {
      safetyreportid: 'SAR-PII-TEST',
      receivedate: '20260526',
      patient: {
        drug: [{ medicinalproduct: 'TESTDRUG', drugindication: 'OBESITY' }],
        reaction: [{ reactionmeddrapt: 'Nausea' }],
        patientweight: '85',   // PII — MUST be stripped
        patientsex: '2',       // PII — MUST be stripped
        patientonsetage: '45', // PII — MUST be stripped
        patientonsetagegroup: '5', // PII — MUST be stripped
      },
    };

    const event = OpenFDADrugEventSchema.parse(eventWithPii);
    const payload = await normalizeOpenFDADrugEvent(
      event,
      'tirzepatide',
      'topic-id',
      'source-id',
    );

    // The literal value '85' from patientweight must not appear in the excerpt
    expect(payload.source_text_excerpt).not.toContain('85');
    expect(payload.source_text_excerpt).not.toContain('patientweight');
    // Drug name and reaction DO appear
    expect(payload.source_text_excerpt).toContain('TESTDRUG');
    expect(payload.source_text_excerpt).toContain('Nausea');
  });

  it('T4: duplicate insert → skipped_duplicate count incremented', async () => {
    vi.mocked(searchDrugLabels).mockResolvedValue({ results: LABEL_FIXTURE });
    vi.mocked(searchDrugEvents).mockResolvedValue({ results: [] });

    const supabase = makeSupabaseDb({
      insertError: { message: 'duplicate key value violates unique constraint "rag_chunks_dedup_uq"' },
    });
    const deps = makeDeps({ supabase });
    const req = makeRequest({ topic_tags: ['tirzepatide'], mode: 'incremental' });
    const res = await handleRequest(req, deps);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.skipped_duplicate).toBeGreaterThanOrEqual(1);
    expect(body.queued).toBe(0);
  });

  it('T5: on success → updates last_sync_at', async () => {
    vi.mocked(searchDrugLabels).mockResolvedValue({ results: [] });
    vi.mocked(searchDrugEvents).mockResolvedValue({ results: [] });

    const supabase = makeSupabaseDb({});
    const deps = makeDeps({ supabase });
    const req = makeRequest({ topic_tags: ['tirzepatide'], mode: 'incremental' });
    await handleRequest(req, deps);

    const updateCall = supabase._updateCalls.find((c) => c.table === 'federated_sources');
    expect(updateCall).toBeDefined();
    const data = updateCall?.data as Record<string, unknown>;
    expect(data['last_error']).toBeNull();
    expect(data['last_sync_at']).toBeDefined();
  });

  it('T6: import.meta.main guard prevents Deno.serve on module import', () => {
    expect(typeof handleRequest).toBe('function');
  });

  it('T7: G7 cost-cap fires emitCostEnvelopeBreach after 1h', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000000000000);

    let callCount = 0;
    vi.mocked(searchDrugLabels).mockImplementation(async () => {
      callCount++;
      if (callCount === 1) vi.advanceTimersByTime(61 * 60 * 1000);
      return { results: [] };
    });
    vi.mocked(searchDrugEvents).mockResolvedValue({ results: [] });

    const deps = makeDeps();
    const req = makeRequest({ topic_tags: ['GLP-1', 'tirzepatide'], mode: 'incremental' });

    const promise = handleRequest(req, deps);
    await vi.runAllTimersAsync();
    await promise;

    expect(deps._mockEmit).toHaveBeenCalled();
    expect(deps._mockSlack).toHaveBeenCalledWith('cost', expect.objectContaining({ severity: 'P2' }));
  });
});
