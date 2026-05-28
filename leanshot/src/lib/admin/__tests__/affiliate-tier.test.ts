/**
 * Phase 26 Plan 26-05 — affiliate-tier client wrapper tests (Task 2).
 *
 * Six tests covering:
 *   - client-side guard (freezeAffiliate empty reason rejects before RPC)
 *   - Postgres errcode → AffiliateTierErrorCode mapping (42501 → forbidden)
 *   - token-substring mapping (cannot_reverse_lifetime → cannot_reverse)
 *   - non-Postgres throw → network error
 *   - decision typing (compile-time narrowed to 'clear' | 'fraud_confirmed')
 *   - affiliate-review.ts confirmFraud/markClear delegate to anomalyReviewDecision
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { supabase } from '@/lib/supabase';
import { confirmFraud, markClear } from '../affiliate-review';
import {
  AffiliateTierError,
  anomalyReviewDecision,
  freezeAffiliate,
  grantLifetime,
  reverseLifetimeGrant,
} from '../affiliate-tier';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
  },
}));

const rpcMock = supabase.rpc as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  rpcMock.mockReset();
});

describe('affiliate-tier client wrappers', () => {
  it('freezeAffiliate rejects empty reason before RPC call', async () => {
    await expect(freezeAffiliate('a1', '   ')).rejects.toMatchObject({
      name: 'AffiliateTierError',
      code: 'reason_required',
    });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('maps Postgres errcode 42501 to forbidden', async () => {
    rpcMock.mockResolvedValueOnce({
      error: { code: '42501', message: 'permission denied for forbidden access' },
    });
    await expect(anomalyReviewDecision('c1', 'clear')).rejects.toMatchObject({
      name: 'AffiliateTierError',
      code: 'forbidden',
    });
  });

  it('maps cannot_reverse_lifetime message token to cannot_reverse', async () => {
    rpcMock.mockResolvedValueOnce({
      error: {
        code: 'P0001',
        message: 'cannot_reverse_lifetime: payout already shipped or window expired',
      },
    });
    await expect(reverseLifetimeGrant('a1')).rejects.toMatchObject({
      code: 'cannot_reverse',
    });
  });

  it('maps must_be_gold_first token to must_be_gold_first', async () => {
    rpcMock.mockResolvedValueOnce({
      error: { code: 'P0001', message: 'must_be_gold_first' },
    });
    await expect(grantLifetime('a1')).rejects.toMatchObject({
      code: 'must_be_gold_first',
    });
  });

  it('non-Postgres rejection maps to network', async () => {
    rpcMock.mockRejectedValueOnce(new Error('fetch failed'));
    await expect(anomalyReviewDecision('c1', 'clear')).rejects.toMatchObject({
      code: 'network',
    });
  });

  it('grantLifetime calls supabase.rpc with admin_grant_lifetime + p_affiliate_id', async () => {
    rpcMock.mockResolvedValueOnce({ error: null });
    await grantLifetime('aff-uuid-1');
    expect(rpcMock).toHaveBeenCalledWith('admin_grant_lifetime', {
      p_affiliate_id: 'aff-uuid-1',
    });
  });
});

describe('affiliate-review anomaly delegates', () => {
  it('confirmFraud delegates to anomaly RPC with fraud_confirmed', async () => {
    rpcMock.mockResolvedValueOnce({ error: null });
    await confirmFraud('conv-1');
    expect(rpcMock).toHaveBeenCalledWith('admin_anomaly_review_decision', {
      p_conversion_id: 'conv-1',
      p_decision: 'fraud_confirmed',
    });
  });

  it('markClear delegates to anomaly RPC with clear', async () => {
    rpcMock.mockResolvedValueOnce({ error: null });
    await markClear('conv-2');
    expect(rpcMock).toHaveBeenCalledWith('admin_anomaly_review_decision', {
      p_conversion_id: 'conv-2',
      p_decision: 'clear',
    });
  });

  it('AffiliateTierError thrown from delegate retains code (not wrapped twice)', async () => {
    rpcMock.mockResolvedValueOnce({
      error: { code: '42501', message: 'forbidden' },
    });
    await expect(confirmFraud('conv-3')).rejects.toBeInstanceOf(AffiliateTierError);
  });
});
