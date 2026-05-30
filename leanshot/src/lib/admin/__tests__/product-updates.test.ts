/**
 * Phase 71 Plan 71-01 Task 2 — product-updates CRUD wrapper tests.
 *
 * Covers the documented behaviours of src/lib/admin/product-updates.ts:
 *   - slugify normalises a title.
 *   - createEntry inserts then audits via log_admin_action('changelog.create').
 *   - publishEntry sets status='published' + published_at then audits 'changelog.publish'.
 *   - a 42501 (RLS denial) insert error propagates as a thrown error.
 *   - an audit-leg failure does NOT throw (best-effort warn).
 *
 * Uses the CHAINABLE supabase mock style (see
 * src/lib/changelog/changelog-store.test.ts makeBuilder) — NOT the live-DB
 * describeIfLive style of audit-logs-rls.test.ts.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  slugify,
  createEntry,
  publishEntry,
  updateEntry,
  listEntries,
  archiveEntry,
  type ProductUpdateEntry,
} from '../product-updates';

interface SupabaseError {
  message: string;
  code?: string;
}

/**
 * Chainable thenable builder matching supabase-js typing. `.insert`/`.update`
 * return `this`; `.select().single()` resolves to {data,error}; the builder is
 * itself awaitable (for chains without .single()).
 */
function makeBuilder(
  result: { data: unknown; error: SupabaseError | null },
  spies: Record<string, ReturnType<typeof vi.fn>> = {},
) {
  const builder: Record<string, unknown> = {
    select: spies.select ?? vi.fn().mockReturnThis(),
    insert: spies.insert ?? vi.fn().mockReturnThis(),
    update: spies.update ?? vi.fn().mockReturnThis(),
    eq: spies.eq ?? vi.fn().mockReturnThis(),
    order: spies.order ?? vi.fn().mockReturnThis(),
    single: spies.single ?? vi.fn().mockResolvedValue(result),
    maybeSingle: spies.maybeSingle ?? vi.fn().mockResolvedValue(result),
    then: (resolve: (v: typeof result) => unknown) => Promise.resolve(resolve(result)),
  };
  // Re-bind returnThis spies to actually return the builder object.
  for (const key of ['select', 'insert', 'update', 'eq', 'order']) {
    (builder[key] as ReturnType<typeof vi.fn>).mockReturnValue(builder);
  }
  return builder;
}

function makeClient(opts: {
  from: ReturnType<typeof vi.fn>;
  rpc?: ReturnType<typeof vi.fn>;
  userId?: string | null;
}) {
  return {
    from: opts.from,
    rpc: opts.rpc ?? vi.fn().mockResolvedValue({ data: 1, error: null }),
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: {
          user:
            opts.userId === undefined
              ? { id: 'admin-1' }
              : opts.userId
                ? { id: opts.userId }
                : null,
        },
        error: null,
      }),
    },
  } as unknown as SupabaseClient;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('slugify', () => {
  it('lowercases, strips punctuation, collapses repeats, trims dashes', () => {
    expect(slugify('Hello, World! v2')).toBe('hello-world-v2');
    expect(slugify('  Multiple   Spaces  ')).toBe('multiple-spaces');
    expect(slugify('--Leading & trailing--')).toBe('leading-trailing');
    expect(slugify('Café Crème 2.0')).toBe('caf-cr-me-2-0');
  });
});

describe('createEntry', () => {
  it('inserts a row with created_by then audits changelog.create', async () => {
    const newRow: ProductUpdateEntry = {
      id: 'entry-1',
      slug: 'big-news',
      title: 'Big news',
      body_md: '# hi',
      version: '1.2.0',
      status: 'draft',
      published_at: '2026-05-30T00:00:00Z',
    };
    const insertSpy = vi.fn().mockReturnThis();
    const from = vi
      .fn()
      .mockReturnValue(makeBuilder({ data: newRow, error: null }, { insert: insertSpy }));
    const rpc = vi.fn().mockResolvedValue({ data: 99, error: null });
    const client = makeClient({ from, rpc, userId: 'admin-1' });

    const created = await createEntry(client, {
      title: 'Big news',
      slug: 'big-news',
      version: '1.2.0',
      body_md: '# hi',
      status: 'draft',
    });

    expect(created.id).toBe('entry-1');
    expect(from).toHaveBeenCalledWith('changelog_entries');
    // created_by injected from auth user id.
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ created_by: 'admin-1', title: 'Big news', status: 'draft' }),
    );
    // audit call with the create action.
    expect(rpc).toHaveBeenCalledWith(
      'log_admin_action',
      expect.objectContaining({
        p_action_name: 'changelog.create',
        p_table_name: 'changelog_entries',
        p_row_pk: 'entry-1',
      }),
    );
  });

  it('throws when the insert is denied by RLS (42501)', async () => {
    const from = vi
      .fn()
      .mockReturnValue(
        makeBuilder({ data: null, error: { code: '42501', message: 'permission denied' } }),
      );
    const client = makeClient({ from, userId: 'admin-1' });
    await expect(
      createEntry(client, {
        title: 'x',
        slug: 'x',
        version: null,
        body_md: 'y',
        status: 'draft',
      }),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('does NOT throw when only the audit leg fails', async () => {
    const newRow: ProductUpdateEntry = {
      id: 'entry-2',
      slug: 's',
      title: 't',
      body_md: 'b',
      version: null,
      status: 'draft',
      published_at: '2026-05-30T00:00:00Z',
    };
    const from = vi.fn().mockReturnValue(makeBuilder({ data: newRow, error: null }));
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'audit boom' } });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const client = makeClient({ from, rpc, userId: 'admin-1' });

    await expect(
      createEntry(client, {
        title: 't',
        slug: 's',
        version: null,
        body_md: 'b',
        status: 'draft',
      }),
    ).resolves.toMatchObject({ id: 'entry-2' });
    expect(warn).toHaveBeenCalled();
  });
});

