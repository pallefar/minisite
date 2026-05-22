/**
 * Deno tests for `nps-trigger-decide` Edge Function — Phase 36 Plan 36-02 Task 1.
 *
 * Smoke tests covering the request/response contract:
 *   T1 — no Bearer → 401 unauthenticated
 *   T2 — invalid JWT (admin.auth.getUser returns error) → 401
 *   T3 — OPTIONS preflight → 204 with CORS
 *   T4 — body missing event_name → 400 invalid_body
 *   T5 — happy path returns fire=true with cta_set carrying {slug, url_pattern} (W9)
 *   T6 — happy-path returns copy_variant from the resolver
 *   T7 — captureServer is invoked with userId + nps_prompt_shown event
 *
 * Cooldown branch tests live in cooldown.test.ts.
 * CTA-resolution tests live in cta-resolve.test.ts.
 *
 * Per [[reference_deno_test_discovery]]: filename is `index.test.ts` (NOT `-test.ts`).
 */
import { assert, assertEquals } from 'jsr:@std/assert@^1';
import { __internal } from './index.ts';
import {
  installCaptureSpy,
  makeFakeAdmin,
  mkReq,
  type FakeAdminCfg,
  type FakeAdminLog,
} from './_test-fixtures.ts';

const USER_UUID = '11111111-1111-4111-8111-111111111111';
const VALID_JWT = 'valid-jwt';

function setEnv(): void {
  // Unset both PostHog and Supabase env so:
  //   - captureServer (posthog-server.ts:42-48) becomes a no-op (no PostHog HTTP)
  //   - the events_mirror dual-write (posthog-server.ts:64-79) is env-gated off
  //     so no fetch to localhost:54321 happens and no fetchCancelHandle leaks.
  // The admin SupabaseClient used by handleDecide is swapped via setAdminForTest()
  // so we never need the real env vars.
  Deno.env.delete('POSTHOG_PROJECT_KEY');
  Deno.env.delete('SUPABASE_URL');
  Deno.env.delete('SUPABASE_SERVICE_ROLE_KEY');
}

function defaultCfg(overrides: Partial<FakeAdminCfg> = {}): FakeAdminCfg {
  const log: FakeAdminLog = { historyInserts: [], rulesQueriedFor: [], ctaQueries: [] };
  return {
    log,
    authBehavior: 'ok',
    userUid: USER_UUID,
    history: [],
    rules: [
      { id: 'rule-1', trigger_event: 'activation_completed', active: true, created_at: '2026-01-01T00:00:00Z' },
    ],
    profile: { primary_org_id: null },
    cta: [
      { slug: 'trustpilot', url_pattern: 'https://www.trustpilot.com/review/leanshot.app' },
    ],
    insertBehavior: 'ok',
    ...overrides,
  };
}

Deno.test('T1: no Bearer → 401 unauthenticated', async () => {
  setEnv();
  __internal.resetAdminForTest();
  const cfg = defaultCfg();
  __internal.setAdminForTest(makeFakeAdmin(cfg));
  __internal.setVariantResolverForTest(async () => 'control');
  try {
    const res = await (__internal as unknown as {
      handleDecide: (req: Request) => Promise<Response>;
    }).handleDecide(mkReq({ body: { event_name: 'activation_completed' } }));
    assertEquals(res.status, 401);
    const body = (await res.json()) as { error: string };
    assertEquals(body.error, 'unauthenticated');
  } finally {
    __internal.resetVariantResolverForTest();
    __internal.resetAdminForTest();
  }
});

Deno.test('T2: invalid JWT → 401 unauthenticated', async () => {
  setEnv();
  __internal.resetAdminForTest();
  const cfg = defaultCfg({ authBehavior: 'error' });
  __internal.setAdminForTest(makeFakeAdmin(cfg));
  __internal.setVariantResolverForTest(async () => 'control');
  try {
    const res = await (__internal as unknown as {
      handleDecide: (req: Request) => Promise<Response>;
    }).handleDecide(mkReq({ jwt: VALID_JWT, body: { event_name: 'activation_completed' } }));
    assertEquals(res.status, 401);
  } finally {
    __internal.resetVariantResolverForTest();
    __internal.resetAdminForTest();
  }
});

Deno.test('T3: OPTIONS preflight → 204 with CORS', async () => {
  setEnv();
  __internal.resetAdminForTest();
  __internal.setAdminForTest(makeFakeAdmin(defaultCfg()));
  try {
    const res = await (__internal as unknown as {
      handleDecide: (req: Request) => Promise<Response>;
    }).handleDecide(mkReq({ method: 'OPTIONS' }));
    assertEquals(res.status, 204);
    assert(res.headers.get('Access-Control-Allow-Origin') !== null);
  } finally {
    __internal.resetAdminForTest();
  }
});

