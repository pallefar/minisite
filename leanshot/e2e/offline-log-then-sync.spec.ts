/**
 * @phase05 SC#4 — offline-first: log 3 injections on browser A while the
 *          network is OFF, then re-enable the network and assert all 3
 *          propagate to a second browser context (B) via flushSyncQueue +
 *          Realtime fanout.
 *
 * Exercises:
 *   - Local-first invariant: injections visible in A's UI immediately while
 *     offline (D-10 + Zustand local-first behavior).
 *   - pendingOps persistence: the 3 queued upserts survive offline state.
 *   - online-event flush trigger (RESEARCH §6 line 887): App.tsx's
 *     window.addEventListener('online', flushSyncQueue) does its job when the
 *     network returns.
 *   - Realtime fanout to B: postgres_changes pushes all 3 inserts.
 *
 * Plan 05-03 Task 5. RESEARCH §11 line 1135 SC#4 spec.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const HAS_LIVE_AUTH = Boolean(SERVICE_ROLE && SUPABASE_URL && ANON_KEY);

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
  await page.reload();
  await page.goto('/#/auth/signin');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await expect(page).not.toHaveURL(/#\/auth/, { timeout: 8000 });
  await expect(page.getByTestId('dashboard')).toBeVisible({ timeout: 8000 });
}

async function gotoMedicationTab(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^medication$/i }).first().click();
  await expect(page.getByTestId('injection-submit')).toBeVisible({ timeout: 5000 });
}

async function logInjection(page: Page, dose: string): Promise<void> {
  await page.getByTestId('injection-dose-input').fill(dose);
  await page.getByTestId('injection-submit').click();
  await expect(
    page.getByTestId('injection-list').locator(`text=${dose}`),
  ).toBeVisible({ timeout: 1500 });
}

test.describe('@phase05 SC#4 — offline-first: 3 injections logged offline propagate on reconnect', () => {
  test.skip(!HAS_LIVE_AUTH, 'requires SUPABASE_SERVICE_ROLE_KEY + VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY');
  test.setTimeout(120_000);

  let admin: SupabaseClient;
  let userId: string | undefined;
  const email = `off-${Date.now()}@leanshot.test`;
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
  });

  test.afterAll(async () => {
    if (!userId) return;
    await admin.auth.admin.deleteUser(userId).catch(() => {
      // best-effort cleanup
    });
  });

  test('3 injections logged offline propagate to context B on reconnect', async ({ browser }) => {
    const ctxA: BrowserContext = await browser.newContext();
    const ctxB: BrowserContext = await browser.newContext();
    try {
      const pageA = await ctxA.newPage();
      const pageB = await ctxB.newPage();

      // Sign in B first so its Realtime channel is already live.
      await seedUserAndSignIn(pageB, email, password);
      await gotoMedicationTab(pageB);
      await seedUserAndSignIn(pageA, email, password);
      await gotoMedicationTab(pageA);

      // ----- Offline phase ---------------------------------------------------
      await ctxA.setOffline(true);

      // Use unique doses so we can assert each independently.
      const doses = [
        `0.${Math.floor(Math.random() * 89 + 10)}`,
        `0.${Math.floor(Math.random() * 89 + 10)}`,
        `0.${Math.floor(Math.random() * 89 + 10)}`,
      ];
      // Ensure distinct values (small chance of collision).
      while (new Set(doses).size < 3) {
        doses[doses.length - 1] = `0.${Math.floor(Math.random() * 89 + 10)}`;
      }

      for (const dose of doses) {
        await logInjection(pageA, dose);
      }

      // Local-first: all 3 should be in the UI immediately.
      for (const dose of doses) {
        await expect(
          pageA.getByTestId('injection-list').locator(`text=${dose}`),
        ).toBeVisible();
      }

      // pendingOps in localStorage MUST contain >=3 upsert entries for injections.
      const pendingOpsCount = await pageA.evaluate(() => {
        const keys = Object.keys(localStorage).filter((k) =>
          k.startsWith('leanshot_v4'),
        );
        let total = 0;
        for (const key of keys) {
          const raw = localStorage.getItem(key);
          if (!raw) continue;
          try {
            const parsed = JSON.parse(raw) as {
              state?: { pendingOps?: Array<{ table: string; op: string }> };
            };
            const ops = parsed?.state?.pendingOps ?? [];
            total += ops.filter(
              (o) => o.table === 'injections' && o.op === 'upsert',
            ).length;
          } catch {
            // skip
          }
        }
        return total;
      });
      expect(pendingOpsCount).toBeGreaterThanOrEqual(3);

      // ----- Reconnect phase ------------------------------------------------
      await ctxA.setOffline(false);

      // Within the CI budget, context B should see all 3 doses propagated
      // via flushSyncQueue (online event in A) + Realtime fanout (to B).
      // CI-cold-realtime-budget: raised 8s→12s for prod-build cold WebSocket handshake. See leanshot/.planning/phases/07-compliance-foundations-legal-counsel-led/07-RESEARCH.md §1 Family A.
      for (const dose of doses) {
        await expect(
          pageB.getByTestId('injection-list').locator(`text=${dose}`),
        ).toBeVisible({ timeout: 12_000 });
      }
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });
});
