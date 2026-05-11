/**
 * @phase05 SC#1 first leg: signup → admin generates verify link → click →
 *          land on verify-landing → DELEG-1 routes to signin-with-prefill →
 *          set password → land on dashboard. + session persists across reload.
 *
 * Skip-gates on `SUPABASE_SERVICE_ROLE_KEY` (same pattern as e2e/rls-*.test.ts).
 * The admin client uses `auth.admin.generateLink` to short-circuit the actual
 * email send — production behavior is identical from the SPA's perspective.
 *
 * Plan 05-02 Task 6 — RESEARCH §"Common Operation 3" / §11.
 */
import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';

const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const HAS_LIVE_AUTH = Boolean(SERVICE_ROLE && SUPABASE_URL && ANON_KEY);

test.describe('@phase05 SC#1: signup → verify → signin', () => {
  test.skip(!HAS_LIVE_AUTH, 'requires SUPABASE_SERVICE_ROLE_KEY + VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY');
  test.setTimeout(60_000);

  const email = `pw-${Date.now()}@leanshot.test`;
  const password = `Pass1234-${Date.now()}`;
  let userId: string | undefined;

  test.afterAll(async () => {
    if (!userId || !SERVICE_ROLE || !SUPABASE_URL) return;
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
    await admin.auth.admin.deleteUser(userId).catch(() => {
      // best-effort cleanup
    });
  });

  test('signs up, verifies via admin-generated link, sets password, lands on dashboard', async ({
    page,
  }) => {
    const admin = createClient(SUPABASE_URL!, SERVICE_ROLE!, { auth: { persistSession: false } });

    await page.goto('/#/auth/signup');
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole('button', { name: /create account/i }).click();

    // Should land on PostSignupSent (#/auth/verify-sent).
    await expect(page).toHaveURL(/#\/auth\/verify-sent/);

    // Admin generates the verify link in lieu of the user clicking the email.
    const baseOrigin = page.url().split('#')[0];
    const { data, error } = await admin.auth.admin.generateLink({
      type: 'signup',
      email,
      password,
      options: { redirectTo: `${baseOrigin}#/auth/verify` },
    });
    expect(error).toBeNull();
    userId = data?.user?.id;
    expect(userId).toBeDefined();

    const actionLink = data?.properties?.action_link;
    expect(actionLink).toBeDefined();
    await page.goto(actionLink!);

    // After DELEG-1 redirect, we should be on signin-with-prefill within 5s.
    await expect(page).toHaveURL(/#\/auth\/signin/, { timeout: 8000 });
    await expect(page.getByLabel(/email/i)).toHaveValue(email);

    // Enter password to complete promote.
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole('button', { name: /set password/i }).click();

    // Should land on dashboard (heading or known testid).
    // Onboarding may also intervene; assert we left the auth view.
    await expect(page).not.toHaveURL(/#\/auth/, { timeout: 5000 });
  });

  test('session persists across browser reload (AUTH-03)', async ({ page }) => {
    // Bootstrap a verified session via admin.
    const admin = createClient(SUPABASE_URL!, SERVICE_ROLE!, { auth: { persistSession: false } });
    const reloadEmail = `reload-${Date.now()}@leanshot.test`;
    const reloadPwd = `Pass1234-${Date.now()}`;
    const createRes = await admin.auth.admin.createUser({
      email: reloadEmail,
      password: reloadPwd,
      email_confirm: true,
    });
    expect(createRes.error).toBeNull();
    const createdId = createRes.data?.user?.id;

    try {
      await page.goto('/#/auth/signin');
      await page.getByLabel(/email/i).fill(reloadEmail);
      await page.getByLabel(/password/i).fill(reloadPwd);
      await page.getByRole('button', { name: /^sign in$/i }).click();
      // Leave auth view after successful sign-in.
      await expect(page).not.toHaveURL(/#\/auth/, { timeout: 8000 });

      // Reload — supabase-js's sb-leanshot-auth localStorage entry must keep us signed in.
      await page.reload();
      await expect(page).not.toHaveURL(/#\/auth/, { timeout: 5000 });
      const lsLen = await page.evaluate(() => {
        try {
          const raw = localStorage.getItem('sb-leanshot-auth');
          return raw ? raw.length : 0;
        } catch {
          return 0;
        }
      });
      expect(lsLen).toBeGreaterThan(50);
    } finally {
      if (createdId) await admin.auth.admin.deleteUser(createdId).catch(() => {});
    }
  });
});
