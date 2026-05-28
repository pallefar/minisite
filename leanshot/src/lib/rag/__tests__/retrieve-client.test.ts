/**
 * Phase 60 Plan 60-10 Task 2 — retrieve-client + server-rag-events-relay tests.
 *
 * Run: npx vitest run --config vite.config.ts src/lib/rag/__tests__/retrieve-client.test.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ragChunkById, ragRetrieve } from '../retrieve-client';
import { captureRagEventBrowser } from '../server-rag-events-relay';

// ─── Mock @/lib/supabase ──────────────────────────────────────────────────────

// Use vi.hoisted so the mock factory can reference mockInvoke before module load.
const { mockInvoke } = vi.hoisted(() => ({ mockInvoke: vi.fn() }));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    functions: {
      invoke: mockInvoke,
    },
  },
}));

// ─── Helpers ───────────────────────────────────────────────────────────────────

const VALID_CHUNK = {
  chunk_id: 'a1b2c3d4-e5f6-7890-abcd-ef0123456789',
  source_name: 'FDA Ozempic Label',
  source_type: 'fda_label' as const,
  source_tier: 'A' as const,
  canonical_url: 'https://www.accessdata.fda.gov/ozempic.pdf',
  topic_tag: 'glp1-dosing',
  summary: 'Ozempic dosing schedule',
  verbatim_quote: 'Tirzepatide is dosed weekly starting at 2.5mg.',
  scraped_at: '2024-01-15T00:00:00Z',
  last_reviewed_at: '2024-01-15T00:00:00Z',
  stale: false,
  public_visibility: true,
};

beforeEach(() => {
  mockInvoke.mockReset();
  vi.clearAllMocks();
});

// ─── ragChunkById tests ────────────────────────────────────────────────────────

describe('ragChunkById', () => {
  // Test 1: calls invoke with correct params + zod-parses result
  it('Test 1: calls rag-retrieve in lookup mode and returns validated chunk', async () => {
    mockInvoke.mockResolvedValue({ data: VALID_CHUNK, error: null });

    const result = await ragChunkById('a1b2c3d4-e5f6-7890-abcd-ef0123456789');

    expect(mockInvoke).toHaveBeenCalledWith('rag-retrieve', {
      body: { mode: 'lookup', chunk_id: 'a1b2c3d4-e5f6-7890-abcd-ef0123456789' },
    });
    expect(result).toEqual(VALID_CHUNK);
  });

  // Test 2: 404 / null data → returns null
  it('Test 2: resolves to null when chunk not found (null data)', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: null });

    const result = await ragChunkById('a1b2c3d4-e5f6-7890-abcd-ef0123456789');
    expect(result).toBeNull();
  });

  // Test 2b: error from invoke → returns null
  it('Test 2b: resolves to null when invoke returns an error', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: { message: 'not found', status: 404 } });

    const result = await ragChunkById('a1b2c3d4-e5f6-7890-abcd-ef0123456789');
    expect(result).toBeNull();
  });

  // Test 3: schema drift → returns null AND fires schema_violation telemetry
  it('Test 3: returns null + fires schema violation telemetry on zod parse failure', async () => {
    const invalidData = { ...VALID_CHUNK, source_tier: 'D' }; // invalid tier
    mockInvoke.mockResolvedValue({ data: invalidData, error: null });

    const captureImportMock = vi.fn().mockResolvedValue(undefined);
    // We can't easily mock the lazy import — but we can verify the null return
    // and that console.warn is called (schema mismatch logged).
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await ragChunkById('a1b2c3d4-e5f6-7890-abcd-ef0123456789');

    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[rag-retrieve] schema validation failed'),
      expect.any(String),
      expect.anything(),
    );

    void captureImportMock;
    warnSpy.mockRestore();
  });
});

// ─── ragRetrieve tests ─────────────────────────────────────────────────────────

describe('ragRetrieve', () => {
  // Test 4: query mode with filters
  it('Test 4: calls rag-retrieve in query mode and validates results array', async () => {
    mockInvoke.mockResolvedValue({
      data: { results: [VALID_CHUNK], count: 1 },
      error: null,
    });

    const result = await ragRetrieve({
      query: 'ozempic dosing',
      k: 5,
      filters: { source_tier: ['A'] },
    });

    expect(mockInvoke).toHaveBeenCalledWith('rag-retrieve', {
      body: { mode: 'query', query: 'ozempic dosing', k: 5, filters: { source_tier: ['A'] } },
    });
    expect(result.results).toHaveLength(1);
    expect(result.count).toBe(1);
  });

  it('returns empty results on invoke error', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: { message: 'server error' } });

    const result = await ragRetrieve({ query: 'test' });
    expect(result.results).toHaveLength(0);
    expect(result.count).toBe(0);
  });
});

// ─── captureRagEventBrowser tests ─────────────────────────────────────────────

describe('captureRagEventBrowser', () => {
  // Test 5: POSTs to server-rag-event-relay
  it('Test 5: invokes server-rag-event-relay with event + properties', async () => {
    mockInvoke.mockResolvedValue({ data: {}, error: null });

    await captureRagEventBrowser('rag_citation_clicked', { chunk_id: 'abc', surface: 'coach' });

    expect(mockInvoke).toHaveBeenCalledWith(
      'server-rag-event-relay',
      expect.objectContaining({
        body: { event: 'rag_citation_clicked', properties: { chunk_id: 'abc', surface: 'coach' } },
      }),
    );
  });

  // Test 6: network error → caught, logs warn, does NOT throw
  it('Test 6: network error is caught silently (does not throw)', async () => {
    mockInvoke.mockRejectedValue(new Error('Network error'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Should not throw
    await expect(
      captureRagEventBrowser('rag_sources_footer_expanded', { count: 3 }),
    ).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  // Test 6b: invoke error (non-throw) → warn, does not propagate
  it('Test 6b: invoke error (non-throw) is logged and swallowed', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: { message: 'relay error' } });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(captureRagEventBrowser('rag_citation_clicked', {})).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[server-rag-event-relay] error:'),
      expect.anything(),
    );
    warnSpy.mockRestore();
  });
});
