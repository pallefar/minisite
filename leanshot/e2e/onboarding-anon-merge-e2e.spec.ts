/**
 * Phase 34 Plan 34-10 — onboarding-anon-merge-e2e.spec.ts (ONBOARD-01/11).
 *
 * Proves the anonymous → authenticated merge handshake:
 *   1. Visit /onboard as a fresh anonymous browser → `_ls_anon` cookie set
 *      (UUID v4 per AnonymousPreviewLayer).
 *   2. Advance through the consumer onboarding renderer; select goal
 *      "Lose weight".
 *   3. Mint a magic-link verify URL server-side (admin.generateLink — bypasses
 *      the 2/hr GoTrue email rate limit per
 *      [[reference_supabase_auth_traps]] AND the GoTrueClient
 *      cross-contamination flake per
 *      [[reference_rls_fixture_gotrueclient_flake]]).
 *   4. Follow the verify URL; on landing, the merge_anon_session SECDEF
 *      RPC (Plan 34-05) propagates the anon session's goal into
 *      profiles.primary_goal.
 *   5. Confirm profiles.primary_goal === 'lose-weight'.
 *
 * Gate: PLAYWRIGHT_RUN_P34=1 + live SUPABASE_SERVICE_ROLE_KEY.
 * Excluded from default chromium project via testIgnore in playwright.config.ts.
 *
 * Per-file slug prefix per [[feedback_rls_per_file_slug_prefix]].
 *
 * Threat model (T-34-10-01, T-34-10-02): synthetic emails; service-role JWT
 * stays in Node; never injected into the browser context.
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

const _ts = Date.now().toString(36);
const _rand = Math.random().toString(36).slice(2, 6);
const TEST_SLUG_PREFIX = `p34_anon_merge_${_ts}_${_rand}_`;

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('@p34 ONBOARD-01/11 anon→auth merge', () => {
  test.skip(
    !hasLiveSupabase() || process.env.PLAYWRIGHT_RUN_P34 !== '1',
    'requires PLAYWRIGHT_RUN_P34=1 + live SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY'
  );

  test('cookie bootstrap → goal selection → magic-link sign-in → preferences propagate', async ({
    page,
  }) => {
    const admin = getAdmin();
    const email = `${TEST_SLUG_PREFIX}user@leanshot-test.local`;

    // 1. Land on /onboard. AnonymousPreviewLayer issues the `_ls_anon` cookie.
    await page.goto('/onboard');

    // 2. Assert cookie present + UUID-shaped.
    //    Note: cookie set by an Edge Function response on first /onboard hit;
    //    we give the cookie up to 5s to appear.
    let lsAnonValue: string | undefined;
    for (let attempt = 0; attempt < 20 && !lsAnonValue; attempt++) {
      const cookies = await page.context().cookies();
      lsAnonValue = cookies.find((c) => c.name === '_ls_anon')?.value;
      if (!lsAnonValue) await new Promise((r) => setTimeout(r, 250));
    }
    expect(lsAnonValue).toMatch(/^[0-9a-f-]{36}$/i);

    // 3. Advance into the renderer. The consumer onboarding step layout
    //    depends on the active onboarding_flow row, so we tolerate either a
    //    "Get started" or "Continue" CTA on the preview shell. Either lands
    //    in the goal-picker step.
    const startCta = page.getByRole('button', { name: /get started|continue|next/i }).first();
    await startCta.click({ timeout: 10_000 }).catch(() => {
      /* may already be on the goal step */
    });

    // 4. Pick "Lose weight" goal. The button text comes from primary_goal
    //    enum labels — we use a forgiving regex.
    await page
      .getByRole('button', { name: /lose weight/i })
      .first()
      .click({ timeout: 10_000 });

    // Advance past the goal step if a Continue CTA is still required.
    await page
      .getByRole('button', { name: /continue|next/i })
      .first()
      .click({ timeout: 5_000 })
      .catch(() => {
        /* goal step may auto-advance */
      });

    // 5. Mint a magic-link server-side. The verify URL, when followed, lands
    //    the user back on the SPA with an active Supabase session. Merge then
    //    runs in ConsumerOnboardingRenderer's post-auth effect.
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email,
    });
    expect(linkErr).toBeNull();
    expect(linkData?.properties?.action_link).toBeTruthy();

    await page.goto(linkData!.properties!.action_link!);

    // 6. Wait for the app to leave /auth/* and settle.
    await page.waitForURL((url) => !url.toString().includes('/auth/'), {
      timeout: 15_000,
    });

    // 7. The newly-authed user now exists. Look up the user id.
    const { data: usersList } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    const userId = usersList.users.find((u) => u.email === email)?.id;
    expect(userId).toBeTruthy();
    if (userId) createdUserIds.push(userId);

    // 8. Confirm merge propagated the goal selection.
    //    Give the merge handshake ~5s to land (Edge Fn → DB write).
    let primaryGoal: string | null | undefined = null;
    for (let attempt = 0; attempt < 20 && !primaryGoal; attempt++) {
      const { data } = await admin
        .from('profiles')
        .select('primary_goal')
        .eq('id', userId!)
        .maybeSingle();
      primaryGoal = data?.primary_goal;
      if (!primaryGoal) await new Promise((r) => setTimeout(r, 250));
    }
    expect(primaryGoal).toBe('lose-weight');
  });
});

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

test.afterAll(async () => {
  if (!hasLiveSupabase()) return;
  const admin = getAdmin();
  for (const id of createdUserIds) {
    try {
      await admin.auth.admin.deleteUser(id);
    } catch {
      /* noop */
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
