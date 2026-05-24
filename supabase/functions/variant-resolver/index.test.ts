/**
 * Phase 39 Plan 39-03 — Deno tests for `variant-resolver` Edge Function.
 *
 * Test plan (9 behaviors from 39-03-PLAN.md Task 1 <behavior>):
 *   T1 — Missing JWT → 401 unauthenticated
 *   T2 — Invalid body (missing surface) → 400 invalid_body
 *   T3 — POSTHOG_PROJECT_KEY missing → 503 vendor_unconfigured
 *   T4 — WA region (Vercel header) short-circuits pharma → control, empty config
 *   T5 — profile.state='CT' overrides absent header for pharma → control
 *   T6 — Cohort id from RPC wins over UTM (cohort variant returned)
 *   T7 — UTM cookie 'lean' maps to variant_lean when no cohort
 *   T8 — Repeat call for same (uid, surface) returns existing variant_id
 *   T9 — captureServer called once with $feature_flag_called + surface + variant_id
 *
 * Per [[reference_deno_test_top_level_serve_trap]]: index.ts guards Deno.serve
 * with `import.meta.main` so importing the module here does NOT start a server.
 */
import { assertEquals, assert } from 'jsr:@std/assert@^1';
import { __internal } from './index.ts';

const USER_UUID = '11111111-1111-4111-8111-111111111111';
const COHORT_UUID = '22222222-2222-4222-8222-222222222222';
const COHORT_VARIANT_UUID = '33333333-3333-4333-8333-333333333333';
const UTM_VARIANT_UUID = '44444444-4444-4444-8444-444444444444';
const UTM_ROW_UUID = '55555555-5555-4555-8555-555555555555';
const VALID_JWT = 'valid-jwt';

// ---------------------------------------------------------------------------
// Env helpers
// ---------------------------------------------------------------------------

function setConfigured(): void {
  Deno.env.set('POSTHOG_PROJECT_KEY', 'phc_test_key');
  Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'sb_secret_test');
}

// ---------------------------------------------------------------------------
// Fake admin + capture spy
// ---------------------------------------------------------------------------

interface DbCall {
  table: string;
  op: string;
  args?: unknown[];
}

interface FakeCfg {
  // Auth
  authBehavior?: 'ok' | 'error';
  // Tables: lookups can return null, a single row, or arrays of rows.
  existingUserExp?: { variant_id: string } | null;
  profileState?: string | null;
  cohortRpcResult?: string | null;
  cohortVariantRow?: { id: string } | null;
  utmRowBySource?: Record<string, { id: string; variant_id: string | null }>;
  variantConfigById?: Record<string, { config: Record<string, unknown> }>;
  // Spies
  log: {
    db: DbCall[];
    upserts: Array<Record<string, unknown>>;
    captures: Array<{ userId: string; event: string; properties?: Record<string, unknown> }>;
  };
}