describe('publishEntry', () => {
  it('sets status=published + published_at and audits changelog.publish', async () => {
    const updatedRow: ProductUpdateEntry = {
      id: 'entry-3',
      slug: 's',
      title: 't',
      body_md: 'b',
      version: '2.0.0',
      status: 'published',
      published_at: '2026-05-30T12:00:00Z',
    };
    const updateSpy = vi.fn().mockReturnThis();
    const from = vi
      .fn()
      .mockReturnValue(makeBuilder({ data: updatedRow, error: null }, { update: updateSpy }));
    const rpc = vi.fn().mockResolvedValue({ data: 1, error: null });
    const client = makeClient({ from, rpc, userId: 'admin-1' });

    const res = await publishEntry(client, 'entry-3');

    expect(res.status).toBe('published');
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'published', published_at: expect.any(String) }),
    );
    expect(rpc).toHaveBeenCalledWith(
      'log_admin_action',
      expect.objectContaining({
        p_action_name: 'changelog.publish',
        p_row_pk: 'entry-3',
      }),
    );
  });
});

describe('updateEntry + archiveEntry', () => {
  it('updateEntry audits changelog.update with before/after', async () => {
    const beforeRow: ProductUpdateEntry = {
      id: 'e4',
      slug: 's',
      title: 'old',
      body_md: 'b',
      version: null,
      status: 'draft',
      published_at: '2026-05-30T00:00:00Z',
    };
    const afterRow: ProductUpdateEntry = { ...beforeRow, title: 'new' };
    // First from() call = SELECT existing (before); second = UPDATE returning after.
    const from = vi
      .fn()
      .mockReturnValueOnce(makeBuilder({ data: beforeRow, error: null }))
      .mockReturnValueOnce(makeBuilder({ data: afterRow, error: null }));
    const rpc = vi.fn().mockResolvedValue({ data: 1, error: null });
    const client = makeClient({ from, rpc, userId: 'admin-1' });

    const res = await updateEntry(client, 'e4', { title: 'new' });
    expect(res.title).toBe('new');
    expect(rpc).toHaveBeenCalledWith(
      'log_admin_action',
      expect.objectContaining({ p_action_name: 'changelog.update', p_row_pk: 'e4' }),
    );
  });

  it('archiveEntry sets status=archived and audits changelog.archive', async () => {
    const archived: ProductUpdateEntry = {
      id: 'e5',
      slug: 's',
      title: 't',
      body_md: 'b',
      version: null,
      status: 'archived',
      published_at: '2026-05-30T00:00:00Z',
    };
    const updateSpy = vi.fn().mockReturnThis();
    const from = vi
      .fn()
      .mockReturnValue(makeBuilder({ data: archived, error: null }, { update: updateSpy }));
    const rpc = vi.fn().mockResolvedValue({ data: 1, error: null });
    const client = makeClient({ from, rpc, userId: 'admin-1' });

    const res = await archiveEntry(client, 'e5');
    expect(res.status).toBe('archived');
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ status: 'archived' }));
    expect(rpc).toHaveBeenCalledWith(
      'log_admin_action',
      expect.objectContaining({ p_action_name: 'changelog.archive', p_row_pk: 'e5' }),
    );
  });
});

describe('listEntries', () => {
  it('selects all rows ordered published_at desc', async () => {
    const rows: ProductUpdateEntry[] = [
      {
        id: 'a',
        slug: 'a',
        title: 'A',
        body_md: '',
        version: null,
        status: 'published',
        published_at: '2026-05-30T00:00:00Z',
      },
    ];
    const orderSpy = vi.fn().mockReturnThis();
    const builder = makeBuilder({ data: rows, error: null }, { order: orderSpy });
    const from = vi.fn().mockReturnValue(builder);
    const client = makeClient({ from });
    const res = await listEntries(client);
    expect(res).toHaveLength(1);
    expect(from).toHaveBeenCalledWith('changelog_entries');
    expect(orderSpy).toHaveBeenCalledWith('published_at', { ascending: false });
  });
});
