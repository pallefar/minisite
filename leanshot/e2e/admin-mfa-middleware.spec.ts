/**
 * Phase 24 Plan 24-05 — Admin MFA middleware redirect e2e spec.
 *
 * Tests the AdminLayout Pattern S1 client gate (D-06 + D-09):
 *   T1: Admin WITHOUT has_totp=true → redirected to SetupTotpPage on any /admin/* path.
 *   T2: Admin WITH has_totp=true BUT aal=aal1 (no step-up) → StepUpTotpPage rendered.
 *
 * Gate: PLAYWRIGHT_RUN_ADMIN_MFA=1 or HAS_LIVE env.
 * Per [[reference_playwright_conditional_project_argv]] — env var, not process.argv.
 * Per [[reference_playwright_state_seeding]] — page.addInitScript for auth state.
 *
 * NOTE: LeanShot is a hash-routing SPA with no Vercel Routing Middleware.
 * "Middleware" enforcement is the AdminLayout React component.
 * The "redirect" is a component-level conditional render, not a URL navigation.
 * Per plan: we assert that the COMPONENT renders (QR img for setup,
 * "Verify your identity" heading for step-up) — not URL navigation.
 *
 * EG-30 registered in .planning/deferred-tests.md.
 */
import { test, expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const PLAYWRIGHT_RUN = process.env.PLAYWRIGHT_RUN_ADMIN_MFA === '1';
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const HAS_LIVE = Boolean(SUPABASE_URL && ANON_KEY && SERVICE_ROLE);

// File-scoped slug prefix per [[feedback_rls_per_file_slug_prefix]]
const SLUG = `adm-mw-${Date.now().toString(36)}-`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getAdmin(): SupabaseClient {
  return createClient(SUPABASE_URL!, SERVICE_ROLE!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Build a fake JWT with a specific aal claim (NOT cryptographically signed — UI-check only). */
function fakeJwt(userId: string, aal: 'aal1' | 'aal2'): string {
  const payload = {
    sub: userId,
    aal,
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
  const b64 = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  return `eyJhbGciOiJub25lIn0.${b64}.unsigned`;
}

async function createStaffUserWithTotp(
  admin: SupabaseClient,
  hasTotp: boolean,
): Promise<{ userId: string; email: string; password: string }> {
  const email = `${SLUG}mw-${hasTotp ? 'totp' : 'nototp'}@leanshot.test`;
  const password = `Pass-${crypto.randomUUID().slice(0, 12)}`;

  const { data: user, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !user.user) throw new Error(`createUser failed: ${error?.message}`);
  const userId = user.user.id;

  await admin.from('profiles').upsert({
    id: userId,
    is_staff: true,
    admin_role: 'admin',
    has_totp: hasTotp,
  });

  return { userId, email, password };
}

/** Seed auth session with a specific aal claim via addInitScript. */
async function seedAuthSession(
  page: Page,
  userId: string,
  aal: 'aal1' | 'aal2',
) {
  const token = fakeJwt(userId, aal);
  await page.addInitScript(
    ({ key, tokenData }: { key: string; tokenData: string }) => {
      localStorage.setItem(key, tokenData);
    },
    {
      key: 'sb-leanshot-auth',
      tokenData: JSON.stringify({
        access_token: token,
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

test.describe('@phase24 Admin MFA Middleware Gate', () => {
  test.skip(!HAS_LIVE || !PLAYWRIGHT_RUN, 'Requires PLAYWRIGHT_RUN_ADMIN_MFA=1 + live Supabase env');

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

  test('T1: admin without has_totp=true → SetupTotpPage rendered on /admin', async ({ page }) => {
    const { userId } = await createStaffUserWithTotp(admin, /* hasTotp= */ false);
    createdUserIds.push(userId);

    // Seed aal1 session (has_totp=false → SetupTotpPage regardless of aal)
    await seedAuthSession(page, userId, 'aal1');
    await page.goto('/#/admin');
    await page.waitForLoadState('networkidle');

    // AdminLayout should render SetupTotpPage (QR img present)
    // D-06: no grace window — SetupTotpPage shown immediately
    await expect(
      page.locator('img[alt="Scan with your authenticator app"]'),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('T2: admin WITH has_totp=true + aal=aal1 → StepUpTotpPage rendered on /admin', async ({ page }) => {
    const { userId } = await createStaffUserWithTotp(admin, /* hasTotp= */ true);
    createdUserIds.push(userId);

    // Seed aal1 session (has_totp=true but aal not yet upgraded → StepUpTotpPage)
    await seedAuthSession(page, userId, 'aal1');
    await page.goto('/#/admin');
    await page.waitForLoadState('networkidle');

    // AdminLayout should render StepUpTotpPage
    // D-09: aal2 required for every admin session
    await expect(page.getByText('Verify your identity')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#step-up-code')).toBeVisible();
  });
});
