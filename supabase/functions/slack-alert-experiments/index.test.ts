/**
 * Phase 39 Plan 39-03 — Deno tests for `slack-alert-experiments` Edge Function.
 *
 * Test plan (Task 1 <behavior>):
 *   T1 — SLACK_WEBHOOK_EXPERIMENTS_URL unset → 503 vendor_unconfigured; no fetch
 *   T2 — Valid bearer + body → POSTs JSON to webhook URL → 200 ok
 *   T3 — Missing bearer → 401 unauthenticated; no fetch
 *   T4 — Wrong bearer → 401 unauthenticated; no fetch
 *   T5 — Body missing `kind` → 400 invalid_body
 *   T6 — Body with disallowed `kind` literal → 400 invalid_body
 *   T7 — Slack returns 500 → 502 slack_upstream with status
 *   T8 — OPTIONS preflight → 204 CORS
 *   T9 — Body with valid context attachment → fetch body contains attachments
 *
 * Per [[reference_supabase_service_role_key_format_divergence]]: bearer is
 * the sb_secret_* token, NOT the legacy HS256 JWT.
 */
import { assertEquals, assert } from 'jsr:@std/assert@^1';
import { __internal } from './index.ts';

const SRK = 'sb_secret_test_value';
const WEBHOOK = 'https://hooks.slack.com/services/T000/B000/test';

interface FetchCall {
  url: string;
  method?: string;
  body?: string;
  contentType?: string;
}

function installFetchSpy(
  log: FetchCall[],
  responder: (url: string) => Response,
): () => void {
  const orig = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
    const body = typeof init?.body === 'string' ? init.body : undefined;
    const headers = (init?.headers as Record<string, string> | undefined) ?? {};
    log.push({ url, method: init?.method, body, contentType: headers['Content-Type'] });
    return Promise.resolve(responder(url));
  }) as typeof fetch;
  return () => {
    globalThis.fetch = orig;
  };
}

function setConfigured(): void {
  Deno.env.set('SLACK_WEBHOOK_EXPERIMENTS_URL', WEBHOOK);
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', SRK);
}

function mkReq(opts: { method?: string; bearer?: string; body?: unknown; rawBody?: string }): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.bearer) headers.Authorization = `Bearer ${opts.bearer}`;
  return new Request('http://localhost/functions/v1/slack-alert-experiments', {
    method: opts.method ?? 'POST',
    headers,
    body: opts.rawBody !== undefined
      ? opts.rawBody
      : opts.body === undefined
        ? undefined
        : JSON.stringify(opts.body),
  });
}

const VALID_BODY = {
  kind: 'variant_kill',
  variant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  message: 'Variant disabled by refund-rate kill',
};

// ---------------------------------------------------------------------------
// T1 — SLACK_WEBHOOK_EXPERIMENTS_URL unset → 503; no fetch
// ---------------------------------------------------------------------------

Deno.test('T1: SLACK_WEBHOOK_EXPERIMENTS_URL unset → 503 vendor_unconfigured', async () => {
  setConfigured();
  Deno.env.delete('SLACK_WEBHOOK_EXPERIMENTS_URL');
  const calls: FetchCall[] = [];
  const restore = installFetchSpy(calls, () => new Response('ok', { status: 200 }));

  try {
    const res = await __internal.handleSlackAlert(mkReq({ bearer: SRK, body: VALID_BODY }));
    assertEquals(res.status, 503);
    const body = (await res.json()) as { error: string; service: string };
    assertEquals(body.error, 'vendor_unconfigured');
    assertEquals(body.service, 'slack');
    assertEquals(calls.length, 0);
  } finally {
    restore();
    setConfigured();
  }
});

// ---------------------------------------------------------------------------
// T2 — Valid bearer + body → POST → 200 ok
// ---------------------------------------------------------------------------

