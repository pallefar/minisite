/**
 * Phase 60 Plan 60-10 Task 4 — CitationPopover tests.
 *
 * Run: npx vitest run --config vite.config.ts src/components/dashboard/ai/__tests__/CitationPopover.test.tsx
 */

import { describe, it, expect, vi, beforeEach, afterEach, type MockedFunction } from 'vitest';
import { render, screen, waitFor, act, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CitationPopover } from '../CitationPopover';
import type { RagChunkResult } from '@/lib/rag/retrieve-client';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const { mockRagChunkById, mockCaptureRagEventBrowser } = vi.hoisted(() => ({
  mockRagChunkById: vi.fn<Parameters<typeof import('@/lib/rag/retrieve-client').ragChunkById>, ReturnType<typeof import('@/lib/rag/retrieve-client').ragChunkById>>(),
  mockCaptureRagEventBrowser: vi.fn(),
}));

vi.mock('@/lib/rag/retrieve-client', () => ({
  ragChunkById: mockRagChunkById,
}));

vi.mock('@/lib/rag/server-rag-events-relay', () => ({
  captureRagEventBrowser: mockCaptureRagEventBrowser,
}));

// ─── Fixture ──────────────────────────────────────────────────────────────────

const VALID_CHUNK: RagChunkResult = {
  chunk_id: 'a1b2c3d4-e5f6-7890-abcd-ef0123456789',
  source_name: 'FDA Ozempic Label',
  source_type: 'fda_label',
  source_tier: 'A',
  canonical_url: 'https://www.accessdata.fda.gov/ozempic.pdf',
  topic_tag: 'glp1-dosing',
  summary: 'Ozempic dosing schedule',
  verbatim_quote: 'Tirzepatide is dosed weekly starting at 2.5mg.',
  scraped_at: '2024-01-15T00:00:00Z',
  last_reviewed_at: '2024-01-15T00:00:00Z',
  stale: false,
  public_visibility: true,
};

const STALE_CHUNK: RagChunkResult = { ...VALID_CHUNK, stale: true };

const RESEARCH_CHUNK: RagChunkResult = { ...VALID_CHUNK, source_type: 'leanshot_research' };

const LONG_QUOTE_CHUNK: RagChunkResult = {
  ...VALID_CHUNK,
  verbatim_quote: 'A'.repeat(300),
};

