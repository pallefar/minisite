/**
 * Phase 27 Plan 27-02 — cohort API wrapper tests.
 *
 * Mirrors the test shape of leanshot/src/lib/admin/__tests__/admin-api.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  archiveCohort,
  CohortApiError,
  defineCohort,
  isCohortMember,
  setCohortStatus,
} from '@/lib/cohort/api';
import type { RuleNode } from '@/lib/cohort/rule-tree-schema';

const mockRpc = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (name: string, params: unknown) => mockRpc(name, params),
  },
}));

const validRule: RuleNode = { field: 'tier', op: '=', value: 'free' };

describe('cohort api (Phase 27 Plan 27-02 ADMIN-05)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('(a) defineCohort with malformed tree throws CohortApiError("invalid_rule") without calling RPC', async () => {
    const bad = { field: 'unknown_field', op: '=', value: 'x' } as unknown as RuleNode;
    await expect(defineCohort('bad', bad)).rejects.toBeInstanceOf(CohortApiError);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('(b) defineCohort with valid tree + mocked RPC returns cohortId', async () => {
    mockRpc.mockResolvedValue({ data: 'uuid-x', error: null });
    const result = await defineCohort('free users', validRule);
    expect(result).toEqual({ cohortId: 'uuid-x' });
    expect(mockRpc).toHaveBeenCalledWith('cohort_define', {
      p_name: 'free users',
      p_rule: validRule,
      p_compiled_sql: "p.tier = E'free'",
    });
  });

  it('(c) RPC error 42501 maps to CohortApiError("not_staff")', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'forbidden' },
    });
    try {
      await defineCohort('x', validRule);
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(CohortApiError);
      expect((e as CohortApiError).code).toBe('not_staff');
    }
  });

  it('(d) RPC error 23505 maps to CohortApiError("duplicate_name")', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: '23505', message: 'duplicate key' },
    });
    try {
      await defineCohort('x', validRule);
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(CohortApiError);
      expect((e as CohortApiError).code).toBe('duplicate_name');
    }
  });

  it('(e) isCohortMember returns the RPC boolean', async () => {
    mockRpc.mockResolvedValue({ data: true, error: null });
    const result = await isCohortMember('user-1', 'cohort-1');
    expect(result).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith('cohort_is_member', {
      p_user_id: 'user-1',
      p_cohort_id: 'cohort-1',
    });
  });

  it('(f) isCohortMember swallows network errors and returns false', async () => {
    mockRpc.mockRejectedValue(new Error('boom'));
    const result = await isCohortMember('user-1', 'cohort-1');
    expect(result).toBe(false);
  });

  it('(g) setCohortStatus calls cohort_set_status with correct params', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    await setCohortStatus('cohort-1', 'active');
    expect(mockRpc).toHaveBeenCalledWith('cohort_set_status', {
      p_cohort_id: 'cohort-1',
      p_status: 'active',
    });
  });

  it('(h) archiveCohort calls cohort_archive RPC', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    await archiveCohort('cohort-1');
    expect(mockRpc).toHaveBeenCalledWith('cohort_archive', {
      p_cohort_id: 'cohort-1',
    });
  });

  it("(i) RPC error 22023 with 'invalid_rule' message → invalid_rule", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: '22023', message: 'invalid_rule: field_not_allowed' },
    });
    try {
      await defineCohort('x', validRule);
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(CohortApiError);
      expect((e as CohortApiError).code).toBe('invalid_rule');
    }
  });
});
