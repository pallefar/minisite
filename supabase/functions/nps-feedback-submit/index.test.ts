/**
 * Deno tests for `nps-feedback-submit` — Phase 36 Plan 36-02 Task 2.
 *
 * T1 — no Bearer → 401 unauthenticated
 * T2 — feedback_text < 10 chars (trimmed) → 400 too_short
 * T3 — feedback_text > 4000 chars → truncated to 4000 before RPC
 * T4 — RPC error → 500 rpc_failed
 * T5 — RPC success → 200 { ticket_id }
 * T6 — anon-key + Authorization Bearer userJwt forwarded (NOT service-role)
 * T7 — subject is hardcoded "Feedback from NPS rating" (D-10 verbatim)
 * T8 — post-insert ticket_tags JOIN TABLE INSERT with applied_by='rule' (W6)
 * T9 — ticket_tags insert error is non-fatal (ticket_id still returned)
 *
 * Per [[reference_deno_test_discovery]]: filename is `index.test.ts`.
 */
import { assert, assertEquals } from 'jsr:@std/assert@^1';
import { __internal } from './index.ts';

const TICKET_ID = '99999999-9999-4999-8999-999999999999';
const VALID_JWT = 'user-jwt-here';
const ANON_KEY = 'test-anon-key';

interface ClientLog {
  createCalls: Array<{ url: string; key: string; authHeader?: string }>;
  rpcCalls: Array<{ name: string; args: Record<string, unknown> }>;
  tagInserts: Array<Record<string, unknown>>;
}

function makeFakeClient(opts: {
  log: ClientLog;
  rpcBehavior: 'ok' | 'error' | 'throw';
  tagBehavior?: 'ok' | 'error' | 'throw';
}) {
  return (url: string, key: string, options?: { global?: { headers?: Record<string, string> } }) => {
    opts.log.createCalls.push({
      url,
      key,
      authHeader: options?.global?.headers?.Authorization,
    });
    return {
      rpc: (name: string, args: Record<string, unknown>) => {
        opts.log.rpcCalls.push({ name, args });
        if (opts.rpcBehavior === 'error') {
          return Promise.resolve({ data: null, error: { message: 'rpc-said-no' } });
        }
        if (opts.rpcBehavior === 'throw') {
          return Promise.reject(new Error('rpc-threw'));
        }
        return Promise.resolve({ data: TICKET_ID, error: null });
      },
      from: (_table: string) => ({
        insert: (row: Record<string, unknown>) => {
          opts.log.tagInserts.push(row);
          if (opts.tagBehavior === 'error') {
            return Promise.resolve({ data: null, error: { message: 'tag-insert-failed' } });
          }
          if (opts.tagBehavior === 'throw') {
            return Promise.reject(new Error('tag-insert-threw'));
          }
          return Promise.resolve({ data: null, error: null });
        },
      }),
      // deno-lint-ignore no-explicit-any
    } as any;
  };
}

