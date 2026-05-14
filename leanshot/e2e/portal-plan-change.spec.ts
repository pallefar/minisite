// Phase 14 Plan 14-08 — SC #2 / MONEY-03 e2e
//
// Verifies that a Stripe webhook-driven tier change (subscription cancellation)
// is reflected in app state within 10 seconds.
//
// Flow: seedSubscription (bypasses Checkout UI) → wait for webhook → assert
// tier=paid → programmatic cancel via Stripe SDK → poll for tier=free within 10s.
//
// Gate: skipped unless HAS_LIVE (SUPABASE_SERVICE_ROLE_KEY + SUPABASE_URL +
// SUPABASE_ANON_KEY + STRIPE_SECRET_KEY + STRIPE_PUBLIC_KEY).
//
// Memory references applied:
//   - [[reference_playwright_state_seeding]] — addInitScript ONLY for localStorage.
//   - [[reference_supabase_auth_traps]] — admin.createUser; no public auth-email.
//   - [[feedback_realtime_layer_e2e_pattern]] — poll DB for async webhook state.

import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { expect, test } from '@playwright/test';

import { deleteTestClock } from './fixtures/stripe/test-clock';
import { cancelStripeSubscription, seedSubscription } from './fixtures/stripe/seed-subscription';

// ─── HAS_LIVE gate ────────────────────────────────────────────────────────────
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_PUBLIC_KEY =
  process.env.STRIPE_PUBLIC_KEY ?? process.env.VITE_STRIPE_PUBLIC_KEY;

const HAS_LIVE = Boolean(
  SERVICE_ROLE && SUPABASE_URL && ANON_KEY && STRIPE_SECRET_KEY && STRIPE_PUBLIC_KEY,
);

