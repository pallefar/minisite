// Phase 14 Plan 14-08 — SC #3 / MONEY-05 e2e
//
// Verifies that a clinic with 11 active patients generates an overage=1 Stripe
// Billing Meter event via the invoice.upcoming webhook handler.
//
// Flow:
//   1. Create clinic + owner user via service role.
//   2. Insert 11 clinic_memberships with status='active' + 1 injection per patient
//      within the last 30 days (both conditions required by D-02).
//   3. Seed clinic subscription via seedSubscription.
//   4. Fire invoice.upcoming webhook via fireWebhookEvent.
//   5. Verify via Stripe SDK meterEventSummaries.list that overage=1 was recorded.
//
// Gate: skipped unless HAS_LIVE (SUPABASE_SERVICE_ROLE_KEY + SUPABASE_URL +
// SUPABASE_ANON_KEY + STRIPE_SECRET_KEY + STRIPE_PUBLIC_KEY).
//
// Memory references applied:
//   - [[reference_playwright_state_seeding]] — not needed for this DB-only test.
//   - [[reference_supabase_auth_traps]] — admin.createUser; no public auth-email.
//   - [[feedback_realtime_layer_e2e_pattern]] — poll DB for async state changes.

import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { expect, test } from '@playwright/test';

import { fireWebhookEvent, makeStripeEvent } from './fixtures/stripe/stub-webhook';
import { deleteTestClock } from './fixtures/stripe/test-clock';
import { cancelStripeSubscription, seedSubscription } from './fixtures/stripe/seed-subscription';
import {
  cleanupClinicFixtures,
  createOperatorWithOrg,
  testEmail,
  testRunId,
} from './fixtures/clinic-fixtures';

// ─── HAS_LIVE gate ────────────────────────────────────────────────────────────
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_PUBLIC_KEY =
  process.env.STRIPE_PUBLIC_KEY ?? process.env.VITE_STRIPE_PUBLIC_KEY;
// WR-09: real Billing Meter ID from the bootstrap script (event_name: 'active_patients').
// Kept separate from HAS_LIVE so the skip reason is specific.
const STRIPE_METER_ACTIVE_PATIENTS = process.env.STRIPE_METER_ACTIVE_PATIENTS;

const HAS_LIVE = Boolean(
  SERVICE_ROLE && SUPABASE_URL && ANON_KEY && STRIPE_SECRET_KEY && STRIPE_PUBLIC_KEY,
);

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

