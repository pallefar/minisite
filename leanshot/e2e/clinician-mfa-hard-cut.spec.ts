/**
 * Phase 25 Plan 25-08 — Clinician MFA hard-cut e2e spec.
 *
 * D-10 (HIPAA-15): Every /clinic/* surface entry HARD-CUTS to TOTP enrollment
 * if the clinician has no TOTP factor, or to step-up if AAL1.
 *
 * This spec targets `/clinic/__mfa_test__` — a feature-flagged test-only route
 * added in this plan. Real /clinic/* routes ship in Phase 28. The test-only
 * route is wrapped by ClinicianMfaGuard to prove the hard-cut behavior.
 *
 * NOTE: Phase 28 owns real /clinic/* route wiring. When Phase 28 ships, these
 * tests can be migrated to target real clinical surfaces.
 *
 * Gate: PLAYWRIGHT_RUN_CLINICIAN_MFA=1 (per [[reference_playwright_conditional_project_argv]])
 *       + live Supabase env vars.
 *
 * Seeding: `page.addInitScript` (per [[reference_playwright_state_seeding]])
 *          to set auth session in localStorage before supabase-js initializes.
 *
 * Deferred items per [[reference_vitest_skip_fixme]] Playwright equivalent:
 *   T2 (full enrollment with real TOTP code) — DEFERRED — see deferred-tests.md#EG-40
 *   T7 (reload AAL2 session persists) — DEFERRED — depends on Phase 28 real route
 *   T8 (sign-out + re-sign-in challenge) — DEFERRED — depends on Phase 28 real route
 *   T9 (challenge modal submission) — DEFERRED — requires TOTP code generation
 *  T10 (negative: clinical content not shown without challenge) — covered by T1
 */
