/**
 * Deno test suite for `page-publish` Edge Function — Phase 15 Plan 15-04.
 *
 * Tests:
 *   1. missing JWT → 401
 *   2. is_staff=false → 403, no landing_pages update
 *   3. happy path → 200, landing_pages.update called with {published_revision_id,is_published}, fetch HEAD fired with x-prerender-revalidate
 *   4. revision/page mismatch → 4xx revision_mismatch, no update
 *   5. revalidation HEAD failure non-fatal → still 200, update spy still called
 *   6. bad JSON body → 400 bad_json
 */

Deno.env.set('SUPABASE_URL', 'https://stub.supabase.co');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'stub-service-role');
Deno.env.set('VERCEL_BYPASS_TOKEN', 'stub-bypass-token');
Deno.env.set('SITE_ORIGIN', 'https://test.local');

import { assertEquals } from 'jsr:@std/assert';
import { __internal, __setAdminForTest } from './index.ts';

const { handlePublish } = __internal;

// ---------------------------------------------------------------------------
// Fake admin
// ---------------------------------------------------------------------------

interface TableSpies {
  selectMaybeSingle: { value: unknown; error?: { message: string } | null };
  updateResult?: { data: unknown; error?: { message: string } | null };
  updateCalls: unknown[][];
  insertCalls: unknown[][];
  deleteCalls: unknown[][];
}

function newSpies(initial: Partial<TableSpies> = {}): TableSpies {
  return {
    selectMaybeSingle: initial.selectMaybeSingle ?? { value: null },
    updateResult: initial.updateResult ?? { data: null, error: null },
    updateCalls: [],
    insertCalls: [],
    deleteCalls: [],
  };
}

function makeFakeAdmin(opts: {
  user?: { id: string } | null;
  userErr?: { message: string } | null;
  tables: Record<string, TableSpies>;
}) {
  return {
    auth: {
      getUser: (_jwt: string) => {
        if (opts.userErr) {
          return Promise.resolve({ data: { user: null }, error: opts.userErr });
        }
        if (opts.user) {
          return Promise.resolve({ data: { user: opts.user }, error: null });
        }
        return Promise.resolve({
          data: { user: null },
          error: { message: 'no user' },
        });
      },
    },
    from: (table: string) => {
      const spy = opts.tables[table];
      if (!spy) {
        throw new Error(`Unexpected table access: ${table}`);
      }
      const chain: Record<string, unknown> = {};
      const c = chain as {
        select: (cols?: string) => typeof c;
        eq: (col: string, val: unknown) => typeof c;
        maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
        single: () => Promise<{ data: unknown; error: unknown }>;
        update: (vals: unknown) => typeof c;
        insert: (vals: unknown) => typeof c;
        delete: () => typeof c;
        then: (
          resolve: (v: { data: unknown; error: unknown }) => unknown,
        ) => unknown;
      };
      c.select = (_cols?: string) => c;
      c.eq = (_col: string, _val: unknown) => c;
      c.maybeSingle = () =>
        Promise.resolve({
          data: spy.selectMaybeSingle.value,
          error: spy.selectMaybeSingle.error ?? null,
        });
      c.single = () =>
        Promise.resolve({
          data: spy.selectMaybeSingle.value,
          error: spy.selectMaybeSingle.error ?? null,
        });
      c.update = (vals: unknown) => {
        spy.updateCalls.push([vals]);
        return c;
      };
      c.insert = (vals: unknown) => {
        spy.insertCalls.push([vals]);
        return c;
      };
      c.delete = () => {
        spy.deleteCalls.push([]);
        return c;
      };
      c.then = (resolve) =>
        resolve({
          data: spy.updateResult?.data ?? null,
          error: spy.updateResult?.error ?? null,
        });
      return c;
    },
  };
}

// ---------------------------------------------------------------------------
// fetch stub helpers
// ---------------------------------------------------------------------------

interface FetchCall {
  url: string;
  init?: RequestInit;
}

