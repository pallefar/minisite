/**
 * Phase 15 Plan 15-04 — page-api unit tests.
 *
 * Validates:
 *   1. savePage invokes 'page-save' with the args body and returns {pageId, revisionId} on 200.
 *   2. savePage surfaces a typed error on a non-ok response.
 *   3. publishPage invokes 'page-publish' with the args body and returns {ok, slug}.
 *   4. listPages selects from landing_pages ordered by updated_at desc.
 *   5. reorderBlocks moves the active block to the over position and re-numbers order.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BlockNode } from '@/lib/page-builder/block-schema';
import { listPages, publishPage, reorderBlocks, savePage } from './page-api';

// ---------------------------------------------------------------------------
// Mock @/lib/supabase
// ---------------------------------------------------------------------------

interface FromBuilderMock {
  select: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
}

const invokeMock = vi.fn();
let fromState: {
  table: string | null;
  builder: FromBuilderMock | null;
  resolveValue: { data: unknown; error: unknown } | null;
} = { table: null, builder: null, resolveValue: null };

function makeFromBuilder(resolveValue: { data: unknown; error: unknown }): FromBuilderMock {
  const builder = {} as FromBuilderMock;
  builder.select = vi.fn(() => builder);
  builder.order = vi.fn(() => Promise.resolve(resolveValue));
  builder.eq = vi.fn(() => builder);
  builder.limit = vi.fn(() => builder);
  builder.maybeSingle = vi.fn(() => Promise.resolve(resolveValue));
  return builder;
}

vi.mock('@/lib/supabase', () => {
  return {
    supabase: {
      functions: {
        invoke: (...args: unknown[]) => invokeMock(...args),
      },
      from: (table: string) => {
        const v = fromState.resolveValue ?? { data: null, error: null };
        const b = makeFromBuilder(v);
        fromState.table = table;
        fromState.builder = b;
        return b;
      },
    },
  };
});

beforeEach(() => {
  invokeMock.mockReset();
  fromState = { table: null, builder: null, resolveValue: null };
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('savePage', () => {
  it('invokes page-save and returns {pageId, revisionId} on 200', async () => {
    invokeMock.mockResolvedValueOnce({
      data: { pageId: 'p1', revisionId: 'r1' },
      error: null,
    });
    const blocks: BlockNode[] = [
      { id: 'b1', type: 'hero', parent_id: null, order: 0, content: {}, style: {} },
    ];
    const res = await savePage({ slug: 'launch', title: 'Launch', blocks });

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith('page-save', {
      body: { slug: 'launch', title: 'Launch', blocks },
    });
    expect(res).toEqual({ ok: true, value: { pageId: 'p1', revisionId: 'r1' } });
  });

  it('returns a typed error on 403 forbidden', async () => {
    invokeMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'forbidden' },
    });
    const res = await savePage({ slug: 'x', title: 'X', blocks: [] });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe('forbidden');
    }
  });
});

describe('publishPage', () => {
  it('invokes page-publish and returns {ok, slug}', async () => {
    invokeMock.mockResolvedValueOnce({
      data: { ok: true, slug: 'launch' },
      error: null,
    });
    const res = await publishPage({ pageId: 'p1', revisionId: 'r1' });
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith('page-publish', {
      body: { pageId: 'p1', revisionId: 'r1' },
    });
    expect(res).toEqual({ ok: true, value: { ok: true, slug: 'launch' } });
  });
});

describe('listPages', () => {
  it('selects id,slug,title,is_published,updated_at from landing_pages ordered desc', async () => {
    fromState.resolveValue = {
      data: [
        {
          id: 'p1',
          slug: 'launch',
          title: 'Launch',
          is_published: true,
          updated_at: '2026-05-15T00:00:00Z',
        },
      ],
      error: null,
    };
    const res = await listPages();
    expect(fromState.table).toBe('landing_pages');
    expect(fromState.builder?.select).toHaveBeenCalledWith(
      'id, slug, title, is_published, updated_at',
    );
    expect(fromState.builder?.order).toHaveBeenCalledWith('updated_at', {
      ascending: false,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.length).toBe(1);
      expect(res.value[0]!.slug).toBe('launch');
    }
  });
});

describe('reorderBlocks', () => {
  it('moves the active block to the over position and renumbers order contiguously', () => {
    const blocks: BlockNode[] = [
      { id: 'a', type: 'hero', parent_id: null, order: 0, content: {}, style: {} },
      { id: 'b', type: 'cta', parent_id: null, order: 1, content: {}, style: {} },
      { id: 'c', type: 'footer', parent_id: null, order: 2, content: {}, style: {} },
    ];
    // Move 'a' to where 'c' is — expect order [b, c, a] with contiguous 0..2.
    const moved = reorderBlocks(blocks, 'a', 'c');
    expect(moved.map((b) => b.id)).toEqual(['b', 'c', 'a']);
    expect(moved.map((b) => b.order)).toEqual([0, 1, 2]);
  });
});
