/**
 * Phase 60 Plan 60-13 Task 2 — API module unit tests.
 *
 * Tests 1-5 from plan behavior spec.
 * Schema validation tests use zod directly (no mock needed).
 * Query behavior tests mock the supabase module.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

// ─── Test 3 + 4: zod schema validation (no supabase mock needed) ──────────────

describe('60-13 API Test 3: tierSchema (T-60-13-SQLI-1)', () => {
  it('accepts valid tier values A, B, C', async () => {
    const { tierSchema } = await import('../api');
    expect(tierSchema.safeParse('A').success).toBe(true);
    expect(tierSchema.safeParse('B').success).toBe(true);
    expect(tierSchema.safeParse('C').success).toBe(true);
  });

  it('rejects invalid tier values D, X', async () => {
    const { tierSchema } = await import('../api');
    expect(tierSchema.safeParse('D').success).toBe(false);
    expect(tierSchema.safeParse('X').success).toBe(false);
  });

  it('accepts undefined tier (no tier filter)', async () => {
    const { tierSchema } = await import('../api');
    expect(tierSchema.safeParse(undefined).success).toBe(true);
  });
});

describe('60-13 API Test 4: searchQuerySchema (T-60-13-SQLI-1)', () => {
  it('accepts a normal search query', async () => {
    const { searchQuerySchema } = await import('../api');
    const result = searchQuerySchema.safeParse('tirzepatide weight loss');
    expect(result.success).toBe(true);
  });

  it('rejects queries exceeding 120 chars', async () => {
    const { searchQuerySchema } = await import('../api');
    const longQuery = 'a'.repeat(121);
    const result = searchQuerySchema.safeParse(longQuery);
    expect(result.success).toBe(false);
  });

  it('rejects SQL meta-characters: semicolon', async () => {
    const { searchQuerySchema } = await import('../api');
    const result = searchQuerySchema.safeParse('SELECT * FROM users; DROP TABLE users');
    expect(result.success).toBe(false);
  });

  it('rejects SQL meta-characters: double dash comment', async () => {
    const { searchQuerySchema } = await import('../api');
    const result = searchQuerySchema.safeParse('query -- comment injection');
    expect(result.success).toBe(false);
  });

  it('rejects SQL meta-characters: block comment open', async () => {
    const { searchQuerySchema } = await import('../api');
    const result = searchQuerySchema.safeParse('query /* block comment */');
    expect(result.success).toBe(false);
  });
});

describe('60-13 API: topicSchema validation', () => {
  it('accepts valid lowercase slug', async () => {
    const { topicSchema } = await import('../api');
    expect(topicSchema.safeParse('glp-1').success).toBe(true);
    expect(topicSchema.safeParse('peptide-research').success).toBe(true);
    expect(topicSchema.safeParse('semaglutide').success).toBe(true);
  });

  it('rejects reserved slugs (T-60-13-INFO-3)', async () => {
    const { topicSchema } = await import('../api');
    expect(topicSchema.safeParse('index').success).toBe(false);
    expect(topicSchema.safeParse('search').success).toBe(false);
    expect(topicSchema.safeParse('rss').success).toBe(false);
    expect(topicSchema.safeParse('feed').success).toBe(false);
    expect(topicSchema.safeParse('latest').success).toBe(false);
    expect(topicSchema.safeParse('popular').success).toBe(false);
  });

  it('rejects slugs with uppercase characters', async () => {
    const { topicSchema } = await import('../api');
    expect(topicSchema.safeParse('GLP-1').success).toBe(false);
  });

  it('rejects slugs with SQL injection characters', async () => {
    const { topicSchema } = await import('../api');
    expect(topicSchema.safeParse('topic; DROP TABLE').success).toBe(false);
  });
});

describe('60-13 API: KnowledgeApiError', () => {
  it('is a proper Error subclass', async () => {
    const { KnowledgeApiError } = await import('../api');
    const err = new KnowledgeApiError('test error', 'ERR_CODE');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(KnowledgeApiError);
    expect(err.name).toBe('KnowledgeApiError');
    expect(err.message).toBe('test error');
    expect(err.code).toBe('ERR_CODE');
  });
});

// ─── Supabase-dependent tests (mocked) ────────────────────────────────────────

