/**
 * 35-og-share-card.spec.ts — GAME-07 OG share-card deploy-gated Playwright tests.
 *
 * Requires: LEANSHOT_TEST_BASE_URL pointing to a deployed Vercel preview/prod with
 *           the /api/og/level-up.png and /share/level/<token> Vercel Edge Functions live.
 * Optional: LEANSHOT_TEST_SHARE_TOKEN — a pre-minted valid token (from Plan 35-10 seed).
 *           Falls back to ?level=5 (no-token path) for basic smoke tests.
 *
 * Round-trip coverage (REVIEW-F-3): mint_share_token(5) Postgres → token → Vercel verify.
 * This is the single integration point where the Postgres replace-chain base64url
 * (mint) and the Vercel Web Crypto base64url (verify) can silently diverge.
 * If this test returns 400 for a minted token, the base64url chains are mismatched.
 *
 * Plan 35-10 deploys to Vercel preview and supplies LEANSHOT_TEST_SHARE_TOKEN + BASE_URL.
 */
import { test, expect } from '@playwright/test';

const BASE = process.env.LEANSHOT_TEST_BASE_URL;

// Skip entire file if no deployed URL is available (local dev, unit-only CI)
test.skip(!BASE, 'requires LEANSHOT_TEST_BASE_URL (deployed Vercel)');

test('OG image route returns 200 + image/png with PNG file signature', async ({ request }) => {
  const tokenParam = process.env.LEANSHOT_TEST_SHARE_TOKEN
    ? `token=${encodeURIComponent(process.env.LEANSHOT_TEST_SHARE_TOKEN)}`
    : `level=5`;
  const res = await request.get(`${BASE}/api/og/level-up.png?${tokenParam}`);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toMatch(/image\/png/);
  expect(res.headers()['cache-control']).toMatch(/public,?\s*max-age=3600/);
  const buf = await res.body();
  // PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
  expect(buf[0]).toBe(0x89);
  expect(buf[1]).toBe(0x50); // 'P'
  expect(buf[2]).toBe(0x4e); // 'N'
  expect(buf[3]).toBe(0x47); // 'G'
});

test('invalid token returns 400 from OG image route', async ({ request }) => {
  const res = await request.get(`${BASE}/api/og/level-up.png?token=totally.fake.token`);
  expect(res.status()).toBe(400);
});

test('SSR share page emits og:image meta tag pointing to /api/og/level-up.png', async ({
  request,
}) => {
  const token = process.env.LEANSHOT_TEST_SHARE_TOKEN ?? 'sample';
  const res = await request.get(`${BASE}/share/level/${token}?v=1`);
  const html = await res.text();
  expect(html).toMatch(
    /<meta\s+property="og:image"\s+content="[^"]+\/api\/og\/level-up\.png/,
  );
  expect(html).toMatch(
    /<meta\s+name="twitter:card"\s+content="summary_large_image"/,
  );
});

test('SSR share page emits og:title meta tag', async ({ request }) => {
  const token = process.env.LEANSHOT_TEST_SHARE_TOKEN ?? 'sample';
  const res = await request.get(`${BASE}/share/level/${token}?v=1`);
  const html = await res.text();
  expect(html).toMatch(/<meta\s+property="og:title"\s+content="[^"]+"/);
});

test('SSR share page redirects to app.leanshot.app/?ref=share (human visitors)', async ({
  page,
}) => {
  const token = process.env.LEANSHOT_TEST_SHARE_TOKEN ?? 'sample';
  await page.goto(`${BASE}/share/level/${token}?v=1`);
  await page.waitForURL(/ref=share/, { timeout: 6000 });
  expect(page.url()).toMatch(/ref=share/);
});

test('invalid share token returns 410 Gone (SSR share page)', async ({ request }) => {
  const res = await request.get(`${BASE}/share/level/totally-fake-token?v=1`);
  expect(res.status()).toBe(410);
});

/**
 * Round-trip integration test (REVIEW-F-3 / mint-verify divergence canary).
 *
 * Requires LEANSHOT_TEST_SHARE_TOKEN to be set — a real token minted by
 * mint_share_token(5) RPC (Plan 35-10 seeds this).
 * Passes the token to /api/og/level-up.png and asserts 200 + image/png.
 * A 400 response here means Postgres base64url != Vercel base64url (F-3 regression).
 */
test('mint → verify round-trip: minted token returns 200 PNG from OG Function', async ({
  request,
}) => {
  const token = process.env.LEANSHOT_TEST_SHARE_TOKEN;
  if (!token) {
    test.skip();
    return;
  }
  const res = await request.get(
    `${BASE}/api/og/level-up.png?token=${encodeURIComponent(token)}&v=1`,
  );
  expect(res.status(), 'Expected 200 — if 400, check Postgres base64url vs Vercel base64url').toBe(
    200,
  );
  expect(res.headers()['content-type']).toMatch(/image\/png/);
});