function installFetchStub(opts: {
  throws?: boolean;
  status?: number;
}): { calls: FetchCall[]; restore: () => void } {
  const calls: FetchCall[] = [];
  const orig = globalThis.fetch;
  globalThis.fetch = ((input: Request | URL | string, init?: RequestInit) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
    calls.push({ url, init });
    if (opts.throws) {
      return Promise.reject(new Error('simulated fetch failure'));
    }
    return Promise.resolve(new Response('', { status: opts.status ?? 200 }));
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = orig;
    },
  };
}

// ---------------------------------------------------------------------------
// Test 1: missing JWT → 401
// ---------------------------------------------------------------------------

Deno.test({
  name: 'page-publish: missing JWT → 401 unauthenticated',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const req = new Request('http://localhost/functions/v1/page-publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const res = await handlePublish(req);
    assertEquals(res.status, 401);
    assertEquals(await res.json(), { error: 'unauthenticated' });
  },
});

// ---------------------------------------------------------------------------
// Test 2: is_staff=false → 403, no update
// ---------------------------------------------------------------------------

Deno.test({
  name: 'page-publish: is_staff=false → 403 forbidden, no landing_pages update',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const profilesSpy = newSpies({
      selectMaybeSingle: { value: { is_staff: false } },
    });
    const pagesSpy = newSpies();
    const revsSpy = newSpies();
    __setAdminForTest(
      makeFakeAdmin({
        user: { id: 'u1' },
        tables: {
          profiles: profilesSpy,
          landing_pages: pagesSpy,
          landing_page_revisions: revsSpy,
        },
      }),
    );
    const req = new Request('http://localhost/functions/v1/page-publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer x' },
      body: JSON.stringify({ pageId: 'p1', revisionId: 'r1' }),
    });
    const res = await handlePublish(req);
    assertEquals(res.status, 403);
    assertEquals(await res.json(), { error: 'forbidden' });
    assertEquals(pagesSpy.updateCalls.length, 0);
  },
});

// ---------------------------------------------------------------------------
// Test 3: happy path → 200 + update + fetch HEAD with x-prerender-revalidate
// ---------------------------------------------------------------------------

Deno.test({
  name: 'page-publish: happy path → 200 + landing_pages.update + revalidation HEAD',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const profilesSpy = newSpies({
      selectMaybeSingle: { value: { is_staff: true } },
    });
    const revsSpy = newSpies({
      selectMaybeSingle: { value: { id: 'r1', page_id: 'p1' } },
    });
    const pagesSpy = newSpies({
      selectMaybeSingle: { value: { slug: 'launch' } },
    });
    __setAdminForTest(
      makeFakeAdmin({
        user: { id: 'u1' },
        tables: {
          profiles: profilesSpy,
          landing_page_revisions: revsSpy,
          landing_pages: pagesSpy,
        },
      }),
    );

    const stub = installFetchStub({});
    try {
      const req = new Request('http://localhost/functions/v1/page-publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer x' },
        body: JSON.stringify({ pageId: 'p1', revisionId: 'r1' }),
      });
      const res = await handlePublish(req);
      assertEquals(res.status, 200);
      const body = await res.json();
      assertEquals(body.ok, true);
      assertEquals(body.slug, 'launch');

      // pages.update was called once with {published_revision_id, is_published}.
      assertEquals(pagesSpy.updateCalls.length, 1);
      const updateArg = pagesSpy.updateCalls[0]![0] as Record<string, unknown>;
      assertEquals(updateArg.published_revision_id, 'r1');
      assertEquals(updateArg.is_published, true);

      // 15-08: Revalidation HEAD was called TWICE — once for the slug
      // (15-04's per-slug revalidation) and once for /sitemap.xml (15-08's
      // sitemap revalidation, D-09 "publish feels instant").
      assertEquals(stub.calls.length, 2);
      const slugCall = stub.calls.find((c) => c.url.includes('launch') && !c.url.includes('sitemap'));
      const sitemapCall = stub.calls.find((c) => c.url.includes('sitemap.xml'));
      if (!slugCall) throw new Error('missing per-slug revalidation HEAD');
      if (!sitemapCall) throw new Error('missing sitemap.xml revalidation HEAD');
      assertEquals(slugCall.init?.method, 'HEAD');
      assertEquals(sitemapCall.init?.method, 'HEAD');
      const slugHeaders = (slugCall.init?.headers ?? {}) as Record<string, string>;
      const sitemapHeaders = (sitemapCall.init?.headers ?? {}) as Record<string, string>;
      assertEquals(slugHeaders['x-prerender-revalidate'], 'stub-bypass-token');
      assertEquals(sitemapHeaders['x-prerender-revalidate'], 'stub-bypass-token');
    } finally {
      stub.restore();
    }
  },
});

