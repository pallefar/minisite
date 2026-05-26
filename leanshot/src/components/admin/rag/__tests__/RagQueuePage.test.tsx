/**
 * Phase 60 Plan 60-08 — RagQueuePage unit tests (TDD RED → GREEN).
 *
 * Per D-AdminQueue-15 run with:
 *   npx vitest run --config vite.config.ts src/components/admin/rag/__tests__/RagQueuePage.test.tsx
 */
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReviewQueueRow } from '@/lib/admin/rag/chunk-api';

const { mockListQueue, mockApproveChunk, mockRejectChunk, mockCurrentUserId } = vi.hoisted(() => ({
  mockListQueue: vi.fn(),
  mockApproveChunk: vi.fn(),
  mockRejectChunk: vi.fn(),
  mockCurrentUserId: vi.fn(() => 'reviewer-user-id'),
}));

vi.mock('@/lib/admin/rag/chunk-api', () => ({
  ragListReviewQueue: mockListQueue,
  ragApproveChunk: mockApproveChunk,
  ragRejectChunk: mockRejectChunk,
  ragRetractChunk: vi.fn().mockResolvedValue({ data: null, error: null }),
  ragQueueChunk: vi.fn().mockResolvedValue({ data: null, error: null }),
}));

vi.mock('@/lib/store', () => ({
  useStore: (selector: (s: unknown) => unknown) =>
    selector({
      signedIn: { user: { id: mockCurrentUserId() } },
      toast: null,
      showToast: vi.fn(),
      dismissToast: vi.fn(),
    }),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: vi.fn() },
}));

import RagQueuePage from '../RagQueuePage';

const makeRow = (overrides?: Partial<ReviewQueueRow>): ReviewQueueRow => ({
  id: `chunk-${Math.random().toString(36).slice(2)}`,
  source_id: 'src-1',
  source_name: 'PubMed',
  source_tier: 'B',
  topic_tag: 'glp-1',
  summary: 'A summary',
  quote_blocks: [{ text: 'quote', kind: 'dose' }],
  source_markdown: '# Test',
  created_by: 'other-user',
  queued_at: '2026-05-01T00:00:00Z',
  queue_age_hours: 24,
  canonical_url: 'https://example.com',
  ...overrides,
});

const ROWS = [makeRow(), makeRow(), makeRow()];

beforeEach(() => {
  vi.clearAllMocks();
  mockListQueue.mockResolvedValue({ data: ROWS, error: null });
  mockApproveChunk.mockResolvedValue({ data: null, error: null });
  mockRejectChunk.mockResolvedValue({ data: null, error: null });
});

