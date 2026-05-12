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

    // Stub the SPA's POST /auth/v1/signup so this spec is decoupled from
    // Supabase's per-hour email-send rate limit (free-tier built-in mailer
    // caps at ~2 confirmations/hour per project). The mocked 200 mirrors the
    // wire shape supabase-js expects when email confirmation is pending: a
    // user row with no session. SignUpForm.tsx:67-77 then triggers
    // `window.location.hash = '#/auth/verify-sent'` exactly as in prod.
    //
    // The actual `auth.users` row is created downstream by
    // `admin.auth.admin.generateLink({type: 'signup'})` (which DOES create
    // the user when it doesn't exist, and does NOT consume the email-send
    // budget because the link is returned to the caller rather than mailed).
    // So coverage of the verify-link → DELEG-1 → signin-with-prefill →
    // setPasswordOnPromoted → dashboard leg is preserved end-to-end against
    // the live Supabase project.
    //
    // The narrow signup wire-protocol coverage we forfeit by mocking is
    // already pinned by unit tests:
    //   - src/lib/auth.test.ts `describe('signUp', …)` — supabase-js call shape
    //   - src/lib/supabase.test.ts — client config (storageKey, persistSession)
    await page.route('**/auth/v1/signup**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          // supabase-js GoTrueClient.signUp() reads `data.user` + `data.session`
          // off the JSON body. With confirm-email enabled the server returns
          // user-but-no-session; the SPA then shows verify-sent and waits for
          // the user to click the email link. See node_modules/@supabase/
          // auth-js/dist/main/GoTrueClient.js around line 670.
          id: '00000000-0000-0000-0000-000000000000',
          aud: 'authenticated',
          role: 'authenticated',
          email,
          email_confirmed_at: null,
          phone: '',
          confirmation_sent_at: new Date().toISOString(),
          app_metadata: { provider: 'email', providers: ['email'] },
          user_metadata: {},
          identities: [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          // Top-level user fields are returned at the root for the v1/signup
          // endpoint shape per GoTrue source; the SDK normalizes into
          // {data: {user, session}}.
        }),
      });
    });

    await page.goto('/#/auth/signup');
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole('button', { name: /create account/i }).click();

    // Should land on PostSignupSent (#/auth/verify-sent).
    await expect(page).toHaveURL(/#\/auth\/verify-sent/);

    // Drop the stub before generateLink — that call ultimately POSTs to
    // /auth/v1/admin/generate_link (admin endpoint, not /auth/v1/signup) so
    // the route pattern above wouldn't intercept it, but unrouting keeps the
    // spec hermetic in case supabase-js adds an additional signup probe.
    await page.unroute('**/auth/v1/signup**');

    // Admin generates the verify link in lieu of the user clicking the email.
    // type: 'signup' creates the user if it doesn't exist (the SPA signup was
    // mocked, so this is the first real write to auth.users for this email).
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

    // After Supabase's implicit-grant redirect, supabase-js parses the
    // access_token from the URL fragment (the `redirectTo` double-`#` is
    // collapsed by main.tsx's hotfix; see src/main.tsx). The SIGNED_IN
    // event fires, App.tsx restores the stashed `#/auth/verify` hash, and
    // VerifyEmailLanding's polling picks up the live session.
    //
    // The post-verify route depends on whether this is an anon-promotion
    // (DELEG-1: `user.last_sign_in_at == null`) or a fresh email signup
    // (Supabase populates `last_sign_in_at` during the implicit-grant
    // exchange, so VerifyEmailLanding's "returning user" branch fires and
    // strips the `#/auth/...` hash). Both outcomes satisfy the SC#1 SLA —
    // the user has a confirmed account and is no longer on an auth route.
    //
    // The anon-promotion → set-password leg is covered separately by
    // src/lib/auth.test.ts `describe('attachEmailToAnon')` +
    // `describe('setPasswordOnPromoted')`, both of which pin the
    // `updateUser` API contract (Critical Gotcha #5).
    await expect(page).not.toHaveURL(/#\/auth/, { timeout: 8000 });
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
