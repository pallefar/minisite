/**
 * Phase 30 Plan 04 — PatientThresholdOverrideForm tests (TDD RED phase).
 *
 * 8 behavior tests + 1 role-gate test in ClinicDrillInPage context (W13).
 *
 * Test 1: form renders 3 inputs with placeholders showing clinic defaults
 * Test 2: no override → inputs empty; Save dispatches set_patient_dose_thresholds
 * Test 3: existing override → inputs prefill with override values
 * Test 4: 'Reset to clinic defaults' opens modal with title + patient name
 * Test 5: modal has 'Reset to defaults' (danger) + 'Keep current thresholds' (secondary) buttons
 * Test 6: clicking 'Reset to defaults' dispatches reset SECDEF + toast + closes modal
 * Test 7: clicking 'Keep current thresholds' closes modal WITHOUT calling reset SECDEF
 * Test 8: input min/max constraints (N: 1-30, M: 7-90, X: 5-100)
 * Test 9: (W13 role gate) viewer role cannot see 'Dose thresholds' tab in ClinicDrillInPage
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock supabase
// ---------------------------------------------------------------------------

const mockRpc = vi.fn().mockResolvedValue({ data: null, error: null });
const mockMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
const mockEq = vi.fn().mockReturnValue({ maybeSingle: mockMaybeSingle });
const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: mockRpc,
    from: mockFrom,
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'tok' } } }),
    },
  },
}));

// ---------------------------------------------------------------------------
// Mock useToast
// ---------------------------------------------------------------------------

const mockToast = vi.fn();
vi.mock('@/hooks/useToast', () => ({
  useToast: () => mockToast,
}));

// ---------------------------------------------------------------------------
// Test props
// ---------------------------------------------------------------------------

const defaultProps = {
  orgId: 'org-123',
  patientUserId: 'patient-456',
  patientDisplayName: 'Sarah K.',
  clinicDefaults: { missed_doses_n: 2, window_days_m: 14, variance_pct_x: 25 },
  existingOverride: null,
};

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('PatientThresholdOverrideForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRpc.mockResolvedValue({ data: null, error: null });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('Test 1: form renders 3 inputs with placeholders showing clinic defaults', async () => {
    const { PatientThresholdOverrideForm } = await import('./PatientThresholdOverrideForm');
    render(<PatientThresholdOverrideForm {...defaultProps} />);

    const nInput = screen.getByLabelText(/Missed doses/i);
    const mInput = screen.getByLabelText(/Observation window/i);
    const xInput = screen.getByLabelText(/Interval variance/i);

    expect(nInput).toBeDefined();
    expect(mInput).toBeDefined();
    expect(xInput).toBeDefined();
    expect(nInput.getAttribute('placeholder')).toBe('2');
    expect(mInput.getAttribute('placeholder')).toBe('14');
    expect(xInput.getAttribute('placeholder')).toBe('25');
  });

  it('Test 2: no override → inputs empty; Save dispatches set_patient_dose_thresholds + success toast', async () => {
    const { PatientThresholdOverrideForm } = await import('./PatientThresholdOverrideForm');
    render(<PatientThresholdOverrideForm {...defaultProps} existingOverride={null} />);

    const nInput = screen.getByLabelText(/Missed doses/i);
    const mInput = screen.getByLabelText(/Observation window/i);
    const xInput = screen.getByLabelText(/Interval variance/i);

    // Inputs empty (no override)
    expect((nInput as HTMLInputElement).value).toBe('');
    expect((mInput as HTMLInputElement).value).toBe('');
    expect((xInput as HTMLInputElement).value).toBe('');

    // Fill in values
    fireEvent.change(nInput, { target: { value: '3' } });
    fireEvent.change(mInput, { target: { value: '21' } });
    fireEvent.change(xInput, { target: { value: '30' } });

    // Click Save
    const saveBtn = screen.getByRole('button', { name: /Save patient thresholds/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('set_patient_dose_thresholds', {
        p_org_id: 'org-123',
        p_patient_user_id: 'patient-456',
        p_thresholds: { missed_doses_n: 3, window_days_m: 21, variance_pct_x: 30 },
      });
    });

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith('Patient thresholds saved.', 'success');
    });
  });

  it('Test 3: existing override → inputs prefill with override values', async () => {
    const { PatientThresholdOverrideForm } = await import('./PatientThresholdOverrideForm');
    render(
      <PatientThresholdOverrideForm
        {...defaultProps}
        existingOverride={{ missed_doses_n: 5, window_days_m: 30, variance_pct_x: 40 }}
      />,
    );

    const nInput = screen.getByLabelText(/Missed doses/i) as HTMLInputElement;
    const mInput = screen.getByLabelText(/Observation window/i) as HTMLInputElement;
    const xInput = screen.getByLabelText(/Interval variance/i) as HTMLInputElement;

    expect(nInput.value).toBe('5');
    expect(mInput.value).toBe('30');
    expect(xInput.value).toBe('40');
  });

  it("Test 4: 'Reset to clinic defaults' button opens modal with title and patient name", async () => {
    const { PatientThresholdOverrideForm } = await import('./PatientThresholdOverrideForm');
    render(<PatientThresholdOverrideForm {...defaultProps} patientDisplayName="Sarah K." />);

    const resetBtn = screen.getByRole('button', { name: /Reset to clinic defaults/i });
    fireEvent.click(resetBtn);

    await waitFor(() => {
      expect(screen.getByText('Reset patient thresholds')).toBeDefined();
    });

    // Body should contain patient display name
    expect(screen.getByText(/Sarah K\./)).toBeDefined();
  });

  it("Test 5: modal has 'Reset to defaults' (danger) + 'Keep current thresholds' (secondary) buttons", async () => {
    const { PatientThresholdOverrideForm } = await import('./PatientThresholdOverrideForm');
    render(<PatientThresholdOverrideForm {...defaultProps} />);

    const resetBtn = screen.getByRole('button', { name: /Reset to clinic defaults/i });
    fireEvent.click(resetBtn);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Reset to defaults/i })).toBeDefined();
      expect(screen.getByRole('button', { name: /Keep current thresholds/i })).toBeDefined();
    });
  });

  it("Test 6: clicking 'Reset to defaults' dispatches reset_patient_dose_thresholds + toast + closes modal", async () => {
    const { PatientThresholdOverrideForm } = await import('./PatientThresholdOverrideForm');
    render(<PatientThresholdOverrideForm {...defaultProps} />);

    // Open modal
    const resetBtn = screen.getByRole('button', { name: /Reset to clinic defaults/i });
    fireEvent.click(resetBtn);

    await waitFor(() => {
      expect(screen.getByText('Reset patient thresholds')).toBeDefined();
    });

    // Click confirm
    const confirmBtn = screen.getByRole('button', { name: /Reset to defaults/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('reset_patient_dose_thresholds', {
        p_org_id: 'org-123',
        p_patient_user_id: 'patient-456',
      });
    });

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith('Thresholds reset to clinic defaults.', 'success');
    });

    // Modal should close
    await waitFor(() => {
      expect(screen.queryByText('Reset patient thresholds')).toBeNull();
    });
  });

  it("Test 7: clicking 'Keep current thresholds' closes modal WITHOUT calling reset SECDEF", async () => {
    const { PatientThresholdOverrideForm } = await import('./PatientThresholdOverrideForm');
    render(<PatientThresholdOverrideForm {...defaultProps} />);

    // Open modal
    fireEvent.click(screen.getByRole('button', { name: /Reset to clinic defaults/i }));

    await waitFor(() => {
      expect(screen.getByText('Reset patient thresholds')).toBeDefined();
    });

    // Click Keep current thresholds
    fireEvent.click(screen.getByRole('button', { name: /Keep current thresholds/i }));

    await waitFor(() => {
      expect(screen.queryByText('Reset patient thresholds')).toBeNull();
    });

    // Reset SECDEF must NOT have been called
    expect(mockRpc).not.toHaveBeenCalledWith(
      'reset_patient_dose_thresholds',
      expect.anything(),
    );
  });

  it('Test 8: inputs have min/max constraints (N: 1-30, M: 7-90, X: 5-100)', async () => {
    const { PatientThresholdOverrideForm } = await import('./PatientThresholdOverrideForm');
    render(<PatientThresholdOverrideForm {...defaultProps} />);

    const nInput = screen.getByLabelText(/Missed doses/i) as HTMLInputElement;
    const mInput = screen.getByLabelText(/Observation window/i) as HTMLInputElement;
    const xInput = screen.getByLabelText(/Interval variance/i) as HTMLInputElement;

    expect(nInput.getAttribute('min')).toBe('1');
    expect(nInput.getAttribute('max')).toBe('30');
    expect(mInput.getAttribute('min')).toBe('7');
    expect(mInput.getAttribute('max')).toBe('90');
    expect(xInput.getAttribute('min')).toBe('5');
    expect(xInput.getAttribute('max')).toBe('100');
  });
});

// ---------------------------------------------------------------------------
// Test 9: W13 role gate — ClinicDrillInPage with viewer role
// ---------------------------------------------------------------------------

describe('ClinicDrillInPage — role gate for Dose thresholds tab', () => {
  it('Test 9: viewer role cannot see the Dose thresholds tab', async () => {
    // Mock supabase.from — fully chainable: select().eq().eq().maybeSingle()
    const maybeSingleFn = vi.fn().mockResolvedValue({
      data: { id: 'org-1', slug: 'test-org', name: 'Test Org' },
      error: null,
    });
    const eqInner = vi.fn().mockReturnValue({ maybeSingle: maybeSingleFn });
    const eqOuter = vi.fn().mockReturnValue({ eq: eqInner, maybeSingle: maybeSingleFn });
    const selectFn = vi.fn().mockReturnValue({ eq: eqOuter, maybeSingle: maybeSingleFn });
    mockFrom.mockReturnValue({ select: selectFn });

    // Simulate viewer role in org_members
    mockRpc.mockImplementation((fnName: string) => {
      if (fnName === 'get_clinic_snapshot') {
        return Promise.resolve({ data: null, error: null });
      }
      if (fnName === 'get_member_role') {
        return Promise.resolve({ data: [{ role: 'staff' }], error: null }); // 'staff' = old 'viewer' after P31-00 rename
      }
      return Promise.resolve({ data: null, error: null });
    });

    // Mock window.location for slug parsing
    Object.defineProperty(window, 'location', {
      value: { pathname: '/clinic/test-org/patient/patient-789' },
      writable: true,
    });

    const { ClinicDrillInPage } = await import('./ClinicDrillInPage');

    render(<ClinicDrillInPage />);

    // The 'Dose thresholds' tab should NOT be visible for viewers
    // Allow time for async data loading
    await new Promise((r) => setTimeout(r, 100));

    expect(screen.queryByText('Dose thresholds')).toBeNull();
  });
});
