/**
 * Phase 46 Plan 03 — Certificate verification token round-trip tests.
 *
 * Proves the browser-side HMAC-SHA256 (Web Crypto) helpers produce and verify
 * tokens that the Edge Fn analog (Plan 46-07 cert-hmac.ts using node:crypto)
 * can interoperate with. Both sides MUST share:
 *   - Payload format: `${certId}:${userId}:${courseId}:${issuedAt}` (colon-separated, 4 fields)
 *   - Encoding: base64url = btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')
 *   - HMAC-SHA256
 *
 * T-46-03 mitigation: constant-time compare prevents timing-oracle leaks of HMAC bytes.
 */
import { describe, it, expect } from 'vitest';

import { compareCertToken, mintCertToken, verifyCertToken } from '@/lib/course/cert-verify-token';

const TEST_SECRET = 'TEST_SECRET_DO_NOT_USE_IN_PROD_46_03';
const CERT_ID = 'cert-1';
const USER_ID = 'user-1';
const COURSE_ID = 'course-1';
const ISSUED_AT = '2026-01-01T00:00:00Z';

describe('mintCertToken', () => {
  it('returns a non-empty base64url string (no +, /, or = chars)', async () => {
    const token = await mintCertToken(CERT_ID, USER_ID, COURSE_ID, ISSUED_AT, TEST_SECRET);
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);
    expect(token).not.toMatch(/[+/=]/);
  });

  it('is deterministic — same payload + same secret → same token', async () => {
    const a = await mintCertToken(CERT_ID, USER_ID, COURSE_ID, ISSUED_AT, TEST_SECRET);
    const b = await mintCertToken(CERT_ID, USER_ID, COURSE_ID, ISSUED_AT, TEST_SECRET);
    expect(a).toBe(b);
  });
});

describe('verifyCertToken', () => {
  it('returns true when all params match the mint call exactly', async () => {
    const token = await mintCertToken(CERT_ID, USER_ID, COURSE_ID, ISSUED_AT, TEST_SECRET);
    const ok = await verifyCertToken(
      token,
      CERT_ID,
      USER_ID,
      COURSE_ID,
      ISSUED_AT,
      TEST_SECRET,
    );
    expect(ok).toBe(true);
  });

  it('returns false when any single param differs', async () => {
    const token = await mintCertToken(CERT_ID, USER_ID, COURSE_ID, ISSUED_AT, TEST_SECRET);

    // Each row mutates exactly one input field; all 5 MUST verify as false.
    const mutations: Array<[string, string, string, string, string, string]> = [
      [token, 'cert-2', USER_ID, COURSE_ID, ISSUED_AT, TEST_SECRET], // tampered cert_id
      [token, CERT_ID, 'user-2', COURSE_ID, ISSUED_AT, TEST_SECRET], // tampered user_id
      [token, CERT_ID, USER_ID, 'course-2', ISSUED_AT, TEST_SECRET], // tampered course_id
      [token, CERT_ID, USER_ID, COURSE_ID, '2026-01-02T00:00:00Z', TEST_SECRET], // tampered issued_at
      [token, CERT_ID, USER_ID, COURSE_ID, ISSUED_AT, 'WRONG_SECRET'], // tampered secret
    ];

    for (const [t, c, u, cr, i, s] of mutations) {
      const ok = await verifyCertToken(t, c, u, cr, i, s);
      expect(ok).toBe(false);
    }
  });

  it('returns false on token of wrong length (empty or garbage)', async () => {
    const emptyOk = await verifyCertToken('', CERT_ID, USER_ID, COURSE_ID, ISSUED_AT, TEST_SECRET);
    expect(emptyOk).toBe(false);

    const garbageOk = await verifyCertToken(
      '0123456789',
      CERT_ID,
      USER_ID,
      COURSE_ID,
      ISSUED_AT,
      TEST_SECRET,
    );
    expect(garbageOk).toBe(false);
  });
});

// ─── Cross-runtime test vector (browser ⇄ Deno parity gate) ─────────────────
//
// MIRROR of supabase/functions/generate-course-certificate/cert-hmac.test.ts
// "cross-runtime test vector" — both suites assert the same literal so any
// future divergence in payload format / HMAC algo / base64url replace-chain
// trips CI before any cert ever ships.
//
// DO NOT EDIT WITHOUT UPDATING THE DENO COUNTERPART (and vice versa).
//
// Vector inputs:
//   certId   = 'cert-vec-001'
//   userId   = 'user-vec-001'
//   courseId = 'course-vec-001'
//   issuedAt = '2026-01-01T00:00:00.000Z'
//   secret   = 'CROSS_RUNTIME_TEST_SECRET_46'
describe('cross-runtime parity vector (browser ⇄ Deno)', () => {
  it('mintCertToken produces the locked literal that the Deno side also produces', async () => {
    const token = await mintCertToken(
      'cert-vec-001',
      'user-vec-001',
      'course-vec-001',
      '2026-01-01T00:00:00.000Z',
      'CROSS_RUNTIME_TEST_SECRET_46',
    );
    // If this assertion fails: either
    //   (a) the browser-side payload format / replace-chain drifted, or
    //   (b) the Deno-side mirror in cert-hmac.test.ts changed without updating here.
    // Both sides MUST be updated atomically.
    expect(token).toBe('VkvWn-pOnuE3pmNb1Y2LyBFhcZmO9gehMViOvszVwsw');
  });
});

// ─── compareCertToken (Plan 46-10) ──────────────────────────────────────────
//
// Constant-time string compare used by the public /verify/<cert_id> SPA route.
// Unlike verifyCertToken, this helper does NOT require CERT_VERIFICATION_SECRET
// (which must never reach the browser). The browser fetches
// certificates.verification_token from the DB (RLS allows anon SELECT when
// non-null per Plan 46-01) and compares it byte-for-byte against the URL `?t=`
// param. The HMAC was minted server-side by the Edge Fn (Plan 46-07); the DB
// row holds the canonical value; the browser is purely a comparator.
//
// T-46-03 mitigation: XOR-accumulator timing-safe compare (same primitive as
// verifyCertToken's internal constantTimeEqual).
describe('compareCertToken', () => {
  it("returns true for two identical short strings ('abc', 'abc')", () => {
    expect(compareCertToken('abc', 'abc')).toBe(true);
  });

  it("returns false when one character differs ('abc', 'abd')", () => {
    expect(compareCertToken('abc', 'abd')).toBe(false);
  });

  it("returns false when urlToken is empty ('', 'abc')", () => {
    expect(compareCertToken('', 'abc')).toBe(false);
  });

  it("returns false when dbToken is empty ('abc', '')", () => {
    expect(compareCertToken('abc', '')).toBe(false);
  });

  it("returns false on length mismatch ('abc', 'abcd')", () => {
    expect(compareCertToken('abc', 'abcd')).toBe(false);
  });

  it('returns true when both inputs are a canonical token produced by mintCertToken', async () => {
    const token = await mintCertToken(CERT_ID, USER_ID, COURSE_ID, ISSUED_AT, TEST_SECRET);
    // Round-trip parity: the comparison-only path accepts exactly what
    // the Edge Fn writes into certificates.verification_token (the same
    // base64url string that mintCertToken produces).
    expect(compareCertToken(token, token)).toBe(true);
  });
});
