/**
 * Deno tests for `pause-reminder-fire` Edge Function — Phase 40 Plan 40-02.
 *
 * Test plan:
 *   T1  missing bearer → 401
 *   T2  fire mode: 1 consumer sub in window → sendEmail called with phi=false, reminded_t7 set
 *   T3  fire mode: 1 clinic-org sub in window → sendEmail called with phi=true
 *   T4  fire mode: 1 sub missing email → skipped, errors++
 *   T5  reconcile mode: sub still paused on Stripe → no update, no email
 *   T6  reconcile mode: sub auto-resumed on Stripe → is_paused=false mirrored + T-0 email
 */
import { assertEquals } from 'jsr:@std/assert@^1';
import { resetMirrorAdminForTest, setMirrorAdminForTest } from '../_shared/posthog-server.ts';
import type { SendEmailArgs } from '../_shared/email-router.ts';

Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');
Deno.env.set('STRIPE_SECRET_KEY', 'sk_test_placeholder');

const { __internal, __setSendEmailForTest, __resetSendEmailForTest, __setStripeForTest, __resetStripeForTest } =
  await import('./index.ts');

function stubMirrorAdmin(): void {
  setMirrorAdminForTest({
    from: () => ({ insert: () => Promise.resolve({ data: null, error: null }) }),
  });
}

const VALID_HEADERS = {
  Authorization: 'Bearer test-service-role-key',
  'Content-Type': 'application/json',
};

function makeReq(mode?: string): Request {
  const url = mode
    ? `http://localhost/pause-reminder-fire?mode=${mode}`
    : 'http://localhost/pause-reminder-fire';
  return new Request(url, { method: 'POST', headers: VALID_HEADERS, body: '{}' });
}

// ─── T1: Missing bearer → 401 ────────────────────────────────────────────────

Deno.test('T1 — missing bearer → 401', async () => {
  const req = new Request('http://localhost/pause-reminder-fire', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  const res = await __internal.handler(req);
  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.error, 'unauthorized');
});

// ─── T2: fire mode — consumer sub in T-7d window, phi=false ─────────────────

Deno.test('T2 — fire: consumer sub in window → sendEmail phi=false, reminded_t7 set', async () => {
  const emailCalls: SendEmailArgs[] = [];
  const updateCalls: Array<{ data: Record<string, unknown>; id: string }> = [];

  const futureTs = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString(); // 3 days from now

  const fakeAdmin: unknown = {
    from: (table: string) => {
      if (table === 'subscriptions') {
        return {
          select: () => ({
            lt: () => ({ gt: () => ({ eq: () => ({ eq: () => ({ limit: () => Promise.resolve({
              data: [{ id: 'sub_consumer_1', user_id: 'user-123', clinic_id: null, paused_until: futureTs }],
              error: null,
            }) }) }) }) }),
          }),
          update: (data: Record<string, unknown>) => ({
            eq: (col: string, val: string) => {
              updateCalls.push({ data, id: val });
              return Promise.resolve({ data: null, error: null });
            },
          }),
        };
      }
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({
                data: { email: 'user@example.com', first_name: 'Alice' },
                error: null,
              }),
            }),
          }),
        };
      }
      return {};
    },
  };

  __internal.setAdminForTest(fakeAdmin);
  __setSendEmailForTest(async (_admin: unknown, args: SendEmailArgs) => {
    emailCalls.push(args);
    return { provider: 'resend' as const, id: 'mock-id' };
  });
  stubMirrorAdmin();

  try {
    const res = await __internal.handler(makeReq('fire'));
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.ok, true);
    assertEquals(body.mode, 'fire');
    assertEquals(body.sent, 1, 'Should send 1 email');
    assertEquals(body.errors, 0);

    assertEquals(emailCalls.length, 1, '1 email sent');
    assertEquals(emailCalls[0].template, 'pause_reminder_t7');
    assertEquals(emailCalls[0].to, 'user@example.com');
    assertEquals(emailCalls[0].phi, false, 'Consumer: phi=false');

    assertEquals(updateCalls.length, 1, 'reminded_t7 should be set');
    assertEquals(updateCalls[0].data.reminded_t7, true);
    assertEquals(updateCalls[0].id, 'sub_consumer_1');
  } finally {
    __internal.resetAdminForTest();
    __resetSendEmailForTest();
    resetMirrorAdminForTest();
  }
});

