/**
 * Phase 25 Plan 25-08 — Patient MFA helpers unit tests.
 *
 * D-11 (HIPAA-15): Patient MFA is OPTIONAL. Sensitive actions always step up.
 *
 * 8 test cases:
 *   1. isPatientTotpEnrolled delegates to listFactors (verified = true)
 *   2. enrollPatientTotp returns factorId + qrCode + secret on success
 *   3. enrollPatientTotp throws on error
 *   4. unenrollPatientTotp calls supabase.auth.mfa.unenroll
 *   5. requireStepUp with TOTP enrolled → ok=true, method='totp'
 *   6. requireStepUp without TOTP → email OTP initiated → ok=true, method='email_otp'
 *   7. requireStepUp without TOTP, no user email → ok=false
 *   8. requireStepUp without TOTP, signInWithOtp fails → ok=false
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supabase } from '@/lib/supabase';
import {
  isPatientTotpEnrolled,
  enrollPatientTotp,
  unenrollPatientTotp,
  requireStepUp,
} from '../patient-mfa';

// ---------------------------------------------------------------------------
// Mock supabase — must use inline vi.fn() in factory (hoisting rule)
// ---------------------------------------------------------------------------

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: vi.fn(),
      signInWithOtp: vi.fn(),
      mfa: {
        enroll: vi.fn(),
        unenroll: vi.fn(),
        listFactors: vi.fn(),
      },
    },
  },
}));


const mockGetUser = vi.mocked(supabase.auth.getUser);
const mockSignInWithOtp = vi.mocked(supabase.auth.signInWithOtp);
const mockEnroll = vi.mocked(supabase.auth.mfa.enroll);
const mockUnenroll = vi.mocked(supabase.auth.mfa.unenroll);
const mockListFactors = vi.mocked(supabase.auth.mfa.listFactors);

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('isPatientTotpEnrolled', () => {
  it('case 1: true when factor is verified', async () => {
    mockListFactors.mockResolvedValue({
      data: {
        all: [{ factor_type: 'totp', status: 'verified', id: 'f1' }],
        totp: [{ factor_type: 'totp', status: 'verified', id: 'f1' }],
      },
      error: null,
    });
    expect(await isPatientTotpEnrolled()).toBe(true);
  });
});

describe('enrollPatientTotp', () => {
  it('case 2: returns factorId + qrCode + secret on success', async () => {
    mockEnroll.mockResolvedValue({
      data: {
        id: 'patient-factor-1',
        totp: { qr_code: 'data:image/svg...', secret: 'PATIENTSECRET' },
      },
      error: null,
    });

    const result = await enrollPatientTotp();
    expect(result.factorId).toBe('patient-factor-1');
    expect(result.qrCode).toBe('data:image/svg...');
    expect(result.secret).toBe('PATIENTSECRET');
    // issuer must be different from clinician (no "Clinic" in patient enrollment)
    expect(mockEnroll).toHaveBeenCalledWith(
      expect.objectContaining({ factorType: 'totp', issuer: 'LeanShot' }),
    );
  });

  it('case 3: throws on error', async () => {
    mockEnroll.mockResolvedValue({ data: null, error: { name: 'EnrollError', message: 'fail' } });
    await expect(enrollPatientTotp()).rejects.toThrow('enroll_failed');
  });
});

describe('unenrollPatientTotp', () => {
  it('case 4: calls unenroll with factorId', async () => {
    mockUnenroll.mockResolvedValue({ data: {}, error: null });
    await expect(unenrollPatientTotp('fid-1')).resolves.toBeUndefined();
    expect(mockUnenroll).toHaveBeenCalledWith({ factorId: 'fid-1' });
  });
});

describe('requireStepUp', () => {
  it('case 5: TOTP enrolled → ok=true, method=totp (caller renders TOTP modal)', async () => {
    mockListFactors.mockResolvedValue({
      data: {
        all: [{ factor_type: 'totp', status: 'verified', id: 'f1' }],
        totp: [{ factor_type: 'totp', status: 'verified', id: 'f1' }],
      },
      error: null,
    });

    const result = await requireStepUp();
    expect(result.ok).toBe(true);
    expect(result.method).toBe('totp');
    // signInWithOtp should NOT be called when TOTP is enrolled
    expect(mockSignInWithOtp).not.toHaveBeenCalled();
  });

  it('case 6: no TOTP, email present → email OTP initiated → ok=true, method=email_otp', async () => {
    mockListFactors.mockResolvedValue({
      data: { all: [], totp: [] },
      error: null,
    });
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'u1', email: 'patient@example.com' } },
      error: null,
    });
    mockSignInWithOtp.mockResolvedValue({ data: {}, error: null });

    const result = await requireStepUp();
    expect(result.ok).toBe(true);
    expect(result.method).toBe('email_otp');
    expect(mockSignInWithOtp).toHaveBeenCalledWith({ email: 'patient@example.com' });
  });

  it('case 7: no TOTP, no user email → ok=false', async () => {
    mockListFactors.mockResolvedValue({
      data: { all: [], totp: [] },
      error: null,
    });
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'u1', email: undefined } },
      error: null,
    });

    const result = await requireStepUp();
    expect(result.ok).toBe(false);
    expect(mockSignInWithOtp).not.toHaveBeenCalled();
  });

  it('case 8: no TOTP, signInWithOtp fails → ok=false', async () => {
    mockListFactors.mockResolvedValue({
      data: { all: [], totp: [] },
      error: null,
    });
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'u1', email: 'patient@example.com' } },
      error: null,
    });
    mockSignInWithOtp.mockResolvedValue({ data: null, error: { name: 'OtpError', message: 'fail' } });

    const result = await requireStepUp();
    expect(result.ok).toBe(false);
  });
});
