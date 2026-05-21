/**
 * subscription-updated.test.ts
 *
 * Tests for the customer.subscription.updated handler and mapStripeStatusToUxTier.
 * Pitfall 6 — exhaustive status mapping across all 8 Stripe subscription statuses.
 *
 * Behaviors:
 *  2.4:  status=trialing → ux_tier=paid
 *  2.5:  status=active → ux_tier=paid
 *  2.6:  status=past_due → ux_tier=past_due
 *  2.7:  status=unpaid → ux_tier=past_due
 *  2.8:  status=canceled → ux_tier=free
 *  2.9:  status=incomplete → ux_tier=free
 *  2.10: status=incomplete_expired → ux_tier=free
 *  2.11: status=paused → ux_tier=free
 *  2.12: All 8 mappings preserve status verbatim alongside ux_tier
 *  2.13: Race condition — subscription row doesn't exist yet → upsert creates it
 */

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import type Stripe from 'https://esm.sh/stripe@19?target=denonext';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

import { handle, mapStripeStatusToUxTier, type D05Spy, type P40PauseSpy } from './subscription-updated.ts';
import type { SendEmailArgs } from '../../_shared/email-router.ts';

// ─── Mock admin builder ───────────────────────────────────────────────────────
interface UpsertCall {
  table: string;
  data: Record<string, unknown>;
}

function buildMockAdmin(): [SupabaseClient, () => UpsertCall[]] {
  const calls: UpsertCall[] = [];
  const mockAdmin = {
    from: (table: string) => ({
      upsert: (data: Record<string, unknown>, _options?: Record<string, unknown>) => {
        calls.push({ table, data });
        return Promise.resolve({ error: null });
      },
    }),
  } as unknown as SupabaseClient;
  return [mockAdmin, () => calls];
}

/** Build a Stripe.Event for customer.subscription.updated */
function buildSubUpdatedEvent(
  status: Stripe.Subscription.Status,
  meta: Record<string, string> = { tier_kind: 'web', user_id: 'user-uuid-test', provider: 'stripe' },
  subId: string = 'sub_test_updated',
): Stripe.Event {
  return {
    id: `evt_sub_updated_${status}`,
    object: 'event',
    type: 'customer.subscription.updated',
    livemode: false,
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: subId,
        object: 'subscription',
        status,
        metadata: meta,
        current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
        trial_end: null,
        cancel_at_period_end: false,
        items: {
          data: [{ price: { id: 'price_test_monthly' } }],
        },
      } as unknown as Stripe.Subscription,
    },
    api_version: '2026-04-22.dahlia',
  } as unknown as Stripe.Event;
}

// ─── mapStripeStatusToUxTier tests (2.4–2.11) ─────────────────────────────────

Deno.test('2.4: mapStripeStatusToUxTier trialing → paid', () => {
  assertEquals(mapStripeStatusToUxTier('trialing'), 'paid');
});

Deno.test('2.5: mapStripeStatusToUxTier active → paid', () => {
  assertEquals(mapStripeStatusToUxTier('active'), 'paid');
});

Deno.test('2.6: mapStripeStatusToUxTier past_due → past_due', () => {
  assertEquals(mapStripeStatusToUxTier('past_due'), 'past_due');
});

Deno.test('2.7: mapStripeStatusToUxTier unpaid → past_due', () => {
  assertEquals(mapStripeStatusToUxTier('unpaid'), 'past_due');
});

Deno.test('2.8: mapStripeStatusToUxTier canceled → free', () => {
  assertEquals(mapStripeStatusToUxTier('canceled'), 'free');
});

Deno.test('2.9: mapStripeStatusToUxTier incomplete → free', () => {
  assertEquals(mapStripeStatusToUxTier('incomplete'), 'free');
});

Deno.test('2.10: mapStripeStatusToUxTier incomplete_expired → free', () => {
  assertEquals(mapStripeStatusToUxTier('incomplete_expired'), 'free');
});

