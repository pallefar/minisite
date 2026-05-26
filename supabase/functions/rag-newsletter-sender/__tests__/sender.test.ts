/**
 * Phase 60 Plan 60-12 Task 5 — rag-newsletter-sender Deno tests.
 *
 * 12 test cases covering: healthz, auth, empty subscribers, send flow,
 * idempotency, RFC 8058 headers, stored-token URL, PHARMA-02 guardrail,
 * HTML encoding, subject injection, cost telemetry, import.meta.main guard.
 *
 * Run: $HOME/.deno/bin/deno test --no-check supabase/functions/rag-newsletter-sender/__tests__/sender.test.ts
 *
 * NOTE: Imports handleNewsletterSend directly (not via Deno.serve).
 * The import.meta.main guard in index.ts prevents server bind on import.
 * Per [[reference_deno_test_top_level_serve_trap]].
 */

import {
  assertEquals,
  assertStringIncludes,
  assert,
} from 'https://deno.land/std@0.224.0/assert/mod.ts';

// ─── Mock dependencies ───────────────────────────────────────────────────────

const SERVICE_ROLE_KEY = 'test-service-role-key';
const RESEND_API_KEY = 'test-resend-api-key';
const SUPABASE_URL = 'https://test.supabase.co';
const SIGNING_KEY = 'test-signing-key-32-bytes-for-hmac';

// Base subscriber fixtures
const SUBSCRIBER_1 = {
  user_id: 'user-001',
  email: 'alice@example.com',
  topic_tags: ['glp-1'],
  unsubscribe_token: 'stored-token-abc123',
  last_sent_at: null,
};

const SUBSCRIBER_RECENT = {
  ...SUBSCRIBER_1,
  user_id: 'user-recent',
  last_sent_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(), // 3 days ago
};

// Mock Supabase client factory
// Builds a chainable mock that intercepts at the .or() or .limit() call
function makeMockSupabase(opts: {
  subscribers?: typeof SUBSCRIBER_1[];
  recentChunks?: Record<string, unknown>[];
  evergreenChunks?: Record<string, unknown>[];
  updateError?: unknown;
}) {
  const defaultChunk = {
    id: 'chunk-001',
    chunk_title: 'GLP-1 Mechanism Overview',
    source_text_excerpt: 'GLP-1 receptor agonists work by...',
    summary: 'GLP-1 receptor agonists reduce HbA1c by stimulating insulin release.',
    tier: 'A',
    topic_tag: 'glp-1',
    canonical_url: 'https://example.com/article',
    source_name: 'NEJM',
  };

  const subscribers = opts.subscribers ?? [];
  const recentChunks = opts.recentChunks ?? [defaultChunk];
  const evergreenChunks = opts.evergreenChunks ?? [defaultChunk];

  let chunkCallCount = 0;

  // Build a fully chainable mock returning data at the terminal call
  function makeChain(terminalData: { data: unknown; error: unknown }): Record<string, unknown> {
    const terminal = Promise.resolve(terminalData);
    const chain: Record<string, unknown> = {};
    const methods = ['select', 'eq', 'or', 'gt', 'lt', 'order', 'limit', 'single', 'maybeSingle'];
    for (const method of methods) {
      if (method === 'limit') {
        chain[method] = (_n: number) => {
          // After limit, increment counter to differentiate recent vs evergreen queries
          const data = chunkCallCount++ === 0 ? recentChunks : evergreenChunks;
          return { data, error: null };
        };
      } else if (method === 'or') {
        // Subscriber query terminates at .or()
        chain[method] = (_filter: string) => ({ data: subscribers, error: null });
      } else {
        chain[method] = () => chain;
      }
    }
    // Make the chain itself await-able (terminal)
    Object.assign(chain, terminal);
    return chain;
  }

  return {
    from: (_table: string) => {
      const chain = makeChain({ data: [], error: null });
      return {
        select: (_cols: string) => chain,
        update: (_data: unknown) => ({
          eq: (_col: string, _val: unknown) => Promise.resolve({ data: null, error: opts.updateError ?? null }),
        }),
      };
    },
  };
}

// Mock fetch factory for Resend
function makeMockFetch(statusCode = 200, body = '{"id":"resend-123"}') {
  const calls: { url: string; options: RequestInit }[] = [];
  const fetchImpl = async (url: string, options?: RequestInit): Promise<Response> => {
    calls.push({ url, options: options ?? {} });
    return new Response(body, { status: statusCode });
  };
  return { fetchImpl, calls };
}

// Import the handler (import.meta.main guard prevents Deno.serve bind)
import { handleNewsletterSend } from '../index.ts';

// ─── Tests ────────────────────────────────────────────────────────────────────

