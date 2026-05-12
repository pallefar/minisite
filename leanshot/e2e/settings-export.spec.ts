/**
 * Phase 7 Plan 07-06 — Settings → Data export e2e (COMPL-06).
 *
 * Proves the two export flows end-to-end against the dashboard:
 *   1. Export JSON → downloads `leanshot-export-YYYY-MM-DD.json`
 *   2. Export PDF rollup → downloads `leanshot-export-YYYY-MM-DD.pdf` after
 *      dynamic-import of jspdf
 *
 * No live Supabase auth is required: we seed an onboarded user directly into
 * `leanshot_v4` (mirrors restore-from-backup.spec.ts pattern). With no
 * `signedIn` session, both export handlers skip the cloud-fetch + audit-fetch
 * branch and the export degrades to local-only — which is the exact path
 * exercised here (cloud-fetch path is covered by the unit tests against the
 * fetchCloudExtras / fetchAuditSummary contract).
 */
import { expect, test } from '@playwright/test';

const STORAGE_KEY = 'leanshot_v4';

const SEEDED_USER = {
  name: 'Export Test User',
  medication: 'tirzepatide',
  startDate: '2026-01-01',
  startWeight: 100,
  height: 175,
  age: 35,
  sex: 'male',
  bodyFat: null,
  goalWeight: 80,
  goal: 'fat-loss',
  dose: '2.5',
  doseUnit: 'mg',
  units: 'metric',
  proteinTarget: 130,
  calorieTarget: 1800,
  fiberTarget: 30,
  waterTarget: 8,
  injectionDay: 1,
  activityLevel: 'moderate',
  liftingLevel: 'beginner',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const SEEDED_PERSISTED_STATE = {
  state: {
    user: SEEDED_USER,
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
    acknowledgedDisclaimer: 'v1',
    pendingOps: [],
    verificationBannerDismissedUntil: null,
    migration_state: null,
  },
  version: 8,
};

const DATE_RE = /^leanshot-export-\d{4}-\d{2}-\d{2}\.(json|pdf)$/;

test.describe('Settings → Data export (COMPL-06)', () => {
  test.setTimeout(45_000);

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(
      ([key, val, tourKey]) => {
        try {
          localStorage.setItem(key as string, val as string);
          localStorage.setItem(tourKey as string, '1');
        } catch {
          /* private-mode — test would fail anyway */
        }
      },
      [STORAGE_KEY, JSON.stringify(SEEDED_PERSISTED_STATE), 'leanshot_tour_seen_v4'],
    );
  });

  test('Export JSON downloads leanshot-export-<date>.json', async ({ page }) => {
    await page.goto('/');

    // Open Settings → Data section (mirrors restore-from-backup.spec.ts).
    await page.getByRole('button', { name: /open settings/i }).first().click({ timeout: 10_000 });
    await page.getByRole('button', { name: /^data$/i }).click();

    const [dl] = await Promise.all([
      page.waitForEvent('download', { timeout: 10_000 }),
      page.getByRole('button', { name: /^export json$/i }).click(),
    ]);
    const filename = dl.suggestedFilename();
    expect(filename).toMatch(DATE_RE);
    expect(filename.endsWith('.json')).toBe(true);
  });

  test('Export PDF rollup downloads leanshot-export-<date>.pdf', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('button', { name: /open settings/i }).first().click({ timeout: 10_000 });
    await page.getByRole('button', { name: /^data$/i }).click();

    const [dl] = await Promise.all([
      page.waitForEvent('download', { timeout: 15_000 }),
      page.getByRole('button', { name: /export pdf rollup/i }).click(),
    ]);
    const filename = dl.suggestedFilename();
    expect(filename).toMatch(DATE_RE);
    expect(filename.endsWith('.pdf')).toBe(true);
  });
});
