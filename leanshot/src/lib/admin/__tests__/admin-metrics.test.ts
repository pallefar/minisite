/**
 * Phase 22 Plan 22-08 — admin-metrics RPC wrapper tests (RED phase).
 *
 * Coverage:
 *   T1: fetchMetrics({period:'30d'}) calls admin_compute_mrr_arr RPC with p_period='30d'.
 *   T2: returns typed shape (mrrCents, arrCents, churnPct30d, freeCount, paidCount, …).
 *   T3: surface RPC error as thrown Error.
 *   T4: default period is '30d' when omitted.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchMetrics } from '@/lib/admin/admin-metrics';

const mockRpc = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

const SAMPLE_RPC_RESPONSE = {
  period: '30d',
  mrr_cents: 19980,
  arr_cents: 239760,
  churn_pct_30d: 4.5,
  paid_count: 20,
  free_count: 100,
  past_due_count: 2,
  clinic_seat_count: 5,
  churn_series: [
    { bucket: '2026-04', free: 80, paid: 18, churn_pct: 3.2 },
    { bucket: '2026-05', free: 100, paid: 20, churn_pct: 4.5 },
  ],
  clinic_seat_utilization: [
    {
      clinic_id: 'org-1',
      clinic_name: 'Acme Clinic',
      used: 4,
      total: 10,
      series: [],
    },
  ],
  computed_at: '2026-05-16T10:00:00Z',
};

describe('admin-metrics wrapper (Phase 22 Plan 22-08)', () => {
  beforeEach(() => {
    mockRpc.mockReset();
  });

  it('T1 — fetchMetrics({period:"30d"}) calls admin_compute_mrr_arr with p_period="30d"', async () => {
    mockRpc.mockResolvedValue({ data: SAMPLE_RPC_RESPONSE, error: null });
    await fetchMetrics({ period: '30d' });
    expect(mockRpc).toHaveBeenCalledWith('admin_compute_mrr_arr', { p_period: '30d' });
  });

  it('T2 — returns typed AdminMetrics shape with mrrCents and freeCount mapped', async () => {
    mockRpc.mockResolvedValue({ data: SAMPLE_RPC_RESPONSE, error: null });
    const result = await fetchMetrics({ period: '30d' });
    expect(result.mrrCents).toBe(19980);
    expect(result.arrCents).toBe(239760);
    expect(result.churnPct30d).toBe(4.5);
    expect(result.paidCount).toBe(20);
    expect(result.freeCount).toBe(100);
    expect(result.clinicSeatCount).toBe(5);
    expect(result.churnSeries).toHaveLength(2);
    expect(result.clinicSeatUtilization[0]?.clinicName).toBe('Acme Clinic');
    expect(result.clinicSeatUtilization[0]?.used).toBe(4);
    expect(result.clinicSeatUtilization[0]?.total).toBe(10);
  });

  it('T3 — surfaces RPC error as Error', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'forbidden' } });
    await expect(fetchMetrics({ period: '30d' })).rejects.toThrow(/forbidden/);
  });

  it('T4 — default period is "30d" when omitted', async () => {
    mockRpc.mockResolvedValue({ data: SAMPLE_RPC_RESPONSE, error: null });
    await fetchMetrics();
    expect(mockRpc).toHaveBeenCalledWith('admin_compute_mrr_arr', { p_period: '30d' });
  });
});
