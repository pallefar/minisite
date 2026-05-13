/**
 * Phase 8 SHARE-03 SC#3 — 4-failure-mode revocation drill.
 *
 * Plan 08-05 Task 2 — replaces the Wave-0 scaffold with the live drill.
 *
 * The drill is the load-bearing security proof for Phase 8: without all 4
 * failure modes blocked, no Phase 8 plan can claim "done". Each test drives
 * the real deployed Plan 08-02 Edge Function against the real DB; together
 * they prove:
 *
 *   (a) Token cache    — patient revokes → doctor's open tab returns 401
 *                        within 10s (HI-4: 5s poll interval + 5s buffer).
 *                        The DB-row check (NOT JWT TTL) is what flips it.
 *   (b) HTTP cache     — every /share/* response carries
 *                        `Cache-Control: private, no-store` (200, 401, 410).
 *   (c) JWT TTL        — there is NO JWT for the recipient. Revocation
 *                        latency is bounded by next-poll, not token expiry.
 *                        Cookie value is opaque (<200 chars, no eyJ prefix).
 *   (d) Forwarded link — opening the same URL in a SECOND browser context
 *                        fails: no cookie + code already consumed → the UI
 *                        shows "This code has already been used".
 *
 * Plus 2 fold-in behaviors:
 *   (e) audit row written on view (SHARE-05) — assertAuditRowCount === 1
 *   (f) cookie attributes (SHARE-06)         — HttpOnly + Secure + SameSite=Strict
 *                                              + Path=/ + Max-Age present
 *
 * Skip-gates on SUPABASE_SERVICE_ROLE_KEY + SUPABASE_URL + SUPABASE_ANON_KEY
 * (same pattern as Plan 05's auth specs). CI sets these from repo secrets
 * and gates merge.
 *
 * HI-6: test.afterAll(cleanupTestShares) leaves zero orphan share rows so
 * concurrent CI runs do not collide.
 */

import { expect, test, type APIResponse } from '@playwright/test';

