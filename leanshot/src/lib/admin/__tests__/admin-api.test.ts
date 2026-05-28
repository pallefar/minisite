/**
 * Phase 22 plan 22-06 — admin-api wrapper RED tests.
 * Owner: plan 22-06 (Wave 2). Replaces 22-01 Wave 0 skip stubs.
 *
 * Behaviors:
 *   - listMembers calls admin_list_members with default + custom params.
 *   - listMembers returns typed shape `{user_id, email, tier, signup_date,
 *     last_active_at, clinic_name, country, stripe_status}`.
 *   - setFeatureFlagOverride calls admin_set_feature_flag_override RPC.
 *   - RPC error code 42501 surfaces as AdminApiError(code: 'not_staff').
 *   - Other Supabase errors surface as AdminApiError(code: 'unknown').
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminApiError, listMembers, setFeatureFlagOverride } from '@/lib/admin/admin-api';

const mockRpc = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (name: string, params: unknown) => mockRpc(name, params),
  },
}));

describe('admin-api (Phase 22 ADMIN-01 + ADMIN-05)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('listMembers calls admin_list_members with default params when no args', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    await listMembers({});
    expect(mockRpc).toHaveBeenCalledWith('admin_list_members', {
      p_search: null,
      p_tier: null,
      p_page: 1,
      p_size: 50,
    });
  });

  it('listMembers passes search + tier + page + size when set', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    await listMembers({ search: 'alice', tier: 'paid', page: 3, size: 25 });
    expect(mockRpc).toHaveBeenCalledWith('admin_list_members', {
      p_search: 'alice',
      p_tier: 'paid',
      p_page: 3,
      p_size: 25,
    });
  });

  it('listMembers returns typed rows', async () => {
    const sample = [
      {
        user_id: 'u-1',
        email: 'alice@example.com',
        tier: 'paid',
        signup_date: '2026-05-01T00:00:00Z',
        last_active_at: '2026-05-15T12:00:00Z',
        clinic_name: null,
        country: 'US',
        stripe_status: 'active',
      },
    ];
    mockRpc.mockResolvedValue({ data: sample, error: null });
    const result = await listMembers({});
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.email).toBe('alice@example.com');
    expect(result.rows[0]?.tier).toBe('paid');
  });

  it('listMembers maps Supabase error 42501 to AdminApiError code "not_staff"', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'forbidden' },
    });
    await expect(listMembers({})).rejects.toBeInstanceOf(AdminApiError);
    try {
      await listMembers({});
    } catch (e) {
      expect((e as AdminApiError).code).toBe('not_staff');
    }
  });

  it('listMembers maps unknown Supabase error to AdminApiError code "unknown"', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: '50000', message: 'boom' },
    });
    try {
      await listMembers({});
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(AdminApiError);
      expect((e as AdminApiError).code).toBe('unknown');
    }
  });

  it('setFeatureFlagOverride calls admin_set_feature_flag_override with snake_cased params', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    await setFeatureFlagOverride({
      userId: 'u-1',
      flagKey: 'aff_manual_entry',
      value: true,
      expiresAt: '2026-12-01T00:00:00Z',
    });
    expect(mockRpc).toHaveBeenCalledWith('admin_set_feature_flag_override', {
      p_user_id: 'u-1',
      p_flag_key: 'aff_manual_entry',
      p_value: true,
      p_expires_at: '2026-12-01T00:00:00Z',
    });
  });

  it('setFeatureFlagOverride surfaces 42501 as AdminApiError code "not_staff"', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'forbidden' },
    });
    await expect(
      setFeatureFlagOverride({
        userId: 'u-1',
        flagKey: 'x',
        value: true,
        expiresAt: '2026-12-01T00:00:00Z',
      }),
    ).rejects.toMatchObject({ code: 'not_staff' });
  });
});
