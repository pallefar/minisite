/**
 * Phase 42 Plan 42-10 Task 3 — e2e: Quarterly NPS modal fallback + email path.
 *
 * Validates POLISH-12 end-to-end against the live Supabase project. Five
 * scenarios per plan:
 *   1. Seed a test user with an unused quarterly_nps_nonces row > 30 days old
 *      AND no quarterly_nps_responses row for the current quarter → user
 *      logs in → modal appears.
 *   2. Submit 4 stars + "Great app" comment → modal closes → DB row exists
 *      with score=8, comment='Great app', responded_via='in-app'.
 *   3. Reload page → modal does NOT re-appear (already responded this quarter).
 *   4. Email signed-token path: GET /nps-quarterly-respond?score=9&token=<HMAC>
 *      returns 302 + quarterly_nps_responses row with score=9, responded_via='email'.
 *   5. Replay the same URL → 409 (single-use ledger enforces it).
 *
 * Gate:
 *   PLAYWRIGHT_RUN_P42_NPS=1 + live Supabase env (URL, anon, service-role).
 *   The QUARTERLY_NPS_SIGNING_KEY env var is ALSO required for scenarios 4-5
 *   (the HMAC signer reads it). Without it those two scenarios self-skip.
 *
 * Seeding pattern:
 *   - createUser via admin.auth.admin.createUser (email_confirm:true).
 *   - signInWithPassword to obtain an access_token.
 *   - page.addInitScript stuffs sb-leanshot-auth localStorage key BEFORE
 *     navigation, so supabase-js sees the session on INITIAL_SESSION (no
 *     evaluate+reload race) per [[reference_playwright_state_seeding]].
 *
 * Per-file slug prefix per [[feedback_rls_per_file_slug_prefix]]:
 *   `nps-fallback-${Date.now().toString(36)}-`
 */