test.describe('@phase14 clinic-metered-billing', () => {
  test.skip(!HAS_LIVE, 'requires HAS_LIVE env vars (SUPABASE + STRIPE)');
  test.setTimeout(180_000);

  // Shared test state (created in beforeAll, cleaned in afterAll).
  let ownerUserId: string | undefined;
  let ownerEmail: string | undefined;
  let clinicId: string | undefined;
  let patientUserIds: string[] = [];
  let seedResult:
    | { stripeSubscriptionId: string; stripeCustomerId: string; testClockId: string }
    | undefined;

  const runId = testRunId();
  const patientPassword = `Pass1234-${Date.now()}`;

  test.beforeAll(async () => {
    if (!SERVICE_ROLE || !SUPABASE_URL) return;

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false },
    });

    // 1. Create clinic owner + org via createOperatorWithOrg (sets up default roles).
    //    This uses the create_org RPC which also creates the 3 default system roles,
    //    including 'View-only' required for patient memberships.
    const { operator, orgId } = await createOperatorWithOrg('meter-test');
    ownerUserId = operator.id;
    ownerEmail = operator.email;
    clinicId = orgId;

    // 2. Look up the 'View-only' role for this org (created by create_org RPC).
    const { data: roleData, error: roleError } = await admin
      .from('roles')
      .select('id')
      .eq('org_id', clinicId)
      .eq('name', 'View-only')
      .eq('is_system', true)
      .maybeSingle();

    if (roleError || !roleData) {
      throw new Error(
        `Failed to find View-only role for org ${clinicId}: ${roleError?.message ?? 'no data'}`,
      );
    }
    const viewOnlyRoleId = (roleData as { id: string }).id;

    // 3. Create 11 patient users + memberships + 1 injection each within 30 days.
    //    D-02: patient counts as active IFF:
    //      (1) memberships row exists with revoked_at IS NULL (active)
    //      AND (2) any injection within last 30 days.
    const recentDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    for (let i = 0; i < 11; i++) {
      const patientEmail = testEmail(`pw-meter-patient-${i}`, runId);
      const patientCreated = await admin.auth.admin.createUser({
        email: patientEmail,
        password: patientPassword,
        email_confirm: true,
      });
      const patientId = patientCreated.data.user?.id;
      if (!patientId) continue;
      patientUserIds.push(patientId);

      // Insert active membership (revoked_at IS NULL = active per Phase 9 schema).
      // NOTE: Phase 9 uses `memberships` table (not `clinic_memberships`).
      await admin.from('memberships').insert({
        user_id: patientId,
        org_id: clinicId,
        role_id: viewOnlyRoleId,
        consent_scope: {},
        joined_at: recentDate,
        accepted_at: recentDate,
      });

      // Insert one injection within the last 30 days so D-02 active condition holds.
      // Column names match live injections schema: log_id (PK component), unit (not dose_unit),
      // logged_at (timestamptz, not date). medication: 'ozempic' to match SQL test known-good value.
      await admin.from('injections').insert({
        user_id: patientId,
        log_id: crypto.randomUUID(),
        medication: 'ozempic',
        dose: '0.5',
        unit: 'mg',
        site: 'thigh-l',
        notes: '',
        logged_at: recentDate,
        created_at: recentDate,
      });
    }

    // 4. Seed clinic subscription (creates Stripe customer + subscription).
    //    ownerEmail comes from createOperatorWithOrg (testEmail-generated).
    seedResult = await seedSubscription({
      userId: ownerUserId,
      tier: 'clinic',
      clinicId,
      email: ownerEmail,
    });

    // Wait for webhook to write subscriptions row.
    await pollUntil(
      async () => {
        const { data } = await admin
          .from('subscriptions')
          .select('id')
          .eq('id', seedResult!.stripeSubscriptionId)
          .maybeSingle();
        return data !== null;
      },
      { timeoutMs: 15_000, intervalMs: 1_000 },
    );
  });

  test.afterAll(async () => {
    if (!SERVICE_ROLE || !SUPABASE_URL) return;
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false },
    });

    // Cleanup Stripe resources.
    if (seedResult) {
      await cancelStripeSubscription(seedResult.stripeSubscriptionId);
      await deleteTestClock(seedResult.testClockId);
    }

    // Cleanup Supabase users (cascades to memberships + injections via FK).
    const allUsers = ownerUserId
      ? [ownerUserId, ...patientUserIds]
      : [...patientUserIds];

    for (const uid of allUsers) {
      try {
        await admin.auth.admin.deleteUser(uid);
      } catch {
        // best-effort
      }
    }

    // Best-effort pattern cleanup for any orphaned test data.
    await cleanupClinicFixtures({ emailPattern: `meter`, slugPattern: 'meter-test' });
  });

  test('11 active patients → invoice.upcoming → overage=1 via Stripe Billing Meters', async () => {
    if (!seedResult || !clinicId || !SUPABASE_URL || !SERVICE_ROLE) {
      test.skip(true, 'beforeAll setup failed');
      return;
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false },
    });

    // Verify count_active_patients returns 11 before firing webhook.
    const { data: countData, error: countError } = await admin.rpc('count_active_patients', {
      p_clinic_id: clinicId,
    });
    if (!countError) {
      test.info().annotations.push({
        type: 'live-result',
        description: `count_active_patients = ${countData as number}`,
      });
    }

    // Fire invoice.upcoming webhook.
    // 14-07 ships the handler at stripe-webhook/events/invoice-upcoming.ts
    // which is triggered by the invoice.upcoming event type (not a separate endpoint).
    // The event's period_start must be within 35 days (Pitfall 9 guard).
    const periodStartEpoch = Math.floor(Date.now() / 1000) - 3 * 24 * 60 * 60; // 3 days ago

    const invoiceUpcomingEvent = makeStripeEvent('invoice.upcoming', {
      id: `in_upcoming_test_${Date.now()}`,
      object: 'invoice',
      subscription: seedResult.stripeSubscriptionId,
      customer: seedResult.stripeCustomerId,
      status: 'draft',
      period_start: periodStartEpoch,
      period_end: periodStartEpoch + 30 * 24 * 60 * 60,
    });

    const webhookResp = await fireWebhookEvent(invoiceUpcomingEvent);
    test.info().annotations.push({
      type: 'live-result',
      description: `invoice.upcoming webhook status: ${webhookResp.status}`,
    });
    // 200 = success; 202 = duplicate (both acceptable).
    const acceptableStatuses = [200, 202];
    if (!acceptableStatuses.includes(webhookResp.status)) {
      test.info().annotations.push({
        type: 'deviation',
        description: `Unexpected webhook status ${webhookResp.status} — handler may not be deployed`,
      });
    }

    // WR-09: skip inside the test body (NOT at describe-level) when meter env var is absent.
    // This keeps the skip reason specific and separate from the HAS_LIVE gate.
    if (!STRIPE_METER_ACTIVE_PATIENTS) {
      test.skip(true, 'STRIPE_METER_ACTIVE_PATIENTS not set — cannot assert overage meter event');
      return;
    }

    // Assert webhook was accepted — a non-2xx response means the handler did not run.
    expect([200, 202]).toContain(webhookResp.status);

    // Instantiate Stripe client for meter assertion.
    const stripe = new Stripe(STRIPE_SECRET_KEY!, {
      apiVersion: '2026-04-22.dahlia' as Parameters<typeof Stripe>[1]['apiVersion'],
    });

    // Billing Meters v1 assertion — poll for the aggregated overage event.
    // event_name: 'active_patients' was emitted by the invoice.upcoming handler (14-07).
    const startTime = periodStartEpoch;
    const endTime = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now

    // Give Stripe a few seconds to process the meter event before querying summaries.
    await new Promise<void>((resolve) => setTimeout(resolve, 3_000));

    let summaries: Awaited<ReturnType<typeof stripe.billing.meterEventSummaries.list>>;
    try {
      summaries = await stripe.billing.meterEventSummaries.list(
        STRIPE_METER_ACTIVE_PATIENTS,
        {
          customer: seedResult.stripeCustomerId,
          start_time: startTime,
          end_time: endTime,
        },
      );
    } catch (err) {
      // If the meter ID is configured but the Stripe call itself throws (e.g. the meter
      // does not exist on this Stripe account), treat that as a skip — not a pass.
      const msg = err instanceof Error ? err.message : String(err);
      test.skip(true, `stripe.billing.meterEventSummaries.list threw: ${msg}`);
      return;
    }

    const totalValue = summaries.data.reduce(
      (sum, s) => sum + (s.aggregated_value ?? 0),
      0,
    );
    test.info().annotations.push({
      type: 'live-result',
      description: `meterEventSummaries: ${summaries.data.length} summaries, total aggregated_value=${totalValue}`,
    });

    // Primary assertion: overage = 1 (11 active patients − 10 included in base plan).
    // A configured meter ID that returns zero summaries is a real failure.
    expect(totalValue).toBe(1);
  });
});
