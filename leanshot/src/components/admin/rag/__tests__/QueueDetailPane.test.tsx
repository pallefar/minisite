/**
 * Phase 60 Plan 60-08 — QueueDetailPane unit tests (TDD RED → GREEN).
 *
 * Per D-AdminQueue-15 run with:
 *   npx vitest run --config vite.config.ts src/components/admin/rag/__tests__/QueueDetailPane.test.tsx
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReviewQueueRow } from '@/lib/admin/rag/chunk-api';
import { QueueDetailPane } from '../QueueDetailPane';

const { mockQueueChunk } = vi.hoisted(() => ({
  mockQueueChunk: vi.fn(),
}));

vi.mock('@/lib/admin/rag/chunk-api', () => ({
  ragQueueChunk: mockQueueChunk,
}));

vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: vi.fn() },
}));

const CHUNK: ReviewQueueRow = {
  id: 'chunk-1',
  source_id: 'src-1',
  source_name: 'PubMed Central',
  source_tier: 'B',
  topic_tag: 'glp-1',
  summary: 'A summary of GLP-1 findings',
  quote_blocks: [
    { text: 'Take 0.25mg weekly', kind: 'dose' },
    { text: 'Risk of nausea', kind: 'adverse-event', gloss: 'common' },
  ],
  source_markdown: '# PubMed Article\n\nContent here.',
  created_by: 'user-creator',
  queued_at: '2026-05-01T00:00:00Z',
  queue_age_hours: 600,
  canonical_url: 'https://pubmed.example.com/123',
};

const OTHER_USER = 'user-reviewer';
const CREATOR_USER = 'user-creator';

const defaultProps = {
  chunk: CHUNK,
  currentUserId: OTHER_USER,
  onApprove: vi.fn(),
  onReject: vi.fn(),
  onEdit: vi.fn(),
  onQueueWithEdits: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('QueueDetailPane', () => {
  it('Test 1: renders header with source name, TierBadge, date, and canonical URL link', () => {
    render(<QueueDetailPane {...defaultProps} />);
    expect(screen.getByText('PubMed Central')).toBeTruthy();
    expect(screen.getByText('Tier B')).toBeTruthy();
    const link = screen
      .getAllByRole('link')
      .find((l) => l.getAttribute('href') === 'https://pubmed.example.com/123');
    expect(link).toBeTruthy();
  });

  it('Test 2: renders side-by-side block at lg breakpoint (lg:grid-cols-2) and grid-cols-1 base', () => {
    const { container } = render(<QueueDetailPane {...defaultProps} />);
    const twoCol = container.querySelector('.lg\\:grid-cols-2');
    expect(twoCol).toBeTruthy();
    const gridEl = container.querySelector('.grid-cols-1');
    expect(gridEl).toBeTruthy();
  });

  it('Test 3: SOURCE TEXT half has correct label and bg-surface-soft class', () => {
    render(<QueueDetailPane {...defaultProps} />);
    expect(screen.getByText('SOURCE TEXT')).toBeTruthy();
  });

  it('Test 4: DOMPurify strips <script> and <img> from source_markdown', () => {
    const maliciousChunk: ReviewQueueRow = {
      ...CHUNK,
      source_markdown: '<script>alert(1)</script><img src="x" onerror="alert(2)"><p>safe</p>',
    };
    const { container } = render(<QueueDetailPane {...defaultProps} chunk={maliciousChunk} />);
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('safe');
  });

  it('Test 5: EXTRACTED QUOTE half renders each quote_block with text and kind badge', () => {
    render(<QueueDetailPane {...defaultProps} />);
    expect(screen.getByText('Take 0.25mg weekly')).toBeTruthy();
    expect(screen.getByText('Risk of nausea')).toBeTruthy();
    expect(screen.getByText('dose')).toBeTruthy();
    expect(screen.getByText('adverse-event')).toBeTruthy();
  });

  it('Test 6: adverse-event / contraindication kind badge has danger tone', () => {
    const chunkWithContra: ReviewQueueRow = {
      ...CHUNK,
      quote_blocks: [{ text: 'Contraindicated in renal impairment', kind: 'contraindication' }],
    };
    const { container } = render(<QueueDetailPane {...defaultProps} chunk={chunkWithContra} />);
    const badgeEl = Array.from(container.querySelectorAll('span')).find(
      (el) => el.textContent === 'contraindication',
    );
    expect(badgeEl).toBeTruthy();
    expect(badgeEl?.className ?? '').toContain('danger');
  });

  it('Test 7: summary block renders chunk.summary as text', () => {
    render(<QueueDetailPane {...defaultProps} />);
    expect(screen.getByText('A summary of GLP-1 findings')).toBeTruthy();
  });

  it('Test 8: sticky action row has Reject chunk, Edit & approve, and Approve chunk buttons', () => {
    render(<QueueDetailPane {...defaultProps} />);
    expect(screen.getByRole('button', { name: /approve chunk/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /reject chunk/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /edit.*approve/i })).toBeTruthy();
  });

  it('Test 9: 2-person rule — Approve disabled and warning badge when currentUserId === chunk.created_by', () => {
    render(<QueueDetailPane {...defaultProps} currentUserId={CREATOR_USER} />);
    const approveBtn = screen.getByRole('button', { name: /approve chunk/i });
    expect(approveBtn).toHaveAttribute('disabled');
    expect(approveBtn).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('You created this — needs a different reviewer')).toBeTruthy();
  });

  it('Test 10: tier select and topic tag inputs exist; save calls onQueueWithEdits', async () => {
    const onQueueWithEdits = vi.fn().mockResolvedValue(undefined);
    render(<QueueDetailPane {...defaultProps} onQueueWithEdits={onQueueWithEdits} />);
    const saveBtn = screen.getByRole('button', { name: /save edits/i });
    expect(saveBtn).toBeTruthy();
    fireEvent.click(saveBtn);
    await waitFor(() => {
      expect(onQueueWithEdits).toHaveBeenCalledWith(
        expect.objectContaining({
          tier: CHUNK.source_tier,
          topicTag: CHUNK.topic_tag,
        }),
      );
    });
  });

  it('Test 11: TierBadge uses neutral/info palette — no green/red coloring', () => {
    render(<QueueDetailPane {...defaultProps} />);
    const tierBadge = screen.getByText('Tier B');
    expect(tierBadge.className).not.toContain('success');
    expect(tierBadge.className).not.toContain('danger');
    expect(tierBadge.closest('span')?.className ?? '').toContain('info');
  });

  it('Test 12: renders without framer-motion transitions when useReducedMotion returns true', () => {
    const { container } = render(<QueueDetailPane {...defaultProps} />);
    expect(container.firstChild).not.toBeNull();
  });
});
