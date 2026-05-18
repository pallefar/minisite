/**
 * Phase 30 Plan 02 — ClinicRankingWeightsForm tests.
 *
 * Covers all 7 behavior tests from the plan.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Use vi.hoisted to avoid hoisting issues with vi.mock factory referencing local vars
const { mockRpc, mockToast } = vi.hoisted(() => {
  const mockRpc = vi.fn();
  const mockToast = vi.fn();
  return { mockRpc, mockToast };
});

// Mock supabase
vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: mockRpc,
  },
}));

// Mock useToast
vi.mock('@/hooks/useToast', () => ({
  useToast: () => mockToast,
}));

// Mock store for currentOrgRole
vi.mock('@/lib/store', () => ({
  useStore: (selector: (s: unknown) => unknown) => {
    const state = { currentOrgRole: 'owner' };
    return selector(state);
  },
}));

import { ClinicRankingWeightsForm } from './ClinicRankingWeightsForm';

const ORG_ID = 'org-test-123';

describe('ClinicRankingWeightsForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRpc.mockResolvedValue({ data: null, error: null });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Test 1: renders with 4 inputs defaulting to 25 when ranking_weights is null', () => {
    render(<ClinicRankingWeightsForm orgId={ORG_ID} />);

    expect(screen.getByLabelText('Dose adherence weight')).toBeInTheDocument();
    expect(screen.getByLabelText('Weight loss weight')).toBeInTheDocument();
    expect(screen.getByLabelText('Activity weight')).toBeInTheDocument();
    expect(screen.getByLabelText('Symptoms weight')).toBeInTheDocument();

    // All default to 25
    const inputs = screen.getAllByRole('spinbutton');
    expect(inputs).toHaveLength(4);
    inputs.forEach((input) => {
      expect((input as HTMLInputElement).value).toBe('25');
    });
  });

  it('Test 2: values summing to 100 enables Save and shows ready message', async () => {
    const user = userEvent.setup();
    render(<ClinicRankingWeightsForm orgId={ORG_ID} />);

    // Default is 25+25+25+25=100, Save should be enabled
    const saveBtn = screen.getByRole('button', { name: /save ranking weights/i });
    expect(saveBtn).not.toBeDisabled();

    const statusEl = screen.getByRole('status');
    expect(statusEl).toHaveTextContent('Total: 100%');
    expect(statusEl).toHaveTextContent('ready to save');
  });

  it('Test 3: values summing to 90 disables Save and shows must equal 100 message', async () => {
    const user = userEvent.setup();
    render(<ClinicRankingWeightsForm orgId={ORG_ID} />);

    const inputs = screen.getAllByRole('spinbutton');
    // Set first input to 15 (15+25+25+25=90)
    await user.clear(inputs[0]);
    await user.type(inputs[0], '15');

    const saveBtn = screen.getByRole('button', { name: /save ranking weights/i });
    expect(saveBtn).toBeDisabled();

    const statusEl = screen.getByRole('status');
    expect(statusEl).toHaveTextContent('Total: 90%');
    expect(statusEl).toHaveTextContent('must equal 100%');
  });

  it('Test 4: clicking Save calls supabase.rpc with correct payload and shows success toast', async () => {
    const user = userEvent.setup();
    render(<ClinicRankingWeightsForm orgId={ORG_ID} />);

    // Default weights: 25/25/25/25 → sum=100
    const saveBtn = screen.getByRole('button', { name: /save ranking weights/i });
    await user.click(saveBtn);

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('update_org_ranking_weights', {
        p_org_id: ORG_ID,
        p_weights: {
          dose_adherence: 0.25,
          weight_loss: 0.25,
          activity: 0.25,
          symptoms: 0.25,
        },
      });
    });

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        'Ranking weights saved. Roster will reorder shortly.',
        'success',
      );
    });
  });

  it('Test 5: on RPC error shows error toast', async () => {
    const user = userEvent.setup();
    mockRpc.mockResolvedValue({ data: null, error: { message: 'permission denied' } });
    render(<ClinicRankingWeightsForm orgId={ORG_ID} />);

    const saveBtn = screen.getByRole('button', { name: /save ranking weights/i });
    await user.click(saveBtn);

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        'Save failed — please try again.',
        'error',
      );
    });
  });

  it('Test 6: clicking Reset to equal weights resets all inputs to 25', async () => {
    const user = userEvent.setup();
    render(<ClinicRankingWeightsForm orgId={ORG_ID} />);

    const inputs = screen.getAllByRole('spinbutton');
    // Change first input
    await user.clear(inputs[0]);
    await user.type(inputs[0], '50');

    // Click reset
    const resetLink = screen.getByText(/reset to equal weights/i);
    await user.click(resetLink);

    // All back to 25
    const updatedInputs = screen.getAllByRole('spinbutton');
    updatedInputs.forEach((input) => {
      expect((input as HTMLInputElement).value).toBe('25');
    });
  });

  it('Test 7: blur auto-normalizes inputs proportionally to sum to 100', async () => {
    const user = userEvent.setup();
    render(<ClinicRankingWeightsForm orgId={ORG_ID} />);

    const inputs = screen.getAllByRole('spinbutton');
    // Set values to 40/30/30/30 = sum 130
    await user.clear(inputs[0]);
    await user.type(inputs[0], '40');
    await user.clear(inputs[1]);
    await user.type(inputs[1], '30');
    await user.clear(inputs[2]);
    await user.type(inputs[2], '30');
    await user.clear(inputs[3]);
    await user.type(inputs[3], '30');

    // Blur to trigger normalization
    fireEvent.blur(inputs[3]);

    // After normalization, sum should be 100
    await waitFor(() => {
      const updatedInputs = screen.getAllByRole('spinbutton');
      const values = updatedInputs.map((inp) => parseInt((inp as HTMLInputElement).value, 10));
      const sum = values.reduce((a, b) => a + b, 0);
      expect(sum).toBe(100);
    });
  });
});
