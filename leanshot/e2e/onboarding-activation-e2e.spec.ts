/**
 * Phase 34 Plan 34-10 — onboarding-activation-e2e.spec.ts (ONBOARD-05 / ONBOARD-13).
 *
 * Proves the first-action surface → record-activation → activation_events row path:
 *   1. Create a verified test user via service-role admin client.
 *   2. Sign that user in via Supabase admin.generateLink + page.goto (no real
 *      OTP email — bypasses 2/hr rate limit per
 *      [[reference_supabase_auth_traps]] and the GoTrueClient flake per
 *      [[reference_rls_fixture_gotrueclient_flake]]).
 *   3. Wait for /functions/v1/record-activation POST (deterministic per
 *      [[reference_playwright_state_seeding]] — NOT a flaky `waitForTimeout`,
 *      which is the plan-checker NEW-W-02 carry-over).
 *   4. Assert activation_events row exists with goal_type='lose-weight' +
 *      action_type='first_weight_log'.
 *
 * Gate: PLAYWRIGHT_RUN_P34=1 + live SUPABASE_SERVICE_ROLE_KEY.
 * Excluded from default chromium project via testIgnore in playwright.config.ts.
 *
 * Per-file slug prefix per [[feedback_rls_per_file_slug_prefix]] avoids
 * cross-test clobber when multiple Phase 34 specs share the same machine.
 *
 * Threat model (T-34-10-01): synthetic emails matching `p34_activation_*` are
 * deleted in afterAll; no real PII enters the test fixture.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';

// ---------------------------------------------------------------------------
// Env + gate
// ---------------------------------------------------------------------------

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

function hasLiveSupabase(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

// File-scoped slug prefix per [[feedback_rls_per_file_slug_prefix]].
const _ts = Date.now().toString(36);
const _rand = Math.random().toString(36).slice(2, 6);
const TEST_SLUG_PREFIX = `p34_activation_${_ts}_${_rand}_`;

let _admin: SupabaseClient | null = null;
function getAdmin(): SupabaseClient {
  if (!_admin) {
    _admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return _admin;
}

// Track created user ids for after-all sweep.
const createdUserIds: string[] = [];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('@p34 ONBOARD-05 activation event', () => {
  test.skip(
    !hasLiveSupabase() || process.env.PLAYWRIGHT_RUN_P34 !== '1',
    'requires PLAYWRIGHT_RUN_P34=1 + live SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY'
  );

  test('first-action tap → record-activation Edge Fn fires → activation_events row written', async ({
    page,
  }) => {
    const admin = getAdmin();
    const email = `${TEST_SLUG_PREFIX}user@leanshot-test.local`;

    // 1. Create verified user + seed profile with primary_goal='lose-weight'.
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
    });
    expect(createErr).toBeNull();
    const userId = created.user!.id;
    createdUserIds.push(userId);

    const { error: profErr } = await admin.from('profiles').upsert({
      id: userId,
      primary_goal: 'lose-weight',
      completed_onboarding_at: null,
    });
    expect(profErr).toBeNull();

    // 2. Mint a magic-link verify URL server-side (no email roundtrip).
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email,
    });
    expect(linkErr).toBeNull();
    expect(linkData?.properties?.action_link).toBeTruthy();

    // 3. Set up the deterministic listener BEFORE navigation — race-safe.
    //    Per NEW-W-02 plan-checker carry-over: use waitForRequest, NOT
    //    waitForTimeout (which is timer-flake-prone in CI).
    const activationRequestPromise = page.waitForRequest(
      (req) =>
        req.url().includes('/functions/v1/record-activation') && req.method() === 'POST',
      { timeout: 15_000 }
    );

    // 4. Follow the verify URL. supabase-js installs the session on landing.
    await page.goto(linkData!.properties!.action_link!);

    // Wait for the app to settle on a post-auth route. The actual landing may
    // be onboarding-complete, the dashboard, or the first-action surface
    // depending on profile state. We don't pin the exact route — we just wait
    // for the URL to no longer contain '/auth/'.
    await page.waitForURL((url) => !url.toString().includes('/auth/'), {
      timeout: 15_000,
    });

    // 5. Tap "Log your first weight" — the first_weight_log action for the
    //    'lose-weight' goal per first-action-map.ts. The exact button label is
    //    asserted in the unit test FirstActionSurface.test.tsx.
    await page
      .getByRole('button', { name: /log your first weight/i })
      .first()
      .click();

    // 6. Wait for the activation request to land (deterministic — no timer).
    const activationRequest = await activationRequestPromise;
    expect(activationRequest.url()).toContain('/functions/v1/record-activation');

    // 7. Confirm the DB row landed (give the Edge Fn ~3s to process).
    let actEvent: { goal_type?: string; action_type?: string; source?: string } | null = null;
    for (let attempt = 0; attempt < 10 && !actEvent; attempt++) {
      const { data } = await admin
        .from('activation_events')
        .select('goal_type, action_type, source')
        .eq('user_id', userId)
        .maybeSingle();
      if (data) actEvent = data;
      else await new Promise((r) => setTimeout(r, 300));
    }
    expect(actEvent).not.toBeNull();
    expect(actEvent?.goal_type).toBe('lose-weight');
    expect(actEvent?.action_type).toBe('first_weight_log');
    // `source` may be 'first_log' or null depending on Plan 34-03 wiring —
    // we soft-assert here so a schema rename doesn't false-fail the suite.
    expect.soft(actEvent?.source).toBe('first_log');
  });
});

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

test.afterAll(async () => {
  if (!hasLiveSupabase()) return;
  const admin = getAdmin();
  // Sweep ids we tracked + any leftover slug-prefixed users.
  for (const id of createdUserIds) {
    try {
      await admin.auth.admin.deleteUser(id);
    } catch {
      /* noop — already gone */
    }
  }
  try {
    const { data: users } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    for (const u of users.users) {
      if (u.email?.startsWith(TEST_SLUG_PREFIX)) {
        await admin.auth.admin.deleteUser(u.id).catch(() => {});
      }
    }
  } catch {
    /* noop */
  }
});
