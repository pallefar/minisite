/**
 * Phase 65 Plan 65-09 — refund-client unit tests.
 *
 * 4 cases covering: eligibility dry-run, successful refund POST, 409
 * already-processed branch, and generic 5xx fallback. Uses
 * supabase.functions.invoke (Phase 65-06 Edge Fn).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { supabase } from '@/lib/supabase';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    functions: {
      invoke: vi.fn(),
    },
  },
}));

const mockInvoke = supabase.functions.invoke as unknown as ReturnType<typeof vi.fn>;

afterEach(() => {
  vi.clearAllMocks();
});

describe('refund-client', () => {
  it('checkRefundEligibility: posts dry_run=true and returns eligibility shape', async () => {
    mockInvoke.mockResolvedValueOnce({
      data: { eligible: true, window: 'money_back_14d', amount_cents: 1999 },
      error: null,
    });
    const { checkRefundEligibility } = await import('./refund-client');
    const res = await checkRefundEligibility();
    expect(mockInvoke).toHaveBeenCalledWith('request-refund', {
      body: { dry_run: true },
    });
    expect(res).toEqual({
      eligible: true,
      window: 'money_back_14d',
      amount_cents: 1999,
    });
  });

  it('requestRefund: success path returns ok=true with refund_id + amount', async () => {
    mockInvoke.mockResolvedValueOnce({
      data: { refund_id: 're_test123', amount_cents: 1999, status: 'succeeded' },
      error: null,
    });
    const { requestRefund } = await import('./refund-client');
    const res = await requestRefund('Cancelled by mistake — please refund');
    expect(mockInvoke).toHaveBeenCalledWith('request-refund', {
      body: { reason: 'Cancelled by mistake — please refund' },
    });
    expect(res).toEqual({
      ok: true,
      refund_id: 're_test123',
      amount_cents: 1999,
      status: 'succeeded',
    });
  });

  it('requestRefund: 409 refund_already_processed → ok=false with stable error code', async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: { message: 'refund_already_processed', context: { status: 409 } },
    });
    const { requestRefund } = await import('./refund-client');
    const res = await requestRefund('test');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe('refund_already_processed');
    }
  });

  it('requestRefund: 500 returns ok=false with refund_failed error code', async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: { message: 'internal_error', context: { status: 500 } },
    });
    const { requestRefund } = await import('./refund-client');
    const res = await requestRefund('test');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe('refund_failed');
    }
  });
});
