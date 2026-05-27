/**
 * Phase 66 Plan 66-06 — role-mfa-config wrappers.
 *
 * Cases: list (success + RLS error), set (success + forbidden + network).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));

import { supabase } from '@/lib/supabase';
import {
  listRoleMfaRequirements,
  setRoleMfaRequirement,
  RoleMfaConfigError,
} from './role-mfa-config';

const mockFrom = supabase.from as unknown as ReturnType<typeof vi.fn>;
const mockRpc = supabase.rpc as unknown as ReturnType<typeof vi.fn>;

function setupListSuccess(rows: Array<{ role: string; required: boolean; since: string }>) {
  mockFrom.mockImplementation(() => ({
    select: () => ({
      order: () => Promise.resolve({ data: rows, error: null }),
    }),
  }));
}

function setupListError(err: { code?: string; message?: string }) {
  mockFrom.mockImplementation(() => ({
    select: () => ({
      order: () => Promise.resolve({ data: null, error: err }),
    }),
  }));
}

beforeEach(() => {
  mockFrom.mockReset();
  mockRpc.mockReset();
});

describe('listRoleMfaRequirements', () => {
  it('returns the seeded 5 rows', async () => {
    const seeded = [
      { role: 'admin', required: true, since: '2026-01-01T00:00:00Z' },
      { role: 'clinic-admin', required: false, since: '2026-01-01T00:00:00Z' },
      { role: 'staff', required: false, since: '2026-01-01T00:00:00Z' },
      { role: 'superadmin', required: true, since: '2026-01-01T00:00:00Z' },
      { role: 'user', required: false, since: '2026-01-01T00:00:00Z' },
    ];
    setupListSuccess(seeded);
    const rows = await listRoleMfaRequirements();
    expect(rows).toHaveLength(5);
    expect(rows.map((r) => r.role)).toContain('superadmin');
  });

  it('returns empty array when table empty', async () => {
    setupListSuccess([]);
    const rows = await listRoleMfaRequirements();
    expect(rows).toEqual([]);
  });

  it('throws RoleMfaConfigError on RLS denial', async () => {
    setupListError({ code: '42501', message: 'permission denied' });
    await expect(listRoleMfaRequirements()).rejects.toBeInstanceOf(RoleMfaConfigError);
    try {
      await listRoleMfaRequirements();
    } catch (e) {
      expect((e as RoleMfaConfigError).code).toBe('forbidden');
    }
  });
});

describe('setRoleMfaRequirement', () => {
  it('calls set_mfa_role_requirement RPC with p_role + p_required', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null });
    await setRoleMfaRequirement('admin', true);
    expect(mockRpc).toHaveBeenCalledWith('set_mfa_role_requirement', {
      p_role: 'admin',
      p_required: true,
    });
  });

  it('maps "only superadmin" exception to forbidden', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'P0001', message: 'forbidden: only superadmin can change MFA role requirements' },
    });
    try {
      await setRoleMfaRequirement('admin', false);
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(RoleMfaConfigError);
      expect((e as RoleMfaConfigError).code).toBe('forbidden');
    }
  });

  it('maps "authentication required" exception to not_authenticated', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'P0001', message: 'forbidden: authentication required' },
    });
    try {
      await setRoleMfaRequirement('staff', true);
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(RoleMfaConfigError);
      expect((e as RoleMfaConfigError).code).toBe('not_authenticated');
    }
  });

  it('maps thrown network errors to network code', async () => {
    mockRpc.mockRejectedValueOnce(new Error('fetch failed'));
    try {
      await setRoleMfaRequirement('staff', true);
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(RoleMfaConfigError);
      expect((e as RoleMfaConfigError).code).toBe('network');
    }
  });
});
