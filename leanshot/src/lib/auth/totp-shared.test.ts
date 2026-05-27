/**
 * Phase 66 Plan 66-02 — Shared TOTP + backup-code helper unit tests.
 *
 * Mirrors the Phase 25 `src/lib/admin/__tests__/totp.test.ts` shape so the
 * shared module is tested independently from any admin importer.
 *
 * Tests:
 *   T1: generateBackupCodes(10) returns 10 unique codes in XXXX-XXXX-XXXX
 *   T2: generateBackupCodes(10) is statistically distinct across 100 calls
 *   T3: enrollTotp calls supabase.auth.mfa.enroll with factorType:'totp'
 *   T4: verifyTotpChallenge runs challenge → verify and returns { ok, aal }
 *   T5: verifyTotpChallenge surfaces { ok: false } on challenge error
 *   T6: listEnrolledFactors filters down to verified TOTP factors only
 *   T7: unenrollFactor wraps mfa.unenroll and throws on error
 *   T8: hashBackupCode is deterministic + SHA-256 (32 bytes → 64 hex chars)
 *   T9: verifyBackupCode returns true on match, false on mismatch
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  hashBackupCode,
  verifyBackupCode,
} from '@/lib/auth/backup-codes-shared';
import {
  enrollTotp,
  generateBackupCodes,
  listEnrolledFactors,
  unenrollFactor,
  verifyTotpChallenge,
} from '@/lib/auth/totp-shared';

// ---------------------------------------------------------------------------
// Helper: build a minimal SupabaseClient stub that satisfies the shape the
// shared helpers reach into. Each test sets up its own mock returns.
// ---------------------------------------------------------------------------

interface MfaMock {
  enroll: ReturnType<typeof vi.fn>;
  challenge: ReturnType<typeof vi.fn>;
  verify: ReturnType<typeof vi.fn>;
  listFactors: ReturnType<typeof vi.fn>;
  unenroll: ReturnType<typeof vi.fn>;
}

function buildMockClient(): { client: SupabaseClient; mfa: MfaMock } {
  const mfa: MfaMock = {
    enroll: vi.fn(),
    challenge: vi.fn(),
    verify: vi.fn(),
    listFactors: vi.fn(),
    unenroll: vi.fn(),
  };
  const client = { auth: { mfa } } as unknown as SupabaseClient;
  return { client, mfa };
}

// ---------------------------------------------------------------------------
// T1 / T2 — generateBackupCodes
// ---------------------------------------------------------------------------

describe('generateBackupCodes', () => {
  it('T1: returns 10 unique codes each matching XXXX-XXXX-XXXX pattern', () => {
    const codes = generateBackupCodes(10);
    expect(codes).toHaveLength(10);
    const pattern = /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/;
    for (const code of codes) {
      expect(code).toMatch(pattern);
    }
    expect(new Set(codes).size).toBe(10);
  });

  it('T2: distinct across repeated calls — very low collision probability', () => {
    const allCodes = Array.from({ length: 10 }, () => generateBackupCodes(10)).flat();
    const unique = new Set(allCodes);
    expect(unique.size).toBeGreaterThanOrEqual(90);
  });

  it('T2b: default count is 10', () => {
    expect(generateBackupCodes()).toHaveLength(10);
  });
});

// ---------------------------------------------------------------------------
// T3 — enrollTotp
// ---------------------------------------------------------------------------

describe('enrollTotp', () => {
  beforeEach(() => vi.clearAllMocks());

  it('T3: calls mfa.enroll with factorType:"totp" + issuer + friendlyName', async () => {
    const { client, mfa } = buildMockClient();
    mfa.enroll.mockResolvedValueOnce({
      data: {
        id: 'factor-1',
        type: 'totp',
        totp: { qr_code: 'data:image/...', secret: 'SECRET', uri: 'otpauth://...' },
      },
      error: null,
    });

    const result = await enrollTotp(
      { issuer: 'LeanShot', friendlyName: 'Authenticator' },
      client,
    );

    expect(mfa.enroll).toHaveBeenCalledWith({
      factorType: 'totp',
      issuer: 'LeanShot',
      friendlyName: 'Authenticator',
    });
    expect(result.error).toBeNull();
    expect(result.data?.id).toBe('factor-1');
  });
});

// ---------------------------------------------------------------------------
// T4 / T5 — verifyTotpChallenge
// ---------------------------------------------------------------------------

describe('verifyTotpChallenge', () => {
  beforeEach(() => vi.clearAllMocks());

  it('T4: runs challenge → verify, returns { ok: true, aal: "aal2" }', async () => {
    const { client, mfa } = buildMockClient();
    mfa.challenge.mockResolvedValueOnce({
      data: { id: 'challenge-1' },
      error: null,
    });
    mfa.verify.mockResolvedValueOnce({
      data: { session: {} },
      error: null,
    });

    const result = await verifyTotpChallenge(
      { factorId: 'factor-1', code: '123456' },
      client,
    );

    expect(mfa.challenge).toHaveBeenCalledWith({ factorId: 'factor-1' });
    expect(mfa.verify).toHaveBeenCalledWith({
      factorId: 'factor-1',
      challengeId: 'challenge-1',
      code: '123456',
    });
    expect(result).toEqual({ ok: true, aal: 'aal2' });
  });

  it('T5: returns { ok: false } if challenge fails (verify NOT called)', async () => {
    const { client, mfa } = buildMockClient();
    mfa.challenge.mockResolvedValueOnce({
      data: null,
      error: { message: 'factor_not_found', status: 404 },
    });

    const result = await verifyTotpChallenge(
      { factorId: 'bad-factor', code: '000000' },
      client,
    );

    expect(result.ok).toBe(false);
    expect(result.aal).toBeNull();
    expect(mfa.verify).not.toHaveBeenCalled();
  });

  it('T5b: returns { ok: false } on verify error', async () => {
    const { client, mfa } = buildMockClient();
    mfa.challenge.mockResolvedValueOnce({
      data: { id: 'challenge-2' },
      error: null,
    });
    mfa.verify.mockResolvedValueOnce({
      data: null,
      error: { message: 'invalid_code', status: 400 },
    });

    const result = await verifyTotpChallenge(
      { factorId: 'factor-1', code: '000000' },
      client,
    );

    expect(result.ok).toBe(false);
    expect(result.aal).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// T6 — listEnrolledFactors
// ---------------------------------------------------------------------------

describe('listEnrolledFactors', () => {
  beforeEach(() => vi.clearAllMocks());

  it('T6: returns only verified TOTP factors', async () => {
    const { client, mfa } = buildMockClient();
    mfa.listFactors.mockResolvedValueOnce({
      data: {
        totp: [
          { id: 'f1', factor_type: 'totp', status: 'verified' },
          { id: 'f2', factor_type: 'totp', status: 'unverified' },
          { id: 'f3', factor_type: 'totp', status: 'verified' },
        ],
        all: [],
      },
      error: null,
    });

    const factors = await listEnrolledFactors(client);
    expect(factors).toHaveLength(2);
    expect(factors.map((f) => f.id)).toEqual(['f1', 'f3']);
  });

  it('T6b: returns [] on error', async () => {
    const { client, mfa } = buildMockClient();
    mfa.listFactors.mockResolvedValueOnce({
      data: null,
      error: { message: 'not_authenticated' },
    });
    const factors = await listEnrolledFactors(client);
    expect(factors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// T7 — unenrollFactor
// ---------------------------------------------------------------------------

describe('unenrollFactor', () => {
  beforeEach(() => vi.clearAllMocks());

  it('T7: wraps mfa.unenroll and resolves on success', async () => {
    const { client, mfa } = buildMockClient();
    mfa.unenroll.mockResolvedValueOnce({ data: { id: 'f1' }, error: null });
    await expect(unenrollFactor('f1', client)).resolves.toBeUndefined();
    expect(mfa.unenroll).toHaveBeenCalledWith({ factorId: 'f1' });
  });

  it('T7b: throws on error', async () => {
    const { client, mfa } = buildMockClient();
    mfa.unenroll.mockResolvedValueOnce({
      data: null,
      error: { message: 'factor_not_found' },
    });
    await expect(unenrollFactor('f1', client)).rejects.toThrow(/unenroll_failed/);
  });
});

// ---------------------------------------------------------------------------
// T8 / T9 — backup-code hashing + verification
// ---------------------------------------------------------------------------

describe('hashBackupCode + verifyBackupCode', () => {
  it('T8: hashBackupCode is deterministic + SHA-256 length (64 hex chars)', async () => {
    const a = await hashBackupCode('ABCD-EFGH-JKMN');
    const b = await hashBackupCode('ABCD-EFGH-JKMN');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('T8b: distinct codes produce distinct hashes', async () => {
    const a = await hashBackupCode('AAAA-BBBB-CCCC');
    const b = await hashBackupCode('AAAA-BBBB-DDDD');
    expect(a).not.toBe(b);
  });

  it('T9: verifyBackupCode returns true on match, false on mismatch', async () => {
    const hash = await hashBackupCode('ZZZZ-YYYY-XXXX');
    await expect(verifyBackupCode('ZZZZ-YYYY-XXXX', hash)).resolves.toBe(true);
    await expect(verifyBackupCode('ZZZZ-YYYY-WWWW', hash)).resolves.toBe(false);
  });

  it('T9b: mismatched lengths are not a timing oracle (still resolve false)', async () => {
    const hash = await hashBackupCode('ABCD-EFGH-JKMN');
    await expect(verifyBackupCode('short', hash)).resolves.toBe(false);
    await expect(verifyBackupCode('ABCD-EFGH-JKMN-EXTRA', hash)).resolves.toBe(false);
  });
});