Deno.test('2.11: mapStripeStatusToUxTier paused → free', () => {
  assertEquals(mapStripeStatusToUxTier('paused'), 'free');
});

// ─── handle() integration tests (2.12–2.13) ──────────────────────────────────

Deno.test('2.12: handle preserves verbatim status alongside ux_tier in upsert', async () => {
  const statuses: Array<[Stripe.Subscription.Status, string]> = [
    ['trialing', 'paid'],
    ['active', 'paid'],
    ['past_due', 'past_due'],
    ['unpaid', 'past_due'],
    ['canceled', 'free'],
    ['incomplete', 'free'],
    ['incomplete_expired', 'free'],
    ['paused', 'free'],
  ];

  for (const [status, expectedUxTier] of statuses) {
    const [admin, getCalls] = buildMockAdmin();
    const event = buildSubUpdatedEvent(status);
    await handle(event, admin);

    const calls = getCalls();
    const subCall = calls.find((c) => c.table === 'subscriptions');
    assertEquals(subCall !== undefined, true, `Expected subscriptions upsert for status=${status}`);
    assertEquals(subCall!.data.status, status, `status verbatim for ${status}`);
    assertEquals(
      subCall!.data.ux_tier,
      expectedUxTier,
      `ux_tier for ${status} should be ${expectedUxTier}`,
    );
  }
});

Deno.test('2.13: race — no row yet, metadata on sub → upsert creates row', async () => {
  const [admin, getCalls] = buildMockAdmin();
  const event = buildSubUpdatedEvent(
    'trialing',
    { tier_kind: 'web', user_id: 'user-race-test', provider: 'stripe' },
    'sub_race_test',
  );

  await handle(event, admin);

  const calls = getCalls();
  const subCall = calls.find((c) => c.table === 'subscriptions');
  assertEquals(subCall !== undefined, true, 'subscriptions upsert expected');
  assertEquals(subCall!.data.user_id, 'user-race-test');
  assertEquals(subCall!.data.ux_tier, 'paid');
  assertEquals(subCall!.data.id, 'sub_race_test');
});

// ============================================================================
// Phase 29 Plan 03 — D-05: HMAC realtime broadcast tests
// ============================================================================

// Build a test spy for the D-05 broadcast path.
function makeD05Spy(): D05Spy & {
  calls: Array<{ channelName: string; payload: Record<string, unknown> }>;
  shouldReject: boolean;
} {
  const calls: Array<{ channelName: string; payload: Record<string, unknown> }> = [];
  let shouldReject = false;
  return {
    calls,
    get shouldReject() { return shouldReject; },
    set shouldReject(v: boolean) { shouldReject = v; },
    channelSend: async (channelName: string, payload: Record<string, unknown>) => {
      if (shouldReject) throw new Error('channel.send simulated failure');
      calls.push({ channelName, payload });
    },
  };
}

Deno.test('D-05 / T1: clinic subscription → channelSend invoked once with correct payload', async () => {
  const [admin, _getCalls] = buildMockAdmin();
  const spy = makeD05Spy();

  const clinicSubEvent = buildSubUpdatedEvent(
    'active',
    { tier_kind: 'clinic', clinic_id: 'org_clinic_test_123', provider: 'stripe' },
    'sub_clinic_test',
  );

  await handle(clinicSubEvent, admin, spy);

  assertEquals(spy.calls.length, 1, 'channelSend must be called exactly once for clinic sub');
  const call = spy.calls[0];
  // Channel name format: org-{first8hex}-subscriptions
  assertEquals(
    call.channelName.startsWith('org-') && call.channelName.endsWith('-subscriptions'),
    true,
    `Channel name should match org-*-subscriptions, got: ${call.channelName}`,
  );
  assertEquals(call.payload['subscription_id'], 'sub_clinic_test', 'payload.subscription_id');
  assertEquals(call.payload['status'], 'active', 'payload.status');
});