// ---------------------------------------------------------------------------
// Test 4: revision/page mismatch → 4xx revision_mismatch, no update
// ---------------------------------------------------------------------------

Deno.test({
  name: 'page-publish: revision belongs to different page → 400 revision_mismatch',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const profilesSpy = newSpies({
      selectMaybeSingle: { value: { is_staff: true } },
    });
    const revsSpy = newSpies({
      selectMaybeSingle: { value: { id: 'r1', page_id: 'OTHER-PAGE' } },
    });
    const pagesSpy = newSpies();
    __setAdminForTest(
      makeFakeAdmin({
        user: { id: 'u1' },
        tables: {
          profiles: profilesSpy,
          landing_page_revisions: revsSpy,
          landing_pages: pagesSpy,
        },
      }),
    );
    const stub = installFetchStub({});
    try {
      const req = new Request('http://localhost/functions/v1/page-publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer x' },
        body: JSON.stringify({ pageId: 'p1', revisionId: 'r1' }),
      });
      const res = await handlePublish(req);
      assertEquals(res.status, 400);
      assertEquals(await res.json(), { error: 'revision_mismatch' });
      assertEquals(pagesSpy.updateCalls.length, 0);
      assertEquals(stub.calls.length, 0);
    } finally {
      stub.restore();
    }
  },
});

// ---------------------------------------------------------------------------
// Test 5: revalidation HEAD failure is non-fatal
// ---------------------------------------------------------------------------

Deno.test({
  name: 'page-publish: revalidation HEAD failure → still 200; update still called',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const profilesSpy = newSpies({
      selectMaybeSingle: { value: { is_staff: true } },
    });
    const revsSpy = newSpies({
      selectMaybeSingle: { value: { id: 'r1', page_id: 'p1' } },
    });
    const pagesSpy = newSpies({
      selectMaybeSingle: { value: { slug: 'launch' } },
    });
    __setAdminForTest(
      makeFakeAdmin({
        user: { id: 'u1' },
        tables: {
          profiles: profilesSpy,
          landing_page_revisions: revsSpy,
          landing_pages: pagesSpy,
        },
      }),
    );
    const stub = installFetchStub({ throws: true });
    try {
      const req = new Request('http://localhost/functions/v1/page-publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer x' },
        body: JSON.stringify({ pageId: 'p1', revisionId: 'r1' }),
      });
      const res = await handlePublish(req);
      assertEquals(res.status, 200);
      assertEquals(pagesSpy.updateCalls.length, 1);
    } finally {
      stub.restore();
    }
  },
});

// ---------------------------------------------------------------------------
// Test 6: bad JSON → 400 bad_json
// ---------------------------------------------------------------------------

Deno.test({
  name: 'page-publish: non-JSON body → 400 bad_json',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const profilesSpy = newSpies({
      selectMaybeSingle: { value: { is_staff: true } },
    });
    __setAdminForTest(
      makeFakeAdmin({
        user: { id: 'u1' },
        tables: { profiles: profilesSpy },
      }),
    );
    const req = new Request('http://localhost/functions/v1/page-publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer x' },
      body: 'not-json',
    });
    const res = await handlePublish(req);
    assertEquals(res.status, 400);
    assertEquals(await res.json(), { error: 'bad_json' });
  },
});
