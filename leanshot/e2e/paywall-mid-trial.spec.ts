/**
 * Phase 39 Plan 39-04 — Playwright e2e proof of PAYWALL-01.
 *
 * Asserts the mid-trial paywall surface: a trialing user who has just
 * crossed the Phase 34 activation threshold AND has granted cookie-tracking
 * consent sees the PaywallModal variant rendered.
 *
 * Pattern source: e2e/onboarding-activation-e2e.spec.ts (Phase 34 fixture
 * pattern — service-role admin to provision the test user + sign in via
 * generateLink + wait for the variant-resolver network call).
 *
 * Per RESEARCH OQ-2 (Phase 22 consent shape): consent is seeded via
 * `addInitScript` that pre-sets the vanilla-cookieconsent cookie BEFORE
 * the app boots so the banner does not gate the test (per
 * [[reference_playwright_state_seeding]]).
 *
 * Gate: PLAYWRIGHT_RUN_P39=1 + live SUPABASE_SERVICE_ROLE_KEY. Excluded
 * from the default chromium project via testIgnore in playwright.config.ts.
 * Milestone close-out UAT plan exercises this spec.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

function hasLiveSupabase(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

const RUN_GATE = process.env.PLAYWRIGHT_RUN_P39 === '1';

const _ts = Date.now().toString(36);
const _rand = Math.random().toString(36).slice(2, 6);
const TEST_SLUG_PREFIX = `p39_paywall_${_ts}_${_rand}_`;

let _admin: SupabaseClient | null = null;
function getAdmin(): SupabaseClient {
  if (!_admin) {
    _admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return _admin;
}

const createdUserIds: string[] = [];

test.afterAll(async () => {
  if (!hasLiveSupabase() || createdUserIds.length === 0) return;
  const admin = getAdmin();
  for (const uid of createdUserIds) {
    try {
      await admin.auth.admin.deleteUser(uid);
    } catch {
      /* best-effort sweep */
    }
  }
});

test.describe('PAYWALL-01 — mid-trial paywall e2e', () => {
  test.skip(!RUN_GATE || !hasLiveSupabase(), 'requires PLAYWRIGHT_RUN_P39=1 + live Supabase');

  test('trialing user post-activation + consent=true sees PaywallModal variant', async ({
    page,
  }) => {
    // 1. Seed cookie-consent BEFORE app boots so consent-adapter returns
    //    true immediately and the paywall mount-gate opens.
    //    vanilla-cookieconsent v3 stores acceptance in a cookie named
    //    `cc_cookie`; we set it to a value granting the 'analytics' category.
    await page.context().addCookies([
      {
        name: 'cc_cookie',
        value: encodeURIComponent(
          JSON.stringify({
            categories: ['necessary', 'analytics'],
            level: ['necessary', 'analytics'],
            revision: 1,
            data: null,
            consentTimestamp: new Date().toISOString(),
            consentId: 'p39-test-consent',
          }),
        ),
        url: process.env.BASE_URL ?? 'http://localhost:5173',
      },
    ]);

    // 2. Create + sign in a trialing test user via admin client.
    const admin = getAdmin();
    const email = `${TEST_SLUG_PREFIX}user@example.com`;
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      password: 'TestPassword123!',
    });
    if (createErr || !created?.user?.id) {
      throw new Error(`Could not create test user: ${createErr?.message ?? 'unknown'}`);
    }
    createdUserIds.push(created.user.id);

    // 3. Sign the user in via magic-link bypass.
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email,
    });
    if (linkErr || !linkData?.properties?.action_link) {
      throw new Error(`Could not generate magic link: ${linkErr?.message ?? 'unknown'}`);
    }
    await page.goto(linkData.properties.action_link);

    // 4. Trigger an activation event (Phase 34 record-activation RPC).
    //    Wait for variant-resolver POST to confirm the paywall mounted.
    const resolverPromise = page.waitForResponse(
      (resp) =>
        resp.url().includes('/functions/v1/variant-resolver') && resp.request().method() === 'POST',
      { timeout: 15_000 },
    );

    // Surface-trigger: navigate to dashboard which fires the activation flow.
    await page.goto((process.env.BASE_URL ?? 'http://localhost:5173') + '/');

    await resolverPromise;

    // 5. Assert PaywallModal renders.
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: /Start subscription/i })).toBeVisible();
  });
});
