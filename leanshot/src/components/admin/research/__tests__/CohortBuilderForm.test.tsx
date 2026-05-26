/**
 * Phase 62 Plan 62-04 Task 1 — CohortBuilderForm unit tests (TDD GREEN).
 *
 * Tests for k_floor sentinel UX, estimate display, and Run Cohort wiring.
 * Uses @testing-library/react with vitest globals.
 */
import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CohortBuilderForm } from '../CohortBuilderForm';

// Mock supabase client
vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
  },
}));

// Mock useToast
vi.mock('@/hooks/useToast', () => ({
  useToast: () => vi.fn(),
}));

import { supabase } from '@/lib/supabase';
const mockRpc = supabase.rpc as ReturnType<typeof vi.fn>;

describe('CohortBuilderForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: estimate_research_cohort returns below_floor=false, cohort_size=47
    mockRpc.mockImplementation((fn: string) => {
      if (fn === 'estimate_research_cohort') {
        return Promise.resolve({
          data: { cohort_size: 47, below_floor: false },
          error: null,
        });
      }
      if (fn === 'compile_research_cohort') {
        return Promise.resolve({
          data: { suppressed: false, cohort_size: 47, epsilon: 1.0, suppressed_buckets: 0, metric: 'weight_change', data: [] },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });
  });

  it('renders k_floor warning when estimatedCohortSize is 3', async () => {
    mockRpc.mockImplementation((fn: string) => {
      if (fn === 'estimate_research_cohort') {
        return Promise.resolve({
          data: { cohort_size: 3, below_floor: true },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });

    const onResult = vi.fn();
    render(<CohortBuilderForm onResult={onResult} />);

    // Trigger debounced estimate by changing outcome metric select
    const outcomeSelect = screen.getByRole('combobox', { name: /outcome metric/i });
    fireEvent.change(outcomeSelect, { target: { value: 'dose_adherence' } });

    await waitFor(
      () => {
        expect(screen.getByText(/Cohort too small \(k<5\) — broaden filters/i)).toBeInTheDocument();
      },
      { timeout: 1000 },
    );
  });

  it('renders cohort size + epsilon when estimatedCohortSize is 47', async () => {
    const onResult = vi.fn();
    render(<CohortBuilderForm onResult={onResult} />);

    const outcomeSelect = screen.getByRole('combobox', { name: /outcome metric/i });
    fireEvent.change(outcomeSelect, { target: { value: 'dose_adherence' } });

    await waitFor(
      () => {
        expect(screen.getByText(/Estimated cohort: 47 users/i)).toBeInTheDocument();
        expect(screen.getByText(/epsilon = 1\.0 \(admin output\)/i)).toBeInTheDocument();
      },
      { timeout: 1000 },
    );
  });

  it('Run Cohort button is aria-disabled when below k_floor', async () => {
    mockRpc.mockImplementation((fn: string) => {
      if (fn === 'estimate_research_cohort') {
        return Promise.resolve({
          data: { cohort_size: 3, below_floor: true },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    });

    const onResult = vi.fn();
    render(<CohortBuilderForm onResult={onResult} />);

    const outcomeSelect = screen.getByRole('combobox', { name: /outcome metric/i });
    fireEvent.change(outcomeSelect, { target: { value: 'retention_30d' } });

    await waitFor(
      () => {
        const runBtn = screen.getByRole('button', { name: /run cohort/i });
        expect(runBtn).toHaveAttribute('aria-disabled', 'true');
      },
      { timeout: 1000 },
    );
  });

  it('calls compile_research_cohort on Run Cohort click', async () => {
    const onResult = vi.fn();
    render(<CohortBuilderForm onResult={onResult} />);

    // Wait for initial estimate to load (default 47 users)
    const outcomeSelect = screen.getByRole('combobox', { name: /outcome metric/i });
    fireEvent.change(outcomeSelect, { target: { value: 'weight_change' } });

    await waitFor(
      () => {
        expect(screen.getByText(/Estimated cohort: 47 users/i)).toBeInTheDocument();
      },
      { timeout: 1000 },
    );

    const runBtn = screen.getByRole('button', { name: /run cohort/i });
    fireEvent.click(runBtn);

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith(
        'compile_research_cohort',
        expect.objectContaining({ p_filters: expect.any(Object) }),
      );
      expect(onResult).toHaveBeenCalled();
    });
  });
});
