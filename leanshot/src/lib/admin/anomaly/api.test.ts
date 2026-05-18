/**
 * Phase 27 plan 27-04 — anomaly API client unit tests.
 *
 * Pattern: mocks the supabase client via vi.mock; asserts the discriminated
 * error contract + the list-row shape mapping (anomaly_tracked_funnels join
 * → flat event_name column).
 *
 * Per 27-PATTERNS S7 — discriminated error contract on RPC wrappers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock supabase BEFORE importing the module under test so the import binding
// resolves to our stub.
const mockRpc = vi.fn();
const mockFrom = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let api: typeof import('./api');

beforeEach(async () => {
  mockRpc.mockReset();
  mockFrom.mockReset();
  api = await import('./api');
});

afterEach(() => {
  vi.resetModules();
});

describe('acknowledgeAnomalyAlert', () => {
  it('throws AnomalyApiError("not_staff") on Postgres 42501', async () => {
    mockRpc.mockResolvedValue({
      error: { code: '42501', message: 'forbidden' },
    });
    await expect(api.acknowledgeAnomalyAlert('alert-1')).rejects.toMatchObject({
      name: 'AnomalyApiError',
      code: 'not_staff',
    });
  });

  it('resolves void on successful ack', async () => {
    mockRpc.mockResolvedValue({ error: null });
    await expect(api.acknowledgeAnomalyAlert('alert-1')).resolves.toBeUndefined();
    expect(mockRpc).toHaveBeenCalledWith('funnel_anomaly_acknowledge', { p_alert_id: 'alert-1' });
  });

  it('throws AnomalyApiError("not_found") on Postgres 22023', async () => {
    mockRpc.mockResolvedValue({
      error: { code: '22023', message: 'not_found' },
    });
    await expect(api.acknowledgeAnomalyAlert('alert-x')).rejects.toMatchObject({
      name: 'AnomalyApiError',
      code: 'not_found',
    });
  });

  it('throws AnomalyApiError("network") when supabase.rpc itself throws', async () => {
    mockRpc.mockRejectedValue(new Error('boom'));
    await expect(api.acknowledgeAnomalyAlert('alert-1')).rejects.toMatchObject({
      name: 'AnomalyApiError',
      code: 'network',
    });
  });
});

describe('listFiringAlerts', () => {
  function buildChain(rows: unknown[] | null, error: unknown = null) {
    const eq = vi.fn().mockResolvedValue({ data: rows, error });
    const limit = vi.fn().mockReturnValue({ eq, then: eq });
    const order = vi.fn().mockReturnValue({ limit });
    const select = vi.fn().mockReturnValue({ order });
    return { from: vi.fn().mockReturnValue({ select }), select, order, limit, eq };
  }

  it('maps anomaly_tracked_funnels join to flat event_name', async () => {
    const chain = buildChain([
      {
        id: 'alert-1',
        funnel_id: 'f1',
        fired_at: '2026-05-18T00:00:00Z',
        tick_bucket: '2026-05-18T00:00:00.000Z',
        observed_count: 2,
        expected_mean: 100,
        expected_stddev: 20,
        z_score: -4.9,
        resolution_status: 'firing',
        acknowledged_by: null,
        acknowledged_at: null,
        anomaly_tracked_funnels: { event_name: 'signup_completed' },
      },
    ]);
    mockFrom.mockImplementation(chain.from);

    const result = await api.listFiringAlerts('firing');
    expect(result).toHaveLength(1);
    expect(result[0].event_name).toBe('signup_completed');
    expect(result[0].resolution_status).toBe('firing');
    expect(chain.eq).toHaveBeenCalledWith('resolution_status', 'firing');
  });

  it('skips eq() when status filter is "all"', async () => {
    // Build a chain where eq is the same .limit() terminal — for 'all' the
    // code calls .limit() and awaits it directly, so we replicate that.
    const limit = vi.fn().mockResolvedValue({ data: [], error: null });
    const order = vi.fn().mockReturnValue({ limit });
    const select = vi.fn().mockReturnValue({ order });
    mockFrom.mockReturnValue({ select });

    const result = await api.listFiringAlerts('all');
    expect(result).toEqual([]);
  });

  it('throws AnomalyApiError on supabase error response', async () => {
    const chain = buildChain(null, { code: 'PGRST301', message: 'oops' });
    mockFrom.mockImplementation(chain.from);
    await expect(api.listFiringAlerts('firing')).rejects.toMatchObject({
      name: 'AnomalyApiError',
    });
  });
});
