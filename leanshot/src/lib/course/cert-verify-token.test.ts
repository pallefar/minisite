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

import { mintCertToken, verifyCertToken } from '@/lib/course/cert-verify-token';

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