// ─── T3: fire mode — clinic-org sub, phi=true ────────────────────────────────

Deno.test('T3 — fire: clinic-org sub in window → sendEmail phi=true', async () => {
  const emailCalls: SendEmailArgs[] = [];
  const futureTs = new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString();

  const fakeAdmin: unknown = {
    from: (table: string) => {
      if (table === 'subscriptions') {
        return {
          select: () => ({
            lt: () => ({ gt: () => ({ eq: () => ({ eq: () => ({ limit: () => Promise.resolve({
              data: [{ id: 'sub_clinic_1', user_id: 'user-456', clinic_id: 'org_clinic_xyz', paused_until: futureTs }],
              error: null,
            }) }) }) }) }),
          }),
          update: (_data: unknown) => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
        };
      }
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({
                data: { email: 'clinic@example.com', first_name: 'Dr. Smith' },
                error: null,
              }),
            }),
          }),
        };
      }
      return {};
    },
  };

  __internal.setAdminForTest(fakeAdmin);
  __setSendEmailForTest(async (_admin: unknown, args: SendEmailArgs) => {
    emailCalls.push(args);
    return { provider: 'ses' as const, id: 'ses-mock-id' };
  });
  stubMirrorAdmin();

  try {
    const res = await __internal.handler(makeReq('fire'));
    assertEquals(res.status, 200);
    assertEquals(emailCalls.length, 1);
    assertEquals(emailCalls[0].phi, true, 'Clinic-org: phi=true');
    assertEquals(emailCalls[0].template, 'pause_reminder_t7');
  } finally {
    __internal.resetAdminForTest();
    __resetSendEmailForTest();
    resetMirrorAdminForTest();
  }
});

// ─── T4: fire mode — sub missing email → skipped, errors++ ──────────────────

Deno.test('T4 — fire: sub with no email → skipped, errors incremented', async () => {
  const emailCalls: SendEmailArgs[] = [];
  const futureTs = new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString();

  const fakeAdmin: unknown = {
    from: (table: string) => {
      if (table === 'subscriptions') {
        return {
          select: () => ({
            lt: () => ({ gt: () => ({ eq: () => ({ eq: () => ({ limit: () => Promise.resolve({
              data: [{ id: 'sub_noemail_1', user_id: 'user-789', clinic_id: null, paused_until: futureTs }],
              error: null,
            }) }) }) }) }),
          }),
          update: (_data: unknown) => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
        };
      }
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({
                data: { email: null, first_name: null },  // no email
                error: null,
              }),
            }),
          }),
        };
      }
      return {};
    },
  };

  __internal.setAdminForTest(fakeAdmin);
  __setSendEmailForTest(async (_admin: unknown, args: SendEmailArgs) => {
    emailCalls.push(args);
    return { provider: 'resend' as const, id: 'mock' };
  });
  stubMirrorAdmin();

  try {
    const res = await __internal.handler(makeReq('fire'));
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.sent, 0, 'No email sent (no email address)');
    assertEquals(body.errors, 1, 'Error counted for missing email');
    assertEquals(emailCalls.length, 0, 'sendEmail not called');
  } finally {
    __internal.resetAdminForTest();
    __resetSendEmailForTest();
    resetMirrorAdminForTest();
  }
});

// ─── T5: reconcile mode — sub still paused on Stripe → no update ─────────────

