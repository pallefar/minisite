/**
 * Phase 7 Plan 07-07 — unit tests for the account-delete client wrapper.
 *
 * Two surfaces:
 *   1. `typedConfirmMatches` — pure helper, 5 cases.
 *   2. `initiateAccountDeletion` — RPC error-code mapping (4 cases) + happy
 *      path (signOut + resetAll + backup wipe all fire).
 *
 * Mocks `@/lib/supabase` (rpc) + `@/lib/auth` (signOut) + the store's
 * `resetAll` slice. The store mock uses `useStore.setState` rather than a
 * full vi.mock because account-delete reads via `useStore.getState()` at
 * call time, which a partial state injection handles cleanly.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AccountDeleteError,
  initiateAccountDeletion,
  typedConfirmMatches,
} from './account-delete';

const mockRpc = vi.fn();
const mockSignOut = vi.fn();
const mockResetAll = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

vi.mock('@/lib/auth', () => ({
  signOut: (...args: unknown[]) => mockSignOut(...args),
}));

vi.mock('@/lib/store', () => ({
  useStore: {
    getState: () => ({ resetAll: mockResetAll }),
  },
}));

beforeEach(() => {
  mockRpc.mockReset();
  mockSignOut.mockReset();
  mockResetAll.mockReset();
  try {
    localStorage.clear();
  } catch {
    /* noop */
  }
});

describe('typedConfirmMatches', () => {
  it('returns false for empty typed input', () => {
    expect(typedConfirmMatches('', 'a@b.com')).toBe(false);
  });

  it('returns false when email is null', () => {
    expect(typedConfirmMatches('a@b.com', null)).toBe(false);
  });

  it('returns false when email is undefined', () => {
    expect(typedConfirmMatches('a@b.com', undefined)).toBe(false);
  });

  it('returns true on case-insensitive + trimmed match', () => {
    expect(typedConfirmMatches('  A@B.com  ', 'a@b.com')).toBe(true);
  });

  it('returns true on exact match', () => {
    expect(typedConfirmMatches('a@b.com', 'a@b.com')).toBe(true);
  });

  it('returns false for different emails', () => {
    expect(typedConfirmMatches('different@b.com', 'a@b.com')).toBe(false);
  });

  it('returns false when email is empty string', () => {
    expect(typedConfirmMatches('', '')).toBe(false);
  });
});

describe('initiateAccountDeletion — error mapping', () => {
  it('maps P0007 to recent_auth_required', async () => {
    mockRpc.mockResolvedValueOnce({ error: { code: 'P0007', message: 'recent_auth_required' } });
    await expect(initiateAccountDeletion()).rejects.toBeInstanceOf(AccountDeleteError);
    mockRpc.mockResolvedValueOnce({ error: { code: 'P0007', message: 'recent_auth_required' } });
    try {
      await initiateAccountDeletion();
      expect.fail('should have thrown');
    } catch (e) {
      expect((e as AccountDeleteError).code).toBe('recent_auth_required');
    }
  });

  it('maps P0008 to already_pending', async () => {
    mockRpc.mockResolvedValueOnce({ error: { code: 'P0008', message: 'already_pending' } });
    try {
      await initiateAccountDeletion();
      expect.fail('should have thrown');
    } catch (e) {
      expect((e as AccountDeleteError).code).toBe('already_pending');
    }
  });

  it('maps 28000 to not_authenticated', async () => {
    mockRpc.mockResolvedValueOnce({ error: { code: '28000', message: 'not authenticated' } });
    try {
      await initiateAccountDeletion();
      expect.fail('should have thrown');
    } catch (e) {
      expect((e as AccountDeleteError).code).toBe('not_authenticated');
    }
  });

  it('maps unknown error codes to unknown', async () => {
    mockRpc.mockResolvedValueOnce({ error: { code: 'XYZ99', message: 'boom' } });
    try {
      await initiateAccountDeletion();
      expect.fail('should have thrown');
    } catch (e) {
      expect((e as AccountDeleteError).code).toBe('unknown');
    }
  });

  it('does NOT call signOut or resetAll when the RPC errors', async () => {
    mockRpc.mockResolvedValueOnce({ error: { code: 'P0007' } });
    await expect(initiateAccountDeletion()).rejects.toBeInstanceOf(AccountDeleteError);
    expect(mockSignOut).not.toHaveBeenCalled();
    expect(mockResetAll).not.toHaveBeenCalled();
  });
});

describe('initiateAccountDeletion — happy path', () => {
  it('calls supabase.rpc with the RPC name and no params', async () => {
    mockRpc.mockResolvedValueOnce({ error: null });
    mockSignOut.mockResolvedValueOnce({ error: null });
    await initiateAccountDeletion();
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc.mock.calls[0][0]).toBe('initiate_account_deletion');
    // No second arg — RPC reads auth.uid() server-side (T-07-07-S2).
    expect(mockRpc.mock.calls[0]).toHaveLength(1);
  });

  it('calls resetAll then signOut on success', async () => {
    mockRpc.mockResolvedValueOnce({ error: null });
    mockSignOut.mockResolvedValueOnce({ error: null });
    await initiateAccountDeletion();
    expect(mockResetAll).toHaveBeenCalledTimes(1);
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it('wipes leanshot_v4_pre_cloud_backup from localStorage on success', async () => {
    localStorage.setItem(
      'leanshot_v4_pre_cloud_backup',
      JSON.stringify({ state: {}, version: 7, snapshotAt: 'x' }),
    );
    mockRpc.mockResolvedValueOnce({ error: null });
    mockSignOut.mockResolvedValueOnce({ error: null });
    await initiateAccountDeletion();
    expect(localStorage.getItem('leanshot_v4_pre_cloud_backup')).toBeNull();
  });
});
