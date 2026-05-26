/**
 * Phase 60 Plan 60-08 — chunk-api.ts unit tests (TDD RED → GREEN).
 *
 * Tests the typed wrappers over the 5 SECDEF RPCs from 60-01:
 *   approve_rag_chunk, reject_rag_chunk, retract_rag_chunk, queue_rag_chunk,
 *   list_rag_review_queue.
 *
 * Per D-AdminQueue-15 run with:
 *   npx vitest run --config vite.config.ts src/lib/admin/rag/__tests__/chunk-api.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockRpc, mockCapture } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
  mockCapture: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: mockRpc },
}));

vi.mock('posthog-js', () => ({
  default: { capture: mockCapture },
}));

import {
  ragListReviewQueue,
  ragApproveChunk,
  ragRejectChunk,
  ragRetractChunk,
  ragQueueChunk,
} from '../chunk-api';
import type { RejectReason } from '../chunk-api';

const CHUNK_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

const MOCK_ROWS = [
  {
    id: CHUNK_ID,
    source_id: 'src-1',
    source_name: 'PubMed',
    source_tier: 'B' as const,
    topic_tag: 'glp-1',
    summary: 'Summary text',
    quote_blocks: [{ text: 'quote', kind: 'dose' as const }],
    source_markdown: '# Test',
    created_by: 'user-1',
    queued_at: '2026-05-01T00:00:00Z',
    queue_age_hours: 24,
    canonical_url: 'https://pubmed.example.com/1',
  },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ragListReviewQueue', () => {
  it('Test 1: resolves to { data: ReviewQueueRow[], error: null } when rpc returns rows', async () => {
    mockRpc.mockResolvedValueOnce({ data: MOCK_ROWS, error: null });
    const result = await ragListReviewQueue({});
    expect(result).toEqual({ data: MOCK_ROWS, error: null });
    expect(mockRpc).toHaveBeenCalledWith('list_rag_review_queue', {
      p_tier: null,
      p_topic_tag: null,
      p_source_id: null,
      p_limit: 50,
      p_offset: 0,
    });
  });

  it('Test 2: forwards p_tier=B when tier filter is set', async () => {
    mockRpc.mockResolvedValueOnce({ data: [], error: null });
    await ragListReviewQueue({ tier: 'B' });
    expect(mockRpc).toHaveBeenCalledWith('list_rag_review_queue', expect.objectContaining({
      p_tier: 'B',
    }));
  });
});

describe('ragApproveChunk', () => {
  it('Test 3: calls supabase.rpc with approve_rag_chunk and p_chunk_id', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null });
    await ragApproveChunk(CHUNK_ID, { sourceTier: 'B', queueAgeHours: 24 });
    expect(mockRpc).toHaveBeenCalledWith('approve_rag_chunk', { p_chunk_id: CHUNK_ID });
  });

  it('Test 7a: emits posthog.capture with rag_chunk_reviewed on success', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null });
    await ragApproveChunk(CHUNK_ID, { sourceTier: 'B', queueAgeHours: 24 });
    expect(mockCapture).toHaveBeenCalledWith('rag_chunk_reviewed', {
      chunk_id: CHUNK_ID,
      source_tier: 'B',
      action: 'approve',
      queue_age_hours: 24,
    });
  });
});

describe('ragRejectChunk', () => {
  it('Test 4: calls supabase.rpc with reject_rag_chunk, p_chunk_id and p_reason', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null });
    const reason: RejectReason = 'off-topic';
    await ragRejectChunk(CHUNK_ID, reason, { sourceTier: 'B', queueAgeHours: 24 });
    expect(mockRpc).toHaveBeenCalledWith('reject_rag_chunk', {
      p_chunk_id: CHUNK_ID,
      p_reason: 'off-topic',
    });
  });

  it('Test 7b: emits posthog.capture with reject_reason on successful reject', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null });
    await ragRejectChunk(CHUNK_ID, 'factually-wrong', { sourceTier: 'A', queueAgeHours: 48 });
    expect(mockCapture).toHaveBeenCalledWith('rag_chunk_reviewed', {
      chunk_id: CHUNK_ID,
      source_tier: 'A',
      action: 'reject',
      reject_reason: 'factually-wrong',
      queue_age_hours: 48,
    });
  });
});

describe('ragRetractChunk', () => {
  it('Test 5: calls supabase.rpc with retract_rag_chunk', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null });
    await ragRetractChunk(CHUNK_ID, 'source URL retracted', { sourceTier: 'A', queueAgeHours: 10 });
    expect(mockRpc).toHaveBeenCalledWith('retract_rag_chunk', {
      p_chunk_id: CHUNK_ID,
      p_reason: 'source URL retracted',
    });
  });
});

describe('ragQueueChunk', () => {
  it('Test 6: calls supabase.rpc with queue_rag_chunk and all fields', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null });
    const quoteBlocks = [{ text: 'text', kind: 'dose' as const }];
    await ragQueueChunk(
      CHUNK_ID,
      { summary: 'New summary', quoteBlocks, tier: 'C', topicTag: 'peptide' },
      { sourceTier: 'C', queueAgeHours: 5 },
    );
    expect(mockRpc).toHaveBeenCalledWith('queue_rag_chunk', {
      p_chunk_id: CHUNK_ID,
      p_summary: 'New summary',
      p_quote_blocks: quoteBlocks,
      p_tier: 'C',
      p_topic_tag: 'peptide',
    });
  });

  it('Test 7c: emits posthog.capture with edit action on successful queue_rag_chunk', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null });
    const quoteBlocks = [{ text: 'q', kind: 'indication' as const }];
    await ragQueueChunk(
      CHUNK_ID,
      { summary: 'x', quoteBlocks, tier: 'B', topicTag: 'glp-1' },
      { sourceTier: 'B', queueAgeHours: 12 },
    );
    expect(mockCapture).toHaveBeenCalledWith('rag_chunk_reviewed', expect.objectContaining({
      action: 'edit',
    }));
  });
});

describe('RPC error handling', () => {
  it('Test 8: on RPC error returns { data: null, error } and does NOT throw', async () => {
    const pgError = { message: 'permission denied', code: '42501', details: '', hint: '' };
    mockRpc.mockResolvedValueOnce({ data: null, error: pgError });
    const result = await ragApproveChunk(CHUNK_ID, { sourceTier: 'B', queueAgeHours: 1 });
    expect(result.data).toBeNull();
    expect(result.error).toEqual(pgError);
    // No posthog event on error
    expect(mockCapture).not.toHaveBeenCalled();
  });
});
