/**
 * Phase 15 Plan 15-04 — browser-side page-builder API module.
 *
 * Thin wrappers around the `page-save` / `page-publish` Edge Functions and
 * the `landing_pages` table reads. Lands in the `page-builder-runtime`
 * chunk per 15-02's vite.config.ts manualChunks rule.
 *
 * Uses `supabase.functions.invoke()` — the existing project pattern (see
 * `src/components/billing/PaywallUpsell.tsx` for the analog). The session
 * JWT is attached automatically by supabase-js when the user is signed in,
 * so we never hand-roll an Authorization header here.
 *
 * Per Pitfall 8: errors from the Edge Functions are returned as typed
 * `Result` objects rather than thrown so callers can present friendly
 * UI-SPEC error copy without try/catch ceremony.
 *
 * `arrayMove` from `@dnd-kit/sortable` lands in `vendor-dnd-kit` via the
 * 15-02 manualChunks rule — a static import of it here would NOT regress
 * the index chunk because this file itself is in the `page-builder-runtime`
 * chunk, not the index.
 */
import { arrayMove } from '@dnd-kit/sortable';
import type { BlockNode, BlockType } from '@/lib/page-builder/block-schema';
import { supabase } from '@/lib/supabase';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PageListRow {
  id: string;
  slug: string;
  title: string;
  is_published: boolean;
  updated_at: string;
}

export interface PageLoad {
  id: string;
  slug: string;
  title: string;
  is_published: boolean;
  published_revision_id: string | null;
  blocks: BlockNode[];
  latestRevisionId: string | null;
}

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// savePage / publishPage — Edge Function wrappers
// ---------------------------------------------------------------------------

export interface SavePageArgs {
  pageId?: string;
  slug: string;
  title: string;
  blocks: BlockNode[];
}

export interface SavePageResult {
  pageId: string;
  revisionId: string;
}

export async function savePage(args: SavePageArgs): Promise<Result<SavePageResult>> {
  try {
    const { data, error } = await supabase.functions.invoke('page-save', {
      body: args,
    });
    if (error) {
      // supabase-js wraps non-2xx as error.message — surface the opaque code
      // when present so the UI can branch on 'forbidden' / 'reserved_slug'.
      const message = (error as { message?: string }).message ?? 'save_failed';
      return { ok: false, error: message };
    }
    if (!data || typeof data !== 'object') {
      return { ok: false, error: 'save_failed' };
    }
    const d = data as { pageId?: unknown; revisionId?: unknown };
    if (typeof d.pageId !== 'string' || typeof d.revisionId !== 'string') {
      return { ok: false, error: 'save_failed' };
    }
    return { ok: true, value: { pageId: d.pageId, revisionId: d.revisionId } };
  } catch (err) {
    console.error('[page-api] savePage', err instanceof Error ? err.message : 'unknown');
    return { ok: false, error: 'save_failed' };
  }
}

export interface PublishPageArgs {
  pageId: string;
  revisionId: string;
}

export interface PublishPageResult {
  ok: true;
  slug: string;
}

export async function publishPage(
  args: PublishPageArgs,
): Promise<Result<PublishPageResult>> {
  try {
    const { data, error } = await supabase.functions.invoke('page-publish', {
      body: args,
    });
    if (error) {
      const message = (error as { message?: string }).message ?? 'publish_failed';
      return { ok: false, error: message };
    }
    const d = data as { ok?: unknown; slug?: unknown } | null;
    if (!d || d.ok !== true || typeof d.slug !== 'string') {
      return { ok: false, error: 'publish_failed' };
    }
    return { ok: true, value: { ok: true, slug: d.slug } };
  } catch (err) {
    console.error('[page-api] publishPage', err instanceof Error ? err.message : 'unknown');
    return { ok: false, error: 'publish_failed' };
  }
}

// ---------------------------------------------------------------------------
// listPages / getPage — supabase reads
// ---------------------------------------------------------------------------

