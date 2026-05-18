/**
 * Phase 27 plan 27-05 — anomaly config API client unit tests.
 *
 * Mirrors the shape of src/lib/admin/anomaly/api.test.ts (Plan 27-04).
 * Pattern: mocks the supabase client via vi.mock; asserts the discriminated
 * error contract (5 server-side codes) + the list-row shape mapping.
 *
 * Per 27-PATTERNS S7 — discriminated error contract on RPC wrappers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockRpc = vi.fn();
const mockFrom = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

let api: typeof import('./config-api');

beforeEach(async () => {
  mockRpc.mockReset();
  mockFrom.mockReset();
  api = await import('./config-api');
});

afterEach(() => {
  vi.resetModules();
});

describe('defineFunnel', () => {
  it('returns { funnelId } on success', async () => {
    mockRpc.mockResolvedValue({ data: '11111111-1111-1111-1111-111111111111', error: null });
    const out = await api.defineFunnel('signup_completed', 7, 2.0);
    expect(out).toEqual({ funnelId: '11111111-1111-1111-1111-111111111111' });
    expect(mockRpc).toHaveBeenCalledWith('anomaly_funnel_define', {
      p_event_name: 'signup_completed',
      p_lookback_days: 7,
      p_sigma_threshold: 2.0,
    });
  });

  it('omits optional params from RPC call when not provided', async () => {
    mockRpc.mockResolvedValue({ data: 'fid', error: null });
    await api.defineFunnel('new_event');
    expect(mockRpc).toHaveBeenCalledWith('anomaly_funnel_define', {
      p_event_name: 'new_event',
    });
  });

  it('throws AnomalyConfigApiError("not_staff") on Postgres 42501', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'forbidden' } });
    await expect(api.defineFunnel('x')).rejects.toMatchObject({
      name: 'AnomalyConfigApiError',
      code: 'not_staff',
    });
  });

  it('throws AnomalyConfigApiError("duplicate_event_name") on Postgres 23505', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: '23505', message: 'duplicate_event_name' },
    });
    await expect(api.defineFunnel('signup_completed')).rejects.toMatchObject({
      name: 'AnomalyConfigApiError',
      code: 'duplicate_event_name',
    });
  });

  it('throws AnomalyConfigApiError("network") when supabase.rpc itself throws', async () => {
    mockRpc.mockRejectedValue(new Error('boom'));
    await expect(api.defineFunnel('x')).rejects.toMatchObject({
      name: 'AnomalyConfigApiError',
      code: 'network',
    });
  });
});

describe('updateFunnel', () => {
  it('passes only provided keys (partial update)', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    await api.updateFunnel('fid-1', { isEnabled: false });
    expect(mockRpc).toHaveBeenCalledWith('anomaly_funnel_update', {
      p_funnel_id: 'fid-1',
      p_is_enabled: false,
    });
  });

  it('passes lookbackDays + sigmaThreshold when provided', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    await api.updateFunnel('fid-1', { lookbackDays: 14, sigmaThreshold: 3.0 });
    expect(mockRpc).toHaveBeenCalledWith('anomaly_funnel_update', {
      p_funnel_id: 'fid-1',
      p_lookback_days: 14,
      p_sigma_threshold: 3.0,
    });
  });

  it('throws AnomalyConfigApiError("not_found") on 22023', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: '22023', message: 'not_found' },
    });
    await expect(api.updateFunnel('missing', { isEnabled: true })).rejects.toMatchObject({
      name: 'AnomalyConfigApiError',
      code: 'not_found',
    });
  });
});

describe('deleteFunnel', () => {
  it('resolves void on success', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    await expect(api.deleteFunnel('fid-1')).resolves.toBeUndefined();
    expect(mockRpc).toHaveBeenCalledWith('anomaly_funnel_delete', { p_funnel_id: 'fid-1' });
  });

  it('throws AnomalyConfigApiError("has_alerts") when guard fires', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: '22023', message: 'has_alerts' },
    });
    await expect(api.deleteFunnel('fid-1')).rejects.toMatchObject({
      name: 'AnomalyConfigApiError',
      code: 'has_alerts',
    });
  });

  it('throws AnomalyConfigApiError("not_found") when no alerts but row missing', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: '22023', message: 'not_found' },
    });
    await expect(api.deleteFunnel('missing')).rejects.toMatchObject({
      name: 'AnomalyConfigApiError',
      code: 'not_found',
    });
  });
});

describe('listTrackedFunnels', () => {
  function buildChain(rows: unknown[] | null, error: unknown = null) {
    const order = vi.fn().mockResolvedValue({ data: rows, error });
    const select = vi.fn().mockReturnValue({ order });
    return { from: vi.fn().mockReturnValue({ select }), select, order };
  }

  it('maps DB rows to TrackedFunnel shape', async () => {
    const chain = buildChain([
      {
        funnel_id: 'f1',
        event_name: 'signup_completed',
        is_enabled: true,
        baseline_lookback_days: 7,
        sigma_threshold: '2.0',
        created_by: 'u1',
        created_at: '2026-05-18T00:00:00Z',
      },
      {
        funnel_id: 'f2',
        event_name: 'payment_succeeded',
        is_enabled: false,
        baseline_lookback_days: 14,
        sigma_threshold: '3.0',
        created_by: null,
        created_at: '2026-05-18T00:00:00Z',
      },
    ]);
    mockFrom.mockImplementation(chain.from);
    const result = await api.listTrackedFunnels();
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      funnelId: 'f1',
      eventName: 'signup_completed',
      isEnabled: true,
      lookbackDays: 7,
      sigmaThreshold: 2.0,
    });
    expect(result[1].isEnabled).toBe(false);
    expect(result[1].sigmaThreshold).toBe(3.0);
  });

  it('throws AnomalyConfigApiError on supabase error response', async () => {
    const chain = buildChain(null, { code: 'PGRST301', message: 'oops' });
    mockFrom.mockImplementation(chain.from);
    await expect(api.listTrackedFunnels()).rejects.toMatchObject({
      name: 'AnomalyConfigApiError',
    });
  });
});
