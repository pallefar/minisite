/**
 * Phase 9 Plan 09-03 Task 1 — useHasPermission hook + session cache.
 *
 * Behavior:
 *   1. Initial mount: returns null while RPC in-flight, then true/false.
 *   2. Cache hit: second call with same (orgId, permKey) returns synchronously,
 *      no second RPC call.
 *   3. clearPermissionCache(): after clear, next call re-fires the RPC.
 *   4. orgId === null: hook returns null (avoids Pitfall #9 empty-list flash).
 *   5. Unauthenticated: supabase.auth.getUser() returns no user → false.
 *   6. UX-hint-only docstring contract (assert exports exist; security gate
 *      is the server, not this hook).
 */
import { renderHook, waitFor, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Hoist mocks so vi.mock factory can capture them.
const rpcMock = vi.fn();
const getUserMock = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    auth: {
      getUser: (...args: unknown[]) => getUserMock(...args),
    },
  },
}));

import {
  useHasPermission,
  clearPermissionCache,
} from './clinic-permissions';

describe('useHasPermission', () => {
  beforeEach(() => {
    clearPermissionCache();
    rpcMock.mockReset();
    getUserMock.mockReset();
    // default: signed-in user
    getUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
  });

  afterEach(() => {
    clearPermissionCache();
  });

  it('Test 1 — returns null while RPC in-flight, then resolves true', async () => {
    rpcMock.mockResolvedValue({ data: true, error: null });
    const { result } = renderHook(() => useHasPermission('org-1', 'org.delete'));
    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('Test 1b — resolves false when RPC returns false', async () => {
    rpcMock.mockResolvedValue({ data: false, error: null });
    const { result } = renderHook(() => useHasPermission('org-1', 'org.delete'));
    await waitFor(() => expect(result.current).toBe(false));
  });

  it('Test 2 — cache hit: second call returns cached value without re-firing RPC', async () => {
    rpcMock.mockResolvedValue({ data: true, error: null });
    const first = renderHook(() => useHasPermission('org-1', 'org.delete'));
    await waitFor(() => expect(first.result.current).toBe(true));
    expect(rpcMock).toHaveBeenCalledTimes(1);

    rpcMock.mockClear();
    const second = renderHook(() => useHasPermission('org-1', 'org.delete'));
    // Synchronous: cache hit returns the value on initial render.
    expect(second.result.current).toBe(true);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('Test 3 — clearPermissionCache re-fires RPC on next call', async () => {
    rpcMock.mockResolvedValue({ data: true, error: null });
    const first = renderHook(() => useHasPermission('org-1', 'org.delete'));
    await waitFor(() => expect(first.result.current).toBe(true));
    expect(rpcMock).toHaveBeenCalledTimes(1);

    act(() => {
      clearPermissionCache();
    });

    rpcMock.mockClear();
    const second = renderHook(() => useHasPermission('org-1', 'org.delete'));
    expect(second.result.current).toBeNull();
    await waitFor(() => expect(second.result.current).toBe(true));
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  it('Test 4 — orgId null returns null without firing RPC', async () => {
    const { result } = renderHook(() => useHasPermission(null, 'org.delete'));
    expect(result.current).toBeNull();
    // Give microtasks a chance to settle.
    await new Promise((r) => setTimeout(r, 0));
    expect(rpcMock).not.toHaveBeenCalled();
    expect(getUserMock).not.toHaveBeenCalled();
  });

  it('Test 5 — unauthenticated: returns false', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null });
    const { result } = renderHook(() => useHasPermission('org-1', 'org.delete'));
    await waitFor(() => expect(result.current).toBe(false));
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('Test 5b — RPC error coerces to false (UX hint only — server is the gate)', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: 'boom', code: '42501' },
    });
    const { result } = renderHook(() => useHasPermission('org-1', 'org.delete'));
    await waitFor(() => expect(result.current).toBe(false));
  });

  it('Test 6 — clearPermissionCache and useHasPermission are exported', () => {
    expect(typeof clearPermissionCache).toBe('function');
    expect(typeof useHasPermission).toBe('function');
  });

  it('Test 7 — passes correct RPC arguments', async () => {
    rpcMock.mockResolvedValue({ data: true, error: null });
    const { result } = renderHook(() =>
      useHasPermission('org-XYZ', 'patient_data.read'),
    );
    await waitFor(() => expect(result.current).toBe(true));
    expect(rpcMock).toHaveBeenCalledWith('has_permission', {
      p_user_id: 'user-1',
      p_org_id: 'org-XYZ',
      p_permission_key: 'patient_data.read',
    });
  });

  it('Test 8 — distinct (orgId, permKey) cached separately', async () => {
    rpcMock.mockResolvedValueOnce({ data: true, error: null });
    rpcMock.mockResolvedValueOnce({ data: false, error: null });
    const a = renderHook(() => useHasPermission('org-1', 'org.delete'));
    await waitFor(() => expect(a.result.current).toBe(true));
    const b = renderHook(() => useHasPermission('org-1', 'org.update'));
    await waitFor(() => expect(b.result.current).toBe(false));
    expect(rpcMock).toHaveBeenCalledTimes(2);
  });
});
