/**
 * Deno test suite for `page-save` Edge Function — Phase 15 Plan 15-04.
 *
 * Test list mirrors the plan's <behavior>:
 *   1. missing JWT → 401 unauthenticated
 *   2. invalid JWT (admin.auth.getUser error) → 401 unauthenticated
 *   3. is_staff=false → 403 forbidden + no insert
 *   4. is_staff=true, valid body, new page → 200 + revisions insert called once
 *   5. reserved slug (NEW page) → 400 reserved_slug + no insert
 *   6. existing pageId → 200; only INSERT on revisions, no UPDATE/DELETE
 *   7. malformed slug → 400 invalid_slug
 *   8. bad JSON body → 400 bad_json
 *
 * Mock strategy: __setAdminForTest with a chainable fake builder that tracks
 * insert/update/delete spy counts per table.
 */

// ---------------------------------------------------------------------------
// Env vars — must be set before importing index.ts
// ---------------------------------------------------------------------------
Deno.env.set('SUPABASE_URL', 'https://stub.supabase.co');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'stub-service-role');

import { assertEquals } from 'jsr:@std/assert';
import { __internal, __setAdminForTest } from './index.ts';

const { handleSave } = __internal;

// ---------------------------------------------------------------------------
// Fake admin builder
// ---------------------------------------------------------------------------

interface TableSpies {
  selectMaybeSingle: { value: unknown; error?: { message: string } | null };
  insertResult?: { data: unknown; error?: { message: string } | null };
  insertReturnSingle?: { value: unknown; error?: { message: string } | null };
  insertCalls: unknown[][];
  updateCalls: unknown[][];
  deleteCalls: unknown[][];
}

interface FakeAdminOpts {
  user?: { id: string; email?: string } | null;
  userErr?: { message: string } | null;
  tables: Record<string, TableSpies>;
}

function makeFakeAdmin(opts: FakeAdminOpts) {
  const tables = opts.tables;

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
      const spy = tables[table];
      if (!spy) {
        throw new Error(`Unexpected table access: ${table}`);
      }
      const baseChain: Record<string, unknown> = {};
      const chain = baseChain as {
        select: (cols?: string) => typeof chain;
        eq: (col: string, val: unknown) => typeof chain;
        is: (col: string, val: unknown) => typeof chain;
        maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
        single: () => Promise<{ data: unknown; error: unknown }>;
        insert: (vals: unknown) => unknown;
        update: (vals: unknown) => Promise<{ data: unknown; error: unknown }>;
        delete: () => Promise<{ data: unknown; error: unknown }>;
      };
      chain.select = (_cols?: string) => chain;
      chain.eq = (_col: string, _val: unknown) => chain;
      chain.is = (_col: string, _val: unknown) => chain;
      chain.maybeSingle = () =>
        Promise.resolve({
          data: spy.selectMaybeSingle.value,
          error: spy.selectMaybeSingle.error ?? null,
        });
      chain.single = () =>
        Promise.resolve({
          data: spy.selectMaybeSingle.value,
          error: spy.selectMaybeSingle.error ?? null,
        });
      chain.insert = (vals: unknown) => {
        spy.insertCalls.push([vals]);
        // Support `.insert(...).select().single()` for returning new row id
        const insertChain = {
          select: (_cols?: string) => insertChain,
          single: () =>
            Promise.resolve({
              data: spy.insertReturnSingle?.value ?? null,
              error: spy.insertReturnSingle?.error ?? null,
            }),
          maybeSingle: () =>
            Promise.resolve({
              data: spy.insertReturnSingle?.value ?? null,
              error: spy.insertReturnSingle?.error ?? null,
            }),
          then: (resolve: (v: { data: unknown; error: unknown }) => unknown) =>
            resolve({
              data: spy.insertResult?.data ?? null,
              error: spy.insertResult?.error ?? null,
            }),
        };
        return insertChain;
      };
      chain.update = (vals: unknown) => {
        spy.updateCalls.push([vals]);
        return Promise.resolve({ data: null, error: null });
      };
      chain.delete = () => {
        spy.deleteCalls.push([]);
        return Promise.resolve({ data: null, error: null });
      };
      return chain;
    },
  };
}

function newSpies(initial: Partial<TableSpies> = {}): TableSpies {
  return {
    selectMaybeSingle: initial.selectMaybeSingle ?? { value: null },
    insertResult: initial.insertResult ?? { data: null, error: null },
    insertReturnSingle: initial.insertReturnSingle,
    insertCalls: [],
    updateCalls: [],
    deleteCalls: [],
  };
}

