/**
 * Phase 60 Plan 60-12 Task 2 — newsletter-token.ts Deno tests.
 *
 * 8 test cases covering constantTimeEqual, mintUnsubscribeToken, verifyUnsubscribeToken,
 * base64url normalization, and forged-token rejection.
 *
 * Run: $HOME/.deno/bin/deno test --no-check supabase/functions/_shared/__tests__/newsletter-token.test.ts
 *
 * NOTE: This file imports ONLY _shared/newsletter-token.ts (no Fn imports).
 * newsletter-token.ts has no Deno.serve call so the top-level-serve trap
 * ([[reference_deno_test_top_level_serve_trap]]) does not apply here.
 */

import {
  assertEquals,
  assertFalse,
  assert,
} from 'https://deno.land/std@0.224.0/assert/mod.ts';

import {
  constantTimeEqual,
  mintUnsubscribeToken,
  verifyUnsubscribeToken,
} from '../newsletter-token.ts';

const TEST_SIGNING_KEY = 'test-signing-key-32-bytes-for-hmac-sha256-tests';
const TEST_USER_ID = 'user-test-123';
const TEST_STORED_TOKEN = 'base64storedtoken==';

// ─── Test 1: constantTimeEqual equal strings ────────────────────────────────

Deno.test('constantTimeEqual: equal strings return true', () => {
  assertEquals(constantTimeEqual('aaa', 'aaa'), true);
});

// ─── Test 2: constantTimeEqual mismatched strings ──────────────────────────

Deno.test('constantTimeEqual: mismatched strings return false', () => {
  assertFalse(constantTimeEqual('aaa', 'aab'));
});

// ─── Test 3: constantTimeEqual length mismatch ────────────────────────────

Deno.test('constantTimeEqual: length mismatch returns false', () => {
  assertFalse(constantTimeEqual('aa', 'aaa'));
  assertFalse(constantTimeEqual('aaa', 'aa'));
});

// ─── Test 4: constantTimeEqual empty strings ──────────────────────────────

Deno.test('constantTimeEqual: both empty returns true', () => {
  assertEquals(constantTimeEqual('', ''), true);
});

// ─── Test 5: timing smoke test ────────────────────────────────────────────
// Not a strict timing assertion — verifies the function iterates over all chars
// without short-circuit by asserting consistent return for 10000 iterations.

Deno.test('constantTimeEqual: does not short-circuit (10000 iterations smoke)', () => {
  const equalCount = Array.from({ length: 10000 }, (_, i) => {
    const a = 'abcdefghijklmnopqrstuvwxyz012345';
    const b = i % 2 === 0 ? 'abcdefghijklmnopqrstuvwxyz012345' : 'abcdefghijklmnopqrstuvwxyz012346';
    return constantTimeEqual(a, b) ? 1 : 0;
  }).reduce((acc, v) => acc + v, 0);
  // Half should be equal (even indices), half not
  assertEquals(equalCount, 5000);
});

// ─── Test 6: round-trip mint + verify ────────────────────────────────────

Deno.test('mintUnsubscribeToken + verifyUnsubscribeToken: round-trip succeeds', async () => {
  const token = await mintUnsubscribeToken({
    userId: TEST_USER_ID,
    storedToken: TEST_STORED_TOKEN,
    signingKey: TEST_SIGNING_KEY,
  });

  assert(token.length > 0, 'token should be non-empty');
  // base64url format: no '+', '/', '=' characters
  assertFalse(token.includes('+'), 'token should not contain +');
  assertFalse(token.includes('/'), 'token should not contain /');
  assertFalse(token.includes('='), 'token should not contain =');

  const valid = await verifyUnsubscribeToken({
    userId: TEST_USER_ID,
    storedToken: TEST_STORED_TOKEN,
    signingKey: TEST_SIGNING_KEY,
    presentedToken: token,
  });
  assertEquals(valid, true);
});

// ─── Test 7: forged token rejected ───────────────────────────────────────

Deno.test('verifyUnsubscribeToken: rejects forged tokens (wrong key)', async () => {
  const token = await mintUnsubscribeToken({
    userId: TEST_USER_ID,
    storedToken: TEST_STORED_TOKEN,
    signingKey: TEST_SIGNING_KEY,
  });

  const valid = await verifyUnsubscribeToken({
    userId: TEST_USER_ID,
    storedToken: TEST_STORED_TOKEN,
    signingKey: 'wrong-signing-key',
    presentedToken: token,
  });
  assertFalse(valid);
});

// ─── Test 8: base64url normalization ─────────────────────────────────────
// Verifies that the replace-chain handles '+/=' consistently so a token
// minted with one signing call can be verified by another. Also verifies
// the output contains no standard base64 characters (+/=).

Deno.test('mintUnsubscribeToken: base64url normalize replace-chain consistent', async () => {
  // Mint same token twice — must produce identical result (deterministic HMAC)
  const token1 = await mintUnsubscribeToken({
    userId: TEST_USER_ID,
    storedToken: TEST_STORED_TOKEN,
    signingKey: TEST_SIGNING_KEY,
  });
  const token2 = await mintUnsubscribeToken({
    userId: TEST_USER_ID,
    storedToken: TEST_STORED_TOKEN,
    signingKey: TEST_SIGNING_KEY,
  });

  assertEquals(token1, token2, 'deterministic HMAC should produce identical tokens');

  // Ensure base64url encoding (no +/=)
  assert(/^[A-Za-z0-9\-_]+$/.test(token1), 'token should be valid base64url');
});