import {
  assertAuditRowCount,
  cleanupTestShares,
  createTestShare,
  hasLiveSupabase,
  impersonateAsRecipient,
  revokeTestShare,
} from './fixtures/shares';

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
const FN_BASE = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1` : '';

// Match cors.ts allow-list. localhost:5173 is the SPA dev origin and is
// always allowed (see supabase/functions/share/cors.ts).
const SHARE_ORIGIN = 'http://localhost:5173';

function extractRecipientCookie(setCookie: string | undefined): string {
  if (!setCookie) throw new Error('Set-Cookie header missing on /redeem 200');
  const match = setCookie.match(/recipient_session=[^;]+/);
  if (!match) throw new Error(`recipient_session not found in Set-Cookie: ${setCookie}`);
  return match[0];
}

function getCacheControl(resp: APIResponse): string | undefined {
  const headers = resp.headers();
  return headers['cache-control'];
}

test.describe('@phase08 SHARE-03 SC#3 — 4-failure-mode revocation drill', () => {
  test.skip(
    !hasLiveSupabase(),
    'requires SUPABASE_SERVICE_ROLE_KEY + SUPABASE_URL + SUPABASE_ANON_KEY',
  );
  // Drill iterations can take up to ~30s each (revoke + 10s poll + buffer);
  // bump per-test timeout above the default 30_000.
  test.setTimeout(90_000);

  test.afterAll(async () => {
    // HI-6 — admin-DELETE every share row created during the run.
    await cleanupTestShares();
  });

  // ────────────────────────────────────────────────────────────────────────
  // (a) Token cache / DB-row check — revoke beats poll within 10s (HI-4)
  // ────────────────────────────────────────────────────────────────────────
  test('(a) token cache — revoke beats doctor poll within 10s (HI-4)', async ({ browser }) => {
    const share = await createTestShare({
      patientEmail: 'alice@test.com',
      label: 'drill-a',
      expiresInHours: 24,
    });
    const ctx = await browser.newContext();
    // Skip the code-entry UI by redeeming programmatically and injecting
    // the recipient cookie. The drill targets the post-redeem polling path,
    // not the code entry; that surface is covered by share-happy-path.spec.ts.
    await impersonateAsRecipient(ctx, share.raw_token, share.raw_code);
    const page = await ctx.newPage();
    await page.goto(`/#/share/${share.raw_token}`);
    await expect(page.getByRole('heading', { name: /LeanShot record/ })).toBeVisible({
      timeout: 15_000,
    });

    // Patient revokes the share. The Edge Function's per-request DB check
    // (handleSnapshot step 3) returns 401 'revoked' on the next poll.
    await revokeTestShare(share.share_id);

    // HI-4 — within 10s the SharePage poll picks up the 401 and flips to
    // ShareRevokedScreen kind='revoked' (heading: "This share has been revoked").
    await expect(
      page.getByRole('heading', { name: 'This share has been revoked' }),
    ).toBeVisible({ timeout: 10_000 });

    await ctx.close();
  });

  // ────────────────────────────────────────────────────────────────────────
  // (b) HTTP cache — Cache-Control: private, no-store on 200 + 401 + 410
  // ────────────────────────────────────────────────────────────────────────
  test('(b) HTTP cache — Cache-Control: private, no-store on 200, 401, 410', async ({
    request,
  }) => {
    const share = await createTestShare({
      patientEmail: 'alice@test.com',
      label: 'drill-b',
      expiresInHours: 1,
    });

    // 200 path: first /redeem succeeds.
    const redeem1 = await request.post(`${FN_BASE}/share/redeem`, {
      headers: { Origin: SHARE_ORIGIN },
      data: { token: share.raw_token, code: share.raw_code },
    });
    expect(redeem1.status()).toBe(200);
    expect(getCacheControl(redeem1)).toBe('private, no-store');

    // 410 already-consumed path: second /redeem with the same code.
    const redeem2 = await request.post(`${FN_BASE}/share/redeem`, {
      headers: { Origin: SHARE_ORIGIN },
      data: { token: share.raw_token, code: share.raw_code },
    });
    expect(redeem2.status()).toBe(410);
    expect(getCacheControl(redeem2)).toBe('private, no-store');

    // 401 revoked path: revoke + /snapshot. handleSnapshot step 3 → 401.
    await revokeTestShare(share.share_id);
    const snap401 = await request.get(`${FN_BASE}/share/snapshot?token=${share.raw_token}`, {
      headers: { Origin: SHARE_ORIGIN },
    });
    expect(snap401.status()).toBe(401);
    expect(getCacheControl(snap401)).toBe('private, no-store');
  });

  // ────────────────────────────────────────────────────────────────────────
  // (c) JWT TTL — no JWT exists; revoke beats expires_at
  // ────────────────────────────────────────────────────────────────────────
  test('(c) JWT TTL — revoke beats expires_at; cookie is opaque, not a JWT', async ({
    request,
  }) => {
    const share = await createTestShare({
      patientEmail: 'alice@test.com',
      label: 'drill-c',
      expiresInHours: 24, // 24h window — far longer than the test runtime
    });

    // Redeem succeeds.
    const redeem = await request.post(`${FN_BASE}/share/redeem`, {
      headers: { Origin: SHARE_ORIGIN },
      data: { token: share.raw_token, code: share.raw_code },
    });
    expect(redeem.status()).toBe(200);
    const cookie = extractRecipientCookie(redeem.headers()['set-cookie']);

    // Snapshot succeeds before revoke.
    const snap1 = await request.get(`${FN_BASE}/share/snapshot?token=${share.raw_token}`, {
      headers: { Origin: SHARE_ORIGIN, Cookie: cookie },
    });
    expect(snap1.status()).toBe(200);

    // Revoke at T+0. expires_at is 24h out — token is NOT expired.
    await revokeTestShare(share.share_id);

    // Snapshot at T+~1s returns 401 'revoked'. The DB-row check fired,
    // NOT a JWT TTL check (which would be a no-op since expires_at is 24h
    // out and the wire artifact isn't even a JWT — see assertions below).
    const snap2 = await request.get(`${FN_BASE}/share/snapshot?token=${share.raw_token}`, {
      headers: { Origin: SHARE_ORIGIN, Cookie: cookie },
    });
    expect(snap2.status()).toBe(401);
    const body = await snap2.json();
    expect(body.error).toBe('revoked');

    // Confirm the wire cookie is OPAQUE — base64url 16 bytes ≈ 22 chars; not
    // a JWT (JWTs start with `eyJ` after base64url-encoding the {"alg":"..."}
    // header). The whole header line "recipient_session=<value>" stays well
    // under 200 chars including the cookie-attribute trailer.
    const cookieValue = cookie.replace(/^recipient_session=/, '');
    expect(cookieValue.length).toBeLessThan(64);
    expect(cookieValue).not.toMatch(/^eyJ/);
    expect(cookie).not.toMatch(/eyJ/);
  });

  // ────────────────────────────────────────────────────────────────────────
  // (d) Forwarded link — second context (same URL, no cookie) fails
  // ────────────────────────────────────────────────────────────────────────
  test('(d) forwarded link — second context with same URL cannot get past code entry', async ({
    browser,
  }) => {
    const share = await createTestShare({
      patientEmail: 'alice@test.com',
      label: 'drill-d',
      expiresInHours: 1,
    });

    // First context: attacker A redeems with the code. Cookie is set in ctx1.
    const ctx1 = await browser.newContext();
    await impersonateAsRecipient(ctx1, share.raw_token, share.raw_code);
    const page1 = await ctx1.newPage();
    await page1.goto(`/#/share/${share.raw_token}`);
    await expect(page1.getByRole('heading', { name: /LeanShot record/ })).toBeVisible({
      timeout: 15_000,
    });

    // Second context: attacker B opens the FORWARDED URL — fresh cookie jar,
    // no recipient_session. SharePage's initial /snapshot returns 401
    // 'requires-code' → state machine renders CodeEntryScreen.
    const ctx2 = await browser.newContext();
    const page2 = await ctx2.newPage();
    await page2.goto(`/#/share/${share.raw_token}`);
    await expect(page2.getByText('Enter the 6-digit code')).toBeVisible({ timeout: 15_000 });

    // Attacker B tries the same code — it's already been consumed by A.
    // /share/redeem returns 410 'already-consumed' → CodeEntryScreen displays
    // the FRIENDLY_ERRORS string for 'already-consumed'.
    await page2.getByLabel('6-digit access code').fill(share.raw_code);
    await expect(page2.getByText(/already been used/i)).toBeVisible({ timeout: 10_000 });

    await ctx1.close();
    await ctx2.close();
  });

  // ────────────────────────────────────────────────────────────────────────
  // (e) audit row written on view (SHARE-05 — fold-in)
  // ────────────────────────────────────────────────────────────────────────
  test('audit row written on /snapshot view (SHARE-05)', async ({ request }) => {
    const share = await createTestShare({
      patientEmail: 'alice@test.com',
      label: 'drill-audit',
      expiresInHours: 1,
    });
    const redeem = await request.post(`${FN_BASE}/share/redeem`, {
      headers: { Origin: SHARE_ORIGIN },
      data: { token: share.raw_token, code: share.raw_code },
    });
    expect(redeem.status()).toBe(200);
    const cookie = extractRecipientCookie(redeem.headers()['set-cookie']);

    const snap = await request.get(`${FN_BASE}/share/snapshot?token=${share.raw_token}`, {
      headers: { Origin: SHARE_ORIGIN, Cookie: cookie },
    });
    expect(snap.status()).toBe(200);

    // Let Postgres commit before we count.
    await new Promise((r) => setTimeout(r, 500));
    await assertAuditRowCount(share.share_id, 1);
  });

  // ────────────────────────────────────────────────────────────────────────
  // (f) cookie attributes (SHARE-06 — fold-in)
  // ────────────────────────────────────────────────────────────────────────
  test('cookie attributes — HttpOnly + Secure + SameSite=Strict + Path=/ + Max-Age', async ({
    request,
  }) => {
    const share = await createTestShare({
      patientEmail: 'alice@test.com',
      label: 'drill-cookie',
      expiresInHours: 1,
    });
    const redeem = await request.post(`${FN_BASE}/share/redeem`, {
      headers: { Origin: SHARE_ORIGIN },
      data: { token: share.raw_token, code: share.raw_code },
    });
    expect(redeem.status()).toBe(200);
    const setCookie = redeem.headers()['set-cookie'];
    expect(setCookie, 'missing Set-Cookie header').toBeTruthy();
    expect(setCookie!).toMatch(/HttpOnly/i);
    expect(setCookie!).toMatch(/Secure/i);
    expect(setCookie!).toMatch(/SameSite=Strict/i);
    expect(setCookie!).toMatch(/Path=\//);
    expect(setCookie!).toMatch(/Max-Age=/i);
  });
});
