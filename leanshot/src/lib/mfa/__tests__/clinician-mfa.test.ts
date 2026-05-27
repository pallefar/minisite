/**
 * Phase 25 Plan 25-08 — Clinician MFA helpers unit tests.
 *
 * D-10 (HIPAA-15): clinician hard-cut TOTP gate.
 *
 * 10 test cases covering:
 *   1. getClinicianAal returns 'aal2' when session.aal='aal2'
 *   2. getClinicianAal returns 'aal1' when session present + aal undefined
 *   3. getClinicianAal returns null when no session
 *   4. enrollClinicianTotp returns factorId + qrCode on success; throws on error
 *   5. challengeClinicianTotp success → aal2
 *   6. challengeClinicianTotp bad code → aal1 + error='invalid_code'
 *   7. challengeClinicianTotp challenge step fails → aal1 + error='challenge_failed'
 *   8. redeemClinicianBackupCode success → aal2
 *   9. redeemClinicianBackupCode bad code → aal1 + error='invalid_or_used'
 *  10. isClinicianTotpEnrolled true when factor verified; false when factor pending or absent
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supabase } from '@/lib/supabase';
import {
  getClinicianAal,
  isClinicianTotpEnrolled,
  enrollClinicianTotp,
  challengeClinicianTotp,
  redeemClinicianBackupCode,
} from '../clinician-mfa';

// ---------------------------------------------------------------------------
// Mock supabase BEFORE importing the module under test
// vi.mock is hoisted, so the factory must use vi.fn() directly (no closure vars)
// ---------------------------------------------------------------------------

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      mfa: {
        enroll: vi.fn(),
        challenge: vi.fn(),
        verify: vi.fn(),
        listFactors: vi.fn(),
        getAuthenticatorAssuranceLevel: vi.fn(),
      },
    },
    rpc: vi.fn(),
  },
}));


// Typed mock accessors — cast after import so TypeScript is happy
const mockGetSession = vi.mocked(supabase.auth.getSession);
const mockEnroll = vi.mocked(supabase.auth.mfa.enroll);
const mockChallenge = vi.mocked(supabase.auth.mfa.challenge);
const mockVerify = vi.mocked(supabase.auth.mfa.verify);
const mockListFactors = vi.mocked(supabase.auth.mfa.listFactors);
const mockGetAal = vi.mocked(supabase.auth.mfa.getAuthenticatorAssuranceLevel);
const mockRpc = vi.mocked(supabase.rpc);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fakeSession(aal?: string) {
  // Side effect: also set up the AAL mock so getClinicianAal returns matching level.
  // Phase 25-08 originally read session.aal directly; Supabase v2 requires
  // supabase.auth.mfa.getAuthenticatorAssuranceLevel() (post-merge fix).
  if (aal !== undefined) {
    // @ts-expect-error — test fixture; only currentLevel matters
    mockGetAal.mockResolvedValue({ data: { currentLevel: aal, nextLevel: aal, currentAuthenticationMethods: [] }, error: null });
  }
  return {
    data: {
      session: aal !== undefined ? { aal } : null,
    },
    error: null,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getClinicianAal', () => {
  it('case 1: returns aal2 when session.aal = aal2', async () => {
    mockGetSession.mockResolvedValue(fakeSession('aal2'));
    const result = await getClinicianAal();
    expect(result).toBe('aal2');
  });

  it('case 2: returns aal1 when session present but aal undefined', async () => {
    mockGetSession.mockResolvedValue({ data: { session: { aal: undefined } }, error: null });
    // @ts-expect-error — test fixture
    mockGetAal.mockResolvedValue({ data: { currentLevel: 'aal1', nextLevel: 'aal2', currentAuthenticationMethods: [] }, error: null });
    const result = await getClinicianAal();
    expect(result).toBe('aal1');
  });

  it('case 3: returns null when no session', async () => {
    mockGetSession.mockResolvedValue(fakeSession());
    const result = await getClinicianAal();
    expect(result).toBeNull();
  });
});

describe('enrollClinicianTotp', () => {
  it('case 4a: returns factorId + qrCode + secret on success', async () => {
    mockEnroll.mockResolvedValue({
      data: {
        id: 'factor-123',
        totp: { qr_code: 'data:image/svg+xml,...', secret: 'BASE32SECRET' },
      },
      error: null,
    });

    const result = await enrollClinicianTotp();
    expect(result.factorId).toBe('factor-123');
    expect(result.qrCode).toBe('data:image/svg+xml,...');
    expect(result.secret).toBe('BASE32SECRET');
    expect(mockEnroll).toHaveBeenCalledWith(expect.objectContaining({ factorType: 'totp' }));
  });

  it('case 4b: throws on error', async () => {
    mockEnroll.mockResolvedValue({
      data: null,
      error: { name: 'EnrollError', message: 'failed' },
    });

    await expect(enrollClinicianTotp()).rejects.toThrow('enroll_failed');
  });
});

describe('challengeClinicianTotp', () => {
  it('case 5: success → aal2', async () => {
    // After verify, getSession returns aal2
    mockChallenge.mockResolvedValue({ data: { id: 'ch-1' }, error: null });
    mockVerify.mockResolvedValue({ data: {}, error: null });
    mockGetSession.mockResolvedValue(fakeSession('aal2'));

    const result = await challengeClinicianTotp('factor-1', '123456');
    expect(result.aal).toBe('aal2');
    expect(result.error).toBeUndefined();
  });

  it('case 6: bad code → aal1 + error=invalid_code', async () => {
    mockChallenge.mockResolvedValue({ data: { id: 'ch-1' }, error: null });
    mockVerify.mockResolvedValue({ data: null, error: { name: 'VerifyError', message: 'bad code' } });

    const result = await challengeClinicianTotp('factor-1', '000000');
    expect(result.aal).toBe('aal1');
    expect(result.error).toBe('invalid_code');
  });

  it('case 7: challenge step fails → aal1 + error=challenge_failed', async () => {
    mockChallenge.mockResolvedValue({ data: null, error: { name: 'ChallengeError', message: 'fail' } });

    const result = await challengeClinicianTotp('factor-1', '123456');
    expect(result.aal).toBe('aal1');
    expect(result.error).toBe('challenge_failed');
  });
});

describe('redeemClinicianBackupCode', () => {
  it('case 8: success → aal2', async () => {
    mockRpc.mockResolvedValue({ data: true, error: null });
    mockGetSession.mockResolvedValue(fakeSession('aal2'));

    const result = await redeemClinicianBackupCode('ABCD-EFGH-1234');
    expect(result.aal).toBe('aal2');
    expect(result.error).toBeUndefined();
  });

  it('case 9: bad/used code → aal1 + error=invalid_or_used', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'invalid' } });

    const result = await redeemClinicianBackupCode('XXXX-XXXX-XXXX');
    expect(result.aal).toBe('aal1');
    expect(result.error).toBe('invalid_or_used');
  });
});

describe('isClinicianTotpEnrolled', () => {
  it('case 10a: true when at least one factor is totp + verified', async () => {
    mockListFactors.mockResolvedValue({
      data: {
        all: [{ factor_type: 'totp', status: 'verified', id: 'f1' }],
        totp: [{ factor_type: 'totp', status: 'verified', id: 'f1' }],
      },
      error: null,
    });

    const result = await isClinicianTotpEnrolled();
    expect(result).toBe(true);
  });

  it('case 10b: false when factor is totp but pending (not verified)', async () => {
    mockListFactors.mockResolvedValue({
      data: {
        all: [{ factor_type: 'totp', status: 'unverified', id: 'f1' }],
        totp: [{ factor_type: 'totp', status: 'unverified', id: 'f1' }],
      },
      error: null,
    });

    const result = await isClinicianTotpEnrolled();
    expect(result).toBe(false);
  });

  it('case 10c: false when no factors exist', async () => {
    mockListFactors.mockResolvedValue({
      data: { all: [], totp: [] },
      error: null,
    });

    const result = await isClinicianTotpEnrolled();
    expect(result).toBe(false);
  });
});
