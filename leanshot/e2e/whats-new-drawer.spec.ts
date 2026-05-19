/**
 * Phase 42 Plan 42-09 Task 3 — e2e: What's New drawer unread → mark-read cycle.
 *
 * Tests the full POLISH-11 flow live against the production-shape Supabase
 * project:
 *   1. Seed an authenticated user with NO `user_changelog_dismissed` row.
 *   2. Load `/dashboard` → the avatar Sparkles button shows the unread dot
 *      (3 v1.3-highlight entries from 42-06 seed are all newer than 1970).
 *   3. Click the button → drawer opens with N seeded entries (≥3).
 *   4. Click "Got it" → the drawer's onClose fires + markRead POSTs to
 *      `/changelog-mark-read` → `user_changelog_dismissed.last_seen_published_at`
 *      is set to the newest entry's published_at.
 *   5. Reload the page → unread dot is GONE.
 *
 * Gate:
 *   PLAYWRIGHT_RUN_P42_WHATSNEW=1 + live Supabase env vars (URL, anon, service role).
 *   The default chromium project should `testIgnore` this spec until the
 *   conditional project lands — but Phase 42 doesn't add a new project, so we
 *   self-skip when the env var is absent. This keeps the spec discoverable to
 *   future operator-driven runs without ballooning the default CI matrix.
 *
 * Seeding: `page.addInitScript` per [[reference_playwright_state_seeding]] so
 *          supabase-js reads the session from localStorage on INITIAL_SESSION,
 *          NOT after a goto+evaluate race.
 *
 * Cleanup: service-role deletes the test user (CASCADE wipes its
 *          user_changelog_dismissed row).
 *
 * The 3 seed entries from 42-06 are present in `changelog_entries` on the
 * live project (verified in 42-06-SUMMARY production-verification block).
 * We do NOT insert any extra entries — the seed is sufficient to prove the
 * unread cycle.
 */
import { test, expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const PLAYWRIGHT_RUN = process.env.PLAYWRIGHT_RUN_P42_WHATSNEW === '1';
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const HAS_LIVE = Boolean(SUPABASE_URL && ANON_KEY && SERVICE_ROLE);

// File-scoped slug prefix per [[feedback_rls_per_file_slug_prefix]].
const SLUG = `whatsnew-${Date.now().toString(36)}-`;

function getAdmin(): SupabaseClient {
  return createClient(SUPABASE_URL!, SERVICE_ROLE!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function createSeedUser(admin: SupabaseClient): Promise<{
  userId: string;
  email: string;
  accessToken: string;
}> {
  const email = `${SLUG}user@leanshot.test`;
  const password = `Pass-${crypto.randomUUID().slice(0, 12)}`;

  const { data: user, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !user.user) throw new Error(`createUser failed: ${error?.message}`);
  const userId = user.user.id;

  // Sign in to get an access_token the seed handler can stuff into localStorage.
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

async function seedAuthSession(page: Page, accessToken: string, userId: string): Promise<void> {
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

test.describe('@phase42 What\'s New drawer — unread → mark-read cycle', () => {
  test.skip(
    !HAS_LIVE || !PLAYWRIGHT_RUN,
    'Requires PLAYWRIGHT_RUN_P42_WHATSNEW=1 + live Supabase env (URL, anon, service role)',
  );

  let admin: SupabaseClient;
  const createdUserIds: string[] = [];

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

  test('full unread → drawer → Got it → reload no-dot cycle', async ({ page }) => {
    const { userId, accessToken } = await createSeedUser(admin);
    createdUserIds.push(userId);

    // (1) Seed the auth session BEFORE navigating so supabase-js picks it
    //     up on INITIAL_SESSION. Per [[reference_playwright_state_seeding]].
    await seedAuthSession(page, accessToken, userId);

    // (2) Confirm no user_changelog_dismissed row exists for this fresh user.
    const dismissedBefore = await admin
      .from('user_changelog_dismissed')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle();
    expect(dismissedBefore.data).toBeNull();

    // (3) Navigate to /dashboard (default View after a hydrated user).
    await page.goto('/#/');
    await page.waitForLoadState('networkidle');

    // (4) Avatar Sparkles button is visible with the unread dot (3 seed entries
    //     all qualify as "newer than 1970-01-01").
    const whatsNewButton = page.getByRole('button', { name: /what's new — \d+ unread/i });
    await expect(whatsNewButton).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="whats-new-unread-dot"]')).toBeVisible();

    // (5) Click → drawer opens with ≥3 articles (the 42-06 seed rows).
    await whatsNewButton.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const articles = dialog.locator('article');
    expect(await articles.count()).toBeGreaterThanOrEqual(3);

    // (6) Click "Got it" → drawer closes via onClose; markRead POSTs to the
    //     Edge Fn which UPSERTs user_changelog_dismissed.
    await page.getByRole('button', { name: /got it/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 5_000 });

    // (7) Verify the dismissed row is now present with the newest entry's
    //     published_at — the Edge Fn writes max(published_at) per 42-06 spec.
    const dismissedAfter = await admin
      .from('user_changelog_dismissed')
      .select('user_id, last_seen_published_at')
      .eq('user_id', userId)
      .maybeSingle();
    expect(dismissedAfter.data?.last_seen_published_at).toBeTruthy();

    // (8) Reload → unread dot must be GONE because the new lastSeenAt is now
    //     ≥ every entry.published_at.
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('[data-testid="whats-new-unread-dot"]')).not.toBeVisible({
      timeout: 10_000,
    });
    // The generic "What's new" aria-label should now match (no unread-count suffix).
    await expect(page.getByRole('button', { name: /^what's new$/i })).toBeVisible();
  });
});
