/**
 * Phase 15 Plan 08 — Deno tests for `supabase/functions/sitemap/index.ts`.
 *
 * Strategy: seed env BEFORE importing the module (so the lazy admin client
 * doesn't blow up on missing SUPABASE_URL/key), then invoke the exported
 * `handleSitemap(mockClient)` with a hand-rolled mock SupabaseClient that
 * enforces the `eq('status', 'published')` filter on the leads dataset.
 *
 * File suffix is `.test.ts` (NOT `-test.ts`) per memory
 * `reference_deno_test_discovery.md` so Deno's directory-walk picks it up.
 */

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from 'https://deno.land/std@0.224.0/assert/mod.ts';

Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');
Deno.env.set('PUBLIC_MARKETING_ORIGIN', 'https://leanshot.app');

const { handleSitemap } = await import('./index.ts');

interface MockRow {
  slug: string;
  status: string;
  updated_at: string;
  published_revision_id: string | null;
}

function makeMockClient(rows: MockRow[]): {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (
        col: string,
        value: unknown,
      ) => Promise<{
        data: Array<{ slug: string; updated_at: string; published_revision_id: string | null }> | null;
        error: { message: string } | null;
      }>;
    };
  };
} {
  return {
    from(table: string) {
      assertEquals(table, 'landing_pages');
      return {
        select(_cols: string) {
          return {
            eq(col: string, value: unknown) {
              // T-15-08-03 — the handler MUST filter by status=published.
              assertEquals(col, 'status');
              assertEquals(value, 'published');
              const filtered = rows
                .filter((r) => r.status === value)
                .map((r) => ({
                  slug: r.slug,
                  updated_at: r.updated_at,
                  published_revision_id: r.published_revision_id,
                }));
              return Promise.resolve({ data: filtered, error: null });
            },
          };
        },
      };
    },
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

Deno.test('handleSitemap: returns 200 + application/xml with <urlset> wrapper', async () => {
  const client = makeMockClient([
    { slug: 'launch', status: 'published', updated_at: '2026-01-02T00:00:00Z', published_revision_id: 'r1' },
  ]);
  // deno-lint-ignore no-explicit-any
  const res = await handleSitemap(client as any);
  assertEquals(res.status, 200);
  assertEquals(res.headers.get('Content-Type'), 'application/xml; charset=utf-8');
  const body = await res.text();
  assert(body.startsWith('<?xml version="1.0"'), `missing xml prolog: ${body.slice(0, 80)}`);
  assertStringIncludes(body, '<urlset xmlns="http://www.sitemap.org/schemas/sitemap/0.9">');
  assertStringIncludes(body, '</urlset>');
});

Deno.test('handleSitemap: lists every published slug', async () => {
  const client = makeMockClient([
    { slug: 'launch', status: 'published', updated_at: '2026-01-02T00:00:00Z', published_revision_id: 'r1' },
    { slug: 'pricing', status: 'published', updated_at: '2026-02-01T00:00:00Z', published_revision_id: 'r2' },
  ]);
  // deno-lint-ignore no-explicit-any
  const res = await handleSitemap(client as any);
  const body = await res.text();
  assertStringIncludes(body, '<loc>https://leanshot.app/launch</loc>');
  assertStringIncludes(body, '<loc>https://leanshot.app/pricing</loc>');
});

Deno.test('handleSitemap: NEVER lists a draft slug (T-15-08-03)', async () => {
  const client = makeMockClient([
    { slug: 'launch', status: 'published', updated_at: '2026-01-02T00:00:00Z', published_revision_id: 'r1' },
    { slug: 'secret-internal-draft', status: 'draft', updated_at: '2026-02-01T00:00:00Z', published_revision_id: null },
  ]);
  // deno-lint-ignore no-explicit-any
  const res = await handleSitemap(client as any);
  const body = await res.text();
  assertStringIncludes(body, '<loc>https://leanshot.app/launch</loc>');
  assert(!body.includes('secret-internal-draft'), 'DRAFT slug leaked into sitemap output');
});

Deno.test('handleSitemap: published row with null published_revision_id is filtered out (defense in depth)', async () => {
  const client = makeMockClient([
    { slug: 'launch', status: 'published', updated_at: '2026-01-02T00:00:00Z', published_revision_id: 'r1' },
    { slug: 'stale-no-revision', status: 'published', updated_at: '2026-02-01T00:00:00Z', published_revision_id: null },
  ]);
  // deno-lint-ignore no-explicit-any
  const res = await handleSitemap(client as any);
  const body = await res.text();
  assertStringIncludes(body, '<loc>https://leanshot.app/launch</loc>');
  assert(!body.includes('stale-no-revision'), 'row with null published_revision_id leaked');
});

Deno.test('handleSitemap: <lastmod> populated from updated_at', async () => {
  const client = makeMockClient([
    { slug: 'launch', status: 'published', updated_at: '2026-01-02T00:00:00Z', published_revision_id: 'r1' },
  ]);
  // deno-lint-ignore no-explicit-any
  const res = await handleSitemap(client as any);
  const body = await res.text();
  assertStringIncludes(body, '<lastmod>2026-01-02T00:00:00.000Z</lastmod>');
});

Deno.test('handleSitemap: returns Cache-Control: public, s-maxage=3600, stale-while-revalidate=86400', async () => {
  const client = makeMockClient([]);
  // deno-lint-ignore no-explicit-any
  const res = await handleSitemap(client as any);
  assertEquals(res.headers.get('Cache-Control'), 'public, s-maxage=3600, stale-while-revalidate=86400');
});

Deno.test('handleSitemap: DB error → 500 + generic body, error string NOT echoed', async () => {
  const client = {
    from(_table: string) {
      return {
        select(_cols: string) {
          return {
            eq(_col: string, _value: unknown) {
              return Promise.resolve({
                data: null,
                error: { message: 'PGRST116-NoRowsFoundInTheSecretInternalErrorDoNotEcho' },
              });
            },
          };
        },
      };
    },
  };
  // deno-lint-ignore no-explicit-any
  const res = await handleSitemap(client as any);
  assertEquals(res.status, 500);
  const body = await res.text();
  assert(!body.includes('PGRST116'), 'PG error string echoed to client');
  assert(!body.includes('SecretInternal'), 'PG error string echoed to client');
});

Deno.test('handleSitemap: slug XML-special chars are escaped (defense in depth)', async () => {
  const client = makeMockClient([
    { slug: 'a&b', status: 'published', updated_at: '2026-01-01T00:00:00Z', published_revision_id: 'r1' },
  ]);
  // deno-lint-ignore no-explicit-any
  const res = await handleSitemap(client as any);
  const body = await res.text();
  assertStringIncludes(body, '<loc>https://leanshot.app/a&amp;b</loc>');
});
