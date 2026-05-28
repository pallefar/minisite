/**
 * Phase 39 Plan 39-09 — PageEditorView variant-authoring extensions RTL coverage.
 *
 * Per plan <behavior>:
 *   (a) toolbar has a 'Create variant' button (UI-SPEC copy)
 *   (b) clicking it opens a Modal with TrafficSplitSlider + 'Publish variant'
 *   (c) Publish action calls supabase from('page_variants').insert
 *   (d) each BlockNode rendered in canvas has a per-block 'Add variant'
 *       affordance
 *   (e) clicking 'Add variant' opens BlockVariantDrawer for that block
 *
 * The existing 15-04 PageEditorView Slice 1 behaviors are NOT re-tested here;
 * the page-builder-slice1.spec.ts Playwright spec already covers them and the
 * AdminMemberDetailPage.test.tsx pattern for vi.mock('@/lib/supabase') is the
 * stable seam.
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as PageApi from '@/lib/page-builder/page-api';
import { PageEditorView } from './PageEditorView';

// Mock the supabase client BEFORE importing the component (the import-time
// `import { supabase } from '@/lib/supabase'` resolves the mocked module).
const mockInsertSingle = vi.fn();
const mockUpdateEq = vi.fn();
const mockFunctionsInvoke = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (_table: string) => ({
      insert: (_row: unknown) => ({
        select: (_cols: string) => ({
          single: () => mockInsertSingle(),
        }),
      }),
      update: (_patch: unknown) => ({
        eq: (_col: string, _val: unknown) => mockUpdateEq(),
      }),
      select: (_cols: string) => ({
        eq: (_col: string, _val: unknown) => ({
          eq: (_col2: string, _val2: unknown) => ({
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
          }),
        }),
        order: (_col: string, _opts: unknown) => Promise.resolve({ data: [], error: null }),
      }),
    }),
    functions: {
      invoke: (...args: unknown[]) => mockFunctionsInvoke(...args),
    },
    auth: {
      getUser: () =>
        Promise.resolve({
          data: { user: { id: 'staff-user', email: 'staff@leanshot.app' } },
          error: null,
        }),
    },
  },
}));

// Mock page-api so the load-page on-mount effect does not blow up — the
// PageEditorView tries to load `pageId` from the URL on mount.
vi.mock('@/lib/page-builder/page-api', async () => {
  const actual = await vi.importActual<typeof PageApi>('@/lib/page-builder/page-api');
  return {
    ...actual,
    getPage: vi.fn().mockResolvedValue({
      ok: true,
      value: {
        id: 'page-1',
        slug: 'launch',
        title: 'Launch',
        is_published: true,
        published_revision_id: 'rev-1',
        blocks: [
          {
            id: 'h1',
            type: 'hero',
            parent_id: null,
            order: 0,
            content: {
              heading: 'Hello',
              subheading: '',
              ctaLabel: 'Go',
              ctaHref: '/x',
            },
            style: {},
          },
        ],
        latestRevisionId: 'rev-1',
        seo: {
          seo_title: '',
          seo_description: '',
          seo_og_image: '',
          seo_canonical: '',
          seo_schema_type: 'WebPage',
        },
      },
    }),
    listRevisions: vi.fn().mockResolvedValue({ ok: true, value: [] }),
    savePage: vi.fn(),
    publishPage: vi.fn(),
    newBlock: actual.newBlock,
  };
});

beforeEach(() => {
  mockInsertSingle.mockReset();
  mockUpdateEq.mockReset();
  mockFunctionsInvoke.mockReset();
  // Pin the URL so PageEditorView reads pageId=page-1 (not 'new').
  window.history.replaceState(null, '', '/admin/pages/page-1');
});

describe('PageEditorView — 39-09 variant authoring', () => {
  it('toolbar exposes a "Create variant" button with UI-SPEC copy', async () => {
    render(<PageEditorView />);
    await waitFor(() => {
      expect(screen.getByTestId('open-create-variant')).toBeInTheDocument();
    });
    const btn = screen.getByTestId('open-create-variant');
    expect(btn).toHaveTextContent('Create variant');
  });

  it('clicking "Create variant" opens a Modal containing the TrafficSplitSlider + "Publish variant" CTA', async () => {
    render(<PageEditorView />);
    const user = userEvent.setup();
    await waitFor(() => {
      expect(screen.getByTestId('open-create-variant')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('open-create-variant'));
    const modal = await screen.findByTestId('create-variant-modal');
    // TrafficSplitSlider (Plan 39-07) reused here per <action>: present as
    // a role=group with the documented aria-label.
    expect(within(modal).getByRole('group', { name: /traffic share/i })).toBeInTheDocument();
    // The primary CTA copy is verbatim from UI-SPEC.
    const publishBtn = screen.getByTestId('publish-variant');
    expect(publishBtn).toHaveTextContent('Publish variant');
  });

  it('"Publish variant" inserts a page_variants row via supabase + closes the modal', async () => {
    mockInsertSingle.mockResolvedValue({
      data: { id: 'variant-1' },
      error: null,
    });
    render(<PageEditorView />);
    const user = userEvent.setup();
    await waitFor(() => {
      expect(screen.getByTestId('open-create-variant')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('open-create-variant'));
    await screen.findByTestId('create-variant-modal');
    await user.click(screen.getByTestId('publish-variant'));
    await waitFor(() => {
      expect(mockInsertSingle).toHaveBeenCalledTimes(1);
    });
    // Modal closes after successful insert.
    await waitFor(() => {
      expect(screen.queryByTestId('create-variant-modal')).not.toBeInTheDocument();
    });
  });

  it('renders a per-block "Add variant" affordance for each root block', async () => {
    render(<PageEditorView />);
    await waitFor(() => {
      expect(screen.getByTestId('block-variant-list')).toBeInTheDocument();
    });
    // The mocked page exposes a single hero block id=h1.
    expect(screen.getByTestId('add-variant-h1')).toBeInTheDocument();
    expect(screen.getByTestId('add-variant-h1')).toHaveTextContent('Add variant');
  });

  it('clicking per-block "Add variant" opens the BlockVariantDrawer for that block', async () => {
    render(<PageEditorView />);
    const user = userEvent.setup();
    await waitFor(() => {
      expect(screen.getByTestId('add-variant-h1')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('add-variant-h1'));
    // Drawer is the Sheet primitive — role=dialog with aria-modal=true.
    const drawer = await screen.findByTestId('block-variant-drawer');
    expect(drawer).toBeInTheDocument();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });
});
