/**
 * @phase05 SC#1 completion: cross-device Realtime sync within 5s.
 *
 * User logs an injection on browser context A; a second browser context
 * signed in as the same user observes that injection appearing within the
 * 5-second Realtime budget without any manual refresh.
 *
 * Skip-gates on SUPABASE_SERVICE_ROLE_KEY + URL/ANON keys (same pattern as
 * the 05-02 Playwright specs). The admin client uses createUser(email_confirm:
 * true) so the SPA's two contexts can sign in directly via password.
 *
 * Plan 05-03 Task 4. RESEARCH §"Common Operation 3" lines 1457-1513.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { expect, test, type Page } from '@playwright/test';

const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const HAS_LIVE_AUTH = Boolean(SERVICE_ROLE && SUPABASE_URL && ANON_KEY);

// Minimal `user` slice seed so `selectView` returns 'dashboard' instead of
// 'marketing' or 'onboarding' on signin. Matches the shape in src/types/index.ts.
const SEED_USER = {
  name: 'Phase5Test',
  units: 'metric',
  medication: 'ozempic',
  dose: '0.5',
  doseUnit: 'mg',
  startDate: '2026-01-01',
  startWeight: 100,
  height: 175,
  age: 35,
  sex: 'male',
  bodyFat: null,
  goalWeight: 90,
  goal: 'fat-loss',
  proteinTarget: 150,
  calorieTarget: 2000,
  fiberTarget: 30,
  waterTarget: 2500,
  injectionDay: 0,
  activityLevel: 'moderate',
  liftingLevel: 'intermediate',
  createdAt: '2026-01-01T00:00:00Z',
};

async function seedUserAndSignIn(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  // Pre-seed the universal localStorage key so selectView returns 'dashboard'
  // immediately after auth (no onboarding 8-step detour). The renameStorageNamespace
  // helper on SIGNED_IN migrates it under the namespaced key automatically.
  await page.goto('/#/auth/signin');
  await page.evaluate(
    ({ user, key }) => {
      const blob = {
        state: {
          user,
          injections: [],
          symptoms: [],
          weights: [],
          measurements: [],
          meals: [],
          water: {},
          foodNoise: {},
          workouts: [],
          steps: {},
          supplements: {},
          mood: [],
          sleep: [],
          nsvs: [],
          photos: [],
          vials: [],
          aiHistory: [],
          costs: [],
          pendingOps: [],
          acknowledgedDisclaimer: 'v1',
        },
        version: 7,
      };
      localStorage.setItem(key, JSON.stringify(blob));
    },
    { user: SEED_USER, key: 'leanshot_v4' },
  );
  // Reload so the Zustand persist middleware picks up the seeded blob during
  // synchronous hydrate() in main.tsx.
  await page.reload();
  await page.goto('/#/auth/signin');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  // Land on dashboard (post-auth).
  await expect(page).not.toHaveURL(/#\/auth/, { timeout: 8000 });
  await expect(page.getByTestId('dashboard')).toBeVisible({ timeout: 8000 });
}

async function gotoMedicationTab(page: Page): Promise<void> {
  // Sidebar primary nav exposes each tab via `aria-label={label}`. Both
  // mobile bottom-nav AND desktop side-nav advertise the Medication tab —
  // .first() guards against either layout's button being matched.
  await page.getByRole('button', { name: /^medication$/i }).first().click();
  await expect(page.getByTestId('injection-submit')).toBeVisible({ timeout: 5000 });
}

test.describe('@phase05 SC#1 completion — cross-device Realtime sync (<5s budget)', () => {
  test.skip(!HAS_LIVE_AUTH, 'requires SUPABASE_SERVICE_ROLE_KEY + VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY');
  test.setTimeout(90_000);

  let admin: SupabaseClient;
  let userId: string | undefined;
  const email = `cds-${Date.now()}@leanshot.test`;
  const password = `Pass1234-${Date.now()}`;

  test.beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SERVICE_ROLE!, {
      auth: { persistSession: false },
    });
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    expect(error).toBeNull();
    userId = data?.user?.id;
    expect(userId).toBeDefined();
  });

  test.afterAll(async () => {
    if (!userId) return;
    await admin.auth.admin.deleteUser(userId).catch(() => {
      // best-effort cleanup
    });
  });

  test('injection logged on context A propagates to context B within 5s', async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    try {
      const pageA = await ctxA.newPage();
      const pageB = await ctxB.newPage();

      // Sign in both contexts. Seed B FIRST so it's already subscribed when A logs.
      await seedUserAndSignIn(pageB, email, password);
      await gotoMedicationTab(pageB);
      await seedUserAndSignIn(pageA, email, password);
      await gotoMedicationTab(pageA);

      // Context A: log an injection with a unique dose for clean assertion.
      const uniqueDose = `0.${Math.floor(Math.random() * 89 + 10)}`;
      await pageA.getByTestId('injection-dose-input').fill(uniqueDose);
      const tStart = Date.now();
      await pageA.getByTestId('injection-submit').click();

      // Context A: local-first invariant — injection visible immediately.
      await expect(
        pageA.getByTestId('injection-list').locator(`text=${uniqueDose}`),
      ).toBeVisible({ timeout: 1500 });

      // Context B: Realtime postgres_changes push — same injection visible
      // within 5s. The 5s ceiling is the SC#1 budget; we log the actual
      // elapsed ms for visibility in CI.
      await expect(
        pageB.getByTestId('injection-list').locator(`text=${uniqueDose}`),
      ).toBeVisible({ timeout: 5000 });
      const elapsed = Date.now() - tStart;
      // eslint-disable-next-line no-console
      console.log(`[cross-device-sync] propagation: ${elapsed}ms`);
      expect(elapsed).toBeLessThan(5000);
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });
});