Deno.test('T5 — reconcile: sub still paused on Stripe → no mirror update', async () => {
  const emailCalls: SendEmailArgs[] = [];
  const updateCalls: unknown[] = [];
  const pastTs = new Date(Date.now() - 1 * 24 * 3600 * 1000).toISOString(); // 1 day ago

  const fakeAdmin: unknown = {
    from: (table: string) => {
      if (table === 'subscriptions') {
        return {
          select: () => ({
            lt: () => ({ eq: () => ({ limit: () => Promise.resolve({
              data: [{ id: 'sub_still_paused', user_id: 'user-abc', clinic_id: null, paused_until: pastTs }],
              error: null,
            }) }) }),
          }),
          update: (data: unknown) => ({
            eq: (_col: string, _val: string) => {
              updateCalls.push(data);
              return Promise.resolve({ data: null, error: null });
            },
          }),
        };
      }
      return {};
    },
  };

  // Stripe says subscription is STILL paused (pause_collection != null)
  const fakeStripe = () => ({
    subscriptions: {
      retrieve: (_id: string) => Promise.resolve({
        id: 'sub_still_paused',
        pause_collection: { behavior: 'void', resumes_at: Math.floor(Date.now() / 1000) + 86400 },
      }),
    },
  });

  __internal.setAdminForTest(fakeAdmin);
  __setStripeForTest(fakeStripe as typeof fakeStripe);
  __setSendEmailForTest(async (_admin: unknown, args: SendEmailArgs) => {
    emailCalls.push(args);
    return { provider: 'resend' as const, id: 'mock' };
  });
  stubMirrorAdmin();

  try {
    const res = await __internal.handler(makeReq('reconcile'));
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.reconciled, 0, 'Nothing reconciled — Stripe shows still paused');
    assertEquals(body.errors, 0);
    assertEquals(updateCalls.length, 0, 'No local mirror update');
    assertEquals(emailCalls.length, 0, 'No T-0 email');
  } finally {
    __internal.resetAdminForTest();
    __resetStripeForTest();
    __resetSendEmailForTest();
    resetMirrorAdminForTest();
  }
});

// ─── T6: reconcile mode — sub auto-resumed on Stripe → mirror + T-0 email ───

Deno.test('T6 — reconcile: Stripe auto-resumed → is_paused=false + T-0 email', async () => {
  const emailCalls: SendEmailArgs[] = [];
  const updateCalls: Array<{ data: Record<string, unknown> }> = [];
  const pastTs = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString(); // 2 days ago

  const fakeAdmin: unknown = {
    from: (table: string) => {
      if (table === 'subscriptions') {
        return {
          select: () => ({
            lt: () => ({ eq: () => ({ limit: () => Promise.resolve({
              data: [{ id: 'sub_auto_resumed', user_id: 'user-xyz', clinic_id: null, paused_until: pastTs }],
              error: null,
            }) }) }),
          }),
          update: (data: Record<string, unknown>) => ({
            eq: () => {
              updateCalls.push({ data });
              return Promise.resolve({ data: null, error: null });
            },
          }),
        };
      }
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({
                data: { email: 'resumed@example.com', first_name: 'Bob' },
                error: null,
              }),
            }),
          }),
        };
      }
      return {};
    },
  };

  // Stripe says pause_collection = null → auto-resumed
  const fakeStripe = () => ({
    subscriptions: {
      retrieve: (_id: string) => Promise.resolve({
        id: 'sub_auto_resumed',
        pause_collection: null,
      }),
    },
  });

  __internal.setAdminForTest(fakeAdmin);
  __setStripeForTest(fakeStripe as typeof fakeStripe);
  __setSendEmailForTest(async (_admin: unknown, args: SendEmailArgs) => {
    emailCalls.push(args);
    return { provider: 'resend' as const, id: 'mock-reconcile' };
  });
  stubMirrorAdmin();

  try {
    const res = await __internal.handler(makeReq('reconcile'));
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.reconciled, 1, '1 sub reconciled');
    assertEquals(body.errors, 0);

    // Mirror update: is_paused=false, paused_until=null, reminded_t7=false
    assertEquals(updateCalls.length, 1, '1 mirror update');
    assertEquals(updateCalls[0].data.is_paused, false);
    assertEquals(updateCalls[0].data.paused_until, null);
    assertEquals(updateCalls[0].data.reminded_t7, false);

    // T-0 email fired
    assertEquals(emailCalls.length, 1, 'T-0 email sent');
    assertEquals(emailCalls[0].template, 'pause_resumed_t0');
    assertEquals(emailCalls[0].to, 'resumed@example.com');
    assertEquals(emailCalls[0].phi, false, 'Consumer: phi=false');
  } finally {
    __internal.resetAdminForTest();
    __resetStripeForTest();
    __resetSendEmailForTest();
    resetMirrorAdminForTest();
  }
});
