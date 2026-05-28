/**
 * Phase 30 Plan 02 — ClinicDoseTrendThresholdsForm tests.
 *
 * Covers all 4 behavior tests from the plan.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClinicDoseTrendThresholdsForm } from './ClinicDoseTrendThresholdsForm';

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

// Mock store
vi.mock('@/lib/store', () => ({
  useStore: (selector: (s: unknown) => unknown) => {
    const state = { currentOrgRole: 'owner' };
    return selector(state);
  },
}));

const ORG_ID = 'org-test-456';

describe('ClinicDoseTrendThresholdsForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRpc.mockResolvedValue({ data: null, error: null });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Test 1: renders 3 inputs with correct placeholder defaults', () => {
    render(<ClinicDoseTrendThresholdsForm orgId={ORG_ID} />);

    const nInput = screen.getByLabelText(/missed doses/i);
    const mInput = screen.getByLabelText(/observation window/i);
    const xInput = screen.getByLabelText(/interval variance/i);

    expect(nInput).toHaveAttribute('placeholder', '2');
    expect(mInput).toHaveAttribute('placeholder', '14');
    expect(xInput).toHaveAttribute('placeholder', '25');
  });

  it('Test 2: inputs respect min/max constraints', () => {
    render(<ClinicDoseTrendThresholdsForm orgId={ORG_ID} />);

    const nInput = screen.getByLabelText(/missed doses/i);
    const mInput = screen.getByLabelText(/observation window/i);
    const xInput = screen.getByLabelText(/interval variance/i);

    expect(nInput).toHaveAttribute('min', '1');
    expect(nInput).toHaveAttribute('max', '30');
    expect(mInput).toHaveAttribute('min', '7');
    expect(mInput).toHaveAttribute('max', '90');
    expect(xInput).toHaveAttribute('min', '5');
    expect(xInput).toHaveAttribute('max', '100');
  });

  it('Test 3: Save calls supabase.rpc with correct payload', async () => {
    const user = userEvent.setup();
    render(<ClinicDoseTrendThresholdsForm orgId={ORG_ID} />);

    const nInput = screen.getByLabelText(/missed doses/i);
    const mInput = screen.getByLabelText(/observation window/i);
    const xInput = screen.getByLabelText(/interval variance/i);

    await user.clear(nInput);
    await user.type(nInput, '3');
    await user.clear(mInput);
    await user.type(mInput, '21');
    await user.clear(xInput);
    await user.type(xInput, '30');

    const saveBtn = screen.getByRole('button', { name: /save thresholds/i });
    await user.click(saveBtn);

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('update_org_dose_trend_thresholds', {
        p_org_id: ORG_ID,
        p_thresholds: {
          missed_doses_n: 3,
          window_days_m: 21,
          variance_pct_x: 30,
        },
      });
    });
  });

  it('Test 4: success toast shown on save', async () => {
    const user = userEvent.setup();
    render(<ClinicDoseTrendThresholdsForm orgId={ORG_ID} />);

    const nInput = screen.getByLabelText(/missed doses/i);
    await user.clear(nInput);
    await user.type(nInput, '2');

    const mInput = screen.getByLabelText(/observation window/i);
    await user.clear(mInput);
    await user.type(mInput, '14');

    const xInput = screen.getByLabelText(/interval variance/i);
    await user.clear(xInput);
    await user.type(xInput, '25');

    const saveBtn = screen.getByRole('button', { name: /save thresholds/i });
    await user.click(saveBtn);

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        'Alert thresholds saved. New alerts will use these thresholds.',
        'success',
      );
    });
  });
});