import { createHmac } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Mirror of supabase/functions/_shared/nps-token.ts signQuarterlyNpsToken to
// avoid cross-runtime import pain in Playwright. The wire format is locked
// (`<payload-b64url>.<hmac-b64url>` with HMAC-SHA256 over the payload-b64url).
function toBase64Url(bytes: Buffer): string {
  return bytes.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function mintSignedToken(
  payload: { user_id: string; quarter: string; score: number; nonce: string },
  signingKey: string,
): string {
  const json = JSON.stringify(payload);
  const payloadEncoded = toBase64Url(Buffer.from(json, 'utf8'));
  const macBytes = createHmac('sha256', signingKey).update(payloadEncoded).digest();
  return `${payloadEncoded}.${toBase64Url(macBytes)}`;
}

const PLAYWRIGHT_RUN = process.env.PLAYWRIGHT_RUN_P42_NPS === '1';
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SIGNING_KEY = process.env.QUARTERLY_NPS_SIGNING_KEY;
const HAS_LIVE = Boolean(SUPABASE_URL && ANON_KEY && SERVICE_ROLE);
const HAS_SIGNING = Boolean(SIGNING_KEY);

const SLUG = `nps-fallback-${Date.now().toString(36)}-`;

function getAdmin(): SupabaseClient {
  return createClient(SUPABASE_URL!, SERVICE_ROLE!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function currentQuarter(d: Date = new Date()): string {
  const y = d.getUTCFullYear();
  const q = Math.floor(d.getUTCMonth() / 3) + 1;
  return `${y}-Q${q}`;
}

async function createSeedUser(
  admin: SupabaseClient,
): Promise<{ userId: string; email: string; accessToken: string }> {
  const email = `${SLUG}user-${Math.random().toString(36).slice(2, 8)}@leanshot.test`;
  const password = `Pass-${crypto.randomUUID().slice(0, 12)}`;
  const { data: user, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !user.user) throw new Error(`createUser failed: ${error?.message}`);
  const userId = user.user.id;

  const anon = createClient(SUPABASE_URL!, ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: session, error: signinErr } = await anon.auth.signInWithPassword({
    email,
    password,
  });
  if (signinErr || !session.session) {
    throw new Error(`signIn failed: ${signinErr?.message}`);
  }
  return { userId, email, accessToken: session.session.access_token };
}

async function seedAuthSession(
  page: Page,
  accessToken: string,
  userId: string,
): Promise<void> {
  await page.addInitScript(
    ({ key, tokenData }: { key: string; tokenData: string }) => {
      localStorage.setItem(key, tokenData);
    },
    {
      key: 'sb-leanshot-auth',
      tokenData: JSON.stringify({
        access_token: accessToken,
        refresh_token: 'placeholder',
        token_type: 'bearer',
        expires_in: 3600,
        user: { id: userId },
      }),
    },
  );
}

async function seedAgedNonce(
  admin: SupabaseClient,
  userId: string,
  quarter: string,
): Promise<string> {
  const nonce = crypto.randomUUID();
  // 31 days ago to clear the 30-day window in is_user_eligible_for_quarterly_nps.
  const createdAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
  const { error } = await admin.from('quarterly_nps_nonces').insert({
    nonce,
    user_id: userId,
    quarter,
    created_at: createdAt,
  });
  if (error) throw new Error(`seedAgedNonce failed: ${error.message}`);
  return nonce;
}

test.describe('@phase42 Quarterly NPS — in-app modal fallback + email signed-token', () => {
  test.skip(
    !HAS_LIVE || !PLAYWRIGHT_RUN,
    'Requires PLAYWRIGHT_RUN_P42_NPS=1 + live Supabase env (URL, anon, service role)',
  );

  let admin: SupabaseClient;
  const createdUserIds: string[] = [];
  const quarter = currentQuarter();

  test.beforeAll(() => {
    admin = getAdmin();
  });

  test.afterAll(async () => {
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id).catch(() => {
        /* best-effort cleanup */
      });
    }
  });

  test('S1+S2+S3: in-app modal appears → submit → row written → reload no re-prompt', async ({
    page,
  }) => {
    const { userId, accessToken } = await createSeedUser(admin);
    createdUserIds.push(userId);

    // Seed an aged nonce so eligibility resolves true.
    await seedAgedNonce(admin, userId, quarter);
    await seedAuthSession(page, accessToken, userId);

    // (1) Modal appears on dashboard load.
    await page.goto('/#/');
    await page.waitForLoadState('networkidle');
    const dialog = page.getByRole('dialog', { name: /Quick quarterly check-in/i });
    await expect(dialog).toBeVisible({ timeout: 15_000 });

    // (2) Click 4 stars + type comment + submit.
    await dialog.getByRole('button', { name: 'Rate 4 stars' }).click();
    await dialog.getByPlaceholder(/Optional/i).fill('Great app');
    await dialog.getByRole('button', { name: /Submit feedback/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 10_000 });

    // (2 verify) DB row exists with score=8 (4 stars * 2), responded_via='in-app'.
    const { data: response } = await admin
      .from('quarterly_nps_responses')
      .select('user_id, quarter, score, comment, responded_via, skipped')
      .eq('user_id', userId)
      .eq('quarter', quarter)
      .maybeSingle();
    expect(response).toBeTruthy();
    expect(response?.score).toBe(8);
    expect(response?.comment).toBe('Great app');
    expect(response?.responded_via).toBe('in-app');
    expect(response?.skipped).toBe(false);

    // (3) Reload — modal must NOT re-appear (already responded).
    await page.reload();
    await page.waitForLoadState('networkidle');
    // Wait a beat then assert the dialog never opens.
    await page.waitForTimeout(2_000);
    await expect(page.getByRole('dialog', { name: /Quick quarterly check-in/i })).not.toBeVisible();
  });

  test('S4+S5: email signed-token path → 302 + row written → replay returns 409', async ({
    request,
  }) => {
    test.skip(!HAS_SIGNING, 'Requires QUARTERLY_NPS_SIGNING_KEY env var to mint test tokens.');

    const { userId } = await createSeedUser(admin);
    createdUserIds.push(userId);

    // Seed a fresh unused nonce (any age — the email path doesn't care about 30d).
    const nonce = crypto.randomUUID();
    await admin.from('quarterly_nps_nonces').insert({
      nonce,
      user_id: userId,
      quarter,
      created_at: new Date().toISOString(),
    });

    // Mint a signed token for score=9.
    const token = mintSignedToken(
      { user_id: userId, quarter, score: 9, nonce },
      SIGNING_KEY!,
    );

    const endpoint = `${SUPABASE_URL}/functions/v1/nps-quarterly-respond?score=9&token=${encodeURIComponent(token)}`;

    // (4) First GET → 302 (redirect to follow-up landing).
    const first = await request.get(endpoint, { maxRedirects: 0 });
    expect(first.status()).toBe(302);

    // Verify the row landed with responded_via='email'.
    const { data: row } = await admin
      .from('quarterly_nps_responses')
      .select('user_id, quarter, score, responded_via')
      .eq('user_id', userId)
      .eq('quarter', quarter)
      .maybeSingle();
    expect(row?.score).toBe(9);
    expect(row?.responded_via).toBe('email');

    // (5) Replay the same URL → 409 (nonce burned).
    const replay = await request.get(endpoint, { maxRedirects: 0 });
    expect(replay.status()).toBe(409);
  });
});