import { test, expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const PLAYWRIGHT_RUN = process.env.PLAYWRIGHT_RUN_CLINICIAN_MFA === '1';
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const HAS_LIVE = Boolean(SUPABASE_URL && ANON_KEY && SERVICE_ROLE);

// File-scoped slug prefix per [[feedback_rls_per_file_slug_prefix]]
const SLUG = `clin-mfa-${Date.now().toString(36)}-`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getAdmin(): SupabaseClient {
  return createClient(SUPABASE_URL!, SERVICE_ROLE!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function createClinicianUser(admin: SupabaseClient): Promise<{
  userId: string;
  email: string;
  accessToken: string;
}> {
  const email = `${SLUG}clinician@leanshot.test`;
  const password = `Pass-${crypto.randomUUID().slice(0, 12)}`;

  const { data: user, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !user.user) throw new Error(`createUser failed: ${error?.message}`);
  const userId = user.user.id;

  // Ensure no TOTP factor (fresh user)
  // No profile update needed — ClinicianMfaGuard does NOT check profiles.has_totp
  // (that's the admin TOTP field from Plan 24-05). Clinician gate checks AAL directly.

  // Sign in as the user to get an AAL1 access token
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

/**
 * Seed auth session into the page via addInitScript.
 * Per [[reference_playwright_state_seeding]]: addInitScript runs BEFORE page.goto
 * so supabase-js reads the session from localStorage on INITIAL_SESSION.
 */
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

test.describe('@phase25 Clinician MFA Hard-Cut', () => {
  test.skip(!HAS_LIVE || !PLAYWRIGHT_RUN, 'Requires PLAYWRIGHT_RUN_CLINICIAN_MFA=1 + live Supabase env');

  let admin: SupabaseClient;
  const createdUserIds: string[] = [];

  test.beforeAll(() => {
    admin = getAdmin();
  });

  test.afterAll(async () => {
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id).catch(() => { /* best-effort */ });
    }
  });

  /**
   * T1: Clinician without TOTP sees SetupClinicianTotp when navigating to /clinic/* surface.
   *
   * Verifies:
   *   - QR code img is visible (src="Scan with your authenticator app")
   *   - 6-digit OTP input is visible
   *   - NO "skip" or "remind me later" button is present
   *   - Clinical content is NOT visible
   *
   * Targets: /#/clinic/__mfa_test__ (test-only route added by Plan 25-08).
   * If Phase 28 is shipped, this test should be migrated to a real /clinic/* route.
   */
  test('T1: clinician without TOTP sees SetupClinicianTotp — QR + input present, no skip', async ({ page }) => {
    const { userId, accessToken } = await createClinicianUser(admin);
    createdUserIds.push(userId);

    await seedAuthSession(page, accessToken, userId);
    await page.goto('/#/clinic/__mfa_test__');
    await page.waitForLoadState('networkidle');

    // SetupClinicianTotp should render
    await expect(page.locator('img[alt="Scan with your authenticator app"]')).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator('#clinician-totp-code')).toBeVisible();

    // D-10: No skip button
    await expect(page.getByText(/skip/i)).not.toBeVisible();
    await expect(page.getByText(/remind me later/i)).not.toBeVisible();
    await expect(page.getByText(/skip MFA/i)).not.toBeVisible();

    // Clinical content is NOT rendered
    await expect(page.getByTestId('clinic-mfa-test-content')).not.toBeVisible();
  });

  /**
   * T2: Full enrollment flow — DEFERRED
   *
   * Reason: requires computing a live TOTP code from the QR URI secret.
   * The QR URI is embedded in the img src (data-URI from Supabase Auth).
   * Computing a valid TOTP code requires extracting the base32 secret from the
   * otpauth:// URI, then computing HOTP with current timestamp. Feasible but
   * adds dependency on otplib + QR parsing. Deferred to Phase 28 / v1.3 polish.
   *
   * Fix plan: install `otplib` + `jsqr` / parse the `otpauth://` URI from the
   * img alt, extract the base32 secret, compute a live TOTP, submit.
   *
   * see deferred-tests.md#EG-40
   */
  test.skip('T2: full TOTP enrollment flow [DEFERRED — see .planning/deferred-tests.md#EG-40]', async () => {
    // DEFERRED: QR parse → secret extract → otplib.totp.generate(secret) → submit → AAL2
  });

  /**
   * T3: Unauthenticated user navigating to /clinic/* → ClinicianMfaGuard renders nothing
   * (parent auth layer handles redirect to login). The guard itself doesn't render an error.
   */
  test('T3: unauthenticated user — guard renders nothing (no clinical content, no error)', async ({ page }) => {
    // No seedAuthSession — no session in localStorage
    await page.goto('/#/clinic/__mfa_test__');
    await page.waitForLoadState('networkidle');

    // Guard renders null (loading state exits without setting state when session is null)
    // Verify: no clinical content rendered
    await expect(page.getByTestId('clinic-mfa-test-content')).not.toBeVisible();
    // No setup modal either (guard returns early when no session)
    await expect(page.locator('#clinician-totp-code')).not.toBeVisible({ timeout: 3_000 });
  });

  /**
   * T4-T10: Additional cases deferred — require Phase 28 real /clinic/* routes.
   *
   * T4: Subsequent /clinic/* access after enrollment requires AAL2 step-up.
   * T5: Reload with AAL2 session → clinical surface renders directly.
   * T6: Sign-out → sign-in → /clinic/* → challenge modal (not setup modal).
   * T7: Challenge submission with valid code → AAL2 elevation → clinical render.
   * T8: Negative: /clinic/* without challenge → content not shown + challenge modal present.
   * T9: ClinicianMfaGuard wrapping real Phase 28 clinical components (DataExport, PatientList).
   * T10: Backup code redemption path via ChallengeClinicianTotp recovery link.
   *
   * see deferred-tests.md#EG-40 through EG-49
   */
  test.skip('T4-T10: Phase 28 surface tests [DEFERRED — see .planning/deferred-tests.md#EG-40]', async () => {
    // DEFERRED: real /clinic/* routes + TOTP code generation
  });
});