// ---------------------------------------------------------------------------
// Test 1: missing JWT → 401
// ---------------------------------------------------------------------------

Deno.test({
  name: 'page-save: missing JWT → 401 unauthenticated',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const req = new Request('http://localhost/functions/v1/page-save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const res = await handleSave(req);
    assertEquals(res.status, 401);
    assertEquals(await res.json(), { error: 'unauthenticated' });
  },
});

// ---------------------------------------------------------------------------
// Test 2: invalid JWT → 401
// ---------------------------------------------------------------------------

Deno.test({
  name: 'page-save: invalid JWT (auth.getUser error) → 401 unauthenticated',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const fake = makeFakeAdmin({
      userErr: { message: 'invalid jwt' },
      tables: {},
    });
    __setAdminForTest(fake);
    const req = new Request('http://localhost/functions/v1/page-save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer bad' },
      body: JSON.stringify({ slug: 'foo', title: 'Foo', blocks: [] }),
    });
    const res = await handleSave(req);
    assertEquals(res.status, 401);
    assertEquals(await res.json(), { error: 'unauthenticated' });
  },
});

// ---------------------------------------------------------------------------
// Test 3: is_staff=false → 403 + no insert
// ---------------------------------------------------------------------------

Deno.test({
  name: 'page-save: is_staff=false → 403 forbidden, no revision insert',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const profilesSpy = newSpies({
      selectMaybeSingle: { value: { is_staff: false } },
    });
    const revsSpy = newSpies();
    const pagesSpy = newSpies();
    const fake = makeFakeAdmin({
      user: { id: 'u1', email: 'a@b.com' },
      tables: {
        profiles: profilesSpy,
        landing_page_revisions: revsSpy,
        landing_pages: pagesSpy,
      },
    });
    __setAdminForTest(fake);
    const req = new Request('http://localhost/functions/v1/page-save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer x' },
      body: JSON.stringify({ slug: 'foo', title: 'Foo', blocks: [] }),
    });
    const res = await handleSave(req);
    assertEquals(res.status, 403);
    assertEquals(await res.json(), { error: 'forbidden' });
    assertEquals(revsSpy.insertCalls.length, 0);
    assertEquals(pagesSpy.insertCalls.length, 0);
  },
});

// ---------------------------------------------------------------------------
// Test 4: staff happy path (new page) → 200 + revisions.insert called once
// ---------------------------------------------------------------------------

Deno.test({
  name: 'page-save: staff + new page + valid → 200 + revisions insert called once with blocks',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const profilesSpy = newSpies({
      selectMaybeSingle: { value: { is_staff: true } },
    });
    const pagesSpy = newSpies({
      // insertReturnSingle drives the .insert(...).select().single() chain
      insertReturnSingle: { value: { id: 'new-page-id' } },
    });
    const revsSpy = newSpies({
      insertReturnSingle: { value: { id: 'new-rev-id' } },
    });
    const fake = makeFakeAdmin({
      user: { id: 'u1', email: 'a@b.com' },
      tables: {
        profiles: profilesSpy,
        landing_page_revisions: revsSpy,
        landing_pages: pagesSpy,
      },
    });
    __setAdminForTest(fake);
    const blocks = [
      { id: 'b1', type: 'hero', parent_id: null, order: 0, content: {}, style: {} },
    ];
    const req = new Request('http://localhost/functions/v1/page-save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer x' },
      body: JSON.stringify({ slug: 'launch-page', title: 'Launch', blocks }),
    });
    const res = await handleSave(req);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.pageId, 'new-page-id');
    assertEquals(body.revisionId, 'new-rev-id');
    assertEquals(pagesSpy.insertCalls.length, 1);
    assertEquals(revsSpy.insertCalls.length, 1);
    const revInsertArg = revsSpy.insertCalls[0]![0] as { blocks: unknown[] };
    assertEquals(revInsertArg.blocks, blocks);
  },
});

// ---------------------------------------------------------------------------
// Test 5: reserved slug (new page) → 400 reserved_slug + no insert
// ---------------------------------------------------------------------------

Deno.test({
  name: 'page-save: reserved slug "admin" → 400 reserved_slug',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const profilesSpy = newSpies({
      selectMaybeSingle: { value: { is_staff: true } },
    });
    const revsSpy = newSpies();
    const pagesSpy = newSpies();
    const fake = makeFakeAdmin({
      user: { id: 'u1' },
      tables: {
        profiles: profilesSpy,
        landing_page_revisions: revsSpy,
        landing_pages: pagesSpy,
      },
    });
    __setAdminForTest(fake);
    const req = new Request('http://localhost/functions/v1/page-save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer x' },
      body: JSON.stringify({ slug: 'admin', title: 'X', blocks: [] }),
    });
    const res = await handleSave(req);
    assertEquals(res.status, 400);
    assertEquals(await res.json(), { error: 'reserved_slug' });
    assertEquals(revsSpy.insertCalls.length, 0);
    assertEquals(pagesSpy.insertCalls.length, 0);
  },
});