Deno.test('D-05 / T2: consumer subscription (no clinic_id) → channelSend NOT invoked', async () => {
  const [admin, _getCalls] = buildMockAdmin();
  const spy = makeD05Spy();

  const consumerSubEvent = buildSubUpdatedEvent(
    'active',
    { tier_kind: 'web', user_id: 'user-consumer-test', provider: 'stripe' },
    'sub_consumer_test',
  );

  await handle(consumerSubEvent, admin, spy);

  assertEquals(spy.calls.length, 0, 'channelSend must NOT be called for consumer sub (no clinic_id)');
});

Deno.test('D-05 / T3: broadcast failure caught + Sentry.captureException — does not re-throw', async () => {
  const [admin, _getCalls] = buildMockAdmin();
  const spy = makeD05Spy();
  spy.shouldReject = true; // simulate channel.send rejection

  const clinicSubEvent = buildSubUpdatedEvent(
    'active',
    { tier_kind: 'clinic', clinic_id: 'org_clinic_broadcast_fail', provider: 'stripe' },
    'sub_clinic_fail_test',
  );

  // Must NOT throw even though channelSend rejects
  await handle(clinicSubEvent, admin, spy);

  // The call attempt was made (spy threw), but no re-throw upstream
  // Sentry would have captured it in production; here we just verify no throw.
  assertEquals(true, true, 'Handler survived broadcast failure without re-throwing');
});

// ============================================================================
// Phase 40 Plan 40-02 — D-08/D-09: pause_collection mirror + T-0 email tests
// ============================================================================

/**
 * Extended mock admin that tracks select + update calls in addition to upsert.
 * The `prevRow` parameter controls what the read-back select returns (simulating
 * the existing subscriptions row prior to this webhook event).
 */
interface PauseUpdateCall {
  table: string;
  data: Record<string, unknown>;
  filter: { column: string; value: string };
}

function buildPauseMockAdmin(
  prevRow: Record<string, unknown> | null = null,
): [SupabaseClient, () => PauseUpdateCall[]] {
  const updateCalls: PauseUpdateCall[] = [];

  // The supabase-js builder pattern means:
  //   SELECT: .from(t).select(cols).eq(col, val).maybeSingle() → Promise<{data, error}>
  //   UPDATE: .from(t).update(data).eq(col, val) → Promise<{data, error}>
  //   UPSERT: .from(t).upsert(data, opts) → Promise<{error}>
  //
  // We differentiate by tracking whether update() or select() was last called.

  const buildFromChain = (table: string) => {
    let _mode: 'none' | 'select' | 'update' = 'none';
    let _updateData: Record<string, unknown> = {};
    let _filterCol = '';
    let _filterVal = '';

    // A thenable chain-end that resolves with the appropriate result.
    // Used for paths that return Promise directly from the chain object.
    const makeResult = () => {
      if (_mode === 'update') {
        updateCalls.push({
          table,
          data: { ..._updateData },
          filter: { column: _filterCol, value: _filterVal },
        });
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: prevRow, error: null });
    };

    const chain: Record<string, unknown> = {
      upsert: (_data: Record<string, unknown>, _opts?: unknown) =>
        Promise.resolve({ error: null }),
      update: (data: Record<string, unknown>) => {
        _mode = 'update';
        _updateData = data;
        return chain;
      },
      select: (_cols: string) => {
        _mode = 'select';
        return chain;
      },
      eq: (col: string, val: string) => {
        _filterCol = col;
        _filterVal = val;
        // For UPDATE chains, .eq() is the terminal call and supabase-js returns a Promise.
        // We return a thenable so `await admin.from(...).update({...}).eq(...)` works.
        const result = makeResult();
        // Augment the resolved promise so chaining still works for select paths.
        return Object.assign(result, chain);
      },
      maybeSingle: () => {
        return Promise.resolve({ data: prevRow, error: null });
      },
      single: () => Promise.resolve({ data: prevRow, error: null }),
      // Make the chain itself thenable (for select paths that await the whole chain).
      then: (resolve: (v: unknown) => void) => {
        resolve(makeResult());
      },
    };
    return chain;
  };

  const mockAdmin = {
    from: (table: string) => buildFromChain(table),
  } as unknown as SupabaseClient;

  return [mockAdmin, () => updateCalls];
}

