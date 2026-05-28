/**
 * Phase 61 Plan 61-06 — AdoptProtocolSheet unit tests.
 *
 * Run with:
 *   npx vitest run --config vite.config.ts src/components/clinic/protocols/__tests__/AdoptProtocolSheet.test.tsx
 */

import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdoptProtocolSheet } from '../AdoptProtocolSheet';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockRpc, mockFrom } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
  mockFrom: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: mockRpc,
    from: mockFrom,
  },
}));

vi.mock('@/lib/store', () => ({
  useStore: (selector: (s: unknown) => unknown) =>
    selector({
      toast: null,
      showToast: vi.fn(),
      dismissToast: vi.fn(),
    }),
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

// Mock PatientPickerList to a controllable stub
vi.mock('../PatientPickerList', () => ({
  PatientPickerList: ({
    onSelect,
  }: {
    orgId: string;
    selectedId?: string | null;
    onSelect: (p: { id: string; name: string }) => void;
  }) => (
    <button
      type="button"
      data-testid="patient-picker-stub"
      onClick={() => onSelect({ id: 'patient-1', name: 'Alice Smith' })}
    >
      Select Alice Smith
    </button>
  ),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROTOCOL = {
  id: 'proto-1',
  version: 1,
  name: 'Tirzepatide 12-Week Titration',
  compound: 'tirzepatide',
};

function makeChain(result: unknown) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(result),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  // For AdoptDiffModal data fetch
  mockFrom.mockReturnValue(makeChain({ data: [], error: null }));
  mockRpc.mockResolvedValue({ data: null, error: null });
});

describe('AdoptProtocolSheet', () => {
  it('Test 1: renders sheet title when open=true', () => {
    render(<AdoptProtocolSheet open={true} onClose={vi.fn()} orgId="org-1" protocol={PROTOCOL} />);
    expect(screen.getByText('Adopt Protocol')).toBeTruthy();
  });

  it('Test 2: "Preview assignment" button is disabled initially', () => {
    render(<AdoptProtocolSheet open={true} onClose={vi.fn()} orgId="org-1" protocol={PROTOCOL} />);
    const previewBtn = screen.getByRole('button', { name: /preview assignment/i });
    expect(previewBtn).toBeDisabled();
  });

  it('Test 3: selecting a patient enables "Preview assignment" button', async () => {
    const user = userEvent.setup();
    render(<AdoptProtocolSheet open={true} onClose={vi.fn()} orgId="org-1" protocol={PROTOCOL} />);

    await act(async () => {
      await user.click(screen.getByTestId('patient-picker-stub'));
    });

    const previewBtn = screen.getByRole('button', { name: /preview assignment/i });
    expect(previewBtn).not.toBeDisabled();
  });

  it('Test 4: clicking Preview opens AdoptDiffModal (title "Assignment preview" visible)', async () => {
    const user = userEvent.setup();
    render(<AdoptProtocolSheet open={true} onClose={vi.fn()} orgId="org-1" protocol={PROTOCOL} />);

    // Select a patient first
    await act(async () => {
      await user.click(screen.getByTestId('patient-picker-stub'));
    });

    // Click Preview
    await act(async () => {
      await user.click(screen.getByRole('button', { name: /preview assignment/i }));
    });

    await waitFor(() => {
      expect(screen.getByText('Assignment preview')).toBeTruthy();
    });
  });

  it('Test 5: sheet does not render content when open=false', () => {
    render(<AdoptProtocolSheet open={false} onClose={vi.fn()} orgId="org-1" protocol={PROTOCOL} />);
    expect(screen.queryByText('Adopt Protocol')).toBeNull();
  });
});