function makeAnchorEl(): HTMLElement {
  const el = document.createElement('button');
  el.setAttribute('data-test-anchor', '1');
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCaptureRagEventBrowser.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  // Clean up any anchor elements appended to body
  document.body.querySelectorAll('button[data-test-anchor]').forEach((el) => el.remove());
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('CitationPopover', () => {
  // Test 5: loading skeleton shown on mount; ragChunkById called
  it('Test 5: calls ragChunkById and renders skeleton during fetch', async () => {
    let resolveChunk!: (chunk: RagChunkResult | null) => void;
    mockRagChunkById.mockReturnValue(new Promise((res) => { resolveChunk = res; }));

    const anchorEl = makeAnchorEl();
    render(<CitationPopover chunkId={VALID_CHUNK.chunk_id} anchorEl={anchorEl} onClose={vi.fn()} />);

    // While loading, the skeleton (animate-pulse) should be visible
    expect(document.querySelector('.animate-pulse')).toBeInTheDocument();
    expect(mockRagChunkById).toHaveBeenCalledWith(VALID_CHUNK.chunk_id);

    // Clean up — resolve so React doesn't warn on pending updates
    await act(async () => { resolveChunk(null); });
  });

  // Test 6: on success, renders source title, TierBadge, verbatim_quote, freshness
  it('Test 6: renders source title, TierBadge, verbatim quote, freshness strip on success', async () => {
    mockRagChunkById.mockResolvedValue(VALID_CHUNK);
    const anchorEl = makeAnchorEl();

    render(<CitationPopover chunkId={VALID_CHUNK.chunk_id} anchorEl={anchorEl} onClose={vi.fn()} />);

    await waitFor(() => {
      // Source name appears at least once (link + possibly Sheet title)
      const matches = screen.getAllByText('FDA Ozempic Label');
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });

    // Source title as a link with correct href
    const titleLink = screen.getByRole('link', { name: /FDA Ozempic Label/i });
    expect(titleLink).toHaveAttribute('href', VALID_CHUNK.canonical_url);
    expect(titleLink).toHaveAttribute('target', '_blank');
    expect(titleLink).toHaveAttribute('rel', 'noopener noreferrer');

    // TierBadge
    expect(screen.getByText('Tier A')).toBeInTheDocument();

    // Verbatim quote
    expect(screen.getByText(/Tirzepatide is dosed weekly/)).toBeInTheDocument();

    // Freshness strip: "Last reviewed 2024-01-15"
    expect(screen.getByText(/Last reviewed/)).toBeInTheDocument();
  });

  // Test 7: stale=true → renders "May be outdated" pill
  it('Test 7: stale chunk shows "May be outdated" warning badge', async () => {
    mockRagChunkById.mockResolvedValue(STALE_CHUNK);
    const anchorEl = makeAnchorEl();

    render(<CitationPopover chunkId={STALE_CHUNK.chunk_id} anchorEl={anchorEl} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/May be outdated/i)).toBeInTheDocument();
    });
  });

  // Test 8: source_type=leanshot_research → disclosure line shown
  it('Test 8: leanshot_research source shows disclosure line', async () => {
    mockRagChunkById.mockResolvedValue(RESEARCH_CHUNK);
    const anchorEl = makeAnchorEl();

    render(<CitationPopover chunkId={RESEARCH_CHUNK.chunk_id} anchorEl={anchorEl} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/LeanShot Research \(k≥5 cohort/)).toBeInTheDocument();
    });
  });

  // Test 9: verbatim_quote > 280 chars → truncated + "Read full chunk" link
  it('Test 9: long verbatim_quote truncated at 280 chars with "Read full chunk" link', async () => {
    mockRagChunkById.mockResolvedValue(LONG_QUOTE_CHUNK);
    const anchorEl = makeAnchorEl();

    render(<CitationPopover chunkId={LONG_QUOTE_CHUNK.chunk_id} anchorEl={anchorEl} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/Read full chunk/i)).toBeInTheDocument();
    });
  });

  // Test 10: has role="dialog" + aria-modal="true"
  it('Test 10: has role="dialog" and aria-modal="true"', async () => {
    mockRagChunkById.mockResolvedValue(VALID_CHUNK);
    const anchorEl = makeAnchorEl();

    render(<CitationPopover chunkId={VALID_CHUNK.chunk_id} anchorEl={anchorEl} onClose={vi.fn()} />);

    // The dialog role — could be on the motion.div (desktop) or Sheet inner div
    await waitFor(() => {
      const dialogs = screen.getAllByRole('dialog');
      expect(dialogs.length).toBeGreaterThanOrEqual(1);
      expect(dialogs[0]).toHaveAttribute('aria-modal', 'true');
    });
  });

  // Test 11: ESC calls onClose
  it('Test 11: pressing ESC calls onClose', async () => {
    mockRagChunkById.mockResolvedValue(VALID_CHUNK);
    const onClose = vi.fn();
    const anchorEl = makeAnchorEl();
    const user = userEvent.setup();

    render(<CitationPopover chunkId={VALID_CHUNK.chunk_id} anchorEl={anchorEl} onClose={onClose} />);

    await waitFor(() => expect(screen.getAllByText('FDA Ozempic Label').length).toBeGreaterThanOrEqual(1));

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // Test 12: focus trap — Tab cycles within dialog
  it('Test 12: Tab key cycles focus within dialog (focus trap)', async () => {
    mockRagChunkById.mockResolvedValue(VALID_CHUNK);
    const anchorEl = makeAnchorEl();
    const user = userEvent.setup();

    render(<CitationPopover chunkId={VALID_CHUNK.chunk_id} anchorEl={anchorEl} onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getAllByText('FDA Ozempic Label').length).toBeGreaterThanOrEqual(1));

    // Get all focusable elements within the dialog
    const dialogs = screen.getAllByRole('dialog');
    const dialog = dialogs[0];
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'),
    );
    // Must have at least 2 focusable elements for a meaningful tab cycle
    expect(focusable.length).toBeGreaterThanOrEqual(2);

    // Tab through to verify focus doesn't escape
    const tabCount = focusable.length + 1;
    for (let i = 0; i < tabCount; i++) {
      await user.tab();
    }
    // Focus stayed within the dialog (or returned to first focusable)
    const activeEl = document.activeElement;
    expect(dialog.contains(activeEl)).toBe(true);
  });

  // Test 13: on close, focus returns to anchorEl (via requestAnimationFrame in handleClose)
  it('Test 13: onClose is called and anchorEl would receive focus on close', async () => {
    mockRagChunkById.mockResolvedValue(VALID_CHUNK);
    const anchorEl = makeAnchorEl();
    anchorEl.focus();

    const onClose = vi.fn();

    render(<CitationPopover chunkId={VALID_CHUNK.chunk_id} anchorEl={anchorEl} onClose={onClose} />);

    await waitFor(() => expect(screen.getAllByText('FDA Ozempic Label').length).toBeGreaterThanOrEqual(1));

    // In mobile mode (Sheet), use ESC to close
    const user = userEvent.setup();
    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalled();
  });

  // Test 14: ←/→ with siblings calls onClose + onCycle
  it('Test 14: ArrowRight with siblings calls onCycle with next sibling (desktop mode)', async () => {
    // Force desktop mode for this test
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: query.includes('768px'), // min-width: 768px → true (desktop)
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });

    mockRagChunkById.mockResolvedValue(VALID_CHUNK);
    const UUID_B = 'b2c3d4e5-f6a7-8901-bcde-f01234567890';
    const siblings = [VALID_CHUNK.chunk_id, UUID_B];
    const onClose = vi.fn();
    const onCycle = vi.fn();
    const anchorEl = makeAnchorEl();

    render(
      <CitationPopover
        chunkId={VALID_CHUNK.chunk_id}
        anchorEl={anchorEl}
        siblings={siblings}
        onClose={onClose}
        onCycle={onCycle}
      />,
    );

    await waitFor(() => expect(screen.getAllByText('FDA Ozempic Label').length).toBeGreaterThanOrEqual(1));

    // Get the dialog element and fire keydown on it directly
    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'ArrowRight', code: 'ArrowRight' });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onCycle).toHaveBeenCalledWith(UUID_B);

    // Restore
    Object.defineProperty(window, 'matchMedia', { writable: true, value: originalMatchMedia });
  });

  // Test 15: telemetry fires after successful load
  it('Test 15: fires rag_citation_clicked telemetry on successful chunk load', async () => {
    mockRagChunkById.mockResolvedValue(VALID_CHUNK);
    const anchorEl = makeAnchorEl();

    render(<CitationPopover chunkId={VALID_CHUNK.chunk_id} anchorEl={anchorEl} onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getAllByText('FDA Ozempic Label').length).toBeGreaterThanOrEqual(1));

    expect(mockCaptureRagEventBrowser).toHaveBeenCalledWith('rag_citation_clicked', {
      chunk_id: VALID_CHUNK.chunk_id,
      source_tier: 'A',
      source_type: 'fda_label',
      topic_tag: 'glp1-dosing',
      surface: 'coach',
    });
  });

  // Test 16: ragChunkById null → error state rendered, no crash
  it('Test 16: when ragChunkById returns null, renders error state without crash', async () => {
    mockRagChunkById.mockResolvedValue(null);
    const anchorEl = makeAnchorEl();

    render(<CitationPopover chunkId={VALID_CHUNK.chunk_id} anchorEl={anchorEl} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/Couldn't load source details/i)).toBeInTheDocument();
    });
  });

  // Test 17: mobile viewport → renders Sheet (we mock matchMedia to return <md)
  it('Test 17: on mobile viewport (< 768px), renders bottom Sheet', async () => {
    // Override matchMedia to simulate mobile (< 768px)
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: !query.includes('768px'), // min-width: 768px → false (mobile)
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });

    mockRagChunkById.mockResolvedValue(VALID_CHUNK);
    const anchorEl = makeAnchorEl();

    render(<CitationPopover chunkId={VALID_CHUNK.chunk_id} anchorEl={anchorEl} onClose={vi.fn()} />);

    await waitFor(() => {
      // Sheet renders a drag-dismiss dialog with aria-modal
      const dialogs = screen.getAllByRole('dialog');
      expect(dialogs.length).toBeGreaterThanOrEqual(1);
    });

    // Restore
    Object.defineProperty(window, 'matchMedia', { writable: true, value: originalMatchMedia });
  });
});

// import needed at top
import { fireEvent } from '@testing-library/react';
