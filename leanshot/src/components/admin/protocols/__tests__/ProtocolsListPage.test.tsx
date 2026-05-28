/**
 * Phase 61 Plan 61-04 — ProtocolsListPage unit tests.
 *
 * 5 behavior assertions:
 *  T1 — all 3 protocol names appear after mount
 *  T2 — ProtocolStatusBadge appears for each row (3 × aria-label 'Protocol status:')
 *  T3 — clicking 'Published' filter pill → only published rows remain visible
 *  T4 — empty state: heading 'No protocols yet' + correct body copy when data=[]
 *  T5 — clicking 'New Protocol' button calls supabase.from('protocols').insert
 *
 * Pattern follows HitlQueuePage.test.tsx — chainable supabase mock + dynamic import.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Protocol } from '@/types/protocols';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeProtocol(overrides: Partial<Protocol> = {}): Protocol {
  const id = `proto-${Math.random().toString(36).slice(2)}`;
  return {
    id,
    version: 1,
    name: `Protocol ${id}`,
    compound: 'Tirzepatide',
    audience: ['B2C'],
    base_slug: `protocol-${id}`,
    slug: `protocol-${id}-v1`,
    review_state: 'draft',
    created_by: 'admin-1',
    reviewed_by: null,
    published_at: null,
    reviewed_at: null,
    created_at: '2026-05-26T00:00:00Z',
    updated_at: '2026-05-26T00:00:00Z',
    ...overrides,
  };
}

// ─── Chainable supabase mock ──────────────────────────────────────────────────

let mockSelectData: Protocol[] = [];
let mockInsertData: { id: string } | null = null;
let mockInsertCalled = false;
let mockInsertPayload: Record<string, unknown> | null = null;

function makeChainableBuilder(returnData: Protocol[]) {
  const builder: Record<string, unknown> = {};
  builder.select = () => builder;
  builder.order = () => builder;
  builder.insert = (payload: Record<string, unknown>) => {
    mockInsertCalled = true;
    mockInsertPayload = payload;
    return {
      select: () => ({
        single: () => Promise.resolve({ data: mockInsertData, error: null }),
      }),
    };
  };
  builder.then = (resolve: (val: unknown) => unknown) =>
    Promise.resolve({ data: returnData, error: null }).then(resolve);
  return builder;
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'protocols') {
        return makeChainableBuilder(mockSelectData);
      }
      return makeChainableBuilder([]);
    },
  },
}));

vi.mock('@/lib/store', () => ({
  useStore: (selector: (s: unknown) => unknown) =>
    selector({
      signedIn: { user: { id: 'admin-user-id' } },
      toast: null,
      showToast: vi.fn(),
      dismissToast: vi.fn(),
    }),
}));

// Suppress window.history.pushState calls in tests
const originalPushState = window.history.pushState.bind(window.history);
beforeEach(() => {
  mockSelectData = [];
  mockInsertData = null;
  mockInsertCalled = false;
  mockInsertPayload = null;
  vi.clearAllMocks();
  window.history.pushState = vi.fn();
});
afterEach(() => {
  window.history.pushState = originalPushState;
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ProtocolsListPage', () => {
  it('T1: all 3 protocol names appear after mount', async () => {
    const proto1 = makeProtocol({ name: 'Tirzepatide 12-week', review_state: 'published' });
    const proto2 = makeProtocol({ name: 'Retatrutide Stack', review_state: 'in_review' });
    const proto3 = makeProtocol({ name: 'GHRP-2 Sleep Stack', review_state: 'draft' });
    mockSelectData = [proto1, proto2, proto3];

    const { ProtocolsListPage } = await import('../ProtocolsListPage');
    render(<ProtocolsListPage />);

    await waitFor(() => {
      expect(screen.getByText('Tirzepatide 12-week')).toBeTruthy();
    });
    expect(screen.getByText('Retatrutide Stack')).toBeTruthy();
    expect(screen.getByText('GHRP-2 Sleep Stack')).toBeTruthy();
  });

  it('T2: ProtocolStatusBadge appears for each row (3 aria-labels starting with Protocol status:)', async () => {
    const proto1 = makeProtocol({ review_state: 'published' });
    const proto2 = makeProtocol({ review_state: 'in_review' });
    const proto3 = makeProtocol({ review_state: 'draft' });
    mockSelectData = [proto1, proto2, proto3];

    const { ProtocolsListPage } = await import('../ProtocolsListPage');
    render(<ProtocolsListPage />);

    await waitFor(() => {
      const badges = screen
        .getAllByRole('generic')
        .filter((el) => el.getAttribute('aria-label')?.startsWith('Protocol status:') ?? false);
      expect(badges.length).toBeGreaterThanOrEqual(3);
    });
  });

  it('T3: clicking Published filter pill shows only published rows', async () => {
    const published = makeProtocol({ name: 'Published Protocol', review_state: 'published' });
    const draft = makeProtocol({ name: 'Draft Protocol', review_state: 'draft' });
    const inReview = makeProtocol({ name: 'In Review Protocol', review_state: 'in_review' });
    mockSelectData = [published, draft, inReview];

    const { ProtocolsListPage } = await import('../ProtocolsListPage');
    render(<ProtocolsListPage />);

    await waitFor(() => {
      expect(screen.getByText('Published Protocol')).toBeTruthy();
    });

    // Click the Published filter pill
    const pills = screen.getAllByRole('button');
    const publishedPill = pills.find(
      (btn) => btn.textContent?.trim() === 'Published' && btn.hasAttribute('aria-pressed'),
    );
    expect(publishedPill).toBeTruthy();
    fireEvent.click(publishedPill!);

    await waitFor(() => {
      expect(screen.getByText('Published Protocol')).toBeTruthy();
      expect(screen.queryByText('Draft Protocol')).toBeNull();
      expect(screen.queryByText('In Review Protocol')).toBeNull();
    });
  });

  it('T4: empty state renders heading + body when supabase returns []', async () => {
    mockSelectData = [];

    const { ProtocolsListPage } = await import('../ProtocolsListPage');
    render(<ProtocolsListPage />);

    await waitFor(() => {
      expect(screen.getByText('No protocols yet')).toBeTruthy();
      expect(
        screen.getByText(
          'Create your first dosing protocol to distribute to clinicians and patients.',
        ),
      ).toBeTruthy();
    });
  });

  it('T5: clicking New Protocol button calls supabase insert with expected payload', async () => {
    mockSelectData = [];
    mockInsertData = { id: 'new-proto-id' };

    const { ProtocolsListPage } = await import('../ProtocolsListPage');
    render(<ProtocolsListPage />);

    await waitFor(() => {
      expect(screen.getByText('No protocols yet')).toBeTruthy();
    });

    // There may be multiple New Protocol buttons (header + empty state CTA); use the first
    const newButtons = screen.getAllByRole('button', { name: /new protocol/i });
    fireEvent.click(newButtons[0]);

    await waitFor(() => {
      expect(mockInsertCalled).toBe(true);
      expect(mockInsertPayload).toMatchObject({
        name: 'Untitled Protocol',
        compound: '',
        version: 1,
        review_state: 'draft',
        created_by: 'admin-user-id',
      });
    });
  });
});
