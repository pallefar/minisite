/**
 * Phase 60 Plan 60-14 — cost-api.ts unit tests
 *
 * Behaviors:
 *   1. fetchCostRollup invokes rag-cost-query Edge Fn with correct body
 *   2. Returns typed CostRollupResponse[]
 *   3. acknowledgeBudgetCap calls rag_acknowledge_budget_cap RPC
 *   4. Edge Fn errors → CostApiError with typed kind
 *
 * T-60-14-PII-1: assert response contains only safe fields, no user_id/distinct_id.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supabase } from '@/lib/supabase';
import {
  CostApiError,
  acknowledgeBudgetCap,
  fetchBudgetCaps,
  fetchCostRollup,
} from '../cost-api';

// vi.mock is hoisted — factory must use vi.fn() without referencing outer vars
vi.mock('@/lib/supabase', () => ({
  supabase: {
    functions: { invoke: vi.fn() },
    rpc: vi.fn(),
    from: vi.fn(),
  },
}));

// Import AFTER vi.mock setup

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockInvoke(
  data: unknown | null,
  error: unknown | null = null,
) {
  (supabase.functions.invoke as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    data,
    error,
  });
}

function mockRpc(data: unknown | null, error: unknown | null = null) {
  (supabase.rpc as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    data,
    error,
  });
}

function mockFrom(data: unknown | null, error: unknown | null = null) {
  (supabase.from as ReturnType<typeof vi.fn>).mockReturnValueOnce({
    select: vi.fn().mockResolvedValueOnce({ data, error }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// fetchCostRollup
// ---------------------------------------------------------------------------

describe('fetchCostRollup', () => {
  it('invokes rag-cost-query with correct body', async () => {
    mockInvoke({
      results: [
        {
          vendor: 'cohere_rerank',
          mtd_usd: 3.68,
          sparkline_7d: [0, 0, 0, 0, 1.23, 2.45, 0],
          last_day_with_data: '2026-05-21',
        },
      ],
    });

    await fetchCostRollup({ rangeDays: 30, vendors: ['cohere_rerank'] });

    expect(supabase.functions.invoke).toHaveBeenCalledOnce();
    expect(supabase.functions.invoke).toHaveBeenCalledWith('rag-cost-query', {
      body: expect.objectContaining({
        rangeDays: 30,
        vendors: ['cohere_rerank'],
      }),
    });
  });

  it('returns typed CostRollupResponse[] with correct shape', async () => {
    const mockResult = {
      vendor: 'openai_embed',
      mtd_usd: 15.5,
      sparkline_7d: [1, 2, 3, 4, 5, 6, 7],
      last_day_with_data: '2026-05-22',
    };
    mockInvoke({ results: [mockResult] });

    const result = await fetchCostRollup({ vendors: ['openai_embed'] });

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      vendor: 'openai_embed',
      mtd_usd: 15.5,
      sparkline_7d: [1, 2, 3, 4, 5, 6, 7],
      last_day_with_data: '2026-05-22',
    });
  });

  it('response contains only safe fields — no PII (T-60-14-PII-1)', async () => {
    mockInvoke({
      results: [
        {
          vendor: 'firecrawl',
          mtd_usd: 0,
          sparkline_7d: [0, 0, 0, 0, 0, 0, 0],
          last_day_with_data: null,
        },
      ],
    });

    const result = await fetchCostRollup({ vendors: ['firecrawl'] });
    const row = result[0]!;

    expect(Object.keys(row).sort()).toEqual(
      ['last_day_with_data', 'mtd_usd', 'sparkline_7d', 'vendor'].sort(),
    );
    expect('user_id' in row).toBe(false);
    expect('distinct_id' in row).toBe(false);
  });

  it('throws CostApiError with kind=forbidden on 403', async () => {
    mockInvoke(null, { message: 'forbidden', status: 403 });

    await expect(
      fetchCostRollup({ vendors: ['cohere_rerank'] }),
    ).rejects.toMatchObject({ kind: 'forbidden' });
  });

  it('throws CostApiError with kind=invalid_vendor on 400', async () => {
    mockInvoke(null, { message: 'invalid_vendor', status: 400 });

    await expect(
      fetchCostRollup({ vendors: ['cohere_rerank'] }),
    ).rejects.toMatchObject({ kind: 'invalid_vendor' });
  });

  it('throws CostApiError with kind=upstream_rate_limited on 429', async () => {
    mockInvoke(null, { message: 'upstream_rate_limited', status: 429 });

    await expect(
      fetchCostRollup({ vendors: ['firecrawl'] }),
    ).rejects.toMatchObject({ kind: 'upstream_rate_limited' });
  });

  it('throws CostApiError with kind=unknown on unexpected error', async () => {
    mockInvoke(null, { message: 'internal error', status: 500 });

    await expect(
      fetchCostRollup({ vendors: ['firecrawl'] }),
    ).rejects.toMatchObject({ kind: 'unknown' });
  });
});

// ---------------------------------------------------------------------------
// acknowledgeBudgetCap
// ---------------------------------------------------------------------------

describe('acknowledgeBudgetCap', () => {
  it('calls rag_acknowledge_budget_cap RPC with p_vendor param', async () => {
    mockRpc(null, null);

    await acknowledgeBudgetCap('cohere_rerank');

    expect(supabase.rpc).toHaveBeenCalledOnce();
    expect(supabase.rpc).toHaveBeenCalledWith('rag_acknowledge_budget_cap', {
      p_vendor: 'cohere_rerank',
    });
  });

  it('resolves without error on success', async () => {
    mockRpc(null, null);

    await expect(acknowledgeBudgetCap('cohere_rerank')).resolves.toBeUndefined();
  });

  it('throws CostApiError when RPC returns error', async () => {
    mockRpc(null, { message: 'forbidden', code: '42501' });

    await expect(acknowledgeBudgetCap('cohere_rerank')).rejects.toBeInstanceOf(
      CostApiError,
    );
  });
});

// ---------------------------------------------------------------------------
// fetchBudgetCaps
// ---------------------------------------------------------------------------

describe('fetchBudgetCaps', () => {
  it('reads rag_budget_caps table via PostgREST', async () => {
    const mockData = [
      {
        vendor: 'cohere_rerank',
        cap_usd: 20,
        mtd_spend_usd: 5,
        last_acknowledged_at: null,
        source_pause_state: false,
      },
    ];
    mockFrom(mockData, null);

    const result = await fetchBudgetCaps();

    expect(supabase.from).toHaveBeenCalledWith('rag_budget_caps');
    expect(result).toEqual(mockData);
  });

  it('throws CostApiError on PostgREST error', async () => {
    mockFrom(null, { message: 'permission denied', code: '42501' });

    await expect(fetchBudgetCaps()).rejects.toBeInstanceOf(CostApiError);
  });
});
