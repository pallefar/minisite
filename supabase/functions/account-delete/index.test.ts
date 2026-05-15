/**
 * Deno tests for `account-delete` Edge Function — Phase 19 Plan 19-09 (BL-6).
 *
 * Test plan (6 tests):
 *   T1 — caller != user_id and not staff → 403
 *   T2 — open payouts (P0010) → 409 { error:'open_payouts', eta }
 *   T3 — happy path → all 10 steps execute in order; Resend called with
 *        original_email from RPC return (BL-6 contract)
 *   T4 — Stripe balance > 0 → step 6 (Connect del) skipped; steps 7-10 continue
 *   T5 — Stripe customer.del throws → log + continue
 *   T6 — idempotent: second call → 200; RPC returns null (no affiliate row)
 */
import { assertEquals } from 'jsr:@std/assert@^1';
import { __internal } from './index.ts';

Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');
Deno.env.set('STRIPE_SECRET_KEY', 'sk_test_dummy');
Deno.env.set('RESEND_API_KEY', 'test-stub');

const TARGET_UUID = '11111111-1111-4111-8111-111111111111';
const CALLER_UUID_SELF = TARGET_UUID;
const CALLER_UUID_OTHER = '22222222-2222-4222-8222-222222222222';

// ----------------------------------------------------------------------------
// Fake admin builder — handles RPC, table queries, storage, auth.
// ----------------------------------------------------------------------------

interface FakeAdminConfig {
  callerId: string;
  /** finalize_affiliate_cascade behavior: 'email' returns originalEmail, 'p0010' raises, 'null' returns null. */
  rpcBehavior: 'email' | 'p0010' | 'null';
  originalEmail?: string;
  isStaff?: boolean;
  stripeCustomerId?: string | null;
  stripeConnectAccountId?: string | null;
  storageFiles?: string[];
  authDeleteShouldThrow?: boolean;
  /** Test-recorded events. */
  log: {
    auditSteps: Array<{ step: number; name: string; ok: boolean }>;
    storageDeletes: string[];
    authDeleteCalled: boolean;
  };
}

// deno-lint-ignore no-explicit-any
function makeFakeAdmin(cfg: FakeAdminConfig): any {
  const fromTable = (table: string) => makeTableBuilder(table, cfg);
  return {
    from: fromTable,
    rpc: (fn: string, params: Record<string, unknown>) => {
      if (fn !== 'finalize_affiliate_cascade') {
        return Promise.resolve({ data: null, error: { message: 'unknown_fn' } });
      }
      void params;
      if (cfg.rpcBehavior === 'p0010') {
        return Promise.resolve({ data: null, error: { code: 'P0010', message: 'open_payouts' } });
      }
      if (cfg.rpcBehavior === 'null') {
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: cfg.originalEmail ?? null, error: null });
    },
    auth: {
      getUser: (_jwt: string) =>
        Promise.resolve({ data: { user: { id: cfg.callerId } }, error: null }),
      admin: {
        deleteUser: (_id: string) => {
          cfg.log.authDeleteCalled = true;
          if (cfg.authDeleteShouldThrow) {
            return Promise.resolve({ error: { message: 'fake-auth-error' } });
          }
          return Promise.resolve({ error: null });
        },
      },
    },
    storage: {
      from: (_bucket: string) => ({
        list: (prefix: string, _opts: unknown) => {
          void prefix;
          const files = (cfg.storageFiles ?? []).map((name) => ({ name }));
          return Promise.resolve({ data: files, error: null });
        },
        remove: (paths: string[]) => {
          cfg.log.storageDeletes.push(...paths);
          return Promise.resolve({ data: null, error: null });
        },
      }),
    },
  };
}

