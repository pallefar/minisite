/**
 * Deno tests for cert-hmac.ts (Phase 46 Plan 07 Task 2).
 *
 * Cross-runtime parity contract — Plan 46-07 (Deno) MUST byte-match Plan 46-03
 * (browser Web Crypto) byte-for-byte. The shared invariants are:
 *
 *   - Payload format: `${certId}:${userId}:${courseId}:${issuedAt}` (colon-separated)
 *   - Algorithm: HMAC-SHA256 with secret = CERT_VERIFICATION_SECRET
 *   - Encoding: base64url — btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')
 *
 * If you change ANY of these three things here, you MUST also change them in
 * src/lib/course/cert-verify-token.ts AND its matching test vector — the
 * verify URL `/verify/<cert_id>?t=<token>` will silently 401 for every cert
 * ever issued. See memory reference_base64url_postgres_vercel_mint_verify.
 *
 * Run: $HOME/.deno/bin/deno test --no-check --allow-env supabase/functions/generate-course-certificate/cert-hmac.test.ts
 */

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { mintCertToken, verifyCertToken } from './cert-hmac.ts';

// ─── Fixture inputs (shared across the round-trip suite) ────────────────────

const CERT_ID = 'cert-1';
const USER_ID = 'user-1';
const COURSE_ID = 'course-1';
const ISSUED_AT = '2026-01-01T00:00:00.000Z';
const SECRET = 'secret-A';

// ─── Round-trip success ─────────────────────────────────────────────────────

Deno.test('mintCertToken returns a base64url string with no +, /, or = chars', () => {
  const token = mintCertToken(CERT_ID, USER_ID, COURSE_ID, ISSUED_AT, SECRET);
  assertEquals(typeof token, 'string');
  // SHA-256 → 32 bytes → 43 chars base64url (no padding)
  assertEquals(token.length, 43, `expected 43 chars, got ${token.length}: ${token}`);
  assertEquals(/[+/=]/.test(token), false);
});

Deno.test('mintCertToken is deterministic — same inputs → same token', () => {
  const a = mintCertToken(CERT_ID, USER_ID, COURSE_ID, ISSUED_AT, SECRET);
  const b = mintCertToken(CERT_ID, USER_ID, COURSE_ID, ISSUED_AT, SECRET);
  assertEquals(a, b);
});

Deno.test('verifyCertToken returns true when all params match the mint call exactly', () => {
  const token = mintCertToken(CERT_ID, USER_ID, COURSE_ID, ISSUED_AT, SECRET);
  assertEquals(verifyCertToken(token, CERT_ID, USER_ID, COURSE_ID, ISSUED_AT, SECRET), true);
});

// ─── Per-field mutation → false ─────────────────────────────────────────────

Deno.test('verifyCertToken returns false when certId is mutated', () => {
  const token = mintCertToken(CERT_ID, USER_ID, COURSE_ID, ISSUED_AT, SECRET);
  assertEquals(verifyCertToken(token, 'cert-2', USER_ID, COURSE_ID, ISSUED_AT, SECRET), false);
});

Deno.test('verifyCertToken returns false when userId is mutated', () => {
  const token = mintCertToken(CERT_ID, USER_ID, COURSE_ID, ISSUED_AT, SECRET);
  assertEquals(verifyCertToken(token, CERT_ID, 'user-2', COURSE_ID, ISSUED_AT, SECRET), false);
});

Deno.test('verifyCertToken returns false when courseId is mutated', () => {
  const token = mintCertToken(CERT_ID, USER_ID, COURSE_ID, ISSUED_AT, SECRET);
  assertEquals(verifyCertToken(token, CERT_ID, USER_ID, 'course-2', ISSUED_AT, SECRET), false);
});

Deno.test('verifyCertToken returns false when issuedAt is mutated', () => {
  const token = mintCertToken(CERT_ID, USER_ID, COURSE_ID, ISSUED_AT, SECRET);
  assertEquals(
    verifyCertToken(token, CERT_ID, USER_ID, COURSE_ID, '2026-01-02T00:00:00.000Z', SECRET),
    false,
  );
});

Deno.test('verifyCertToken returns false when secret is mutated', () => {
  const token = mintCertToken(CERT_ID, USER_ID, COURSE_ID, ISSUED_AT, SECRET);
  assertEquals(
    verifyCertToken(token, CERT_ID, USER_ID, COURSE_ID, ISSUED_AT, 'WRONG_SECRET'),
    false,
  );
});

Deno.test('verifyCertToken returns false on garbage / wrong-length token', () => {
  assertEquals(verifyCertToken('', CERT_ID, USER_ID, COURSE_ID, ISSUED_AT, SECRET), false);
  assertEquals(
    verifyCertToken('0123456789', CERT_ID, USER_ID, COURSE_ID, ISSUED_AT, SECRET),
    false,
  );
});

// ─── Cross-runtime test vector ──────────────────────────────────────────────
//
// DO NOT EDIT WITHOUT UPDATING `src/lib/course/cert-verify-token.test.ts`
// MATCHING VECTOR. The exact token literal below is the output of running
// mintCertToken locally with the fixed inputs; if any of:
//   - the payload format
//   - the HMAC algorithm
//   - the base64url replace-chain
// changes here, the value below will also change AND the browser-side test
// MUST be updated to assert the same new literal. Both sides exist so we can
// catch silent divergence at CI time before any cert ever ships.
//
// Vector inputs:
//   certId   = 'cert-vec-001'
//   userId   = 'user-vec-001'
//   courseId = 'course-vec-001'
//   issuedAt = '2026-01-01T00:00:00.000Z'
//   secret   = 'CROSS_RUNTIME_TEST_SECRET_46'
//
// Expected token (HMAC-SHA256, base64url, no padding) — populated below:
const CROSS_RUNTIME_VECTOR = {
  certId: 'cert-vec-001',
  userId: 'user-vec-001',
  courseId: 'course-vec-001',
  issuedAt: '2026-01-01T00:00:00.000Z',
  secret: 'CROSS_RUNTIME_TEST_SECRET_46',
  expectedToken: '<TO-BE-FILLED-AFTER-FIRST-RUN>',
} as const;

Deno.test('cross-runtime test vector — token matches the locked literal (browser-parity gate)', () => {
  const token = mintCertToken(
    CROSS_RUNTIME_VECTOR.certId,
    CROSS_RUNTIME_VECTOR.userId,
    CROSS_RUNTIME_VECTOR.courseId,
    CROSS_RUNTIME_VECTOR.issuedAt,
    CROSS_RUNTIME_VECTOR.secret,
  );
  // If this assertion fails because the literal placeholder is still the sentinel,
  // run the test once, copy the actual value into expectedToken, and re-run.
  assertEquals(
    token,
    CROSS_RUNTIME_VECTOR.expectedToken,
    `cross-runtime vector divergence: got ${token}`,
  );
});
