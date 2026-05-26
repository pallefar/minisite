/**
 * Phase 62 Plan 62-04 Task 2 — CohortBuilderPage unit tests (TDD RED).
 *
 * Tests for empty state, suppressed banner, and basic rendering.
 * Uses @testing-library/react with vitest globals.
 */
import React from 'react';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { CohortBuilderPage } from '../CohortBuilderPage';

// Mock CohortBuilderForm to avoid deep dependency chain in unit tests
vi.mock('../CohortBuilderForm', () => ({
  CohortBuilderForm: ({ onResult }: { onResult: (r: unknown) => void }) => (
    <button onClick={() => onResult({ suppressed: true, reason: 'k_floor', k: 3 })}>
      MockRunCohort
    </button>
  ),
}));

// Mock RetentionChart
vi.mock('../RetentionChart', () => ({
  RetentionChart: () => <div data-testid="retention-chart" />,
}));

// Mock CrossTabMatrix
vi.mock('../CrossTabMatrix', () => ({
  CrossTabMatrix: () => <div data-testid="cross-tab-matrix" />,
}));

// Mock supabase
vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: vi.fn() },
}));

// Mock useToast
vi.mock('@/hooks/useToast', () => ({
  useToast: () => vi.fn(),
}));

describe('CohortBuilderPage', () => {
  it('renders empty state when result is null', () => {
    render(<CohortBuilderPage />);
    expect(screen.getByText(/Run a cohort to see retention curves/i)).toBeInTheDocument();
  });

  it('renders suppressed banner when result.suppressed', async () => {
    render(<CohortBuilderPage />);
    const runBtn = screen.getByText('MockRunCohort');
    runBtn.click();
    expect(
      await screen.findByText(/Cohort suppressed — k<5 at the selected filters/i),
    ).toBeInTheDocument();
  });

  it('import-graph smoke: CohortBuilderPage renders without crashing', () => {
    const { container } = render(<CohortBuilderPage />);
    expect(container).toBeTruthy();
  });
});