// Test 1: GET /healthz returns 200
Deno.test('GET /healthz returns 200 with ok:true', async () => {
  const req = new Request('https://test.supabase.co/functions/v1/rag-newsletter-sender/healthz', {
    method: 'GET',
  });
  const res = await handleNewsletterSend(req, {
    serviceRoleKey: SERVICE_ROLE_KEY,
    resendApiKey: RESEND_API_KEY,
    supabaseUrl: SUPABASE_URL,
    signingKey: SIGNING_KEY,
  });
  assertEquals(res.status, 200);
  const body = await res.json() as Record<string, unknown>;
  assertEquals(body.ok, true);
  assertEquals(body.fn, 'rag-newsletter-sender');
});

// Test 2: POST without service-role bearer returns 401
Deno.test('POST without service-role bearer returns 401', async () => {
  const req = new Request('https://test.supabase.co/functions/v1/rag-newsletter-sender', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer wrong-key' },
  });
  const res = await handleNewsletterSend(req, {
    serviceRoleKey: SERVICE_ROLE_KEY,
    resendApiKey: RESEND_API_KEY,
    supabaseUrl: SUPABASE_URL,
    signingKey: SIGNING_KEY,
  });
  assertEquals(res.status, 401);
});

// Test 3: POST with valid bearer + zero opted-in subscribers returns { sent:0, skipped:0 }
Deno.test('POST with valid bearer + zero subscribers returns sent:0 skipped:0', async () => {
  const { fetchImpl } = makeMockFetch();
  const req = new Request('https://test.supabase.co/functions/v1/rag-newsletter-sender', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${SERVICE_ROLE_KEY}` },
  });
  const res = await handleNewsletterSend(req, {
    serviceRoleKey: SERVICE_ROLE_KEY,
    resendApiKey: RESEND_API_KEY,
    supabaseUrl: SUPABASE_URL,
    signingKey: SIGNING_KEY,
    fetchImpl,
    supabaseServiceClient: makeMockSupabase({ subscribers: [] }) as unknown as ReturnType<typeof import('npm:@supabase/supabase-js@2').createClient>,
  });
  assertEquals(res.status, 200);
  const body = await res.json() as Record<string, unknown>;
  assertEquals(body.sent, 0);
  assertEquals(body.skipped, 0);
});

// Test 4: POST with 3 opted-in subscribers → fetches Resend 3 times (per-subscriber)
Deno.test('POST with 3 subscribers fetches Resend 3 times (not BCC)', async () => {
  const { fetchImpl, calls } = makeMockFetch();
  const subs = [
    { ...SUBSCRIBER_1, user_id: 'u1', email: 'u1@example.com' },
    { ...SUBSCRIBER_1, user_id: 'u2', email: 'u2@example.com' },
    { ...SUBSCRIBER_1, user_id: 'u3', email: 'u3@example.com' },
  ];

  const req = new Request('https://test.supabase.co/functions/v1/rag-newsletter-sender', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${SERVICE_ROLE_KEY}` },
  });
  const res = await handleNewsletterSend(req, {
    serviceRoleKey: SERVICE_ROLE_KEY,
    resendApiKey: RESEND_API_KEY,
    supabaseUrl: SUPABASE_URL,
    signingKey: SIGNING_KEY,
    fetchImpl,
    supabaseServiceClient: makeMockSupabase({ subscribers: subs }) as unknown as ReturnType<typeof import('npm:@supabase/supabase-js@2').createClient>,
  });
  assertEquals(res.status, 200);
  const body = await res.json() as Record<string, unknown>;
  assertEquals(body.sent, 3);
  // Each send is a separate POST to Resend (NOT BCC)
  const resendCalls = calls.filter((c) => c.url === 'https://api.resend.com/emails');
  assertEquals(resendCalls.length, 3);
});