function mkReq(opts: { jwt?: string; body?: unknown; method?: string }): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.jwt) headers.Authorization = `Bearer ${opts.jwt}`;
  return new Request('http://localhost/functions/v1/nps-feedback-submit', {
    method: opts.method ?? 'POST',
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

function setEnv(): void {
  Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
  Deno.env.set('SUPABASE_ANON_KEY', ANON_KEY);
}

Deno.test('T1: no Bearer → 401 unauthenticated', async () => {
  setEnv();
  const log: ClientLog = { createCalls: [], rpcCalls: [], tagInserts: [] };
  __internal.setCreateClientForTest(makeFakeClient({ log, rpcBehavior: 'ok' }));
  try {
    const res = await __internal.handler(
      mkReq({ body: { feedback_text: 'some legit feedback text here' } }),
    );
    assertEquals(res.status, 401);
    const body = (await res.json()) as { error: string };
    assertEquals(body.error, 'unauthenticated');
    // No client creation should have happened.
    assertEquals(log.createCalls.length, 0);
  } finally {
    __internal.resetCreateClientForTest();
  }
});

Deno.test('T2: feedback_text < 10 chars (trimmed) → 400 too_short', async () => {
  setEnv();
  const log: ClientLog = { createCalls: [], rpcCalls: [], tagInserts: [] };
  __internal.setCreateClientForTest(makeFakeClient({ log, rpcBehavior: 'ok' }));
  try {
    const res = await __internal.handler(
      mkReq({ jwt: VALID_JWT, body: { feedback_text: '  hi  ' } }),
    );
    assertEquals(res.status, 400);
    const body = (await res.json()) as { error: string };
    assertEquals(body.error, 'too_short');
    assertEquals(log.rpcCalls.length, 0);
  } finally {
    __internal.resetCreateClientForTest();
  }
});

Deno.test('T3: feedback_text > 4000 chars → truncated to 4000 before RPC', async () => {
  setEnv();
  const log: ClientLog = { createCalls: [], rpcCalls: [], tagInserts: [] };
  __internal.setCreateClientForTest(makeFakeClient({ log, rpcBehavior: 'ok' }));
  try {
    const longText = 'x'.repeat(5000);
    const res = await __internal.handler(
      mkReq({ jwt: VALID_JWT, body: { feedback_text: longText } }),
    );
    assertEquals(res.status, 200);
    assertEquals(log.rpcCalls.length, 1);
    const bodyArg = log.rpcCalls[0].args.p_body as string;
    assertEquals(bodyArg.length, 4000);
  } finally {
    __internal.resetCreateClientForTest();
  }
});

Deno.test('T4: RPC returns error → 500 rpc_failed', async () => {
  setEnv();
  const log: ClientLog = { createCalls: [], rpcCalls: [], tagInserts: [] };
  __internal.setCreateClientForTest(makeFakeClient({ log, rpcBehavior: 'error' }));
  try {
    const res = await __internal.handler(
      mkReq({ jwt: VALID_JWT, body: { feedback_text: 'genuine feedback content' } }),
    );
    assertEquals(res.status, 500);
    const body = (await res.json()) as { error: string };
    assertEquals(body.error, 'rpc_failed');
    // No tag insert when the ticket failed to create.
    assertEquals(log.tagInserts.length, 0);
  } finally {
    __internal.resetCreateClientForTest();
  }
});

Deno.test('T5: RPC success → 200 { ticket_id }', async () => {
  setEnv();
  const log: ClientLog = { createCalls: [], rpcCalls: [], tagInserts: [] };
  __internal.setCreateClientForTest(makeFakeClient({ log, rpcBehavior: 'ok' }));
  try {
    const res = await __internal.handler(
      mkReq({ jwt: VALID_JWT, body: { feedback_text: 'great app but could be faster' } }),
    );
    assertEquals(res.status, 200);
    const body = (await res.json()) as { ticket_id: string };
    assertEquals(body.ticket_id, TICKET_ID);
  } finally {
    __internal.resetCreateClientForTest();
  }
});

Deno.test('T6: createClient called with anon-key + Authorization Bearer userJwt (NOT service-role)', async () => {
  setEnv();
  const log: ClientLog = { createCalls: [], rpcCalls: [], tagInserts: [] };
  __internal.setCreateClientForTest(makeFakeClient({ log, rpcBehavior: 'ok' }));
  try {
    const res = await __internal.handler(
      mkReq({ jwt: VALID_JWT, body: { feedback_text: 'genuine feedback content' } }),
    );
    assertEquals(res.status, 200);
    assertEquals(log.createCalls.length, 1);
    assertEquals(log.createCalls[0].key, ANON_KEY); // anon-key, NOT service-role
    assertEquals(log.createCalls[0].authHeader, `Bearer ${VALID_JWT}`);
    // Defensive: SERVICE_ROLE_KEY env var must NOT have been used as the key.
    const srk = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    assert(log.createCalls[0].key !== srk || srk === '');
  } finally {
    __internal.resetCreateClientForTest();
  }
});

Deno.test('T7: subject is hardcoded "Feedback from NPS rating" (D-10 verbatim)', async () => {
  setEnv();
  const log: ClientLog = { createCalls: [], rpcCalls: [], tagInserts: [] };
  __internal.setCreateClientForTest(makeFakeClient({ log, rpcBehavior: 'ok' }));
  try {
    await __internal.handler(
      mkReq({ jwt: VALID_JWT, body: { feedback_text: 'genuine feedback content' } }),
    );
    assertEquals(log.rpcCalls[0].name, 'create_ticket_with_first_message');
    assertEquals(log.rpcCalls[0].args.p_subject, 'Feedback from NPS rating');
    assertEquals(log.rpcCalls[0].args.p_priority, 'p3');
  } finally {
    __internal.resetCreateClientForTest();
  }
});

Deno.test('T8 (W6): post-insert into ticket_tags JOIN TABLE with applied_by=rule (NOT tickets.update)', async () => {
  setEnv();
  const log: ClientLog = { createCalls: [], rpcCalls: [], tagInserts: [] };
  __internal.setCreateClientForTest(makeFakeClient({ log, rpcBehavior: 'ok' }));
  try {
    const res = await __internal.handler(
      mkReq({ jwt: VALID_JWT, body: { feedback_text: 'genuine feedback content' } }),
    );
    assertEquals(res.status, 200);
    assertEquals(log.tagInserts.length, 1);
    const row = log.tagInserts[0];
    assertEquals(row.ticket_id, TICKET_ID);
    assertEquals(row.tag_name, 'nps-feedback');
    assertEquals(row.applied_by, 'rule');
  } finally {
    __internal.resetCreateClientForTest();
  }
});

Deno.test('T9 (W6): ticket_tags insert error is non-fatal — ticket_id still returned', async () => {
  setEnv();
  const log: ClientLog = { createCalls: [], rpcCalls: [], tagInserts: [] };
  __internal.setCreateClientForTest(makeFakeClient({ log, rpcBehavior: 'ok', tagBehavior: 'error' }));
  try {
    const res = await __internal.handler(
      mkReq({ jwt: VALID_JWT, body: { feedback_text: 'genuine feedback content' } }),
    );
    assertEquals(res.status, 200);
    const body = (await res.json()) as { ticket_id: string };
    assertEquals(body.ticket_id, TICKET_ID);
    // Attempt was made
    assertEquals(log.tagInserts.length, 1);
  } finally {
    __internal.resetCreateClientForTest();
  }
});
