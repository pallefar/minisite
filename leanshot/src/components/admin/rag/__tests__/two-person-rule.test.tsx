/**
 * Phase 60 Plan 60-08 — 2-person rule UI layer tests.
 *
 * Dedicated suite per [[feedback_3_layer_must_never_invariant_pattern]].
 * UI layer of the 3-layer invariant (DB = 60-01, CI = 60-03).
 *
 * Per D-AdminQueue-15 run with:
 *   npx vitest run --config vite.config.ts src/components/admin/rag/__tests__/two-person-rule.test.tsx
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReviewQueueRow } from '@/lib/admin/rag/chunk-api';

const CURRENT_USER_ID = 'current-admin-user';

const { mockListQueue, mockApproveChunk } = vi.hoisted(() => ({
  mockListQueue: vi.fn(),
  mockApproveChunk: vi.fn(),
}));

vi.mock('@/lib/admin/rag/chunk-api', () => ({
  ragListReviewQueue: mockListQueue,
  ragApproveChunk: mockApproveChunk,
  ragRejectChunk: vi.fn().mockResolvedValue({ data: null, error: null }),
  ragRetractChunk: vi.fn().mockResolvedValue({ data: null, error: null }),
  ragQueueChunk: vi.fn().mockResolvedValue({ data: null, error: null }),
}));

vi.mock('@/lib/store', () => ({
  useStore: (selector: (s: unknown) => unknown) =>
    selector({
      signedIn: { user: { id: CURRENT_USER_ID } },
      toast: null,
      showToast: vi.fn(),
      dismissToast: vi.fn(),
    }),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: vi.fn() },
}));

import RagQueuePage from '../RagQueuePage';

const SELF_CREATED_ROW: ReviewQueueRow = {
  id: 'chunk-self',
  source_id: 'src-1',
  source_name: 'PubMed',
  source_tier: 'B',
  topic_tag: 'glp-1',
  summary: 'Self-created summary',
  quote_blocks: [{ text: 'quote', kind: 'dose' }],
  source_markdown: '# Test',
  created_by: CURRENT_USER_ID, // SAME as current user
  queued_at: '2026-05-01T00:00:00Z',
  queue_age_hours: 24,
  canonical_url: 'https://example.com',
};

const OTHER_ROW: ReviewQueueRow = {
  ...SELF_CREATED_ROW,
  id: 'chunk-other',
  created_by: 'different-user',
  summary: 'Other summary',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockApproveChunk.mockResolvedValue({ data: null, error: null });
  mockListQueue.mockResolvedValue({ data: [SELF_CREATED_ROW, OTHER_ROW], error: null });
});

describe('2-person rule UI layer', () => {
  it('Test A: row with created_by===currentUserId has disabled Approve button with aria-disabled=true', async () => {
    render(<RagQueuePage />);
    await waitFor(() => {
      expect(screen.getAllByText('PubMed').length).toBeGreaterThan(0);
    });
    // Find approve buttons - the first one (for SELF_CREATED_ROW) should be disabled
    const approveBtns = screen.getAllByRole('button', { name: /approve chunk/i });
    // The button for the self-created row should be disabled
    const disabledBtn = approveBtns.find((b) => b.hasAttribute('disabled'));
    expect(disabledBtn).toBeTruthy();
    expect(disabledBtn).toHaveAttribute('aria-disabled', 'true');
  });

  it('Test B: self-created row renders inline Badge with verbatim copy "You created this — needs a different reviewer"', async () => {
    render(<RagQueuePage />);
    await waitFor(() => {
      expect(
        screen.getByText('You created this — needs a different reviewer'),
      ).toBeTruthy();
    });
  });

  it('Test C: clicking disabled Approve on self-created row does NOT call ragApproveChunk', async () => {
    render(<RagQueuePage />);
    await waitFor(() => {
      expect(screen.getAllByText('PubMed').length).toBeGreaterThan(0);
    });
    const approveBtns = screen.getAllByRole('button', { name: /approve chunk/i });
    const disabledBtn = approveBtns.find((b) => b.hasAttribute('disabled'));
    expect(disabledBtn).toBeTruthy();
    // Try to click the disabled button
    if (disabledBtn) {
      fireEvent.click(disabledBtn);
    }
    // Should NOT have called approve
    expect(mockApproveChunk).not.toHaveBeenCalled();
  });

  it('Test D: Reject button on self-created row remains enabled (2-person rule applies ONLY to approve)', async () => {
    render(<RagQueuePage />);
    await waitFor(() => {
      expect(screen.getAllByText('PubMed').length).toBeGreaterThan(0);
    });
    // All reject buttons should be enabled (not disabled)
    const rejectBtns = screen.getAllByRole('button', { name: /reject chunk/i });
    rejectBtns.forEach((btn) => {
      expect(btn).not.toHaveAttribute('disabled');
    });
  });

  it('Test E: opening QueueDetailPane for self-created row shows warning Badge above action row + Approve disabled', async () => {
    render(<RagQueuePage />);
    await waitFor(() => {
      expect(screen.getAllByText('Self-created summary').length).toBeGreaterThan(0);
    });
    // Click the self-created row
    fireEvent.click(screen.getByText('Self-created summary'));
    await waitFor(() => {
      expect(screen.getByText('SOURCE TEXT')).toBeTruthy();
    });
    // Warning badge in detail pane
    const badges = screen.getAllByText('You created this — needs a different reviewer');
    expect(badges.length).toBeGreaterThanOrEqual(1);
    // Approve button in detail pane should be disabled
    const detailApprove = screen.getAllByRole('button', { name: /approve chunk/i });
    const disabledApprove = detailApprove.find((b) => b.hasAttribute('disabled'));
    expect(disabledApprove).toBeTruthy();
  });

  it('Test F: pressing A keyboard shortcut on 2-person-blocked chunk is a no-op', async () => {
    render(<RagQueuePage />);
    await waitFor(() => {
      expect(screen.getAllByText('Self-created summary').length).toBeGreaterThan(0);
    });
    // Click the self-created row to make it active
    fireEvent.click(screen.getByText('Self-created summary'));
    await waitFor(() => {
      expect(screen.getByText('SOURCE TEXT')).toBeTruthy();
    });
    // Press A — should be a no-op for the 2-person blocked chunk
    fireEvent.keyDown(window, { key: 'a' });
    expect(mockApproveChunk).not.toHaveBeenCalled();
  });
});