Deno.test({
  name: 'page-save: reserved slug "share" → 400 reserved_slug',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const profilesSpy = newSpies({
      selectMaybeSingle: { value: { is_staff: true } },
    });
    const revsSpy = newSpies();
    const pagesSpy = newSpies();
    const fake = makeFakeAdmin({
      user: { id: 'u1' },
      tables: {
        profiles: profilesSpy,
        landing_page_revisions: revsSpy,
        landing_pages: pagesSpy,
      },
    });
    __setAdminForTest(fake);
    const req = new Request('http://localhost/functions/v1/page-save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer x' },
      body: JSON.stringify({ slug: 'share', title: 'X', blocks: [] }),
    });
    const res = await handleSave(req);
    assertEquals(res.status, 400);
    assertEquals(await res.json(), { error: 'reserved_slug' });
    assertEquals(pagesSpy.insertCalls.length, 0);
  },
});

// ---------------------------------------------------------------------------
// Test 6: existing pageId → 200 + only INSERT on revisions, no UPDATE/DELETE
// ---------------------------------------------------------------------------

Deno.test({
  name: 'page-save: existing pageId → INSERT-only on landing_page_revisions',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const profilesSpy = newSpies({
      selectMaybeSingle: { value: { is_staff: true } },
    });
    const pagesSpy = newSpies({
      selectMaybeSingle: { value: { id: 'existing-page' } },
    });
    const revsSpy = newSpies({
      insertReturnSingle: { value: { id: 'rev-2' } },
    });
    const fake = makeFakeAdmin({
      user: { id: 'u1' },
      tables: {
        profiles: profilesSpy,
        landing_pages: pagesSpy,
        landing_page_revisions: revsSpy,
      },
    });
    __setAdminForTest(fake);
    const req = new Request('http://localhost/functions/v1/page-save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer x' },
      body: JSON.stringify({
        pageId: 'existing-page',
        slug: 'existing-page-slug',
        title: 'Existing',
        blocks: [],
      }),
    });
    const res = await handleSave(req);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.pageId, 'existing-page');
    assertEquals(body.revisionId, 'rev-2');
    assertEquals(revsSpy.insertCalls.length, 1);
    assertEquals(revsSpy.updateCalls.length, 0);
    assertEquals(revsSpy.deleteCalls.length, 0);
    // Existing page → no new landing_pages INSERT
    assertEquals(pagesSpy.insertCalls.length, 0);
  },
});

// ---------------------------------------------------------------------------
// Test 7: malformed slug → 400 invalid_slug
// ---------------------------------------------------------------------------

Deno.test({
  name: 'page-save: malformed slug "Has Spaces/" → 400 invalid_slug',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const profilesSpy = newSpies({
      selectMaybeSingle: { value: { is_staff: true } },
    });
    const revsSpy = newSpies();
    const pagesSpy = newSpies();
    const fake = makeFakeAdmin({
      user: { id: 'u1' },
      tables: {
        profiles: profilesSpy,
        landing_page_revisions: revsSpy,
        landing_pages: pagesSpy,
      },
    });
    __setAdminForTest(fake);
    const req = new Request('http://localhost/functions/v1/page-save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer x' },
      body: JSON.stringify({ slug: 'Has Spaces/', title: 'X', blocks: [] }),
    });
    const res = await handleSave(req);
    assertEquals(res.status, 400);
    assertEquals(await res.json(), { error: 'invalid_slug' });
    assertEquals(revsSpy.insertCalls.length, 0);
  },
});

// ---------------------------------------------------------------------------
// Test 8: bad JSON body → 400 bad_json
// ---------------------------------------------------------------------------

Deno.test({
  name: 'page-save: non-JSON body → 400 bad_json',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const profilesSpy = newSpies({
      selectMaybeSingle: { value: { is_staff: true } },
    });
    const fake = makeFakeAdmin({
      user: { id: 'u1' },
      tables: { profiles: profilesSpy },
    });
    __setAdminForTest(fake);
    const req = new Request('http://localhost/functions/v1/page-save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer x' },
      body: 'not-json',
    });
    const res = await handleSave(req);
    assertEquals(res.status, 400);
    assertEquals(await res.json(), { error: 'bad_json' });
  },
});
