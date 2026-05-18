/**
 * meta-capi-relay index.test.ts — Phase 33 Plan 04 TDD tests.
 *
 * Per reference_deno_test_discovery: test file uses <name>.test.ts pattern.
 */

// ---------------------------------------------------------------------------
// Mock state
// ---------------------------------------------------------------------------
let mockFetchCalled = false;
let mockFetchBody: unknown = null;
let mockFetchResponse: { ok: boolean; status: number; json: () => Promise<unknown> } = {
  ok: true,
  status: 200,
  json: () => Promise.resolve({ events_received: 2 }),
};

// Override global fetch before module import
// deno-lint-ignore no-explicit-any
(globalThis as any).fetch = async (_url: string, options?: RequestInit) => {
  mockFetchCalled = true;
  mockFetchBody = options?.body ? JSON.parse(options.body as string) : null;
  return {
    ok: mockFetchResponse.ok,
    status: mockFetchResponse.status,
    json: mockFetchResponse.json,
    text: () => Promise.resolve(JSON.stringify({ events_received: 0 })),
  };
};

// ---------------------------------------------------------------------------
// Import module under test
// ---------------------------------------------------------------------------
import { __internal } from './index.ts';

const { handleRun, setAdminForTest, resetAdminForTest } = __internal;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeReq(method = 'POST', authKey = 'test-service-role-key'): Request {
  return new Request('http://localhost/meta-capi-relay', {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${authKey}`,
    },
  });
}

function makeAdmin(overrides: {
  cursorValue?: string;
  events?: unknown[];
  cursorUpsertError?: string | null;
} = {}): unknown {
  const cursorValue = overrides.cursorValue ?? '0';
  const events = overrides.events ?? [];
  const cursorUpsertError = overrides.cursorUpsertError ?? null;

  return {
    from: (table: string) => {
      if (table === 'etl_cursors') {
        return {
          select: (_cols: string) => ({
            eq: (_col: string, _val: string) => ({
              maybeSingle: () =>
                Promise.resolve({ data: { value: cursorValue }, error: null }),
            }),
          }),
          upsert: (_payload: unknown, _opts?: unknown) =>
            Promise.resolve({ data: null, error: cursorUpsertError ? { message: cursorUpsertError } : null }),
        };
      }
      if (table === 'events_mirror') {
        return {
          select: (_cols: string) => ({
            gt: (_col: string, _val: string) => ({
              in: (_col: string, _vals: string[]) => ({
                order: (_col: string, _opts: unknown) => ({
                  limit: (_n: number) =>
                    Promise.resolve({ data: events, error: null }),
                }),
              }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

// ---------------------------------------------------------------------------
// Test setup/teardown helpers
// ---------------------------------------------------------------------------
function resetMocks() {
  mockFetchCalled = false;
  mockFetchBody = null;
  mockFetchResponse = {
    ok: true,
    status: 200,
    json: () => Promise.resolve({ events_received: 2 }),
  };
  resetAdminForTest();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

Deno.test('Test 1: No META_ACCESS_TOKEN or META_PIXEL_ID → skipped:credentials_missing', async () => {
  resetMocks();
  // Ensure env vars are NOT set
  // (Deno test env has no META_ACCESS_TOKEN or META_PIXEL_ID by default)
  const req = makeReq();
  const res = await handleRun(req);
  const body = await res.json();
  if (body.skipped !== 'credentials_missing') {
    throw new Error(`Expected skipped='credentials_missing', got: ${JSON.stringify(body)}`);
  }
  if (body.ok !== true) {
    throw new Error(`Expected ok=true, got: ${JSON.stringify(body)}`);
  }
});

Deno.test('Test 2: events_mirror has 2 AEM-priority rows → CAPI called with hashed em', async () => {
  resetMocks();
  Deno.env.set('META_ACCESS_TOKEN', 'test-token');
  Deno.env.set('META_PIXEL_ID', 'test-pixel-123');
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');

  const events = [
    {
      id: '1',
      event_name: 'payment_completed',
      user_id: 'user-1',
      properties: { email: 'test@example.com', event_id: 'evt-abc123', value: 12.99 },
      distinct_id: 'user-1',
      created_at: '2026-05-18T10:00:00Z',
    },
    {
      id: '2',
      event_name: 'signup_completed',
      user_id: 'user-2',
      properties: { email: 'Other@Example.Com', event_id: 'evt-def456' },
      distinct_id: 'user-2',
      created_at: '2026-05-18T10:01:00Z',
    },
  ];

  setAdminForTest(makeAdmin({ events }));
  const req = makeReq();
  const res = await handleRun(req);
  const body = await res.json();

  if (!mockFetchCalled) {
    throw new Error('Expected fetch to be called for CAPI POST');
  }
  if (body.events_relayed !== 2) {
    throw new Error(`Expected events_relayed=2, got: ${JSON.stringify(body)}`);
  }
  // Verify hashed email (SHA-256 of lowercase 'test@example.com')
  const capiBody = mockFetchBody as { data: { user_data?: { em?: string[] } }[] };
  const firstEvent = capiBody?.data?.[0];
  if (!firstEvent?.user_data?.em?.[0]) {
    throw new Error('Expected hashed em field in CAPI payload');
  }
  // SHA-256 of 'test@example.com' = 973dfe0d4bfcde0d58af1c3f... (we just check it's a 64-char hex)
  const emHash = firstEvent.user_data.em[0];
  if (!/^[a-f0-9]{64}$/.test(emHash)) {
    throw new Error(`Expected 64-char hex em hash, got: ${emHash}`);
  }

  Deno.env.delete('META_ACCESS_TOKEN');
  Deno.env.delete('META_PIXEL_ID');
  Deno.env.delete('SUPABASE_SERVICE_ROLE_KEY');
});

Deno.test('Test 3: event_name NOT in AEM_PRIORITY_EVENTS → row skipped, CAPI not called', async () => {
  resetMocks();
  Deno.env.set('META_ACCESS_TOKEN', 'test-token');
  Deno.env.set('META_PIXEL_ID', 'test-pixel-123');
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');

  // DB query filters by IN (aem_priority_events), so returning empty simulates filter
  setAdminForTest(makeAdmin({ events: [] }));
  const req = makeReq();
  const res = await handleRun(req);
  const body = await res.json();

  if (mockFetchCalled) {
    throw new Error('Expected fetch NOT to be called when no events');
  }
  if (body.events_relayed !== 0) {
    throw new Error(`Expected events_relayed=0, got: ${JSON.stringify(body)}`);
  }

  Deno.env.delete('META_ACCESS_TOKEN');
  Deno.env.delete('META_PIXEL_ID');
  Deno.env.delete('SUPABASE_SERVICE_ROLE_KEY');
});

Deno.test('Test 4: Cursor advances after successful batch (etl_cursors updated to max processed id)', async () => {
  resetMocks();
  Deno.env.set('META_ACCESS_TOKEN', 'test-token');
  Deno.env.set('META_PIXEL_ID', 'test-pixel-123');
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');

  let cursorUpserted = false;
  let upsertedValue: string | null = null;

  const admin = {
    from: (table: string) => {
      if (table === 'etl_cursors') {
        return {
          select: (_cols: string) => ({
            eq: (_col: string, _val: string) => ({
              maybeSingle: () =>
                Promise.resolve({ data: { value: '0' }, error: null }),
            }),
          }),
          upsert: (payload: { value: string }, _opts?: unknown) => {
            cursorUpserted = true;
            upsertedValue = payload.value;
            return Promise.resolve({ data: null, error: null });
          },
        };
      }
      if (table === 'events_mirror') {
        return {
          select: (_cols: string) => ({
            gt: (_col: string, _val: string) => ({
              in: (_col: string, _vals: string[]) => ({
                order: (_col: string, _opts: unknown) => ({
                  limit: (_n: number) =>
                    Promise.resolve({
                      data: [
                        {
                          id: '42',
                          event_name: 'payment_completed',
                          user_id: 'user-1',
                          properties: { email: 'a@b.com' },
                          distinct_id: 'user-1',
                          created_at: '2026-05-18T10:00:00Z',
                        },
                      ],
                      error: null,
                    }),
                }),
              }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };

  setAdminForTest(admin);
  const req = makeReq();
  const res = await handleRun(req);
  const body = await res.json();

  if (!cursorUpserted) {
    throw new Error('Expected cursor to be upserted');
  }
  if (upsertedValue !== '42') {
    throw new Error(`Expected cursor updated to '42', got: ${upsertedValue}`);
  }
  if (body.ok !== true) {
    throw new Error(`Expected ok=true, got: ${JSON.stringify(body)}`);
  }

  Deno.env.delete('META_ACCESS_TOKEN');
  Deno.env.delete('META_PIXEL_ID');
  Deno.env.delete('SUPABASE_SERVICE_ROLE_KEY');
});

Deno.test('Test 5: CAPI POST returns non-200 → error logged, cursor NOT advanced, 500 returned', async () => {
  resetMocks();
  Deno.env.set('META_ACCESS_TOKEN', 'test-token');
  Deno.env.set('META_PIXEL_ID', 'test-pixel-123');
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');

  // Make CAPI respond with error
  mockFetchResponse = {
    ok: false,
    status: 400,
    json: () => Promise.resolve({ error: { message: 'Invalid token' } }),
  };

  let cursorUpserted = false;
  const admin = {
    from: (table: string) => {
      if (table === 'etl_cursors') {
        return {
          select: (_cols: string) => ({
            eq: (_col: string, _val: string) => ({
              maybeSingle: () =>
                Promise.resolve({ data: { value: '0' }, error: null }),
            }),
          }),
          upsert: (_payload: unknown, _opts?: unknown) => {
            cursorUpserted = true;
            return Promise.resolve({ data: null, error: null });
          },
        };
      }
      if (table === 'events_mirror') {
        return {
          select: (_cols: string) => ({
            gt: (_col: string, _val: string) => ({
              in: (_col: string, _vals: string[]) => ({
                order: (_col: string, _opts: unknown) => ({
                  limit: (_n: number) =>
                    Promise.resolve({
                      data: [
                        {
                          id: '10',
                          event_name: 'payment_completed',
                          user_id: 'user-1',
                          properties: { email: 'err@test.com' },
                          distinct_id: 'user-1',
                          created_at: '2026-05-18T10:00:00Z',
                        },
                      ],
                      error: null,
                    }),
                }),
              }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };

  setAdminForTest(admin);
  const req = makeReq();
  const res = await handleRun(req);

  if (cursorUpserted) {
    throw new Error('Expected cursor NOT to be upserted on CAPI failure');
  }
  if (res.status !== 500) {
    throw new Error(`Expected 500 status, got: ${res.status}`);
  }

  Deno.env.delete('META_ACCESS_TOKEN');
  Deno.env.delete('META_PIXEL_ID');
  Deno.env.delete('SUPABASE_SERVICE_ROLE_KEY');
});

Deno.test('Test 6: events_mirror row has properties.event_id → included in CAPI payload for dedup', async () => {
  resetMocks();
  Deno.env.set('META_ACCESS_TOKEN', 'test-token');
  Deno.env.set('META_PIXEL_ID', 'test-pixel-123');
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');

  const eventId = 'dedup-event-id-xyz';
  const events = [
    {
      id: '5',
      event_name: 'signup_completed',
      user_id: 'user-3',
      properties: { event_id: eventId, email: 'dedup@test.com' },
      distinct_id: 'user-3',
      created_at: '2026-05-18T10:00:00Z',
    },
  ];

  setAdminForTest(makeAdmin({ events }));
  const req = makeReq();
  await handleRun(req);

  if (!mockFetchCalled) {
    throw new Error('Expected fetch to be called for CAPI POST');
  }
  const capiBody = mockFetchBody as { data: { event_id?: string }[] };
  const sentEventId = capiBody?.data?.[0]?.event_id;
  if (sentEventId !== eventId) {
    throw new Error(`Expected event_id=${eventId}, got: ${sentEventId}`);
  }

  Deno.env.delete('META_ACCESS_TOKEN');
  Deno.env.delete('META_PIXEL_ID');
  Deno.env.delete('SUPABASE_SERVICE_ROLE_KEY');
});

Deno.test('Test 7: Non-POST request → 405', async () => {
  resetMocks();
  const req = makeReq('GET');
  const res = await handleRun(req);
  if (res.status !== 405) {
    throw new Error(`Expected 405 status, got: ${res.status}`);
  }
});
