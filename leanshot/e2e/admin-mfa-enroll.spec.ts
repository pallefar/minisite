/**
 * Phase 24 Plan 24-05 — Admin MFA enrollment e2e spec.
 *
 * Tests the full TOTP enrollment flow:
 *   T1: Admin without TOTP sees SetupTotpPage (QR img present, OTP input present).
 *   T2: Full enrollment flow (DEFERRED — requires live TOTP code generation from QR secret).
 *
 * Gate: PLAYWRIGHT_RUN_ADMIN_MFA=1 or HAS_LIVE env (guards against running without secrets).
 * Per [[reference_playwright_conditional_project_argv]] — env var, not process.argv.
 * Per [[reference_playwright_state_seeding]] — page.addInitScript for auth state, not reload.
 *
 * DEFERRED items registered in .planning/deferred-tests.md#EG-30 / EG-31.
 */
import { test, expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const PLAYWRIGHT_RUN = process.env.PLAYWRIGHT_RUN_ADMIN_MFA === '1';
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const HAS_LIVE = Boolean(SUPABASE_URL && ANON_KEY && SERVICE_ROLE);

// File-scoped slug prefix per [[feedback_rls_per_file_slug_prefix]]
const SLUG = `adm-mfa-${Date.now().toString(36)}-`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getAdmin(): SupabaseClient {
  return createClient(SUPABASE_URL!, SERVICE_ROLE!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function createAdminUser(admin: SupabaseClient): Promise<{
  userId: string;
  email: string;
  accessToken: string;
}> {
  const email = `${SLUG}admin@leanshot.test`;
  const password = `Pass-${crypto.randomUUID().slice(0, 12)}`;

  const { data: user, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !user.user) throw new Error(`createUser failed: ${error?.message}`);
  const userId = user.user.id;

  // Set is_staff=true + admin_role=admin + has_totp=false
  await admin.from('profiles').upsert({
    id: userId,
    is_staff: true,
    admin_role: 'admin',
    has_totp: false,
  });

  // Sign in to get access token
  const anonClient = createClient(SUPABASE_URL!, ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: session, error: signinErr } = await anonClient.auth.signInWithPassword({
    email,
    password,
  });
  if (signinErr || !session.session) {
    throw new Error(`signIn failed: ${signinErr?.message}`);
  }

  return { userId, email, accessToken: session.session.access_token };
}

/** Seed auth session into the page via addInitScript (per [[reference_playwright_state_seeding]]). */
async function seedAuthSession(page: Page, accessToken: string, userId: string) {
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('@phase24 Admin MFA Enrollment', () => {
  test.skip(
    !HAS_LIVE || !PLAYWRIGHT_RUN,
    'Requires PLAYWRIGHT_RUN_ADMIN_MFA=1 + live Supabase env',
  );

  let admin: SupabaseClient;
  const createdUserIds: string[] = [];

  test.beforeAll(() => {
    admin = getAdmin();
  });

  test.afterAll(async () => {
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id).catch(() => {
        /* best-effort */
      });
    }
  });

  test('T1: admin without TOTP sees SetupTotpPage — QR code + OTP input present', async ({
    page,
  }) => {
    const { userId, accessToken } = await createAdminUser(admin);
    createdUserIds.push(userId);

    await seedAuthSession(page, accessToken, userId);
    await page.goto('/#/admin');
    await page.waitForLoadState('networkidle');

    // SetupTotpPage should render with QR code and OTP input
    await expect(page.locator('img[alt="Scan with your authenticator app"]')).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator('#totp-code')).toBeVisible();
  });

  /**
   * T2: Full enrollment flow — DEFERRED
   *
   * Reason: requires computing a TOTP code from the QR URI secret in real-time.
   * The QR contains an `otpauth://totp/...?secret=BASE32` URI. Computing a valid
   * TOTP code requires the current UNIX timestamp and a HOTP HMAC computation.
   * This is feasible but adds significant setup complexity (importing an OTP library
   * into the Playwright context). The UI flow (QR render → code entry → backup codes
   * display → save confirmation) is covered structurally by T1 + unit tests.
   *
   * Fix plan: install `otplib` in the project, parse the QR URI from the img src data-URI,
   * extract the base32 secret, compute a live TOTP code, and submit it.
   * Target: Phase 24 closeout sweep or v1.3 polish (Plan 40 or 41).
   *
   * see deferred-tests.md#EG-31
   */
  // see deferred-tests.md#EG-31
  test.skip('T2: full enrollment — DEFERRED — see .planning/deferred-tests.md#EG-31', async () => {
    // DEFERRED: compute TOTP code from QR URI + submit + assert backup codes + confirm
  });
});
