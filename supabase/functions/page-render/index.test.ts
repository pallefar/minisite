/**
 * Phase 15 Plan 03 — Deno tests for the `page-render` Edge Function handler.
 *
 * Strategy mirrors `clinic-snapshot/index.test.ts`: seed env BEFORE importing
 * `index.ts` so module-level admin-client construction succeeds, then invoke
 * the exported `handleRender(req, mockAdmin, cors)` directly. We don't spin
 * up Postgres — a hand-rolled mock supabase-js query builder gives us full
 * control over the SELECT result.
 *
 * Behaviors covered (from 15-03-PLAN.md Task 3 <acceptance_criteria>):
 *   (1) Published slug → 200 + body starts with <!doctype html + Cache-Control
 *       header = `public, s-maxage=60, stale-while-revalidate=86400`.
 *   (2) Unknown slug → 404 + body contains the exact 15-UI-SPEC 404 copy.
 *   (3) Row exists but row.status !== 'published' (or published_revision_id
 *       is null) → 404, NOT page content.
 *   (4) No-slug request (no ?slug=, no path segment) → 404.
 *   (5) DB error → 500 + generic body; DB error string NEVER echoed.
 *   (6) Slug extraction prefers ?slug= over path segment (production path).
 *
 * File suffix `.test.ts` per memory `reference_deno_test_discovery.md`.
 */
import { assert, assertEquals, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';

// Seed env BEFORE importing the module so the module-level createClient(...)
// call doesn't blow up on missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.
Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');

const { handleRender } = await import('./index.ts');

// ─── Mock supabase-js query builder ──────────────────────────────────────────

interface PublishedPageRow {
  slug: string;
  status: string;
  seo: Record<string, unknown> | null;
  published_revision_id: string | null;
  landing_page_revisions: { blocks: unknown[] } | null;
}

interface MockScenario {
  /** Slug → row to return. */
  rows?: Record<string, PublishedPageRow | null>;
  /** Force a query error (T-15-03-04 path). */
  queryError?: string;
  /**
   * Phase 41 Plan 41-03 — Hostnames returned for the BLOCKING
   * iframe_allowlist fetch in handleRender. Default `[]` (empty allowlist
   * — Custom-iframe blocks render as inert placeholders).
   */
  allowlistHostnames?: string[];
  /** Force an error on the iframe_allowlist fetch. */
  allowlistError?: string;
}

function buildMockAdmin(scenario: MockScenario): {
  from: (table: string) => unknown;
  calls: { selects: string[]; eqs: Array<[string, unknown]> };
} {
  const calls = { selects: [] as string[], eqs: [] as Array<[string, unknown]> };

  function makeBuilder(table: string): unknown {
    const where: Record<string, unknown> = {};
    const builder: Record<string, unknown> = {
      select(cols: string) {
        calls.selects.push(cols);
        return builder;
      },
      eq(col: string, val: unknown) {
        calls.eqs.push([col, val]);
        where[col] = val;
        return builder;
      },
      maybeSingle() {
        if (scenario.queryError) {
          return Promise.resolve({ data: null, error: { message: scenario.queryError } });
        }
        const slug = String(where.slug ?? '');
        const status = String(where.status ?? '');
        const row = scenario.rows?.[slug] ?? null;
        // The handler filters .eq('status','published') — only return the
        // row when the handler asked for the published filter AND the row's
        // status matches. The mock doesn't apply that filter automatically
        // (it's already encoded in the call); we just return whatever the
        // scenario seeded.
        if (row && status === 'published' && row.status !== 'published') {
          return Promise.resolve({ data: null, error: null });
        }
        return Promise.resolve({ data: row, error: null });
      },
      // Phase 41 Plan 41-03 (B3) — `await client.from('iframe_allowlist').select('hostname')`
      // resolves to { data, error }. supabase-js builders are thenable after
      // .select(). Mock matches: when the table is iframe_allowlist, the
      // builder resolves on .then; for other tables, .then is absent so
      // `await` proceeds through the existing maybeSingle/limit terminators.
      then(resolve: (v: { data: Array<{ hostname: string }> | null; error: { message: string } | null }) => unknown) {
        if (table !== 'iframe_allowlist') {
          // Defensive: shouldn't be reached for non-allowlist tables.
          return resolve({ data: null, error: null });
        }
        if (scenario.allowlistError) {
          return resolve({ data: null, error: { message: scenario.allowlistError } });
        }
        const hosts = (scenario.allowlistHostnames ?? []).map((h) => ({ hostname: h }));
        return resolve({ data: hosts, error: null });
      },
    };
    return builder;
  }

  return {
    from: (table: string) => makeBuilder(table),
    calls,
  };
}

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
};

