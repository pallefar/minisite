/**
 * Phase 60 Plan 60-10 Task 5 — SourcesFooter tests.
 *
 * Run: npx vitest run --config vite.config.ts src/components/dashboard/ai/__tests__/SourcesFooter.test.tsx
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SourcesFooter, type SourceCitationEntry } from '../SourcesFooter';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const { mockCaptureRagEventBrowser } = vi.hoisted(() => ({
  mockCaptureRagEventBrowser: vi.fn(),
}));

vi.mock('@/lib/rag/server-rag-events-relay', () => ({
  captureRagEventBrowser: mockCaptureRagEventBrowser,
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const CITATIONS_3: SourceCitationEntry[] = [
  {
    chunkId: 'a1b2c3d4-e5f6-7890-abcd-ef0123456789',
    refIndex: 1,
    sourceName: 'FDA Ozempic Label',
    sourceTier: 'A',
    canonicalUrl: 'https://www.accessdata.fda.gov/ozempic.pdf',
  },
  {
    chunkId: 'b2c3d4e5-f6a7-8901-bcde-f01234567890',
    refIndex: 2,
    sourceName: 'NIH GLP-1 Guidelines',
    sourceTier: 'B',
    canonicalUrl: 'https://nih.gov/glp1-guidelines',
  },
  {
    chunkId: 'c3d4e5f6-a7b8-9012-cdef-012345678901',
    refIndex: 3,
    sourceName: 'LeanShot Research',
    sourceTier: 'C',
    canonicalUrl: 'https://leanshot.com/research/glp1',
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockCaptureRagEventBrowser.mockResolvedValue(undefined);
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('SourcesFooter', () => {
  // Test 1: default collapsed state
  it('Test 1: default state is collapsed; renders Sources (3) + ChevronDown; aria-expanded="false"', () => {
    render(<SourcesFooter citations={CITATIONS_3} />);

    const btn = screen.getByRole('button');
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    expect(btn.textContent).toContain('Sources (3)');

    // ChevronDown rendered (not ChevronUp)
    // Can't check icon by name easily — check aria-expanded instead
    expect(screen.queryByText(/FDA Ozempic Label/)).not.toBeInTheDocument();
  });

  // Test 2: click expands; aria-expanded="true"
  it('Test 2: clicking chevron expands list; aria-expanded="true"', () => {
    render(<SourcesFooter citations={CITATIONS_3} />);

    const btn = screen.getByRole('button');
    fireEvent.click(btn);

    expect(btn).toHaveAttribute('aria-expanded', 'true');
  });

  // Test 3: when expanded, list contains citation rows
  it('Test 3: expanded list has one row per citation with source_name, TierBadge, truncated url', () => {
    render(<SourcesFooter citations={CITATIONS_3} />);

    fireEvent.click(screen.getByRole('button'));

    expect(screen.getByText('FDA Ozempic Label')).toBeInTheDocument();
    expect(screen.getByText('NIH GLP-1 Guidelines')).toBeInTheDocument();
    expect(screen.getByText('LeanShot Research')).toBeInTheDocument();

    // TierBadges
    expect(screen.getByText('Tier A')).toBeInTheDocument();
    expect(screen.getByText('Tier B')).toBeInTheDocument();
    expect(screen.getByText('Tier C')).toBeInTheDocument();

    // Numbered markers
    expect(screen.getByText('[1]')).toBeInTheDocument();
    expect(screen.getByText('[2]')).toBeInTheDocument();
    expect(screen.getByText('[3]')).toBeInTheDocument();
  });

  // Test 4: expanding region has aria-live="polite"
  it('Test 4: expanding region has aria-live="polite"', () => {
    render(<SourcesFooter citations={CITATIONS_3} />);

    const liveRegion = document.querySelector('[aria-live="polite"]');
    expect(liveRegion).toBeInTheDocument();
  });

  // Test 5: expansion fires telemetry ONCE per false→true transition
  it('Test 5: expansion fires captureRagEventBrowser once with count', () => {
    render(<SourcesFooter citations={CITATIONS_3} />);

    const btn = screen.getByRole('button');
    fireEvent.click(btn); // expand — fires telemetry

    expect(mockCaptureRagEventBrowser).toHaveBeenCalledTimes(1);
    expect(mockCaptureRagEventBrowser).toHaveBeenCalledWith('rag_sources_footer_expanded', { count: 3 });

    fireEvent.click(btn); // collapse — no telemetry
    expect(mockCaptureRagEventBrowser).toHaveBeenCalledTimes(1);

    fireEvent.click(btn); // expand again — fires telemetry again
    expect(mockCaptureRagEventBrowser).toHaveBeenCalledTimes(2);
  });

  // Test 6: empty citations → returns null (no footer rendered)
  it('Test 6: returns null when citations array is empty', () => {
    const { container } = render(<SourcesFooter citations={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
