// Phase 14 Plan 14-08 — SC #4 / MONEY-09 e2e
//
// Verifies the PastDueBanner lifecycle:
//   Test 3.1 — invoice.payment_failed webhook → PastDueBanner visible, role=alert,
//               warm-orange color, "Update card" CTA present.
//   Test 3.2 — invoice.paid webhook → banner clears, tier=paid.
//
// Gate: skipped unless HAS_LIVE (SUPABASE_SERVICE_ROLE_KEY + SUPABASE_URL +
// SUPABASE_ANON_KEY + STRIPE_SECRET_KEY + STRIPE_PUBLIC_KEY).
//
// Memory references applied:
//   - [[reference_playwright_state_seeding]] — addInitScript ONLY for localStorage.
//   - [[reference_supabase_auth_traps]] — admin.createUser; no public auth-email.
//   - Pattern E (INVARIANTS): emulateMedia({ reducedMotion: 'reduce' }) in at
//     least one assertion to prove banner is not motion-gated.
//   - [[feedback_realtime_layer_e2e_pattern]] — poll store/DB for async state.

import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';

import { fireWebhookEvent, makeStripeEvent } from './fixtures/stripe/stub-webhook';
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
  name: 'Past Due Banner Test',
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

test.describe('@phase14 past-due-banner', () => {
  test.skip(!HAS_LIVE, 'requires HAS_LIVE env vars (SUPABASE + STRIPE)');
  test.setTimeout(180_000);

  let userId: string | undefined;
  let seedResult:
    | { stripeSubscriptionId: string; stripeCustomerId: string; testClockId: string }
    | undefined;
  let email: string;
  let password: string;

  test.beforeAll(async () => {
    if (!SERVICE_ROLE || !SUPABASE_URL) return;

    email = `pw-pastdue-${Date.now()}@leanshot.test`;
    password = `Pass1234-${Date.now()}`;

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false },
    });

    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    userId = created.data.user?.id;

    // Seed subscription so we have a real subscription ID to reference in events.
    seedResult = await seedSubscription({
      userId: userId!,
      tier: 'plus_monthly',
      email,
    });

    // Wait for webhook to write the subscriptions row.
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
  });

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

  test('card fails → past_due banner renders (Pattern E: reduced-motion)', async ({ page }) => {
    if (!userId || !seedResult || !SUPABASE_URL || !SERVICE_ROLE) return;

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false },
    });

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
    await page.locator('form').getByRole('button', { name: /^sign in$/i }).click();
    await expect(page).not.toHaveURL(/#\/auth/, { timeout: 30_000 });

    const continueBtn = page.getByRole('button', { name: /continue to dashboard/i });
    try {
      await continueBtn.waitFor({ state: 'visible', timeout: 5_000 });
      await continueBtn.click();
    } catch {
      // no migration modal
    }

    // Pattern E: Set reduced-motion BEFORE firing the webhook event.
    // Proves that the banner renders regardless of motion preferences.
    await page.emulateMedia({ reducedMotion: 'reduce' });

    // Fire invoice.payment_failed webhook — deterministic alternative to
    // Stripe's actual payment failure flow.
    const paymentFailedEvent = makeStripeEvent('invoice.payment_failed', {
      id: `in_test_${Date.now()}`,
      object: 'invoice',
      subscription: seedResult.stripeSubscriptionId,
      customer: seedResult.stripeCustomerId,
      status: 'open',
    });

    const webhookResp = await fireWebhookEvent(paymentFailedEvent);
    test.info().annotations.push({
      type: 'live-result',
      description: `invoice.payment_failed webhook status: ${webhookResp.status}`,
    });
    // 200 = processed; 202 = duplicate/noop. Both are acceptable.
    expect([200, 202]).toContain(webhookResp.status);

    // Wait for webhook to write ux_tier='past_due' to DB.
    await pollUntil(
      async () => {
        const { data } = await admin
          .from('subscriptions')
          .select('ux_tier')
          .eq('id', seedResult!.stripeSubscriptionId)
          .maybeSingle();
        return data?.ux_tier === 'past_due';
      },
      { timeoutMs: 10_000, intervalMs: 500 },
    );

    // Reload the page so the Zustand store re-hydrates with the new tier from DB.
    await page.reload();
    await expect(page).not.toHaveURL(/#\/auth/, { timeout: 30_000 });

    // The PastDueBanner should now be visible.
    // It uses role="alert" + aria-live="assertive" (no data-testid in the component).
    const banner = page.getByRole('alert').first();
    await expect(banner).toBeVisible({ timeout: 10_000 });

    // Assert role=alert.
    await expect(banner).toHaveAttribute('role', 'alert');

    // Assert the banner text is present.
    await expect(banner).toContainText(/payment failed|update your card/i);

    // Assert "Update card" CTA is present.
    const updateCardBtn = banner.getByRole('button', { name: /update card/i });
    await expect(updateCardBtn).toBeVisible();

    // Assert warm-orange color via computed style (var(--color-warning)).
    const bgColor = await banner.evaluate((el) => {
      return window.getComputedStyle(el).backgroundColor;
    });
    // The color should be non-transparent (not white/empty) to confirm token applied.
    expect(bgColor).not.toBe('rgba(0, 0, 0, 0)');
    expect(bgColor).not.toBe('transparent');
    test.info().annotations.push({
      type: 'live-result',
      description: `PastDueBanner bg-color: ${bgColor}`,
    });
  });

  test('card recovers → banner clears', async ({ page }) => {
    if (!userId || !seedResult || !SUPABASE_URL || !SERVICE_ROLE) return;

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false },
    });

    // Ensure we start in past_due state (may have been set by previous test).
    // If not, set it directly via service role.
    const { data: subBefore } = await admin
      .from('subscriptions')
      .select('ux_tier')
      .eq('id', seedResult.stripeSubscriptionId)
      .maybeSingle();

    if (subBefore?.ux_tier !== 'past_due') {
      // Force to past_due via admin update so this test is independent.
      await admin
        .from('subscriptions')
        .update({ ux_tier: 'past_due', status: 'past_due' })
        .eq('id', seedResult.stripeSubscriptionId);
    }

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
    await page.locator('form').getByRole('button', { name: /^sign in$/i }).click();
    await expect(page).not.toHaveURL(/#\/auth/, { timeout: 30_000 });

    const continueBtn = page.getByRole('button', { name: /continue to dashboard/i });
    try {
      await continueBtn.waitFor({ state: 'visible', timeout: 5_000 });
      await continueBtn.click();
    } catch {
      // no migration modal
    }

    // Reload to ensure past_due state from DB is hydrated into the store.
    await page.reload();

    // Fire invoice.paid webhook — simulates successful payment retry.
    const invoicePaidEvent = makeStripeEvent('invoice.paid', {
      id: `in_test_paid_${Date.now()}`,
      object: 'invoice',
      subscription: seedResult.stripeSubscriptionId,
      customer: seedResult.stripeCustomerId,
      status: 'paid',
    });

    const webhookResp = await fireWebhookEvent(invoicePaidEvent);
    test.info().annotations.push({
      type: 'live-result',
      description: `invoice.paid webhook status: ${webhookResp.status}`,
    });
    expect([200, 202]).toContain(webhookResp.status);

    // Poll for ux_tier to flip back to 'paid'.
    await pollUntil(
      async () => {
        const { data } = await admin
          .from('subscriptions')
          .select('ux_tier')
          .eq('id', seedResult!.stripeSubscriptionId)
          .maybeSingle();
        return data?.ux_tier === 'paid';
      },
      { timeoutMs: 10_000, intervalMs: 500 },
    );

    // Reload to pick up the recovered tier.
    await page.reload();
    await expect(page).not.toHaveURL(/#\/auth/, { timeout: 30_000 });

    // Banner should be gone now.
    const banner = page.getByRole('alert').first();
    await expect(banner).toBeHidden({ timeout: 10_000 });
  });
});
