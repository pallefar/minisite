/**
 * Phase 61 Plan 61-06 — AdoptDiffModal unit tests.
 *
 * Run with:
 *   npx vitest run --config vite.config.ts src/components/clinic/protocols/__tests__/AdoptDiffModal.test.tsx
 */

import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdoptDiffModal } from '../AdoptDiffModal';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockRpc, mockFrom, mockShowToast } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
  mockFrom: vi.fn(),
  mockShowToast: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: mockRpc,
    from: mockFrom,
  },
}));

// Mock useToast directly — the hook calls useStore.getState() which is not
// a standard Zustand API we mock via the store mock.
vi.mock('@/hooks/useToast', () => ({
  useToast: () => mockShowToast,
}));

// Mock framer-motion to avoid animation complexity
vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
      <div {...props}>{children}</div>
    ),
  },
  useDragControls: () => ({ start: vi.fn() }),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROTOCOL = {
  id: 'proto-1',
  version: 1,
  name: 'Tirzepatide 12-Week',
  compound: 'tirzepatide',
};

const PROTOCOL_STEPS = [
  { week: 1, dose_mg: 2.5, frequency: 'weekly', monitoring: ['weight'] },
  { week: 2, dose_mg: 5.0, frequency: 'weekly', monitoring: ['weight', 'glucose'] },
  { week: 3, dose_mg: 7.5, frequency: 'weekly', monitoring: ['weight'] },
];

const PATIENT_INJECTIONS = [
  { week_number: 1, dose_mg: 2.5 }, // matches
  { week_number: 2, dose_mg: 4.0 }, // differs — triggers warning
];

// Build chainable supabase mock
function makeFromChain(data: unknown) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data, error: null }),
  };
  // For protocol_steps, limit isn't called — order resolves directly
  chain.order = vi.fn().mockImplementation(() => {
    // Check if we're building the protocol_steps query (no .limit()) or injections (has .limit())
    return {
      ...chain,
      // Resolve directly when called without .limit()
      then: (resolve: (val: unknown) => void) => resolve({ data, error: null }),
      limit: vi.fn().mockResolvedValue({ data, error: null }),
    };
  });
  return chain;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let fromCallCount = 0;

beforeEach(() => {
  vi.clearAllMocks();
  fromCallCount = 0;

  // First call: protocol_steps; Second call: injections
  mockFrom.mockImplementation(() => {
    fromCallCount++;
    if (fromCallCount === 1) {
      // protocol_steps chain — resolves at .order()
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: PROTOCOL_STEPS, error: null }),
      };
    } else {
      // injections chain — resolves at .limit()
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: PATIENT_INJECTIONS, error: null }),
      };
    }
  });

  mockRpc.mockResolvedValue({ data: null, error: null });
});

describe('AdoptDiffModal', () => {
  it('Test 1: renders modal headers "Current schedule" and "Protocol expectation"', async () => {
    render(
      <AdoptDiffModal
        open={true}
        onClose={vi.fn()}
        onConfirmed={vi.fn()}
        patientId="patient-1"
        patientName="Alice Smith"
        protocol={PROTOCOL}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Current schedule')).toBeTruthy();
      expect(screen.getByText('Protocol expectation')).toBeTruthy();
    });
  });

  it('Test 2: renders diff rows with warning color when doses differ', async () => {
    const { container } = render(
      <AdoptDiffModal
        open={true}
        onClose={vi.fn()}
        onConfirmed={vi.fn()}
        patientId="patient-1"
        patientName="Alice Smith"
        protocol={PROTOCOL}
      />,
    );

    await waitFor(() => {
      // Week 2 patient dose (4.0) differs from protocol dose (5.0)
      // The warning-colored spans should exist
      const warningSpans = container.querySelectorAll('[class*="color-warning"]');
      expect(warningSpans.length).toBeGreaterThan(0);
    });
  });

  it('Test 3: "Assign to patient" calls RPC with correct args', async () => {
    const user = userEvent.setup();
    render(
      <AdoptDiffModal
        open={true}
        onClose={vi.fn()}
        onConfirmed={vi.fn()}
        patientId="patient-1"
        patientName="Alice Smith"
        protocol={PROTOCOL}
      />,
    );

    // Wait for data to load
    await waitFor(() => {
      expect(screen.getByText('Current schedule')).toBeTruthy();
    });

    await act(async () => {
      await user.click(screen.getByRole('button', { name: /assign to patient/i }));
    });

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('assign_protocol_to_patient', {
        p_protocol_id: 'proto-1',
        p_version: 1,
        p_patient_id: 'patient-1',
      });
    });
  });

  it('Test 4: success path shows success toast and calls onConfirmed', async () => {
    const user = userEvent.setup();
    const onConfirmed = vi.fn();

    render(
      <AdoptDiffModal
        open={true}
        onClose={vi.fn()}
        onConfirmed={onConfirmed}
        patientId="patient-1"
        patientName="Alice Smith"
        protocol={PROTOCOL}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Current schedule')).toBeTruthy();
    });

    await act(async () => {
      await user.click(screen.getByRole('button', { name: /assign to patient/i }));
    });

    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.stringContaining('Tirzepatide 12-Week'),
        'success',
      );
      expect(onConfirmed).toHaveBeenCalledTimes(1);
    });
  });

  it('Test 5: error path shows danger toast and does NOT call onConfirmed', async () => {
    const user = userEvent.setup();
    const onConfirmed = vi.fn();
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'RPC failed' } });

    render(
      <AdoptDiffModal
        open={true}
        onClose={vi.fn()}
        onConfirmed={onConfirmed}
        patientId="patient-1"
        patientName="Alice Smith"
        protocol={PROTOCOL}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Current schedule')).toBeTruthy();
    });

    await act(async () => {
      await user.click(screen.getByRole('button', { name: /assign to patient/i }));
    });

    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith('RPC failed', 'error');
      expect(onConfirmed).not.toHaveBeenCalled();
    });
  });

  it('Test 6: "Keep current schedule" button exists and calls onClose', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(
      <AdoptDiffModal
        open={true}
        onClose={onClose}
        onConfirmed={vi.fn()}
        patientId="patient-1"
        patientName="Alice Smith"
        protocol={PROTOCOL}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('Keep current schedule')).toBeTruthy();
    });

    await act(async () => {
      await user.click(screen.getByRole('button', { name: /keep current schedule/i }));
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