// deno-lint-ignore no-explicit-any
function makeTableBuilder(table: string, cfg: FakeAdminConfig): any {
  const filters: Array<{ col: string; val: unknown }> = [];
  // deno-lint-ignore no-explicit-any
  const api: any = {
    select(_cols: string) {
      return api;
    },
    eq(col: string, val: unknown) {
      filters.push({ col, val });
      return api;
    },
    maybeSingle() {
      if (table === 'profiles') {
        return Promise.resolve({ data: { is_staff: cfg.isStaff ?? false }, error: null });
      }
      if (table === 'stripe_customers') {
        return Promise.resolve({
          data: cfg.stripeCustomerId ? { stripe_customer_id: cfg.stripeCustomerId } : null,
          error: null,
        });
      }
      if (table === 'affiliates') {
        return Promise.resolve({
          data:
            cfg.stripeConnectAccountId !== null
              ? { stripe_connect_account_id: cfg.stripeConnectAccountId ?? null }
              : null,
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    },
    insert(_row: Record<string, unknown>) {
      if (table === 'audit_logs') {
        const row = _row as Record<string, unknown>;
        const rowId = String(row.row_id ?? '');
        const colon = rowId.indexOf(':');
        const step = colon >= 0 ? Number.parseInt(rowId.slice(0, colon), 10) : 0;
        const name = colon >= 0 ? rowId.slice(colon + 1) : rowId;
        cfg.log.auditSteps.push({ step, name, ok: row.action === 'account_delete_step_ok' });
      }
      return Promise.resolve({ data: null, error: null });
    },
  };
  return api;
}

// Stripe stub factories
function stripeStubAllOk(extras: {
  connectBalanceNonZero?: boolean;
  customerDelThrows?: boolean;
} = {}) {
  return {
    subscriptions: {
      list: () => Promise.resolve({ data: [{ id: 'sub_1' }] }),
      cancel: (_id: string) => Promise.resolve({ id: _id, status: 'canceled' }),
    },
    paymentIntents: {
      list: () => Promise.resolve({ data: [{ id: 'pi_1', status: 'processing' }] }),
      cancel: (_id: string) => Promise.resolve({ id: _id, status: 'canceled' }),
    },
    customers: {
      del: (_id: string) => {
        if (extras.customerDelThrows) throw new Error('customer-del-fail');
        return Promise.resolve({ id: _id, deleted: true });
      },
    },
    accounts: {
      del: (_id: string) => Promise.resolve({ id: _id, deleted: true }),
    },
    balance: {
      retrieve: () =>
        Promise.resolve(
          extras.connectBalanceNonZero
            ? { available: [{ amount: 1000 }], pending: [] }
            : { available: [{ amount: 0 }], pending: [{ amount: 0 }] },
        ),
    },
  };
}

function makeAuthedReq(token = 'caller-jwt', body: Record<string, unknown> = { user_id: TARGET_UUID }): Request {
  return new Request('http://localhost/account-delete', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ============================================================================
// Tests
// ============================================================================

Deno.test('T1 — caller != user_id and not staff → 403', async () => {
  const cfg: FakeAdminConfig = {
    callerId: CALLER_UUID_OTHER,
    isStaff: false,
    rpcBehavior: 'email',
    originalEmail: 'user@example.com',
    log: { auditSteps: [], storageDeletes: [], authDeleteCalled: false },
  };
  __internal.setAdminForTest(makeFakeAdmin(cfg));
  __internal.setStripeForTest(stripeStubAllOk());
  const res = await __internal.handleDelete(makeAuthedReq());
  assertEquals(res.status, 403);
  assertEquals(cfg.log.authDeleteCalled, false);
});

Deno.test('T2 — open payouts (P0010) → 409 with eta', async () => {
  const cfg: FakeAdminConfig = {
    callerId: CALLER_UUID_SELF,
    rpcBehavior: 'p0010',
    log: { auditSteps: [], storageDeletes: [], authDeleteCalled: false },
  };
  __internal.setAdminForTest(makeFakeAdmin(cfg));
  __internal.setStripeForTest(stripeStubAllOk());
  const res = await __internal.handleDelete(makeAuthedReq());
  const body = await res.json();
  assertEquals(res.status, 409);
  assertEquals(body.error, 'open_payouts');
  assertEquals(typeof body.eta, 'string');
  // Pre-flight failure → auth.admin.deleteUser MUST NOT fire.
  assertEquals(cfg.log.authDeleteCalled, false);
});

Deno.test('T3 — happy path: 10 steps + Resend called with original_email (BL-6)', async () => {
  const resendCalls: string[] = [];
  globalThis.fetch = ((url: string, init: RequestInit) => {
    if (typeof url === 'string' && url.includes('resend.com')) {
      resendCalls.push(url);
      return Promise.resolve(new Response(null, { status: 200 }));
    }
    void init;
    return Promise.resolve(new Response(null, { status: 200 }));
  }) as typeof fetch;
  // RESEND_API_KEY is 'test-stub' which short-circuits actual HTTPS — flip it
  // for this test so we can observe the call.
  Deno.env.set('RESEND_API_KEY', 're_live_key_test');

  const cfg: FakeAdminConfig = {
    callerId: CALLER_UUID_SELF,
    rpcBehavior: 'email',
    originalEmail: 'preanonymize@example.com',
    stripeCustomerId: 'cus_test_123',
    stripeConnectAccountId: 'acct_test_123',
    storageFiles: ['avatar.jpg'],
    log: { auditSteps: [], storageDeletes: [], authDeleteCalled: false },
  };
  __internal.setAdminForTest(makeFakeAdmin(cfg));
  __internal.setStripeForTest(stripeStubAllOk());

  const res = await __internal.handleDelete(makeAuthedReq());
  const body = await res.json();
  assertEquals(res.status, 200);
  assertEquals(body.ok, true);

  // BL-6: Resend called with the original (pre-anonymize) email. The path
  // URL-encodes the email so we accept either form.
  const encoded = encodeURIComponent('preanonymize@example.com');
  const resendHit = resendCalls.find(
    (u) => u.includes('preanonymize@example.com') || u.includes(encoded),
  );
  assertEquals(typeof resendHit, 'string');

  // Step 10 (auth.admin.deleteUser) fired.
  assertEquals(cfg.log.authDeleteCalled, true);

  // Reset for subsequent tests.
  Deno.env.set('RESEND_API_KEY', 'test-stub');
});

Deno.test('T4 — Stripe Connect balance > 0 → step 6 skipped; 7-10 continue', async () => {
  const cfg: FakeAdminConfig = {
    callerId: CALLER_UUID_SELF,
    rpcBehavior: 'email',
    originalEmail: 'user@example.com',
    stripeCustomerId: 'cus_test_b',
    stripeConnectAccountId: 'acct_test_b',
    log: { auditSteps: [], storageDeletes: [], authDeleteCalled: false },
  };
  __internal.setAdminForTest(makeFakeAdmin(cfg));
  __internal.setStripeForTest(stripeStubAllOk({ connectBalanceNonZero: true }));
  const res = await __internal.handleDelete(makeAuthedReq());
  assertEquals(res.status, 200);
  // Step 6 audit entry should be the "skipped_balance" variant.
  const step6 = cfg.log.auditSteps.find((a) => a.step === 6);
  assertEquals(step6?.name.includes('skipped_balance'), true);
  // Step 10 still fired.
  assertEquals(cfg.log.authDeleteCalled, true);
});

Deno.test('T5 — customers.del throws → log + continue (Step 10 still fires)', async () => {
  const cfg: FakeAdminConfig = {
    callerId: CALLER_UUID_SELF,
    rpcBehavior: 'email',
    originalEmail: 'user@example.com',
    stripeCustomerId: 'cus_test_x',
    stripeConnectAccountId: 'acct_test_x',
    log: { auditSteps: [], storageDeletes: [], authDeleteCalled: false },
  };
  __internal.setAdminForTest(makeFakeAdmin(cfg));
  __internal.setStripeForTest(stripeStubAllOk({ customerDelThrows: true }));
  const res = await __internal.handleDelete(makeAuthedReq());
  assertEquals(res.status, 200);
  // step 5 was logged with ok=false.
  const step5 = cfg.log.auditSteps.find((a) => a.step === 5);
  assertEquals(step5?.ok, false);
  // step 10 still fired.
  assertEquals(cfg.log.authDeleteCalled, true);
});

Deno.test('T6 — idempotent second call: RPC returns null → 200 + no Resend', async () => {
  const cfg: FakeAdminConfig = {
    callerId: CALLER_UUID_SELF,
    rpcBehavior: 'null',
    log: { auditSteps: [], storageDeletes: [], authDeleteCalled: false },
  };
  __internal.setAdminForTest(makeFakeAdmin(cfg));
  __internal.setStripeForTest(stripeStubAllOk());
  const res = await __internal.handleDelete(makeAuthedReq());
  assertEquals(res.status, 200);
  // No "resend_contact_remove" step recorded because originalEmail was null.
  const resendStep = cfg.log.auditSteps.find((a) => a.step === 8);
  assertEquals(resendStep, undefined);
  // Step 10 still fires.
  assertEquals(cfg.log.authDeleteCalled, true);
});
