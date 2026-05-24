/**
 * Phase 49 Plan 49-08 — Tests for unsubscribe-token HMAC mint/verify.
 *
 * Behavior under test (per PLAN.md `<behavior>` block):
 *   - mintUnsubscribeToken returns `<b64url-payload>.<b64url-hmac>`.
 *   - verifyUnsubscribeToken accepts the same token, returning the payload.
 *   - Tampering with the HMAC half flips verification to null.
 *   - Expired exp flips verification to null.
 *   - Unknown category (outside whitelist) flips verification to null.
 *   - readSigningKey throws when the env var is unset (no `key?` override).
 *
 * The optional `key?` second parameter on mint+verify is the test seam — it
 * lets tests run without touching Deno.env, so this file is safe under the
 * standard project `deno test` flow.
 */

import { assertEquals, assertThrows } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { mintUnsubscribeToken, verifyUnsubscribeToken } from './unsubscribe-token.ts';

const TEST_KEY = 'test-fixture-key-49-08';

Deno.test('roundtrip: mint then verify recovers payload', () => {
  const p = {
    user_id: '00000000-0000-0000-0000-000000000001',
    category: 'daily_community_digest' as const,
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
  const tok = mintUnsubscribeToken(p, TEST_KEY);
  assertEquals(verifyUnsubscribeToken(tok, TEST_KEY), p);
});

Deno.test('roundtrip: weekly_community_digest also accepted', () => {
  const p = {
    user_id: '00000000-0000-0000-0000-000000000002',
    category: 'weekly_community_digest' as const,
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
  const tok = mintUnsubscribeToken(p, TEST_KEY);
  assertEquals(verifyUnsubscribeToken(tok, TEST_KEY), p);
});

Deno.test('tampered MAC → null', () => {
  const p = {
    user_id: 'u',
    category: 'daily_community_digest' as const,
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
  const tok = mintUnsubscribeToken(p, TEST_KEY);
  const parts = tok.split('.');
  // Flip last two chars of MAC half — preserves length + base64url alphabet.
  const tampered = `${parts[0]}.${parts[1].slice(0, -2)}AA`;
  assertEquals(verifyUnsubscribeToken(tampered, TEST_KEY), null);
});

Deno.test('missing dot → null', () => {
  assertEquals(verifyUnsubscribeToken('no-dot-at-all', TEST_KEY), null);
});

Deno.test('expired exp → null', () => {
  const p = {
    user_id: 'u',
    category: 'weekly_community_digest' as const,
    exp: Math.floor(Date.now() / 1000) - 1,
  };
  const tok = mintUnsubscribeToken(p, TEST_KEY);
  assertEquals(verifyUnsubscribeToken(tok, TEST_KEY), null);
});

Deno.test('unknown category → null (manual mint with rejected category)', async () => {
  // Manually build a token with a category outside the whitelist, then sign
  // it with TEST_KEY so the HMAC is valid — verify must still reject on the
  // category whitelist check (defence-in-depth: don't trust the payload).
  const json = JSON.stringify({
    user_id: 'u',
    category: 'marketing_blast',
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
  // Reuse the public mint with a payload object cast — but mint enforces the
  // type. Instead, construct via the same primitives directly.
  const { createHmac } = await import('node:crypto');
  const { Buffer } = await import('node:buffer');
  const payloadEncoded = Buffer.from(json, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const macBytes = createHmac('sha256', TEST_KEY).update(payloadEncoded).digest();
  const macEncoded = Buffer.from(macBytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const tok = `${payloadEncoded}.${macEncoded}`;
  assertEquals(verifyUnsubscribeToken(tok, TEST_KEY), null);
});

Deno.test('missing payload field → null', async () => {
  // Mint a payload missing user_id, with a valid HMAC.
  const json = JSON.stringify({
    category: 'daily_community_digest',
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
  const { createHmac } = await import('node:crypto');
  const { Buffer } = await import('node:buffer');
  const payloadEncoded = Buffer.from(json, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const macBytes = createHmac('sha256', TEST_KEY).update(payloadEncoded).digest();
  const macEncoded = Buffer.from(macBytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const tok = `${payloadEncoded}.${macEncoded}`;
  assertEquals(verifyUnsubscribeToken(tok, TEST_KEY), null);
});

Deno.test('readSigningKey throws when UNSUBSCRIBE_SECRET unset', () => {
  // No key override -> must read env. In test runtime UNSUBSCRIBE_SECRET is
  // not set, so verify (which reads on the way to the HMAC computation)
  // throws via readSigningKey.
  assertThrows(() => verifyUnsubscribeToken('any.thing'));
});