function published(slug: string, blocks: unknown[] = []): PublishedPageRow {
  return {
    slug,
    status: 'published',
    seo: { title: `${slug} title` },
    published_revision_id: `rev-${slug}`,
    landing_page_revisions: { blocks },
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

Deno.test('handleRender: published slug → 200 HTML with the exact Cache-Control header', async () => {
  const admin = buildMockAdmin({
    rows: {
      demo: published('demo', [
        {
          id: 'h1',
          type: 'hero',
          parent_id: null,
          order: 0,
          content: { heading: 'Demo Welcome', subheading: '', ctaLabel: 'Go', ctaHref: '/x' },
          style: {},
        },
      ]),
    },
  });

  const req = new Request('https://api.example.com/functions/v1/page-render?slug=demo');
  // deno-lint-ignore no-explicit-any
  const res = await handleRender(req, admin as any, CORS_HEADERS);

  assertEquals(res.status, 200);
  assertEquals(res.headers.get('Cache-Control'), 'public, s-maxage=60, stale-while-revalidate=86400');
  assertEquals(res.headers.get('Content-Type'), 'text/html; charset=utf-8');
  assertEquals(res.headers.get('Vary'), 'Accept-Encoding');
  const body = await res.text();
  assert(/^<!doctype html/i.test(body.trim()), `body should start with <!doctype html: ${body.slice(0, 60)}`);
  assertStringIncludes(body, 'Demo Welcome');
});

Deno.test('handleRender: unknown slug → 404 with the exact 15-UI-SPEC 404 copy', async () => {
  const admin = buildMockAdmin({ rows: { /* nothing */ } });
  const req = new Request('https://api.example.com/functions/v1/page-render?slug=nope');
  // deno-lint-ignore no-explicit-any
  const res = await handleRender(req, admin as any, CORS_HEADERS);
  assertEquals(res.status, 404);
  assertEquals(res.headers.get('Cache-Control'), 'public, s-maxage=60, stale-while-revalidate=86400');
  const body = await res.text();
  assertStringIncludes(body, 'Page not found. It may have been moved or removed.');
});

Deno.test('handleRender: row exists but is NOT published → 404, no page content', async () => {
  const draft: PublishedPageRow = {
    slug: 'sneaky',
    status: 'draft',
    seo: { title: 'Draft Page' },
    published_revision_id: null,
    landing_page_revisions: { blocks: [] },
  };
  // The handler filters .eq('status','published') — the mock returns null
  // when the requested status doesn't match the row's actual status.
  const admin = buildMockAdmin({ rows: { sneaky: draft } });
  const req = new Request('https://api.example.com/functions/v1/page-render?slug=sneaky');
  // deno-lint-ignore no-explicit-any
  const res = await handleRender(req, admin as any, CORS_HEADERS);
  assertEquals(res.status, 404);
  const body = await res.text();
  assert(!body.includes('Draft Page'), 'draft page content leaked into 404 response');
  assertStringIncludes(body, 'Page not found. It may have been moved or removed.');
});

Deno.test('handleRender: row published BUT published_revision_id null → 404 (defense in depth)', async () => {
  const ghost: PublishedPageRow = {
    slug: 'ghost',
    status: 'published',
    seo: {},
    published_revision_id: null, // shouldn't happen in practice, but defend anyway
    landing_page_revisions: null,
  };
  const admin = buildMockAdmin({ rows: { ghost } });
  const req = new Request('https://api.example.com/functions/v1/page-render?slug=ghost');
  // deno-lint-ignore no-explicit-any
  const res = await handleRender(req, admin as any, CORS_HEADERS);
  assertEquals(res.status, 404);
});

Deno.test('handleRender: no slug (neither query nor path) → 404', async () => {
  const admin = buildMockAdmin({ rows: {} });
  const req = new Request('https://api.example.com/functions/v1/page-render');
  // deno-lint-ignore no-explicit-any
  const res = await handleRender(req, admin as any, CORS_HEADERS);
  assertEquals(res.status, 404);
});

Deno.test('handleRender: DB error → 500 with generic body, DB error string NOT echoed', async () => {
  const dbMessage = 'PGRST116-NoRowsFoundInTheSecretInternalErrorDoNotEcho';
  const admin = buildMockAdmin({ rows: {}, queryError: dbMessage });
  const req = new Request('https://api.example.com/functions/v1/page-render?slug=demo');
  // deno-lint-ignore no-explicit-any
  const res = await handleRender(req, admin as any, CORS_HEADERS);
  assertEquals(res.status, 500);
  const body = await res.text();
  assert(!body.includes(dbMessage), `DB error string leaked: ${body}`);
  assert(!body.toLowerCase().includes('pgrst'), `Postgres error code leaked: ${body}`);
  // Generic body only
  assertStringIncludes(body, 'Internal error');
});

Deno.test('handleRender: extracts slug from path segment when ?slug= is absent', async () => {
  const admin = buildMockAdmin({
    rows: {
      'from-path': published('from-path'),
    },
  });
  const req = new Request('https://api.example.com/functions/v1/page-render/from-path');
  // deno-lint-ignore no-explicit-any
  const res = await handleRender(req, admin as any, CORS_HEADERS);
  assertEquals(res.status, 200);
});

Deno.test('handleRender: ?slug= takes priority over path segment (production path)', async () => {
  const admin = buildMockAdmin({
    rows: {
      // The query param's value MUST win — if the handler accidentally
      // used the path segment ('from-path'), this row would not be found.
      'from-query': published('from-query'),
    },
  });
  const req = new Request('https://api.example.com/functions/v1/page-render/from-path?slug=from-query');
  // deno-lint-ignore no-explicit-any
  const res = await handleRender(req, admin as any, CORS_HEADERS);
  assertEquals(res.status, 200);
});

Deno.test('handleRender: query asks for status=published (RLS-bypass mitigation T-15-03-01)', async () => {
  const admin = buildMockAdmin({ rows: { demo: published('demo') } });
  const req = new Request('https://api.example.com/functions/v1/page-render?slug=demo');
  // deno-lint-ignore no-explicit-any
  await handleRender(req, admin as any, CORS_HEADERS);
  // Both the slug AND the status filter MUST appear in the call log.
  const slugEq = admin.calls.eqs.find((e) => e[0] === 'slug');
  const statusEq = admin.calls.eqs.find((e) => e[0] === 'status');
  assertEquals(slugEq, ['slug', 'demo']);
  assertEquals(statusEq, ['status', 'published']);
});