// Build a fully chainable + thenable Supabase query mock.
// The chain is both: callable (returns self for .eq/.is/.select etc.)
// AND thenable (await chain resolves to terminalResult).
// Also supports .limit().single() and .limit() alone.
function buildChainMock(terminalResult: { data: unknown; error: unknown }) {
  const thenable = Promise.resolve(terminalResult);

  // A thenable chain — wraps the promise interface + chain methods
  function makeChainable(): Record<string, unknown> {
    const obj: Record<string, unknown> = {
      // Promise interface
      then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
        thenable.then(resolve, reject),
      catch: (fn: (e: unknown) => void) => thenable.catch(fn),
      finally: (fn: () => void) => thenable.finally(fn),
      // Terminal nodes
      single: vi.fn().mockReturnValue(thenable),
    };
    // All chain methods return a new chainable (same thenable)
    const chainMethods = ['select', 'eq', 'is', 'not', 'neq', 'order'];
    for (const m of chainMethods) {
      obj[m] = vi.fn().mockImplementation(() => makeChainable());
    }
    // limit returns a chainable that also has .single()
    obj['limit'] = vi.fn().mockImplementation(() => makeChainable());
    return obj;
  }

  return makeChainable();
}

const mockFrom = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('60-13 API Test 1: listTopics()', () => {
  it('returns TopicSummary[] for topics with published+visible chunks', async () => {
    mockFrom.mockReturnValue(
      buildChainMock({
        data: [
          { topic_tag: 'glp-1' },
          { topic_tag: 'glp-1' },
          { topic_tag: 'tirzepatide' },
        ],
        error: null,
      }),
    );

    const { listTopics } = await import('../api');
    const result = await listTopics();

    expect(Array.isArray(result)).toBe(true);
    expect(result.some((t) => t.slug === 'glp-1')).toBe(true);
    expect(result.find((t) => t.slug === 'glp-1')?.chunk_count).toBe(2);
    expect(result.find((t) => t.slug === 'tirzepatide')?.chunk_count).toBe(1);
  });

  it('filters out unknown topic_tags not in TOPIC_DISPLAY_NAMES', async () => {
    mockFrom.mockReturnValue(
      buildChainMock({
        data: [
          { topic_tag: 'unknown-topic-xyz' },
          { topic_tag: 'semaglutide' },
        ],
        error: null,
      }),
    );

    const { listTopics } = await import('../api');
    const result = await listTopics();

    expect(result.every((t) => t.slug !== 'unknown-topic-xyz')).toBe(true);
    expect(result.some((t) => t.slug === 'semaglutide')).toBe(true);
  });
});

describe('60-13 API Test 2: listPublishedChunksByTopic()', () => {
  it('queries rag_chunks and returns data for valid topic', async () => {
    const mockChunk = {
      id: 'chunk-1',
      topic_tag: 'glp-1',
      slug: 'fda-approval',
      source_tier: 'A',
      summary: 'Test summary',
      status: 'published',
      retracted_at: null,
      public_visibility: true,
    };
    mockFrom.mockReturnValue(buildChainMock({ data: [mockChunk], error: null }));

    const { listPublishedChunksByTopic } = await import('../api');
    const result = await listPublishedChunksByTopic({ topic: 'glp-1' });

    expect(Array.isArray(result)).toBe(true);
    expect(mockFrom).toHaveBeenCalledWith('rag_chunks');
  });

  it('throws KnowledgeApiError for invalid tier', async () => {
    const { listPublishedChunksByTopic, KnowledgeApiError } = await import('../api');
    await expect(
      listPublishedChunksByTopic({ topic: 'glp-1', tier: 'INVALID' }),
    ).rejects.toBeInstanceOf(KnowledgeApiError);
  });
});

describe('60-13 API Test 5: getFeaturedChunk()', () => {
  it('returns null when PGRST116 (no rows)', async () => {
    mockFrom.mockReturnValue(
      buildChainMock({ data: null, error: { code: 'PGRST116', message: 'No rows' } }),
    );

    const { getFeaturedChunk } = await import('../api');
    const result = await getFeaturedChunk();
    expect(result).toBeNull();
  });

  it('calls from("rag_chunks") with source_tier A filter', async () => {
    mockFrom.mockReturnValue(
      buildChainMock({
        data: {
          id: 'feat-001',
          topic_tag: 'glp-1',
          slug: 'featured',
          summary: 'Featured',
          source_tier: 'A',
          published_at: '2024-01-01',
          public_visibility: true,
        },
        error: null,
      }),
    );

    const { getFeaturedChunk } = await import('../api');
    const result = await getFeaturedChunk();

    expect(result).not.toBeNull();
    expect(mockFrom).toHaveBeenCalledWith('rag_chunks');
  });
});
