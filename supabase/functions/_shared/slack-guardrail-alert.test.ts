/**
 * slack-guardrail-alert.test.ts — Deno tests for _shared/slack-guardrail-alert.ts
 *
 * Phase 60 Plan 60-02.
 *
 * All tests mock the vault admin client and globalThis.fetch — no real network
 * access or Supabase connection required.
 *
 * Behaviors tested:
 *  1. No-op + warn when SUPABASE_URL missing.
 *  2. POSTs to fetched webhook URL with correct body (channel, color, method).
 *  3. No throw on fetch 500 — console.warn emitted with status code.
 *  4. No-op + warn when vault row absent (fetch never called).
 *  5. Channel mapping: each key maps to correct #alerts-<channel> string.
 */

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';

// ──────────────────────────────────────────────────────────────────────────────
// Helper: stub vault admin returning a specific maybeSingle result
// ──────────────────────────────────────────────────────────────────────────────

function makeVaultStub(decryptedSecret: string | null) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: decryptedSecret ? { decrypted_secret: decryptedSecret } : null,
            error: null,
          }),
        }),
      }),
    }),
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

Deno.test('1. no-op + warn when SUPABASE_URL missing', async () => {
  const origUrl = Deno.env.get('SUPABASE_URL');
  const origSrk = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  Deno.env.delete('SUPABASE_URL');
  Deno.env.delete('SUPABASE_SERVICE_ROLE_KEY');

  const {
    sendSlackGuardrailAlert,
    resetVaultAdminForTest,
    resetCachedWebhookForTest,
  } = await import('./slack-guardrail-alert.ts');

  resetVaultAdminForTest();
  resetCachedWebhookForTest();

  const warnMessages: string[] = [];
  const origWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnMessages.push(args.map(String).join(' '));
  };

  let fetchCalled = false;
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalled = true;
    return new Response('ok', { status: 200 });
  };

  try {
    await sendSlackGuardrailAlert('pharma02', {
      severity: 'P1',
      title: 'PHARMA-02 trip',
      text: 'Invariant violated',
    });

    assertEquals(fetchCalled, false, 'fetch must NOT be called when SUPABASE_URL missing');
    assertEquals(
      warnMessages.some((m) => m.includes('SUPABASE_URL') || m.includes('SUPABASE_SERVICE_ROLE_KEY')),
      true,
      'Expected warning about missing env vars',
    );
  } finally {
    console.warn = origWarn;
    globalThis.fetch = origFetch;
    if (origUrl) Deno.env.set('SUPABASE_URL', origUrl);
    if (origSrk) Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', origSrk);
    resetVaultAdminForTest();
    resetCachedWebhookForTest();
  }
});

Deno.test('2. POSTs to fetched webhook URL with correct body', async () => {
  const {
    sendSlackGuardrailAlert,
    setVaultAdminForTest,
    resetVaultAdminForTest,
    resetCachedWebhookForTest,
  } = await import('./slack-guardrail-alert.ts');

  resetVaultAdminForTest();
  resetCachedWebhookForTest();

  const WEBHOOK_URL = 'https://hooks.slack.com/services/AAA/BBB/CCC';
  setVaultAdminForTest(makeVaultStub(WEBHOOK_URL));

  let capturedUrl = '';
  let capturedMethod = '';
  let capturedBody = '';
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url: string | URL | Request, init?: RequestInit) => {
    capturedUrl = typeof url === 'string' ? url : url.toString();
    capturedMethod = init?.method ?? '';
    capturedBody = typeof init?.body === 'string' ? init.body : '';
    return new Response('ok', { status: 200 });
  };

  try {
    await sendSlackGuardrailAlert('pharma02', {
      severity: 'P1',
      title: 'Test alert',
      text: 'Something happened',
      trace_id: 'trace-abc',
    });

    assertEquals(capturedUrl, WEBHOOK_URL, 'Must POST to the vault-fetched URL');
    assertEquals(capturedMethod, 'POST', 'Must use POST method');

    const parsed = JSON.parse(capturedBody);
    assertEquals(parsed.channel, '#alerts-pharma02', 'Channel must map to #alerts-pharma02');
    assertEquals(parsed.attachments[0].color, '#FF0000', 'P1 severity must map to red');
    assertEquals(parsed.attachments[0].title, 'Test alert');
    assertEquals(
      parsed.attachments[0].fields.some(
        (f: { title: string }) => f.title === 'trace_id',
      ),
      true,
      'trace_id field must be appended',
    );
  } finally {
    globalThis.fetch = origFetch;
    resetVaultAdminForTest();
    resetCachedWebhookForTest();
  }
});

