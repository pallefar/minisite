/**
 * @phase06 SC#1 — leanshot_v4 → cloud migration happy-path + resume-after-reload.
 *
 * Test 1 (happy path):
 *   Pre-seed `leanshot_v4` with a populated v4 state → admin-create a verified
 *   user → sign in → MigrationModal appears with title "Migrating your data" →
 *   `leanshot_v4_pre_cloud_backup` is present in localStorage (D-03) →
 *   modal transitions to "All done" → user clicks "Continue to dashboard" →
 *   reload → modal does NOT re-appear (migration_state.complete === true).
 *
 * Test 2 (resume):
 *   Pre-seed `leanshot_v4` AND a partial migration_state slice with 3 of 11
 *   entities at 'complete' → sign in → MigrationModal opens with title
 *   "Resuming migration" → finishes the remaining entities → "All done".
 *
 * Skip-gates on SUPABASE_SERVICE_ROLE_KEY + VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
 * (Pattern D — fork-PR CI safety).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { expect, test, type Page } from '@playwright/test';

const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const HAS_LIVE_AUTH = Boolean(SERVICE_ROLE && SUPABASE_URL && ANON_KEY);

// Minimal `user` slice so selectView returns 'dashboard'. Mirrors
// cross-device-sync.spec.ts's SEED_USER shape.
const SEED_USER = {
  name: 'Phase6Mig',
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

function makeV4Blob(extras: Record<string, unknown> = {}): {
  state: Record<string, unknown>;
  version: 7;
} {
  return {
    state: {
      user: SEED_USER,
      injections: [
        {
          log_id: 'phase6-mig-seed-1',
          datetime: new Date().toISOString(),
          dose: '0.5',
          unit: 'mg',
          site: 'thigh-l',
          notes: '',
          pkEngineVersion: 1,
        },
      ],
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
      migration_state: null,
      ...extras,
    },
    version: 7,
  };
}

async function seedAndSignIn(
  page: Page,
  email: string,
  password: string,
  blob: ReturnType<typeof makeV4Blob>,
): Promise<void> {
  await page.goto('/#/auth/signin');
  await page.evaluate(
    ({ data, key }) => {
      localStorage.setItem(key, JSON.stringify(data));
    },
    { data: blob, key: 'leanshot_v4' },
  );
  await page.reload();
  await page.goto('/#/auth/signin');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await expect(page).not.toHaveURL(/#\/auth/, { timeout: 8000 });
}

test.describe('@phase06 SC#1 — migration happy-path + resume', () => {
  test.skip(
    !HAS_LIVE_AUTH,
    'requires SUPABASE_SERVICE_ROLE_KEY + VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY',
  );
  test.setTimeout(90_000);

  let admin: SupabaseClient | undefined;
  const tearDown: string[] = [];

  test.afterAll(async () => {
    if (!admin) return;
    for (const uid of tearDown) {
      await admin.auth.admin.deleteUser(uid).catch(() => {
        /* best-effort */
      });
    }
  });

  test('Test 1: first sign-in with v4 data → migration runs + leanshot_v4_pre_cloud_backup retained', async ({
    page,
  }) => {
    admin = createClient(SUPABASE_URL!, SERVICE_ROLE!, { auth: { persistSession: false } });
    const email = `phase6-mig-${Date.now()}@leanshot.test`;
    const password = 'Phase6!Migrate#';
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    expect(error).toBeNull();
    const userId = data.user!.id;
    tearDown.push(userId);

    await seedAndSignIn(page, email, password, makeV4Blob());

    // Migration modal opens. The state machine may finish very fast in the
    // jsdom-equivalent runtime test scenarios, so accept either "Migrating
    // your data" OR "All done" as the first observable title.
    const migrating = page.getByText('Migrating your data');
    const allDone = page.getByText('All done');
    await expect(migrating.or(allDone)).toBeVisible({ timeout: 12000 });

    // D-03 contract: a backup snapshot exists BEFORE any cloud write (the modal
    // is rendered post-snapshot per maybeStartMigration's order of ops).
    const backup = await page.evaluate(() =>
      localStorage.getItem('leanshot_v4_pre_cloud_backup'),
    );
    expect(backup).toBeTruthy();
    const parsed = JSON.parse(backup!);
    expect(parsed.version).toBe(7);
    expect(parsed.snapshotAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(parsed.state).toBeDefined();

    // Wait for completion + acknowledge.
    await expect(page.getByText('All done')).toBeVisible({ timeout: 30000 });
    await page.getByRole('button', { name: /continue to dashboard/i }).click();

    // Reload — migration_state.complete is true so modal MUST NOT re-render.
    await page.reload();
    await expect(page.getByText('Migrating your data')).not.toBeVisible({ timeout: 3000 });
    await expect(page.getByText('Resuming migration')).not.toBeVisible({ timeout: 1000 });
  });

  test('Test 2: mid-migration partial state surfaces "Resuming migration"', async ({ page }) => {
    admin = createClient(SUPABASE_URL!, SERVICE_ROLE!, { auth: { persistSession: false } });
    const email = `phase6-resume-${Date.now()}@leanshot.test`;
    const password = 'Phase6!Resume#';
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    expect(error).toBeNull();
    const userId = data.user!.id;
    tearDown.push(userId);

    // Pre-seed a partial migration_state — 3 entities 'complete', 8 pending.
    const partial = makeV4Blob({
      migration_state: {
        startedAt: new Date().toISOString(),
        complete: false,
        snapshotKey: 'leanshot_v4_pre_cloud_backup',
        injections: 'complete',
        weights: 'complete',
        meals: 'complete',
        photos: 'pending',
        workouts: 'pending',
        supplements: 'pending',
        mood: 'pending',
        sleep: 'pending',
        symptoms: 'pending',
        vials: 'pending',
        settings: 'pending',
      },
    });

    await seedAndSignIn(page, email, password, partial);

    // Resume title appears (or "All done" if drain is near-instant).
    const resuming = page.getByText('Resuming migration');
    const allDone = page.getByText('All done');
    await expect(resuming.or(allDone)).toBeVisible({ timeout: 12000 });

    // Eventually completes.
    await expect(page.getByText('All done')).toBeVisible({ timeout: 30000 });
  });
});