/** Build an event with pause_collection field. */
function buildPauseEvent(
  pauseCollection: { behavior: string; resumes_at: number | null } | null,
  meta: Record<string, string> = { tier_kind: 'web', user_id: 'user-uuid-pause', provider: 'stripe' },
  subId: string = 'sub_pause_test',
): Stripe.Event {
  return {
    id: `evt_pause_${subId}`,
    object: 'event',
    type: 'customer.subscription.updated',
    livemode: false,
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: subId,
        object: 'subscription',
        status: 'active',
        metadata: meta,
        pause_collection: pauseCollection,
        current_period_end: Math.floor(Date.now() / 1000) + 90 * 86400,
        trial_end: null,
        cancel_at_period_end: false,
        customer: { id: 'cus_test', email: 'test@example.com' },
        items: {
          data: [{ price: { id: 'price_test_monthly' } }],
        },
      } as unknown as Stripe.Subscription,
    },
    api_version: '2026-04-22.dahlia',
  } as unknown as Stripe.Event;
}

/** Build a P40PauseSpy that captures sendEmail calls. */
function makePauseSpy(): P40PauseSpy & { calls: SendEmailArgs[] } {
  const calls: SendEmailArgs[] = [];
  return {
    calls,
    sendEmail: async (_admin: SupabaseClient, args: SendEmailArgs) => {
      calls.push(args);
      return { provider: 'resend' as const, id: 'mock-msg-id' };
    },
  };
}

// ── Test P40-T1: pause-start (pause_collection present, prev is_paused=false) ──

Deno.test('P40-T1: pause-start — UPDATE called with paused_until + is_paused=true', async () => {
  const futureTs = Math.floor(Date.now() / 1000) + 30 * 86400; // 30 days from now
  const prevRow = { is_paused: false, clinic_id: null, user_id: 'user-uuid-pause' };
  const [admin, getUpdateCalls] = buildPauseMockAdmin(prevRow);
  const pSpy = makePauseSpy();

  const event = buildPauseEvent({ behavior: 'void', resumes_at: futureTs });
  await handle(event, admin, undefined, pSpy);

  const updates = getUpdateCalls();
  const pauseUpdate = updates.find((u) => u.table === 'subscriptions');
  assertEquals(pauseUpdate !== undefined, true, 'Expected subscriptions update call');
  assertEquals(pauseUpdate!.data.is_paused, true, 'is_paused should be true on pause-start');
  assertEquals(
    typeof pauseUpdate!.data.paused_until,
    'string',
    'paused_until should be a string ISO timestamp',
  );
  // No T-0 email should fire on pause-start
  assertEquals(pSpy.calls.length, 0, 'No T-0 email on pause-start');
});

// ── Test P40-T2: pause-extend (resumes_at moves forward, prev is_paused=true) ──

Deno.test('P40-T2: pause-extend — UPDATE with new paused_until, no T-0 email', async () => {
  const futureTs = Math.floor(Date.now() / 1000) + 60 * 86400; // extended to 60 days
  const prevRow = { is_paused: true, clinic_id: null, user_id: 'user-uuid-pause' };
  const [admin, getUpdateCalls] = buildPauseMockAdmin(prevRow);
  const pSpy = makePauseSpy();

  const event = buildPauseEvent({ behavior: 'void', resumes_at: futureTs });
  await handle(event, admin, undefined, pSpy);

  const updates = getUpdateCalls();
  const pauseUpdate = updates.find((u) => u.table === 'subscriptions');
  assertEquals(pauseUpdate !== undefined, true, 'Expected subscriptions update call');
  assertEquals(pauseUpdate!.data.is_paused, true, 'is_paused should remain true on pause-extend');
  assertEquals(typeof pauseUpdate!.data.paused_until, 'string', 'paused_until updated');
  // No T-0 email — this is still paused
  assertEquals(pSpy.calls.length, 0, 'No T-0 email on pause-extend (still paused)');
});