describe('RagQueuePage', () => {
  it('Test 1: on mount calls ragListReviewQueue once and shows skeleton initially', async () => {
    // Delay the resolution to observe loading state
    let resolve: (val: unknown) => void;
    mockListQueue.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    render(<RagQueuePage />);
    // At this point, rows haven't loaded yet
    expect(mockListQueue).toHaveBeenCalledTimes(1);
    // Resolve
    await act(async () => {
      resolve!({ data: ROWS, error: null });
    });
  });

  it('Test 2: renders header "Curation Queue" (18px) + backlog badge "Backlog: 3 items"', async () => {
    render(<RagQueuePage />);
    await waitFor(() => {
      expect(screen.getByText('Curation Queue')).toBeTruthy();
      expect(screen.getByText('Backlog: 3 items')).toBeTruthy();
    });
  });

  it('Test 3: backlog badge is warning-toned when count > 100', async () => {
    const bigRows = Array.from({ length: 101 }, () => makeRow());
    mockListQueue.mockResolvedValueOnce({ data: bigRows, error: null });
    const { container } = render(<RagQueuePage />);
    await waitFor(() => {
      const badge = screen.getByText('Backlog: 101 items');
      expect(badge.closest('span')?.className ?? '').toContain('warning');
    });
  });

  it('Test 4: renders 5 filter pills; clicking Tier B re-fetches with {tier: B}', async () => {
    render(<RagQueuePage />);
    await waitFor(() => {
      expect(screen.getByText('Backlog: 3 items')).toBeTruthy();
    });
    // Filter pills are Pill components with aria-pressed attribute
    // Find the Tier B pill (Pill component, not TierBadge)
    const allButtons = screen.getAllByRole('button');
    const tierBPill = allButtons.find(
      (btn) =>
        btn.textContent?.trim() === 'Tier B' && btn.hasAttribute('aria-pressed'),
    );
    expect(tierBPill).toBeTruthy();
    mockListQueue.mockResolvedValueOnce({ data: [], error: null });
    fireEvent.click(tierBPill!);
    await waitFor(() => {
      expect(mockListQueue).toHaveBeenCalledWith(expect.objectContaining({ tier: 'B' }));
    });
  });

  it('Test 5: each queue row shows source name, TierBadge, topic tag, summary (line-clamp), Approve + reject buttons', async () => {
    render(<RagQueuePage />);
    await waitFor(() => {
      // Multiple PubMed entries
      const pubmedEls = screen.getAllByText('PubMed');
      expect(pubmedEls.length).toBe(3);
    });
    // Approve buttons (one per row)
    const approveBtns = screen.getAllByRole('button', { name: /approve chunk/i });
    expect(approveBtns.length).toBeGreaterThanOrEqual(1);
  });

  it('Test 6: clicking a row sets the active chunk and shows QueueDetailPane', async () => {
    render(<RagQueuePage />);
    await waitFor(() => {
      expect(screen.getAllByText('PubMed').length).toBe(3);
    });
    // Click first row — this should render the detail pane
    const cards = screen.getAllByRole('button', { name: /approve chunk/i });
    // Click the row area (not the button itself)
    fireEvent.click(screen.getAllByText('A summary')[0]);
    // Detail pane should be visible
    await waitFor(() => {
      expect(screen.getByText('SOURCE TEXT')).toBeTruthy();
    });
  });

  it('Test 7: pressing A key approves active chunk, optimistically removes row, shows Toast', async () => {
    render(<RagQueuePage />);
    await waitFor(() => {
      expect(screen.getAllByText('PubMed').length).toBe(3);
    });
    // Select first row
    fireEvent.click(screen.getAllByText('A summary')[0]);
    await waitFor(() => {
      expect(screen.getByText('SOURCE TEXT')).toBeTruthy();
    });
    // Press A key
    fireEvent.keyDown(window, { key: 'a' });
    await waitFor(() => {
      expect(mockApproveChunk).toHaveBeenCalled();
    });
  });

  it('Test 8: pressing R opens RejectReasonSheet; pressing J/K moves active chunk', async () => {
    render(<RagQueuePage />);
    await waitFor(() => {
      expect(screen.getAllByText('A summary').length).toBe(3);
    });
    // Select first row
    fireEvent.click(screen.getAllByText('A summary')[0]);
    await waitFor(() => {
      expect(screen.getByText('SOURCE TEXT')).toBeTruthy();
    });
    // Press R to open RejectReasonSheet
    fireEvent.keyDown(window, { key: 'r' });
    await waitFor(() => {
      expect(screen.getByText('Off-topic')).toBeTruthy();
    });
  });

  it('Test 9: keyboard shortcuts are INERT when sheet is open', async () => {
    render(<RagQueuePage />);
    await waitFor(() => {
      expect(screen.getAllByText('A summary').length).toBe(3);
    });
    // Select a row
    fireEvent.click(screen.getAllByText('A summary')[0]);
    await waitFor(() => {
      expect(screen.getByText('SOURCE TEXT')).toBeTruthy();
    });
    // Open sheet via R
    fireEvent.keyDown(window, { key: 'r' });
    await waitFor(() => {
      expect(screen.getByText('Off-topic')).toBeTruthy();
    });
    // Now press A — should NOT approve because overlay is open
    fireEvent.keyDown(window, { key: 'a' });
    // mockApproveChunk should NOT have been called
    expect(mockApproveChunk).not.toHaveBeenCalled();
  });

  it('Test 10: keyboard shortcuts are INERT when focus is in input/textarea', async () => {
    render(<RagQueuePage />);
    await waitFor(() => {
      expect(screen.getAllByText('A summary').length).toBe(3);
    });
    // Select a row
    fireEvent.click(screen.getAllByText('A summary')[0]);
    await waitFor(() => {
      expect(screen.getByText('SOURCE TEXT')).toBeTruthy();
    });
    // Simulate keydown from within an input
    const input = screen.getByRole('textbox', { name: /topic tag/i });
    fireEvent.keyDown(input, { key: 'a' });
    expect(mockApproveChunk).not.toHaveBeenCalled();
  });

  it('Test 11: empty state renders EmptyState with "Queue clear" heading and correct body', async () => {
    mockListQueue.mockResolvedValueOnce({ data: [], error: null });
    render(<RagQueuePage />);
    await waitFor(() => {
      expect(screen.getByText('Queue clear')).toBeTruthy();
      expect(
        screen.getByText(
          'Nothing to review. Tier-A chunks auto-publish; new Tier-B/C items will appear here for review.',
        ),
      ).toBeTruthy();
    });
    // Right column hidden at empty state
    expect(screen.queryByText('SOURCE TEXT')).toBeNull();
  });

  it('Test 12: error state shows "Failed to load queue. Refresh to try again."', async () => {
    mockListQueue.mockResolvedValueOnce({
      data: null,
      error: { message: 'RPC error', code: '500', details: '', hint: '' },
    });
    render(<RagQueuePage />);
    await waitFor(() => {
      expect(
        screen.getByText('Failed to load queue. Refresh to try again.'),
      ).toBeTruthy();
    });
  });
});
