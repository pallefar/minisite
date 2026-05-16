/**
 * Phase 22 plan 22-09 — useImpersonationReadOnly tests (ADMIN-03).
 *
 * Behaviors:
 *   1. When useImpersonation().active === false → {disabled: false, props: {}}
 *   2. When active === true → {disabled: true, props: {disabled: true, 'aria-disabled': true,
 *      title: 'Read-only during impersonation'}}
 *
 * Hook is the CLIENT-side UX gate; RLS write-deny policies
 * (migration 20270601000012_impersonation_write_deny_policies.sql) are the
 * actual security boundary (defense-in-depth).
 */
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useImpersonationReadOnly } from '@/components/impersonation/useImpersonationReadOnly';

const mockUseImpersonation = vi.fn();
vi.mock('@/components/impersonation/useImpersonation', () => ({
  useImpersonation: () => mockUseImpersonation(),
}));

describe('useImpersonationReadOnly (Phase 22 ADMIN-03 / plan 22-09)', () => {
  beforeEach(() => {
    mockUseImpersonation.mockReset();
  });

  it('returns {disabled: false, props: {}} when impersonation is inactive', () => {
    mockUseImpersonation.mockReturnValue({
      active: false,
      impersonatorId: null,
      targetEmail: null,
      targetUserId: null,
      secondsRemaining: 0,
      endImpersonation: vi.fn(),
    });
    const { result } = renderHook(() => useImpersonationReadOnly());
    expect(result.current.disabled).toBe(false);
    expect(result.current.props).toEqual({});
  });

  it('returns disabled props with tooltip when impersonation is active', () => {
    mockUseImpersonation.mockReturnValue({
      active: true,
      impersonatorId: '11111111-1111-4111-8111-111111111111',
      targetEmail: 'patient@example.com',
      targetUserId: '22222222-2222-4222-8222-222222222222',
      secondsRemaining: 1500,
      endImpersonation: vi.fn(),
    });
    const { result } = renderHook(() => useImpersonationReadOnly());
    expect(result.current.disabled).toBe(true);
    expect(result.current.props).toEqual({
      disabled: true,
      'aria-disabled': true,
      title: 'Read-only during impersonation',
    });
  });
});
