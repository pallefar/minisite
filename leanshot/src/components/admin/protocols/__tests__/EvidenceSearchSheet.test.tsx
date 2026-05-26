/**
 * Phase 61 Plan 61-05 — EvidenceSearchSheet unit tests.
 *
 * 4 behavior assertions:
 *  T1 — renders with open=true, input present
 *  T2 — search returns 3 chunks, all rendered
 *  T3 — check 2 items, Attach 2 sources button enabled; click Attach calls insert
 *  T4 — empty results: EmptyState rendered after search with no results
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EvidenceSearchSheet } from '../EvidenceSearchSheet';

// ─── Mock supabase ────────────────────────────────────────────────────────────

const mockInsert = vi.fn();
let mockInvokeData: unknown = null;
let mockInvokeError: unknown = null;

vi.mock('@/lib/supabase', () => ({
  supabase: {
    functions: {
      invoke: vi.fn(async () => ({
        data: mockInvokeData,
        error: mockInvokeError,
      })),
    },
    from: (table: string) => {
      if (table === 'protocol_evidence') {
        return {
          insert: mockInsert,
        };
      }
      return {};
    },
  },
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const MOCK_CHUNKS = [
  { chunk_id: 'c1', title: 'Tirzepatide dosing study', text: 'Week 1: 2.5mg starting dose...', tier: 'A' as const },
  { chunk_id: 'c2', title: 'GLP-1 monitoring protocol', text: 'Monitor glucose weekly for first 4 weeks...', tier: 'B' as const },
  { chunk_id: 'c3', title: 'Safety review data', text: 'GI side effects observed in 30% of patients...', tier: 'C' as const },
];

describe('EvidenceSearchSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvokeData = { chunks: MOCK_CHUNKS };
    mockInvokeError = null;
    mockInsert.mockResolvedValue({ error: null });
  });

  it('T1 — renders with open=true, search input is present', () => {
    render(
      <EvidenceSearchSheet
        open={true}
        onClose={vi.fn()}
        protocolId="proto-1"
        stepId="step-1"
        onAttached={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('Search evidence query')).toBeTruthy();
  });

  it('T2 — search returns 3 chunks, all rendered in results list', async () => {
    render(
      <EvidenceSearchSheet
        open={true}
        onClose={vi.fn()}
        protocolId="proto-1"
        stepId="step-1"
        onAttached={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('Search evidence query'), {
      target: { value: 'tirzepatide dose' },
    });
    fireEvent.click(screen.getByText('Search'));

    await waitFor(() => {
      expect(screen.getByText('Tirzepatide dosing study')).toBeTruthy();
      expect(screen.getByText('GLP-1 monitoring protocol')).toBeTruthy();
      expect(screen.getByText('Safety review data')).toBeTruthy();
    });
  });

  it('T3 — check 2 items → Attach 2 sources button; click calls insert + onAttached', async () => {
    const onAttached = vi.fn();
    const onClose = vi.fn();

    render(
      <EvidenceSearchSheet
        open={true}
        onClose={onClose}
        protocolId="proto-1"
        stepId="step-1"
        onAttached={onAttached}
      />,
    );

    // Search first
    fireEvent.change(screen.getByLabelText('Search evidence query'), {
      target: { value: 'dosing' },
    });
    fireEvent.click(screen.getByText('Search'));

    await waitFor(() => {
      expect(screen.getByText('Tirzepatide dosing study')).toBeTruthy();
    });

    // Check 2 checkboxes
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]!);
    fireEvent.click(checkboxes[1]!);

    // Button should now say "Attach 2 sources"
    await waitFor(() => {
      expect(screen.getByText('Attach 2 sources')).toBeTruthy();
    });

    // Click Attach
    fireEvent.click(screen.getByText('Attach 2 sources'));

    await waitFor(() => {
      expect(mockInsert).toHaveBeenCalledOnce();
      // Insert called with 2 rows
      const insertArg = mockInsert.mock.calls[0]?.[0] as unknown[];
      expect(Array.isArray(insertArg)).toBe(true);
      expect(insertArg.length).toBe(2);
      expect(onAttached).toHaveBeenCalledWith(2);
      expect(onClose).toHaveBeenCalledOnce();
    });
  });

  it('T4 — empty results after search: EmptyState rendered', async () => {
    mockInvokeData = { chunks: [] };

    render(
      <EvidenceSearchSheet
        open={true}
        onClose={vi.fn()}
        protocolId="proto-1"
        stepId="step-1"
        onAttached={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('Search evidence query'), {
      target: { value: 'nonexistent term' },
    });
    fireEvent.click(screen.getByText('Search'));

    await waitFor(() => {
      expect(screen.getByText('No evidence found')).toBeTruthy();
    });
  });
});