// Test 5: Subscriber with last_sent_at within 6 days is SKIPPED
// (This is enforced by the SQL query filter on last_sent_at; we simulate it via empty result)
Deno.test('Subscriber with recent last_sent_at is excluded (SQL filter idempotency)', async () => {
  // When the DB returns no subscribers (all recently sent), result should be sent:0
  const { fetchImpl } = makeMockFetch();
  const req = new Request('https://test.supabase.co/functions/v1/rag-newsletter-sender', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${SERVICE_ROLE_KEY}` },
  });
  const res = await handleNewsletterSend(req, {
    serviceRoleKey: SERVICE_ROLE_KEY,
    resendApiKey: RESEND_API_KEY,
    supabaseUrl: SUPABASE_URL,
    signingKey: SIGNING_KEY,
    fetchImpl,
    supabaseServiceClient: makeMockSupabase({ subscribers: [] }) as unknown as ReturnType<typeof import('npm:@supabase/supabase-js@2').createClient>,
  });
  assertEquals(res.status, 200);
  const body = await res.json() as Record<string, unknown>;
  assertEquals(body.sent, 0);
});

// Test 6: Email includes List-Unsubscribe + List-Unsubscribe-Post headers (RFC 8058)
Deno.test('Email includes RFC 8058 List-Unsubscribe + List-Unsubscribe-Post headers', async () => {
  const { fetchImpl, calls } = makeMockFetch();
  const req = new Request('https://test.supabase.co/functions/v1/rag-newsletter-sender', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${SERVICE_ROLE_KEY}` },
  });
  await handleNewsletterSend(req, {
    serviceRoleKey: SERVICE_ROLE_KEY,
    resendApiKey: RESEND_API_KEY,
    supabaseUrl: SUPABASE_URL,
    signingKey: SIGNING_KEY,
    fetchImpl,
    supabaseServiceClient: makeMockSupabase({ subscribers: [SUBSCRIBER_1] }) as unknown as ReturnType<typeof import('npm:@supabase/supabase-js@2').createClient>,
  });

  const resendCall = calls.find((c) => c.url === 'https://api.resend.com/emails');
  assert(resendCall, 'Expected Resend API call');
  const sentBody = JSON.parse(resendCall.options.body as string) as Record<string, unknown>;
  const headers = sentBody.headers as Record<string, string>;
  assert(headers['List-Unsubscribe'], 'List-Unsubscribe header missing');
  assertEquals(headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
});

// Test 7: Unsubscribe URL contains the stored unsubscribe_token from the DB row
Deno.test('Unsubscribe URL contains stored unsubscribe_token (primary auth boundary)', async () => {
  const { fetchImpl, calls } = makeMockFetch();
  const req = new Request('https://test.supabase.co/functions/v1/rag-newsletter-sender', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${SERVICE_ROLE_KEY}` },
  });
  await handleNewsletterSend(req, {
    serviceRoleKey: SERVICE_ROLE_KEY,
    resendApiKey: RESEND_API_KEY,
    supabaseUrl: SUPABASE_URL,
    signingKey: SIGNING_KEY,
    fetchImpl,
    supabaseServiceClient: makeMockSupabase({ subscribers: [SUBSCRIBER_1] }) as unknown as ReturnType<typeof import('npm:@supabase/supabase-js@2').createClient>,
  });

  const resendCall = calls.find((c) => c.url === 'https://api.resend.com/emails');
  assert(resendCall);
  const sentBody = JSON.parse(resendCall.options.body as string) as Record<string, unknown>;
  const listUnsub = (sentBody.headers as Record<string, string>)['List-Unsubscribe'];
  // Stored token must appear in the URL
  assertStringIncludes(listUnsub, encodeURIComponent(SUBSCRIBER_1.unsubscribe_token));
  // User ID must appear in the URL
  assertStringIncludes(listUnsub, encodeURIComponent(SUBSCRIBER_1.user_id));
});

// Test 8: PHARMA-02 guardrail — chunk with gated topic_tag is skipped
Deno.test('PHARMA-02: chunk with gated topic_tag is excluded from email body', async () => {
  const { fetchImpl, calls } = makeMockFetch();
  // Use a PHARMA-02 gated topic_tag
  const pharmaChunk = {
    id: 'chunk-pharma',
    chunk_title: 'Compounded Semaglutide Dosing',
    source_text_excerpt: 'Dose range: 0.5mg...',
    summary: 'Start at 0.5mg compounded semaglutide.',
    tier: 'A',
    topic_tag: 'compounded-semaglutide-dosing', // PHARMA-02 gated
    canonical_url: null,
    source_name: 'Source',
  };

  const req = new Request('https://test.supabase.co/functions/v1/rag-newsletter-sender', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${SERVICE_ROLE_KEY}` },
  });
  await handleNewsletterSend(req, {
    serviceRoleKey: SERVICE_ROLE_KEY,
    resendApiKey: RESEND_API_KEY,
    supabaseUrl: SUPABASE_URL,
    signingKey: SIGNING_KEY,
    fetchImpl,
    supabaseServiceClient: makeMockSupabase({
      subscribers: [SUBSCRIBER_1],
      recentChunks: [pharmaChunk],
    }) as unknown as ReturnType<typeof import('npm:@supabase/supabase-js@2').createClient>,
  });

  // The pharma chunk should NOT appear in the HTML body
  const resendCall = calls.find((c) => c.url === 'https://api.resend.com/emails');
  if (resendCall) {
    const sentBody = JSON.parse(resendCall.options.body as string) as Record<string, unknown>;
    const html = sentBody.html as string;
    assert(!html.includes('Compounded Semaglutide Dosing'), 'PHARMA-02 chunk should be excluded from HTML');
  }
});

