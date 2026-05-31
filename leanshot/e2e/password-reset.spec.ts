/**
 * @phase05 SC#2 password reset: request → admin generates recovery link → click →
 *          set-new-password form → submit → sign in with NEW password works,
 *          OLD password rejected.
 *
 * Plan 05-02 Task 6.
 */
import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';

const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const HAS_LIVE_AUTH = Boolean(SERVICE_ROLE && SUPABASE_URL && ANON_KEY);

test.describe('@phase05 SC#2: password reset', () => {
  test.skip(!HAS_LIVE_AUTH, 'requires SUPABASE_SERVICE_ROLE_KEY + VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY');
  test.setTimeout(60_000);

  const email = `pwreset-${Date.now()}@leanshot.test`;
  const oldPwd = `OldPass1-${Date.now()}`;
  const newPwd = `NewPass2-${Date.now()}`;
  let userId: string | undefined;

  test.afterAll(async () => {
    if (!userId || !SERVICE_ROLE || !SUPABASE_URL) return;
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
    await admin.auth.admin.deleteUser(userId).catch(() => {});
  });

  test('reset flow: new password works, old password rejected', async ({ page }) => {
    const admin = createClient(SUPABASE_URL!, SERVICE_ROLE!, { auth: { persistSession: false } });

    // Seed a verified user with the OLD password.
    const createRes = await admin.auth.admin.createUser({
      email,
      password: oldPwd,
      email_confirm: true,
    });
    expect(createRes.error).toBeNull();
    userId = createRes.data?.user?.id;
    expect(userId).toBeDefined();

    // Request a recovery link.
    const baseOrigin = (await page.goto('/')).url().split('#')[0];
    const linkRes = await admin.auth.admin.generateLink({
      type: 'recovery',
      email,
      options: { redirectTo: `${baseOrigin}#/auth/set-new-password` },
    });
    expect(linkRes.error).toBeNull();
    const recoveryLink = linkRes.data?.properties?.action_link;
    expect(recoveryLink).toBeDefined();

    await page.goto(recoveryLink!);

    // Supabase's PASSWORD_RECOVERY event should route the app to #/auth/set-new-password.
    await expect(page).toHaveURL(/#\/auth\/set-new-password/, { timeout: 8000 });

    await page.getByLabel(/new password/i).fill(newPwd);
    await page.getByLabel(/confirm password/i).fill(newPwd);
    await page.getByRole('button', { name: /update password/i }).click();

    // Either lands on signin (form redirects) or signs in directly — both acceptable.
    await expect(page).toHaveURL(/#\/auth\/signin|^http(s)?:\/\/[^#]+\/?$/, {
      timeout: 8000,
    });

    // Sign in fresh with the NEW password.
    await page.goto('/#/auth/signin');
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(newPwd);
    await page.locator('form').getByRole('button', { name: /^sign in$/i }).click();
    await expect(page).not.toHaveURL(/#\/auth/, { timeout: 8000 });

    // Sign out + try OLD password → must fail.
    await page.evaluate(() => {
      try {
        localStorage.removeItem('sb-leanshot-auth');
      } catch {
        /* noop */
      }
    });
    await page.goto('/#/auth/signin');
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(oldPwd);
    await page.locator('form').getByRole('button', { name: /^sign in$/i }).click();
    // Inline error must surface.
    await expect(page.getByText(/invalid email or password/i)).toBeVisible({ timeout: 5000 });
  });
});