Deno.test('3. no throw on fetch 500 — console.warn emitted with status code', async () => {
  const {
    sendSlackGuardrailAlert,
    setVaultAdminForTest,
    resetVaultAdminForTest,
    resetCachedWebhookForTest,
  } = await import('./slack-guardrail-alert.ts');

  resetVaultAdminForTest();
  resetCachedWebhookForTest();

  setVaultAdminForTest(makeVaultStub('https://hooks.slack.com/services/AAA/BBB/CCC'));

  const warnMessages: string[] = [];
  const origWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnMessages.push(args.map(String).join(' '));
  };

  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('Server error', { status: 500 });

  let threw = false;
  try {
    await sendSlackGuardrailAlert('cost', {
      severity: 'P2',
      title: 'Cost breach',
      text: 'Rolling mean exceeded',
    });
  } catch {
    threw = true;
  } finally {
    console.warn = origWarn;
    globalThis.fetch = origFetch;
    resetVaultAdminForTest();
    resetCachedWebhookForTest();
  }

  assertEquals(threw, false, 'Must NOT throw on HTTP 500');
  assertEquals(
    warnMessages.some((m) => m.includes('500')),
    true,
    'console.warn must include status code 500',
  );
});

Deno.test('4. no-op + warn when vault row absent — fetch never called', async () => {
  const {
    sendSlackGuardrailAlert,
    setVaultAdminForTest,
    resetVaultAdminForTest,
    resetCachedWebhookForTest,
  } = await import('./slack-guardrail-alert.ts');

  resetVaultAdminForTest();
  resetCachedWebhookForTest();

  // Vault returns null (no row found)
  setVaultAdminForTest(makeVaultStub(null));

  const warnMessages: string[] = [];
  const origWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnMessages.push(args.map(String).join(' '));
  };

  let fetchCallCount = 0;
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCallCount++;
    return new Response('ok', { status: 200 });
  };

  try {
    // First call — should warn once
    await sendSlackGuardrailAlert('rag', {
      severity: 'P3',
      title: 'Stale drift',
      text: 'Queue too deep',
    });

    const warnCount1 = warnMessages.filter((m) => m.includes('not found')).length;

    // Second call within same isolate — should NOT re-warn (one-time-warn flag)
    await sendSlackGuardrailAlert('rag', {
      severity: 'P3',
      title: 'Another alert',
      text: 'Still no row',
    });

    const warnCount2 = warnMessages.filter((m) => m.includes('not found')).length;

    assertEquals(fetchCallCount, 0, 'fetch must NEVER be called when vault row absent');
    assertEquals(warnCount1, 1, 'First call must emit exactly one vault-row-absent warning');
    assertEquals(warnCount2, 1, 'Second call must NOT re-warn (one-time-warn)');
  } finally {
    console.warn = origWarn;
    globalThis.fetch = origFetch;
    resetVaultAdminForTest();
    resetCachedWebhookForTest();
  }
});

Deno.test('5. channel mapping: each key maps to correct #alerts-<channel> string', async () => {
  const {
    sendSlackGuardrailAlert,
    setVaultAdminForTest,
    resetVaultAdminForTest,
    resetCachedWebhookForTest,
  } = await import('./slack-guardrail-alert.ts');

  const channels = [
    'pharma02',
    'regulatory',
    'rag',
    'cost',
    'research',
  ] as const;

  for (const channel of channels) {
    resetVaultAdminForTest();
    resetCachedWebhookForTest();

    setVaultAdminForTest(makeVaultStub('https://hooks.slack.com/services/AAA/BBB/CCC'));

    let postedChannel = '';
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}');
      postedChannel = body.channel ?? '';
      return new Response('ok', { status: 200 });
    };

    try {
      await sendSlackGuardrailAlert(channel, {
        severity: 'P2',
        title: `Test ${channel}`,
        text: 'Mapping test',
      });
      assertEquals(
        postedChannel,
        `#alerts-${channel}`,
        `channel '${channel}' must map to '#alerts-${channel}'`,
      );
    } finally {
      globalThis.fetch = origFetch;
    }
  }

  resetVaultAdminForTest();
  resetCachedWebhookForTest();
});
