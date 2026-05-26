/**
 * Phase 60 Plan 60-09 — federated-api unit tests (TDD RED → GREEN).
 *
 * Option D resolution: display_name + sync_cadence_label derived from
 * client-side const map (SOURCE_META); not stored in DB table.
 *
 * Run with:
 *   npx vitest run --config vite.config.ts src/lib/admin/rag/__tests__/federated-api.test.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  listFederatedSources,
  setFederatedSourceEnabled,
  triggerHistoricalPull,
  type FederatedSource,
} from '../federated-api';

const { mockRpc, mockInvoke } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
  mockInvoke: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: mockRpc,
    functions: { invoke: mockInvoke },
  },
}));

const makeSources = (): FederatedSource[] => [
  {
    name: 'dailymed',
    enabled: true,
    auto_tier_a: true,
    sync_cron: '0 3 * * *',
    last_sync_at: '2026-05-20T03:00:00Z',
    last_error: null,
    last_error_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-05-20T03:00:00Z',
  },
  {
    name: 'openfda',
    enabled: false,
    auto_tier_a: true,
    sync_cron: '0 3 * * *',
    last_sync_at: null,
    last_error: null,
    last_error_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  {
    name: 'pubmed',
    enabled: false,
    auto_tier_a: true,
    sync_cron: '0 3 * * *',
    last_sync_at: null,
    last_error: 'Rate limit exceeded',
    last_error_at: '2026-05-19T03:05:00Z',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('listFederatedSources', () => {
  it('returns FederatedSource[] on success', async () => {
    const sources = makeSources();
    mockRpc.mockResolvedValueOnce({ data: sources, error: null });

    const result = await listFederatedSources();

    expect(mockRpc).toHaveBeenCalledWith('list_federated_sources');
    expect(result).toEqual(sources);
    expect(result).toHaveLength(3);
  });

  it('throws with error.message on RPC error', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'not authorized' },
    });

    await expect(listFederatedSources()).rejects.toThrow('not authorized');
  });
});

describe('setFederatedSourceEnabled', () => {
  it('returns updated row on success', async () => {
    const updated: FederatedSource = {
      ...makeSources()[0]!,
      name: 'pubmed',
      enabled: true,
      updated_at: '2026-05-26T10:00:00Z',
    };
    mockRpc.mockResolvedValueOnce({ data: updated, error: null });

    const result = await setFederatedSourceEnabled('pubmed', true);

    expect(mockRpc).toHaveBeenCalledWith('set_federated_source_enabled', {
      p_name: 'pubmed',
      p_enabled: true,
    });
    expect(result.enabled).toBe(true);
    expect(result.name).toBe('pubmed');
  });

  it('throws with error.message on RPC error', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'federated source unknown not found' },
    });

    await expect(setFederatedSourceEnabled('unknown' as 'pubmed', false)).rejects.toThrow(
      'federated source unknown not found',
    );
  });
});

describe('triggerHistoricalPull', () => {
  it('invokes correct Fn slug for pubmed', async () => {
    mockInvoke.mockResolvedValueOnce({ data: { queued: true }, error: null });

    await triggerHistoricalPull('pubmed');

    expect(mockInvoke).toHaveBeenCalledWith('rag-federated-pubmed', {
      body: { pull_mode: 'historical' },
    });
  });

  it('invokes correct Fn slug for openfda', async () => {
    mockInvoke.mockResolvedValueOnce({ data: { queued: true }, error: null });

    await triggerHistoricalPull('openfda');

    expect(mockInvoke).toHaveBeenCalledWith('rag-federated-fda', {
      body: { pull_mode: 'historical' },
    });
  });

  it('invokes correct Fn slug for dailymed', async () => {
    mockInvoke.mockResolvedValueOnce({ data: { queued: true }, error: null });

    await triggerHistoricalPull('dailymed');

    expect(mockInvoke).toHaveBeenCalledWith('rag-federated-dailymed', {
      body: { pull_mode: 'historical' },
    });
  });

  it('throws for unknown source name without invoking Fn', async () => {
    await expect(triggerHistoricalPull('unknown' as 'pubmed')).rejects.toThrow(
      'Unknown federated source: unknown',
    );
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('throws with error.message on Fn invocation error', async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: { message: 'Function returned 500' },
    });

    await expect(triggerHistoricalPull('pubmed')).rejects.toThrow('Function returned 500');
  });
});
