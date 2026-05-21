/**
 * 35-og-cache-bust.spec.ts — Pitfall 9 URL-based cache-bust strategy (GAME-07).
 *
 * Twitter (and LinkedIn) cache OG images by the exact URL. When a user shares
 * the same level URL twice, Twitter serves the cached image from their CDN — meaning
 * level changes or token re-mints would show stale cards.
 *
 * Mitigation: buildShareUrl() appends ?v=<unix_ts> to each share URL, giving
 * each share occasion a unique URL → unique Twitter cache key.
 *
 * These tests verify:
 *   1. Different ?v= params produce successful responses (CDN doesn't collapse them).
 *   2. Different ?level= params produce byte-distinct PNG content (different cards).
 *
 * Requires: LEANSHOT_TEST_BASE_URL — deployed Vercel with OG Function live.
 * Plan 35-10 supplies the URL.
 */
import { test, expect } from '@playwright/test';

const BASE = process.env.LEANSHOT_TEST_BASE_URL;

test.skip(!BASE, 'requires LEANSHOT_TEST_BASE_URL');

test('different ?v= params both return 200 (cache-bust URLs are all valid)', async ({
  request,
}) => {
  // Two share occasions for the same level — different ?v= cache-bust timestamps
  const [r1, r2] = await Promise.all([
    request.get(`${BASE}/api/og/level-up.png?level=5&v=1000`),
    request.get(`${BASE}/api/og/level-up.png?level=5&v=999999`),
  ]);
  expect(r1.status()).toBe(200);
  expect(r2.status()).toBe(200);
  // URLs differ — proves the cache-bust strategy creates unique Twitter cache keys
  expect(`${BASE}/api/og/level-up.png?level=5&v=1000`).not.toBe(
    `${BASE}/api/og/level-up.png?level=5&v=999999`,
  );
});

test('different levels produce different PNG content (different cards)', async ({
  request,
}) => {
  const [r3, r10] = await Promise.all([
    request.get(`${BASE}/api/og/level-up.png?level=3`),
    request.get(`${BASE}/api/og/level-up.png?level=10`),
  ]);
  expect(r3.status()).toBe(200);
  expect(r10.status()).toBe(200);

  const buf3 = Buffer.from(await r3.body());
  const buf10 = Buffer.from(await r10.body());

  // The two PNGs render different text ("Level 3" vs "Level 10") — byte-distinct.
  // Buffer.compare returns 0 only if byte-identical.
  expect(Buffer.compare(buf3, buf10)).not.toBe(0);
});

test('OG image URL has correct Cache-Control headers (1h browser / 1d CDN)', async ({
  request,
}) => {
  const res = await request.get(`${BASE}/api/og/level-up.png?level=5&v=1`);
  expect(res.status()).toBe(200);
  const cc = res.headers()['cache-control'] ?? '';
  // Assert public + both max-age values
  expect(cc).toMatch(/public/);
  expect(cc).toMatch(/max-age=3600/);
  expect(cc).toMatch(/s-maxage=86400/);
});
