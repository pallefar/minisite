/**
 * Phase 25 Plan 02 — Unit tests for logPhiAccess client wrapper.
 *
 * Tests (per plan Task 2 <behavior>):
 *   T1: Happy path — rpc called with correctly-named args; returns void without throwing.
 *   T2: RPC returns { error: { code: '42501', message: 'forbidden' } } — wrapper does NOT throw;
 *       console.warn called with '42501' but NEVER with the message text ('forbidden').
 *   T3: RPC throws Error('connection refused') — wrapper does NOT throw;
 *       console.warn called with 'Error' (e.name) NOT 'connection refused' (e.message).
 *
 * Security: Pattern S3 — log error.code/name only, never error.message (PII leak vector).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { supabase } from '@/lib/supabase';
import { logPhiAccess } from '../phi-access-rpc';

// Mock the supabase module BEFORE importing the wrapper
vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
  },
}));

describe('logPhiAccess', () => {
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('T1: happy path — calls rpc with correct arg names and resolves void', async () => {
    const mockRpc = supabase.rpc as ReturnType<typeof vi.fn>;
    mockRpc.mockResolvedValueOnce({ data: null, error: null });

    const result = await logPhiAccess({
      accessedUserId: 'patient-uuid-1',
      accessedFields: ['dose_log.value', 'dose_log.timestamp'],
      reason: 'opened patient detail page',
      accessedOrgId: 'org-uuid-1',
    });

    expect(result).toBeUndefined();
    expect(mockRpc).toHaveBeenCalledOnce();
    expect(mockRpc).toHaveBeenCalledWith('log_phi_access', {
      p_accessed_user_id: 'patient-uuid-1',
      p_accessed_fields: ['dose_log.value', 'dose_log.timestamp'],
      p_reason: 'opened patient detail page',
      p_accessed_org_id: 'org-uuid-1',
    });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('T2: rpc returns error — wrapper resolves void; warn called with code, NEVER with message', async () => {
    const mockRpc = supabase.rpc as ReturnType<typeof vi.fn>;
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: '42501', message: 'forbidden', details: null, hint: null },
    });

    // Must NOT throw
    await expect(
      logPhiAccess({
        accessedUserId: 'patient-uuid-2',
        accessedFields: ['photos'],
        reason: 'photo viewer open',
      }),
    ).resolves.toBeUndefined();

    // Must warn with the code
    expect(warnSpy).toHaveBeenCalled();
    const warnArgs = warnSpy.mock.calls.flat().join(' ');
    expect(warnArgs).toContain('42501');
    // MUST NOT contain the message text (S3 pattern: never log error.message)
    expect(warnArgs).not.toContain('forbidden');
  });

  it('T3: rpc throws — wrapper resolves void; warn called with e.name NOT e.message', async () => {
    const mockRpc = supabase.rpc as ReturnType<typeof vi.fn>;
    mockRpc.mockRejectedValueOnce(new Error('connection refused'));

    // Must NOT throw
    await expect(
      logPhiAccess({
        accessedUserId: 'patient-uuid-3',
        accessedFields: ['dose_log.value'],
        reason: 'dose history export',
      }),
    ).resolves.toBeUndefined();

    // Must warn with the error name
    expect(warnSpy).toHaveBeenCalled();
    const warnArgs = warnSpy.mock.calls.flat().join(' ');
    expect(warnArgs).toContain('Error');
    // MUST NOT contain the error message text (S3 pattern)
    expect(warnArgs).not.toContain('connection refused');
  });
});