export async function listPages(): Promise<Result<PageListRow[]>> {
  try {
    const { data, error } = await supabase
      .from('landing_pages')
      .select('id, slug, title, is_published, updated_at')
      .order('updated_at', { ascending: false });
    if (error) {
      return { ok: false, error: error.message };
    }
    return { ok: true, value: (data ?? []) as PageListRow[] };
  } catch (err) {
    console.error('[page-api] listPages', err instanceof Error ? err.message : 'unknown');
    return { ok: false, error: 'list_failed' };
  }
}

export async function getPage(pageId: string): Promise<Result<PageLoad>> {
  try {
    const { data: pageRow, error: pageErr } = await supabase
      .from('landing_pages')
      .select('id, slug, title, is_published, published_revision_id')
      .eq('id', pageId)
      .maybeSingle();
    if (pageErr) return { ok: false, error: pageErr.message };
    if (!pageRow) return { ok: false, error: 'page_not_found' };

    // Latest revision's blocks (most recent created_at).
    const { data: revRow } = await supabase
      .from('landing_page_revisions')
      .select('id, blocks')
      .eq('page_id', pageId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const blocks = Array.isArray(revRow?.blocks)
      ? (revRow!.blocks as BlockNode[])
      : [];
    return {
      ok: true,
      value: {
        id: pageRow.id as string,
        slug: pageRow.slug as string,
        title: pageRow.title as string,
        is_published: !!pageRow.is_published,
        published_revision_id:
          (pageRow.published_revision_id as string | null) ?? null,
        blocks,
        latestRevisionId: (revRow?.id as string | undefined) ?? null,
      },
    };
  } catch (err) {
    console.error('[page-api] getPage', err instanceof Error ? err.message : 'unknown');
    return { ok: false, error: 'get_failed' };
  }
}

// ---------------------------------------------------------------------------
// Pure helpers (testable without supabase)
// ---------------------------------------------------------------------------

/**
 * Move the block with `activeId` to the position of `overId` and re-number
 * `order` on all affected siblings so the resulting sequence is contiguous
 * 0..n. Returns a new array; never mutates the input. Root-level only for
 * Slice 1 (nesting lands in 15-05+).
 */
export function reorderBlocks(
  blocks: BlockNode[],
  activeId: string,
  overId: string,
): BlockNode[] {
  if (activeId === overId) {
    return renumber(blocks);
  }
  const fromIdx = blocks.findIndex((b) => b.id === activeId);
  const toIdx = blocks.findIndex((b) => b.id === overId);
  if (fromIdx === -1 || toIdx === -1) return blocks;
  const moved = arrayMove(blocks, fromIdx, toIdx);
  return renumber(moved);
}

function renumber(blocks: BlockNode[]): BlockNode[] {
  return blocks.map((b, i) => (b.order === i ? b : { ...b, order: i }));
}

/**
 * Build a fresh block of the given type with sensible defaults. The
 * resulting `id` is a crypto.randomUUID (compatible everywhere supabase-js
 * runs — Vite browser + jsdom + node test envs).
 */
export function newBlock(type: BlockType, existingBlocks: BlockNode[]): BlockNode {
  const order = existingBlocks.filter((b) => b.parent_id === null).length;
  return {
    id: crypto.randomUUID(),
    type,
    parent_id: null,
    order,
    content: defaultContent(type),
    style: defaultStyle(type),
  };
}

function defaultContent(type: BlockType): Record<string, unknown> {
  switch (type) {
    case 'hero':
      return {
        heading: 'New hero heading',
        subheading: 'Short supporting line.',
        ctaLabel: 'Get started',
        ctaHref: '#',
      };
    case 'cta':
      return {
        heading: 'Ready to start?',
        body: 'Add a short body line that motivates the click.',
        ctaLabel: 'Get started',
        ctaHref: '#',
      };
    case 'footer':
      return {
        copyright: '© ' + new Date().getFullYear() + ' LeanShot',
        navLinks: [],
      };
    default:
      return {};
  }
}

function defaultStyle(type: BlockType): BlockNode['style'] {
  switch (type) {
    case 'hero':
      return { backgroundTone: 'brand', alignment: 'center', spacingDensity: 'default' };
    case 'footer':
      return { backgroundTone: 'dark', alignment: 'left', spacingDensity: 'default' };
    default:
      return { backgroundTone: 'default', alignment: 'center', spacingDensity: 'default' };
  }
}