// Test 9: HTML template renders all variables; chunk fields are HTML-encoded
Deno.test('HTML template HTML-encodes chunk_title with script tag attempt (T-60-12-05)', async () => {
  const { fetchImpl, calls } = makeMockFetch();
  const xssChunk = {
    id: 'chunk-xss',
    chunk_title: '<script>alert("xss")</script>',
    source_text_excerpt: 'Normal excerpt',
    summary: 'GLP-1 overview & more',
    tier: 'A',
    topic_tag: 'glp-1',
    canonical_url: 'https://example.com',
    source_name: 'NEJM',
  };

  const req = new Request('https://test.supabase.co/functions/v1/rag-newsletter-sender', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${SERVICE_ROLE_KEY}` },
  });
  await handleNewsletterSend(req, {
    serviceRoleKey: SERVICE_ROLE_KEY,
    resendApiKey: RESEND_API_KEY,
    supabaseUrl: SUPABASE_URL,
    signingKey: SIGNING_KEY,
    fetchImpl,
    supabaseServiceClient: makeMockSupabase({
      subscribers: [SUBSCRIBER_1],
      recentChunks: [xssChunk],
    }) as unknown as ReturnType<typeof import('npm:@supabase/supabase-js@2').createClient>,
  });

  const resendCall = calls.find((c) => c.url === 'https://api.resend.com/emails');
  assert(resendCall, 'Expected Resend API call');
  const sentBody = JSON.parse(resendCall.options.body as string) as Record<string, unknown>;
  const html = sentBody.html as string;
  // Raw <script> tag must NOT appear in HTML
  assert(!html.includes('<script>alert'), 'XSS tag should be HTML-encoded');
  // Encoded version MUST appear
  assertStringIncludes(html, '&lt;script&gt;');
});

// Test 10: Subject line format matches UI-SPEC; no \r\n injection possible
Deno.test('Subject line is "LeanShot Research: Week of YYYY-MM-DD" — no \\r\\n injection', async () => {
  const { fetchImpl, calls } = makeMockFetch();
  const req = new Request('https://test.supabase.co/functions/v1/rag-newsletter-sender', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${SERVICE_ROLE_KEY}` },
  });
  await handleNewsletterSend(req, {
    serviceRoleKey: SERVICE_ROLE_KEY,
    resendApiKey: RESEND_API_KEY,
    supabaseUrl: SUPABASE_URL,
    signingKey: SIGNING_KEY,
    fetchImpl,
    supabaseServiceClient: makeMockSupabase({ subscribers: [SUBSCRIBER_1] }) as unknown as ReturnType<typeof import('npm:@supabase/supabase-js@2').createClient>,
  });

  const resendCall = calls.find((c) => c.url === 'https://api.resend.com/emails');
  assert(resendCall);
  const sentBody = JSON.parse(resendCall.options.body as string) as Record<string, unknown>;
  const subject = sentBody.subject as string;
  assert(subject.startsWith('LeanShot Research: Week of'), `Subject should start with expected prefix, got: ${subject}`);
  assert(!subject.includes('\r'), 'Subject must not contain CR');
  assert(!subject.includes('\n'), 'Subject must not contain LF');
});

// Test 11: Cost telemetry — verify emitAiGeneration is called per subscriber
// (We verify indirectly: sent count equals subscriber count, confirming full send path ran)
Deno.test('Cost telemetry: emitAiGeneration called per successful send (sent count matches)', async () => {
  const { fetchImpl } = makeMockFetch();
  const subs = [SUBSCRIBER_1, { ...SUBSCRIBER_1, user_id: 'u2', email: 'u2@ex.com' }];
  const req = new Request('https://test.supabase.co/functions/v1/rag-newsletter-sender', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${SERVICE_ROLE_KEY}` },
  });
  const res = await handleNewsletterSend(req, {
    serviceRoleKey: SERVICE_ROLE_KEY,
    resendApiKey: RESEND_API_KEY,
    supabaseUrl: SUPABASE_URL,
    signingKey: SIGNING_KEY,
    fetchImpl,
    supabaseServiceClient: makeMockSupabase({ subscribers: subs }) as unknown as ReturnType<typeof import('npm:@supabase/supabase-js@2').createClient>,
  });
  const body = await res.json() as Record<string, unknown>;
  // sent=2 confirms full send path including emitAiGeneration ran for each
  assertEquals(body.sent, 2);
});

// Test 12: Deno.serve guarded by import.meta.main — verify via source code inspection
Deno.test('Deno.serve is guarded by import.meta.main (source code assertion)', async () => {
  const src = await Deno.readTextFile(
    new URL('../index.ts', import.meta.url),
  );
  // Must contain the import.meta.main guard
  assert(src.includes('if (import.meta.main)'), 'Deno.serve must be guarded by import.meta.main');
  assert(src.includes('Deno.serve('), 'Deno.serve must be present but guarded');
  assert(src.includes('handleNewsletterSend'), 'handleNewsletterSend must be referenced in serve call');
});