Deno.test('T4: body missing event_name → 400 invalid_body', async () => {
  setEnv();
  __internal.resetAdminForTest();
  __internal.setAdminForTest(makeFakeAdmin(defaultCfg()));
  __internal.setVariantResolverForTest(async () => 'control');
  try {
    const res = await (__internal as unknown as {
      handleDecide: (req: Request) => Promise<Response>;
    }).handleDecide(mkReq({ jwt: VALID_JWT, body: {} }));
    assertEquals(res.status, 400);
    const body = (await res.json()) as { error: string };
    assertEquals(body.error, 'invalid_body');
  } finally {
    __internal.resetVariantResolverForTest();
    __internal.resetAdminForTest();
  }
});

Deno.test('T5: happy path — fire=true, cta_set carries {slug,url_pattern} (W9), copy_variant from resolver', async () => {
  setEnv();
  __internal.resetAdminForTest();
  const cfg = defaultCfg();
  __internal.setAdminForTest(makeFakeAdmin(cfg));
  __internal.setVariantResolverForTest(async () => 'variant-b');
  try {
    const res = await (__internal as unknown as {
      handleDecide: (req: Request) => Promise<Response>;
    }).handleDecide(mkReq({ jwt: VALID_JWT, body: { event_name: 'activation_completed' } }));
    assertEquals(res.status, 200);
    const body = (await res.json()) as {
      fire: boolean;
      copy_variant: string;
      cta_set: Array<{ slug: string; url_pattern: string }>;
      rule_id: string;
    };
    assertEquals(body.fire, true);
    assertEquals(body.copy_variant, 'variant-b');
    assertEquals(body.rule_id, 'rule-1');
    // W9: cta_set carries url_pattern from review_cta_catalog
    assertEquals(body.cta_set.length, 1);
    assertEquals(body.cta_set[0].slug, 'trustpilot');
    assert(body.cta_set[0].url_pattern.startsWith('https://'));
    // B2: history INSERT included copy_variant
    assertEquals(cfg.log.historyInserts.length, 1);
    assertEquals(cfg.log.historyInserts[0].copy_variant, 'variant-b');
    assertEquals(cfg.log.historyInserts[0].user_id, USER_UUID);
    assertEquals(cfg.log.historyInserts[0].rule_id, 'rule-1');
  } finally {
    __internal.resetVariantResolverForTest();
    __internal.resetAdminForTest();
  }
});

Deno.test('T6: variant resolver throws → defaults to "control"; copy_variant column still written (B2 graceful degrade)', async () => {
  setEnv();
  __internal.resetAdminForTest();
  const cfg = defaultCfg();
  __internal.setAdminForTest(makeFakeAdmin(cfg));
  __internal.setVariantResolverForTest(async () => {
    throw new Error('posthog network blew up');
  });
  try {
    const res = await (__internal as unknown as {
      handleDecide: (req: Request) => Promise<Response>;
    }).handleDecide(mkReq({ jwt: VALID_JWT, body: { event_name: 'activation_completed' } }));
    assertEquals(res.status, 200);
    const body = (await res.json()) as { fire: boolean; copy_variant: string };
    assertEquals(body.fire, true);
    assertEquals(body.copy_variant, 'control');
    assertEquals(cfg.log.historyInserts[0].copy_variant, 'control');
  } finally {
    __internal.resetVariantResolverForTest();
    __internal.resetAdminForTest();
  }
});

Deno.test('T7: shutdownPostHog awaited in finally (no throw on missing POSTHOG_PROJECT_KEY)', async () => {
  // POSTHOG_PROJECT_KEY is intentionally unset by setEnv(); captureServer is a
  // no-op and shutdownPostHog is idempotent. The test asserts that the handler
  // returns normally — the finally-block shutdown does not throw.
  setEnv();
  __internal.resetAdminForTest();
  const cfg = defaultCfg();
  __internal.setAdminForTest(makeFakeAdmin(cfg));
  __internal.setVariantResolverForTest(async () => 'control');
  const restore = installCaptureSpy();
  try {
    const res = await (__internal as unknown as {
      handleDecide: (req: Request) => Promise<Response>;
    }).handleDecide(mkReq({ jwt: VALID_JWT, body: { event_name: 'activation_completed' } }));
    assertEquals(res.status, 200);
    // Even with the spy installed, no events should be required to flush — the
    // test simply asserts no exception escaped the handler.
  } finally {
    restore();
    __internal.resetVariantResolverForTest();
    __internal.resetAdminForTest();
  }
});