// deno-lint-ignore no-explicit-any
function makeFakeAdmin(cfg: FakeCfg): any {
  return {
    auth: {
      getUser: (_jwt: string) => {
        if (cfg.authBehavior === 'error') {
          return Promise.resolve({ data: { user: null }, error: { message: 'invalid' } });
        }
        return Promise.resolve({ data: { user: { id: USER_UUID } }, error: null });
      },
    },
    rpc: (fn: string, args: unknown) => {
      cfg.log.db.push({ table: '(rpc)', op: fn, args: [args] });
      if (fn === 'resolve_cohort_for_user') {
        return Promise.resolve({ data: cfg.cohortRpcResult ?? null, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    from: (table: string) => makeTable(table, cfg),
  };
}

// deno-lint-ignore no-explicit-any
function makeTable(table: string, cfg: FakeCfg): any {
  // Builder collects chained calls; terminator methods (maybeSingle / upsert) resolve.
  const state: { filters: Array<{ col: string; val: unknown }>; nulls: string[]; limited?: number } = {
    filters: [],
    nulls: [],
  };
  const builder = {
    select: (_cols: string) => builder,
    eq: (col: string, val: unknown) => {
      state.filters.push({ col, val });
      return builder;
    },
    is: (col: string, val: unknown) => {
      if (val === null) state.nulls.push(col);
      return builder;
    },
    limit: (n: number) => {
      state.limited = n;
      return builder;
    },
    maybeSingle: () => {
      cfg.log.db.push({ table, op: 'select', args: state.filters });
      if (table === 'user_experiments') {
        const userMatch = state.filters.find((f) => f.col === 'user_id' && f.val === USER_UUID);
        if (userMatch && cfg.existingUserExp !== undefined) {
          return Promise.resolve({ data: cfg.existingUserExp, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      }
      if (table === 'profiles') {
        return Promise.resolve({ data: { state_of_residence: cfg.profileState ?? null }, error: null });
      }
      if (table === 'variant_config') {
        // Two callsites: cohort lookup (cohort_id + surface) OR fetchVariantConfig (id).
        const idFilter = state.filters.find((f) => f.col === 'id');
        if (idFilter && cfg.variantConfigById) {
          const row = cfg.variantConfigById[idFilter.val as string];
          return Promise.resolve({ data: row ?? null, error: null });
        }
        const cohortFilter = state.filters.find((f) => f.col === 'cohort_id');
        if (cohortFilter) {
          return Promise.resolve({ data: cfg.cohortVariantRow ?? null, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      }
      if (table === 'utm_variant_map') {
        const sourceFilter = state.filters.find((f) => f.col === 'utm_source');
        if (sourceFilter && cfg.utmRowBySource) {
          const row = cfg.utmRowBySource[sourceFilter.val as string];
          return Promise.resolve({ data: row ?? null, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    upsert: (row: Record<string, unknown>, _opts?: unknown) => {
      cfg.log.db.push({ table, op: 'upsert' });
      cfg.log.upserts.push(row);
      return Promise.resolve({ data: null, error: null });
    },
  };
  return builder;
}

function mkReq(opts: {
  method?: string;
  jwt?: string;
  body?: unknown;
  cookies?: Record<string, string>;
  region?: string;
}): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.jwt) headers.Authorization = `Bearer ${opts.jwt}`;
  if (opts.cookies) {
    headers.Cookie = Object.entries(opts.cookies)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('; ');
  }
  if (opts.region) headers['x-vercel-ip-country-region'] = opts.region;
  return new Request('http://localhost/functions/v1/variant-resolver', {
    method: opts.method ?? 'POST',
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

function freshLog(): FakeCfg['log'] {
  return { db: [], upserts: [], captures: [] };
}

function installCaptureSpy(log: FakeCfg['log']): void {
  __internal.setCaptureForTest((args) => {
    log.captures.push(args);
  });
}

// ---------------------------------------------------------------------------
// T1 — Missing JWT → 401
// ---------------------------------------------------------------------------

Deno.test('T1: missing JWT → 401 unauthenticated', async () => {
  setConfigured();
  __internal.resetAdminForTest();
  const log = freshLog();
  __internal.setAdminForTest(makeFakeAdmin({ log }));
  installCaptureSpy(log);

  try {
    const res = await __internal.handleVariantResolve(
      mkReq({ body: { surface: 'paywall' } }),
    );
    assertEquals(res.status, 401);
    const body = (await res.json()) as { error: string };
    assertEquals(body.error, 'unauthenticated');
  } finally {
    __internal.setCaptureForTest(null);
  }
});

// ---------------------------------------------------------------------------
// T2 — Invalid body → 400
// ---------------------------------------------------------------------------

Deno.test('T2: invalid body (missing surface) → 400 invalid_body', async () => {
  setConfigured();
  __internal.resetAdminForTest();
  const log = freshLog();
  __internal.setAdminForTest(makeFakeAdmin({ log }));
  installCaptureSpy(log);

  try {
    const res = await __internal.handleVariantResolve(
      mkReq({ jwt: VALID_JWT, body: { page_id: 'p1' } }),
    );
    assertEquals(res.status, 400);
    const body = (await res.json()) as { error: string };
    assertEquals(body.error, 'invalid_body');
  } finally {
    __internal.setCaptureForTest(null);
  }
});

// ---------------------------------------------------------------------------
// T3 — POSTHOG_PROJECT_KEY missing → 503
// ---------------------------------------------------------------------------

Deno.test('T3: POSTHOG_PROJECT_KEY missing → 503 vendor_unconfigured', async () => {
  setConfigured();
  Deno.env.delete('POSTHOG_PROJECT_KEY');
  __internal.resetAdminForTest();
  const log = freshLog();
  __internal.setAdminForTest(makeFakeAdmin({ log }));
  installCaptureSpy(log);

  try {
    const res = await __internal.handleVariantResolve(
      mkReq({ jwt: VALID_JWT, body: { surface: 'paywall' } }),
    );
    assertEquals(res.status, 503);
    const body = (await res.json()) as { error: string; service: string };
    assertEquals(body.error, 'vendor_unconfigured');
    assertEquals(body.service, 'posthog');
  } finally {
    __internal.setCaptureForTest(null);
    setConfigured();
  }
});

// ---------------------------------------------------------------------------
// T4 — WA region (Vercel header) short-circuits pharma
// ---------------------------------------------------------------------------

Deno.test('T4: WA region header short-circuits pharma → control + empty config', async () => {
  setConfigured();
  __internal.resetAdminForTest();
  const log = freshLog();
  __internal.setAdminForTest(makeFakeAdmin({ log, existingUserExp: null, profileState: null }));
  installCaptureSpy(log);

  try {
    const res = await __internal.handleVariantResolve(
      mkReq({ jwt: VALID_JWT, body: { surface: 'pharma' }, region: 'WA' }),
    );
    assertEquals(res.status, 200);
    const body = (await res.json()) as { variant_id: string; config: Record<string, unknown> };
    assertEquals(body.variant_id, 'control');
    assertEquals(Object.keys(body.config).length, 0);
    // No upsert when short-circuited (control on pharma is non-binding).
    assertEquals(log.upserts.length, 0);
  } finally {
    __internal.setCaptureForTest(null);
  }
});

// ---------------------------------------------------------------------------
// T5 — profile.state='CT' overrides absent header for pharma
// ---------------------------------------------------------------------------

Deno.test('T5: profile.state=CT overrides absent header for pharma → control', async () => {
  setConfigured();
  __internal.resetAdminForTest();
  const log = freshLog();
  __internal.setAdminForTest(makeFakeAdmin({ log, existingUserExp: null, profileState: 'CT' }));
  installCaptureSpy(log);

  try {
    const res = await __internal.handleVariantResolve(
      mkReq({ jwt: VALID_JWT, body: { surface: 'pharma' } }),
    );
    assertEquals(res.status, 200);
    const body = (await res.json()) as { variant_id: string; config: Record<string, unknown> };
    assertEquals(body.variant_id, 'control');
    assertEquals(Object.keys(body.config).length, 0);
  } finally {
    __internal.setCaptureForTest(null);
  }
});

// ---------------------------------------------------------------------------
// T6 — Cohort id from RPC wins over UTM (cohort variant returned)
// ---------------------------------------------------------------------------

Deno.test('T6: cohort id wins over UTM (cohort variant returned)', async () => {
  setConfigured();
  __internal.resetAdminForTest();
  const log = freshLog();
  __internal.setAdminForTest(
    makeFakeAdmin({
      log,
      existingUserExp: null,
      cohortRpcResult: COHORT_UUID,
      cohortVariantRow: { id: COHORT_VARIANT_UUID },
      // UTM map also has a row for 'lean' — but cohort must win.
      utmRowBySource: { lean: { id: UTM_ROW_UUID, variant_id: UTM_VARIANT_UUID } },
      variantConfigById: { [COHORT_VARIANT_UUID]: { config: { headline: 'Cohort wins' } } },
    }),
  );
  installCaptureSpy(log);

  try {
    const res = await __internal.handleVariantResolve(
      mkReq({ jwt: VALID_JWT, body: { surface: 'paywall' }, cookies: { lt_utm_source: 'lean' } }),
    );
    assertEquals(res.status, 200);
    const body = (await res.json()) as { variant_id: string; config: Record<string, unknown> };
    assertEquals(body.variant_id, COHORT_VARIANT_UUID);
    assertEquals(body.config.headline, 'Cohort wins');
    assertEquals(log.upserts.length, 1);
    assertEquals(log.upserts[0].cohort_id, COHORT_UUID);
    assertEquals(log.upserts[0].variant_id, COHORT_VARIANT_UUID);
  } finally {
    __internal.setCaptureForTest(null);
  }
});

// ---------------------------------------------------------------------------
// T7 — UTM cookie 'lean' maps to variant_lean when no cohort
// ---------------------------------------------------------------------------

Deno.test('T7: UTM cookie lean → variant_lean when no cohort matches', async () => {
  setConfigured();
  __internal.resetAdminForTest();
  const log = freshLog();
  __internal.setAdminForTest(
    makeFakeAdmin({
      log,
      existingUserExp: null,
      cohortRpcResult: null,
      utmRowBySource: { lean: { id: UTM_ROW_UUID, variant_id: UTM_VARIANT_UUID } },
      variantConfigById: { [UTM_VARIANT_UUID]: { config: { copy: 'lean variant' } } },
    }),
  );
  installCaptureSpy(log);

  try {
    const res = await __internal.handleVariantResolve(
      mkReq({ jwt: VALID_JWT, body: { surface: 'paywall' }, cookies: { lt_utm_source: 'lean' } }),
    );
    assertEquals(res.status, 200);
    const body = (await res.json()) as { variant_id: string; config: Record<string, unknown> };
    assertEquals(body.variant_id, UTM_VARIANT_UUID);
    assertEquals(body.config.copy, 'lean variant');
    assertEquals(log.upserts.length, 1);
    assertEquals(log.upserts[0].utm_variant_id, UTM_ROW_UUID);
    assertEquals(log.upserts[0].cohort_id, null);
  } finally {
    __internal.setCaptureForTest(null);
  }
});

// ---------------------------------------------------------------------------
// T8 — Repeat call returns existing user_experiments variant
// ---------------------------------------------------------------------------

Deno.test('T8: repeat call returns existing variant from user_experiments', async () => {
  setConfigured();
  __internal.resetAdminForTest();
  const log = freshLog();
  __internal.setAdminForTest(
    makeFakeAdmin({
      log,
      existingUserExp: { variant_id: COHORT_VARIANT_UUID },
      variantConfigById: { [COHORT_VARIANT_UUID]: { config: { headline: 'sticky' } } },
    }),
  );
  installCaptureSpy(log);

  try {
    const res = await __internal.handleVariantResolve(
      mkReq({ jwt: VALID_JWT, body: { surface: 'paywall' } }),
    );
    assertEquals(res.status, 200);
    const body = (await res.json()) as { variant_id: string; config: Record<string, unknown> };
    assertEquals(body.variant_id, COHORT_VARIANT_UUID);
    assertEquals(body.config.headline, 'sticky');
    // No upsert needed — row already exists.
    assertEquals(log.upserts.length, 0);
  } finally {
    __internal.setCaptureForTest(null);
  }
});

// ---------------------------------------------------------------------------
// T9 — captureServer called once with $feature_flag_called + surface + variant_id
// ---------------------------------------------------------------------------

Deno.test('T9: captureServer called once with $feature_flag_called + surface + variant_id', async () => {
  setConfigured();
  __internal.resetAdminForTest();
  const log = freshLog();
  __internal.setAdminForTest(
    makeFakeAdmin({
      log,
      existingUserExp: null,
      cohortRpcResult: COHORT_UUID,
      cohortVariantRow: { id: COHORT_VARIANT_UUID },
      variantConfigById: { [COHORT_VARIANT_UUID]: { config: {} } },
    }),
  );
  installCaptureSpy(log);

  try {
    const res = await __internal.handleVariantResolve(
      mkReq({ jwt: VALID_JWT, body: { surface: 'page' } }),
    );
    assertEquals(res.status, 200);
    assertEquals(log.captures.length, 1);
    const cap = log.captures[0];
    assertEquals(cap.userId, USER_UUID);
    assertEquals(cap.event, '$feature_flag_called');
    assertEquals(cap.properties?.surface, 'page');
    assertEquals(cap.properties?.variant_id, COHORT_VARIANT_UUID);
    assertEquals(cap.properties?.$feature_flag, 'phase39_page');
  } finally {
    __internal.setCaptureForTest(null);
  }
});