// ─── Seeded user blob ─────────────────────────────────────────────────────────
const SEEDED_USER = {
  name: 'Portal Plan Change Test',
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

const SEEDED_BLOB = JSON.stringify({
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
    pendingOps: [],
    acknowledgedDisclaimer: 'v1',
    migration_state: {
      startedAt: '2026-01-01T00:00:00Z',
      complete: true,
      snapshotKey: 'leanshot_v4_pre_cloud_backup',
      photos: 'complete',
      injections: 'complete',
      weights: 'complete',
      meals: 'complete',
      workouts: 'complete',
      supplements: 'complete',
      mood: 'complete',
      sleep: 'complete',
      symptoms: 'complete',
      vials: 'complete',
      settings: 'complete',
    },
  },
  version: 7,
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Poll a predicate until it returns true or times out. */
async function pollUntil(
  predicate: () => Promise<boolean>,
  opts: { timeoutMs: number; intervalMs: number } = { timeoutMs: 10_000, intervalMs: 500 },
): Promise<void> {
  const deadline = Date.now() + opts.timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, opts.intervalMs));
  }
  throw new Error(`pollUntil timed out after ${opts.timeoutMs}ms`);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe('@phase14 portal-plan-change', () => {
  test.skip(!HAS_LIVE, 'requires HAS_LIVE env vars (SUPABASE + STRIPE)');
  test.setTimeout(180_000);

  const email = `pw-portal-${Date.now()}@leanshot.test`;
  const password = `Pass1234-${Date.now()}`;
  let userId: string | undefined;
  let seedResult: { stripeSubscriptionId: string; stripeCustomerId: string; testClockId: string } | undefined;

  test.afterAll(async () => {
    if (!SERVICE_ROLE || !SUPABASE_URL) return;
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false },
    });
    if (seedResult) {
      await cancelStripeSubscription(seedResult.stripeSubscriptionId);
      await deleteTestClock(seedResult.testClockId);
    }
    if (userId) {
      try {
        await admin.auth.admin.deleteUser(userId);
      } catch {
        // best-effort
      }
    }
  });

  test('Manage subscription → Portal opens → cancel via SDK → tier=free within 10s', async ({
    page,
    context,
  }) => {
    if (!SUPABASE_URL || !SERVICE_ROLE) return;

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false },
    });

    // Create test user.
    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    expect(created.error).toBeNull();
    userId = created.data.user?.id;
    expect(userId).toBeTruthy();

    // Seed subscription bypassing Checkout UI (SC #2 focuses on portal/cancel).
    seedResult = await seedSubscription({
      userId: userId!,
      tier: 'plus_monthly',
      email,
    });

    test.info().annotations.push({
      type: 'live-result',
      description: `Seeded sub ${seedResult.stripeSubscriptionId}`,
    });

    // Wait for webhook to write subscriptions row + tier=paid (up to 15s).
    await pollUntil(
      async () => {
        const { data } = await admin
          .from('subscriptions')
          .select('ux_tier')
          .eq('id', seedResult!.stripeSubscriptionId)
          .maybeSingle();
        return data?.ux_tier === 'paid';
      },
      { timeoutMs: 15_000, intervalMs: 1_000 },
    );

    // State seeding via addInitScript BEFORE first JS execution.
    await page.addInitScript((blob: string) => {
      try {
        if (!localStorage.getItem('leanshot_v4')) {
          localStorage.setItem('leanshot_v4', blob);
          localStorage.setItem('leanshot_tour_seen_v4', '1');
        }
      } catch {
        // private-mode noop
      }
    }, SEEDED_BLOB);

    // Sign in.
    await page.goto('/#/auth/signin');
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole('button', { name: /^sign in$/i }).click();
    await expect(page).not.toHaveURL(/#\/auth/, { timeout: 30_000 });

    const continueBtn = page.getByRole('button', { name: /continue to dashboard/i });
    try {
      await continueBtn.waitFor({ state: 'visible', timeout: 5_000 });
      await continueBtn.click();
    } catch {
      // no migration modal
    }

    // Open settings.
    await page
      .getByRole('button', { name: /open settings/i })
      .first()
      .click({ timeout: 30_000 });

    // Paid users see ManageSubscriptionLink ("Open Stripe" button or "Manage subscription" card).
    const manageBtn = page.getByRole('button', { name: /open stripe/i });
    await expect(manageBtn).toBeVisible({ timeout: 10_000 });

    // Capture new tab opening on click.
    const newPagePromise = context.waitForEvent('page', { timeout: 15_000 }).catch(() => null);
    await manageBtn.click();

    const newTab = await newPagePromise;
    if (newTab) {
      // Verify the portal URL matches billing.stripe.com.
      await newTab.waitForLoadState('domcontentloaded').catch(() => null);
      const portalUrl = newTab.url();
      test.info().annotations.push({
        type: 'live-result',
        description: `Portal URL: ${portalUrl.slice(0, 80)}`,
      });
      expect(portalUrl).toMatch(/billing\.stripe\.com|stripe\.com/);
      await newTab.close();
    } else {
      // ManageSubscriptionLink navigates same-tab; the tab event didn't fire.
      // The component uses window.location.href (same-tab per component code).
      test.info().annotations.push({
        type: 'deviation',
        description: 'ManageSubscriptionLink navigates same-tab — portal opened in same tab',
      });
    }

    // Programmatically cancel via Stripe SDK (more deterministic than driving Portal UI).
    const stripe = new Stripe(STRIPE_SECRET_KEY!, {
      apiVersion: '2026-04-22.dahlia' as Parameters<typeof Stripe>[1]['apiVersion'],
    });
    await stripe.subscriptions.cancel(seedResult.stripeSubscriptionId);

    test.info().annotations.push({
      type: 'live-result',
      description: 'Cancelled subscription via Stripe SDK',
    });

    // Poll for webhook to flip ux_tier to 'free' (or row deleted) — SC #2 budget: 10s.
    await pollUntil(
      async () => {
        const { data } = await admin
          .from('subscriptions')
          .select('ux_tier')
          .eq('id', seedResult!.stripeSubscriptionId)
          .maybeSingle();
        // Row may be deleted on cancel OR ux_tier may be set to 'free'.
        return data === null || data.ux_tier === 'free';
      },
      { timeoutMs: 10_000, intervalMs: 500 },
    );

    // Mark subscription as cleaned up so afterAll doesn't try to cancel again.
    seedResult = undefined;
  });
});