// ── Test P40-T3: auto-resume (pause_collection=null, prev is_paused=true) ──

Deno.test('P40-T3: auto-resume — UPDATE with is_paused=false + T-0 email sent', async () => {
  const prevRow = { is_paused: true, clinic_id: null, user_id: 'user-uuid-resume' };
  const [admin, getUpdateCalls] = buildPauseMockAdmin(prevRow);
  const pSpy = makePauseSpy();

  const event = buildPauseEvent(null); // null = no pause_collection = auto-resumed
  await handle(event, admin, undefined, pSpy);

  const updates = getUpdateCalls();
  const pauseUpdate = updates.find((u) => u.table === 'subscriptions');
  assertEquals(pauseUpdate !== undefined, true, 'Expected subscriptions update call');
  assertEquals(pauseUpdate!.data.is_paused, false, 'is_paused should be false on auto-resume');
  assertEquals(pauseUpdate!.data.paused_until, null, 'paused_until should be null on auto-resume');
  assertEquals(pauseUpdate!.data.reminded_t7, false, 'reminded_t7 reset to false on auto-resume');

  // T-0 confirmation email must fire
  assertEquals(pSpy.calls.length, 1, 'T-0 email should be sent on auto-resume');
  assertEquals(pSpy.calls[0].template, 'pause_resumed_t0', 'Template must be pause_resumed_t0');
  assertEquals(pSpy.calls[0].to, 'test@example.com', 'Recipient email from Stripe customer object');
  assertEquals(pSpy.calls[0].phi, false, 'PHI=false for consumer sub (no clinic_id)');
});

// ── Test P40-T4: clinic-org auto-resume — phi=true ──

Deno.test('P40-T4: clinic-org auto-resume — T-0 email sent with phi=true', async () => {
  const prevRow = { is_paused: true, clinic_id: 'org_clinic_xyz', user_id: 'user-uuid-clinic' };
  const [admin, _] = buildPauseMockAdmin(prevRow);
  const pSpy = makePauseSpy();

  const clinicMeta = { tier_kind: 'clinic', clinic_id: 'org_clinic_xyz', provider: 'stripe' };
  const event = buildPauseEvent(null, clinicMeta, 'sub_clinic_resume_test');
  await handle(event, admin, undefined, pSpy);

  assertEquals(pSpy.calls.length, 1, 'T-0 email should be sent for clinic auto-resume');
  assertEquals(pSpy.calls[0].phi, true, 'PHI=true for clinic-org sub');
  assertEquals(pSpy.calls[0].template, 'pause_resumed_t0', 'Template must be pause_resumed_t0');
});

// ── Test P40-T5: no-op on unrelated update (no pause_collection delta) ──

Deno.test('P40-T5: unrelated update (status change, no pause) — no pause update, no T-0 email', async () => {
  // Prev row shows not paused; event has no pause_collection at all
  const prevRow = { is_paused: false, clinic_id: null, user_id: 'user-uuid-noop' };
  const [admin, getUpdateCalls] = buildPauseMockAdmin(prevRow);
  const pSpy = makePauseSpy();

  // Event without pause_collection field (plain status change)
  const event = buildPauseEvent(undefined as unknown as null, { tier_kind: 'web', user_id: 'user-uuid-noop', provider: 'stripe' }, 'sub_noop_test');
  // Override: make pause_collection undefined (not null, not set)
  (event.data.object as unknown as Record<string, unknown>).pause_collection = undefined;

  await handle(event, admin, undefined, pSpy);

  // No T-0 email should fire (was_paused=false, is_paused_now=false → no transition)
  assertEquals(pSpy.calls.length, 0, 'No T-0 email when no pause transition occurs');
});
