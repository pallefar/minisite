/**
 * @phase07-diagnostic — Surfaces `window.__leanshot_view_log__` so the
 * post-signin "AppShell never renders" investigation can see what selectView
 * actually returned at each tick. Mirrors the seedUserAndSignIn pattern used
 * by the failing specs (cross-device-sync, offline-log-then-sync, etc.) but
 * intentionally fails AFTER capturing the view log, then dumps the log to
 * stdout via console.log so it lands in the CI step output.
 *
 * Delete this file once the root cause is confirmed.
 *
 * See .planning/debug/phase7-e2e-post-signin-render.md.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { expect, test, type Page } from '@playwright/test';

const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const HAS_LIVE_AUTH = Boolean(SERVICE_ROLE && SUPABASE_URL && ANON_KEY);

const SEED_USER = {
  name: 'Phase7Diag',
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

async function dumpDiagnostics(page: Page, label: string): Promise<void> {
  const snap = await page.evaluate(() => {
    return {
      url: window.location.href,
      hash: window.location.hash,
      readyState: document.readyState,
      viewLog: window.__leanshot_view_log__ ?? [],
      storeUser: (window as any).useStore?.getState?.()?.user ?? null,
      storeSignedIn: (window as any).useStore?.getState?.()?.signedIn ?? null,
      lsKeys: Object.keys(localStorage).filter((k) => k.startsWith('leanshot_v4')),
      lsBlob: (() => {
        const out: Record<string, unknown> = {};
        for (const k of Object.keys(localStorage)) {
          if (!k.startsWith('leanshot_v4')) continue;
          try {
            const v = localStorage.getItem(k);
            const parsed = v ? JSON.parse(v) : null;
            out[k] = {
              version: parsed?.version ?? null,
              hasUser: Boolean(parsed?.state?.user),
              ack: parsed?.state?.acknowledgedDisclaimer ?? null,
            };
          } catch {
            out[k] = '<unparseable>';
          }
        }
        return out;
      })(),
      bodyTextStart: document.body?.innerText?.slice(0, 200) ?? '<no body>',
      hasDashboardTestId: Boolean(document.querySelector('[data-testid="dashboard"]')),
      hasPrimaryNav: Boolean(document.querySelector('nav[aria-label="Primary navigation"]')),
      hasMigrationHeading: Boolean(
        Array.from(document.querySelectorAll('h1,h2,h3')).find((el) =>
          (el as HTMLElement).innerText?.includes('Migrating your data'),
        ),
      ),
      hasAuthForm: Boolean(
        Array.from(document.querySelectorAll('h1')).find(
          (el) => (el as HTMLElement).innerText?.trim() === 'Sign in',
        ),
      ),
    };
  });
  // eslint-disable-next-line no-console
  console.log(
    `\n===== DIAGNOSTIC ${label} =====\n${JSON.stringify(snap, null, 2)}\n===== /DIAGNOSTIC =====\n`,
  );
}

test.describe('@phase07-diagnostic — capture post-signin view log', () => {
  test.skip(!HAS_LIVE_AUTH, 'requires service-role secrets');
  test.setTimeout(90_000);

  let admin: SupabaseClient | undefined;
  let userId: string | undefined;
  const email = `diag-${Date.now()}@leanshot.test`;
  const password = `Pass1234-${Date.now()}`;

  test.beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SERVICE_ROLE!, { auth: { persistSession: false } });
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    expect(error).toBeNull();
    userId = data!.user!.id;
  });

  test.afterAll(async () => {
    if (admin && userId) {
      await admin.auth.admin.deleteUser(userId).catch(() => {});
    }
  });

  test('seed → signin → dump view log', async ({ page }) => {
    page.on('console', (msg) => {
      // Mirror app console output into the test step log so we can correlate.
      // eslint-disable-next-line no-console
      console.log(`[browser:${msg.type()}] ${msg.text()}`);
    });

    await page.goto('/#/auth/signin');
    await dumpDiagnostics(page, 'after-first-goto');

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
    await dumpDiagnostics(page, 'after-reload-with-seed');

    await page.goto('/#/auth/signin');
    await dumpDiagnostics(page, 'after-second-goto');

    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.locator('form').getByRole('button', { name: /^sign in$/i }).click();

    // Wait for URL to leave auth (this is known to pass per CI evidence).
    await expect(page).not.toHaveURL(/#\/auth/, { timeout: 30_000 });
    await dumpDiagnostics(page, 'after-url-left-auth');

    // Now wait a beat and dump again to see how view evolves.
    await page.waitForTimeout(3000);
    await dumpDiagnostics(page, 'after-url-left-auth+3s');

    // Try the failing assertion — the diagnostic value is in the dumps above
    // regardless of pass/fail. Catch and dump on failure.
    try {
      await expect(page.getByRole('navigation', { name: /primary navigation/i })).toBeVisible({
        timeout: 15_000,
      });
      await dumpDiagnostics(page, 'PASS-nav-visible');
    } catch (e) {
      await dumpDiagnostics(page, 'FAIL-nav-not-visible');
      throw e;
    }
  });
});