Deno.test('T2: valid bearer + body → POSTs JSON → 200 ok', async () => {
  setConfigured();
  const calls: FetchCall[] = [];
  const restore = installFetchSpy(calls, () => new Response('ok', { status: 200 }));

  try {
    const res = await __internal.handleSlackAlert(mkReq({ bearer: SRK, body: VALID_BODY }));
    assertEquals(res.status, 200);
    const body = (await res.json()) as { ok: boolean };
    assertEquals(body.ok, true);
    assertEquals(calls.length, 1);
    assertEquals(calls[0].url, WEBHOOK);
    assertEquals(calls[0].method, 'POST');
    assertEquals(calls[0].contentType, 'application/json');
    assert(calls[0].body!.includes('variant_kill'));
    assert(calls[0].body!.includes('Variant disabled'));
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// T3 — Missing bearer → 401
// ---------------------------------------------------------------------------

Deno.test('T3: missing bearer → 401 unauthenticated; no fetch', async () => {
  setConfigured();
  const calls: FetchCall[] = [];
  const restore = installFetchSpy(calls, () => new Response('ok', { status: 200 }));

  try {
    const res = await __internal.handleSlackAlert(mkReq({ body: VALID_BODY }));
    assertEquals(res.status, 401);
    const body = (await res.json()) as { error: string };
    assertEquals(body.error, 'unauthenticated');
    assertEquals(calls.length, 0);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// T4 — Wrong bearer → 401
// ---------------------------------------------------------------------------

Deno.test('T4: wrong bearer → 401 unauthenticated; no fetch', async () => {
  setConfigured();
  const calls: FetchCall[] = [];
  const restore = installFetchSpy(calls, () => new Response('ok', { status: 200 }));

  try {
    const res = await __internal.handleSlackAlert(
      mkReq({ bearer: 'sb_secret_wrong_value', body: VALID_BODY }),
    );
    assertEquals(res.status, 401);
    assertEquals(calls.length, 0);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// T5 — Body missing kind → 400
// ---------------------------------------------------------------------------

Deno.test('T5: body missing kind → 400 invalid_body', async () => {
  setConfigured();
  const calls: FetchCall[] = [];
  const restore = installFetchSpy(calls, () => new Response('ok', { status: 200 }));

  try {
    const res = await __internal.handleSlackAlert(
      mkReq({ bearer: SRK, body: { variant_id: 'v1', message: 'm' } }),
    );
    assertEquals(res.status, 400);
    assertEquals(calls.length, 0);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// T6 — Body with disallowed kind → 400
// ---------------------------------------------------------------------------

Deno.test('T6: disallowed kind → 400 invalid_body', async () => {
  setConfigured();
  const calls: FetchCall[] = [];
  const restore = installFetchSpy(calls, () => new Response('ok', { status: 200 }));

  try {
    const res = await __internal.handleSlackAlert(
      mkReq({ bearer: SRK, body: { kind: 'launch_party', variant_id: 'v1', message: 'm' } }),
    );
    assertEquals(res.status, 400);
    assertEquals(calls.length, 0);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// T7 — Slack returns 500 → 502
// ---------------------------------------------------------------------------

Deno.test('T7: Slack returns 500 → 502 slack_upstream', async () => {
  setConfigured();
  const calls: FetchCall[] = [];
  const restore = installFetchSpy(calls, () => new Response('internal', { status: 500 }));

  try {
    const res = await __internal.handleSlackAlert(mkReq({ bearer: SRK, body: VALID_BODY }));
    assertEquals(res.status, 502);
    const body = (await res.json()) as { error: string; status: number };
    assertEquals(body.error, 'slack_upstream');
    assertEquals(body.status, 500);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// T8 — OPTIONS preflight → 204
// ---------------------------------------------------------------------------

Deno.test('T8: OPTIONS preflight → 204 with CORS headers', async () => {
  setConfigured();
  const calls: FetchCall[] = [];
  const restore = installFetchSpy(calls, () => new Response('ok', { status: 200 }));

  try {
    const res = await __internal.handleSlackAlert(mkReq({ method: 'OPTIONS' }));
    assertEquals(res.status, 204);
    assert(res.headers.get('Access-Control-Allow-Origin') !== null);
    assertEquals(calls.length, 0);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// T9 — Valid context → fetch body contains attachments
// ---------------------------------------------------------------------------

Deno.test('T9: body with context → fetch body includes attachments', async () => {
  setConfigured();
  const calls: FetchCall[] = [];
  const restore = installFetchSpy(calls, () => new Response('ok', { status: 200 }));

  try {
    const res = await __internal.handleSlackAlert(
      mkReq({
        bearer: SRK,
        body: { ...VALID_BODY, context: { refund_rate_7d: 0.18, baseline_30d: 0.06 } },
      }),
    );
    assertEquals(res.status, 200);
    assertEquals(calls.length, 1);
    assert(calls[0].body!.includes('attachments'));
    assert(calls[0].body!.includes('refund_rate_7d'));
  } finally {
    restore();
  }
});
